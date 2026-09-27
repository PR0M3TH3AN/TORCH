import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { TorchError } from '../kernel/errors.mjs';
import { readInstallManifest } from '../kernel/install.mjs';
import { loadFleetDefinition } from '../kernel/worktrees.mjs';

const GUARD_TYPES = Object.freeze(['check', 'measurement', 'pin']);

function git(root, args, { allowFailure = false } = {}) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  if (result.status !== 0 && !allowFailure) {
    throw new TorchError(`Git command failed: git ${args.join(' ')}`, {
      code: 'GIT_COMMAND_FAILED', details: result.stderr?.trim() || null,
    });
  }
  return { status: result.status, stdout: result.stdout?.trim() ?? '', stderr: result.stderr?.trim() ?? '' };
}

export function initializeWorktreeGuards(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS worktree_guards (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      area_id TEXT NOT NULL,
      guard_type TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL,
      released_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_open_guard_per_type
      ON worktree_guards(area_id, guard_type) WHERE released_at IS NULL;
  `);
}

export function beginWorktreeGuard(controlPlane, {
  areaId, type, reason, clock = () => new Date(), idFactory = randomUUID,
} = {}) {
  const area = controlPlane.assertIdentity(areaId);
  if (!GUARD_TYPES.includes(type)) throw new TorchError(`Invalid worktree guard: ${type}`, { code: 'WORKTREE_GUARD_INVALID' });
  if (typeof reason !== 'string' || !reason.trim()) throw new TorchError('Worktree guard reason is required', { code: 'WORKTREE_GUARD_INVALID' });
  initializeWorktreeGuards(controlPlane.database);
  const guard = {
    id: idFactory(), projectId: controlPlane.projectId, areaId: area, type,
    reason: reason.trim(), createdAt: clock().toISOString(), releasedAt: null,
  };
  try {
    controlPlane.database.prepare(`
      INSERT INTO worktree_guards (id, project_id, area_id, guard_type, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(guard.id, guard.projectId, guard.areaId, guard.type, guard.reason, guard.createdAt);
  } catch (error) {
    throw new TorchError(`${area} already has an active ${type} guard`, {
      code: 'WORKTREE_GUARD_EXISTS', details: error.message,
    });
  }
  controlPlane.audit({
    actorId: area, operation: 'worktree-guard.begin', entityType: 'worktree-guard', entityId: guard.id,
    details: { type, reason: guard.reason },
  });
  return guard;
}

export function endWorktreeGuard(controlPlane, {
  areaId, type, clock = () => new Date(), missingOk = false,
} = {}) {
  const area = controlPlane.assertIdentity(areaId);
  if (!GUARD_TYPES.includes(type)) throw new TorchError(`Invalid worktree guard: ${type}`, { code: 'WORKTREE_GUARD_INVALID' });
  initializeWorktreeGuards(controlPlane.database);
  const guard = controlPlane.database.prepare(`
    SELECT * FROM worktree_guards WHERE area_id = ? AND guard_type = ? AND released_at IS NULL
  `).get(area, type);
  if (!guard) {
    if (missingOk) return null;
    throw new TorchError(`${area} has no active ${type} guard`, { code: 'WORKTREE_GUARD_NOT_FOUND' });
  }
  const releasedAt = clock().toISOString();
  controlPlane.database.prepare('UPDATE worktree_guards SET released_at = ? WHERE id = ?').run(releasedAt, guard.id);
  controlPlane.audit({
    actorId: area, operation: 'worktree-guard.end', entityType: 'worktree-guard', entityId: guard.id,
    details: { type },
  });
  return { id: guard.id, areaId: area, type, reason: guard.reason, createdAt: guard.created_at, releasedAt };
}

export class ConvergenceService {
  constructor({ repositoryRoot, controlPlane, clock = () => new Date(), idFactory = randomUUID } = {}) {
    this.repositoryRoot = repositoryRoot;
    this.controlPlane = controlPlane;
    this.clock = clock;
    this.idFactory = idFactory;
    const { config } = loadFleetDefinition(repositoryRoot);
    this.targetBranch = config.project.main_branch;
    this.policy = config.synchronization ?? {};
    const manifest = readInstallManifest(repositoryRoot);
    this.worktrees = new Map((manifest.external ?? [])
      .filter((entry) => entry.type === 'worktree')
      .map((entry) => [entry.area, entry]));
    initializeWorktreeGuards(controlPlane.database);
  }

  guards(areaId) {
    const area = this.controlPlane.assertIdentity(areaId);
    return this.controlPlane.database.prepare(`
      SELECT id, area_id AS areaId, guard_type AS type, reason, created_at AS createdAt
      FROM worktree_guards WHERE area_id = ? AND released_at IS NULL ORDER BY created_at, id
    `).all(area);
  }

  hold({ areaId, type, reason } = {}) {
    return beginWorktreeGuard(this.controlPlane, {
      areaId, type, reason, clock: this.clock, idFactory: this.idFactory,
    });
  }

  release({ areaId, type } = {}) {
    return endWorktreeGuard(this.controlPlane, { areaId, type, clock: this.clock });
  }

  plan({ areaId } = {}) {
    const area = this.controlPlane.assertIdentity(areaId);
    const worktree = this.worktrees.get(area);
    if (!worktree) throw new TorchError(`No managed worktree for ${area}`, { code: 'WORKTREE_MISSING' });
    const blockers = [];
    const actualBranch = git(worktree.path, ['branch', '--show-current']).stdout;
    if (actualBranch !== worktree.branch) blockers.push({ code: 'BRANCH_MISMATCH', expected: worktree.branch, actual: actualBranch || null });
    const dirtyEntries = git(worktree.path, ['status', '--porcelain=v1', '--untracked-files=all']).stdout.split('\n').filter(Boolean);
    if (dirtyEntries.length) blockers.push({ code: 'WORKTREE_DIRTY', entries: dirtyEntries });
    const operationPaths = ['MERGE_HEAD', 'REBASE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']
      .map((name) => ({ name, path: git(worktree.path, ['rev-parse', '--git-path', name]).stdout }))
      .filter((entry) => entry.path && existsSync(entry.path));
    if (operationPaths.length) blockers.push({ code: 'GIT_OPERATION_ACTIVE', operations: operationPaths.map((entry) => entry.name) });
    const guards = this.guards(area);
    for (const guard of guards) blockers.push({ code: `WORKTREE_${guard.type.toUpperCase()}_ACTIVE`, guard });
    const sourceCommit = git(worktree.path, ['rev-parse', 'HEAD']).stdout;
    const targetCommit = git(this.repositoryRoot, ['rev-parse', this.targetBranch]).stdout;
    const behind = Number(git(this.repositoryRoot, ['rev-list', '--count', `${sourceCommit}..${targetCommit}`]).stdout || 0);
    const ahead = Number(git(this.repositoryRoot, ['rev-list', '--count', `${targetCommit}..${sourceCommit}`]).stdout || 0);
    return {
      action: 'merge-canonical-into-domain', areaId: area, worktree: worktree.path,
      branch: worktree.branch, targetBranch: this.targetBranch, sourceCommit, targetCommit,
      ahead, behind, upToDate: behind === 0, blockers,
      canProceed: blockers.length === 0, mutationPerformed: false,
    };
  }

  converge({ areaId } = {}) {
    const plan = this.plan({ areaId });
    if (!plan.canProceed) throw new TorchError('Worktree convergence is blocked', { code: 'CONVERGENCE_BLOCKED', details: plan.blockers });
    if (plan.upToDate) return { ...plan, changed: false };
    const merged = git(plan.worktree, ['merge', '--no-edit', plan.targetCommit], { allowFailure: true });
    if (merged.status !== 0) {
      throw new TorchError('Canonical merge requires domain-owned conflict resolution', {
        code: 'CONVERGENCE_CONFLICT', details: { stderr: merged.stderr, worktree: plan.worktree },
      });
    }
    const commit = git(plan.worktree, ['rev-parse', 'HEAD']).stdout;
    this.controlPlane.audit({
      actorId: plan.areaId, operation: 'worktree.converge', entityType: 'worktree', entityId: plan.areaId,
      details: { from: plan.sourceCommit, target: plan.targetCommit, commit },
    });
    return { ...plan, commit, changed: commit !== plan.sourceCommit, mutationPerformed: true };
  }
}
