#!/usr/bin/env node

// TORCH — Task Orchestration via Relay-Coordinated Handoff
// Generic Nostr-based task locking for multi-agent development.

import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { useWebSocketImplementation } from 'nostr-tools/relay';
import WebSocket from 'ws';
import {
  loadTorchConfig,
  getRelays,
  getNamespace,
  getTtl,
} from './torch-config.mjs';
import {
  DEFAULT_DASHBOARD_PORT,
  RACE_CHECK_DELAY_MS,
  VALID_CADENCES,
} from './constants.mjs';
import { cmdInit, cmdUpdate } from './ops.mjs';
import { getRoster } from './roster.mjs';
import { queryLocks, publishLock, parseLockEvent } from './lock-ops.mjs';
import { cmdDashboard } from './dashboard.mjs';

useWebSocketImplementation(WebSocket);

// Custom Error class for controlled exits
class ExitError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function todayDateStr() {
  return new Date().toISOString().slice(0, 10);
}

function nowUnix() {
  return Math.floor(Date.now() / 1000);
}

// Re-export for backward compatibility/library usage
export { parseLockEvent, queryLocks, publishLock, cmdDashboard };

export async function cmdCheck(cadence) {
  const relays = getRelays();
  const namespace = getNamespace();
  const dateStr = todayDateStr();
  const config = loadTorchConfig();
  const pausedAgents = (cadence === 'daily' ? config.scheduler.paused.daily : config.scheduler.paused.weekly) || [];

  console.error(`Checking locks: namespace=${namespace}, cadence=${cadence}, date=${dateStr}`);
  console.error(`Relays: ${relays.join(', ')}`);
  if (pausedAgents.length > 0) {
    console.error(`Paused agents: ${pausedAgents.join(', ')}`);
  }

  const locks = await queryLocks(relays, cadence, dateStr, namespace);
  const lockedAgents = [...new Set(locks.map((l) => l.agent).filter(Boolean))];
  const roster = getRoster(cadence);

  const excludedAgents = [...new Set([...lockedAgents, ...pausedAgents])];
  const unknownLockedAgents = lockedAgents.filter((agent) => !roster.includes(agent));
  const available = roster.filter((a) => !excludedAgents.includes(a));

  const result = {
    namespace,
    cadence,
    date: dateStr,
    locked: lockedAgents.sort(),
    paused: pausedAgents.sort(),
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

  console.log(JSON.stringify(result, null, 2));
  return result;
}

export async function cmdLock(agent, cadence, dryRun = false) {
  const relays = getRelays();
  const namespace = getNamespace();
  const dateStr = todayDateStr();
  const ttl = getTtl();
  const now = nowUnix();
  const expiresAt = now + ttl;

  console.error(`Locking: namespace=${namespace}, agent=${agent}, cadence=${cadence}, date=${dateStr}`);
  console.error(`TTL: ${ttl}s, expires: ${new Date(expiresAt * 1000).toISOString()}`);
  console.error(`Relays: ${relays.join(', ')}`);

  const roster = getRoster(cadence);
  if (!roster.includes(agent)) {
    console.error(`ERROR: agent "${agent}" is not in the ${cadence} roster`);
    console.error(`Allowed ${cadence} agents: ${roster.join(', ')}`);
    throw new ExitError(1, 'Agent not in roster');
  }

  console.error('Step 1: Checking for existing locks...');
  const existingLocks = await queryLocks(relays, cadence, dateStr, namespace);
  const conflicting = existingLocks.filter((l) => l.agent === agent);

  if (conflicting.length > 0) {
    const earliest = conflicting.sort((a, b) => a.createdAt - b.createdAt)[0];
    console.error(
      `LOCK DENIED: ${agent} already locked by event ${earliest.eventId} ` +
        `(created ${earliest.createdAtIso}, platform: ${earliest.platform})`,
    );
    console.log('LOCK_STATUS=denied');
    console.log('LOCK_REASON=already_locked');
    console.log(`LOCK_EXISTING_EVENT=${earliest.eventId}`);
    throw new ExitError(3, 'Lock denied');
  }

  console.error('Step 2: Generating ephemeral keypair...');
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);
  console.error(`  Ephemeral pubkey: ${pk.slice(0, 16)}...`);

  console.error('Step 3: Building lock event...');
  const event = finalizeEvent(
    {
      kind: 30078,
      created_at: now,
      tags: [
        ['d', `${namespace}-lock/${cadence}/${agent}/${dateStr}`],
        ['t', `${namespace}-agent-lock`],
        ['t', `${namespace}-lock-${cadence}`],
        ['t', `${namespace}-lock-${cadence}-${dateStr}`],
        ['expiration', String(expiresAt)],
      ],
      content: JSON.stringify({
        agent,
        cadence,
        status: 'started',
        namespace,
        date: dateStr,
        platform: process.env.AGENT_PLATFORM || 'unknown',
        lockedAt: new Date(now * 1000).toISOString(),
        expiresAt: new Date(expiresAt * 1000).toISOString(),
      }),
    },
    sk,
  );

  console.error(`  Event ID: ${event.id}`);

  if (dryRun) {
    console.error('Step 4: [DRY RUN] Skipping publish — event built but not sent');
    console.error('RACE CHECK: won (dry run — no real contention possible)');
  } else {
    console.error('Step 4: Publishing to relays...');
    await publishLock(relays, event);

    console.error('Step 5: Race check...');
    await new Promise((resolve) => setTimeout(resolve, RACE_CHECK_DELAY_MS));

    const postLocks = await queryLocks(relays, cadence, dateStr, namespace);
    const racingLocks = postLocks
      .filter((l) => l.agent === agent)
      .sort((a, b) => a.createdAt - b.createdAt);

    if (racingLocks.length > 1 && racingLocks[0].eventId !== event.id) {
      const winner = racingLocks[0];
      console.error(
        `RACE CHECK: lost (earlier lock by event ${winner.eventId}, created ${winner.createdAtIso})`,
      );
      console.log('LOCK_STATUS=race_lost');
      console.log('LOCK_REASON=earlier_claim_exists');
      console.log(`LOCK_WINNER_EVENT=${winner.eventId}`);
      throw new ExitError(3, 'Race check lost');
    }

    console.error('RACE CHECK: won');
  }

  console.log('LOCK_STATUS=ok');
  console.log(`LOCK_EVENT_ID=${event.id}`);
  console.log(`LOCK_PUBKEY=${pk}`);
  console.log(`LOCK_AGENT=${agent}`);
  console.log(`LOCK_CADENCE=${cadence}`);
  console.log(`LOCK_DATE=${dateStr}`);
  console.log(`LOCK_EXPIRES=${expiresAt}`);
  console.log(`LOCK_EXPIRES_ISO=${new Date(expiresAt * 1000).toISOString()}`);
  return { status: 'ok', eventId: event.id };
}

