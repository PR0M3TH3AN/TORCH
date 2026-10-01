import assert from 'node:assert/strict';
import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createCandidateInputSnapshotRuntimeV2 } from '../../src/checks/candidate-input-snapshot.mjs';

test('SCN-candidate-snapshot-policy: an opaque service attempt still refuses product links before capture', () => {
  const root = mkdtempSync(join(tmpdir(), 'torch-b2-policy-')); writeFileSync(join(root, 'file'), 'x'); symlinkSync('file', join(root, 'link'));
  const states = new WeakMap(); const attempt = Object.freeze({}); states.set(attempt, { input: { sourceRoot: root, destinationRoot: `${root}-snapshot`, paths: ['link'] } });
  const snapshots = createCandidateInputSnapshotRuntimeV2({ stateForAttempt: (value) => states.get(value) });
  assert.throws(() => snapshots.capture(attempt), { code: 'CANDIDATE_SNAPSHOT_LINK_REJECTED' });
  assert.throws(() => snapshots.capture(Object.freeze({})), { code: 'CANDIDATE_SNAPSHOT_ADMISSION_REQUIRED' });
});
