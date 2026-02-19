import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { detectPlatform } from '../src/utils.mjs';

const SOURCE_SCRIPT = path.resolve('scripts/agent/run-scheduler-cycle.mjs');

async function runNode(scriptPath, args, { cwd, env }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
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

async function setupFixture({ lockShellBody = ':', schedulerPolicy = {} }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scheduler-lock-e2e-'));
  const scriptsDir = path.join(root, 'scripts', 'agent');
  const binDir = path.join(root, 'bin');

  await fs.mkdir(path.join(root, 'src', 'prompts', 'daily'), { recursive: true });
  await fs.mkdir(scriptsDir, { recursive: true });
  await fs.mkdir(binDir, { recursive: true });

  await fs.copyFile(SOURCE_SCRIPT, path.join(scriptsDir, 'run-scheduler-cycle.mjs'));
  await fs.copyFile(path.resolve('scripts/agent/scheduler-utils.mjs'), path.join(scriptsDir, 'scheduler-utils.mjs'));
  await fs.copyFile(path.resolve('scripts/agent/scheduler-lock.mjs'), path.join(scriptsDir, 'scheduler-lock.mjs'));
  await fs.copyFile(path.resolve('src/utils.mjs'), path.join(root, 'src', 'utils.mjs'));
  await fs.writeFile(
    path.join(scriptsDir, 'verify-run-artifacts.mjs'),
    '#!/usr/bin/env node\nprocess.exit(0);\n',
    'utf8',
  );
  await fs.writeFile(path.join(root, 'src', 'prompts', 'roster.json'), JSON.stringify({ daily: ['agent-a'] }, null, 2));
  await fs.writeFile(path.join(root, 'src', 'prompts', 'daily', 'agent-a.md'), '# agent-a\n', 'utf8');

  await fs.writeFile(
    path.join(root, 'torch-config.json'),
    JSON.stringify({
      scheduler: {
        firstPromptByCadence: { daily: 'agent-a' },
        handoffCommandByCadence: { daily: 'echo HANDOFF_OK' },
        validationCommandsByCadence: { daily: ['true'] },
        memoryPolicyByCadence: { daily: { mode: 'optional' } },
        ...schedulerPolicy,
      },
    }, null, 2),
    'utf8',
  );

  await fs.writeFile(
    path.join(binDir, 'npm'),
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" != "run" ]]; then
  exit 1
fi
case "$2" in
  lock:check:daily)
    echo '{"excluded":[]}'
    ;;
  lock:lock)
    ${lockShellBody}
    ;;
  lock:complete|lint)
    ;;
  *)
    ;;
esac
`,
    'utf8',
  );
  await fs.chmod(path.join(binDir, 'npm'), 0o755);

  return {
    root,
    scriptPath: path.join(scriptsDir, 'run-scheduler-cycle.mjs'),
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
    },
  };
}

function parseFrontmatter(markdown) {
  const lines = String(markdown).split(/\r?\n/);
  if (lines[0] !== '---') return {};
  const result = {};

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === '---') break;
    const sep = line.indexOf(':');
    if (sep < 0) continue;
    const key = line.slice(0, sep).trim();
    const raw = line.slice(sep + 1).trim();
    result[key] = raw.startsWith("'") && raw.endsWith("'")
      ? raw.slice(1, -1).replace(/''/g, "'")
      : raw;
  }

  return result;
}

async function readLogByStatus(root, status) {
  const logDir = path.join(root, 'task-logs', 'daily');
  const logs = await fs.readdir(logDir);
  const file = logs.find((name) => name.endsWith(`__${status}.md`));
  assert.ok(file, `expected ${status} log in ${logDir}; saw: ${logs.join(', ')}`);
  const content = await fs.readFile(path.join(logDir, file), 'utf8');
  return { file, content, frontmatter: parseFrontmatter(content) };
}

test('lock preflight e2e: successful lock writes completed status snapshot', { concurrency: false }, async () => {
  const fixture = await setupFixture({ lockShellBody: ':' });
  const result = await runNode(fixture.scriptPath, ['--cadence', 'daily'], {
    cwd: fixture.root,
    env: fixture.env,
  });

  assert.equal(result.code, 0, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);

  const { frontmatter } = await readLogByStatus(fixture.root, 'completed');
  assert.deepEqual(
    {
      cadence: frontmatter.cadence,
      agent: frontmatter.agent,
      status: frontmatter.status,
      platform: frontmatter.platform,
    },
    {
      cadence: 'daily',
      agent: 'agent-a',
      status: 'completed',
      platform: detectPlatform() || 'unknown',
    },
  );
});

test('lock preflight e2e: exit code 2 quorum failure persists failed backend status and prompt-not-started marker', { concurrency: false }, async () => {
  const fixture = await setupFixture({
    schedulerPolicy: {
      strict_lock: true,
    },
    lockShellBody: "echo 'lock_publish_quorum_failed error_category=relay_publish_quorum_failure publish failed to all relays' >&2\n    exit 2",
  });

  const result = await runNode(fixture.scriptPath, ['--cadence', 'daily'], {
    cwd: fixture.root,
    env: {
      ...fixture.env,
      SCHEDULER_LOCK_MAX_RETRIES: '0',
      SCHEDULER_LOCK_BACKOFF_MS: '0',
      SCHEDULER_LOCK_JITTER_MS: '0',
    },
  });

  assert.equal(result.code, 2, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);

  const { content, frontmatter } = await readLogByStatus(fixture.root, 'failed');
  assert.deepEqual(
    {
      status: frontmatter.status,
      failure_category: frontmatter.failure_category,
      failure_class: frontmatter.failure_class,
      backend_category: frontmatter.backend_category,
    },
    {
      status: 'failed',
      failure_category: 'lock_backend_error',
      failure_class: 'backend_unavailable',
      backend_category: 'relay_publish_quorum_failure',
    },
  );

  assert.match(content, /Prompt not executed\./i);
  assert.doesNotMatch(content, /prompt_parse_error|prompt_schema_error/i);

  const stateRaw = JSON.parse(await fs.readFile(path.join(fixture.root, 'task-logs', 'daily', '.scheduler-run-state.json'), 'utf8'));
  assert.deepEqual(
    {
      has_run_date: typeof stateRaw.run_date === 'string' && stateRaw.run_date.length > 0,
      lock_deferral: stateRaw.lock_deferral,
    },
    {
      has_run_date: true,
      lock_deferral: null,
    },
  );
});

test('lock preflight e2e: non-lock failure exits failed without prompt parse/schema classification', { concurrency: false }, async () => {
  const fixture = await setupFixture({ lockShellBody: "echo 'unexpected lock command crash' >&2\n    exit 9" });

  const result = await runNode(fixture.scriptPath, ['--cadence', 'daily'], {
    cwd: fixture.root,
    env: fixture.env,
  });

  assert.equal(result.code, 9, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);

  const { content, frontmatter } = await readLogByStatus(fixture.root, 'failed');
  assert.deepEqual(
    {
      status: frontmatter.status,
      reason_line: /- reason: (.+)/.exec(content)?.[1] ?? null,
      failure_category: frontmatter.failure_category ?? null,
    },
    {
      status: 'failed',
      reason_line: 'Failed to acquire lock',
      failure_category: null,
    },
  );
  assert.doesNotMatch(content, /prompt_parse_error|prompt_schema_error/i);
});
