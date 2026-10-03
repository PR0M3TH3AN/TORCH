import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { TorchError } from '../kernel/errors.mjs';
import { readInstallManifest } from '../kernel/install.mjs';
import { loadFleetDefinition } from '../kernel/worktrees.mjs';
import { BacklogService } from '../backlog/service.mjs';
import { AdoptionService } from './adoption.mjs';

function git(root, args, { allowFailure = false } = {}) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  if (result.status !== 0 && !allowFailure) {
    throw new TorchError(`Git command failed: git ${args.join(' ')}`, {
      code: 'GIT_COMMAND_FAILED', details: result.stderr?.trim() || null,
    });
  }
  return { status: result.status, stdout: result.stdout?.trim() ?? '', stderr: result.stderr?.trim() ?? '' };
}

function text(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TorchError(`${name} is required`, { code: 'INTEGRATION_INPUT_INVALID', details: { name } });
  }
  return value.trim();
}

function sha(value, name) {
  const normalized = text(value, name);
  if (!/^[0-9a-f]{40,64}$/.test(normalized)) {
    throw new TorchError(`${name} must be a full Git object id`, { code: 'INTEGRATION_INPUT_INVALID', details: { name } });
  }
  return normalized;
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
    this.adoption = new AdoptionService({ repositoryRoot, controlPlane, clock, idFactory,
      policy: { target: this.policy.target } });
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
    return this.#registerRequest({ area, sourceBranch: worktree.branch, sourceCommit });
  }

  requestCandidate({ areaId, commit, candidateRef } = {}) {
    throw new TorchError('Private candidate intake requires an authenticated finalized adoption', {
      code: 'INTEGRATION_ADOPTED_INTAKE_INTERNAL_ONLY', details: { areaId, commit, candidateRef },
    });
  }

  #requestFinalizedCandidate({ adoptionId, areaId, commit, candidateRef } = {}) {
    const area = this.controlPlane.assertIdentity(areaId);
    if (area === 'session-manager') {
      throw new TorchError('Session Manager does not own a feature worktree by default', {
        code: 'INTEGRATION_SOURCE_INVALID',
      });
    }
    const adoption = this.adoption.getPrepared(text(adoptionId, 'adoptionId'));
    if (adoption.state !== 'requesting' || adoption.contributorArea !== area
      || adoption.candidateSha !== commit || adoption.candidateRef !== candidateRef) {
      throw new TorchError('Private candidate does not match an authenticated finalized adoption', {
        code: 'INTEGRATION_ADOPTED_BINDING_INVALID', details: { adoptionId, state: adoption.state },
      });
    }
    const ref = text(candidateRef, 'candidateRef');
    if (!/^refs\/torch\/integration-candidates\/[A-Za-z0-9._-]+$/.test(ref)) {
      throw new TorchError('Adopted candidates must use a private integration candidate ref', {
        code: 'INTEGRATION_ADOPTED_REF_INVALID', details: { candidateRef: ref },
      });
    }
    const sourceCommit = sha(commit, 'commit');
    const refTip = git(this.repositoryRoot, ['rev-parse', '--verify', ref], { allowFailure: true });
    if (refTip.status !== 0 || refTip.stdout !== sourceCommit) {
      throw new TorchError('Adopted candidate ref no longer names the exact requested commit', {
        code: 'INTEGRATION_ADOPTED_REF_STALE', details: { candidateRef: ref, sourceCommit, actual: refTip.stdout || null },
      });
    }
    const existing = this.controlPlane.database.prepare(`SELECT id FROM integration_requests
      WHERE project_id = ? AND source_branch = ? AND source_commit = ? ORDER BY rowid LIMIT 1`)
      .get(this.controlPlane.projectId, ref, sourceCommit);
    if (existing) return this.get(existing.id);
    return this.#registerRequest({ area, sourceBranch: ref, sourceCommit });
  }

  #registerRequest({ area, sourceBranch, sourceCommit }) {
    const targetBranch = this.policy.target;
    const baseTargetCommit = git(this.repositoryRoot, ['rev-parse', targetBranch]).stdout;
    const now = this.clock().toISOString();
    const record = {
      id: this.idFactory(), projectId: this.controlPlane.projectId, sourceArea: area,
      sourceBranch, sourceCommit, targetBranch, baseTargetCommit,
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

  planAdoption(input = {}) {
    return this.adoption.plan(input);
  }

  prepareAdoption(input = {}) {
    return this.adoption.prepare(input);
  }

  getPreparedAdoption(adoptionId) {
    return this.adoption.getPrepared(adoptionId);
  }

  finalizeAdoption(input = {}) {
    return this.adoption.finalize(input);
  }

  reconcileAdoption(input = {}) {
    return this.adoption.reconcile(input);
  }

  rollbackAdoption(input = {}) {
    return this.adoption.rollback(input);
  }

  requestAdoptedCandidate(input = {}) {
    return this.adoption.requestAdoptedCandidate(input, {
      requestIntegration: ({ adoptionId, areaId, commit, candidateRef }) => this.#requestFinalizedCandidate({ adoptionId, areaId, commit, candidateRef }),
      findIntegrationRequest: ({ candidateRef, commit }) => this.findCandidateRequest({ candidateRef, commit }),
    });
  }

  findCandidateRequest({ candidateRef, commit } = {}) {
    const row = this.controlPlane.database.prepare(`SELECT id FROM integration_requests
      WHERE project_id = ? AND source_branch = ? AND source_commit = ? ORDER BY rowid LIMIT 1`)
      .get(this.controlPlane.projectId, candidateRef, commit);
    return row ? this.get(row.id) : null;
  }

  get(requestId) {
    const row = this.controlPlane.database.prepare('SELECT * FROM integration_requests WHERE id = ?').get(requestId);
    if (!row) throw new TorchError(`Unknown integration request: ${requestId}`, { code: 'INTEGRATION_NOT_FOUND' });
    return integrationRow(row);
  }

  list({ state } = {}) {
    const rows = state
      ? this.controlPlane.database.prepare(`
        SELECT * FROM integration_requests WHERE state = ? ORDER BY rowid
      `).all(state)
      : this.controlPlane.database.prepare('SELECT * FROM integration_requests ORDER BY rowid').all();
    return rows.map(integrationRow);
  }

  evaluate(requestId) {
    const request = this.get(requestId);
    if (request.state === 'landed' || request.state === 'superseded') return request;
    const targetCommit = git(this.repositoryRoot, ['rev-parse', request.targetBranch]).stdout;
    if (request.authorizedBy
      && (this.policy.landing_authority ?? []).includes(request.authorizedBy)
      && git(this.repositoryRoot, ['merge-base', '--is-ancestor', request.sourceCommit, targetCommit], { allowFailure: true }).status === 0
      && this.checkService.exactPasses({ commit: request.sourceCommit, requiredChecks: request.requiredChecks })) {
      const landedAt = this.clock().toISOString();
      this.controlPlane.database.prepare(`
        UPDATE integration_requests
        SET state = 'landed', reason = NULL, landed_at = ?, updated_at = ? WHERE id = ?
      `).run(landedAt, landedAt, request.id);
      this.controlPlane.audit({
        actorId: request.authorizedBy, operation: 'integration.reconcile-landed',
        entityType: 'integration-request', entityId: request.id,
        details: { commit: request.sourceCommit, target: request.targetBranch },
      });
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
    } else {
      const targetCommit = git(this.repositoryRoot, ['rev-parse', request.targetBranch]).stdout;
      if (targetCommit !== request.baseTargetCommit
        && git(this.repositoryRoot, [
          'merge-base', '--is-ancestor', targetCommit, request.sourceCommit,
        ], { allowFailure: true }).status !== 0) {
        state = 'needs_convergence'; reason = 'target-advanced-since-request';
      }
    }
    if (state === 'ready' && !this.checkService.exactPasses({
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

  firstReadyRequest(actorId) {
    for (const queued of this.list()) {
      if (queued.authorizedBy !== actorId) continue;
      const current = this.evaluate(queued.id);
      if (current.state === 'ready') return current;
    }
    return null;
  }

  planLanding({ requestId, actorId } = {}) {
    const actor = this.controlPlane.assertIdentity(actorId);
    const request = this.evaluate(requestId);
    const blockers = [];
    if (!(this.policy.landing_authority ?? []).includes(actor)) blockers.push({ code: 'LANDING_AUTHORITY_REQUIRED' });
    if (request.authorizedBy !== actor) blockers.push({ code: 'REQUEST_NOT_AUTHORIZED_BY_ACTOR' });
    if (request.state !== 'ready') blockers.push({ code: 'INTEGRATION_NOT_READY', state: request.state, reason: request.reason });
    if (request.state === 'ready') {
      const firstReady = this.firstReadyRequest(actor);
      if (firstReady && firstReady.id !== request.id) {
        blockers.push({ code: 'INTEGRATION_QUEUE_ORDER_REQUIRED', nextRequestId: firstReady.id });
      }
    }
    const currentTarget = git(this.repositoryRoot, ['rev-parse', request.targetBranch]).stdout;
    if (this.policy.require_current_main !== false && currentTarget !== request.baseTargetCommit
      && git(this.repositoryRoot, [
        'merge-base', '--is-ancestor', currentTarget, request.sourceCommit,
      ], { allowFailure: true }).status !== 0) {
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
    const database = this.controlPlane.database;
    try {
      database.exec('BEGIN IMMEDIATE');
    } catch (error) {
      if (/busy|locked/i.test(error.message ?? '')) {
        throw new TorchError('Another integration or project-state writer holds the landing queue. Retry after it finishes.', {
          code: 'INTEGRATION_LANDING_BUSY', details: { requestId },
        });
      }
      throw error;
    }
    let transactionFinished = false;
    try {
      // This write transaction is the per-project landing mutex. A second
      // Session Manager process cannot pass the target/ref checks until this
      // one has either landed or failed.
      const plan = this.planLanding({ requestId, actorId });
      if (!plan.canProceed) {
        throw new TorchError('Integration landing refused by main-protection policy', {
          code: 'INTEGRATION_LANDING_BLOCKED', details: plan.blockers,
        });
      }
      const landingAt = this.clock().toISOString();
      database.prepare(`
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
        database.prepare(`
          UPDATE integration_requests SET state = 'blocked', reason = ?, updated_at = ? WHERE id = ?
        `).run('git-fast-forward-failed', failedAt, plan.request.id);
        this.controlPlane.audit({
          actorId, operation: 'integration.landing-failed',
          entityType: 'integration-request', entityId: plan.request.id,
          details: { commit: plan.request.sourceCommit, target: plan.request.targetBranch },
        });
        database.exec('COMMIT');
        transactionFinished = true;
        throw error;
      }
      const landedAt = this.clock().toISOString();
      database.prepare(`
        UPDATE integration_requests
        SET state = 'landed', reason = NULL, landed_at = ?, updated_at = ? WHERE id = ?
      `).run(landedAt, landedAt, plan.request.id);
      this.controlPlane.audit({
        actorId, operation: 'integration.land', entityType: 'integration-request', entityId: plan.request.id,
        details: { commit: plan.request.sourceCommit, target: plan.request.targetBranch },
      });
      database.exec('COMMIT');
      transactionFinished = true;
      const landed = this.get(plan.request.id);
      // Closure is a post-landing reconciliation. Never report a successful
      // Git landing as failed just because its task bookkeeping needs review.
      try {
        const { config } = loadFleetDefinition(this.repositoryRoot);
        if (config.backlog?.activity?.auto_close_after_landing === true) {
          const backlog = new BacklogService({ repositoryRoot: this.repositoryRoot,
            controlPlane: this.controlPlane, checkService: this.checkService,
            integrationLookup: (id) => this.get(id), clock: this.clock });
          landed.backlogClosure = backlog.reconcileLanded({ integrationRequest: landed.id, actorId, automatic: true });
        }
      } catch (error) {
        landed.backlogClosure = { disposition: 'needs-review', reason: error.code ?? error.message };
        try {
          this.controlPlane.audit({ actorId, operation: 'backlog.landed-closure-needs-review',
            entityType: 'integration-request', entityId: landed.id, details: landed.backlogClosure });
        } catch (auditError) { landed.backlogClosure.auditError = auditError.code ?? auditError.message; }
      }
      return landed;
    } catch (error) {
      if (!transactionFinished) database.exec('ROLLBACK');
      throw error;
    }
  }

  drain({ actorId, limit = 50 } = {}) {
    const actor = this.controlPlane.assertIdentity(actorId);
    if (!(this.policy.landing_authority ?? []).includes(actor)) {
      throw new TorchError(`${actor} lacks landing authority`, {
        code: 'INTEGRATION_AUTHORITY_REQUIRED', details: { allowed: this.policy.landing_authority ?? [] },
      });
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new TorchError('Integration queue drain limit must be between 1 and 500', {
        code: 'INTEGRATION_DRAIN_LIMIT_INVALID', details: { limit },
      });
    }
    const candidates = this.list().filter((request) => request.authorizedBy === actor
      && ['ready', 'testing'].includes(request.state)).slice(0, limit);
    const results = [];
    for (const candidate of candidates) {
      const current = this.evaluate(candidate.id);
      if (current.state !== 'ready') {
        results.push({ requestId: candidate.id, state: current.state, reason: current.reason, landed: false });
        continue;
      }
      try {
        const landed = this.land({ requestId: candidate.id, actorId: actor });
        results.push({ requestId: candidate.id, state: landed.state, landed: landed.state === 'landed',
          ...(landed.backlogClosure ? { backlogClosure: landed.backlogClosure } : {}) });
      } catch (error) {
        if (error.code === 'INTEGRATION_LANDING_BUSY') {
          results.push({ requestId: candidate.id, state: 'queued', reason: 'another-lander-active', landed: false, retryable: true });
          break;
        }
        if (error.code === 'INTEGRATION_LANDING_BLOCKED') {
          const refreshed = this.evaluate(candidate.id);
          results.push({ requestId: candidate.id, state: refreshed.state, reason: refreshed.reason,
            blockers: error.details, landed: false });
          continue;
        }
        throw error;
      }
    }
    return {
      actorId: actor, processed: results.length,
      landed: results.filter((entry) => entry.landed).length,
      deferred: results.filter((entry) => !entry.landed).length,
      results, mutationPerformed: results.some((entry) => entry.landed),
    };
  }
}
