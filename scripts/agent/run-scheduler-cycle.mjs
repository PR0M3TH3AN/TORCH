#!/usr/bin/env node
// Source of truth: numbered MUST steps 2 and 4-14 in src/prompts/scheduler-flow.md are
// implemented by this script; step 3 (policy-file read) is best-effort and non-fatal.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const VALID_CADENCES = new Set(['daily', 'weekly']);
const ALL_EXCLUDED_REASON = 'All roster tasks currently claimed by other agents';

function parseArgs(argv) {
  const args = { cadence: null, platform: process.env.AGENT_PLATFORM || 'codex' };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (!value.startsWith('--') && !args.cadence) {
      args.cadence = value;
      continue;
    }
    if (value === '--cadence') {
      args.cadence = argv[i + 1] || null;
      i += 1;
      continue;
    }
    if (value === '--platform') {
      args.platform = argv[i + 1] || args.platform;
      i += 1;
    }
  }
  return args;
}

function ts() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');
}

function parseJsonFromOutput(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line.startsWith('{') && !line.startsWith('[')) continue;
    try {
      return JSON.parse(line);
    } catch {
      // Keep scanning from the end.
    }
  }
  return null;
}

async function runCommand(command, args = [], options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...(options.env || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function normalizeStringList(value, fallback = []) {
  if (!Array.isArray(value)) return fallback;
  return value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim());
}

function parseNonNegativeInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed;
  }
  return fallback;
}

