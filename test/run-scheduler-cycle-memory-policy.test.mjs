import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SOURCE_SCRIPT = path.resolve('scripts/agent/run-scheduler-cycle.mjs');
const SNAPSHOT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '__snapshots__');

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

function extractDetailLine(markdownBody) {
  const line = String(markdownBody)
    .split(/\r?\n/)
    .find((entry) => entry.startsWith('- detail: '));
  return line ? line.slice('- detail: '.length) : '';
}

function normalizePromptFileDetail(detailLine) {
  return String(detailLine)
    .replace(/at\s+.*?agent-a\.md:/, 'at <PROMPT_PATH>:')
    .replace(/in\s+.*?agent-a\.md\./, 'in <PROMPT_PATH>.')
    .replace(/'[^']*agent-a\.md'/g, "'<PROMPT_PATH>'");
}

async function assertSnapshot(snapshotName, actual) {
  const expected = await fs.readFile(path.join(SNAPSHOT_DIR, snapshotName), 'utf8');
  assert.equal(actual, expected);
}

async function setupFixture({
  memoryPolicy,
  lockShellBody = '',
  roster = ['agent-a'],
  lockHealthPreflight = undefined,
  schedulerPolicy = {},
  preflightScript = '#!/usr/bin/env node\nconsole.log(JSON.stringify({ ok: true, relays: ["wss://relay.test"] }));\nprocess.exit(0);\n',
}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scheduler-memory-policy-'));
  const scriptsDir = path.join(root, 'scripts', 'agent');
  const binDir = path.join(root, 'bin');

  await fs.mkdir(path.join(root, 'src', 'prompts'), { recursive: true });
  await fs.mkdir(path.join(root, 'src', 'prompts', 'daily'), { recursive: true });
  await fs.mkdir(scriptsDir, { recursive: true });
  await fs.mkdir(binDir, { recursive: true });

  await fs.copyFile(SOURCE_SCRIPT, path.join(scriptsDir, 'run-scheduler-cycle.mjs'));
  await fs.copyFile(path.resolve('scripts/agent/scheduler-utils.mjs'), path.join(scriptsDir, 'scheduler-utils.mjs'));
  await fs.copyFile(path.resolve('scripts/agent/scheduler-lock.mjs'), path.join(scriptsDir, 'scheduler-lock.mjs'));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.copyFile(path.resolve('src/utils.mjs'), path.join(root, 'src/utils.mjs'));
  await fs.writeFile(
    path.join(scriptsDir, 'verify-run-artifacts.mjs'),
    '#!/usr/bin/env node\nprocess.exit(0);\n',
    'utf8',
  );
  await fs.writeFile(path.join(scriptsDir, 'check-relay-health.mjs'), preflightScript, 'utf8');

  await fs.writeFile(path.join(root, 'src', 'prompts', 'roster.json'), JSON.stringify({ daily: roster }, null, 2));
  for (const agent of roster) {
    await fs.writeFile(path.join(root, 'src', 'prompts', 'daily', `${agent}.md`), `# ${agent}\n`, 'utf8');
  }

  await fs.writeFile(
    path.join(root, 'torch-config.json'),
    JSON.stringify({
      scheduler: {
        firstPromptByCadence: { daily: 'agent-a' },
        handoffCommandByCadence: { daily: 'echo HANDOFF_OK' },
        validationCommandsByCadence: { daily: ['true'] },
        memoryPolicyByCadence: { daily: memoryPolicy },
        ...schedulerPolicy,
        ...(lockHealthPreflight === undefined ? {} : { lockHealthPreflight }),
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
  lock:health)
    shift 2
    if [[ "\${1:-}" == "--" ]]; then
      shift
    fi
    node scripts/agent/check-relay-health.mjs "$@"
    ;;
  lock:lock)
${lockShellBody || '    :'}
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

test('fails required memory policy when retrieval/storage evidence is missing', { concurrency: false }, async () => {
  const fixture = await setupFixture({
    memoryPolicy: {
      mode: 'required',
      retrieveCommand: 'echo RETRIEVE_WITHOUT_MARKER',
      storeCommand: 'echo STORE_WITHOUT_MARKER',
      retrieveSuccessMarkers: ['MEMORY_RETRIEVED'],
      storeSuccessMarkers: ['MEMORY_STORED'],
      retrieveArtifacts: [],
      storeArtifacts: [],
    },
  });

  const result = await runNode(fixture.scriptPath, ['--cadence', 'daily'], {
    cwd: fixture.root,
    env: fixture.env,
  });

  assert.equal(result.code, 1, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
  const logs = await fs.readdir(path.join(fixture.root, 'task-logs', 'daily'));
  const failedLog = logs.find((name) => name.endsWith('__failed.md'));
  assert.ok(failedLog);
  const failedBody = await fs.readFile(path.join(fixture.root, 'task-logs', 'daily', failedLog), 'utf8');
  assert.match(failedBody, /Required memory steps not verified/);
});

test('accepts required memory policy when markers or artifacts are produced', { concurrency: false }, async () => {
  const fixture = await setupFixture({
    memoryPolicy: {
      mode: 'required',
      retrieveCommand: 'echo MEMORY_RETRIEVED && mkdir -p .scheduler-memory && : > .scheduler-memory/retrieve-daily.ok',
      storeCommand: 'echo MEMORY_STORED && mkdir -p .scheduler-memory && : > .scheduler-memory/store-daily.ok',
      retrieveSuccessMarkers: ['MEMORY_RETRIEVED'],
      storeSuccessMarkers: ['MEMORY_STORED'],
      retrieveArtifacts: ['.scheduler-memory/retrieve-daily.ok'],
      storeArtifacts: ['.scheduler-memory/store-daily.ok'],
    },
  });

  const result = await runNode(fixture.scriptPath, ['--cadence', 'daily'], {
    cwd: fixture.root,
    env: fixture.env,
  });

  assert.equal(result.code, 0, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);

  const logs = await fs.readdir(path.join(fixture.root, 'task-logs', 'daily'));
  const completedLog = logs.find((name) => name.endsWith('__completed.md'));
  assert.ok(completedLog);
  const completedBody = await fs.readFile(path.join(fixture.root, 'task-logs', 'daily', completedLog), 'utf8');
  assert.match(completedBody, /platform: '(codex|unknown|jules|goose)'/);

  await fs.access(path.join(fixture.root, '.scheduler-memory', 'retrieve-daily.ok'));
  await fs.access(path.join(fixture.root, '.scheduler-memory', 'store-daily.ok'));
});

test('records backend failure metadata when lock command exits with code 2', { concurrency: false }, async () => {
  const fixture = await setupFixture({
    memoryPolicy: { mode: 'optional' },
    lockShellBody: `    echo 'publish failed to all relays token=abc123 SECRET_KEY=xyz987' >&2
    echo 'websocket: connection refused' >&1
    exit 2`,
  });

  const result = await runNode(fixture.scriptPath, ['--cadence', 'daily'], {
    cwd: fixture.root,
    env: fixture.env,
  });

  assert.equal(result.code, 2, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);

  const logs = await fs.readdir(path.join(fixture.root, 'task-logs', 'daily'));
  const failedLog = logs.find((name) => name.endsWith('__failed.md'));
  assert.ok(failedLog);
  const failedBody = await fs.readFile(path.join(fixture.root, 'task-logs', 'daily', failedLog), 'utf8');

  assert.match(failedBody, /reason: Lock backend error/);
  assert.match(failedBody, /failure_class: 'backend_unavailable'/);
  assert.match(failedBody, /failure_category: 'lock_backend_error'/);
  assert.match(failedBody, /backend_category: 'relay_publish_quorum_failure'/);
  assert.match(failedBody, /lock_command: 'AGENT_PLATFORM=codex npm run lock:lock -- --agent agent-a --cadence daily'/);
  assert.match(failedBody, /lock_stderr_excerpt: 'publish failed to all relays token=\[REDACTED\] SECRET_KEY=\[REDACTED\]'/);
  assert.match(failedBody, /lock_stdout_excerpt: 'websocket: connection refused'/);
  assert.match(failedBody, /lock_failure_reason_distribution: '\{\}'/);
  assert.match(failedBody, /lock_attempt_id: '3'/);
  assert.match(failedBody, /lock_correlation_id: 'daily:agent-a:/);
  assert.match(failedBody, /Likely backend\/relay connectivity issue during lock acquisition\./);
  assert.match(failedBody, /Retry command: npm run scheduler:daily/);
  assert.match(failedBody, /Recommended auto-remediation:/);
  assert.match(failedBody, /Run health check: npm run lock:health -- --cadence daily/);
  assert.match(failedBody, /Review incident runbook: docs\/agent-handoffs\/learnings\/2026-02-15-relay-health-preflight-job.md/);
  assert.match(failedBody, /Prompt not executed\./);
  assert.match(failedBody, /platform: '(codex|unknown|jules|goose)'/);

  const detail = extractDetailLine(failedBody);
  await assertSnapshot('lock-backend-error-detail.snapshot.txt', `${detail}\n`);
});

test('defers backend failures in non-strict mode and reuses idempotency key on successful retry', { concurrency: false }, async () => {
  const fixture = await setupFixture({
    memoryPolicy: { mode: 'optional' },
    schedulerPolicy: {
      strict_lock: false,
      degraded_lock_retry_window: 3600000,
      max_deferrals: 3,
    },
    lockShellBody: `    count_file="$PWD/.lock-count"
    key_log="$PWD/.idempotency-keys"
    count=0
    if [[ -f "$count_file" ]]; then
      count="$(cat "$count_file")"
    fi
    count=$((count + 1))
    echo "$count" > "$count_file"
    echo "\${SCHEDULER_LOCK_IDEMPOTENCY_KEY:-missing}" >> "$key_log"
    if [[ "$count" -lt 3 ]]; then
      echo 'relay query timeout' >&2
      exit 2
    fi
    :`,
  });

  const first = await runNode(fixture.scriptPath, ['--cadence', 'daily'], {
    cwd: fixture.root,
    env: {
      ...fixture.env,
      SCHEDULER_LOCK_MAX_RETRIES: '0',
      SCHEDULER_LOCK_BACKOFF_MS: '0',
      SCHEDULER_LOCK_JITTER_MS: '0',
    },
  });
  assert.equal(first.code, 0, `stdout: ${first.stdout}\nstderr: ${first.stderr}`);

  const second = await runNode(fixture.scriptPath, ['--cadence', 'daily'], {
    cwd: fixture.root,
    env: {
      ...fixture.env,
      SCHEDULER_LOCK_MAX_RETRIES: '0',
      SCHEDULER_LOCK_BACKOFF_MS: '0',
      SCHEDULER_LOCK_JITTER_MS: '0',
    },
  });
  assert.equal(second.code, 0, `stdout: ${second.stdout}\nstderr: ${second.stderr}`);

  const third = await runNode(fixture.scriptPath, ['--cadence', 'daily'], {
    cwd: fixture.root,
    env: {
      ...fixture.env,
      SCHEDULER_LOCK_MAX_RETRIES: '0',
      SCHEDULER_LOCK_BACKOFF_MS: '0',
      SCHEDULER_LOCK_JITTER_MS: '0',
    },
  });
  assert.equal(third.code, 0, `stdout: ${third.stdout}\nstderr: ${third.stderr}`);

  const logs = await fs.readdir(path.join(fixture.root, 'task-logs', 'daily'));
  const deferredLog = logs.find((name) => name.endsWith('__deferred.md'));
  assert.ok(deferredLog);
  const deferredBody = await fs.readFile(path.join(fixture.root, 'task-logs', 'daily', deferredLog), 'utf8');
  assert.match(deferredBody, /failure_class: 'backend_unavailable'/);
  assert.match(deferredBody, /failure_category: 'lock_backend_error'/);
  assert.match(deferredBody, /deferral_attempt_count: '\d+'/);

  const keyLog = await fs.readFile(path.join(fixture.root, '.idempotency-keys'), 'utf8');
  const keys = keyLog.trim().split(/\r?\n/).filter(Boolean);
  assert.equal(keys.length, 3);
  assert.equal(keys[0], 'missing');
  assert.notEqual(keys[1], 'missing');
  assert.equal(keys[1], keys[2]);
});

test('fails after exceeding non-strict deferral budget', { concurrency: false }, async () => {
  const fixture = await setupFixture({
    memoryPolicy: { mode: 'optional' },
    schedulerPolicy: {
      strict_lock: false,
      degraded_lock_retry_window: 3600000,
      max_deferrals: 1,
    },
    lockShellBody: `    echo 'publish failed to all relays' >&2
    exit 2`,
  });

  const first = await runNode(fixture.scriptPath, ['--cadence', 'daily'], {
    cwd: fixture.root,
    env: {
      ...fixture.env,
      SCHEDULER_LOCK_MAX_RETRIES: '0',
      SCHEDULER_LOCK_BACKOFF_MS: '0',
      SCHEDULER_LOCK_JITTER_MS: '0',
    },
  });
  assert.equal(first.code, 0, `stdout: ${first.stdout}\nstderr: ${first.stderr}`);

  const second = await runNode(fixture.scriptPath, ['--cadence', 'daily'], {
    cwd: fixture.root,
    env: {
      ...fixture.env,
      SCHEDULER_LOCK_MAX_RETRIES: '0',
      SCHEDULER_LOCK_BACKOFF_MS: '0',
      SCHEDULER_LOCK_JITTER_MS: '0',
    },
  });
  assert.equal(second.code, 2, `stdout: ${second.stdout}\nstderr: ${second.stderr}`);

  const logs = await fs.readdir(path.join(fixture.root, 'task-logs', 'daily'));
  const failedLog = logs.find((name) => name.endsWith('__failed.md'));
  assert.ok(failedLog);
  const failedBody = await fs.readFile(path.join(fixture.root, 'task-logs', 'daily', failedLog), 'utf8');
  assert.match(failedBody, /failure_class: 'backend_unavailable'/);
  assert.match(failedBody, /failure_category: 'lock_backend_error'/);
  assert.match(failedBody, /deferral_attempt_count: '2'/);
});

test('strict lock mode fails immediately without deferral', { concurrency: false }, async () => {
  const fixture = await setupFixture({
    memoryPolicy: { mode: 'optional' },
    schedulerPolicy: {
      strict_lock: true,
      degraded_lock_retry_window: 3600000,
      max_deferrals: 5,
    },
    lockShellBody: `    echo 'relay timeout' >&2
    exit 2`,
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

  const logs = await fs.readdir(path.join(fixture.root, 'task-logs', 'daily'));
  assert.equal(logs.some((name) => name.endsWith('__deferred.md')), false);
  const failedLog = logs.find((name) => name.endsWith('__failed.md'));
  assert.ok(failedLog);
});



test('skips lock health preflight by default when not enabled', { concurrency: false }, async () => {
  const fixture = await setupFixture({
    memoryPolicy: { mode: 'optional' },
    preflightScript: '#!/usr/bin/env node\nconsole.error("preflight should not run");\nprocess.exit(9);\n',
  });

  const result = await runNode(fixture.scriptPath, ['--cadence', 'daily'], {
    cwd: fixture.root,
    env: fixture.env,
  });

  assert.equal(result.code, 0, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
  const logs = await fs.readdir(path.join(fixture.root, 'task-logs', 'daily'));
  assert.ok(logs.some((name) => name.endsWith('__completed.md')));
});

test('fails scheduler with preflight metadata when lock health preflight is enabled', { concurrency: false }, async () => {
  const fixture = await setupFixture({
    memoryPolicy: { mode: 'optional' },
    lockHealthPreflight: true,
    preflightScript: `#!/usr/bin/env node
console.log(JSON.stringify({
  ok: false,
  relays: ['wss://relay-1.test', 'wss://relay-2.test'],
  failureCategory: 'relay query timeout',
  error: 'Relay query timed out'
}));
process.exit(2);
`,
  });

  const result = await runNode(fixture.scriptPath, ['--cadence', 'daily'], {
    cwd: fixture.root,
    env: fixture.env,
  });

  assert.equal(result.code, 2, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);

  const logs = await fs.readdir(path.join(fixture.root, 'task-logs', 'daily'));
  const failedLog = logs.find((name) => name.endsWith('__failed.md'));
  assert.ok(failedLog);
  const failedBody = await fs.readFile(path.join(fixture.root, 'task-logs', 'daily', failedLog), 'utf8');

  assert.match(failedBody, /reason: Lock backend unavailable preflight/);
  assert.match(failedBody, /prompt not executed/i);
  assert.match(failedBody, /failure_category: 'lock_backend_error'/);
  assert.match(failedBody, /preflight_failure_category: 'relay query timeout'/);
  assert.match(failedBody, /relay_list: 'wss:\/\/relay-1.test, wss:\/\/relay-2.test'/);
});


test('categorizes unreadable prompt files as prompt_parse_error', { concurrency: false }, async () => {
  const fixture = await setupFixture({
    memoryPolicy: { mode: 'optional' },
  });

  await fs.unlink(path.join(fixture.root, 'src', 'prompts', 'daily', 'agent-a.md'));

  const result = await runNode(fixture.scriptPath, ['--cadence', 'daily'], {
    cwd: fixture.root,
    env: fixture.env,
  });

  assert.equal(result.code, 1, `stdout: ${result.stdout}
stderr: ${result.stderr}`);
  const logs = await fs.readdir(path.join(fixture.root, 'task-logs', 'daily'));
  const failedLog = logs.find((name) => name.endsWith('__failed.md'));
  assert.ok(failedLog);
  const failedBody = await fs.readFile(path.join(fixture.root, 'task-logs', 'daily', failedLog), 'utf8');
  assert.match(failedBody, /reason: Prompt file parse\/read failed/);
  assert.match(failedBody, /failure_category: 'prompt_parse_error'/);
  assert.doesNotMatch(failedBody, /Recommended auto-remediation|Run health check: npm run lock:health|Retry command: npm run scheduler:/);

  const detail = normalizePromptFileDetail(extractDetailLine(failedBody));
  await assertSnapshot('prompt-parse-error-detail.snapshot.txt', `${detail}\n`);
});

test('categorizes invalid prompt schema as prompt_schema_error', { concurrency: false }, async () => {
  const fixture = await setupFixture({
    memoryPolicy: { mode: 'optional' },
  });

  await fs.writeFile(path.join(fixture.root, 'src', 'prompts', 'daily', 'agent-a.md'), 'plain text without heading\n', 'utf8');

  const result = await runNode(fixture.scriptPath, ['--cadence', 'daily'], {
    cwd: fixture.root,
    env: fixture.env,
  });

  assert.equal(result.code, 1, `stdout: ${result.stdout}
stderr: ${result.stderr}`);
  const logs = await fs.readdir(path.join(fixture.root, 'task-logs', 'daily'));
  const failedLog = logs.find((name) => name.endsWith('__failed.md'));
  assert.ok(failedLog);
  const failedBody = await fs.readFile(path.join(fixture.root, 'task-logs', 'daily', failedLog), 'utf8');
  assert.match(failedBody, /reason: Prompt file schema validation failed/);
  assert.match(failedBody, /failure_category: 'prompt_schema_error'/);
});

test('categorizes handoff runtime failures as execution_error', { concurrency: false }, async () => {
  const fixture = await setupFixture({
    memoryPolicy: { mode: 'optional' },
    schedulerPolicy: {
      handoffCommandByCadence: { daily: 'exit 7' },
    },
  });

  const result = await runNode(fixture.scriptPath, ['--cadence', 'daily'], {
    cwd: fixture.root,
    env: fixture.env,
  });

  assert.equal(result.code, 7, `stdout: ${result.stdout}
stderr: ${result.stderr}`);
  const logs = await fs.readdir(path.join(fixture.root, 'task-logs', 'daily'));
  const failedLog = logs.find((name) => name.endsWith('__failed.md'));
  assert.ok(failedLog);
  const failedBody = await fs.readFile(path.join(fixture.root, 'task-logs', 'daily', failedLog), 'utf8');
  assert.match(failedBody, /reason: Prompt\/handoff execution failed/);
  assert.match(failedBody, /failure_category: 'execution_error'/);
});

test('retries lock acquisition for backend error and succeeds on a later attempt', { concurrency: false }, async () => {
  const fixture = await setupFixture({
    memoryPolicy: { mode: 'optional' },
    lockShellBody: `    count_file="$PWD/.lock-count"
    count=0
    if [[ -f "$count_file" ]]; then
      count="$(cat "$count_file")"
    fi
    count=$((count + 1))
    echo "$count" > "$count_file"
    if [[ "$count" -lt 2 ]]; then
      echo 'relay query timeout' >&2
      exit 2
    fi
    :`,
  });

  const result = await runNode(fixture.scriptPath, ['--cadence', 'daily'], {
    cwd: fixture.root,
    env: {
      ...fixture.env,
      SCHEDULER_LOCK_MAX_RETRIES: '2',
      SCHEDULER_LOCK_BACKOFF_MS: '0',
      SCHEDULER_LOCK_JITTER_MS: '0',
    },
  });

  assert.equal(result.code, 0, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert.match(result.stdout, /"event":"scheduler.lock.retry"/);
  const logs = await fs.readdir(path.join(fixture.root, 'task-logs', 'daily'));
  assert.equal(logs.filter((name) => name.endsWith('__failed.md')).length, 0);
});

test('stops retrying after configured lock backend retries are exhausted', { concurrency: false }, async () => {
  const fixture = await setupFixture({
    memoryPolicy: { mode: 'optional' },
    lockShellBody: `    echo 'publish failed to all relays' >&2
    exit 2`,
  });

  const result = await runNode(fixture.scriptPath, ['--cadence', 'daily'], {
    cwd: fixture.root,
    env: {
      ...fixture.env,
      SCHEDULER_LOCK_MAX_RETRIES: '1',
      SCHEDULER_LOCK_BACKOFF_MS: '0',
      SCHEDULER_LOCK_JITTER_MS: '0',
    },
  });

  assert.equal(result.code, 2, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
  const logs = await fs.readdir(path.join(fixture.root, 'task-logs', 'daily'));
  const failedLog = logs.find((name) => name.endsWith('__failed.md'));
  assert.ok(failedLog);
  const failedBody = await fs.readFile(path.join(fixture.root, 'task-logs', 'daily', failedLog), 'utf8');

  assert.match(failedBody, /lock_attempts_total: '2'/);
  assert.match(failedBody, /lock_backoff_schedule_ms: '0'/);
  assert.match(failedBody, /backend_category: 'relay_publish_quorum_failure'/);
});

test('does not use backend retry flow for exit code 3 lock conflicts', { concurrency: false }, async () => {
  const fixture = await setupFixture({
    memoryPolicy: { mode: 'optional' },
    lockShellBody: `    count_file="$PWD/.lock-count"
    count=0
    if [[ -f "$count_file" ]]; then
      count="$(cat "$count_file")"
    fi
    count=$((count + 1))
    echo "$count" > "$count_file"
    if [[ "$count" -eq 1 ]]; then
      exit 3
    fi
    :`,
  });

  const result = await runNode(fixture.scriptPath, ['--cadence', 'daily'], {
    cwd: fixture.root,
    env: {
      ...fixture.env,
      SCHEDULER_LOCK_MAX_RETRIES: '3',
      SCHEDULER_LOCK_BACKOFF_MS: '0',
      SCHEDULER_LOCK_JITTER_MS: '0',
    },
  });

  assert.equal(result.code, 0, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert.doesNotMatch(result.stdout, /"event":"scheduler.lock.retry"/);
});
