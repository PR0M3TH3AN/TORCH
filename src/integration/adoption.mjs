import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { TorchError } from '../kernel/errors.mjs';
import { observeRuntimeTurn } from '../runtime/turn-guard.mjs';

const ADOPTION_SCHEMA = 'torch.dev/integration-adoption/v1alpha1';
const AUTHORITY_SCHEMA = 'torch.dev/integration-adoption-authority/v1alpha1';
const ACTIONS = new Set(['plan', 'prepare', 'finalize', 'reconcile', 'rollback', 'request']);
const MUTATING_ACTIONS = new Set(['prepare', 'finalize', 'rollback', 'request']);
const SHA = /^[0-9a-f]{40,64}$/;
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/;

function git(root, args, { allowFailure = false } = {}) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  if (result.status !== 0 && !allowFailure) {
    throw new TorchError(`Git command failed: git ${args.join(' ')}`, {
      code: 'GIT_COMMAND_FAILED', details: result.stderr?.trim() || null,
    });
  }
  return { status: result.status, stdout: result.stdout?.trim() ?? '', stderr: result.stderr?.trim() ?? '' };
}

function tableExists(database, name) {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function text(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TorchError(`${name} is required`, { code: 'ADOPTION_INPUT_INVALID', details: { name } });
  }
  return value.trim();
}

function sha(value, name) {
  const normalized = text(value, name);
  if (!SHA.test(normalized)) throw new TorchError(`${name} must be a full Git object id`, {
    code: 'ADOPTION_INPUT_INVALID', details: { name },
  });
  return normalized;
}

function durableRecord(event) {
  if (!event?.details) return null;
  try {
    const record = JSON.parse(event.details);
    return record?.schema === ADOPTION_SCHEMA ? record : null;
  } catch { return null; }
}

function listWorktreePaths(root) {
  const records = [];
  for (const line of git(root, ['worktree', 'list', '--porcelain']).stdout.split('\n')) {
    if (line.startsWith('worktree ')) records.push(line.slice('worktree '.length));
  }
  return records;
}

function authorityFrom(approval) {
  if (!approval || approval.status !== 'approved' || approval.approver_id !== 'owner' || approval.decided_by !== 'owner') return null;
  try {
    const authority = JSON.parse(approval.decision_note ?? '');
    return authority?.schema === AUTHORITY_SCHEMA ? authority : null;
  } catch { return null; }
}

function exactAuthority(authority, binding) {
  if (!authority || authority.action !== binding.action) return false;
  const fields = ['adoptionId', 'candidateSha', 'baseTargetSha', 'provenanceManifestDigest',
    'contributorArea', 'destinationArea', 'targetBranch', 'candidateRef', 'expectedOldRef'];
  return fields.every((field) => authority[field] === binding[field])
    && authority.fixture?.id === binding.fixture?.id
    && authority.fixture?.adapter === binding.fixture?.adapter;
}