function redactSensitive(text) {
  if (!text) return '';
  return String(text)
    .replace(/\b(BEARER\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]')
    .replace(/\b(token|api[_-]?key|secret(?:[_-]?key)?|password|passwd|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/\b(sk|pk|ghp|xoxb|xoxp)_[A-Za-z0-9_-]+\b/g, '[REDACTED]');
}

function excerptText(text, maxChars = 600) {
  const clean = redactSensitive(String(text || '').trim());
  if (!clean) return '';
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, maxChars)}…`;
}

function classifyLockBackendError(outputText) {
  const text = String(outputText || '').toLowerCase();
  if (!text.trim()) return 'unknown backend error';

  if ((text.includes('relay') || text.includes('query')) && text.includes('timeout')) {
    return 'relay query timeout';
  }

  if (text.includes('publish failed to all relays') || text.includes('failed to publish to any relay')) {
    return 'publish failed to all relays';
  }

  if (
    text.includes('connection refused')
    || text.includes('econnrefused')
    || text.includes('getaddrinfo')
    || text.includes('enotfound')
    || text.includes('eai_again')
    || (text.includes('websocket') && text.includes('dns'))
  ) {
    return 'websocket connection refused/dns';
  }

  if (
    text.includes('invalid url')
    || text.includes('malformed')
    || text.includes('unsupported protocol')
    || text.includes('must start with ws')
    || text.includes('invalid relay')
  ) {
    return 'malformed relay url/config';
  }

  return 'unknown backend error';
}

async function artifactExistsSince(filePath, sinceMs) {
  if (!filePath) return false;
  const resolved = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);
  try {
    const stat = await fs.stat(resolved);
    return stat.isFile() && stat.mtimeMs >= sinceMs;
  } catch {
    return false;
  }
}

async function verifyMemoryStep({ name, markers, artifacts, outputText, sinceMs }) {
  const markerMatched = markers.some((marker) => outputText.includes(marker));
  let artifactMatched = false;

  for (const artifact of artifacts) {
    if (await artifactExistsSince(artifact, sinceMs)) {
      artifactMatched = true;
      break;
    }
  }

  return {
    name,
    markerMatched,
    artifactMatched,
    complete: markerMatched || artifactMatched,
  };
}

function parseFrontmatterAgent(markdown) {
  const lines = markdown.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return null;
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '---') break;
    const match = line.match(/^agent\s*:\s*(.+)$/i);
    if (match?.[1]) {
      return match[1].trim().replace(/^['"]|['"]$/g, '');
    }
  }
  return null;
}

function parseFrontmatterCreatedAt(markdown) {
  const lines = markdown.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return null;
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '---') break;
    const match = line.match(/^created_at\s*:\s*(.+)$/i);
    if (match?.[1]) {
      return match[1].trim().replace(/^['"]|['"]$/g, '');
    }
  }
  return null;
}

function parseDateValue(value) {
  if (!value || typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function parseTimestampFromFilename(filename) {
  const match = String(filename).match(/^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z)__[^_]+__(completed|failed)\.md$/);
  if (!match?.[1]) return null;
  const iso = match[1].replace(/T(\d{2})-(\d{2})-(\d{2})Z$/, 'T$1:$2:$3Z');
  return parseDateValue(iso);
}

function isStrictSchedulerLogFilename(filename) {
  return /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z)__[^_]+__(completed|failed)\.md$/.test(String(filename));
}

function parseAgentFromFilename(filename) {
  const match = String(filename).match(/^.+__([^_]+?)__(completed|failed)\.md$/);
  return match?.[1] || null;
}

async function getLatestFile(logDir) {
  await fs.mkdir(logDir, { recursive: true });
  const entries = await fs.readdir(logDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((filename) => isStrictSchedulerLogFilename(filename))
    .sort((a, b) => b.localeCompare(a));

  let latest = null;

  for (const filename of files) {
    const filePath = path.join(logDir, filename);
    const content = await fs.readFile(filePath, 'utf8').catch(() => '');
    const createdAtMs = parseDateValue(parseFrontmatterCreatedAt(content));
    const fileTimestampMs = parseTimestampFromFilename(filename);
    const effectiveMs = createdAtMs ?? fileTimestampMs;

    if (!effectiveMs) {
      console.warn(`[scheduler] Ignoring invalid log timestamp in ${filename}; checking next candidate.`);
      continue;
    }

    if (!latest || effectiveMs > latest.effectiveMs) {
      latest = { filename, effectiveMs };
    }
  }

  return latest?.filename || null;
}

function selectNextAgent({ roster, excludedSet, previousAgent, firstPrompt }) {
  const previousIndex = roster.indexOf(previousAgent);
  const firstIndex = roster.indexOf(firstPrompt);
  const startIndex = previousIndex >= 0
    ? (previousIndex + 1) % roster.length
    : (firstIndex >= 0 ? firstIndex : 0);

  for (let offset = 0; offset < roster.length; offset += 1) {
    const candidate = roster[(startIndex + offset) % roster.length];
    if (!excludedSet.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function getSchedulerConfig(cadence, { isInteractive }) {
  const cfg = await readJson(path.resolve(process.cwd(), 'torch-config.json'), {});
  const scheduler = cfg.scheduler || {};
  const handoffCommand = scheduler.handoffCommandByCadence?.[cadence] || null;
  const missingHandoffCommandForMode = !isInteractive && !handoffCommand;
  const memoryPolicyRaw = scheduler.memoryPolicyByCadence?.[cadence] || {};
  const mode = memoryPolicyRaw.mode === 'required' ? 'required' : 'optional';
  const lockRetryRaw = scheduler.lockRetry || {};
  const maxRetries = parseNonNegativeInt(
    process.env.SCHEDULER_LOCK_MAX_RETRIES,
    parseNonNegativeInt(lockRetryRaw.maxRetries, 2),
  );
  const backoffMs = parseNonNegativeInt(
    process.env.SCHEDULER_LOCK_BACKOFF_MS,
    parseNonNegativeInt(lockRetryRaw.backoffMs, 250),
  );
  const jitterMs = parseNonNegativeInt(
    process.env.SCHEDULER_LOCK_JITTER_MS,
    parseNonNegativeInt(lockRetryRaw.jitterMs, 75),
  );

  return {
    firstPrompt: scheduler.firstPromptByCadence?.[cadence] || null,
    handoffCommand,
    missingHandoffCommandForMode,
    validationCommands: Array.isArray(scheduler.validationCommandsByCadence?.[cadence])
      ? scheduler.validationCommandsByCadence[cadence].filter((cmd) => typeof cmd === 'string' && cmd.trim())
      : ['npm', 'run', 'lint'],
    lockRetry: {
      maxRetries,
      backoffMs,
      jitterMs,
    },
    memoryPolicy: {
      mode,
      retrieveCommand: typeof memoryPolicyRaw.retrieveCommand === 'string' && memoryPolicyRaw.retrieveCommand.trim()
        ? memoryPolicyRaw.retrieveCommand.trim()
        : null,
      storeCommand: typeof memoryPolicyRaw.storeCommand === 'string' && memoryPolicyRaw.storeCommand.trim()
        ? memoryPolicyRaw.storeCommand.trim()
        : null,
      retrieveSuccessMarkers: normalizeStringList(memoryPolicyRaw.retrieveSuccessMarkers, ['MEMORY_RETRIEVED']),
      storeSuccessMarkers: normalizeStringList(memoryPolicyRaw.storeSuccessMarkers, ['MEMORY_STORED']),
      retrieveArtifacts: normalizeStringList(memoryPolicyRaw.retrieveArtifacts),
      storeArtifacts: normalizeStringList(memoryPolicyRaw.storeArtifacts),
    },
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireLockWithRetry({ selectedAgent, cadence, platform, lockRetry }) {
  const lockCommandArgs = ['run', 'lock:lock', '--', '--agent', selectedAgent, '--cadence', cadence];
  const backoffScheduleMs = [];
  let attempts = 0;

  while (true) {
    attempts += 1;
    const result = await runCommand('npm', lockCommandArgs, { env: { AGENT_PLATFORM: platform } });

    if (result.code !== 2) {
      return { result, attempts, backoffScheduleMs };
    }

    if (attempts > lockRetry.maxRetries) {
      return {
        result,
        attempts,
        backoffScheduleMs,
        finalBackendCategory: classifyLockBackendError(`${result.stderr}\n${result.stdout}`),
      };
    }

    const exponentialBase = lockRetry.backoffMs * (2 ** (attempts - 1));
    const jitter = lockRetry.jitterMs > 0
      ? Math.floor(Math.random() * (lockRetry.jitterMs + 1))
      : 0;
    const delayMs = exponentialBase + jitter;
    backoffScheduleMs.push(delayMs);

    console.log(JSON.stringify({
      event: 'scheduler.lock.retry',
      attempt: attempts,
      max_retries: lockRetry.maxRetries,
      delay_ms: delayMs,
      selected_agent: selectedAgent,
      cadence,
    }));

    if (delayMs > 0) {
      await sleep(delayMs);
    }
  }
}

function toYamlScalar(value) {
  const str = String(value ?? '');
  return `'${str.replace(/'/g, "''")}'`;
}

