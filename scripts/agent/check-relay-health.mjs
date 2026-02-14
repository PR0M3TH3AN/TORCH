#!/usr/bin/env node
import { getRelays, getNamespace, getQueryTimeoutMs } from '../../src/torch-config.mjs';
import { queryLocks } from '../../src/lock-ops.mjs';
import { todayDateStr } from '../../src/utils.mjs';

function parseArgs(argv) {
  const args = { cadence: 'daily' };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (!value.startsWith('--') && !args.cadence) {
      args.cadence = value;
      continue;
    }
    if (value === '--cadence') {
      args.cadence = argv[i + 1] || args.cadence;
      i += 1;
    }
  }
  return args;
}

function classifyRelayFailure(outputText) {
  const text = String(outputText || '').toLowerCase();
  if (!text.trim()) return 'unknown backend error';

  if ((text.includes('relay') || text.includes('query')) && text.includes('timeout')) {
    return 'relay query timeout';
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

async function main() {
  const { cadence } = parseArgs(process.argv.slice(2));
  if (cadence !== 'daily' && cadence !== 'weekly') {
    console.error('Usage: node scripts/agent/check-relay-health.mjs --cadence <daily|weekly>');
    process.exit(1);
  }

  const relays = getRelays();
  const namespace = getNamespace();
  const timeoutMs = getQueryTimeoutMs();
  const dateStr = todayDateStr();

  try {
    const locks = await queryLocks(relays, cadence, dateStr, namespace);
    console.log(JSON.stringify({
      ok: true,
      cadence,
      namespace,
      timeoutMs,
      relays,
      lockCount: locks.length,
    }));
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? 'unknown error');
    const failureCategory = classifyRelayFailure(message);
    console.log(JSON.stringify({
      ok: false,
      cadence,
      namespace,
      timeoutMs,
      relays,
      failureCategory,
      error: message,
    }));
    process.exit(2);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error ?? 'unknown error');
  const relays = getRelays();
  const namespace = getNamespace();
  const failureCategory = classifyRelayFailure(message);
  console.log(JSON.stringify({
    ok: false,
    namespace,
    relays,
    failureCategory,
    error: message,
  }));
  process.exit(2);
});
