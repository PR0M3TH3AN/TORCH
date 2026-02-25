import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

function runInitWithSingleNewline(cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.resolve('bin/torch-lock.mjs'), 'init', '--force'], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.stdin.write('\n');
    child.stdin.end();

    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

test('init completes in non-interactive mode when stdin closes early', async () => {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'torch-init-noninteractive-'));
  await fs.promises.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'tmp-host', version: '1.0.0' }), 'utf8');

  const result = await runInitWithSingleNewline(tmpDir);
  assert.equal(result.code, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);

  assert.ok(fs.existsSync(path.join(tmpDir, 'torch')), 'torch directory should be created');
  assert.ok(fs.existsSync(path.join(tmpDir, 'torch-config.json')), 'root torch-config.json should be created');
  assert.ok(fs.existsSync(path.join(tmpDir, 'torch', 'src', 'prompts', 'scheduler-flow.md')), 'scheduler flow should be installed');
});
