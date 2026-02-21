import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const SCRIPT = path.resolve('scripts/test-audit/run-flaky-check.mjs');

function runFlakyCheck(args) {
  return new Promise((resolve) => {
    const childEnv = { ...process.env };
    delete childEnv.NODE_TEST_CONTEXT;
    delete childEnv.NODE_UNIQUE_ID;

    const child = spawn(process.execPath, [SCRIPT, ...args], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnv,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

test('run-flaky-check reports pass/fail counts from TAP output files', async () => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flaky-check-report-'));
  const passFixture = 'test/fixtures/flaky-check/pass.fixture.test.mjs';
  const failFixture = 'test/fixtures/flaky-check/fail.fixture.test.mjs';

  const result = await runFlakyCheck(['--output-dir', outputDir, passFixture, failFixture]);
  assert.equal(result.code, 0, result.stderr || result.stdout);

  const matrix = JSON.parse(await fs.readFile(path.join(outputDir, 'flakiness-matrix.json'), 'utf8'));
  assert.deepEqual(matrix[passFixture], { pass: 5, fail: 0 });
  assert.deepEqual(matrix[failFixture], { pass: 0, fail: 5 });

  const diagnostics = JSON.parse(await fs.readFile(path.join(outputDir, 'flakiness-runs.json'), 'utf8'));
  assert.equal(diagnostics.length, 5);
  assert.ok(diagnostics.every((run) => run.observed >= 2));
});
