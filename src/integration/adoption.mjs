import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { TorchError } from '../kernel/errors.mjs';
import { observeRuntimeTurn } from '../runtime/turn-guard.mjs';

const ADOPTION_SCHEMA = 'torch.dev/integration-adoption/v1alpha1';
const AUTHORITY_SCHEMA = 'torch.dev/integration-adoption-authority/v1alpha1';
const ADAPTER_NAME = 'git-private-ref-cas-v1';
const ACTIONS = new Set(['plan', 'prepare', 'finalize', 'reconcile', 'rollback', 'request']);
const MUTATING_ACTIONS = new Set(['prepare', 'finalize', 'rollback', 'request']);
const SHA = /^[0-9a-f]{40,64}$/;
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/;
const ZERO_SHA = '0'.repeat(40);

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

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
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
    && authority.adapter?.name === binding.adapter?.name
    && authority.adapter?.id === binding.adapter?.id;
}

function exactInput(record, input) {
  const fields = ['adoptionId', 'candidateSha', 'baseTargetSha', 'provenanceManifestDigest',
    'contributorArea', 'destinationArea', 'targetBranch', 'candidateRef', 'expectedOldRef'];
  const mismatches = fields.filter((field) => input[field] !== undefined
    && input[field] !== (field === 'adoptionId' ? record.id : record[field]));
  if (input.provenance !== undefined && JSON.stringify(input.provenance) !== JSON.stringify(record.provenance)) mismatches.push('provenance');
  if (mismatches.length) throw new TorchError('Lifecycle input cannot override immutable prepared adoption fields', {
    code: 'ADOPTION_IMMUTABLE_BINDING_STALE', details: { adoptionId: record.id, fields: mismatches },
  });
}

/**
 * Real Git private-ref transaction adapter. It is source code only: callers
 * decide when it is invoked, while the adapter itself gives temp-repository
 * scenarios the same atomic update-ref semantics as a real repository.
 */
export class GitPrivateRefAdapter {
  constructor({ repositoryRoot } = {}) {
    this.repositoryRoot = resolve(text(repositoryRoot, 'repositoryRoot'));
    this.name = ADAPTER_NAME;
    this.id = digest({ adapter: this.name, repositoryRoot: this.repositoryRoot });
  }

  readRefs(refs) {
    const values = {};
    for (const ref of refs) {
      const result = git(this.repositoryRoot, ['rev-parse', '--verify', '--quiet', ref], { allowFailure: true });
      values[ref] = result.status === 0 ? result.stdout : null;
    }
    return values;
  }

  compareAndSwapRefs({ expected = [], writes = [] } = {}) {
    const commands = ['start'];
    const writtenRefs = new Set(writes.map((entry) => entry.ref));
    for (const { ref, sha: expectedSha } of expected) {
      if (writtenRefs.has(ref)) continue;
      commands.push(`verify ${text(ref, 'ref')} ${expectedSha ?? ZERO_SHA}`);
    }
    for (const { ref, sha: nextSha } of writes) {
      const expectedEntry = expected.find((entry) => entry.ref === ref);
      if (!expectedEntry) throw new TorchError('Every private-ref write requires an exact expected value', {
        code: 'ADOPTION_REF_CAS_EXPECTED_REQUIRED', details: { ref },
      });
      const current = expectedEntry.sha ?? null;
      if (nextSha === null) commands.push(`delete ${text(ref, 'ref')} ${current ?? ZERO_SHA}`);
      else commands.push(`update ${text(ref, 'ref')} ${sha(nextSha, 'next ref sha')} ${current ?? ZERO_SHA}`);
    }
    commands.push('prepare', 'commit', '');
    const result = spawnSync('git', ['-C', this.repositoryRoot, 'update-ref', '--stdin'], {
      input: commands.join('\n'), encoding: 'utf8',
    });
    if (result.status !== 0) throw new TorchError('Private ref compare-and-swap refused', {
      code: 'ADOPTION_REF_CAS_FAILED', details: result.stderr?.trim() || null,
    });
    return { adapter: { name: this.name, id: this.id }, expected, writes };
  }
}