export async function cmdList(cadence) {
  const relays = getRelays();
  const namespace = getNamespace();
  const dateStr = todayDateStr();
  const cadences = cadence ? [cadence] : ['daily', 'weekly'];

  console.error(`Listing active locks: namespace=${namespace}, cadences=${cadences.join(', ')}`);

  const results = await Promise.all(
    cadences.map(async (c) => {
      const locks = await queryLocks(relays, c, dateStr, namespace);
      return { c, locks };
    }),
  );

  for (const { c, locks } of results) {
    console.log(`\n${'='.repeat(72)}`);
    console.log(`Active ${namespace} ${c} locks (${dateStr})`);
    console.log('='.repeat(72));

    if (locks.length === 0) {
      console.log('  (no active locks)');
      continue;
    }

    const sorted = locks.sort((a, b) => a.createdAt - b.createdAt);
    for (const lock of sorted) {
      const age = nowUnix() - lock.createdAt;
      const ageMin = Math.round(age / 60);
      const remaining = lock.expiresAt ? lock.expiresAt - nowUnix() : null;
      const remainMin = remaining ? Math.round(remaining / 60) : '?';

      console.log(
        `  ${(lock.agent ?? 'unknown').padEnd(30)} ` +
          `age: ${String(ageMin).padStart(4)}m  ` +
          `ttl: ${String(remainMin).padStart(4)}m  ` +
          `platform: ${lock.platform ?? '?'}  ` +
          `event: ${lock.eventId?.slice(0, 12)}...`,
      );
    }

    const roster = getRoster(c);
    const lockedAgents = new Set(locks.map((l) => l.agent).filter(Boolean));
    const unknownLockedAgents = [...lockedAgents].filter((agent) => !roster.includes(agent));
    const available = roster.filter((a) => !lockedAgents.has(a));

    if (unknownLockedAgents.length > 0) {
      console.log(`  Warning: lock events found with non-roster agent names: ${unknownLockedAgents.join(', ')}`);
    }

    console.log(`\n  Locked: ${lockedAgents.size}/${roster.length}`);
    console.log(`  Available: ${available.join(', ') || '(none)'}`);
  }
}

