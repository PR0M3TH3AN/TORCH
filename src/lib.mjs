#!/usr/bin/env node

// TORCH — Task Orchestration via Relay-Coordinated Handoff
// Generic Nostr-based task locking for multi-agent development.

import { generateSecretKey as _generateSecretKey, getPublicKey as _getPublicKey, finalizeEvent as _finalizeEvent } from 'nostr-tools/pure';
import { useWebSocketImplementation } from 'nostr-tools/relay';
import WebSocket from 'ws';
import {
  loadTorchConfig as _loadTorchConfig,
  getRelays as _getRelays,
  getNamespace as _getNamespace,
  getHashtag as _getHashtag,
} from './torch-config.mjs';
import {
  VALID_CADENCES,
  KIND_APP_DATA,
  USAGE_TEXT,
  MS_PER_SECOND,
} from './constants.mjs';
import { cmdInit, cmdUpdate, cmdRemove } from './ops.mjs';
import { parseArgs } from './cli-parser.mjs';
import { getRoster as _getRoster } from './roster.mjs';
import { queryLocks as _queryLocks, publishLock as _publishLock, parseLockEvent } from './lock-ops.mjs';
import { cmdDashboard } from './dashboard.mjs';
import {
  inspectMemory,
  listMemories,
  memoryStats,
  pinMemory,
  triggerPruneDryRun,
  unpinMemory,
} from './services/memory/index.js';
import { ExitError } from './errors.mjs';
import { todayDateStr, nowUnix, detectPlatform } from './utils.mjs';
import { runRelayHealthCheck } from './relay-health.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getCompletedAgents } from './lock-utils.mjs';
import { cmdProposal } from './cmd-proposal.mjs';
import { cmdRollback } from './cmd-rollback.mjs';
import { cmdLock } from './cmd-lock.mjs';

useWebSocketImplementation(WebSocket);

// Re-export for backward compatibility/library usage
export { parseLockEvent, cmdDashboard, _queryLocks as queryLocks, _publishLock as publishLock, cmdLock };

/**
 * Checks the status of the repository locks for a given cadence.
 *
 * It aggregates data from three sources:
 * 1. Configuration (paused agents)
 * 2. Local logs (completed agents)
 * 3. Nostr relays (current active locks)
 *
 * It outputs a JSON object describing the state (locked, available, excluded agents).
 *
 * @param {string} cadence - 'daily' or 'weekly'
 * @param {Object} [deps] - Dependency injection
 * @returns {Promise<Object>} - The check result object
 */
export async function cmdCheck(cadence, deps = {}) {
  const {
    getRelays = _getRelays,
    getNamespace = _getNamespace,
    loadTorchConfig = _loadTorchConfig,
    queryLocks = _queryLocks,
    getRoster = _getRoster,
    getDateStr = todayDateStr,
    log = console.log,
    error = console.error,
    logDir = 'task-logs',
    ignoreLogs = false,
    json = false,
    jsonFile = null,
    quiet = false,
  } = deps;

  const relays = await getRelays();
  const namespace = await getNamespace();
  const dateStr = getDateStr();
  const config = await loadTorchConfig();
  const pausedAgents = config.scheduler.paused[cadence] || [];

  if (!quiet) {
    error(`Checking locks: namespace=${namespace}, cadence=${cadence}, date=${dateStr}`);
    error(`Relays: ${relays.join(', ')}`);
    if (pausedAgents.length > 0) {
      error(`Paused agents: ${pausedAgents.join(', ')}`);
    }
  }

  let completedAgents = new Set();
  if (!ignoreLogs) {
    completedAgents = await getCompletedAgents(cadence, logDir, deps);
    if (!quiet && completedAgents.size > 0) {
      error(`Completed agents (logs): ${[...completedAgents].join(', ')}`);
    }
  }

  const locks = await queryLocks(relays, cadence, dateStr, namespace);
  const lockedAgents = [...new Set(locks.map((l) => l.agent).filter(Boolean))];
  const roster = await getRoster(cadence);
  const rosterSet = new Set(roster);

  const excludedAgentsSet = new Set([...lockedAgents, ...pausedAgents, ...completedAgents]);
  const excludedAgents = [...excludedAgentsSet];
  const unknownLockedAgents = lockedAgents.filter((agent) => !rosterSet.has(agent));
  const available = roster.filter((a) => !excludedAgentsSet.has(a));

  const result = {
    namespace,
    cadence,
    date: dateStr,
    locked: lockedAgents.sort(),
    paused: pausedAgents.sort(),
    completed: [...completedAgents].sort(),
    excluded: excludedAgents.sort(),
    available: available.sort(),
    lockCount: locks.length,
    unknownLockedAgents: unknownLockedAgents.sort(),
    locks: locks.map((l) => ({
      agent: l.agent,
      eventId: l.eventId,
      createdAt: l.createdAtIso,
      expiresAt: l.expiresAtIso,
      platform: l.platform,
    })),
  };

  const output = json ? JSON.stringify(result) : JSON.stringify(result, null, 2);

  if (jsonFile) {
    const resolvedPath = path.resolve(process.cwd(), jsonFile);
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
    await fs.writeFile(resolvedPath, `${output}\n`, 'utf8');
  }

  if (json || !quiet) {
    log(output);
  }

  return result;
}

