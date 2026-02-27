import fsSync from 'node:fs';
import path from 'node:path';
import {
  readJson,
  normalizeStringList,
  parseNonNegativeInt,
  parseBooleanFlag,
} from './scheduler-utils.mjs';
import { detectPlatform } from '../../src/utils.mjs';
import { getTorchConfigPath } from '../../src/torch-config.mjs';

export const VALID_CADENCES = new Set(['daily', 'weekly']);

/**
 * Parses CLI arguments into a structured options object.
 * Supports both positional cadence (`daily`|`weekly`) and named flags.
 * Falls back to AGENT_PLATFORM env var or auto-detected platform for platform.
 *
 * @param {string[]} argv - process.argv slice (args after the script name)
 * @returns {{ cadence: string|null, platform: string, model: string|null }}
 */
export function parseArgs(argv) {
  const args = { cadence: null, platform: process.env.AGENT_PLATFORM || detectPlatform() || 'unknown', model: process.env.AGENT_MODEL || null };
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
    if (value === '--model') {
      args.model = argv[i + 1] || args.model;
      i += 1;
    }
  }
  return args;
}

/**
 * Loads and normalizes scheduler configuration for the given cadence.
 * Merges torch-config.json settings with environment variable overrides.
 *
 * Configuration covers:
 *  - handoffCommand: shell command to execute the selected agent's prompt.
 *  - validationCommands: commands that must pass before lock:complete (default: npm run lint).
 *  - lockRetry: maxRetries, backoffMs, jitterMs for lock acquisition retries.
 *  - lockHealthPreflight: whether to probe relay health before lock acquisition.
 *  - lockFailurePolicy: strictLock, degradedLockRetryWindowMs, maxDeferrals.
 *  - memoryPolicy: mode (required|optional), retrieve/store commands, markers, artifacts.
 *
 * Environment variable overrides (all optional):
 *  SCHEDULER_LOCK_MAX_RETRIES, SCHEDULER_LOCK_BACKOFF_MS, SCHEDULER_LOCK_JITTER_MS,
 *  SCHEDULER_LOCK_HEALTH_PREFLIGHT, SCHEDULER_SKIP_LOCK_HEALTH_PREFLIGHT,
 *  SCHEDULER_STRICT_LOCK, SCHEDULER_DEGRADED_LOCK_RETRY_WINDOW_MS, SCHEDULER_MAX_DEFERRALS
 *
 * @param {string} cadence - 'daily'|'weekly'
 * @param {{ isInteractive: boolean }} options
 * @returns {Promise<Object>} Normalized scheduler config object.
 */
export async function getSchedulerConfig(cadence, { isInteractive }) {
  const configPath = getTorchConfigPath();
  const cfg = await readJson(configPath, {});
  const configDir = path.dirname(configPath);
  const runtimeDir = process.cwd();

  const resolveNodeCommand = (command) => {
    if (typeof command !== 'string') return command;
    const trimmed = command.trim();
    if (!trimmed.startsWith('node ')) return trimmed;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) return trimmed;
    const scriptArg = parts[1];
    if (!scriptArg || scriptArg.startsWith('-') || path.isAbsolute(scriptArg)) return trimmed;
    const absoluteScriptPath = path.resolve(configDir, scriptArg);
    if (!fsSync.existsSync(absoluteScriptPath)) return trimmed;
    const rewrittenScriptPath = path.relative(runtimeDir, absoluteScriptPath).split(path.sep).join('/');
    if (!rewrittenScriptPath || rewrittenScriptPath.startsWith('..')) return trimmed;
    parts[1] = rewrittenScriptPath;
    return parts.join(' ');
  };

  const scheduler = cfg.scheduler || {};
  const defaultHandoffCommand = resolveNodeCommand('node scripts/agent/run-selected-prompt.mjs');
  const handoffCommandRaw = scheduler.handoffCommandByCadence?.[cadence] || defaultHandoffCommand;
  const handoffCommand = resolveNodeCommand(handoffCommandRaw);
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
  const lockHealthPreflightFromConfig = parseBooleanFlag(scheduler.lockHealthPreflight, false);
  const lockHealthPreflightEnabled = parseBooleanFlag(
    process.env.SCHEDULER_LOCK_HEALTH_PREFLIGHT,
    lockHealthPreflightFromConfig,
  );
  const lockHealthPreflightSkip = parseBooleanFlag(process.env.SCHEDULER_SKIP_LOCK_HEALTH_PREFLIGHT, false);
  const strictLock = parseBooleanFlag(
    process.env.SCHEDULER_STRICT_LOCK,
    parseBooleanFlag(scheduler.strict_lock, true),
  );
  const degradedLockRetryWindowMs = parseNonNegativeInt(
    process.env.SCHEDULER_DEGRADED_LOCK_RETRY_WINDOW_MS,
    parseNonNegativeInt(scheduler.degraded_lock_retry_window, 3600000),
  );
  const maxDeferrals = parseNonNegativeInt(
    process.env.SCHEDULER_MAX_DEFERRALS,
    parseNonNegativeInt(scheduler.max_deferrals, 3),
  );

  return {
    firstPrompt: scheduler.firstPromptByCadence?.[cadence] || null,
    handoffCommand,
    missingHandoffCommandForMode,
    validationCommands: Array.isArray(scheduler.validationCommandsByCadence?.[cadence])
      ? scheduler.validationCommandsByCadence[cadence].filter((cmd) => typeof cmd === 'string' && cmd.trim())
      : ['npm run lint'],
    lockRetry: {
      maxRetries,
      backoffMs,
      jitterMs,
    },
    lockHealthPreflight: {
      enabled: lockHealthPreflightEnabled,
      skip: lockHealthPreflightSkip,
    },
    lockFailurePolicy: {
      strictLock,
      degradedLockRetryWindowMs,
      maxDeferrals,
    },
    memoryPolicy: {
      mode,
      retrieveCommand: typeof memoryPolicyRaw.retrieveCommand === 'string' && memoryPolicyRaw.retrieveCommand.trim()
        ? resolveNodeCommand(memoryPolicyRaw.retrieveCommand.trim())
        : null,
      storeCommand: typeof memoryPolicyRaw.storeCommand === 'string' && memoryPolicyRaw.storeCommand.trim()
        ? resolveNodeCommand(memoryPolicyRaw.storeCommand.trim())
        : null,
      retrieveSuccessMarkers: normalizeStringList(memoryPolicyRaw.retrieveSuccessMarkers, ['MEMORY_RETRIEVED']),
      storeSuccessMarkers: normalizeStringList(memoryPolicyRaw.storeSuccessMarkers, ['MEMORY_STORED']),
      retrieveArtifacts: normalizeStringList(memoryPolicyRaw.retrieveArtifacts),
      storeArtifacts: normalizeStringList(memoryPolicyRaw.storeArtifacts),
    },
  };
}
