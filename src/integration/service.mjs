import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { TorchError } from '../kernel/errors.mjs';
import { readInstallManifest } from '../kernel/install.mjs';
import { loadFleetDefinition } from '../kernel/worktrees.mjs';

function git(root, args, { allowFailure = false } = {}) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  if (result.status !== 0 && !allowFailure) {
    throw new TorchError(`Git command failed: git ${args.join(' ')}`, {
      code: 'GIT_COMMAND_FAILED', details: result.stderr?.trim() || null,
    });
  }
  return { status: result.status, stdout: result.stdout?.trim() ?? '', stderr: result.stderr?.trim() ?? '' };
}

function integrationRow(row) {
  if (!row) return null;
  return {
    id: row.id, projectId: row.project_id, sourceArea: row.source_area,
    sourceBranch: row.source_branch, sourceCommit: row.source_commit,
    targetBranch: row.target_branch, baseTargetCommit: row.base_target_commit,
    state: row.state, reason: row.reason, requiredChecks: JSON.parse(row.required_checks),
    authorizedBy: row.authorized_by, authorizedAt: row.authorized_at,
    createdAt: row.created_at, updatedAt: row.updated_at, landedAt: row.landed_at,
  };
}

export class IntegrationService {
  constructor({ repositoryRoot, controlPlane, checkService, clock = () => new Date(), idFactory = randomUUID } = {}) {
    this.repositoryRoot = repositoryRoot;
    this.controlPlane = controlPlane;
    this.checkService = checkService;
    this.clock = clock;
    this.idFactory = idFactory;
    const { config } = loadFleetDefinition(repositoryRoot);
    this.policy = config.integration ?? {
      target: config.project.main_branch, required_checks: [], landing_authority: ['session-manager'],
    };
    const manifest = readInstallManifest(repositoryRoot);
    this.worktrees = new Map((manifest.external ?? [])
      .filter((entry) => entry.type === 'worktree')
      .map((entry) => [entry.area, entry]));
    this.controlPlane.database.exec(`
      CREATE TABLE IF NOT EXISTS integration_requests (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        source_area TEXT NOT NULL,
        source_branch TEXT NOT NULL,
        source_commit TEXT NOT NULL,
        target_branch TEXT NOT NULL,
        base_target_commit TEXT NOT NULL,
        state TEXT NOT NULL,
        reason TEXT,
        required_checks TEXT NOT NULL,
        authorized_by TEXT,
        authorized_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        landed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS integration_state_created
        ON integration_requests(state, created_at, id);
    `);
  }

