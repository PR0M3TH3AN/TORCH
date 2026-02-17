#!/usr/bin/env node

/**
 * features/log-summary.mjs
 *
 * A utility script to parse task-logs and display a summary of recent agent runs.
 *
 * Usage:
 *   node features/log-summary.mjs
 *   node features/log-summary.mjs --cadence daily
 *   node features/log-summary.mjs --limit 20
 */

import fs from 'node:fs';
import path from 'node:path';

const CADENCES = ['daily', 'weekly'];
const LOG_ROOT = 'task-logs';

function parseArgs() {
  const args = process.argv.slice(2);
  const limitIndex = args.indexOf('--limit');
  const limit = limitIndex !== -1 ? parseInt(args[limitIndex + 1], 10) : 10;

  const cadenceIndex = args.indexOf('--cadence');
  const cadence = cadenceIndex !== -1 ? args[cadenceIndex + 1] : null;

  return { limit, cadence };
}

function getLogFiles(cadence) {
  const dir = path.join(LOG_ROOT, cadence);
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir)
    .filter(file => file.endsWith('.md') && !file.startsWith('_'))
    .map(file => {
      // Format: <timestamp>__<agent>__<status>.md
      // Example: 2026-02-17T14-29-07Z__dead-code-agent__completed.md
      const parts = file.replace('.md', '').split('__');
      if (parts.length < 3) return null;

      return {
        timestamp: parts[0],
        agent: parts[1],
        status: parts[2],
        cadence,
        file
      };
    })
    .filter(Boolean);
}

function main() {
  const { limit, cadence } = parseArgs();

  let allLogs = [];

  const cadencesToScan = cadence ? [cadence] : CADENCES;

  for (const c of cadencesToScan) {
    allLogs = allLogs.concat(getLogFiles(c));
  }

  // Sort by timestamp descending
  allLogs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const displayedLogs = allLogs.slice(0, limit);

  console.log(`\n🔍 Recent Agent Runs (Limit: ${limit})\n`);
  console.log(`| Timestamp            | Cadence | Agent                          | Status    |`);
  console.log(`|----------------------|---------|--------------------------------|-----------|`);

  for (const log of displayedLogs) {
    const ts = log.timestamp.padEnd(20);
    const cad = log.cadence.padEnd(7);
    const agent = log.agent.padEnd(30);
    const status = log.status.padEnd(9);

    console.log(`| ${ts} | ${cad} | ${agent} | ${status} |`);
  }
  console.log('');
}

main();
