import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TorchError } from '../kernel/errors.mjs';
import { readInstallManifest } from '../kernel/install.mjs';
import { loadFleetDefinition } from '../kernel/worktrees.mjs';
import { beginWorktreeGuard, endWorktreeGuard } from '../convergence/service.mjs';
import { captureCheckSnapshot, disposeCheckSnapshot, verifyCheckSnapshot } from './snapshot.mjs';
import { executeConditionedCheck, validConditionEvidence } from './conditions.mjs';
import { checkRunnerIdentity, observeCheckRunner } from './runner.mjs';

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
      CREATE TABLE IF NOT EXISTS prepared_checks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        area_id TEXT NOT NULL,
        check_id TEXT NOT NULL,
        definition_json TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        state TEXT NOT NULL,
        created_at TEXT NOT NULL,
        receipt_id TEXT
      );
    `);
    const columns = this.controlPlane.database.prepare('PRAGMA table_info(check_receipts)').all();
    if (!columns.some((column) => column.name === 'conditions_json')) {
      this.controlPlane.database.exec('ALTER TABLE check_receipts ADD COLUMN conditions_json TEXT');
    }
    const preparedColumns = this.controlPlane.database.prepare('PRAGMA table_info(prepared_checks)').all();
    for (const column of ['runner_json', 'recovery_json']) {
      if (!preparedColumns.some((record) => record.name === column)) {
        this.controlPlane.database.exec(`ALTER TABLE prepared_checks ADD COLUMN ${column} TEXT`);
      }
    }
  }

  listChecks() {
    this.refreshDefinitions();
    return [...this.definitions.values()];
  }

  refreshDefinitions() {
    const { config } = loadFleetDefinition(this.repositoryRoot);
    this.definitions = new Map((config.checks ?? []).map((check) => [check.id, check]));
  }

  plan({ checkId, areaId } = {}) {
    this.refreshDefinitions();
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
    if (plan.definition.snapshot) {
      const prepared = this.prepare({ checkId, areaId });
      return this.runPrepared({ preparedId: prepared.id, areaId });
    }
    const receiptId = this.idFactory();
    const startedAt = this.clock().toISOString();
    beginWorktreeGuard(this.controlPlane, {
      areaId: plan.areaId, type: 'check', reason: `Running ${checkId}`,
      clock: this.clock, idFactory: this.idFactory,
    });
    let result;
    let execution;
    try {
      execution = executeConditionedCheck({
        definition: plan.definition, subject: { commit: plan.commit }, cwd: plan.worktree,
        executor: this.executor, clock: this.clock,
      });
      result = execution.result;
    } finally {
      endWorktreeGuard(this.controlPlane, {
        areaId: plan.areaId, type: 'check', clock: this.clock, missingOk: true,
      });
    }
    const finishedAt = this.clock().toISOString();
    const afterCommit = git(plan.worktree, ['rev-parse', 'HEAD']);
    const afterDirty = git(plan.worktree, ['status', '--porcelain']).split('\n').filter(Boolean);
    let status = execution.invalidReason ? 'incomplete' : result.status === 0 ? 'pass' : 'fail';
    let invalidReason = execution.invalidReason;
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
      conditions: execution.conditions, measurementsExecuted: execution.measurementsExecuted,
    }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    const receipt = {
      id: receiptId, projectId: this.controlPlane.projectId, checkId, areaId: plan.areaId,
      definition: plan.definition, worktree: plan.worktree, commit: plan.commit,
      startedAt, finishedAt, exitStatus: result.status ?? null, result: status,
      artifactPath, invalidReason,
      conditions: execution.conditions,
    };
    this.controlPlane.database.prepare(`
      INSERT INTO check_receipts (
        id, project_id, check_id, definition, definition_hash, area_id, worktree, commit_sha,
        started_at, finished_at, exit_status, result, artifact_path, invalid_reason, conditions_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      receipt.id, receipt.projectId, receipt.checkId, JSON.stringify(receipt.definition),
      definitionHash(receipt.definition), receipt.areaId, receipt.worktree, receipt.commit,
      receipt.startedAt, receipt.finishedAt,
      receipt.exitStatus, receipt.result, receipt.artifactPath, receipt.invalidReason,
      execution.conditions ? JSON.stringify(execution.conditions) : null,
    );
    this.controlPlane.audit({
      actorId: plan.areaId, operation: 'check.run', entityType: 'check-receipt', entityId: receipt.id,
      details: { checkId, commit: receipt.commit, result: receipt.result },
    });
    return receipt;
  }

  prepared({ areaId } = {}) {
    const area = areaId ? this.controlPlane.assertIdentity(areaId) : null;
    return this.controlPlane.database.prepare(`SELECT * FROM prepared_checks
      WHERE project_id = ? ${area ? 'AND area_id = ?' : ''} ORDER BY created_at, id`)
      .all(this.controlPlane.projectId, ...(area ? [area] : [])).map((row) => ({
        id: row.id, areaId: row.area_id, checkId: row.check_id, state: row.state,
        definition: JSON.parse(row.definition_json), snapshot: JSON.parse(row.snapshot_json),
        createdAt: row.created_at, receiptId: row.receipt_id,
        runner: row.runner_json ? JSON.parse(row.runner_json) : null,
        recovery: row.recovery_json ? JSON.parse(row.recovery_json) : null,
      }));
  }

  prepare({ checkId, areaId } = {}) {
    const plan = this.plan({ checkId, areaId });
    const blockers = plan.blockers.filter((blocker) => blocker.code !== 'RESOURCE_LEASE_REQUIRED');
    if (blockers.length) throw new TorchError('Check inputs cannot be prepared', {
      code: 'CHECK_BLOCKED', details: blockers,
    });
    const snapshot = captureCheckSnapshot({
      worktree: plan.worktree, stateRoot: this.stateRoot, definition: plan.definition,
      commit: plan.commit, id: this.idFactory(),
    });
    try {
      if (git(plan.worktree, ['rev-parse', 'HEAD']) !== plan.commit
        || git(plan.worktree, ['status', '--porcelain'])) {
        throw new TorchError('Source changed while preparing check inputs', { code: 'CHECK_BLOCKED' });
      }
      const createdAt = this.clock().toISOString();
      this.controlPlane.database.prepare(`INSERT INTO prepared_checks
        (id, project_id, area_id, check_id, definition_json, snapshot_json, state, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'prepared', ?)`)
        .run(snapshot.id, this.controlPlane.projectId, plan.areaId, checkId,
          JSON.stringify(plan.definition), JSON.stringify(snapshot), createdAt);
      this.controlPlane.audit({
        actorId: plan.areaId, operation: 'check.prepare', entityType: 'prepared-check', entityId: snapshot.id,
        details: { checkId, commit: plan.commit, inputDigest: snapshot.digest },
      });
      return this.prepared({ areaId: plan.areaId }).find((item) => item.id === snapshot.id);
    } catch (error) {
      // If persistence succeeded, retain inputs as durable recovery evidence.
      if (!this.prepared({ areaId: plan.areaId }).some((item) => item.id === snapshot.id)) {
        disposeCheckSnapshot(snapshot, { stateRoot: this.stateRoot });
      }
      throw error;
    }
  }

  runPrepared({ preparedId, areaId } = {}) {
    this.refreshDefinitions();
    const area = this.controlPlane.assertIdentity(areaId);
    const item = this.prepared({ areaId: area }).find((candidate) => candidate.id === preparedId);
    if (!item || item.state !== 'prepared') throw new TorchError('Prepared check is unavailable for this identity', {
      code: 'PREPARED_CHECK_UNAVAILABLE',
    });
    const currentDefinition = this.definitions.get(item.checkId);
    if (!currentDefinition || definitionHash(currentDefinition) !== definitionHash(item.definition)) {
      throw new TorchError('Prepared check policy changed; prepare new inputs', { code: 'CHECK_POLICY_CHANGED' });
    }
    const missing = (item.definition.resources ?? []).filter((resourceId) =>
      !this.resourceService?.hasActiveLease({ resourceId, areaId: area }));
    if (missing.length) throw new TorchError('Prepared check requires resource leases', {
      code: 'CHECK_BLOCKED', details: missing.map((resourceId) => ({ code: 'RESOURCE_LEASE_REQUIRED', resourceId })),
    });
    verifyCheckSnapshot(item.snapshot, { stateRoot: this.stateRoot });
    const claimed = this.controlPlane.database.prepare(`UPDATE prepared_checks SET state = 'running', runner_json = ?
      WHERE id = ? AND project_id = ? AND area_id = ? AND state = 'prepared'`)
      .run(JSON.stringify(checkRunnerIdentity()), item.id, this.controlPlane.projectId, area);
    if (claimed.changes !== 1) throw new TorchError('Prepared check was claimed concurrently', {
      code: 'PREPARED_CHECK_UNAVAILABLE',
    });
    const startedAt = this.clock().toISOString();
    const execution = executeConditionedCheck({
      definition: item.definition,
      subject: { commit: item.snapshot.commit, inputDigest: item.snapshot.digest },
      cwd: item.snapshot.inputRoot, executor: this.executor, clock: this.clock,
    });
    const result = execution.result;
    let invalidReason = execution.invalidReason;
    try {
      verifyCheckSnapshot(item.snapshot, { stateRoot: this.stateRoot });
    } catch {
      invalidReason = 'snapshot-changed-during-check';
    }
    if ((item.definition.resources ?? []).some((resourceId) =>
      !this.resourceService?.hasActiveLease({ resourceId, areaId: area }))) {
      invalidReason = 'resource-lease-lost-during-check';
    }
    const finishedAt = this.clock().toISOString();
    const receiptId = this.idFactory();
    const status = invalidReason ? 'incomplete' : result.status === 0 ? 'pass' : 'fail';
    const artifactDirectory = join(this.stateRoot, 'checks', receiptId);
    mkdirSync(artifactDirectory, { recursive: false });
    const artifactPath = join(artifactDirectory, 'output.json');
    const snapshotEvidence = {
      preparedId: item.id, inputDigest: item.snapshot.digest, commit: item.snapshot.commit,
      files: item.snapshot.files, provenance: item.snapshot.provenance,
      copyStrategy: item.snapshot.copyStrategy,
    };
    writeFileSync(artifactPath, `${JSON.stringify({
      stdout: safeOutput(result.stdout), stderr: safeOutput(result.stderr), snapshot: snapshotEvidence,
      conditions: execution.conditions, measurementsExecuted: execution.measurementsExecuted,
    }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    const receipt = {
      id: receiptId, projectId: this.controlPlane.projectId, checkId: item.checkId, areaId: area,
      definition: item.definition, worktree: item.snapshot.sourceWorktree, commit: item.snapshot.commit,
      startedAt, finishedAt, exitStatus: result.status ?? null, result: status,
      artifactPath, invalidReason, snapshot: snapshotEvidence,
      conditions: execution.conditions,
    };
    this.controlPlane.database.prepare(`INSERT INTO check_receipts
      (id, project_id, check_id, definition, definition_hash, area_id, worktree, commit_sha,
       started_at, finished_at, exit_status, result, artifact_path, invalid_reason, conditions_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(receipt.id, receipt.projectId, receipt.checkId, JSON.stringify(receipt.definition),
        definitionHash(receipt.definition), area, receipt.worktree, receipt.commit,
        startedAt, finishedAt, receipt.exitStatus, status, artifactPath, invalidReason,
        execution.conditions ? JSON.stringify(execution.conditions) : null);
    this.controlPlane.database.prepare(`UPDATE prepared_checks SET state = 'finished', receipt_id = ? WHERE id = ?`)
      .run(receiptId, item.id);
    this.controlPlane.audit({
      actorId: area, operation: 'check.run-prepared', entityType: 'check-receipt', entityId: receiptId,
      details: { preparedId: item.id, checkId: item.checkId, commit: receipt.commit, result: status },
    });
    disposeCheckSnapshot(item.snapshot, { stateRoot: this.stateRoot });
    return receipt;
  }

  planPreparedRecovery({ preparedId, actorId } = {}) {
    this.controlPlane.assertOwnerActor(actorId);
    const item = this.prepared().find((candidate) => candidate.id === preparedId);
    if (!item || !['running', 'abandoned'].includes(item.state)) {
      throw new TorchError('Only interrupted or already abandoned checks can be recovered', { code: 'PREPARED_CHECK_RECOVERY_UNAVAILABLE' });
    }
    const runner = observeCheckRunner(item.runner);
    return { schema: 'torch.dev/prepared-check-recovery/v1alpha1', preparedId, state: item.state,
      areaId: item.areaId, checkId: item.checkId, commit: item.snapshot.commit,
      inputDigest: item.snapshot.digest, runner, cleanupPending: existsSync(item.snapshot.root),
      requiresStoppedExecutorEvidence: true, canRecover: runner.state !== 'live',
      receiptCreated: false, resourceReleasePerformed: false, mutationPerformed: false };
  }

  recoverPrepared({ preparedId, actorId, approved = false, executorsStopped = false, evidence } = {}) {
    if (approved !== true) throw new TorchError('Recovery requires explicit owner confirmation', { code: 'APPROVAL_REQUIRED' });
    if (executorsStopped !== true || typeof evidence !== 'string' || !evidence.trim() || evidence.length > 4000) {
      throw new TorchError('Confirm all check executors and descendants stopped with evidence', { code: 'PREPARED_CHECK_STOP_EVIDENCE_REQUIRED' });
    }
    const database = this.controlPlane.database;
    database.exec('BEGIN IMMEDIATE');
    let item;
    let recovery;
    try {
      const plan = this.planPreparedRecovery({ preparedId, actorId });
      if (!plan.canRecover) throw new TorchError('Recorded check runner is still live', { code: 'PREPARED_CHECK_RUNNER_LIVE' });
      item = this.prepared().find((candidate) => candidate.id === preparedId);
      if (item.state === 'running') {
        recovery = { at: this.clock().toISOString(), actorId, evidence: evidence.trim(),
          executorsStopped: true, observedRunner: plan.runner, receiptCreated: false,
          cleanupPending: true, cleanupReason: null };
        database.prepare("UPDATE prepared_checks SET state = 'abandoned', recovery_json = ? WHERE id = ? AND project_id = ? AND state = 'running'")
          .run(JSON.stringify(recovery), preparedId, this.controlPlane.projectId);
        this.controlPlane.auditOwnerAction({ actorId, operation: 'check.recover-prepared',
          entityType: 'prepared-check', entityId: preparedId,
          details: { ...recovery, commit: item.snapshot.commit, inputDigest: item.snapshot.digest } });
      } else recovery = item.recovery;
      database.exec('COMMIT');
    } catch (error) { database.exec('ROLLBACK'); throw error; }
    // The terminal audit is durable before cleanup. A cleanup error leaves only
    // this exact owned snapshot pending; explicit repeat recovery can retry it.
    let cleanupPending = existsSync(item.snapshot.root);
    let cleanupReason = null;
    if (cleanupPending) {
      try { disposeCheckSnapshot(item.snapshot, { stateRoot: this.stateRoot }); cleanupPending = false; }
      catch (error) { cleanupReason = error.code ?? 'CHECK_SNAPSHOT_CLEANUP_FAILED'; }
    }
    const cleanupChanged = recovery?.cleanupPending !== cleanupPending || recovery?.cleanupReason !== cleanupReason;
    if (cleanupChanged) {
      recovery = { ...recovery, cleanupPending, cleanupReason };
      database.prepare("UPDATE prepared_checks SET recovery_json = ? WHERE id = ? AND project_id = ? AND state = 'abandoned'")
        .run(JSON.stringify(recovery), preparedId, this.controlPlane.projectId);
    }
    return { preparedId, state: 'abandoned', recovery, cleanupPending, cleanupReason,
      receiptCreated: false, resourceReleasePerformed: false, executionPerformed: false,
      mutationPerformed: item.state === 'running' || cleanupChanged };
  }

  cancelPrepared({ preparedId, areaId } = {}) {
    const area = this.controlPlane.assertIdentity(areaId);
    const item = this.prepared({ areaId: area }).find((candidate) => candidate.id === preparedId);
    if (!item || item.state !== 'prepared') throw new TorchError('Only unstarted owned checks can be cancelled', {
      code: 'PREPARED_CHECK_UNAVAILABLE',
    });
    const changed = this.controlPlane.database.prepare(`UPDATE prepared_checks SET state = 'cancelled'
      WHERE id = ? AND project_id = ? AND area_id = ? AND state = 'prepared'`)
      .run(item.id, this.controlPlane.projectId, area);
    if (changed.changes !== 1) throw new TorchError('Prepared check was claimed concurrently', { code: 'PREPARED_CHECK_UNAVAILABLE' });
    disposeCheckSnapshot(item.snapshot, { stateRoot: this.stateRoot });
    this.controlPlane.audit({
      actorId: area, operation: 'check.cancel-prepared', entityType: 'prepared-check', entityId: item.id,
      details: { checkId: item.checkId, commit: item.snapshot.commit },
    });
    return { id: item.id, state: 'cancelled', removed: true };
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
      conditions: row.conditions_json ? JSON.parse(row.conditions_json) : null,
    }));
  }

  exactPasses({ commit, requiredChecks }) {
    this.refreshDefinitions();
    const receipts = this.receipts({ commit });
    return requiredChecks.every((checkId) => {
      const definition = this.definitions.get(checkId);
      return Boolean(definition) && receipts.some((receipt) =>
        receipt.checkId === checkId && receipt.result === 'pass'
        && validConditionEvidence({ definition, conditions: receipt.conditions, commit })
        && (!definition.snapshot || this.controlPlane.database.prepare(`SELECT id FROM prepared_checks
          WHERE project_id = ? AND receipt_id = ? AND state = 'finished'`).get(this.controlPlane.projectId, receipt.id))
        && receipt.definitionHash === definitionHash(definition));
    });
  }
}
