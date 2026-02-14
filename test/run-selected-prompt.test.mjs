import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const SCRIPT_PATH = path.resolve('scripts/agent/run-selected-prompt.mjs');

function runScript({ cwd, env }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT_PATH], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

test('runs selected scheduler prompt through configured runner command', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'run-selected-prompt-'));
  const promptPath = path.join(root, 'prompt.md');
  await fs.writeFile(promptPath, '# hello from prompt\n', 'utf8');

  const result = await runScript({
    cwd: root,
    env: {
      ...process.env,
      SCHEDULER_PROMPT_PATH: promptPath,
      SCHEDULER_AGENT: 'agent-a',
      SCHEDULER_CADENCE: 'daily',
      SCHEDULER_AGENT_RUNNER_COMMAND: 'node -e "if(!process.env.SCHEDULER_PROMPT_MARKDOWN.includes(\'hello from prompt\')) process.exit(6)"',
    },
  });

  assert.equal(result.code, 0, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
});

test('propagates non-zero runner exit code', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'run-selected-prompt-fail-'));
  const promptPath = path.join(root, 'prompt.md');
  await fs.writeFile(promptPath, '# will fail\n', 'utf8');

  const result = await runScript({
    cwd: root,
    env: {
      ...process.env,
      SCHEDULER_PROMPT_PATH: promptPath,
      SCHEDULER_AGENT: 'agent-b',
      SCHEDULER_CADENCE: 'weekly',
      SCHEDULER_AGENT_RUNNER_COMMAND: 'node -e "process.exit(7)"',
    },
  });

  assert.equal(result.code, 7, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
});
