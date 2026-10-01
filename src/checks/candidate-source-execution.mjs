import { spawnSync } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { TorchError } from '../kernel/errors.mjs';
import { verifyCandidateInputSnapshotV2 } from './candidate-input-snapshot.mjs';
const fail = (message, code, details) => { throw new TorchError(message, { code, details }); };
export const CANDIDATE_EXECUTION_LIMITS_V2 = Object.freeze({ timeoutMs: 300000, maxOutputBytes: 1048576, maxArgs: 64, maxArgBytes: 4096 });
function bound(value, limit, name) { if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > limit) fail('Candidate execution value is invalid', 'CANDIDATE_EXECUTION_INVALID', { name }); return value; }
export function runCandidateSourceExecutionV2({ command, args = [], inputSnapshot, environment = {}, executor = spawnSync, limits = CANDIDATE_EXECUTION_LIMITS_V2 } = {}) {
  if (!isAbsolute(command) || inputSnapshot?.schema !== 'torch.dev/candidate-input-snapshot/v2alpha1' || typeof executor !== 'function' || !Array.isArray(args) || args.length > limits.maxArgs || Object.keys(environment).some((key) => ['PATH', 'HOME', 'NODE_PATH', 'npm_config_cache'].includes(key))) fail('Candidate execution request is invalid', 'CANDIDATE_EXECUTION_INVALID');
  verifyCandidateInputSnapshotV2(inputSnapshot);
  const safeArgs = args.map((arg) => bound(arg, limits.maxArgBytes, 'arg')); const env = Object.freeze(Object.fromEntries(Object.entries(environment).sort()));
  let raw; try { raw = executor(command, safeArgs, { cwd: inputSnapshot.inputRoot, env, encoding: 'buffer', stdio: ['ignore', 'pipe', 'pipe'], timeout: limits.timeoutMs, maxBuffer: limits.maxOutputBytes, killSignal: 'SIGTERM' }); } catch (error) { raw = { status: null, error }; }
  const stdout = Buffer.from(raw?.stdout ?? ''); const stderr = Buffer.from(raw?.stderr ?? ''); const overflow = stdout.length > limits.maxOutputBytes || stderr.length > limits.maxOutputBytes || raw?.error?.code === 'ENOBUFS'; const timeout = raw?.error?.code === 'ETIMEDOUT' || raw?.timedOut === true;
  return Object.freeze({ schema: 'torch.dev/candidate-source-execution/v2alpha1', terminal: Object.freeze({ kind: timeout ? 'timeout' : overflow ? 'overflow' : raw?.signal ? 'signal' : raw?.error ? 'error' : 'exit', exitStatus: Number.isInteger(raw?.status) ? raw.status : null, signal: raw?.signal ?? null, overflow, timeout, success: !timeout && !overflow && !raw?.signal && !raw?.error && raw?.status === 0 }), output: Object.freeze({ stdout: stdout.subarray(0, limits.maxOutputBytes), stderr: stderr.subarray(0, limits.maxOutputBytes) }) });
}
