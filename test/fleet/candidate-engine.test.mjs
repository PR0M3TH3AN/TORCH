import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CANDIDATE_ENGINE_LIMITS, runCandidateEngine } from '../../src/checks/candidate-engine.mjs';

function engineLimits(overrides = {}) {
  return { ...CANDIDATE_ENGINE_LIMITS, ...overrides };
}

function fixtureInput() {
  const bytes = Buffer.from('fixture input bytes', 'utf8');
  return {
    directory: mkdtempSync(join(tmpdir(), 'torch-candidate-engine-')),
    digest: createHash('sha256').update(bytes).digest('hex'),
    bytes,
    byteLength: bytes.length,
  };
}

function fixtureOptions(overrides = {}) {
  return {
    input: fixtureInput(),
    definition: { command: 'fixture-command', args: ['--fixed'] },
    args: ['--bounded'],
    environment: { TZ: 'UTC' },
    artifactDirectory: mkdtempSync(join(tmpdir(), 'torch-candidate-artifacts-')),
    executor: () => ({ status: 0, stdout: 'fixture output', stderr: '' }),
    limits: engineLimits(),
    ...overrides,
  };
}

test('SCN-candidate-engine-pure-fixture: immutable bounded fixture execution returns only parent-observed nonpromotable evidence', () => {
  let invocation;
  const options = fixtureOptions({
    executor: (command, args, execution) => {
      invocation = { command, args, execution };
      return { status: 0, stdout: 'fixture output', stderr: '' };
    },
  });
  const observed = runCandidateEngine(options);
  assert.equal(observed.fixtureOnly, true);
  assert.deepEqual(observed.sourceAttestation, {
    schema: 'torch.dev/source-attestation/v1alpha1', promotion: 'nonpromotable',
  });
  assert.equal(Object.hasOwn(observed.sourceAttestation, 'receiptId'), false);
  assert.equal(observed.terminal.success, true);
  assert.equal(observed.terminal.kind, 'exit');
  assert.deepEqual(invocation.args, ['--fixed', '--bounded']);
  assert.equal(invocation.execution.cwd, options.input.directory);
  assert.deepEqual(invocation.execution.env, { TZ: 'UTC' });
  assert.equal(Object.isFrozen(invocation.execution), true);
  assert.equal(invocation.execution.timeout, CANDIDATE_ENGINE_LIMITS.timeoutMs);
  assert.equal(invocation.execution.maxBuffer, CANDIDATE_ENGINE_LIMITS.maxOutputBytes);
  assert.equal(Object.hasOwn(invocation.execution, 'token'), false);
  assert.equal(Object.hasOwn(invocation.execution, 'receiptWriter'), false);
  assert.equal(Object.hasOwn(invocation.execution, 'controlPlane'), false);
});

test('SCN-candidate-engine-limits: invalid bounded inputs, arguments, environment and artifact descriptors refuse before execution', () => {
  let executions = 0;
  const executor = () => { executions += 1; return { status: 0 }; };
  assert.throws(() => runCandidateEngine(fixtureOptions({ executor, input: { directory: '/tmp', digest: 'bad', bytes: Buffer.from('x'), byteLength: 1 } })),
    { code: 'CANDIDATE_ENGINE_INPUT_INVALID' });
  assert.throws(() => runCandidateEngine(fixtureOptions({ executor, args: ['x'.repeat(8)], limits: engineLimits({ maxArgBytes: 4 }) })),
    { code: 'CANDIDATE_ENGINE_INPUT_INVALID' });
  assert.throws(() => runCandidateEngine(fixtureOptions({ executor, environment: { bad: '1' } })),
    { code: 'CANDIDATE_ENGINE_ENVIRONMENT_INVALID' });
  assert.throws(() => runCandidateEngine(fixtureOptions({ executor, artifactDirectory: 'x'.repeat(5), limits: engineLimits({ maxArtifactPathBytes: 4 }) })),
    { code: 'CANDIDATE_ENGINE_INPUT_INVALID' });
  assert.throws(() => runCandidateEngine(fixtureOptions({ executor, limits: engineLimits({ maxInputBytes: 4 }) })),
    { code: 'CANDIDATE_ENGINE_INPUT_INVALID' });
  assert.throws(() => runCandidateEngine(fixtureOptions({ executor, environment: { TZ: 'UTC', LANG: 'C.UTF-8' }, limits: engineLimits({ maxEnvironmentEntries: 1 }) })),
    { code: 'CANDIDATE_ENGINE_INPUT_INVALID' });
  assert.equal(executions, 0, 'refusal must occur before a candidate executor starts');
});

test('SCN-candidate-engine-terminal-observation: overflow, including exit zero plus ENOBUFS, is raw parent evidence and never success', () => {
  const overflow = runCandidateEngine(fixtureOptions({
    limits: engineLimits({ maxOutputBytes: 4 }),
    executor: () => ({ status: 0, error: Object.assign(new Error('overflow'), { code: 'ENOBUFS' }), stdout: 'too many bytes' }),
  }));
  assert.equal(overflow.terminal.exitStatus, 0);
  assert.equal(overflow.terminal.kind, 'overflow');
  assert.equal(overflow.terminal.success, false);
  assert.equal(overflow.terminal.overflow, true);

  const timeout = runCandidateEngine(fixtureOptions({
    executor: () => ({ status: null, timedOut: true, error: Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }) }),
  }));
  assert.equal(timeout.terminal.kind, 'timeout');
  assert.equal(timeout.terminal.success, false);

  const signal = runCandidateEngine(fixtureOptions({ executor: () => ({ status: null, signal: 'SIGTERM' }) }));
  assert.equal(signal.terminal.kind, 'signal');
  assert.equal(signal.terminal.success, false);
});

