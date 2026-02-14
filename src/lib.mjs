#!/usr/bin/env node

// TORCH — Task Orchestration via Relay-Coordinated Handoff
// Generic Nostr-based task locking for multi-agent development.

import { useWebSocketImplementation } from 'nostr-tools/relay';
import WebSocket from 'ws';
import {
  DEFAULT_DASHBOARD_PORT,
  VALID_CADENCES,
} from './constants.mjs';
import { cmdInit, cmdUpdate } from './ops.mjs';
import { publishLock, parseLockEvent, queryLocks } from './lock-ops.mjs';
import { cmdDashboard } from './dashboard.mjs';
import { cmdCheck } from './cmd-check.mjs';
import { cmdLock } from './cmd-lock.mjs';
import { cmdList } from './cmd-list.mjs';
import { ExitError } from './errors.mjs';

useWebSocketImplementation(WebSocket);

// Re-export for backward compatibility/library usage
export { parseLockEvent, queryLocks, publishLock, cmdDashboard };
export { cmdCheck } from './cmd-check.mjs';
export { cmdLock } from './cmd-lock.mjs';
export { cmdList } from './cmd-list.mjs';

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
