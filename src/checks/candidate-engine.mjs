import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { TorchError } from '../kernel/errors.mjs';

export const CANDIDATE_ENGINE_LIMITS = Object.freeze({
  maxInputBytes: 1_048_576,
  maxDefinitionBytes: 65_536,
  maxArgs: 64,
  maxArgBytes: 4_096,
  maxEnvironmentEntries: 3,
  maxEnvironmentNameBytes: 128,
  maxEnvironmentValueBytes: 4_096,
  maxOutputBytes: 65_536,
  maxArtifactPathBytes: 4_096,
  timeoutMs: 60_000,
});

/** Deterministic variables only; no ambient process environment is inherited. */
export const CANDIDATE_ENGINE_ENV_ALLOWLIST = Object.freeze({
  LANG: Object.freeze(['C.UTF-8']),
  LC_ALL: Object.freeze(['C']),
  TZ: Object.freeze(['UTC']),
});

function fail(message, code, details) {
  throw new TorchError(message, { code, details });
}

function byteLength(value) {
  return Buffer.byteLength(value, 'utf8');
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
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

function normalizeLimits(limits) {
  exactObject(limits, new Set(Object.keys(CANDIDATE_ENGINE_LIMITS)), 'limits');
  const normalized = {};
  for (const [key, maximum] of Object.entries(CANDIDATE_ENGINE_LIMITS)) {
    if (!Object.hasOwn(limits, key)) {
      fail(`Candidate-engine limit is required: ${key}`, 'CANDIDATE_ENGINE_LIMIT_INVALID', { key });
    }
    const value = limits[key];
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
  exactObject(input, new Set(['directory', 'digest', 'bytes', 'byteLength']), 'input');
  const directory = boundedString(input.directory, limits.maxArtifactPathBytes, 'input.directory');
  if (!Buffer.isBuffer(input.bytes) && !(input.bytes instanceof Uint8Array)) {
    fail('Candidate input bytes are required', 'CANDIDATE_ENGINE_INPUT_INVALID');
  }
  const snapshot = Buffer.from(input.bytes);
  if (snapshot.length > limits.maxInputBytes || !Number.isInteger(input.byteLength)
    || input.byteLength !== snapshot.length || typeof input.digest !== 'string'
    || !/^[0-9a-f]{64}$/i.test(input.digest)) {
    fail('Candidate input must be a bounded immutable byte snapshot', 'CANDIDATE_ENGINE_INPUT_INVALID');
  }
  const observedDigest = sha256(snapshot);
  if (input.digest.toLowerCase() !== observedDigest) {
    fail('Candidate input digest does not bind the supplied bytes', 'CANDIDATE_ENGINE_INPUT_INVALID');
  }
  return freeze({ directory, digest: observedDigest, bytes: snapshot.length });
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
  for (const [key, value] of entries.sort(([left], [right]) => Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8')))) {
    const allowedValues = CANDIDATE_ENGINE_ENV_ALLOWLIST[key];
    if (!allowedValues || byteLength(key) > limits.maxEnvironmentNameBytes) {
      fail('Candidate environment name is not allowlisted', 'CANDIDATE_ENGINE_ENVIRONMENT_INVALID', { key });
    }
    const bounded = boundedString(value, limits.maxEnvironmentValueBytes, `environment.${key}`);
    if (!allowedValues.includes(bounded)) {
      fail('Candidate environment value is not allowlisted', 'CANDIDATE_ENGINE_ENVIRONMENT_INVALID', { key });
    }
    normalized[key] = bounded;
  }
  return freeze(normalized);
}

function safeUtf8Prefix(bytes, limit) {
  const capped = Math.min(bytes.length, limit);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (let length = capped; length >= 0; length -= 1) {
    try {
      const text = decoder.decode(bytes.subarray(0, length));
      if (byteLength(text) <= limit) return text;
    } catch {
      // Shorten until the prefix ends on a complete UTF-8 sequence.
    }
  }
  return '';
}

function boundedOutput(value, limit) {
  const output = Buffer.isBuffer(value) ? Buffer.from(value)
    : Buffer.from(typeof value === 'string' ? value : value?.toString?.() ?? '', 'utf8');
  const bytes = output.length;
  const text = safeUtf8Prefix(output, bytes > limit ? limit : bytes);
  return freeze({ bytes, retainedBytes: byteLength(text), text, overflow: bytes > limit });
}

function normalizeError(error) {
  if (!error) return null;
  return freeze({
    code: typeof error.code === 'string' ? boundedOutput(error.code, 128).text : null,
    message: boundedOutput(typeof error.message === 'string' ? error.message : String(error), 512).text,
  });
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
  const limits = normalizeLimits(options.limits);
  const input = normalizeInput(options.input, limits);
  const definition = normalizeDefinition(options.definition, limits);
  const args = normalizeArgs(options.args ?? [], limits);
  const environment = normalizeEnvironment(options.environment ?? {}, limits);
  const artifactDirectory = boundedString(options.artifactDirectory, limits.maxArtifactPathBytes, 'artifactDirectory');
  const executor = options.executor ?? ((command, commandArgs, execution) => spawnSync(command, commandArgs, execution));
  if (typeof executor !== 'function') fail('Candidate executor must be a function', 'CANDIDATE_ENGINE_INPUT_INVALID');

  const commandArgs = freeze([...definition.args, ...args]);
  const execution = freeze({
    cwd: input.directory,
    env: environment,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: limits.maxOutputBytes,
    timeout: limits.timeoutMs,
    killSignal: 'SIGTERM',
    artifactDirectory,
  });
  let raw;
  try {
    raw = executor(definition.command, commandArgs, execution);
  } catch (error) {
    raw = { status: null, error };
  }
  const terminal = terminalObservation(raw, limits);
  return freeze({
    schema: 'torch.dev/candidate-engine-observation/v1alpha1',
    fixtureOnly: true,
    sourceAttestation: freeze({ schema: 'torch.dev/source-attestation/v1alpha1', promotion: 'nonpromotable' }),
    input, definition, args, environment, artifactDirectory, limits, terminal,
  });
}
