import { test, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { cmdBackup, listBackups } from '../src/cmd-backup.mjs';

const tempBase = fs.mkdtempSync(path.join(process.cwd(), 'test-backup-'));

// Helper to setup dummy state files
function setupStateFiles(cwd) {
  const memoryDir = path.join(cwd, '.scheduler-memory');
  const logsDir = path.join(cwd, 'task-logs', 'daily');

  fs.mkdirSync(memoryDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });

  fs.writeFileSync(path.join(memoryDir, 'memory-store.json'), '{"dummy": "memory"}');
  fs.writeFileSync(path.join(logsDir, '.scheduler-run-state.json'), '{"dummy": "state"}');
}

after(() => {
  fs.rmSync(tempBase, { recursive: true, force: true });
});

test('cmdBackup creates backup directory and manifest', async () => {
  const cwd = path.join(tempBase, 'scenario-1');
  fs.mkdirSync(cwd, { recursive: true });
  setupStateFiles(cwd);

  const { backupDir, manifest } = await cmdBackup({ cwd });

  assert.ok(fs.existsSync(backupDir), 'Backup directory created');
  assert.ok(fs.existsSync(path.join(backupDir, 'backup-manifest.json')), 'Manifest created');

  const manifestContent = JSON.parse(fs.readFileSync(path.join(backupDir, 'backup-manifest.json'), 'utf8'));
  assert.strictEqual(manifestContent.backupDir, backupDir);
  assert.ok(manifestContent.createdAt);

  // Verify files are copied
  const backupMemory = path.join(backupDir, '.scheduler-memory__memory-store.json');
  assert.ok(fs.existsSync(backupMemory), 'Memory file copied');

  // captured should contain the 2 files
  assert.strictEqual(manifestContent.captured.length, 2);
});

test('cmdBackup handles missing files gracefully', async () => {
  const cwd = path.join(tempBase, 'scenario-2');
  fs.mkdirSync(cwd, { recursive: true });
  // Do NOT setup files

  const { manifest } = await cmdBackup({ cwd });

  assert.strictEqual(manifest.captured.length, 0);
  assert.strictEqual(manifest.skipped.length, 2);
  assert.strictEqual(manifest.skipped[0].reason, 'not found');
});

test('cmdBackup respects output override', async () => {
  const cwd = path.join(tempBase, 'scenario-3');
  fs.mkdirSync(cwd, { recursive: true });
  setupStateFiles(cwd);

  const outputDir = 'custom-backup-location';
  const { backupDir } = await cmdBackup({ cwd, output: outputDir });

  const expectedPath = path.resolve(cwd, outputDir);
  assert.strictEqual(backupDir, expectedPath);
  assert.ok(fs.existsSync(expectedPath));
  assert.ok(fs.existsSync(path.join(expectedPath, 'backup-manifest.json')), 'Manifest in custom output');
});

test('listBackups lists created backups', async () => {
  const cwd = path.join(tempBase, 'scenario-4');
  fs.mkdirSync(cwd, { recursive: true });
  setupStateFiles(cwd);

  // Create two backups
  await cmdBackup({ cwd });

  // Ensure we have a slight delay or just rely on execution time for timestamp diff
  // Windows/Filesystem might have low resolution, but listBackups sorts by ISO string in manifest
  await new Promise(r => setTimeout(r, 100));

  await cmdBackup({ cwd });

  const backups = await listBackups({ cwd });
  assert.strictEqual(backups.length, 2);

  // Verify sorting (newest first)
  const t0 = new Date(backups[0].createdAt).getTime();
  const t1 = new Date(backups[1].createdAt).getTime();
  assert.ok(t0 >= t1, 'Backups sorted newest first');

  // Verify properties
  assert.ok(backups[0].id);
  assert.ok(backups[0].backupDir);
  assert.ok(Array.isArray(backups[0].captured));
});
