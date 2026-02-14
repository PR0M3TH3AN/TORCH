#!/usr/bin/env node
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
    .sort();
  return files.length ? files[files.length - 1] : null;
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

async function getSchedulerConfig(cadence) {
  const cfg = await readJson(path.resolve(process.cwd(), 'torch-config.json'), {});
  const scheduler = cfg.scheduler || {};
  return {
    firstPrompt: scheduler.firstPromptByCadence?.[cadence] || null,
    handoffCommand: scheduler.handoffCommandByCadence?.[cadence] || null,
    validationCommands: Array.isArray(scheduler.validationCommandsByCadence?.[cadence])
      ? scheduler.validationCommandsByCadence[cadence].filter((cmd) => typeof cmd === 'string' && cmd.trim())
      : ['npm', 'run', 'lint'],
  };
}

async function writeLog({ cadence, agent, status, reason, detail }) {
  const logDir = path.resolve(process.cwd(), 'task-logs', cadence);
  await fs.mkdir(logDir, { recursive: true });
  const file = `${ts()}__${agent}__${status}.md`;
  const body = [
    '---',
    `cadence: ${cadence}`,
    `agent: ${agent}`,
    `status: ${status}`,
    `timestamp: ${new Date().toISOString()}`,
    '---',
    '',
    `# Scheduler ${status}`,
    '',
    `- reason: ${reason}`,
    detail ? `- detail: ${detail}` : null,
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

  const schedulerConfig = await getSchedulerConfig(cadence);
  const logDir = path.resolve(process.cwd(), 'task-logs', cadence);

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

    const lockResult = await runCommand(
      'npm',
      ['run', 'lock:lock', '--', '--agent', selectedAgent, '--cadence', cadence],
      { env: { AGENT_PLATFORM: platform } },
    );

    if (lockResult.code === 3) {
      continue;
    }

    if (lockResult.code === 2) {
      await writeLog({
        cadence,
        agent: selectedAgent,
        status: 'failed',
        reason: 'Lock backend error',
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
    const hasPrompt = await fs.stat(promptPath).then(() => true).catch(() => false);
    if (schedulerConfig.handoffCommand) {
      const handoff = await runCommand('bash', ['-lc', schedulerConfig.handoffCommand], {
        env: { AGENT_PLATFORM: platform, SCHEDULER_AGENT: selectedAgent, SCHEDULER_CADENCE: cadence, SCHEDULER_PROMPT_PATH: promptPath },
      });
      if (handoff.code !== 0) {
        await writeLog({ cadence, agent: selectedAgent, status: 'failed', reason: 'Prompt/handoff execution failed', detail: 'Handoff callback failed.' });
        process.exit(handoff.code);
      }
    } else if (hasPrompt) {
      const catResult = await runCommand('cat', [promptPath]);
      if (catResult.code !== 0) {
        await writeLog({ cadence, agent: selectedAgent, status: 'failed', reason: 'Prompt/handoff execution failed', detail: 'Unable to read prompt file.' });
        process.exit(catResult.code);
      }
    } else {
      await writeLog({ cadence, agent: selectedAgent, status: 'failed', reason: 'Prompt/handoff execution failed', detail: 'No prompt file or handoff callback configured.' });
      process.exit(1);
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
