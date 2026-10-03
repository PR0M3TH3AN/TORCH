import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import { openControlPlane } from '../../src/control-plane/service.mjs';
import { analyzeRepository } from '../../src/kernel/analyze.mjs';
import { proposeDomains } from '../../src/kernel/domains.mjs';
import { inspectRepository } from '../../src/kernel/git.mjs';
import { installProject } from '../../src/kernel/install.mjs';
import { IntegrationService } from '../../src/integration/service.mjs';

const sha = value => execFileSync('git', ['-C', value, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function fixture(name) {
  const root = mkdtempSync(join(tmpdir(), `${name}-`));
  execFileSync('git', ['init', '-b', 'main', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'torch-test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'TORCH Test']);
  writeFileSync(join(root, 'package.json'), `${JSON.stringify({ name, scripts: {} })}\n`);
  writeFileSync(join(root, 'app.mjs'), 'export const value = 1;\n');
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'fixture base']);
  const repository = inspectRepository(root);
  const proposal = proposeDomains({ repository, analysis: analyzeRepository(repository) });
  proposal.domains.push({
    id: 'review-area', title: 'Review Area', kind: 'development',
    scope: ['review fixtures'], not_scope: ['application source'], owned_paths: ['review/**'],
    shared_paths: [], neighbours: [], required_checks: [], resources: [], runtime: 'claude', evidence: ['app.mjs'],
  });
  proposal.checks = [];
  proposal.review = { status: 'approved', reviewedAt: '2026-10-03T00:00:00.000Z', reviewedBy: 'fixture-owner', notes: [] };
  const env = { ...process.env, XDG_DATA_HOME: join(tmpdir(), `${basename(root)}-state`) };
  installProject({ repository, proposal, env, projectId: name });
  execFileSync('git', ['-C', root, 'add', '.torch']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'install fixture control plane']);
  const base = sha(root);
  execFileSync('git', ['-C', root, 'checkout', '-b', 'candidate']);
  writeFileSync(join(root, 'candidate.mjs'), 'export const candidate = true;\n');
  execFileSync('git', ['-C', root, 'add', 'candidate.mjs']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'candidate contribution']);
  const candidate = sha(root);
  execFileSync('git', ['-C', root, 'checkout', 'main']);
  const control = openControlPlane({ repositoryRoot: root, env });
  const service = new IntegrationService({ repositoryRoot: root, controlPlane: control, checkService: { exactPasses: () => false } });
  const contributor = proposal.domains[0].id;
  return { root, env, control, service, contributor, destination: 'review-area', base, candidate };
}

function concurrentAdoptedRequest(context, requestInput) {
  const childSource = `
    import { pathToFileURL } from 'node:url';
    import { resolve } from 'node:path';
    const { repositoryRoot, stateRoot, requestInput } = JSON.parse(process.argv[1]);
    const sourceRoot = process.cwd();
    const { openControlPlane } = await import(pathToFileURL(resolve(sourceRoot, 'src/control-plane/service.mjs')).href);
    const { IntegrationService } = await import(pathToFileURL(resolve(sourceRoot, 'src/integration/service.mjs')).href);
    const control = openControlPlane({ repositoryRoot, env: { ...process.env, XDG_DATA_HOME: stateRoot } });
    const service = new IntegrationService({ repositoryRoot, controlPlane: control, checkService: { exactPasses: () => false } });
    try {
      const result = service.requestAdoptedCandidate(requestInput);
      console.log(JSON.stringify({ outcome: 'requested', integrationRequestId: result.integrationRequest.id }));
    } catch (error) {
      console.log(JSON.stringify({ outcome: 'refused', code: error.code ?? null }));
    } finally {
      control.close();
    }
  `;
  const encoded = JSON.stringify({ repositoryRoot: context.root, stateRoot: context.env.XDG_DATA_HOME, requestInput });
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', childSource, encoded], {
      cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`concurrent adopted request child failed: ${stderr}`));
      try { resolve(JSON.parse(stdout.trim().split('\n').at(-1))); }
      catch (error) { reject(new Error(`invalid concurrent adopted request output: ${stdout}\n${stderr}\n${error.message}`)); }
    });
  });
}