/**
 * Lists all active locks for the specified cadence (or all cadences if null).
 * It prints a formatted table to stdout with lock age, TTL, and event ID.
 *
 * @param {string|null} cadence - Filter by cadence ('daily', 'weekly') or null for all
 * @param {Object} [deps] - Dependency injection
 * @returns {Promise<void>}
 */
export async function cmdList(cadence, deps = {}) {
  const {
    getRelays = _getRelays,
    getNamespace = _getNamespace,
    queryLocks = _queryLocks,
    getRoster = _getRoster,
    getDateStr = todayDateStr,
    log = console.log,
    error = console.error
  } = deps;

  const relays = await getRelays();
  const namespace = await getNamespace();
  const dateStr = getDateStr();
  const cadences = cadence ? [cadence] : [...VALID_CADENCES];

  error(`Listing active locks: namespace=${namespace}, cadences=${cadences.join(', ')}`);

  const results = await Promise.all(
    cadences.map(async (c) => {
      const locks = await queryLocks(relays, c, dateStr, namespace);
      return { c, locks };
    }),
  );

  for (const { c, locks } of results) {
    log(`\n${'='.repeat(72)}`);
    log(`Active ${namespace} ${c} locks (${dateStr})`);
    log('='.repeat(72));

    if (locks.length === 0) {
      log('  (no active locks)');
      continue;
    }

    const sorted = locks.sort((a, b) => a.createdAt - b.createdAt);
    for (const lock of sorted) {
      const age = nowUnix() - lock.createdAt;
      const ageMin = Math.round(age / 60);

      let remainMin = '?';
      if (lock.status === 'completed') {
          remainMin = 'done';
      } else if (lock.expiresAt) {
          const remaining = lock.expiresAt - nowUnix();
          remainMin = Math.round(remaining / 60);
      }

      log(
        `  ${(lock.agent ?? 'unknown').padEnd(30)} ` +
          `age: ${String(ageMin).padStart(4)}m  ` +
          `ttl: ${String(remainMin).padStart(4)}  ` +
          `platform: ${lock.platform ?? '?'}  ` +
          `event: ${lock.eventId?.slice(0, 12)}...`,
      );
    }

    const roster = await getRoster(c);
    const rosterSet = new Set(roster);
    const lockedAgents = new Set(locks.map((l) => l.agent).filter(Boolean));
    const unknownLockedAgents = [...lockedAgents].filter((agent) => !rosterSet.has(agent));
    const available = roster.filter((a) => !lockedAgents.has(a));

    if (unknownLockedAgents.length > 0) {
      log(`  Warning: lock events found with non-roster agent names: ${unknownLockedAgents.join(', ')}`);
    }

    log(`\n  Locked: ${lockedAgents.size}/${roster.length}`);
    log(`  Available: ${available.join(', ') || '(none)'}`);
  }
}

/**
 * Marks a task as permanently completed by publishing a new lock event with
 * `status: 'completed'` and no expiration.
 *
 * This function:
 * 1. Verifies that the agent currently holds a valid lock.
 * 2. Publishes a replacement event that preserves the original `startedAt` time.
 *
 * @param {string} agent - Agent name
 * @param {string} cadence - 'daily' or 'weekly'
 * @param {boolean} [dryRun=false] - If true, skips publishing
 * @param {Object} [deps] - Dependency injection
 * @returns {Promise<{status: string, eventId: string}>}
 * @throws {ExitError} If no active lock exists for the agent
 */