async function writeLog({ cadence, agent, status, reason, detail, metadata = {} }) {
  const logDir = path.resolve(process.cwd(), 'task-logs', cadence);
  await fs.mkdir(logDir, { recursive: true });
  const file = `${ts()}__${agent}__${status}.md`;
  const body = [
    '---',
    `cadence: ${cadence}`,
    `agent: ${agent}`,
    `status: ${status}`,
    `created_at: ${new Date().toISOString()}`,
    `timestamp: ${new Date().toISOString()}`,
    ...Object.entries(metadata)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => `${key}: ${toYamlScalar(value)}`),
    '---',
    '',
    `# Scheduler ${status}`,
    '',
    `- reason: ${reason}`,
    detail ? `- detail: ${detail}` : null,
    ...Object.entries(metadata)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => `- ${key}: ${value}`),
    '',
  ].filter(Boolean).join('\n');
  await fs.writeFile(path.join(logDir, file), body, 'utf8');
  return file;
}

async function main() {
  const { cadence, platform } = parseArgs(process.argv.slice(2));
  if (!VALID_CADENCES.has(cadence)) {
    console.error('Usage: node scripts/agent/run-scheduler-cycle.mjs <daily|weekly>');
    process.exit(1);
  }

  const roster = (await readJson(path.resolve(process.cwd(), 'src/prompts/roster.json'), {}))[cadence] || [];
  if (!Array.isArray(roster) || roster.length === 0) {
    console.error(`No roster entries for cadence ${cadence}`);
    process.exit(1);
  }

  const isInteractive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const schedulerConfig = await getSchedulerConfig(cadence, { isInteractive });
  const logDir = path.resolve(process.cwd(), 'task-logs', cadence);

  const agentsPath = path.resolve(process.cwd(), 'AGENTS.md');
  try {
    const agentsContent = await fs.readFile(agentsPath, 'utf8');
    process.stdout.write(`${agentsContent}\n`);
  } catch {
    console.log('No AGENTS.md found; continuing');
  }

  while (true) {
    const checkResult = await runCommand('npm', ['run', `lock:check:${cadence}`]);
    const checkPayload = parseJsonFromOutput(`${checkResult.stdout}\n${checkResult.stderr}`) || {};
    const excluded = Array.isArray(checkPayload.excluded)
      ? checkPayload.excluded
      : [...new Set([
          ...(Array.isArray(checkPayload.locked) ? checkPayload.locked : []),
          ...(Array.isArray(checkPayload.paused) ? checkPayload.paused : []),
          ...(Array.isArray(checkPayload.completed) ? checkPayload.completed : []),
        ])];
    const excludedSet = new Set(excluded);

    const latestFile = await getLatestFile(logDir);
    let previousAgent = null;

    if (latestFile) {
      const latestPath = path.join(logDir, latestFile);
      const content = await fs.readFile(latestPath, 'utf8').catch(() => '');
      previousAgent = parseFrontmatterAgent(content) || parseAgentFromFilename(latestFile);
      if (!roster.includes(previousAgent)) {
        previousAgent = null;
      }
    }

    const selectedAgent = selectNextAgent({
      roster,
      excludedSet,
      previousAgent,
      firstPrompt: schedulerConfig.firstPrompt,
    });

    if (!selectedAgent) {
      await writeLog({
        cadence,
        agent: 'scheduler',
        status: 'failed',
        reason: ALL_EXCLUDED_REASON,
      });
      process.exit(1);
    }

    const lockAttempt = await acquireLockWithRetry({
      selectedAgent,
      cadence,
      platform,
      lockRetry: schedulerConfig.lockRetry,
    });
    const lockResult = lockAttempt.result;

    if (lockResult.code === 3) {
      continue;
    }

    if (lockResult.code === 2) {
      const combinedLockOutput = `${lockResult.stderr}\n${lockResult.stdout}`;
      const backendCategory = lockAttempt.finalBackendCategory || classifyLockBackendError(combinedLockOutput);
      const lockCommand = `AGENT_PLATFORM=${platform} npm run lock:lock -- --agent ${selectedAgent} --cadence ${cadence}`;
      const stderrExcerpt = excerptText(lockResult.stderr);
      const stdoutExcerpt = excerptText(lockResult.stdout);
      const backoffSchedule = lockAttempt.backoffScheduleMs.join(', ');
      await writeLog({
        cadence,
        agent: selectedAgent,
        status: 'failed',
        reason: 'Lock backend error',
        detail: `Lock backend error (${backendCategory}) after ${lockAttempt.attempts} attempt(s). Retry ${lockCommand} after verifying relay connectivity, relay URLs, and DNS/network status.`,
        metadata: {
          lock_attempts_total: lockAttempt.attempts,
          lock_backoff_schedule_ms: backoffSchedule || '(none)',
          backend_category: backendCategory,
          lock_command: lockCommand,
          lock_stderr_excerpt: stderrExcerpt || '(empty)',
          lock_stdout_excerpt: stdoutExcerpt || '(empty)',
        },
      });
      process.exit(2);
    }

    if (lockResult.code !== 0) {
      await writeLog({
        cadence,
        agent: selectedAgent,
        status: 'failed',
        reason: 'Failed to acquire lock',
      });
      process.exit(lockResult.code);
    }

    const promptPath = path.resolve(process.cwd(), 'src/prompts', cadence, `${selectedAgent}.md`);
    const runArtifactSince = new Date().toISOString();
    const runStartMs = Date.parse(runArtifactSince);
    const outputChunks = [];

    if (schedulerConfig.memoryPolicy.retrieveCommand) {
      const retrieveResult = await runCommand('bash', ['-lc', schedulerConfig.memoryPolicy.retrieveCommand], {
        env: { AGENT_PLATFORM: platform, SCHEDULER_AGENT: selectedAgent, SCHEDULER_CADENCE: cadence, SCHEDULER_PROMPT_PATH: promptPath },
      });
      outputChunks.push(retrieveResult.stdout, retrieveResult.stderr);
      if (retrieveResult.code !== 0) {
        await writeLog({ cadence, agent: selectedAgent, status: 'failed', reason: 'Memory retrieval command failed', detail: schedulerConfig.memoryPolicy.retrieveCommand });
        process.exit(retrieveResult.code);
      }
    }

    if (schedulerConfig.handoffCommand) {
      const handoff = await runCommand('bash', ['-lc', schedulerConfig.handoffCommand], {
        env: { AGENT_PLATFORM: platform, SCHEDULER_AGENT: selectedAgent, SCHEDULER_CADENCE: cadence, SCHEDULER_PROMPT_PATH: promptPath },
      });
      outputChunks.push(handoff.stdout, handoff.stderr);
      if (handoff.code !== 0) {
        await writeLog({ cadence, agent: selectedAgent, status: 'failed', reason: 'Prompt/handoff execution failed', detail: 'Handoff callback failed.' });
        process.exit(handoff.code);
      }
    } else {
      const detail = schedulerConfig.missingHandoffCommandForMode
        ? 'Missing scheduler handoff command for non-interactive run. Set scheduler.handoffCommandByCadence.daily|weekly in torch-config.json.'
        : 'No handoff callback configured. Set scheduler.handoffCommandByCadence.daily|weekly in torch-config.json.';
      await writeLog({ cadence, agent: selectedAgent, status: 'failed', reason: 'Prompt/handoff execution failed', detail });
      process.exit(1);
    }

    if (schedulerConfig.memoryPolicy.storeCommand) {
      const storeResult = await runCommand('bash', ['-lc', schedulerConfig.memoryPolicy.storeCommand], {
        env: { AGENT_PLATFORM: platform, SCHEDULER_AGENT: selectedAgent, SCHEDULER_CADENCE: cadence, SCHEDULER_PROMPT_PATH: promptPath },
      });
      outputChunks.push(storeResult.stdout, storeResult.stderr);
      if (storeResult.code !== 0) {
        await writeLog({ cadence, agent: selectedAgent, status: 'failed', reason: 'Memory storage command failed', detail: schedulerConfig.memoryPolicy.storeCommand });
        process.exit(storeResult.code);
      }
    }

    const memoryOutput = outputChunks.join('\n');
    const retrieveCheck = await verifyMemoryStep({
      name: 'retrieve',
      markers: schedulerConfig.memoryPolicy.retrieveSuccessMarkers,
      artifacts: schedulerConfig.memoryPolicy.retrieveArtifacts,
      outputText: memoryOutput,
      sinceMs: runStartMs,
    });
    const storeCheck = await verifyMemoryStep({
      name: 'store',
      markers: schedulerConfig.memoryPolicy.storeSuccessMarkers,
      artifacts: schedulerConfig.memoryPolicy.storeArtifacts,
      outputText: memoryOutput,
      sinceMs: runStartMs,
    });

    const missingSteps = [retrieveCheck, storeCheck].filter((step) => !step.complete).map((step) => step.name);
    if (missingSteps.length && schedulerConfig.memoryPolicy.mode === 'required') {
      await writeLog({
        cadence,
        agent: selectedAgent,
        status: 'failed',
        reason: 'Required memory steps not verified',
        detail: `Missing evidence for: ${missingSteps.join(', ')}`,
      });
      process.exit(1);
    }

    if (missingSteps.length) {
      console.warn(`[scheduler] Optional memory evidence missing for ${missingSteps.join(', ')}.`);
    }

    const artifactCheck = await runCommand('node', [
      'scripts/agent/verify-run-artifacts.mjs',
      '--since',
      runArtifactSince,
      '--agent',
      selectedAgent,
      '--cadence',
      cadence,
      '--prompt-path',
      promptPath,
      '--run-start',
      runArtifactSince,
      '--check-failure-notes',
    ]);
    if (artifactCheck.code !== 0) {
      const detail = artifactCheck.stderr.trim() || artifactCheck.stdout.trim() || 'Artifact verification failed.';
      await writeLog({
        cadence,
        agent: selectedAgent,
        status: 'failed',
        reason: 'Missing required run artifacts',
        detail,
      });
      process.exit(artifactCheck.code);
    }

    for (const validation of schedulerConfig.validationCommands) {
      const parts = validation.split(' ').filter(Boolean);
      if (!parts.length) continue;
      const result = await runCommand(parts[0], parts.slice(1));
      if (result.code !== 0) {
        await writeLog({ cadence, agent: selectedAgent, status: 'failed', reason: 'Validation failed', detail: validation });
        process.exit(result.code);
      }
    }

    const completeResult = await runCommand(
      'npm',
      ['run', 'lock:complete', '--', '--agent', selectedAgent, '--cadence', cadence],
      { env: { AGENT_PLATFORM: platform } },
    );

    if (completeResult.code !== 0) {
      await writeLog({
        cadence,
        agent: selectedAgent,
        status: 'failed',
        reason: `Completion publish failed. Retry npm run lock:complete -- --agent ${selectedAgent} --cadence ${cadence} after verifying relay connectivity`,
      });
      process.exit(completeResult.code);
    }

    await writeLog({ cadence, agent: selectedAgent, status: 'completed', reason: 'Scheduler cycle completed successfully' });
    process.exit(0);
  }
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