function authority(context, { action, adoptionId }) {
  const provenance = ['fixture:owner-approved', `candidate:${context.candidate}`];
  const binding = {
    schema: 'torch.dev/integration-adoption-authority/v1alpha1', action, adoptionId,
    candidateSha: context.candidate, baseTargetSha: context.base,
    provenanceManifestDigest: digest(provenance), contributorArea: context.contributor,
    destinationArea: context.destination, targetBranch: 'main',
    candidateRef: `refs/torch/integration-candidates/${adoptionId}`,
    expectedOldRef: 'refs/heads/main', adapter: {
      name: context.service.adoption.refAdapter.name, id: context.service.adoption.refAdapter.id,
    },
  };
  const pending = context.control.requestApproval({
    requester: context.contributor, approver: 'owner', task: 'TASK-f40126ee',
    title: `Fixture ${action} authority`, summary: 'Hermetic exact-source adoption scenario.',
  });
  const approved = context.control.decideApproval({
    approvalId: pending.id, decidedBy: 'owner', decision: 'approved', expectedRevision: pending.revision,
    note: JSON.stringify(binding),
  });
  return {
    approvalId: approved.id, approvalRevision: approved.revision, provenance,
    provenanceManifestDigest: binding.provenanceManifestDigest, adapter: binding.adapter,
  };
}

function input(context, action, adoptionId, extra = {}) {
  return {
    actorId: 'owner', adoptionId, candidateSha: context.candidate, baseTargetSha: context.base,
    contributorArea: context.contributor, destinationArea: context.destination,
    targetBranch: 'main', candidateRef: `refs/torch/integration-candidates/${adoptionId}`,
    expectedOldRef: 'refs/heads/main', ...authority(context, { action, adoptionId }), ...extra,
  };
}

function prepare(context, adoptionId = 'fixture-adoption') {
  const preparedInput = input(context, 'prepare', adoptionId);
  const plan = context.service.planAdoption({ ...preparedInput, action: 'prepare' });
  assert.deepEqual(plan.blockers, [], `preparation must begin from an exact clean fixture: ${JSON.stringify(plan.blockers)}`);
  return context.service.prepareAdoption(preparedInput);
}

function lifecycleInput(context, action, adoptionId, extra = {}) {
  const { approvalId, approvalRevision, adapter } = authority(context, { action, adoptionId });
  const record = context.service.getPreparedAdoption(adoptionId);
  return { actorId: 'owner', adoptionId, expectedRecordRevision: record.revision, approvalId, approvalRevision, adapter, ...extra };
}

function blockedCodes(error) {
  assert.equal(error.code.endsWith('_BLOCKED'), true, `expected a blocked adoption transition, got ${error.code}`);
  return error.details.map((blocker) => blocker.code);
}

test('SCN-integration-adoption-private-ref-cas: a real temporary Git transaction atomically creates private archive and candidate refs, and stale expected refs refuse', () => {
  const context = fixture('torch-adoption-cas');
  const adoptionId = 'fixture-adoption';
  prepare(context, adoptionId);
  const finalized = context.service.finalizeAdoption(lifecycleInput(context, 'finalize', adoptionId));
  const refs = context.service.adoption.refAdapter.readRefs([
    'refs/heads/main', finalized.candidateRef, finalized.archiveRef,
  ]);
  assert.deepEqual(refs, {
    'refs/heads/main': context.base,
    [finalized.candidateRef]: context.candidate,
    [finalized.archiveRef]: context.base,
  });
  assert.throws(() => context.service.adoption.refAdapter.compareAndSwapRefs({
    expected: [{ ref: finalized.candidateRef, sha: context.base }],
    writes: [{ ref: finalized.candidateRef, sha: null }],
  }), (error) => error.code === 'ADOPTION_REF_CAS_FAILED');
  assert.equal(context.service.adoption.getPrepared(adoptionId).state, 'finalized');
  context.control.close();
});

