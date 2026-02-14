import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const SCRIPT = path.resolve('scripts/agent/verify-run-artifacts.mjs');

async function runVerify(cwd, args = []) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function setupFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'verify-run-artifacts-'));
  await fs.mkdir(path.join(root, 'src', 'context'), { recursive: true });
  await fs.mkdir(path.join(root, 'src', 'todo'), { recursive: true });
  await fs.mkdir(path.join(root, 'src', 'decisions'), { recursive: true });
  await fs.mkdir(path.join(root, 'src', 'test_logs'), { recursive: true });
  await fs.mkdir(path.join(root, 'src', 'prompts', 'daily'), { recursive: true });
  await fs.mkdir(path.join(root, 'docs', 'agent-handoffs', 'incidents'), { recursive: true });

  await fs.writeFile(path.join(root, 'src', 'prompts', 'daily', 'docs-agent.md'), '# docs-agent\n', 'utf8');

  return root;
}

async function writeArtifacts(root, { includeMetadata = true, failureId = 'ISSUE-123' } = {}) {
  const metadata = includeMetadata
    ? ['agent: docs-agent', 'cadence: daily', 'session: session-1', 'run-start: 2026-02-14T00:00:00.000Z', 'prompt-file: src/prompts/daily/docs-agent.md'].join('\n')
    : '';

  await fs.writeFile(path.join(root, 'src', 'context', 'CONTEXT_1.md'), `${metadata}\n\nGoal: update docs\nScope: scripts\nConstraints: minimal\n`, 'utf8');
  await fs.writeFile(path.join(root, 'src', 'todo', 'TODO_1.md'), `${metadata}\n\nPending tasks:\n- finish checks\n`, 'utf8');
  await fs.writeFile(path.join(root, 'src', 'decisions', 'DECISIONS_1.md'), `${metadata}\n\nDecision: keep scope tight\nRationale: minimal risk\n`, 'utf8');
  await fs.writeFile(path.join(root, 'src', 'test_logs', 'TEST_LOG_1.md'), `${metadata}\n\nCommand: npm test\nResult: failed\nFailure-ID: ${failureId}\n`, 'utf8');
}

test('passes when artifacts include metadata and failure IDs map to unresolved known issue entries', async () => {
  const root = await setupFixture();
  await writeArtifacts(root);
  await fs.writeFile(
    path.join(root, 'KNOWN_ISSUES.md'),
    `### [Issue Tracking]\n- **Status:** Open\n- **Issue-ID:** ISSUE-123\n- **Symptom:** reproducible failure\n`,
    'utf8',
  );

  const result = await runVerify(root, [
    '--agent', 'docs-agent',
    '--cadence', 'daily',
    '--prompt-path', 'src/prompts/daily/docs-agent.md',
    '--run-start', '2026-02-14T00:00:00.000Z',
    '--check-failure-notes',
  ]);

  assert.equal(result.code, 0, result.stderr || result.stdout);
});

test('fails when required metadata is missing from artifacts', async () => {
  const root = await setupFixture();
  await writeArtifacts(root, { includeMetadata: false });
  await fs.writeFile(path.join(root, 'KNOWN_ISSUES.md'), '_No active issues currently documented._\n', 'utf8');

  const result = await runVerify(root, [
    '--agent', 'docs-agent',
    '--cadence', 'daily',
    '--prompt-path', 'src/prompts/daily/docs-agent.md',
  ]);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /missing `agent:` metadata/i);
});

test('fails when failure identifiers are not cross-linked to known issues or incidents', async () => {
  const root = await setupFixture();
  await writeArtifacts(root, { includeMetadata: true, failureId: 'ISSUE-999' });
  await fs.writeFile(
    path.join(root, 'KNOWN_ISSUES.md'),
    `### [Issue Tracking]\n- **Status:** Open\n- **Issue-ID:** ISSUE-123\n`,
    'utf8',
  );

  const result = await runVerify(root, [
    '--agent', 'docs-agent',
    '--cadence', 'daily',
    '--prompt-path', 'src/prompts/daily/docs-agent.md',
    '--check-failure-notes',
  ]);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /not cross-linked/i);
});
