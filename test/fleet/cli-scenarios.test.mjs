import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const CLI = new URL('../../bin/torch.mjs', import.meta.url).pathname;

function repo() {
  const root = mkdtempSync(join(tmpdir(), 'torch-cli-'));
  execFileSync('git', ['init', '-b', 'main', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'torch-test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'TORCH Test']);
  writeFileSync(join(root, 'README.md'), '# Fixture\n');
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'fixture']);
  return root;
}

function run(root, args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: root,
    env: { ...process.env, XDG_DATA_HOME: join(root, '.data') },
    encoding: 'utf8',
  });
}

test('SCN-cli-init: init reports analysis without creating project state', () => {
  const root = repo();
  const result = run(root, ['init', '--json']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.command, 'init');
  assert.equal(output.analysis.mutationPerformed, false);
  assert.equal(existsSync(join(root, '.torch')), false);
});

test('SCN-cli-install-approval: install requires an explicit reviewed approval flag', () => {
  const root = repo();
  const result = run(root, ['install', '--json']);
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).error, 'APPROVAL_REQUIRED');
  assert.equal(existsSync(join(root, '.torch')), false);
});