test('SCN-integration-adoption-journal-and-binding: a duplicate preparation cannot overwrite the journal and lifecycle input cannot alter its immutable candidate binding', () => {
  const context = fixture('torch-adoption-journal');
  const adoptionId = 'fixture-adoption';
  const prepared = prepare(context, adoptionId);
  assert.throws(() => context.service.prepareAdoption(input(context, 'prepare', adoptionId)),
    (error) => error.code === 'ADOPTION_RECORD_REVISION_STALE');
  assert.throws(() => context.service.finalizeAdoption(lifecycleInput(context, 'finalize', adoptionId, { candidateSha: context.base })),
    (error) => error.code === 'ADOPTION_IMMUTABLE_BINDING_STALE');
  assert.throws(() => context.service.finalizeAdoption(lifecycleInput(context, 'finalize', adoptionId, {
    expectedRecordRevision: prepared.revision + 1,
  })), (error) => error.code === 'ADOPTION_RECORD_REVISION_STALE');
  const refs = context.service.adoption.refAdapter.readRefs([
    prepared.expectedOldRef, prepared.candidateRef, prepared.archiveRef,
  ]);
  assert.deepEqual(refs, {
    [prepared.expectedOldRef]: context.base,
    [prepared.candidateRef]: null,
    [prepared.archiveRef]: null,
  });
  const { mutationPerformed, ...durablePrepared } = prepared;
  assert.equal(mutationPerformed, true);
  assert.deepEqual(context.service.adoption.getPrepared(adoptionId), durablePrepared);
  context.control.close();
});

test('SCN-integration-adoption-finalize-recovery: a crash after real ref CAS but before the journal transition reconciles once and never duplicates refs', () => {
  const context = fixture('torch-adoption-finalize-recovery');
  const adoptionId = 'fixture-adoption';
  const prepared = prepare(context, adoptionId);
  context.service.adoption.refAdapter.compareAndSwapRefs({
    expected: [
      { ref: prepared.expectedOldRef, sha: prepared.baseTargetSha },
      { ref: prepared.candidateRef, sha: null },
      { ref: prepared.archiveRef, sha: null },
    ],
    writes: [
      { ref: prepared.archiveRef, sha: prepared.baseTargetSha },
      { ref: prepared.candidateRef, sha: prepared.candidateSha },
    ],
  });
  const recovered = context.service.reconcileAdoption(lifecycleInput(context, 'reconcile', adoptionId));
  assert.equal(recovered.state, 'recovered-finalized');
  assert.equal(recovered.record.recovery, 'private-ref-cas-completed-before-journal');
  const replay = context.service.reconcileAdoption(lifecycleInput(context, 'reconcile', adoptionId));
  assert.equal(replay.state, 'consistent');
  assert.equal(replay.mutationPerformed, false);
  context.control.close();
});

test('SCN-integration-adoption-rollback-recovery: a journal-missing rollback completes without a second deletion, while divergent candidate bytes refuse', () => {
  const context = fixture('torch-adoption-rollback-recovery');
  const adoptionId = 'fixture-adoption';
  prepare(context, adoptionId);
  const finalized = context.service.finalizeAdoption(lifecycleInput(context, 'finalize', adoptionId));
  assert.equal(finalized.state, 'finalized');
  context.service.adoption.refAdapter.compareAndSwapRefs({
    expected: [{ ref: finalized.candidateRef, sha: finalized.candidateSha }],
    writes: [{ ref: finalized.candidateRef, sha: null }],
  });
  const recovered = context.service.rollbackAdoption(lifecycleInput(context, 'rollback', adoptionId));
  assert.equal(recovered.state, 'rolled-back');
  assert.equal(recovered.recovery, 'private-ref-rollback-completed-before-journal');

  const divergent = fixture('torch-adoption-rollback-divergence');
  const divergentId = 'fixture-adoption';
  prepare(divergent, divergentId);
  const divergentFinal = divergent.service.finalizeAdoption(lifecycleInput(divergent, 'finalize', divergentId));
  divergent.service.adoption.refAdapter.compareAndSwapRefs({
    expected: [{ ref: divergentFinal.candidateRef, sha: divergentFinal.candidateSha }],
    writes: [{ ref: divergentFinal.candidateRef, sha: divergent.base }],
  });
  assert.throws(() => divergent.service.rollbackAdoption(lifecycleInput(divergent, 'rollback', divergentId)),
    (error) => error.code === 'ADOPTION_ROLLBACK_REF_DIVERGED');
  context.control.close();
  divergent.control.close();
});

