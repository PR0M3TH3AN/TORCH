import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const SOURCE_SCRIPT = path.resolve('scripts/agent/run-scheduler-cycle.mjs');

const REQUIRED_LOCK_FAILURE_FIELDS = [
  'status',
  'reason',
  'backend_category',
  'lock_command',
  'lock_stderr_excerpt',
  'lock_stdout_excerpt',
  'detail',
];

const BACKEND_CATEGORY_ENUM = new Set([
  'relay_query_timeout',
  'relay_publish_quorum_failure',
  'websocket_connection_refused_or_dns',
  'malformed_relay_url_config',
  'unknown_backend_error',
]);

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

function validateLockBackendFailureFrontmatter(frontmatter) {
  for (const key of REQUIRED_LOCK_FAILURE_FIELDS) {
    assert.equal(typeof frontmatter[key], 'string', `expected ${key} to be a string`);
    assert.ok(frontmatter[key].trim().length > 0, `expected ${key} to be non-empty`);
  }

  assert.equal(frontmatter.status, 'failed', 'expected status=failed for lock-backend failure artifact');
  assert.ok(
    BACKEND_CATEGORY_ENUM.has(frontmatter.backend_category),
    `expected backend_category to be canonical enum, received: ${frontmatter.backend_category}`,
  );
}

async function setupFixture({ lockShellBody }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scheduler-lock-schema-'));
  const scriptsDir = path.join(root, 'scripts', 'agent');
  const binDir = path.join(root, 'bin');

  await fs.mkdir(path.join(root, 'src', 'prompts', 'daily'), { recursive: true });
  await fs.mkdir(scriptsDir, { recursive: true });
  await fs.mkdir(binDir, { recursive: true });

  await fs.copyFile(SOURCE_SCRIPT, path.join(scriptsDir, 'run-scheduler-cycle.mjs'));
  await fs.copyFile(path.resolve('scripts/agent/scheduler-utils.mjs'), path.join(scriptsDir, 'scheduler-utils.mjs'));
  await fs.copyFile(path.resolve('scripts/agent/scheduler-lock.mjs'), path.join(scriptsDir, 'scheduler-lock.mjs'));
  await fs.copyFile(path.resolve('scripts/agent/scheduler-config.mjs'), path.join(scriptsDir, 'scheduler-config.mjs'));
  await fs.copyFile(path.resolve('scripts/agent/scheduler-logger.mjs'), path.join(scriptsDir, 'scheduler-logger.mjs'));
  await fs.copyFile(path.resolve('scripts/agent/scheduler-state.mjs'), path.join(scriptsDir, 'scheduler-state.mjs'));
  await fs.copyFile(path.resolve('src/utils.mjs'), path.join(root, 'src', 'utils.mjs'));
  await fs.copyFile(path.resolve('src/torch-config.mjs'), path.join(root, 'src', 'torch-config.mjs'));
  await fs.copyFile(path.resolve('src/constants.mjs'), path.join(root, 'src', 'constants.mjs'));
  await fs.writeFile(path.join(scriptsDir, 'verify-run-artifacts.mjs'), '#!/usr/bin/env node\nprocess.exit(0);\n', 'utf8');
  await fs.writeFile(path.join(root, 'src', 'prompts', 'roster.json'), JSON.stringify({ daily: ['agent-a'] }, null, 2), 'utf8');
  await fs.writeFile(path.join(root, 'src', 'prompts', 'daily', 'agent-a.md'), '# agent-a\n', 'utf8');
  await fs.writeFile(
    path.join(root, 'torch-config.json'),
    JSON.stringify({
      scheduler: {
        strict_lock: true,
        firstPromptByCadence: { daily: 'agent-a' },
        handoffCommandByCadence: { daily: 'echo HANDOFF_OK' },
        validationCommandsByCadence: { daily: ['true'] },
        memoryPolicyByCadence: { daily: { mode: 'optional' } },
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
      SCHEDULER_LOCK_MAX_RETRIES: '0',
      SCHEDULER_LOCK_BACKOFF_MS: '0',
      SCHEDULER_LOCK_JITTER_MS: '0',
    },
  };
}

async function getFailedFrontmatter(root) {
  const logDir = path.join(root, 'task-logs', 'daily');
  const logs = await fs.readdir(logDir);
  const failedLog = logs.find((name) => name.endsWith('__failed.md'));
  assert.ok(failedLog, `expected __failed.md in ${logDir}`);
  const content = await fs.readFile(path.join(logDir, failedLog), 'utf8');
  return parseFrontmatter(content);
}

test('scheduler lock backend failure artifact matches required frontmatter schema', { concurrency: false }, async () => {
  const fixture = await setupFixture({
    lockShellBody: "echo 'lock_publish_quorum_failed error_category=relay_publish_quorum_failure publish failed to all relays' >&2\n    echo 'relay publish failed' >&1\n    exit 2",
  });

  const result = await runNode(fixture.scriptPath, ['--cadence', 'daily'], {
    cwd: fixture.root,
    env: fixture.env,
  });

  assert.equal(result.code, 2, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);

  const frontmatter = await getFailedFrontmatter(fixture.root);
  validateLockBackendFailureFrontmatter(frontmatter);
  assert.equal(frontmatter.backend_category, 'relay_publish_quorum_failure');
});

test('schema contract catches missing required lock-backend field', () => {
  const frontmatter = {
    status: 'failed',
    reason: 'Lock backend error',
    backend_category: 'relay_publish_quorum_failure',
    lock_command: 'npm run lock:lock -- --agent agent-a --cadence daily',
    lock_stderr_excerpt: 'relay publish failed',
    lock_stdout_excerpt: 'retrying',
    detail: 'Prompt not executed.',
  };

  delete frontmatter.lock_stdout_excerpt;

  assert.throws(
    () => validateLockBackendFailureFrontmatter(frontmatter),
    /expected lock_stdout_excerpt to be a string/,
  );
});

test('schema contract catches misnamed lock-backend key', () => {
  const frontmatter = {
    status: 'failed',
    reason: 'Lock backend error',
    backend_category: 'relay_publish_quorum_failure',
    lock_command: 'npm run lock:lock -- --agent agent-a --cadence daily',
    lock_stderr_excerpt: 'relay publish failed',
    lock_stdout_excerpt_misnamed: 'retrying',
    detail: 'Prompt not executed.',
  };

  assert.throws(
    () => validateLockBackendFailureFrontmatter(frontmatter),
    /expected lock_stdout_excerpt to be a string/,
  );
});