export class AdoptionService {
  constructor({ repositoryRoot, controlPlane, clock = () => new Date(), idFactory = randomUUID, policy, refAdapter } = {}) {
    this.repositoryRoot = repositoryRoot;
    this.controlPlane = controlPlane;
    this.clock = clock;
    this.idFactory = idFactory;
    this.policy = policy ?? {};
    this.refAdapter = refAdapter ?? new GitPrivateRefAdapter({ repositoryRoot });
  }

  plan({ action = 'plan', actorId, approvalId, approvalRevision, adoptionId,
    candidateSha, baseTargetSha, provenance, provenanceManifestDigest, contributorArea,
    destinationArea, targetBranch, candidateRef, expectedOldRef, adapter } = {}) {
    const blockers = [];
    const id = adoptionId ? text(adoptionId, 'adoptionId') : null;
    if (id && !SAFE_ID.test(id)) blockers.push({ code: 'ADOPTION_ID_INVALID' });
    if (!ACTIONS.has(action)) blockers.push({ code: 'ADOPTION_ACTION_INVALID' });
    if (actorId !== 'owner') blockers.push({ code: 'OWNER_ACTOR_REQUIRED' });
    if (!Number.isInteger(approvalRevision) || approvalRevision < 1) blockers.push({ code: 'ADOPTION_APPROVAL_REVISION_REQUIRED' });
    const adapterBinding = adapter?.name && adapter?.id ? { name: adapter.name, id: adapter.id } : null;
    if (MUTATING_ACTIONS.has(action) && !adapterBinding) blockers.push({ code: 'ADOPTION_ADAPTER_BINDING_REQUIRED' });
    if (adapterBinding && (adapterBinding.name !== this.refAdapter.name || adapterBinding.id !== this.refAdapter.id)) {
      blockers.push({ code: 'ADOPTION_ADAPTER_PROVENANCE_INVALID' });
    }

    let candidate; let base; let provenanceDigest;
    try {
      candidate = sha(candidateSha, 'candidateSha');
      base = sha(baseTargetSha, 'baseTargetSha');
      if (!Array.isArray(provenance) || !provenance.length || provenance.some((entry) => typeof entry !== 'string' || !entry)) {
        throw new TorchError('provenance must be a non-empty ordered string list', { code: 'ADOPTION_INPUT_INVALID' });
      }
      provenanceDigest = digest(provenance);
      if (sha(provenanceManifestDigest, 'provenanceManifestDigest') !== provenanceDigest) blockers.push({ code: 'ADOPTION_PROVENANCE_DIGEST_MISMATCH', expected: provenanceDigest });
    } catch (error) {
      blockers.push({ code: error.code ?? 'ADOPTION_INPUT_INVALID', details: error.details ?? null });
    }

    const target = targetBranch ?? this.policy.target;
    if (typeof target !== 'string' || !target.trim()) blockers.push({ code: 'ADOPTION_TARGET_REQUIRED' });
    const candidateReference = candidateRef ?? (id ? `refs/torch/integration-candidates/${id}` : null);
    const expectedReference = expectedOldRef ?? (target ? `refs/heads/${target}` : null);
    if (!candidateReference || !/^refs\/torch\/integration-candidates\/[A-Za-z0-9._-]+$/.test(candidateReference)) blockers.push({ code: 'ADOPTION_CANDIDATE_REF_INVALID' });
    if (!expectedReference || !/^refs\/heads\/[A-Za-z0-9._/-]+$/.test(expectedReference)) blockers.push({ code: 'ADOPTION_EXPECTED_REF_INVALID' });

    let contributor; let destination;
    try { contributor = this.controlPlane.assertIdentity(text(contributorArea, 'contributorArea')); }
    catch (error) { blockers.push({ code: 'ADOPTION_CONTRIBUTOR_INVALID', details: error.code ?? null }); }
    try { destination = this.controlPlane.assertIdentity(text(destinationArea, 'destinationArea')); }
    catch (error) { blockers.push({ code: 'ADOPTION_DESTINATION_INVALID', details: error.code ?? null }); }
    if (contributor && destination && contributor === destination) blockers.push({ code: 'ADOPTION_IDENTITIES_MUST_DIFFER' });

    const binding = { action, adoptionId: id, candidateSha: candidate, baseTargetSha: base, provenanceManifestDigest: provenanceDigest,
      contributorArea: contributor, destinationArea: destination, targetBranch: target, candidateRef: candidateReference,
      expectedOldRef: expectedReference, adapter: adapterBinding };
    const approval = approvalId ? this.controlPlane.database.prepare(`SELECT * FROM approval_requests WHERE id = ? AND project_id = ?`)
      .get(approvalId, this.controlPlane.projectId) : null;
    if (!approval) blockers.push({ code: 'ADOPTION_APPROVAL_MISSING' });
    else if (approval.revision !== approvalRevision) blockers.push({ code: 'ADOPTION_APPROVAL_REVISION_STALE', actual: approval.revision });
    else if (!exactAuthority(authorityFrom(approval), binding)) blockers.push({ code: 'ADOPTION_APPROVAL_BINDING_INVALID' });

    if (candidate && git(this.repositoryRoot, ['cat-file', '-e', `${candidate}^{commit}`], { allowFailure: true }).status !== 0) blockers.push({ code: 'ADOPTION_CANDIDATE_MISSING' });
    if (base && git(this.repositoryRoot, ['cat-file', '-e', `${base}^{commit}`], { allowFailure: true }).status !== 0) blockers.push({ code: 'ADOPTION_BASE_MISSING' });
    if (candidate && base && git(this.repositoryRoot, ['merge-base', '--is-ancestor', base, candidate], { allowFailure: true }).status !== 0) blockers.push({ code: 'ADOPTION_CANDIDATE_NOT_DESCENDED_FROM_BASE' });
    if (expectedReference && base) {
      const current = this.refAdapter.readRefs([expectedReference])[expectedReference];
      if (!current) blockers.push({ code: 'ADOPTION_EXPECTED_REF_MISSING' });
      else if (current !== base) blockers.push({ code: 'ADOPTION_EXPECTED_REF_STALE', expected: base, actual: current });
    }
    const candidateExists = candidateReference && this.refAdapter.readRefs([candidateReference])[candidateReference] != null;
    if (['plan', 'prepare', 'finalize'].includes(action) && candidateExists) blockers.push({ code: 'ADOPTION_CANDIDATE_REF_ALREADY_EXISTS' });
    if (action === 'request' && !candidateExists) blockers.push({ code: 'ADOPTION_CANDIDATE_REF_MISSING' });

    for (const worktree of listWorktreePaths(this.repositoryRoot)) {
      const entries = git(worktree, ['status', '--porcelain=v1', '--untracked-files=all']).stdout.split('\n').filter(Boolean);
      if (entries.length) blockers.push({ code: 'ADOPTION_WORKTREE_DIRTY', worktree, entries });
    }
    if (tableExists(this.controlPlane.database, 'worktree_guards')) {
      for (const guard of this.controlPlane.database.prepare(`SELECT area_id, guard_type, reason FROM worktree_guards WHERE project_id = ? AND released_at IS NULL`).all(this.controlPlane.projectId)) blockers.push({ code: 'ADOPTION_WORKTREE_GUARD_ACTIVE', guard });
    }
    if (tableExists(this.controlPlane.database, 'resource_leases')) {
      for (const lease of this.controlPlane.database.prepare(`SELECT id, resource_id, area_id FROM resource_leases WHERE released_at IS NULL`).all()) blockers.push({ code: 'ADOPTION_RESOURCE_LEASE_ACTIVE', lease });
    }
    if (tableExists(this.controlPlane.database, 'prepared_checks')) {
      for (const check of this.controlPlane.database.prepare(`SELECT id, area_id, state FROM prepared_checks WHERE project_id = ? AND state IN ('prepared', 'running')`).all(this.controlPlane.projectId)) blockers.push({ code: 'ADOPTION_PREPARED_CHECK_ACTIVE', check });
    }
    for (const area of [contributor, destination].filter(Boolean)) {
      const executor = observeRuntimeTurn({ stateRoot: this.controlPlane.stateRoot, repositoryRoot: this.repositoryRoot,
        projectId: this.controlPlane.projectId, areaId: area, now: this.clock });
      if (executor.state !== 'inactive') blockers.push({ code: 'ADOPTION_EXECUTOR_NOT_INACTIVE', areaId: area, executor });
    }
    return { action: `plan-adoption-${action}`, adoptionId: id, approval: approval ? { id: approval.id, revision: approval.revision, status: approval.status, approver: approval.approver_id } : null,
      authority: binding, candidateSha: candidate ?? null, baseTargetSha: base ?? null, provenanceManifestDigest: provenanceDigest ?? null,
      contributorArea: contributor ?? null, destinationArea: destination ?? null, targetBranch: target ?? null, candidateRef: candidateReference,
      expectedOldRef: expectedReference, blockers, canProceed: blockers.length === 0, mutationPerformed: false };
  }

