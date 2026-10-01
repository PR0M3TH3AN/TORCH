import { spawnSync } from 'node:child_process';
import { TorchError } from '../kernel/errors.mjs';

export const CANDIDATE_ENGINE_LIMITS = Object.freeze({
  maxInputBytes: 1_048_576,
  maxDefinitionBytes: 65_536,
  maxArgs: 64,
  maxArgBytes: 4_096,
  maxEnvironmentEntries: 32,
  maxEnvironmentNameBytes: 128,
  maxEnvironmentValueBytes: 4_096,
  maxOutputBytes: 65_536,
  maxArtifactPathBytes: 4_096,
});

function fail(message, code, details) {
  throw new TorchError(message, { code, details });
}

function byteLength(value) {
  return Buffer.byteLength(value, 'utf8');
}

function exactObject(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object`, 'CANDIDATE_ENGINE_INPUT_INVALID');
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${label} contains unsupported capability data`, 'CANDIDATE_ENGINE_CAPABILITY_FORBIDDEN', { key });
  }
}

function boundedString(value, limit, label) {
  if (typeof value !== 'string' || !value || byteLength(value) > limit) {
    fail(`${label} is missing or exceeds its limit`, 'CANDIDATE_ENGINE_INPUT_INVALID', { label, limit });
  }
  return value;
}

function normalizeLimits(limits = {}) {
  exactObject(limits, new Set(Object.keys(CANDIDATE_ENGINE_LIMITS)), 'limits');
  const normalized = {};
  for (const [key, maximum] of Object.entries(CANDIDATE_ENGINE_LIMITS)) {
    const value = limits[key] ?? maximum;
    if (!Number.isInteger(value) || value < 1 || value > maximum) {
      fail(`Invalid candidate-engine limit: ${key}`, 'CANDIDATE_ENGINE_LIMIT_INVALID', { key, value, maximum });
    }
    normalized[key] = value;
  }
  return Object.freeze(normalized);
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}

function normalizeInput(input, limits) {
  exactObject(input, new Set(['directory', 'digest', 'bytes']), 'input');
  const directory = boundedString(input.directory, limits.maxArtifactPathBytes, 'input.directory');
  const digest = boundedString(input.digest, 128, 'input.digest');
  if (!/^[0-9a-f]{64}$/i.test(digest) || !Number.isInteger(input.bytes) || input.bytes < 0 || input.bytes > limits.maxInputBytes) {
    fail('Candidate input must be a bounded immutable fixture descriptor', 'CANDIDATE_ENGINE_INPUT_INVALID');
  }
  return freeze({ directory, digest: digest.toLowerCase(), bytes: input.bytes });
}

function normalizeDefinition(definition, limits) {
  exactObject(definition, new Set(['command', 'args']), 'definition');
  const command = boundedString(definition.command, limits.maxArgBytes, 'definition.command');
  const args = normalizeArgs(definition.args ?? [], limits, 'definition.args');
  const normalized = { command, args };
  if (byteLength(JSON.stringify(normalized)) > limits.maxDefinitionBytes) {
    fail('Candidate definition exceeds its limit', 'CANDIDATE_ENGINE_INPUT_INVALID');
  }
  return freeze(normalized);
}

function normalizeArgs(args, limits, label = 'args') {
  if (!Array.isArray(args) || args.length > limits.maxArgs) {
    fail(`${label} exceeds its count limit`, 'CANDIDATE_ENGINE_INPUT_INVALID');
  }
  return freeze(args.map((value) => boundedString(value, limits.maxArgBytes, label)));
}

function normalizeEnvironment(environment, limits) {
  exactObject(environment, new Set(Object.keys(environment ?? {})), 'environment');
  const entries = Object.entries(environment);
  if (entries.length > limits.maxEnvironmentEntries) {
    fail('Candidate environment exceeds its entry limit', 'CANDIDATE_ENGINE_INPUT_INVALID');
  }
  const normalized = {};
  for (const [key, value] of entries.sort(([left], [right]) => left.localeCompare(right))) {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key) || byteLength(key) > limits.maxEnvironmentNameBytes) {
      fail('Candidate environment name is invalid', 'CANDIDATE_ENGINE_INPUT_INVALID', { key });
    }
    normalized[key] = boundedString(value, limits.maxEnvironmentValueBytes, `environment.${key}`);
  }
  return freeze(normalized);
}

function boundedOutput(value, limit) {
  const output = typeof value === 'string' ? value : value?.toString?.() ?? '';
  const bytes = Buffer.byteLength(output);
  return { bytes, text: bytes > limit ? output.slice(0, limit) : output, overflow: bytes > limit };
}

function normalizeError(error) {
  if (!error) return null;
  return {
    code: typeof error.code === 'string' ? error.code.slice(0, 128) : null,
    message: typeof error.message === 'string' ? error.message.slice(0, 512) : String(error).slice(0, 512),
  };
}

function terminalObservation(result, limits) {
  const stdout = boundedOutput(result?.stdout, limits.maxOutputBytes);
  const stderr = boundedOutput(result?.stderr, limits.maxOutputBytes);
  const error = normalizeError(result?.error);
  const signal = typeof result?.signal === 'string' ? result.signal : null;
  const exitStatus = Number.isInteger(result?.status) ? result.status : null;
  const timedOut = result?.timedOut === true || error?.code === 'ETIMEDOUT';
  const overflow = stdout.overflow || stderr.overflow || error?.code === 'ENOBUFS';
  let kind = 'exit';
  if (timedOut) kind = 'timeout';
  else if (overflow) kind = 'overflow';
  else if (signal) kind = 'signal';
  else if (error) kind = 'error';
  return freeze({
    kind, exitStatus, signal, error, timedOut, overflow,
    success: kind === 'exit' && exitStatus === 0,
    stdout, stderr,
  });
}

/**
 * Fixture-only Phase-A seam. It deliberately exposes a raw parent observation,
 * never a receipt, capability, ControlPlane handle, or registered project root.
 */
export function runCandidateEngine(options = {}) {
  exactObject(options, new Set(['input', 'definition', 'args', 'environment', 'artifactDirectory', 'executor', 'limits']), 'candidate engine options');
  const limits = normalizeLimits(options.limits ?? {});
  const input = normalizeInput(options.input, limits);
  const definition = normalizeDefinition(options.definition, limits);
  const args = normalizeArgs(options.args ?? [], limits);
  const environment = normalizeEnvironment(options.environment ?? {}, limits);
  const artifactDirectory = boundedString(options.artifactDirectory, limits.maxArtifactPathBytes, 'artifactDirectory');
  const executor = options.executor ?? ((command, commandArgs, execution) => spawnSync(command, commandArgs, execution));
  if (typeof executor !== 'function') fail('Candidate executor must be a function', 'CANDIDATE_ENGINE_INPUT_INVALID');

  let raw;
  try {
    raw = executor(definition.command, [...definition.args, ...args], freeze({
      cwd: input.directory,
      env: environment,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: limits.maxOutputBytes,
      artifactDirectory,
    }));
  } catch (error) {
    raw = { status: null, error };
  }
  const terminal = terminalObservation(raw, limits);
  return freeze({
    schema: 'torch.dev/candidate-engine-observation/v1alpha1',
    fixtureOnly: true,
    sourceAttestation: freeze({ schema: 'torch.dev/source-attestation/v1alpha1', promotion: 'nonpromotable' }),
    input, definition, args, environment, artifactDirectory, terminal,
  });
}
