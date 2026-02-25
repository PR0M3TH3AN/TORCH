import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { cmdInit } from '../src/ops.mjs';
import { runDoctorChecks, cmdDoctor } from '../src/cmd-doctor.mjs';

const MOCK_CONFIG = {
  installDir: 'torch',
  namespace: 'doctor-test-namespace',
  hashtag: 'doctor-test-hashtag',
  relays: ['wss://relay.damus.io'],
};

test('runDoctorChecks reports failure when TORCH is not installed', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'torch-doctor-missing-'));

  const report = runDoctorChecks({ cwd: root, nodeVersion: '22.10.0' });
  assert.equal(report.ok, false);
  assert.ok(report.checks.some((check) => check.id === 'install-detection' && check.status === 'fail'));
});

test('runDoctorChecks passes core checks after init', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'torch-doctor-healthy-'));
  await cmdInit(false, root, MOCK_CONFIG);

  // Simulate post-init dependency install for health check.
  await fs.mkdir(path.join(root, 'torch', 'node_modules'), { recursive: true });

  const report = runDoctorChecks({ cwd: root, nodeVersion: '22.10.0' });
  assert.equal(report.ok, true);
  assert.ok(report.checks.some((check) => check.id === 'memory-hook' && check.status === 'pass'));
  assert.ok(report.checks.some((check) => check.id === 'install-files' && check.status === 'pass'));
});

test('runDoctorChecks fails when memory hook is missing from existing AGENTS.md', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'torch-doctor-hook-missing-'));
  await cmdInit(false, root, MOCK_CONFIG);

  await fs.writeFile(path.join(root, 'AGENTS.md'), '# AGENTS\nNo memory section.\n', 'utf8');

  const report = runDoctorChecks({ cwd: root, nodeVersion: '22.10.0' });
  assert.equal(report.ok, false);
  const memoryCheck = report.checks.find((check) => check.id === 'memory-hook');
  assert.ok(memoryCheck);
  assert.equal(memoryCheck.status, 'fail');
});

test('cmdDoctor emits JSON report when requested', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'torch-doctor-json-'));
  await cmdInit(false, root, MOCK_CONFIG);

  const logs = [];
  const report = cmdDoctor({
    cwd: root,
    json: true,
    nodeVersion: '22.10.0',
    log: (line) => logs.push(String(line)),
  });

  assert.ok(report.summary.passed >= 1);
  assert.equal(logs.length, 1);
  assert.doesNotThrow(() => JSON.parse(logs[0]));
});
