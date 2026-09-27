import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TorchError } from '../kernel/errors.mjs';
import { readInstallManifest } from '../kernel/install.mjs';
import { loadFleetDefinition } from '../kernel/worktrees.mjs';
import { beginWorktreeGuard, endWorktreeGuard } from '../convergence/service.mjs';

function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new TorchError(`Git inspection failed for check: ${args.join(' ')}`, {
      code: 'GIT_COMMAND_FAILED', details: result.stderr?.trim() || null,
    });
  }
  return result.stdout.trim();
}

function localStateRoot(manifest) {
  const record = (manifest.external ?? []).find((entry) => entry.type === 'local-state');
  if (!record?.path) throw new TorchError('Installation has no local state root', { code: 'LOCAL_STATE_MISSING' });
  return record.path;
}

function safeOutput(value, max = 256_000) {
  const output = typeof value === 'string' ? value : value?.toString?.() ?? '';
  return output.length > max ? `${output.slice(0, max)}\n[truncated]\n` : output;
}

function definitionHash(definition) {
  return createHash('sha256').update(JSON.stringify(definition)).digest('hex');
}

export class CheckService {
  constructor({
    repositoryRoot, controlPlane, resourceService = null,
    executor = (command, args, options) => spawnSync(command, args, options),
    clock = () => new Date(), idFactory = randomUUID,
  } = {}) {
    this.repositoryRoot = repositoryRoot;
    this.controlPlane = controlPlane;
    this.resourceService = resourceService;
    this.executor = executor;
    this.clock = clock;
    this.idFactory = idFactory;
    const { config } = loadFleetDefinition(repositoryRoot);
    this.definitions = new Map((config.checks ?? []).map((check) => [check.id, check]));
    const manifest = readInstallManifest(repositoryRoot);
    this.stateRoot = localStateRoot(manifest);
    this.worktrees = new Map((manifest.external ?? [])
      .filter((entry) => entry.type === 'worktree')
      .map((entry) => [entry.area, entry]));
    this.controlPlane.database.exec(`
      CREATE TABLE IF NOT EXISTS check_receipts (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        check_id TEXT NOT NULL,
        definition TEXT NOT NULL,
        definition_hash TEXT NOT NULL,
        area_id TEXT NOT NULL,
        worktree TEXT NOT NULL,
        commit_sha TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT NOT NULL,
        exit_status INTEGER,
        result TEXT NOT NULL,
        artifact_path TEXT,
        invalid_reason TEXT
      );
      CREATE INDEX IF NOT EXISTS check_receipts_commit
        ON check_receipts(commit_sha, check_id, result);
    `);
  }

  listChecks() {
    return [...this.definitions.values()];
  }

  plan({ checkId, areaId } = {}) {
    const area = this.controlPlane.assertIdentity(areaId);
    const definition = this.definitions.get(checkId);
    if (!definition) {
      throw new TorchError(`Unknown check: ${checkId}`, { code: 'CHECK_NOT_FOUND', details: { checkId } });
    }
    const worktree = this.worktrees.get(area);
    if (!worktree) {
      throw new TorchError(`No managed worktree for ${area}`, { code: 'WORKTREE_MISSING', details: { areaId: area } });
    }
    const dirtyEntries = git(worktree.path, ['status', '--porcelain']).split('\n').filter(Boolean);
    const commit = git(worktree.path, ['rev-parse', 'HEAD']);
    const missingLeases = (definition.resources ?? []).filter((resourceId) =>
      !this.resourceService?.hasActiveLease({ resourceId, areaId: area }));
    const blockers = [];
    if (dirtyEntries.length) blockers.push({ code: 'WORKTREE_DIRTY', entries: dirtyEntries });
    for (const resourceId of missingLeases) blockers.push({ code: 'RESOURCE_LEASE_REQUIRED', resourceId });
    return {
      action: 'run-check', checkId, areaId: area, definition, worktree: worktree.path,
      branch: worktree.branch, commit, blockers, canProceed: blockers.length === 0,
      mutationPerformed: false,
    };
  }