  #append(adoptionId, expectedRevision, record, operation) {
    this.controlPlane.database.exec('BEGIN IMMEDIATE');
    try {
      this.#appendInTransaction(adoptionId, expectedRevision, record, operation);
      this.controlPlane.database.exec('COMMIT');
    } catch (error) { this.controlPlane.database.exec('ROLLBACK'); throw error; }
  }

  #appendInTransaction(adoptionId, expectedRevision, record, operation) {
    const current = this.#find(adoptionId);
    if (expectedRevision === null ? current : !current || current.revision !== expectedRevision) {
      throw new TorchError('Adoption journal changed before this transition could be recorded', {
        code: 'ADOPTION_RECORD_REVISION_STALE', details: { adoptionId, expectedRevision, actual: current?.revision ?? null },
      });
    }
    this.controlPlane.database.prepare(`INSERT INTO audit_events
      (id, project_id, actor_id, operation, entity_type, entity_id, details, created_at)
      VALUES (?, ?, 'owner', ?, 'integration-adoption', ?, ?, ?)`)
      .run(this.idFactory(), this.controlPlane.projectId, operation, adoptionId, JSON.stringify(record), this.clock().toISOString());
  }

  #fromRecord(record, input, action) {
    exactInput(record, input);
    return this.plan({ action, actorId: input.actorId, approvalId: input.approvalId, approvalRevision: input.approvalRevision,
      adoptionId: record.id, candidateSha: record.candidateSha, baseTargetSha: record.baseTargetSha, provenance: record.provenance,
      provenanceManifestDigest: record.provenanceManifestDigest, contributorArea: record.contributorArea, destinationArea: record.destinationArea,
      targetBranch: record.targetBranch, candidateRef: record.candidateRef, expectedOldRef: record.expectedOldRef, adapter: input.adapter });
  }

  prepare(input = {}) {
    const adoptionId = input.adoptionId ?? this.idFactory();
    const plan = this.plan({ ...input, action: 'prepare', adoptionId });
    if (!plan.canProceed) throw new TorchError('Adoption inputs are not eligible for preparation', { code: 'ADOPTION_PREPARE_BLOCKED', details: plan.blockers });
    const now = this.clock().toISOString();
    const record = { schema: ADOPTION_SCHEMA, id: adoptionId, revision: 1, state: 'prepared', approvalId: text(input.approvalId, 'approvalId'),
      approvalRevision: input.approvalRevision, authority: plan.authority, provenance: [...input.provenance], candidateSha: plan.candidateSha,
      baseTargetSha: plan.baseTargetSha, provenanceManifestDigest: plan.provenanceManifestDigest, candidateRef: plan.candidateRef,
      expectedOldRef: plan.expectedOldRef, contributorArea: plan.contributorArea, destinationArea: plan.destinationArea, targetBranch: plan.targetBranch,
      archiveRef: `refs/torch/integration-archives/${adoptionId}`, preparedAt: now, finalizedAt: null, rolledBackAt: null };
    this.#append(adoptionId, null, record, 'integration.adoption.prepare');
    return { ...record, mutationPerformed: true };
  }

  finalize(input = {}) {
    const record = this.getPrepared(text(input.adoptionId, 'adoptionId'));
    if (record.state !== 'prepared') throw new TorchError('Only a prepared adoption can be finalized', { code: 'ADOPTION_FINALIZE_STATE_INVALID', details: { state: record.state } });
    const plan = this.#fromRecord(record, input, 'finalize');
    if (!plan.canProceed) throw new TorchError('Adoption finalize is blocked', { code: 'ADOPTION_FINALIZE_BLOCKED', details: plan.blockers });
    const receipt = this.refAdapter.compareAndSwapRefs({ expected: [{ ref: record.expectedOldRef, sha: record.baseTargetSha }, { ref: record.candidateRef, sha: null }, { ref: record.archiveRef, sha: null }],
      writes: [{ ref: record.archiveRef, sha: record.baseTargetSha }, { ref: record.candidateRef, sha: record.candidateSha }] });
    const finalized = { ...record, revision: record.revision + 1, state: 'finalized', finalizeApprovalId: text(input.approvalId, 'approvalId'),
      finalizeApprovalRevision: input.approvalRevision, finalizedAt: this.clock().toISOString(), refReceiptDigest: digest(receipt) };
    this.#append(record.id, record.revision, finalized, 'integration.adoption.finalize');
    return { ...finalized, mutationPerformed: true };
  }

  reconcile(input = {}) {
    const record = this.getPrepared(text(input.adoptionId, 'adoptionId'));
    const plan = this.#fromRecord(record, input, 'reconcile');
    if (!plan.canProceed) return { record, plan, state: 'blocked', mutationPerformed: false };
    const refs = this.refAdapter.readRefs([record.expectedOldRef, record.candidateRef, record.archiveRef]);
    const finalizedRefs = refs[record.expectedOldRef] === record.baseTargetSha && refs[record.candidateRef] === record.candidateSha && refs[record.archiveRef] === record.baseTargetSha;
    if (record.state === 'prepared' && finalizedRefs) {
      const recovered = { ...record, revision: record.revision + 1, state: 'finalized', finalizedAt: this.clock().toISOString(),
        recoveredAt: this.clock().toISOString(), recovery: 'private-ref-cas-completed-before-journal' };
      this.#append(record.id, record.revision, recovered, 'integration.adoption.reconcile-finalized');
      return { record: recovered, refs, state: 'recovered-finalized', mutationPerformed: true };
    }
    if (record.state === 'finalized' && finalizedRefs) return { record, refs, state: 'consistent', mutationPerformed: false };
    if (record.state === 'prepared' && refs[record.candidateRef] === null && refs[record.archiveRef] === null) return { record, refs, state: 'prepared', mutationPerformed: false };
    return { record, refs, state: 'diverged', mutationPerformed: false };
  }

  rollback(input = {}) {
    const record = this.getPrepared(text(input.adoptionId, 'adoptionId'));
    if (record.state !== 'finalized') throw new TorchError('Only a finalized adoption can be rolled back', { code: 'ADOPTION_ROLLBACK_STATE_INVALID', details: { state: record.state } });
    const plan = this.#fromRecord(record, input, 'rollback');
    if (!plan.canProceed) throw new TorchError('Adoption rollback is blocked', { code: 'ADOPTION_ROLLBACK_BLOCKED', details: plan.blockers });
    const refs = this.refAdapter.readRefs([record.expectedOldRef, record.candidateRef, record.archiveRef]);
    const recovered = refs[record.expectedOldRef] === record.baseTargetSha
      && refs[record.candidateRef] === null && refs[record.archiveRef] === record.baseTargetSha;
    if (!recovered && refs[record.candidateRef] !== record.candidateSha) {
      throw new TorchError('Candidate ref changed before rollback', { code: 'ADOPTION_ROLLBACK_REF_DIVERGED', details: refs });
    }
    const receipt = recovered ? { adapter: { name: this.refAdapter.name, id: this.refAdapter.id }, recovered: true, refs }
      : this.refAdapter.compareAndSwapRefs({ expected: [{ ref: record.candidateRef, sha: record.candidateSha }], writes: [{ ref: record.candidateRef, sha: null }] });
    const rolledBack = { ...record, revision: record.revision + 1, state: 'rolled-back', rollbackApprovalId: text(input.approvalId, 'approvalId'),
      rollbackApprovalRevision: input.approvalRevision, rolledBackAt: this.clock().toISOString(), rollbackReceiptDigest: digest(receipt),
      ...(recovered ? { recoveredAt: this.clock().toISOString(), recovery: 'private-ref-rollback-completed-before-journal' } : {}) };
    this.#append(record.id, record.revision, rolledBack, 'integration.adoption.rollback');
    return { ...rolledBack, mutationPerformed: true };
  }

  requestAdoptedCandidate(input = {}, { requestIntegration, findIntegrationRequest } = {}) {
    if (typeof requestIntegration !== 'function') throw new TorchError('Native integration request adapter is unavailable', { code: 'ADOPTION_NATIVE_REQUEST_UNAVAILABLE' });
    const adoptionId = text(input.adoptionId, 'adoptionId');
    this.controlPlane.database.exec('BEGIN IMMEDIATE');
    try {
      const record = this.getPrepared(adoptionId);
      if (!['finalized', 'requesting'].includes(record.state)) {
        throw new TorchError('Only a finalized adoption can request native qualification', {
          code: 'ADOPTION_REQUEST_STATE_INVALID', details: { state: record.state },
        });
      }
      const plan = this.#fromRecord(record, input, 'request');
      if (!plan.canProceed) throw new TorchError('Adopted candidate request is blocked', { code: 'ADOPTION_REQUEST_BLOCKED', details: plan.blockers });
      const requesting = record.state === 'requesting' ? record : { ...record, revision: record.revision + 1, state: 'requesting',
        requestApprovalId: text(input.approvalId, 'approvalId'), requestApprovalRevision: input.approvalRevision, requestStartedAt: this.clock().toISOString() };
      if (record.state !== 'requesting') this.#appendInTransaction(record.id, record.revision, requesting, 'integration.adoption.request-started');
      const existing = findIntegrationRequest?.({ candidateRef: requesting.candidateRef, commit: requesting.candidateSha });
      if (existing && (existing.sourceArea !== requesting.contributorArea || existing.targetBranch !== requesting.targetBranch)) {
        throw new TorchError('Existing private-ref integration request does not match this adoption', {
          code: 'ADOPTION_INTEGRATION_REQUEST_CONFLICT', details: { adoptionId: requesting.id, integrationRequestId: existing.id },
        });
      }
      const request = existing ?? requestIntegration({ adoptionId: requesting.id, areaId: requesting.contributorArea,
        commit: requesting.candidateSha, candidateRef: requesting.candidateRef });
      const requested = { ...requesting, revision: requesting.revision + 1, state: 'requested', integrationRequestId: request.id, requestedAt: this.clock().toISOString() };
      this.#appendInTransaction(requesting.id, requesting.revision, requested, 'integration.adoption.request');
      this.controlPlane.database.exec('COMMIT');
      return { ...requested, integrationRequest: request, mutationPerformed: true };
    } catch (error) {
      this.controlPlane.database.exec('ROLLBACK');
      throw error;
    }
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
