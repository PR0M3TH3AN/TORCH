import { test, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { cmdInit, cmdUpdate } from '../src/ops.mjs';

const tempBase = fs.mkdtempSync(path.join(process.cwd(), 'test-ops-'));

after(() => {
  fs.rmSync(tempBase, { recursive: true, force: true });
});

test('cmdInit creates directory structure and files', async () => {
  const projectRoot = path.join(tempBase, 'project1');
  fs.mkdirSync(projectRoot, { recursive: true });

  await cmdInit(false, projectRoot);

  const torchDir = path.join(projectRoot, 'torch');
  assert.ok(fs.existsSync(torchDir), 'torch dir created');
  assert.ok(fs.existsSync(path.join(torchDir, 'prompts', 'daily')), 'daily prompts created');
  assert.ok(fs.existsSync(path.join(torchDir, 'roster.json')), 'roster created');
  assert.ok(fs.existsSync(path.join(torchDir, 'META_PROMPTS.md')), 'META_PROMPTS.md created');

  // Check content transformation
  const metaPrompts = fs.readFileSync(path.join(torchDir, 'META_PROMPTS.md'), 'utf8');
  assert.ok(metaPrompts.includes('torch/prompts/daily/'), 'paths replaced in META_PROMPTS');
});

test('cmdInit fails if directory exists without force', async () => {
  const projectRoot = path.join(tempBase, 'project2');
  fs.mkdirSync(path.join(projectRoot, 'torch'), { recursive: true });

  await assert.rejects(
    async () => await cmdInit(false, projectRoot),
    /already exists/,
    'Should fail if torch dir exists'
  );
});

test('cmdUpdate preserves modified prompt', async () => {
  const projectRoot = path.join(tempBase, 'project3');
  fs.mkdirSync(projectRoot, { recursive: true });

  await cmdInit(false, projectRoot);

  const dailyDir = path.join(projectRoot, 'torch', 'prompts', 'daily');
  const files = fs.readdirSync(dailyDir);
  assert.ok(files.length > 0, 'Should have daily prompts');

  const targetFile = path.join(dailyDir, files[0]);
  fs.writeFileSync(targetFile, 'MODIFIED CONTENT', 'utf8');

  await cmdUpdate(false, projectRoot);

  const content = fs.readFileSync(targetFile, 'utf8');
  assert.strictEqual(content, 'MODIFIED CONTENT', 'Prompt should be preserved');
});

test('cmdUpdate overwrites prompt with force', async () => {
  const projectRoot = path.join(tempBase, 'project4');
  fs.mkdirSync(projectRoot, { recursive: true });

  await cmdInit(false, projectRoot);

  const dailyDir = path.join(projectRoot, 'torch', 'prompts', 'daily');
  const files = fs.readdirSync(dailyDir);
  const targetFile = path.join(dailyDir, files[0]);

  fs.writeFileSync(targetFile, 'MODIFIED CONTENT', 'utf8');

  await cmdUpdate(true, projectRoot); // Force update

  const content = fs.readFileSync(targetFile, 'utf8');
  assert.notStrictEqual(content, 'MODIFIED CONTENT', 'Prompt should be overwritten');
});

test('cmdUpdate creates backup', async () => {
  const projectRoot = path.join(tempBase, 'project5');
  fs.mkdirSync(projectRoot, { recursive: true });

  await cmdInit(false, projectRoot);

  await cmdUpdate(false, projectRoot);

  const torchDir = path.join(projectRoot, 'torch');
  const backupRoot = path.join(torchDir, '_backups');
  assert.ok(fs.existsSync(backupRoot), '_backups directory created');

  const entries = fs.readdirSync(backupRoot);
  assert.ok(entries.length > 0, 'Should have at least one backup');
  const backupName = entries[0];
  assert.match(backupName, /^backup_/, 'Backup directory name starts with backup_');

  const backupContent = fs.readdirSync(path.join(backupRoot, backupName));
  assert.ok(backupContent.includes('roster.json'), 'Backup contains roster.json');
});

test('torch-lock check respects local roster', async () => {
  const projectRoot = path.join(tempBase, 'project_roster');
  fs.mkdirSync(projectRoot, { recursive: true });

  // Init
  await cmdInit(false, projectRoot);

  // Modify roster
  const rosterPath = path.join(projectRoot, 'torch', 'roster.json');
  const roster = JSON.parse(fs.readFileSync(rosterPath, 'utf8'));
  roster.daily.push('custom-agent-007');
  fs.writeFileSync(rosterPath, JSON.stringify(roster, null, 2));

  // Run CLI
  const binPath = path.resolve(process.cwd(), 'bin/torch-lock.mjs');

  const output = execSync(`${process.execPath} ${binPath} check --cadence daily`, {
      cwd: projectRoot,
      encoding: 'utf8'
  });

  const result = JSON.parse(output);
  assert.ok(result.available.includes('custom-agent-007'), 'Custom agent found in roster');
});
