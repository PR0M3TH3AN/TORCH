import assert from 'node:assert/strict';
import test from 'node:test';
import { createCandidateExecutionFenceRuntimeV2 } from '../../src/checks/candidate-execution-fence.mjs';

test('SCN-candidate-fence-closure: a closed opaque attempt without backend namespace/reaping evidence is UNKNOWN and clones cannot be reused', () => {
  const states = new WeakMap(); const attempt = Object.freeze({}); states.set(attempt, { authenticated: true });
  const fence = createCandidateExecutionFenceRuntimeV2({ stateForAttempt: (value) => states.get(value), backendObservation: () => null });
  assert.throws(() => fence.close({}), { code: 'CANDIDATE_FENCE_UNAVAILABLE' });
  fence.close(attempt); const terminal = fence.terminal(attempt);
  assert.equal(terminal.outcome, 'unknown'); assert.equal(terminal.terminalProof, false);
  assert.throws(() => fence.terminal({ ...attempt }), { code: 'CANDIDATE_FENCE_UNAVAILABLE' });
  assert.throws(() => fence.close(attempt), { code: 'CANDIDATE_FENCE_UNAVAILABLE' });
});
