import { TorchError } from '../kernel/errors.mjs';

function fail(message, code, details) {
  throw new TorchError(message, { code, details });
}

/**
 * Fence observations are owned by the backend, never submitted by the caller.
 * Until the backend has recorded a PID1 namespace identity, FD closure, and
 * namespace-wide reaping, every attempt is UNKNOWN. A process-group exit never
 * creates TerminalProof.
 */
export function createCandidateExecutionFenceRuntimeV2({ stateForAttempt, backendObservation } = {}) {
  if (typeof stateForAttempt !== 'function' || typeof backendObservation !== 'function') throw new TypeError('candidate fence runtime is incomplete');
  const closed = new WeakSet();
  function close(attempt) {
    if (!stateForAttempt(attempt) || closed.has(attempt)) fail('Candidate fence is unavailable', 'CANDIDATE_FENCE_UNAVAILABLE');
    closed.add(attempt);
  }
  function terminal(attempt) {
    if (!stateForAttempt(attempt) || !closed.has(attempt)) fail('Candidate fence is unavailable', 'CANDIDATE_FENCE_UNAVAILABLE');
    const observed = backendObservation(attempt);
    const qualified = observed?.backend === 'private-pid1-namespace'
      && Number.isSafeInteger(observed.namespacePid) && observed.namespacePid > 0
      && typeof observed.namespaceIdentity === 'string' && observed.namespaceIdentity.length > 0
      && observed.admissionFdsClosed === true && observed.descendantsReaped === true && observed.escapedDescendants === false;
    return Object.freeze({
      schema: 'torch.dev/candidate-terminal-proof/v2alpha1', outcome: qualified ? 'terminal' : 'unknown', terminalProof: qualified,
      reason: qualified ? null : 'descendant-closure-unobserved',
    });
  }
  return Object.freeze({ close, terminal });
}
