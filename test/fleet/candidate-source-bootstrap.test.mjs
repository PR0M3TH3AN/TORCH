import assert from 'node:assert/strict';
import test from 'node:test';
import { issueCandidateNativeAdmissionV2, openCandidateSourceBootstrapV2 } from '../../src/checks/candidate-source-bootstrap.mjs';

const issued = (expiresAt = '2030-01-01T00:00:00.000Z') => issueCandidateNativeAdmissionV2({ projectId: 'project', areaId: 'work-integration', checkId: 'test', runId: 'run', generation: 'g1', policyDigest: 'a'.repeat(64), engineDigest: 'b'.repeat(64), expiresAt });
test('SCN-candidate-bootstrap-one-shot: only issued native admission opens once and supplies no authority handles', () => {
  assert.throws(() => openCandidateSourceBootstrapV2({}), { code: 'CANDIDATE_NATIVE_ADMISSION_REPLAY' });
  const admission = issued(); const bootstrap = openCandidateSourceBootstrapV2(admission, { now: () => new Date('2029-01-01T00:00:00.000Z') });
  assert.equal(bootstrap.transport.closesBeforeCandidateSpawn, true); assert.deepEqual(Object.keys(bootstrap).sort(), ['engineDigest', 'expiresAt', 'generation', 'nonce', 'policyDigest', 'runId', 'schema', 'transport']);
  assert.equal(Object.hasOwn(bootstrap, 'controlPlane'), false); assert.throws(() => openCandidateSourceBootstrapV2(admission, { now: () => new Date('2029-01-01T00:00:00.000Z') }), { code: 'CANDIDATE_NATIVE_ADMISSION_REPLAY' });
});
test('SCN-candidate-bootstrap-expiry: expired admission refuses before any child protocol exists', () => assert.throws(() => openCandidateSourceBootstrapV2(issued('2020-01-01T00:00:00.000Z')), { code: 'CANDIDATE_NATIVE_ADMISSION_EXPIRED' }));
