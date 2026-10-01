import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createCandidateSourceBootstrapRuntimeV2 } from '../../src/checks/candidate-source-bootstrap.mjs';

test('SCN-candidate-parent-capability: the private FD3 record carries M only and reserves A as null', () => {
  const policyBytes = Buffer.from('policy\n'); const states = new WeakMap(); const plan = Object.freeze({});
  states.set(plan, { admissionId: 'admission-2', leaseId: 'lease-2', checkId: 'test', runGeneration: 1, guardGeneration: 2, policyBytes, policyDigest: createHash('sha256').update(policyBytes).digest('hex'), engine: { pre: {}, post: {} }, subject: {}, artifactManifest: { schema: 'torch.dev/artifact-manifest/v1alpha1', manifestSha256: 'a'.repeat(64) }, expiresAt: '2030-01-01T00:00:00.000Z' });
  const runtime = createCandidateSourceBootstrapRuntimeV2({ stateForPlan: (value) => states.get(value), now: () => new Date('2029-01-01T00:00:00.000Z') });
  const frame = JSON.parse(runtime.open(runtime.create(plan)).frame);
  for (const forbidden of ['root', 'cwd', 'environment', 'writer', 'adapter', 'receipt', 'command', 'executor']) assert.equal(Object.hasOwn(frame, forbidden), false);
  assert.equal(frame.receiptAdapterAdmission, null);
  assert.deepEqual(Object.keys(frame.artifactManifest).sort(), ['manifestSha256', 'schema']);
});