test('SCN-integration-adoption-private-ref-intake: finalized private refs enter the ordinary native integration queue, not a specialist branch shortcut', () => {
  const unfinalized = fixture('torch-adoption-unfinalized-intake');
  const unfinalizedId = 'fixture-adoption';
  const unfinalizedRef = `refs/torch/integration-candidates/${unfinalizedId}`;
  unfinalized.service.adoption.refAdapter.compareAndSwapRefs({
    expected: [{ ref: unfinalizedRef, sha: null }],
    writes: [{ ref: unfinalizedRef, sha: unfinalized.candidate }],
  });
  assert.throws(() => unfinalized.service.requestCandidate({
    areaId: unfinalized.contributor, commit: unfinalized.candidate, candidateRef: unfinalizedRef,
  }), (error) => error.code === 'INTEGRATION_ADOPTED_INTAKE_INTERNAL_ONLY');
  assert.deepEqual(unfinalized.service.list(), []);
  unfinalized.control.close();

  const context = fixture('torch-adoption-native-intake');
  const adoptionId = 'fixture-adoption';
  prepare(context, adoptionId);
  const finalized = context.service.finalizeAdoption(lifecycleInput(context, 'finalize', adoptionId));
  assert.throws(() => context.service.requestAdoptedCandidate(lifecycleInput(context, 'request', adoptionId, {
    expectedRecordRevision: finalized.revision + 1,
  })), (error) => error.code === 'ADOPTION_RECORD_REVISION_STALE');
  assert.deepEqual(context.service.list(), []);
  const requested = context.service.requestAdoptedCandidate(lifecycleInput(context, 'request', adoptionId));
  assert.equal(requested.state, 'requested');
  assert.equal(requested.integrationRequest.sourceBranch, finalized.candidateRef);
  assert.equal(requested.integrationRequest.sourceCommit, context.candidate);
  assert.equal(requested.integrationRequest.state, 'testing');
  assert.equal(requested.integrationRequest.targetBranch, 'main');
  context.control.close();
});