function parseArgs(argv) {
  const args = { command: null, agent: null, cadence: null, dryRun: false, force: false, port: DEFAULT_DASHBOARD_PORT };
  let i = 0;

  if (argv.length > 0 && !argv[0].startsWith('-')) {
    args.command = argv[0];
    i = 1;
  }

  for (; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--agent' || arg === '-a') {
      args.agent = argv[++i];
    } else if (arg === '--cadence' || arg === '-c') {
      args.cadence = argv[++i];
    } else if (arg.startsWith('--agent=')) {
      args.agent = arg.split('=')[1];
    } else if (arg.startsWith('--cadence=')) {
      args.cadence = arg.split('=')[1];
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--force') {
      args.force = true;
    } else if (arg === '--port') {
      args.port = parseInt(argv[++i], 10) || DEFAULT_DASHBOARD_PORT;
    }
  }

  return args;
}

function usage() {
  console.error(`Usage: torch-lock <command> [options]

Commands:
  check  --cadence <daily|weekly>                  Check locked agents (JSON)
  lock   --agent <name> --cadence <daily|weekly>   Claim a lock
  list   [--cadence <daily|weekly>]                Print active lock table
  dashboard [--port <port>]                        Serve the dashboard (default: ${DEFAULT_DASHBOARD_PORT})
  init   [--force]                                 Initialize torch/ directory in current project
  update [--force]                                 Update torch/ configuration (backups, merges)

Options:
  --dry-run   Build and sign the event but do not publish
  --force     Overwrite existing files (for init) or all files (for update)

Environment:
  NOSTR_LOCK_NAMESPACE      Namespace prefix for lock tags (default: torch)
  NOSTR_LOCK_RELAYS         Comma-separated relay WSS URLs
  NOSTR_LOCK_TTL            Lock TTL in seconds (default: 7200)
  NOSTR_LOCK_QUERY_TIMEOUT_MS   Relay query timeout in milliseconds (default: 15000)
  NOSTR_LOCK_DAILY_ROSTER   Comma-separated daily roster (optional)
  NOSTR_LOCK_WEEKLY_ROSTER  Comma-separated weekly roster (optional)
  TORCH_CONFIG_PATH         Optional path to torch-config.json (default: ./torch-config.json)
  AGENT_PLATFORM            Platform identifier (e.g., codex)

Exit codes:
  0  Success
  1  Usage error
  2  Relay/network error
  3  Lock denied (already locked or race lost)`);
}

export async function main(argv) {
  try {
    const args = parseArgs(argv);

    if (!args.command) {
      usage();
      throw new ExitError(1, 'No command specified');
    }

    switch (args.command) {
      case 'check': {
        if (!args.cadence || !VALID_CADENCES.has(args.cadence)) {
          console.error('ERROR: --cadence <daily|weekly> is required for check');
          throw new ExitError(1, 'Missing cadence');
        }
        await cmdCheck(args.cadence);
        break;
      }

      case 'lock': {
        if (!args.agent) {
          console.error('ERROR: --agent <name> is required for lock');
          throw new ExitError(1, 'Missing agent');
        }
        if (!args.cadence || !VALID_CADENCES.has(args.cadence)) {
          console.error('ERROR: --cadence <daily|weekly> is required for lock');
          throw new ExitError(1, 'Missing cadence');
        }
        await cmdLock(args.agent, args.cadence, args.dryRun);
        break;
      }

      case 'list': {
        if (args.cadence && !VALID_CADENCES.has(args.cadence)) {
          console.error('ERROR: --cadence must be daily or weekly');
          throw new ExitError(1, 'Invalid cadence');
        }
        await cmdList(args.cadence || null);
        break;
      }

      case 'dashboard': {
        await cmdDashboard(args.port);
        break;
      }

      case 'init': {
        await cmdInit(args.force);
        break;
      }

      case 'update': {
        await cmdUpdate(args.force);
        break;
      }

      default:
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