test('SCN-candidate-engine-capability-boundary: registered-state and writer-shaped inputs are rejected before execution', () => {
  let executions = 0;
  const options = fixtureOptions({ executor: () => { executions += 1; return { status: 0 }; } });
  options.controlPlane = {};
  assert.throws(() => runCandidateEngine(options), { code: 'CANDIDATE_ENGINE_CAPABILITY_FORBIDDEN' });
  assert.equal(executions, 0);
});

test('SCN-candidate-engine-boundary-limits: every execution bound is explicit, finite and supplied to the native-shaped executor options', () => {
  let executions = 0;
  const executor = () => { executions += 1; return { status: 0 }; };
  const missingTimeout = engineLimits();
  delete missingTimeout.timeoutMs;
  const missingOutput = engineLimits();
  delete missingOutput.maxOutputBytes;
  const missingInput = engineLimits();
  delete missingInput.maxInputBytes;
  for (const limits of [missingTimeout, missingOutput, missingInput, engineLimits({ timeoutMs: 0 }), engineLimits({ timeoutMs: 60_001 })]) {
    assert.throws(() => runCandidateEngine(fixtureOptions({ executor, limits })), { code: 'CANDIDATE_ENGINE_LIMIT_INVALID' });
  }
  assert.equal(executions, 0, 'missing or invalid bounds refuse before execution');

  let execution;
  runCandidateEngine(fixtureOptions({ executor: (_command, _args, options) => { execution = options; return { status: 0 }; } }));
  assert.deepEqual(Object.keys(execution).sort(), ['artifactDirectory', 'cwd', 'encoding', 'env', 'killSignal', 'maxBuffer', 'stdio', 'timeout']);
  assert.equal(execution.timeout, CANDIDATE_ENGINE_LIMITS.timeoutMs);
  assert.equal(execution.maxBuffer, CANDIDATE_ENGINE_LIMITS.maxOutputBytes);
});

test('SCN-candidate-engine-utf8-overflow: retained output is a valid UTF-8 prefix inside the byte cap and cannot become success', () => {
  const fourBytes = runCandidateEngine(fixtureOptions({
    limits: engineLimits({ maxOutputBytes: 4 }),
    executor: () => ({ status: 0, stdout: '😀😀', stderr: '' }),
  }));
  assert.equal(fourBytes.terminal.stdout.text, '😀');
  assert.equal(Buffer.byteLength(fourBytes.terminal.stdout.text, 'utf8'), 4);
  assert.equal(fourBytes.terminal.overflow, true);
  assert.equal(fourBytes.terminal.success, false);

  const threeBytes = runCandidateEngine(fixtureOptions({
    limits: engineLimits({ maxOutputBytes: 3 }),
    executor: () => ({ status: 0, stdout: '😀😀', stderr: '' }),
  }));
  assert.equal(threeBytes.terminal.stdout.text, '');
  assert.equal(Buffer.byteLength(threeBytes.terminal.stdout.text, 'utf8') <= 3, true);
  assert.equal(threeBytes.terminal.stdout.text.includes('\uFFFD'), false);
  assert.equal(threeBytes.terminal.success, false);
});

test('SCN-candidate-engine-immutable-input-and-environment: only matched byte snapshots and allowlisted deterministic environment reach the executor', () => {
  let executions = 0;
  const executor = () => { executions += 1; return { status: 0 }; };
  const mismatched = fixtureInput();
  mismatched.digest = '0'.repeat(64);
  assert.throws(() => runCandidateEngine(fixtureOptions({ executor, input: mismatched })), { code: 'CANDIDATE_ENGINE_INPUT_INVALID' });
  assert.throws(() => runCandidateEngine(fixtureOptions({ executor, input: { directory: '/tmp', digest: '0'.repeat(64), byteLength: 0 } })),
    { code: 'CANDIDATE_ENGINE_INPUT_INVALID' });
  assert.throws(() => runCandidateEngine(fixtureOptions({ executor, environment: { UNREVIEWED_SECRET: '1' } })),
    { code: 'CANDIDATE_ENGINE_ENVIRONMENT_INVALID' });
  assert.equal(executions, 0, 'invalid snapshot or environment refuses before execution');

  const input = fixtureInput();
  const definition = { command: 'fixture-command', args: ['--fixed'] };
  const args = ['--bounded'];
  const environment = { TZ: 'UTC' };
  let invocation;
  const observed = runCandidateEngine(fixtureOptions({
    input, definition, args, environment,
    executor: (_command, commandArgs, execution) => {
      input.bytes.fill(0);
      definition.args[0] = '--mutated';
      args[0] = '--mutated';
      environment.TZ = 'America/New_York';
      invocation = { commandArgs, execution };
      return { status: 0 };
    },
  }));
  assert.deepEqual(invocation.commandArgs, ['--fixed', '--bounded']);
  assert.deepEqual(invocation.execution.env, { TZ: 'UTC' });
  assert.deepEqual(observed.input, {
    directory: input.directory,
    digest: createHash('sha256').update(Buffer.from('fixture input bytes')).digest('hex'),
    bytes: Buffer.byteLength('fixture input bytes'),
  });
});
