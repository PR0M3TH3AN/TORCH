import assert from 'node:assert/strict';
import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { captureCandidateInputSnapshotV2 } from '../../src/checks/candidate-input-snapshot.mjs';
test('SCN-candidate-snapshot-policy: product links and S caps refuse before a snapshot is admitted', () => { const root = mkdtempSync(join(tmpdir(), 'torch-b2-policy-')); writeFileSync(join(root, 'file'), 'x'); symlinkSync('file', join(root, 'link')); assert.throws(() => captureCandidateInputSnapshotV2({ sourceRoot: root, destinationRoot: `${root}-snapshot`, paths: ['link'] }), { code: 'CANDIDATE_SNAPSHOT_LINK_REJECTED' }); });
