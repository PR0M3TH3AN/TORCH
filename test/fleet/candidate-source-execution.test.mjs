import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { captureCandidateInputSnapshotV2 } from '../../src/checks/candidate-input-snapshot.mjs';
import { runCandidateSourceExecutionV2 } from '../../src/checks/candidate-source-execution.mjs';
function snapshot() { const source = mkdtempSync(join(tmpdir(), 'torch-b2-execution-')); writeFileSync(join(source, 'input'), 'x'); return captureCandidateInputSnapshotV2({ sourceRoot: source, destinationRoot: `${source}-snapshot`, paths: ['input'] }); }
test('SCN-candidate-execution-boundary: ambient PATH/HOME fallback and output overflow cannot become success', () => { const frozen = snapshot(); assert.throws(() => runCandidateSourceExecutionV2({ command: process.execPath, inputSnapshot: frozen, environment: { PATH: '/bin' } }), { code: 'CANDIDATE_EXECUTION_INVALID' }); const observed = runCandidateSourceExecutionV2({ command: process.execPath, inputSnapshot: frozen, limits: { timeoutMs: 1000, maxOutputBytes: 4, maxArgs: 64, maxArgBytes: 4096 }, executor: () => ({ status: 0, stdout: Buffer.from('xxxxxxxx') }) }); assert.equal(observed.terminal.overflow, true); assert.equal(observed.terminal.success, false); });
