import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createCandidateSourceBootstrapRuntimeV2 } from '../../src/checks/candidate-source-bootstrap.mjs';

function planState(expiresAt = '2030-01-01T00:00:00.000Z') {
  const policyBytes = Buffer.from('policy\n');
  return { admissionId: 'admission-1', leaseId: 'lease-1', checkId: 'test', runGeneration: 1, guardGeneration: 1, policyBytes, policyDigest: createHash('sha256').update(policyBytes).digest('hex'), engine: { pre: {}, post: {} }, subject: {}, artifactManifest: { schema: 'torch.dev/artifact-manifest/v1alpha1', manifestSha256: 'a'.repeat(64) }, expiresAt };
}

test('SCN-candidate-bootstrap-one-shot: only a service-issued opaque plan opens once and its observed FD acknowledgement closes it', () => {
  const states = new WeakMap(); const plan = Object.freeze({}); states.set(plan, planState());
  const runtime = createCandidateSourceBootstrapRuntimeV2({ stateForPlan: (value) => states.get(value), now: () => new Date('2029-01-01T00:00:00.000Z') });
  assert.throws(() => runtime.create(Object.freeze({})), { code: 'CANDIDATE_NATIVE_ADMISSION_REQUIRED' });
  const handle = runtime.create(plan); const clone = { ...handle };
  assert.throws(() => runtime.open(clone), { code: 'CANDIDATE_NATIVE_ADMISSION_REPLAY' });
  const channel = runtime.open(handle);
  assert.equal(JSON.parse(channel.frame).receiptAdapterAdmission, null);
  runtime.acknowledgeAndClose(handle, channel.acknowledgement);
  assert.throws(() => runtime.open(handle), { code: 'CANDIDATE_NATIVE_ADMISSION_REPLAY' });
  assert.throws(() => runtime.acknowledgeAndClose(handle, channel.acknowledgement), { code: 'CANDIDATE_NATIVE_ADMISSION_REPLAY' });
});

test('SCN-candidate-bootstrap-expiry: an expired service plan refuses before a parent frame is made', () => {
  const states = new WeakMap(); const plan = Object.freeze({}); states.set(plan, planState('2020-01-01T00:00:00.000Z'));
  const runtime = createCandidateSourceBootstrapRuntimeV2({ stateForPlan: (value) => states.get(value) });
  assert.throws(() => runtime.open(runtime.create(plan)), { code: 'CANDIDATE_NATIVE_ADMISSION_EXPIRED' });
});
