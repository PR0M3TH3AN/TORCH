import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const SCRIPT = path.resolve('scripts/agent/summarize-lock-reliability.mjs');

function runNode(args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

test('summarizes recent lock reliability by platform/cadence/backend/relay', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lock-reliability-'));
  await fs.mkdir(path.join(root, 'task-logs', 'daily'), { recursive: true });
  await fs.mkdir(path.join(root, 'task-logs', 'weekly'), { recursive: true });

  await fs.writeFile(path.join(root, 'task-logs', 'daily', '2026-02-14T00-00-00Z__agent-a__failed.md'), `---
cadence: daily
agent: agent-a
status: failed
platform: codex
backend_category: publish failed to all relays
relay_list: 'wss://relay-1.test, wss://relay-2.test'
---
# Scheduler failed
- reason: Lock backend error
`, 'utf8');

  await fs.writeFile(path.join(root, 'task-logs', 'weekly', '2026-02-14T00-00-01Z__agent-b__failed.md'), `---
cadence: weekly
agent: agent-b
status: failed
platform: codex
preflight_failure_category: relay query timeout
relay_list: 'wss://relay-1.test'
---
# Scheduler failed
- reason: Lock backend unavailable preflight
`, 'utf8');

  await fs.writeFile(path.join(root, 'task-logs', 'daily', '2026-02-14T00-00-02Z__agent-c__completed.md'), `---
cadence: daily
agent: agent-c
status: completed
platform: claude
---
# Scheduler completed
`, 'utf8');

  const result = await runNode(['--since-days', '365', '--out-dir', 'artifacts/reliability'], root);
  assert.equal(result.code, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`);

  const jsonReport = JSON.parse(await fs.readFile(path.join(root, 'artifacts', 'reliability', 'lock-reliability-summary.json'), 'utf8'));
  assert.equal(jsonReport.byPlatform.codex, 2);
  assert.equal(jsonReport.byPlatform.claude, 1);
  assert.equal(jsonReport.byCadence.daily, 2);
  assert.equal(jsonReport.byCadence.weekly, 1);
  assert.equal(jsonReport.byBackendCategory['publish failed to all relays'], 1);
  assert.equal(jsonReport.byBackendCategory['preflight:relay query timeout'], 1);
  assert.equal(jsonReport.byRelayEndpoint['wss://relay-1.test'], 2);

  const markdown = await fs.readFile(path.join(root, 'artifacts', 'reliability', 'lock-reliability-summary.md'), 'utf8');
  assert.match(markdown, /## By platform/);
  assert.match(markdown, /- codex: 2/);
});