function adapterReceipt(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/**
 * Adoption is source-only. Ref-changing methods can only call an injected
 * hermetic fixture adapter; the normal service has none. Approval is an exact,
 * revision-bound JSON decision recorded by the existing approval service.
 */
export class AdoptionService {
  constructor({ repositoryRoot, controlPlane, clock = () => new Date(), idFactory = randomUUID, policy, fixtureAdapter = null } = {}) {
    this.repositoryRoot = repositoryRoot;
    this.controlPlane = controlPlane;
    this.clock = clock;
    this.idFactory = idFactory;
    this.policy = policy ?? {};
    this.fixtureAdapter = fixtureAdapter;
  }

  plan({ action = 'plan', actorId, approvalId, approvalRevision, adoptionId,
    candidateSha, baseTargetSha, provenance, provenanceManifestDigest, contributorArea,
    destinationArea, targetBranch, candidateRef, expectedOldRef, fixture } = {}) {
    const blockers = [];
    const id = adoptionId ? text(adoptionId, 'adoptionId') : null;
    if (id && !SAFE_ID.test(id)) blockers.push({ code: 'ADOPTION_ID_INVALID' });
    if (!ACTIONS.has(action)) blockers.push({ code: 'ADOPTION_ACTION_INVALID' });
    if (actorId !== 'owner') blockers.push({ code: 'OWNER_ACTOR_REQUIRED' });
    if (!Number.isInteger(approvalRevision) || approvalRevision < 1) blockers.push({ code: 'ADOPTION_APPROVAL_REVISION_REQUIRED' });

    let candidate; let base; let provenanceDigest;
    try {
      candidate = sha(candidateSha, 'candidateSha');
      base = sha(baseTargetSha, 'baseTargetSha');
      if (!Array.isArray(provenance) || !provenance.length || provenance.some((entry) => typeof entry !== 'string' || !entry)) {
        throw new TorchError('provenance must be a non-empty ordered string list', { code: 'ADOPTION_INPUT_INVALID' });
      }
      provenanceDigest = createHash('sha256').update(JSON.stringify(provenance)).digest('hex');
      if (sha(provenanceManifestDigest, 'provenanceManifestDigest') !== provenanceDigest) {
        blockers.push({ code: 'ADOPTION_PROVENANCE_DIGEST_MISMATCH', expected: provenanceDigest });
      }
    } catch (error) {
      blockers.push({ code: error.code ?? 'ADOPTION_INPUT_INVALID', details: error.details ?? null });
    }

    const target = targetBranch ?? this.policy.target;
    if (typeof target !== 'string' || !target.trim()) blockers.push({ code: 'ADOPTION_TARGET_REQUIRED' });
    const candidateReference = candidateRef ?? (id ? `refs/torch/integration-candidates/${id}` : null);
    const expectedReference = expectedOldRef ?? (target ? `refs/heads/${target}` : null);
    if (!candidateReference || !/^refs\/torch\/integration-candidates\/[A-Za-z0-9._-]+$/.test(candidateReference)) {
      blockers.push({ code: 'ADOPTION_CANDIDATE_REF_INVALID' });
    }
    if (!expectedReference || !/^refs\/heads\/[A-Za-z0-9._/-]+$/.test(expectedReference)) {
      blockers.push({ code: 'ADOPTION_EXPECTED_REF_INVALID' });
    }
    const normalizedFixture = fixture?.id && fixture?.adapter ? { id: fixture.id, adapter: fixture.adapter } : null;
    if (MUTATING_ACTIONS.has(action) && !normalizedFixture) blockers.push({ code: 'ADOPTION_HERMETIC_FIXTURE_REQUIRED' });

    let contributor; let destination;
    try { contributor = this.controlPlane.assertIdentity(text(contributorArea, 'contributorArea')); }
    catch (error) { blockers.push({ code: 'ADOPTION_CONTRIBUTOR_INVALID', details: error.code ?? null }); }
    try { destination = this.controlPlane.assertIdentity(text(destinationArea, 'destinationArea')); }
    catch (error) { blockers.push({ code: 'ADOPTION_DESTINATION_INVALID', details: error.code ?? null }); }
    if (contributor && destination && contributor === destination) blockers.push({ code: 'ADOPTION_IDENTITIES_MUST_DIFFER' });

    const approval = approvalId ? this.controlPlane.database.prepare(`SELECT * FROM approval_requests
      WHERE id = ? AND project_id = ?`).get(approvalId, this.controlPlane.projectId) : null;
    const binding = { action, adoptionId: id, candidateSha: candidate, baseTargetSha: base,
      provenanceManifestDigest: provenanceDigest, contributorArea: contributor, destinationArea: destination,
      targetBranch: target, candidateRef: candidateReference, expectedOldRef: expectedReference, fixture: normalizedFixture };
    if (!approval) blockers.push({ code: 'ADOPTION_APPROVAL_MISSING' });
    else if (approval.revision !== approvalRevision) blockers.push({ code: 'ADOPTION_APPROVAL_REVISION_STALE', actual: approval.revision });
    else if (!exactAuthority(authorityFrom(approval), binding)) blockers.push({ code: 'ADOPTION_APPROVAL_BINDING_INVALID' });

    if (candidate && git(this.repositoryRoot, ['cat-file', '-e', `${candidate}^{commit}`], { allowFailure: true }).status !== 0) blockers.push({ code: 'ADOPTION_CANDIDATE_MISSING' });
    if (base && git(this.repositoryRoot, ['cat-file', '-e', `${base}^{commit}`], { allowFailure: true }).status !== 0) blockers.push({ code: 'ADOPTION_BASE_MISSING' });
    if (candidate && base && git(this.repositoryRoot, ['merge-base', '--is-ancestor', base, candidate], { allowFailure: true }).status !== 0) blockers.push({ code: 'ADOPTION_CANDIDATE_NOT_DESCENDED_FROM_BASE' });
    const fixtureRefs = normalizedFixture && this.fixtureAdapter
      && this.fixtureAdapter.id === normalizedFixture.id && this.fixtureAdapter.name === normalizedFixture.adapter;
    if (expectedReference && base) {
      const current = fixtureRefs
        ? { status: 0, stdout: this.fixtureAdapter.readRefs([expectedReference])[expectedReference] ?? '' }
        : git(this.repositoryRoot, ['rev-parse', expectedReference], { allowFailure: true });
      if (current.status !== 0) blockers.push({ code: 'ADOPTION_EXPECTED_REF_MISSING' });
      else if (current.stdout !== base) blockers.push({ code: 'ADOPTION_EXPECTED_REF_STALE', expected: base, actual: current.stdout });
    }
    const candidateExists = candidateReference && (fixtureRefs
      ? this.fixtureAdapter.readRefs([candidateReference])[candidateReference] != null
      : git(this.repositoryRoot, ['show-ref', '--verify', '--quiet', candidateReference], { allowFailure: true }).status === 0);
    if (['plan', 'prepare', 'finalize'].includes(action) && candidateExists) blockers.push({ code: 'ADOPTION_CANDIDATE_REF_ALREADY_EXISTS' });
    if (['reconcile', 'rollback', 'request'].includes(action) && !candidateExists) blockers.push({ code: 'ADOPTION_CANDIDATE_REF_MISSING' });

    for (const worktree of listWorktreePaths(this.repositoryRoot)) {
      const entries = git(worktree, ['status', '--porcelain=v1', '--untracked-files=all']).stdout.split('\n').filter(Boolean);
      if (entries.length) blockers.push({ code: 'ADOPTION_WORKTREE_DIRTY', worktree, entries });
    }
    if (tableExists(this.controlPlane.database, 'worktree_guards')) {
      for (const guard of this.controlPlane.database.prepare(`SELECT area_id, guard_type, reason FROM worktree_guards
        WHERE project_id = ? AND released_at IS NULL`).all(this.controlPlane.projectId)) blockers.push({ code: 'ADOPTION_WORKTREE_GUARD_ACTIVE', guard });
    }
    if (tableExists(this.controlPlane.database, 'resource_leases')) {
      for (const lease of this.controlPlane.database.prepare(`SELECT id, resource_id, area_id FROM resource_leases WHERE released_at IS NULL`).all()) blockers.push({ code: 'ADOPTION_RESOURCE_LEASE_ACTIVE', lease });
    }
    if (tableExists(this.controlPlane.database, 'prepared_checks')) {
      for (const check of this.controlPlane.database.prepare(`SELECT id, area_id, state FROM prepared_checks
        WHERE project_id = ? AND state IN ('prepared', 'running')`).all(this.controlPlane.projectId)) blockers.push({ code: 'ADOPTION_PREPARED_CHECK_ACTIVE', check });
    }
    for (const area of [contributor, destination].filter(Boolean)) {
      const executor = observeRuntimeTurn({ stateRoot: this.controlPlane.stateRoot, repositoryRoot: this.repositoryRoot,
        projectId: this.controlPlane.projectId, areaId: area, now: this.clock });
      if (executor.state !== 'inactive') blockers.push({ code: 'ADOPTION_EXECUTOR_NOT_INACTIVE', areaId: area, executor });
    }
    return { action: `plan-adoption-${action}`, adoptionId: id, approval: approval ? { id: approval.id, revision: approval.revision, status: approval.status, approver: approval.approver_id } : null,
      authority: binding, candidateSha: candidate ?? null, baseTargetSha: base ?? null, provenanceManifestDigest: provenanceDigest ?? null,
      contributorArea: contributor ?? null, destinationArea: destination ?? null, targetBranch: target ?? null,
      candidateRef: candidateReference, expectedOldRef: expectedReference, blockers, canProceed: blockers.length === 0, mutationPerformed: false };
  }

  #record(adoptionId, record, operation) {
    const now = this.clock().toISOString();
    this.controlPlane.database.exec('BEGIN IMMEDIATE');
    try {
      this.controlPlane.database.prepare(`INSERT INTO audit_events
        (id, project_id, actor_id, operation, entity_type, entity_id, details, created_at)
        VALUES (?, ?, 'owner', ?, 'integration-adoption', ?, ?, ?)`)
        .run(this.idFactory(), this.controlPlane.projectId, operation, adoptionId, JSON.stringify(record), now);
      this.controlPlane.database.exec('COMMIT');
    } catch (error) { this.controlPlane.database.exec('ROLLBACK'); throw error; }
  }

  #fixture(input) {
    if (!this.fixtureAdapter || input.fixture?.adapter !== this.fixtureAdapter.name || input.fixture?.id !== this.fixtureAdapter.id) {
      throw new TorchError('Adoption mutation is available only through its named hermetic fixture adapter', {
        code: 'ADOPTION_HERMETIC_ADAPTER_REQUIRED', details: { fixture: input.fixture ?? null },
      });
    }
    return this.fixtureAdapter;
  }

  prepare(input = {}) {
    const adoptionId = input.adoptionId ?? this.idFactory();
    const plan = this.plan({ ...input, action: 'prepare', adoptionId });
    if (!plan.canProceed) throw new TorchError('Adoption inputs are not eligible for preparation', { code: 'ADOPTION_PREPARE_BLOCKED', details: plan.blockers });
    this.#fixture(input);
    if (this.#find(adoptionId)) throw new TorchError('Adoption id is already journaled; reconcile its immutable record instead.', { code: 'ADOPTION_ALREADY_EXISTS', details: { adoptionId } });
    const now = this.clock().toISOString();
    const record = { schema: ADOPTION_SCHEMA, id: adoptionId, revision: 1, state: 'prepared', approvalId: text(input.approvalId, 'approvalId'),
      approvalRevision: input.approvalRevision, authority: plan.authority, provenance: [...input.provenance], candidateSha: plan.candidateSha, baseTargetSha: plan.baseTargetSha,
      provenanceManifestDigest: plan.provenanceManifestDigest, candidateRef: plan.candidateRef, expectedOldRef: plan.expectedOldRef,
      contributorArea: plan.contributorArea, destinationArea: plan.destinationArea, targetBranch: plan.targetBranch,
      archiveRef: `refs/torch/integration-archives/${adoptionId}`, preparedAt: now, finalizedAt: null, rolledBackAt: null };
    this.#record(adoptionId, record, 'integration.adoption.prepare');
    return { ...record, mutationPerformed: true };
  }

  finalize(input = {}) {
    const record = this.getPrepared(text(input.adoptionId, 'adoptionId'));
    if (record.state !== 'prepared') throw new TorchError('Only a prepared adoption can be finalized', { code: 'ADOPTION_FINALIZE_STATE_INVALID', details: { state: record.state } });
    const plan = this.plan({ ...record, ...input, action: 'finalize' });
    if (!plan.canProceed) throw new TorchError('Adoption finalize is blocked', { code: 'ADOPTION_FINALIZE_BLOCKED', details: plan.blockers });
    const adapter = this.#fixture(input);
    const receipt = adapter.compareAndSwapRefs({ expected: [{ ref: record.expectedOldRef, sha: record.baseTargetSha }, { ref: record.candidateRef, sha: null }, { ref: record.archiveRef, sha: null }],
      writes: [{ ref: record.archiveRef, sha: record.baseTargetSha }, { ref: record.candidateRef, sha: record.candidateSha }] });
    const finalized = { ...record, revision: record.revision + 1, state: 'finalized', finalizeApprovalId: text(input.approvalId, 'approvalId'),
      finalizeApprovalRevision: input.approvalRevision, finalizedAt: this.clock().toISOString(), fixtureReceiptDigest: adapterReceipt(receipt) };
    this.#record(record.id, finalized, 'integration.adoption.finalize');
    return { ...finalized, mutationPerformed: true };
  }

  reconcile(input = {}) {
    const record = this.getPrepared(text(input.adoptionId, 'adoptionId'));
    const plan = this.plan({ ...record, ...input, action: 'reconcile' });
    if (!plan.canProceed) return { record, plan, state: 'blocked', mutationPerformed: false };
    const adapter = this.#fixture(input);
    const refs = adapter.readRefs([record.expectedOldRef, record.candidateRef, record.archiveRef]);
    const consistent = refs[record.expectedOldRef] === record.baseTargetSha && refs[record.candidateRef] === record.candidateSha && refs[record.archiveRef] === record.baseTargetSha;
    return { record, refs, state: consistent ? 'consistent' : 'diverged', mutationPerformed: false };
  }

  rollback(input = {}) {
    const record = this.getPrepared(text(input.adoptionId, 'adoptionId'));
    if (record.state !== 'finalized') throw new TorchError('Only a finalized adoption can be rolled back', { code: 'ADOPTION_ROLLBACK_STATE_INVALID', details: { state: record.state } });
    const plan = this.plan({ ...record, ...input, action: 'rollback' });
    if (!plan.canProceed) throw new TorchError('Adoption rollback is blocked', { code: 'ADOPTION_ROLLBACK_BLOCKED', details: plan.blockers });
    const receipt = this.#fixture(input).compareAndSwapRefs({ expected: [{ ref: record.candidateRef, sha: record.candidateSha }], writes: [{ ref: record.candidateRef, sha: null }] });
    const rolledBack = { ...record, revision: record.revision + 1, state: 'rolled-back', rollbackApprovalId: text(input.approvalId, 'approvalId'),
      rollbackApprovalRevision: input.approvalRevision, rolledBackAt: this.clock().toISOString(), rollbackReceiptDigest: adapterReceipt(receipt) };
    this.#record(record.id, rolledBack, 'integration.adoption.rollback');
    return { ...rolledBack, mutationPerformed: true };
  }

  requestAdoptedCandidate(input = {}, { requestIntegration } = {}) {
    const record = this.getPrepared(text(input.adoptionId, 'adoptionId'));
    if (record.state !== 'finalized') throw new TorchError('Only a finalized adoption can request native qualification', { code: 'ADOPTION_REQUEST_STATE_INVALID', details: { state: record.state } });
    const plan = this.plan({ ...record, ...input, action: 'request' });
    if (!plan.canProceed) throw new TorchError('Adopted candidate request is blocked', { code: 'ADOPTION_REQUEST_BLOCKED', details: plan.blockers });
    this.#fixture(input);
    if (typeof requestIntegration !== 'function') throw new TorchError('Native integration request adapter is unavailable', { code: 'ADOPTION_NATIVE_REQUEST_UNAVAILABLE' });
    const request = requestIntegration({ areaId: record.contributorArea, commit: record.candidateSha });
    const requested = { ...record, revision: record.revision + 1, state: 'requested', requestApprovalId: text(input.approvalId, 'approvalId'),
      requestApprovalRevision: input.approvalRevision, integrationRequestId: request.id, requestedAt: this.clock().toISOString() };
    this.#record(record.id, requested, 'integration.adoption.request');
    return { ...requested, integrationRequest: request, mutationPerformed: true };
  }

  #find(adoptionId) {
    const row = this.controlPlane.database.prepare(`SELECT details FROM audit_events WHERE project_id = ?
      AND entity_type = 'integration-adoption' AND entity_id = ? ORDER BY rowid DESC LIMIT 1`).get(this.controlPlane.projectId, adoptionId);
    return durableRecord(row);
  }

  getPrepared(adoptionId) {
    const id = text(adoptionId, 'adoptionId');
    const record = this.#find(id);
    if (!record) throw new TorchError('Unknown adoption journal record', { code: 'ADOPTION_NOT_FOUND', details: { adoptionId: id } });
    return record;
  }
}
