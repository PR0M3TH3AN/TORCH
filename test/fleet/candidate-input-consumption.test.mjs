import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createCandidateInputSnapshotRuntimeV2 } from '../../src/checks/candidate-input-snapshot.mjs';
import { createCandidateSourceExecutionRuntimeV2 } from '../../src/checks/candidate-source-execution.mjs';

function attemptWithInput() {
  const root = mkdtempSync(join(tmpdir(), 'torch-b2-source-')); mkdirSync(join(root, 'src')); writeFileSync(join(root, 'src', 'input.txt'), 'captured');
  const states = new WeakMap(); const attempt = Object.freeze({});
  states.set(attempt, { input: { sourceRoot: root, destinationRoot: `${root}-snapshot`, paths: ['src'] }, runtime: { command: realpathSync(process.execPath), args: ['-e', 'process.stdout.write(require("node:fs").readFileSync("src/input.txt"))'], environment: {} } });
  return { root, attempt, states };
}

test('SCN-candidate-input-consumption: an actual fixed Node child reads frozen bytes after the original source mutates', () => {
  const { root, attempt, states } = attemptWithInput();
  const snapshots = createCandidateInputSnapshotRuntimeV2({ stateForAttempt: (value) => states.get(value) });
  snapshots.capture(attempt); writeFileSync(join(root, 'src', 'input.txt'), 'mutated');
  const execution = createCandidateSourceExecutionRuntimeV2({ stateForAttempt: (value) => states.get(value), snapshotRuntime: snapshots }).run(attempt);
  assert.equal(execution.terminal.success, true); assert.equal(execution.output.stdout.toString(), 'captured');
});

test('SCN-candidate-input-drift: a post-capture mutation refuses before a real child can be launched', () => {
  const { attempt, states } = attemptWithInput(); const snapshots = createCandidateInputSnapshotRuntimeV2({ stateForAttempt: (value) => states.get(value) });
  snapshots.capture(attempt); const file = join(snapshots.cwd(attempt), 'src', 'input.txt'); chmodSync(file, 0o600); writeFileSync(file, 'drift');
  assert.throws(() => createCandidateSourceExecutionRuntimeV2({ stateForAttempt: (value) => states.get(value), snapshotRuntime: snapshots }).run(attempt), { code: 'CANDIDATE_SNAPSHOT_DRIFT' });
});