test('SCN-integration-adoption-approval-boundaries: unrelated or source-only approval records cannot authorize an owner adoption, and actor, action, revision, and provenance mismatches each refuse', () => {
  const unrelated = fixture('torch-adoption-unrelated-approval');
  const unrelatedId = 'fixture-adoption';
  const unrelatedApproval = unrelated.control.requestApproval({
    requester: unrelated.contributor, approver: 'owner', task: 'TASK-unrelated',
    title: 'Ordinary source branch review', summary: 'Not an integration-adoption authority.',
  });
  const unrelatedApproved = unrelated.control.decideApproval({
    approvalId: unrelatedApproval.id, decidedBy: 'owner', decision: 'approved', expectedRevision: unrelatedApproval.revision,
    note: JSON.stringify({ schema: 'torch.dev/ordinary-source-review/v1alpha1', sourceArea: unrelated.contributor }),
  });
  const unrelatedInput = {
    actorId: 'owner', adoptionId: unrelatedId, candidateSha: unrelated.candidate, baseTargetSha: unrelated.base,
    contributorArea: unrelated.contributor, destinationArea: unrelated.destination, targetBranch: 'main',
    candidateRef: `refs/torch/integration-candidates/${unrelatedId}`, expectedOldRef: 'refs/heads/main',
    approvalId: unrelatedApproved.id, approvalRevision: unrelatedApproved.revision,
    provenance: ['fixture:owner-approved', `candidate:${unrelated.candidate}`],
    provenanceManifestDigest: digest(['fixture:owner-approved', `candidate:${unrelated.candidate}`]),
    adapter: { name: unrelated.service.adoption.refAdapter.name, id: unrelated.service.adoption.refAdapter.id },
  };
  assert.throws(() => unrelated.service.prepareAdoption(unrelatedInput), (error) => blockedCodes(error).includes('ADOPTION_APPROVAL_BINDING_INVALID'));
  assert.deepEqual(unrelated.service.list(), []);
  unrelated.control.close();

  const wrongActor = fixture('torch-adoption-wrong-actor');
  assert.throws(() => wrongActor.service.prepareAdoption({
    ...input(wrongActor, 'prepare', 'fixture-adoption'), actorId: wrongActor.contributor,
  }), (error) => blockedCodes(error).includes('OWNER_ACTOR_REQUIRED'));
  wrongActor.control.close();

  const wrongAction = fixture('torch-adoption-wrong-action');
  prepare(wrongAction, 'fixture-adoption');
  assert.throws(() => wrongAction.service.finalizeAdoption(lifecycleInput(wrongAction, 'rollback', 'fixture-adoption')),
    (error) => blockedCodes(error).includes('ADOPTION_APPROVAL_BINDING_INVALID'));
  wrongAction.control.close();

  const staleRevision = fixture('torch-adoption-stale-revision');
  prepare(staleRevision, 'fixture-adoption');
  const staleInput = lifecycleInput(staleRevision, 'finalize', 'fixture-adoption');
  assert.throws(() => staleRevision.service.finalizeAdoption({ ...staleInput, approvalRevision: staleInput.approvalRevision - 1 }),
    (error) => blockedCodes(error).includes('ADOPTION_APPROVAL_REVISION_STALE'));
  staleRevision.control.close();

  const wrongProvenance = fixture('torch-adoption-wrong-provenance');
  assert.throws(() => wrongProvenance.service.prepareAdoption({
    ...input(wrongProvenance, 'prepare', 'fixture-adoption'), provenance: ['fixture:owner-approved', 'unapproved:alternate-provenance'],
  }), (error) => blockedCodes(error).includes('ADOPTION_PROVENANCE_DIGEST_MISMATCH'));
  wrongProvenance.control.close();
});

test('SCN-integration-adoption-request-replay: concurrent authenticated API callers serialize on the adoption journal and create exactly one private-ref queue request', async () => {
  const context = fixture('torch-adoption-request-replay');
  const adoptionId = 'fixture-adoption';
  prepare(context, adoptionId);
  context.service.finalizeAdoption(lifecycleInput(context, 'finalize', adoptionId));
  const requestInput = lifecycleInput(context, 'request', adoptionId);
  const outcomes = await Promise.all([
    concurrentAdoptedRequest(context, requestInput),
    concurrentAdoptedRequest(context, requestInput),
  ]);
  assert.deepEqual(outcomes.map((entry) => entry.outcome).sort(), ['refused', 'requested']);
  assert.equal(outcomes.find((entry) => entry.outcome === 'refused').code, 'ADOPTION_RECORD_REVISION_STALE');
  const requests = context.service.list();
  assert.equal(requests.length, 1);
  assert.equal(context.service.getPreparedAdoption(adoptionId).state, 'requested');
  context.control.close();
});

test('SCN-integration-adoption-legacy-retries: historical ordinary-request retries remain readable when integration service starts', () => {
  const context = fixture('torch-adoption-legacy-retries');
  const insert = context.control.database.prepare(`INSERT INTO integration_requests (
    id, project_id, source_area, source_branch, source_commit, target_branch,
    base_target_commit, state, reason, required_checks, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const [id, state] of [['historical-failed', 'blocked'], ['historical-retry', 'superseded']]) {
    insert.run(id, context.control.projectId, context.contributor, 'refs/heads/candidate', context.candidate,
      'main', context.base, state, 'historical-retry', '[]', '2026-10-03T00:00:00.000Z', '2026-10-03T00:00:00.000Z');
  }
  assert.doesNotThrow(() => new IntegrationService({
    repositoryRoot: context.root, controlPlane: context.control, checkService: { exactPasses: () => false },
  }));
  assert.equal(context.service.list().length, 2);
  context.control.close();
});
