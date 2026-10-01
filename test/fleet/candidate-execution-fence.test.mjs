import assert from 'node:assert/strict';
import test from 'node:test';
import { createCandidateExecutionFenceV2, observeCandidateExecutionFenceV2 } from '../../src/checks/candidate-execution-fence.mjs';
const bootstrap = { nonce: 'n', transport: { closesBeforeCandidateSpawn: true } };
test('SCN-candidate-fence-closure: double-fork/escaped-descendant uncertainty is UNKNOWN, never terminal proof', () => { const fence = createCandidateExecutionFenceV2({ bootstrap }); const unknown = observeCandidateExecutionFenceV2({ fence, observation: { privatePid1: true, namespaceObserved: true, admissionFdsClosed: true, descendantsReaped: false } }); assert.equal(unknown.outcome, 'unknown'); assert.equal(unknown.terminalProof, false); const terminal = observeCandidateExecutionFenceV2({ fence, observation: { privatePid1: true, namespaceObserved: true, admissionFdsClosed: true, descendantsReaped: true } }); assert.equal(terminal.terminalProof, true); });
