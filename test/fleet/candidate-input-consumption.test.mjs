import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { captureCandidateInputSnapshotV2, verifyCandidateInputSnapshotV2 } from '../../src/checks/candidate-input-snapshot.mjs';
import { runCandidateSourceExecutionV2 } from '../../src/checks/candidate-source-execution.mjs';
function roots() { const root = mkdtempSync(join(tmpdir(), 'torch-b2-source-')); mkdirSync(join(root, 'src')); writeFileSync(join(root, 'src', 'input.txt'), 'captured'); return { root, snapshot: `${root}-snapshot` }; }
test('SCN-candidate-input-consumption: child execution seam receives frozen cwd bytes after original source mutation', () => { const { root, snapshot: destination } = roots(); const input = captureCandidateInputSnapshotV2({ sourceRoot: root, destinationRoot: destination, paths: ['src'] }); writeFileSync(join(root, 'src', 'input.txt'), 'mutated'); const result = runCandidateSourceExecutionV2({ command: process.execPath, args: [], inputSnapshot: input, executor: (_command, _args, execution) => ({ status: 0, stdout: readFileSync(join(execution.cwd, 'src', 'input.txt')) }) }); assert.equal(result.terminal.success, true); assert.equal(result.output.stdout.toString(), 'captured'); assert.equal(verifyCandidateInputSnapshotV2(input).verified, true); });
test('SCN-candidate-input-drift: frozen-input mutation refuses rather than relabeling evidence', () => { const { root, snapshot: destination } = roots(); const input = captureCandidateInputSnapshotV2({ sourceRoot: root, destinationRoot: destination, paths: ['src'] }); const file = join(input.inputRoot, 'src', 'input.txt'); chmodSync(file, 0o600); writeFileSync(file, 'drift'); assert.throws(() => verifyCandidateInputSnapshotV2(input), { code: 'CANDIDATE_SNAPSHOT_DRIFT' }); });
