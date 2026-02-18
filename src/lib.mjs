#!/usr/bin/env node

// TORCH — Task Orchestration via Relay-Coordinated Handoff
// Generic Nostr-based task locking for multi-agent development.

import { useWebSocketImplementation } from 'nostr-tools/relay';
import WebSocket from 'ws';
import {
  VALID_CADENCES,
  USAGE_TEXT,
} from './constants.mjs';
import { cmdInit, cmdUpdate } from './ops.mjs';
import { parseArgs } from './cli-parser.mjs';
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
import { runRelayHealthCheck } from './relay-health.mjs';

import { cmdCheck } from './cmd-check.mjs';
import { cmdLock } from './cmd-lock.mjs';
import { cmdList } from './cmd-list.mjs';
import { cmdComplete } from './cmd-complete.mjs';

useWebSocketImplementation(WebSocket);

// Re-export for backward compatibility/library usage
export { parseLockEvent, cmdDashboard, _queryLocks as queryLocks, _publishLock as publishLock };
export { cmdCheck, cmdLock, cmdList, cmdComplete };

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

    switch (args.command) {
      case 'check': {
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
        break;
      }

      case 'lock': {
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
        break;
      }

      case 'complete': {
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
        break;
      }

      case 'list': {
        if (args.cadence && !VALID_CADENCES.has(args.cadence)) {
          console.error(`ERROR: --cadence must be one of: ${[...VALID_CADENCES].join(', ')}`);
          throw new ExitError(1, 'Invalid cadence');
        }
        await cmdList(args.cadence || null);
        break;
      }

      case 'health': {
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
        break;
      }

      case 'dashboard': {
        await cmdDashboard(args.port, args.host);
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

      case 'list-memories': {
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
        break;
      }

      case 'inspect-memory': {
        if (!args.id) {
          console.error('ERROR: --id <memoryId> is required for inspect-memory');
          throw new ExitError(1, 'Missing memory id');
        }
        const result = await inspectMemory(args.id);
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case 'pin-memory': {
        if (!args.id) {
          console.error('ERROR: --id <memoryId> is required for pin-memory');
          throw new ExitError(1, 'Missing memory id');
        }
        const result = await pinMemory(args.id);
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case 'unpin-memory': {
        if (!args.id) {
          console.error('ERROR: --id <memoryId> is required for unpin-memory');
          throw new ExitError(1, 'Missing memory id');
        }
        const result = await unpinMemory(args.id);
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case 'trigger-prune-dry-run': {
        const result = await triggerPruneDryRun({ retentionMs: args.retentionMs ?? undefined });
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case 'memory-stats': {
        const result = await memoryStats({ windowMs: args.windowMs ?? undefined });
        console.log(JSON.stringify(result, null, 2));
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