export async function cmdComplete(agent, cadence, optionsOrDryRun = false, deps = {}) {
  const options = typeof optionsOrDryRun === 'object' ? optionsOrDryRun : { dryRun: !!optionsOrDryRun };
  const { dryRun = false, platform = null, model = null } = options;

  const {
    getRelays = _getRelays,
    getNamespace = _getNamespace,
    getHashtag = _getHashtag,
    queryLocks = _queryLocks,
    publishLock = _publishLock,
    generateSecretKey = _generateSecretKey,
    getPublicKey = _getPublicKey,
    finalizeEvent = _finalizeEvent,
    getDateStr = todayDateStr,
    log = console.log,
    error = console.error
  } = deps;

  const relays = await getRelays();
  const namespace = await getNamespace();
  const hashtag = await getHashtag();
  const dateStr = getDateStr();
  const now = nowUnix();

  error(`Completing task: namespace=${namespace}, agent=${agent}, cadence=${cadence}, date=${dateStr}`);
  error(`Relays: ${relays.join(', ')}`);

  // 1. Find existing lock
  const locks = await queryLocks(relays, cadence, dateStr, namespace);
  const myLock = locks.find((l) => l.agent === agent);

  if (!myLock) {
    error(`ERROR: No active lock found for agent "${agent}" on ${dateStr}.`);
    error(`Cannot complete a task that is not locked or has already expired.`);
    throw new ExitError(1, 'No active lock found');
  }

  if (myLock.status === 'completed') {
    error(`Task is already marked as completed (event ${myLock.eventId}).`);
    log('LOCK_STATUS=completed');
    return { status: 'completed', eventId: myLock.eventId };
  }

  // 2. Build completion event
  const startedAtIso = myLock.createdAtIso;

  error('Step 1: Generating completion event...');
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);

  const event = finalizeEvent(
    {
      kind: KIND_APP_DATA,
      created_at: now,
      tags: [
        ['d', `${namespace}-lock/${cadence}/${agent}/${dateStr}`],
        ['t', hashtag],
        ['t', `${namespace}-lock-${cadence}`],
        ['t', `${namespace}-lock-${cadence}-${dateStr}`],
        // No expiration tag -> permanent
      ],
      content: JSON.stringify({
        agent,
        cadence,
        status: 'completed',
        namespace,
        date: dateStr,
        platform: platform || process.env.AGENT_PLATFORM || detectPlatform() || 'unknown',
        model: model || process.env.AGENT_MODEL || 'unknown',
        startedAt: startedAtIso,
        completedAt: new Date(now * MS_PER_SECOND).toISOString(),
      }),
    },
    sk,
  );

  error(`  Event ID: ${event.id}`);

  if (dryRun) {
    error('Step 2: [DRY RUN] Skipping publish — event built but not sent');
  } else {
    error('Step 2: Publishing completion event...');
    await publishLock(relays, event);
    error('  Published successfully.');
  }

  log('LOCK_STATUS=completed');
  log(`LOCK_EVENT_ID=${event.id}`);
  log(`LOCK_PUBKEY=${pk}`);
  log(`LOCK_AGENT=${agent}`);
  log(`LOCK_CADENCE=${cadence}`);
  log(`LOCK_DATE=${dateStr}`);

  return { status: 'completed', eventId: event.id };
}

