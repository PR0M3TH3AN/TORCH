import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { TorchError } from '../kernel/errors.mjs';
import { observeRuntimeTurn } from '../runtime/turn-guard.mjs';

const CAPABILITY = 'integration.adoption.prepare';
const ADOPTION_SCHEMA = 'torch.dev/integration-adoption/v1alpha1';
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
    if (line.startsWith('worktree ')) {
      records.push(line.slice('worktree '.length));
    }
  }
  return records;
}

function approvalAllows(approval, capability) {
  if (!approval || approval.status !== 'approved' || approval.approver_id !== 'owner') return false;
  const scope = [approval.title, approval.summary, approval.evidence, approval.decision_note]
    .filter(Boolean).join('\n').toLowerCase();
  return capability === CAPABILITY && scope.includes('adoption') && scope.includes('source');
}

/**
 * Source-only adoption boundary. It persists only immutable prepared intents in
 * the existing audit journal. It deliberately has no ref-update, branch, CLI,
 * manifest, configuration, schema, or installation side effect.
 */
export class AdoptionService {
  constructor({ repositoryRoot, controlPlane, clock = () => new Date(), idFactory = randomUUID, policy } = {}) {
    this.repositoryRoot = repositoryRoot;
    this.controlPlane = controlPlane;
    this.clock = clock;
    this.idFactory = idFactory;
    this.policy = policy ?? {};
  }

  plan({ actorId, approvalId, approvalRevision, capability = CAPABILITY, adoptionId,
    candidateSha, baseTargetSha, provenance, provenanceManifestDigest, contributorArea,
    destinationArea, targetBranch, candidateRef, expectedOldRef } = {}) {
    const blockers = [];
    const id = adoptionId ? text(adoptionId, 'adoptionId') : null;
    if (id && !SAFE_ID.test(id)) blockers.push({ code: 'ADOPTION_ID_INVALID' });
    if (actorId !== 'owner') blockers.push({ code: 'OWNER_ACTOR_REQUIRED' });
    if (capability !== CAPABILITY) blockers.push({ code: 'ADOPTION_CAPABILITY_INVALID' });
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

    let contributor; let destination;
    try { contributor = this.controlPlane.assertIdentity(text(contributorArea, 'contributorArea')); }
    catch (error) { blockers.push({ code: 'ADOPTION_CONTRIBUTOR_INVALID', details: error.code ?? null }); }
    try { destination = this.controlPlane.assertIdentity(text(destinationArea, 'destinationArea')); }
    catch (error) { blockers.push({ code: 'ADOPTION_DESTINATION_INVALID', details: error.code ?? null }); }
    if (contributor && destination && contributor === destination) blockers.push({ code: 'ADOPTION_IDENTITIES_MUST_DIFFER' });

    const approval = approvalId ? this.controlPlane.database.prepare(`SELECT * FROM approval_requests
      WHERE id = ? AND project_id = ?`).get(approvalId, this.controlPlane.projectId) : null;
    if (!approval) blockers.push({ code: 'ADOPTION_APPROVAL_MISSING' });
    else if (approval.revision !== approvalRevision) blockers.push({ code: 'ADOPTION_APPROVAL_REVISION_STALE', actual: approval.revision });
    else if (!approvalAllows(approval, capability)) blockers.push({ code: 'ADOPTION_APPROVAL_SCOPE_INVALID' });

    if (candidate && git(this.repositoryRoot, ['cat-file', '-e', `${candidate}^{commit}`], { allowFailure: true }).status !== 0) {
      blockers.push({ code: 'ADOPTION_CANDIDATE_MISSING' });
    }
    if (base && git(this.repositoryRoot, ['cat-file', '-e', `${base}^{commit}`], { allowFailure: true }).status !== 0) {
      blockers.push({ code: 'ADOPTION_BASE_MISSING' });
    }
    if (candidate && base && git(this.repositoryRoot, ['merge-base', '--is-ancestor', base, candidate], { allowFailure: true }).status !== 0) {
      blockers.push({ code: 'ADOPTION_CANDIDATE_NOT_DESCENDED_FROM_BASE' });
    }
    if (expectedReference && base) {
      const current = git(this.repositoryRoot, ['rev-parse', expectedReference], { allowFailure: true });
      if (current.status !== 0) blockers.push({ code: 'ADOPTION_EXPECTED_REF_MISSING' });
      else if (current.stdout !== base) blockers.push({ code: 'ADOPTION_EXPECTED_REF_STALE', expected: base, actual: current.stdout });
    }
    if (candidateReference && git(this.repositoryRoot, ['show-ref', '--verify', '--quiet', candidateReference], { allowFailure: true }).status === 0) {
      blockers.push({ code: 'ADOPTION_CANDIDATE_REF_ALREADY_EXISTS' });
    }

    for (const worktree of listWorktreePaths(this.repositoryRoot)) {
      const entries = git(worktree, ['status', '--porcelain=v1', '--untracked-files=all']).stdout.split('\n').filter(Boolean);
      if (entries.length) blockers.push({ code: 'ADOPTION_WORKTREE_DIRTY', worktree, entries });
    }
    if (tableExists(this.controlPlane.database, 'worktree_guards')) {
      const guards = this.controlPlane.database.prepare(`SELECT area_id, guard_type, reason FROM worktree_guards
        WHERE project_id = ? AND released_at IS NULL`).all(this.controlPlane.projectId);
      for (const guard of guards) blockers.push({ code: 'ADOPTION_WORKTREE_GUARD_ACTIVE', guard });
    }
    if (tableExists(this.controlPlane.database, 'resource_leases')) {
      const leases = this.controlPlane.database.prepare(`SELECT id, resource_id, area_id FROM resource_leases
        WHERE released_at IS NULL`).all();
      for (const lease of leases) blockers.push({ code: 'ADOPTION_RESOURCE_LEASE_ACTIVE', lease });
    }
    if (tableExists(this.controlPlane.database, 'prepared_checks')) {
      const prepared = this.controlPlane.database.prepare(`SELECT id, area_id, state FROM prepared_checks
        WHERE project_id = ? AND state IN ('prepared', 'running')`).all(this.controlPlane.projectId);
      for (const check of prepared) blockers.push({ code: 'ADOPTION_PREPARED_CHECK_ACTIVE', check });
    }
    for (const area of [contributor, destination].filter(Boolean)) {
      const executor = observeRuntimeTurn({ stateRoot: this.controlPlane.stateRoot, repositoryRoot: this.repositoryRoot,
        projectId: this.controlPlane.projectId, areaId: area, now: this.clock });
      if (executor.state !== 'inactive') blockers.push({ code: 'ADOPTION_EXECUTOR_NOT_INACTIVE', areaId: area, executor });
    }

    return {
      action: 'plan-adoption', adoptionId: id, capability, approval: approval ? {
        id: approval.id, revision: approval.revision, status: approval.status, approver: approval.approver_id,
      } : null,
      candidateSha: candidate ?? null, baseTargetSha: base ?? null, provenanceManifestDigest: provenanceDigest ?? null,
      contributorArea: contributor ?? null, destinationArea: destination ?? null, targetBranch: target ?? null,
      candidateRef: candidateReference, expectedOldRef: expectedReference, blockers,
      canProceed: blockers.length === 0, mutationPerformed: false,
    };
  }

