import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runCandidateEngine } from '../../src/checks/candidate-engine.mjs';

function fixtureInput() {
  return { directory: mkdtempSync(join(tmpdir(), 'torch-candidate-engine-')), digest: 'a'.repeat(64), bytes: 12 };
}

function fixtureOptions(overrides = {}) {
  return {
    input: fixtureInput(),
    definition: { command: 'fixture-command', args: ['--fixed'] },
    args: ['--bounded'],
    environment: { FIXTURE_MODE: '1', TZ: 'UTC' },
    artifactDirectory: mkdtempSync(join(tmpdir(), 'torch-candidate-artifacts-')),
    executor: () => ({ status: 0, stdout: 'fixture output', stderr: '' }),
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
  assert.deepEqual(invocation.execution.env, { FIXTURE_MODE: '1', TZ: 'UTC' });
  assert.equal(Object.isFrozen(invocation.execution), true);
  assert.equal(Object.hasOwn(invocation.execution, 'token'), false);
  assert.equal(Object.hasOwn(invocation.execution, 'receiptWriter'), false);
  assert.equal(Object.hasOwn(invocation.execution, 'controlPlane'), false);
});

test('SCN-candidate-engine-limits: invalid bounded inputs, arguments, environment and artifact descriptors refuse before execution', () => {
  let executions = 0;
  const executor = () => { executions += 1; return { status: 0 }; };
  assert.throws(() => runCandidateEngine(fixtureOptions({ executor, input: { directory: '/tmp', digest: 'bad', bytes: 1 } })),
    { code: 'CANDIDATE_ENGINE_INPUT_INVALID' });
  assert.throws(() => runCandidateEngine(fixtureOptions({ executor, args: ['x'.repeat(8)], limits: { maxArgBytes: 4 } })),
    { code: 'CANDIDATE_ENGINE_INPUT_INVALID' });
  assert.throws(() => runCandidateEngine(fixtureOptions({ executor, environment: { bad: '1' } })),
    { code: 'CANDIDATE_ENGINE_INPUT_INVALID' });
  assert.throws(() => runCandidateEngine(fixtureOptions({ executor, artifactDirectory: 'x'.repeat(5), limits: { maxArtifactPathBytes: 4 } })),
    { code: 'CANDIDATE_ENGINE_INPUT_INVALID' });
  assert.equal(executions, 0, 'refusal must occur before a candidate executor starts');
});

test('SCN-candidate-engine-terminal-observation: overflow, including exit zero plus ENOBUFS, is raw parent evidence and never success', () => {
  const overflow = runCandidateEngine(fixtureOptions({
    limits: { maxOutputBytes: 4 },
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
