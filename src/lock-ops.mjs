import { SimplePool } from 'nostr-tools/pool';
import { getQueryTimeoutMs } from './torch-config.mjs';

function nowUnix() {
  return Math.floor(Date.now() / 1000);
}

export function parseLockEvent(event) {
  const dTag = event.tags.find((t) => t[0] === 'd')?.[1] ?? '';
  const expTag = event.tags.find((t) => t[0] === 'expiration')?.[1];
  const expiresAt = expTag ? parseInt(expTag, 10) : null;

  let content = {};
  try {
    const parsed = JSON.parse(event.content);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      content = parsed;
    }
  } catch {
    // Ignore malformed JSON content
  }

  return {
    eventId: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    createdAtIso: new Date(event.created_at * 1000).toISOString(),
    expiresAt,
    expiresAtIso: expiresAt ? new Date(expiresAt * 1000).toISOString() : null,
    dTag,
    agent: content.agent ?? null,
    cadence: content.cadence ?? null,
    status: content.status ?? null,
    date: content.date ?? null,
    platform: content.platform ?? null,
  };
}

function filterActiveLocks(locks) {
  const now = nowUnix();
  return locks.filter((lock) => !lock.expiresAt || lock.expiresAt > now);
}

export async function queryLocks(relays, cadence, dateStr, namespace) {
  const pool = new SimplePool();
  const tagFilter = `${namespace}-lock-${cadence}-${dateStr}`;
  const queryTimeoutMs = getQueryTimeoutMs();

  try {
    const events = await Promise.race([
      pool.querySync(relays, {
        kinds: [30078],
        '#t': [tagFilter],
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Relay query timed out')), queryTimeoutMs),
      ),
    ]);

    return filterActiveLocks(events.map(parseLockEvent));
  } finally {
    pool.close(relays);
  }
}

export async function publishLock(relays, event) {
  const pool = new SimplePool();

  try {
    const publishPromises = pool.publish(relays, event);
    const results = await Promise.allSettled(publishPromises);
    const successes = results.filter((r) => r.status === 'fulfilled');

    if (successes.length === 0) {
      const errors = results.map((r, i) => {
        if (r.status === 'rejected') {
          const reason = r.reason;
          const message = reason instanceof Error ? reason.message : String(reason ?? 'unknown');
          return `${relays[i]}: ${message}`;
        }
        return `${relays[i]}: unknown`;
      });
      throw new Error(`Failed to publish to any relay:\n  ${errors.join('\n  ')}`);
    }

    console.error(`  Published to ${successes.length}/${relays.length} relays`);
    return event;
  } finally {
    pool.close(relays);
  }
}