  run({ checkId, areaId } = {}) {
    const plan = this.plan({ checkId, areaId });
    if (!plan.canProceed) {
      throw new TorchError(`Check ${checkId} cannot run`, {
        code: 'CHECK_BLOCKED', details: plan.blockers,
      });
    }
    const receiptId = this.idFactory();
    const startedAt = this.clock().toISOString();
    beginWorktreeGuard(this.controlPlane, {
      areaId: plan.areaId, type: 'check', reason: `Running ${checkId}`,
      clock: this.clock, idFactory: this.idFactory,
    });
    let result;
    try {
      result = this.executor(plan.definition.command, plan.definition.args ?? [], {
        cwd: plan.worktree, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      });
    } finally {
      endWorktreeGuard(this.controlPlane, {
        areaId: plan.areaId, type: 'check', clock: this.clock, missingOk: true,
      });
    }
    const finishedAt = this.clock().toISOString();
    const afterCommit = git(plan.worktree, ['rev-parse', 'HEAD']);
    const afterDirty = git(plan.worktree, ['status', '--porcelain']).split('\n').filter(Boolean);
    let status = result.status === 0 ? 'pass' : 'fail';
    let invalidReason = null;
    if (afterCommit !== plan.commit) {
      status = 'incomplete';
      invalidReason = 'commit-changed-during-check';
    } else if (afterDirty.length) {
      status = 'incomplete';
      invalidReason = 'worktree-changed-during-check';
    }
    const artifactDirectory = join(this.stateRoot, 'checks', receiptId);
    mkdirSync(artifactDirectory, { recursive: false });
    const artifactPath = join(artifactDirectory, 'output.json');
    writeFileSync(artifactPath, `${JSON.stringify({
      stdout: safeOutput(result.stdout), stderr: safeOutput(result.stderr),
    }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    const receipt = {
      id: receiptId, projectId: this.controlPlane.projectId, checkId, areaId: plan.areaId,
      definition: plan.definition, worktree: plan.worktree, commit: plan.commit,
      startedAt, finishedAt, exitStatus: result.status ?? null, result: status,
      artifactPath, invalidReason,
    };
    this.controlPlane.database.prepare(`
      INSERT INTO check_receipts (
        id, project_id, check_id, definition, definition_hash, area_id, worktree, commit_sha,
        started_at, finished_at, exit_status, result, artifact_path, invalid_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      receipt.id, receipt.projectId, receipt.checkId, JSON.stringify(receipt.definition),
      definitionHash(receipt.definition), receipt.areaId, receipt.worktree, receipt.commit,
      receipt.startedAt, receipt.finishedAt,
      receipt.exitStatus, receipt.result, receipt.artifactPath, receipt.invalidReason,
    );
    this.controlPlane.audit({
      actorId: plan.areaId, operation: 'check.run', entityType: 'check-receipt', entityId: receipt.id,
      details: { checkId, commit: receipt.commit, result: receipt.result },
    });
    return receipt;
  }

  receipts({ commit, checkId, areaId } = {}) {
    const clauses = [];
    const values = [];
    if (commit) { clauses.push('commit_sha = ?'); values.push(commit); }
    if (checkId) { clauses.push('check_id = ?'); values.push(checkId); }
    if (areaId) { clauses.push('area_id = ?'); values.push(this.controlPlane.assertIdentity(areaId)); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return this.controlPlane.database.prepare(`
      SELECT * FROM check_receipts ${where} ORDER BY finished_at DESC, id DESC
    `).all(...values).map((row) => ({
      id: row.id, projectId: row.project_id, checkId: row.check_id,
      definition: JSON.parse(row.definition), areaId: row.area_id, worktree: row.worktree,
      definitionHash: row.definition_hash,
      commit: row.commit_sha, startedAt: row.started_at, finishedAt: row.finished_at,
      exitStatus: row.exit_status, result: row.result, artifactPath: row.artifact_path,
      invalidReason: row.invalid_reason,
    }));
  }

  exactPasses({ commit, requiredChecks }) {
    const receipts = this.receipts({ commit });
    return requiredChecks.every((checkId) => {
      const definition = this.definitions.get(checkId);
      return Boolean(definition) && receipts.some((receipt) =>
        receipt.checkId === checkId && receipt.result === 'pass'
        && receipt.definitionHash === definitionHash(definition));
    });
  }
}
