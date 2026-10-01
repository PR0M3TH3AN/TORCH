import { spawnSync } from 'node:child_process';
import { TorchError } from '../kernel/errors.mjs';

export const CANDIDATE_EXECUTION_LIMITS_V2 = Object.freeze({ timeoutMs: 300000, maxOutputBytes: 1048576, maxArgs: 64, maxArgBytes: 4096 });

function fail(message, code, details) {
  throw new TorchError(message, { code, details });
}

function validRuntime(state) {
  const runtime = state?.runtime;
  if (!runtime || typeof runtime.command !== 'string' || !runtime.command.startsWith('/') || !Array.isArray(runtime.args)
    || !runtime.args.every((arg) => typeof arg === 'string' && Buffer.byteLength(arg, 'utf8') <= CANDIDATE_EXECUTION_LIMITS_V2.maxArgBytes)
    || runtime.args.length > CANDIDATE_EXECUTION_LIMITS_V2.maxArgs
    || !runtime.environment || Object.keys(runtime.environment).some((key) => ['PATH', 'HOME', 'NODE_PATH', 'npm_config_cache'].includes(key))) {
    fail('Candidate fixed runtime is invalid', 'CANDIDATE_EXECUTION_RUNTIME_INVALID');
  }
  return runtime;
}

/**
 * Runs a fixed, CheckService-derived E binding. `run` takes only an opaque
 * attempt; command, arguments, environment, executor, cwd and limits cannot
 * be selected by callers. It is raw terminal evidence, never a receipt PASS.
 */
export function createCandidateSourceExecutionRuntimeV2({ stateForAttempt, snapshotRuntime } = {}) {
  if (typeof stateForAttempt !== 'function' || !snapshotRuntime) throw new TypeError('candidate execution runtime is incomplete');
  const results = new WeakMap();
  function run(attempt) {
    const state = stateForAttempt(attempt);
    const runtime = validRuntime(state);
    snapshotRuntime.verify(attempt);
    const cwd = snapshotRuntime.cwd(attempt);
    let raw;
    try {
      raw = spawnSync(runtime.command, runtime.args, {
        cwd, env: Object.freeze({ ...runtime.environment }), encoding: 'buffer',
        stdio: ['ignore', 'pipe', 'pipe'], timeout: CANDIDATE_EXECUTION_LIMITS_V2.timeoutMs,
        maxBuffer: CANDIDATE_EXECUTION_LIMITS_V2.maxOutputBytes, killSignal: 'SIGTERM',
      });
    } catch (error) { raw = { status: null, error }; }
    const stdout = Buffer.from(raw?.stdout ?? '');
    const stderr = Buffer.from(raw?.stderr ?? '');
    const overflow = stdout.length > CANDIDATE_EXECUTION_LIMITS_V2.maxOutputBytes || stderr.length > CANDIDATE_EXECUTION_LIMITS_V2.maxOutputBytes || raw?.error?.code === 'ENOBUFS';
    const timeout = raw?.error?.code === 'ETIMEDOUT' || raw?.timedOut === true;
    const observation = Object.freeze({
      schema: 'torch.dev/candidate-source-execution/v2alpha1',
      terminal: Object.freeze({ kind: timeout ? 'timeout' : overflow ? 'overflow' : raw?.signal ? 'signal' : raw?.error ? 'error' : 'exit', exitStatus: Number.isInteger(raw?.status) ? raw.status : null, signal: raw?.signal ?? null, overflow, timeout, success: !timeout && !overflow && !raw?.signal && !raw?.error && raw?.status === 0 }),
      output: Object.freeze({ stdout: stdout.subarray(0, CANDIDATE_EXECUTION_LIMITS_V2.maxOutputBytes), stderr: stderr.subarray(0, CANDIDATE_EXECUTION_LIMITS_V2.maxOutputBytes) }),
    });
    snapshotRuntime.verify(attempt);
    results.set(attempt, observation);
    return observation;
  }
  function observation(attempt) {
    const value = results.get(attempt);
    if (!value) fail('Candidate execution has not run', 'CANDIDATE_EXECUTION_UNAVAILABLE');
    return value;
  }
  return Object.freeze({ run, observation });
}