  request({ areaId, commit } = {}) {
    const area = this.controlPlane.assertIdentity(areaId);
    if (area === 'session-manager') {
      throw new TorchError('Session Manager does not own a feature worktree by default', {
        code: 'INTEGRATION_SOURCE_INVALID',
      });
    }
    const worktree = this.worktrees.get(area);
    if (!worktree) throw new TorchError(`No managed worktree for ${area}`, { code: 'WORKTREE_MISSING' });
    const branchTip = git(this.repositoryRoot, ['rev-parse', worktree.branch]).stdout;
    const sourceCommit = commit ?? branchTip;
    if (git(this.repositoryRoot, ['cat-file', '-e', `${sourceCommit}^{commit}`], { allowFailure: true }).status !== 0) {
      throw new TorchError(`Source commit does not exist: ${sourceCommit}`, { code: 'INTEGRATION_COMMIT_MISSING' });
    }
    if (branchTip !== sourceCommit) {
      throw new TorchError('Integration requests must name the current source branch tip', {
        code: 'INTEGRATION_SOURCE_MOVED', details: { branchTip, sourceCommit },
      });
    }
    const targetBranch = this.policy.target;
    const baseTargetCommit = git(this.repositoryRoot, ['rev-parse', targetBranch]).stdout;
    const now = this.clock().toISOString();
    const record = {
      id: this.idFactory(), projectId: this.controlPlane.projectId, sourceArea: area,
      sourceBranch: worktree.branch, sourceCommit, targetBranch, baseTargetCommit,
      state: 'testing', reason: null, requiredChecks: this.policy.required_checks ?? [],
      authorizedBy: null, authorizedAt: null, createdAt: now, updatedAt: now, landedAt: null,
    };
    this.controlPlane.database.prepare(`
      INSERT INTO integration_requests (
        id, project_id, source_area, source_branch, source_commit, target_branch,
        base_target_commit, state, reason, required_checks, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id, record.projectId, record.sourceArea, record.sourceBranch, record.sourceCommit,
      record.targetBranch, record.baseTargetCommit, record.state, record.reason,
      JSON.stringify(record.requiredChecks), record.createdAt, record.updatedAt,
    );
    this.controlPlane.audit({
      actorId: area, operation: 'integration.request', entityType: 'integration-request', entityId: record.id,
      details: { sourceCommit, targetBranch },
    });
    return this.evaluate(record.id);
  }

  get(requestId) {
    const row = this.controlPlane.database.prepare('SELECT * FROM integration_requests WHERE id = ?').get(requestId);
    if (!row) throw new TorchError(`Unknown integration request: ${requestId}`, { code: 'INTEGRATION_NOT_FOUND' });
    return integrationRow(row);
  }

  list({ state } = {}) {
    const rows = state
      ? this.controlPlane.database.prepare(`
        SELECT * FROM integration_requests WHERE state = ? ORDER BY created_at, id
      `).all(state)
      : this.controlPlane.database.prepare('SELECT * FROM integration_requests ORDER BY created_at, id').all();
    return rows.map(integrationRow);
  }

  evaluate(requestId) {
    const request = this.get(requestId);
    if (request.state === 'landed' || request.state === 'superseded') return request;
    if (request.state === 'landing'
      && git(this.repositoryRoot, ['rev-parse', request.targetBranch]).stdout === request.sourceCommit) {
      const landedAt = this.clock().toISOString();
      this.controlPlane.database.prepare(`
        UPDATE integration_requests
        SET state = 'landed', reason = NULL, landed_at = ?, updated_at = ? WHERE id = ?
      `).run(landedAt, landedAt, request.id);
      return this.get(request.id);
    }
    let state = 'ready';
    let reason = null;
    const branchTip = git(this.repositoryRoot, ['rev-parse', request.sourceBranch], { allowFailure: true });
    if (branchTip.status !== 0) {
      state = 'blocked'; reason = 'source-branch-missing';
    } else if (branchTip.stdout !== request.sourceCommit) {
      state = 'superseded'; reason = 'source-branch-moved';
    } else if (git(this.repositoryRoot, [
      'merge-base', '--is-ancestor', request.baseTargetCommit, request.sourceCommit,
    ], { allowFailure: true }).status !== 0) {
      state = 'needs_convergence'; reason = 'source-does-not-contain-request-target';
    } else if (!this.checkService.exactPasses({
      commit: request.sourceCommit, requiredChecks: request.requiredChecks,
    })) {
      state = 'testing'; reason = 'required-exact-sha-checks-missing';
    }
    const updatedAt = this.clock().toISOString();
    this.controlPlane.database.prepare(`
      UPDATE integration_requests SET state = ?, reason = ?, updated_at = ? WHERE id = ?
    `).run(state, reason, updatedAt, request.id);
    return { ...request, state, reason, updatedAt };
  }

  authorize({ requestId, actorId } = {}) {
    const actor = this.controlPlane.assertIdentity(actorId);
    if (!(this.policy.landing_authority ?? []).includes(actor)) {
      throw new TorchError(`${actor} lacks landing authority`, {
        code: 'INTEGRATION_AUTHORITY_REQUIRED', details: { allowed: this.policy.landing_authority ?? [] },
      });
    }
    const request = this.evaluate(requestId);
    if (request.state !== 'ready') {
      throw new TorchError(`Integration request is ${request.state}, not ready`, {
        code: 'INTEGRATION_NOT_READY', details: { state: request.state, reason: request.reason },
      });
    }
    const authorizedAt = this.clock().toISOString();
    this.controlPlane.database.prepare(`
      UPDATE integration_requests SET authorized_by = ?, authorized_at = ?, updated_at = ? WHERE id = ?
    `).run(actor, authorizedAt, authorizedAt, request.id);
    this.controlPlane.audit({
      actorId: actor, operation: 'integration.authorize', entityType: 'integration-request', entityId: request.id,
    });
    return this.get(request.id);
  }

  planLanding({ requestId, actorId } = {}) {
    const actor = this.controlPlane.assertIdentity(actorId);
    const request = this.evaluate(requestId);
    const blockers = [];
    if (!(this.policy.landing_authority ?? []).includes(actor)) blockers.push({ code: 'LANDING_AUTHORITY_REQUIRED' });
    if (request.authorizedBy !== actor) blockers.push({ code: 'REQUEST_NOT_AUTHORIZED_BY_ACTOR' });
    if (request.state !== 'ready') blockers.push({ code: 'INTEGRATION_NOT_READY', state: request.state, reason: request.reason });
    const currentTarget = git(this.repositoryRoot, ['rev-parse', request.targetBranch]).stdout;
    if (this.policy.require_current_main !== false && currentTarget !== request.baseTargetCommit) {
      blockers.push({ code: 'TARGET_ADVANCED', expected: request.baseTargetCommit, actual: currentTarget });
    }
    const currentBranch = git(this.repositoryRoot, ['branch', '--show-current']).stdout;
    if (currentBranch !== request.targetBranch) blockers.push({ code: 'TARGET_NOT_CHECKED_OUT', currentBranch });
    const dirtyEntries = git(this.repositoryRoot, ['status', '--porcelain']).stdout.split('\n').filter(Boolean);
    if (dirtyEntries.length) blockers.push({ code: 'TARGET_WORKTREE_DIRTY', entries: dirtyEntries });
    if (git(this.repositoryRoot, [
      'merge-base', '--is-ancestor', currentTarget, request.sourceCommit,
    ], { allowFailure: true }).status !== 0) blockers.push({ code: 'FAST_FORWARD_NOT_POSSIBLE' });
    return {
      action: 'land-integration', request, actorId: actor, currentTarget,
      blockers, canProceed: blockers.length === 0, mutationPerformed: false,
    };
  }

  land({ requestId, actorId } = {}) {
    const plan = this.planLanding({ requestId, actorId });
    if (!plan.canProceed) {
      throw new TorchError('Integration landing refused by main-protection policy', {
        code: 'INTEGRATION_LANDING_BLOCKED', details: plan.blockers,
      });
    }
    const landingAt = this.clock().toISOString();
    this.controlPlane.database.prepare(`
      UPDATE integration_requests SET state = 'landing', reason = NULL, updated_at = ? WHERE id = ?
    `).run(landingAt, plan.request.id);
    this.controlPlane.audit({
      actorId, operation: 'integration.landing-start', entityType: 'integration-request', entityId: plan.request.id,
      details: { commit: plan.request.sourceCommit, target: plan.request.targetBranch },
    });
    try {
      git(this.repositoryRoot, ['merge', '--ff-only', plan.request.sourceCommit]);
    } catch (error) {
      const failedAt = this.clock().toISOString();
      this.controlPlane.database.prepare(`
        UPDATE integration_requests SET state = 'blocked', reason = ?, updated_at = ? WHERE id = ?
      `).run('git-fast-forward-failed', failedAt, plan.request.id);
      throw error;
    }
    const landedAt = this.clock().toISOString();
    this.controlPlane.database.prepare(`
      UPDATE integration_requests
      SET state = 'landed', reason = NULL, landed_at = ?, updated_at = ? WHERE id = ?
    `).run(landedAt, landedAt, plan.request.id);
    this.controlPlane.audit({
      actorId, operation: 'integration.land', entityType: 'integration-request', entityId: plan.request.id,
      details: { commit: plan.request.sourceCommit, target: plan.request.targetBranch },
    });
    return this.get(plan.request.id);
  }
}