const COMMAND_HANDLERS = {
  check: async (args) => {
    if (!args.cadence || !VALID_CADENCES.has(args.cadence)) {
      console.error(`ERROR: --cadence <${[...VALID_CADENCES].join('|')}> is required for check`);
      throw new ExitError(1, 'Missing cadence');
    }
    await cmdCheck(args.cadence, {
      logDir: args.logDir,
      ignoreLogs: args.ignoreLogs,
      json: args.json,
      jsonFile: args.jsonFile,
      quiet: args.quiet,
    });
  },
  lock: async (args) => {
    if (!args.agent) {
      console.error('ERROR: --agent <name> is required for lock');
      throw new ExitError(1, 'Missing agent');
    }
    if (!args.cadence || !VALID_CADENCES.has(args.cadence)) {
      console.error(`ERROR: --cadence <${[...VALID_CADENCES].join('|')}> is required for lock`);
      throw new ExitError(1, 'Missing cadence');
    }
    await cmdLock(args.agent, args.cadence, {
      dryRun: args.dryRun,
      platform: args.platform,
      model: args.model
    });
  },
  complete: async (args) => {
    if (!args.agent) {
      console.error('ERROR: --agent <name> is required for complete');
      throw new ExitError(1, 'Missing agent');
    }
    if (!args.cadence || !VALID_CADENCES.has(args.cadence)) {
      console.error(`ERROR: --cadence <${[...VALID_CADENCES].join('|')}> is required for complete`);
      throw new ExitError(1, 'Missing cadence');
    }
    await cmdComplete(args.agent, args.cadence, {
      dryRun: args.dryRun,
      platform: args.platform,
      model: args.model
    });
  },
  list: async (args) => {
    if (args.cadence && !VALID_CADENCES.has(args.cadence)) {
      console.error(`ERROR: --cadence must be one of: ${[...VALID_CADENCES].join(', ')}`);
      throw new ExitError(1, 'Invalid cadence');
    }
    await cmdList(args.cadence || null);
  },
  health: async (args) => {
    if (!args.cadence || !VALID_CADENCES.has(args.cadence)) {
      console.error(`ERROR: --cadence <${[...VALID_CADENCES].join('|')}> is required for health`);
      throw new ExitError(1, 'Missing cadence');
    }
    const result = await runRelayHealthCheck({
      cadence: args.cadence,
      ...(Number.isFinite(args.timeoutMs) ? { timeoutMs: args.timeoutMs } : {}),
      ...(Number.isFinite(args.allRelaysDownMinutes) ? { allRelaysDownMinutes: args.allRelaysDownMinutes } : {}),
      ...(Number.isFinite(args.minSuccessRate) ? { minSuccessRate: args.minSuccessRate } : {}),
      ...(Number.isFinite(args.windowMinutes) ? { windowMinutes: args.windowMinutes } : {}),
    });
    if (!result.ok) {
      result.failureCategory = 'all relays unhealthy';
    }
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) throw new ExitError(2, 'Relay health check failed');
  },
  dashboard: async (args) => {
    await cmdDashboard(args.port, args.host);
  },
  init: async (args) => {
    await cmdInit(args.force);
  },
  update: async (args) => {
    await cmdUpdate(args.force);
  },
  remove: async (args) => {
    await cmdRemove(args.force);
  },
  'list-memories': async (args) => {
    const result = await listMemories({
      agent_id: args.agent,
      type: args.type,
      tags: args.tags,
      pinned: args.pinned,
      limit: args.limit,
      offset: args.offset,
    });

    if (!args.full && Array.isArray(result)) {
      for (const memory of result) {
        if (typeof memory.content === 'string' && memory.content.length > 200) {
          memory.content = memory.content.slice(0, 200) + '... (truncated, use --full to see all)';
        }
      }
    }

    console.log(JSON.stringify(result, null, 2));
  },
  'inspect-memory': async (args) => {
    if (!args.id) {
      console.error('ERROR: --id <memoryId> is required for inspect-memory');
      throw new ExitError(1, 'Missing memory id');
    }
    const result = await inspectMemory(args.id);
    console.log(JSON.stringify(result, null, 2));
  },
  'pin-memory': async (args) => {
    if (!args.id) {
      console.error('ERROR: --id <memoryId> is required for pin-memory');
      throw new ExitError(1, 'Missing memory id');
    }
    const result = await pinMemory(args.id);
    console.log(JSON.stringify(result, null, 2));
  },
  'unpin-memory': async (args) => {
    if (!args.id) {
      console.error('ERROR: --id <memoryId> is required for unpin-memory');
      throw new ExitError(1, 'Missing memory id');
    }
    const result = await unpinMemory(args.id);
    console.log(JSON.stringify(result, null, 2));
  },
  'trigger-prune-dry-run': async (args) => {
    const result = await triggerPruneDryRun({ retentionMs: args.retentionMs ?? undefined });
    console.log(JSON.stringify(result, null, 2));
  },
  'memory-stats': async (args) => {
    const result = await memoryStats({ windowMs: args.windowMs ?? undefined });
    console.log(JSON.stringify(result, null, 2));
  },
  proposal: async (args) => {
    if (!args.subcommand) {
      console.error('ERROR: Missing subcommand for proposal (create, list, apply, reject, show)');
      throw new ExitError(1, 'Missing subcommand');
    }
    await cmdProposal(args.subcommand, {
      agent: args.agent,
      target: args.target,
      contentFile: args.content,
      reason: args.reason,
      id: args.id,
      status: args.status
    });
  },
  rollback: async (args) => {
    await cmdRollback(args.target, args.strategy, { list: args.list });
  },
  backup: async (args) => {
    const { cmdBackup, listBackups } = await import('./cmd-backup.mjs');
    if (args.list) {
      const backups = await listBackups();
      console.log(JSON.stringify(backups, null, 2));
    } else {
      await cmdBackup({ output: args.output });
    }
  },
};

function usage() {
  console.error(USAGE_TEXT);
}

/**
 * Main entry point for the torch-lock CLI.
 * Dispatches to specific commands (check, lock, complete, etc.) based on argv.
 *
 * @param {string[]} argv - Arguments from process.argv.slice(2)
 */
export async function main(argv) {
  try {
    const args = parseArgs(argv);

    if (!args.command) {
      usage();
      throw new ExitError(1, 'No command specified');
    }

    const handler = COMMAND_HANDLERS[args.command];
    if (handler && Object.hasOwn(COMMAND_HANDLERS, args.command)) {
      await handler(args);
    } else {
      console.error(`ERROR: Unknown command: ${args.command}`);
      usage();
      throw new ExitError(1, 'Unknown command');
    }
  } catch (err) {
    if (err instanceof ExitError) {
      process.exit(err.code);
    } else {
      console.error(`torch-lock failed: ${err.message}`);
      process.exit(2);
    }
  }
}
