import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert';
import { cmdInit } from '../src/ops.mjs';

test('ops.mjs: cmdInit creates .gitignore with node_modules', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(process.cwd(), 'test-gitignore-'));

  // Clean up afterwards
  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const mockAnswers = {
    installDir: 'torch',
    namespace: 'test-ns',
    hashtag: 'test-hash',
    relays: ['wss://relay.damus.io'],
  };

  // Run init
  // We silence console logs to keep test output clean, if possible, but it's fine.
  await cmdInit(false, tmpDir, mockAnswers);

  const gitIgnorePath = path.join(tmpDir, 'torch', '.gitignore');

  if (fs.existsSync(gitIgnorePath)) {
      const content = fs.readFileSync(gitIgnorePath, 'utf8');
      assert.match(content, /node_modules/, '.gitignore should contain node_modules');
  } else {
      assert.fail('.gitignore was not created');
  }
});

test('ops.mjs: cmdInit appends to existing .gitignore', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(process.cwd(), 'test-gitignore-existing-'));

  // Clean up afterwards
  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const torchDir = path.join(tmpDir, 'torch');
  fs.mkdirSync(torchDir, { recursive: true });

  // Create existing .gitignore without node_modules
  fs.writeFileSync(path.join(torchDir, '.gitignore'), 'existing-pattern\n', 'utf8');

  const mockAnswers = {
    installDir: 'torch',
    namespace: 'test-ns',
    hashtag: 'test-hash',
    relays: ['wss://relay.damus.io'],
  };

  // Run init (force=true because directory exists)
  await cmdInit(true, tmpDir, mockAnswers);

  const gitIgnorePath = path.join(torchDir, '.gitignore');
  const content = fs.readFileSync(gitIgnorePath, 'utf8');

  assert.match(content, /existing-pattern/, 'Should preserve existing content');
  assert.match(content, /node_modules/, 'Should append node_modules');
});
