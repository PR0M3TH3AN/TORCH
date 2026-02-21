import { test, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { cmdInit } from '../src/ops.mjs';
import { cmdRemove } from '../src/cmd-remove.mjs';

const MOCK_CONFIG = {
  installDir: 'torch',
  namespace: 'test-namespace',
  relays: ['wss://relay.damus.io']
};

const tempBase = fs.mkdtempSync(path.join(process.cwd(), 'test-ops-remove-'));

after(() => {
  fs.rmSync(tempBase, { recursive: true, force: true });
});

test('cmdRemove reports nothing when no TORCH installation exists', async () => {
  const projectRoot = path.join(tempBase, 'empty-project');
  fs.mkdirSync(projectRoot, { recursive: true });
  // Create a basic package.json so it looks like a real project
  fs.writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify({ name: 'my-app' }));

  // Should complete without error — just reports nothing found
  await cmdRemove(true, projectRoot);

  // Project should be untouched
  assert.ok(fs.existsSync(path.join(projectRoot, 'package.json')), 'package.json still exists');
});

test('cmdRemove with --force removes torch/ directory', async () => {
  const projectRoot = path.join(tempBase, 'project-force');
  fs.mkdirSync(projectRoot, { recursive: true });

  await cmdInit(false, projectRoot, MOCK_CONFIG);

  // Verify init created the expected artifacts
  assert.ok(fs.existsSync(path.join(projectRoot, 'torch')), 'torch/ exists before remove');
  assert.ok(fs.existsSync(path.join(projectRoot, 'torch-config.json')), 'torch-config.json exists before remove');
  assert.ok(fs.existsSync(path.join(projectRoot, '.torch')), '.torch/ exists before remove');

  await cmdRemove(true, projectRoot);

  // All TORCH artifacts should be gone
  assert.ok(!fs.existsSync(path.join(projectRoot, 'torch')), 'torch/ removed');
  assert.ok(!fs.existsSync(path.join(projectRoot, 'torch-config.json')), 'torch-config.json removed');
  assert.ok(!fs.existsSync(path.join(projectRoot, '.torch')), '.torch/ removed');
});

test('cmdRemove removes runtime artifacts (task-logs, .scheduler-memory)', async () => {
  const projectRoot = path.join(tempBase, 'project-runtime');
  fs.mkdirSync(projectRoot, { recursive: true });

  await cmdInit(false, projectRoot, MOCK_CONFIG);

  // Simulate runtime artifacts that the scheduler would create
  fs.mkdirSync(path.join(projectRoot, 'task-logs', 'daily'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'task-logs', 'daily', 'run.md'), '# log');
  fs.mkdirSync(path.join(projectRoot, '.scheduler-memory'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, '.scheduler-memory', 'memory-store.json'), '{}');

  await cmdRemove(true, projectRoot);

  assert.ok(!fs.existsSync(path.join(projectRoot, 'task-logs')), 'task-logs/ removed');
  assert.ok(!fs.existsSync(path.join(projectRoot, '.scheduler-memory')), '.scheduler-memory/ removed');
});

test('cmdRemove removes src/proposals/ and cleans empty src/', async () => {
  const projectRoot = path.join(tempBase, 'project-proposals');
  fs.mkdirSync(projectRoot, { recursive: true });

  await cmdInit(false, projectRoot, MOCK_CONFIG);

  // src/proposals/ is created by cmdInit
  assert.ok(fs.existsSync(path.join(projectRoot, 'src', 'proposals')), 'src/proposals/ exists before remove');

  await cmdRemove(true, projectRoot);

  assert.ok(!fs.existsSync(path.join(projectRoot, 'src', 'proposals')), 'src/proposals/ removed');
  // src/ should also be removed since it's now empty
  assert.ok(!fs.existsSync(path.join(projectRoot, 'src')), 'empty src/ removed');
});

test('cmdRemove cleans torch:* scripts from host package.json', async () => {
  const projectRoot = path.join(tempBase, 'project-scripts');
  fs.mkdirSync(projectRoot, { recursive: true });

  // Create a host package.json with existing user scripts
  fs.writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify({
    name: 'my-app',
    scripts: {
      test: 'jest',
      build: 'webpack'
    }
  }, null, 2));

  await cmdInit(false, projectRoot, MOCK_CONFIG);

  // Verify init injected torch scripts
  const pkgBefore = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  assert.ok('torch:dashboard' in pkgBefore.scripts, 'torch:dashboard injected');
  assert.ok('torch:check' in pkgBefore.scripts, 'torch:check injected');

  await cmdRemove(true, projectRoot);

  // User scripts should remain, torch scripts should be gone
  const pkgAfter = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  assert.strictEqual(pkgAfter.scripts.test, 'jest', 'user test script preserved');
  assert.strictEqual(pkgAfter.scripts.build, 'webpack', 'user build script preserved');
  assert.ok(!('torch:dashboard' in pkgAfter.scripts), 'torch:dashboard removed');
  assert.ok(!('torch:check' in pkgAfter.scripts), 'torch:check removed');
  assert.ok(!('torch:lock' in pkgAfter.scripts), 'torch:lock removed');
  assert.ok(!('torch:health' in pkgAfter.scripts), 'torch:health removed');
  assert.ok(!('torch:memory:list' in pkgAfter.scripts), 'torch:memory:list removed');
  assert.ok(!('torch:memory:inspect' in pkgAfter.scripts), 'torch:memory:inspect removed');
});

test('cmdRemove cancels when user declines confirmation', async () => {
  const projectRoot = path.join(tempBase, 'project-cancel');
  fs.mkdirSync(projectRoot, { recursive: true });

  await cmdInit(false, projectRoot, MOCK_CONFIG);

  // Decline the confirmation
  await cmdRemove(false, projectRoot, { confirm: false });

  // Everything should still exist
  assert.ok(fs.existsSync(path.join(projectRoot, 'torch')), 'torch/ still exists after cancel');
  assert.ok(fs.existsSync(path.join(projectRoot, 'torch-config.json')), 'config still exists after cancel');
});

test('cmdRemove confirmed via mockAnswers removes artifacts', async () => {
  const projectRoot = path.join(tempBase, 'project-confirm');
  fs.mkdirSync(projectRoot, { recursive: true });

  await cmdInit(false, projectRoot, MOCK_CONFIG);

  // Confirm the removal
  await cmdRemove(false, projectRoot, { confirm: true });

  assert.ok(!fs.existsSync(path.join(projectRoot, 'torch')), 'torch/ removed after confirm');
  assert.ok(!fs.existsSync(path.join(projectRoot, 'torch-config.json')), 'config removed after confirm');
});
