import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createCandidateInputSnapshotRuntimeV2 } from '../../src/checks/candidate-input-snapshot.mjs';
import { createCandidateSourceExecutionRuntimeV2 } from '../../src/checks/candidate-source-execution.mjs';

test('SCN-candidate-execution-boundary: only fixed E is run and actual zero-exit output overflow is not success', () => {
  const root = mkdtempSync(join(tmpdir(), 'torch-b2-execution-')); writeFileSync(join(root, 'input'), 'x');
  const states = new WeakMap(); const attempt = Object.freeze({});
  states.set(attempt, { input: { sourceRoot: root, destinationRoot: `${root}-snapshot`, paths: ['input'] }, runtime: { command: realpathSync(process.execPath), args: ['-e', 'process.stdout.write("x".repeat(1048577))'], environment: {} } });
  const snapshots = createCandidateInputSnapshotRuntimeV2({ stateForAttempt: (value) => states.get(value) }); snapshots.capture(attempt);
  const result = createCandidateSourceExecutionRuntimeV2({ stateForAttempt: (value) => states.get(value), snapshotRuntime: snapshots }).run(attempt);
  assert.equal(result.terminal.overflow, true); assert.equal(result.terminal.success, false);
});