  prepare(input = {}) {
    const adoptionId = input.adoptionId ?? this.idFactory();
    const plan = this.plan({ ...input, adoptionId });
    if (!plan.canProceed) throw new TorchError('Adoption inputs are not eligible for preparation', {
      code: 'ADOPTION_PREPARE_BLOCKED', details: plan.blockers,
    });
    const existing = this.controlPlane.database.prepare(`SELECT details FROM audit_events
      WHERE project_id = ? AND entity_type = 'integration-adoption' AND entity_id = ?
      ORDER BY rowid DESC LIMIT 1`).get(this.controlPlane.projectId, adoptionId);
    if (existing) throw new TorchError('Adoption id is already journaled; reconcile its immutable record instead.', {
      code: 'ADOPTION_ALREADY_EXISTS', details: { adoptionId },
    });
    const now = this.clock().toISOString();
    const record = {
      schema: ADOPTION_SCHEMA, id: adoptionId, revision: 1, state: 'prepared', approvalId: text(input.approvalId, 'approvalId'),
      approvalRevision: input.approvalRevision, capability: plan.capability, candidateSha: plan.candidateSha,
      baseTargetSha: plan.baseTargetSha, provenanceManifestDigest: plan.provenanceManifestDigest,
      candidateRef: plan.candidateRef, expectedOldRef: plan.expectedOldRef,
      contributorArea: plan.contributorArea, destinationArea: plan.destinationArea, targetBranch: plan.targetBranch,
      archiveRef: `refs/torch/integration-archives/${adoptionId}`, preparedAt: now, finalizedAt: null,
    };
    this.controlPlane.database.exec('BEGIN IMMEDIATE');
    try {
      this.controlPlane.database.prepare(`INSERT INTO audit_events
        (id, project_id, actor_id, operation, entity_type, entity_id, details, created_at)
        VALUES (?, ?, 'owner', 'integration.adoption.prepare', 'integration-adoption', ?, ?, ?)`)
        .run(this.idFactory(), this.controlPlane.projectId, adoptionId, JSON.stringify(record), now);
      this.controlPlane.database.exec('COMMIT');
    } catch (error) {
      this.controlPlane.database.exec('ROLLBACK');
      throw error;
    }
    return { ...record, mutationPerformed: true };
  }

  getPrepared(adoptionId) {
    const id = text(adoptionId, 'adoptionId');
    const row = this.controlPlane.database.prepare(`SELECT details FROM audit_events
      WHERE project_id = ? AND entity_type = 'integration-adoption' AND entity_id = ?
      ORDER BY rowid DESC LIMIT 1`).get(this.controlPlane.projectId, id);
    const record = durableRecord(row);
    if (!record) throw new TorchError('Unknown adoption journal record', { code: 'ADOPTION_NOT_FOUND', details: { adoptionId: id } });
    return record;
  }
}
