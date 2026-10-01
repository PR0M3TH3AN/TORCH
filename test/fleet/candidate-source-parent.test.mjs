import assert from 'node:assert/strict';
import test from 'node:test';
import { issueCandidateNativeAdmissionV2, openCandidateSourceBootstrapV2 } from '../../src/checks/candidate-source-bootstrap.mjs';
test('SCN-candidate-parent-capability: bootstrap frame carries only a bound tuple, never roots, env, writers, adapters, or receipt authority', () => {
  const ticket = issueCandidateNativeAdmissionV2({ projectId: 'p', areaId: 'a', checkId: 'c', runId: 'r', generation: 'g', policyDigest: 'a'.repeat(64), engineDigest: 'b'.repeat(64), expiresAt: '2030-01-01T00:00:00.000Z' });
  const frame = openCandidateSourceBootstrapV2(ticket, { now: () => new Date('2029-01-01T00:00:00.000Z') });
  for (const forbidden of ['projectId', 'areaId', 'checkId', 'inputRoot', 'cwd', 'environment', 'writer', 'adapter', 'receipt']) assert.equal(Object.hasOwn(frame, forbidden), false);
});
