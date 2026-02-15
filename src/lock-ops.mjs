import { SimplePool } from 'nostr-tools/pool';
import {
  getQueryTimeoutMs,
  getPublishTimeoutMs,
  getMinSuccessfulRelayPublishes,
  getRelayFallbacks,
} from './torch-config.mjs';
import { KIND_APP_DATA } from './constants.mjs';

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

function withTimeout(promise, timeoutMs, timeoutMessage) {
  let timeoutHandle;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  });
}

function relayListLabel(relays) {
  return relays.join(', ');
}

function classifyPublishError(message) {
  const normalized = String(message || '').toLowerCase();
  if (normalized.includes('timed out') || normalized.includes('timeout') || normalized.includes('etimedout')) {
    return 'network_timeout';
  }
  if (normalized.includes('econnreset') || normalized.includes('connection reset') || normalized.includes('socket hang up')) {
    return 'connection_reset';
  }
  if (
    normalized.includes('unavailable') ||
    normalized.includes('offline') ||
    normalized.includes('econnrefused') ||
    normalized.includes('connection refused') ||
    normalized.includes('enotfound') ||
    normalized.includes('503')
  ) {
    return 'relay_unavailable';
  }
  return 'permanent_validation_error';
}

function isTransientPublishCategory(category) {
  return category === 'network_timeout' || category === 'connection_reset' || category === 'relay_unavailable';
}

function calculateBackoffDelayMs(attemptNumber, baseMs, capMs, randomFn = Math.random) {
  const maxDelay = Math.min(capMs, baseMs * (2 ** Math.max(0, attemptNumber - 1)));
  return Math.floor(randomFn() * maxDelay);
}

export async function queryLocks(relays, cadence, dateStr, namespace, deps = {}) {
  const {
    poolFactory = () => new SimplePool(),
    getQueryTimeoutMsFn = getQueryTimeoutMs,
    getRelayFallbacksFn = getRelayFallbacks,
    errorLogger = console.error,
  } = deps;

  const pool = poolFactory();
  const tagFilter = `${namespace}-lock-${cadence}-${dateStr}`;
  const queryTimeoutMs = getQueryTimeoutMsFn();
  const fallbackRelays = getRelayFallbacksFn();

  const runQuery = async (relaySet, phase) => {
    try {
      const events = await withTimeout(
        pool.querySync(relaySet, {
          kinds: [KIND_APP_DATA],
          '#t': [tagFilter],
        }),
        queryTimeoutMs,
        `[${phase}] Relay query timed out after ${queryTimeoutMs}ms (relays: ${relayListLabel(relaySet)})`,
      );
      return filterActiveLocks(events.map(parseLockEvent));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `[${phase}] Relay query failed (timeout=${queryTimeoutMs}ms, relays=${relayListLabel(relaySet)}): ${message}`,
        { cause: err },
      );
    }
  };

  try {
    try {
      return await runQuery(relays, 'query:primary');
    } catch (primaryErr) {
      if (!fallbackRelays.length) {
        throw primaryErr;
      }
      errorLogger(`WARN: ${primaryErr.message}`);
      errorLogger(`WARN: retrying query with fallback relays (${relayListLabel(fallbackRelays)})`);
      return await runQuery(fallbackRelays, 'query:fallback');
    }
  } finally {
    const allRelays = [...new Set([...relays, ...fallbackRelays])];
    pool.close(allRelays);
  }
}

async function publishToRelays(pool, relays, event, publishTimeoutMs, phase) {
  const publishPromises = pool.publish(relays, event);
  const settled = await Promise.allSettled(
    publishPromises.map((publishPromise, index) => withTimeout(
      publishPromise,
      publishTimeoutMs,
      `[${phase}] Publish timed out after ${publishTimeoutMs}ms (relay=${relays[index]})`,
    )),
  );

  return settled.map((result, index) => {
    if (result.status === 'fulfilled') {
      return { relay: relays[index], success: true, phase };
    }
    const reason = result.reason;
    const message = reason instanceof Error ? reason.message : String(reason ?? 'unknown');
    return { relay: relays[index], success: false, phase, message };
  });
}

export async function publishLock(relays, event, deps = {}) {
  const {
    poolFactory = () => new SimplePool(),
    getPublishTimeoutMsFn = getPublishTimeoutMs,
    getMinSuccessfulRelayPublishesFn = getMinSuccessfulRelayPublishes,
    getRelayFallbacksFn = getRelayFallbacks,
    retryAttempts = 4,
    retryBaseDelayMs = 500,
    retryCapDelayMs = 8_000,
    sleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    randomFn = Math.random,
    telemetryLogger = console.error,
  } = deps;

  const pool = poolFactory();
  const publishTimeoutMs = getPublishTimeoutMsFn();
  const minSuccesses = getMinSuccessfulRelayPublishesFn();
  const fallbackRelays = getRelayFallbacksFn().filter((relay) => !relays.includes(relay));
  const maxAttempts = Math.max(1, Math.floor(retryAttempts));

  const publishOnce = async () => {
    const attempted = new Set();
    const publishResults = [];

    const attemptPhase = async (phaseRelays, phaseName) => {
      if (!phaseRelays.length) return;
      for (const relay of phaseRelays) {
        attempted.add(relay);
      }
      const phaseResults = await publishToRelays(pool, phaseRelays, event, publishTimeoutMs, phaseName);
      publishResults.push(...phaseResults);
    };

    await attemptPhase(relays, 'publish:primary');

    let successCount = publishResults.filter((result) => result.success).length;
    if (successCount < minSuccesses && fallbackRelays.length > 0) {
      await attemptPhase(fallbackRelays, 'publish:fallback');
      successCount = publishResults.filter((result) => result.success).length;
    }

    const failures = publishResults
      .filter((result) => !result.success)
      .map((result) => ({
        ...result,
        category: classifyPublishError(result.message),
      }));

    return { attempted, publishResults, successCount, failures };
  };

  try {
    let lastAttemptState = null;
    for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber += 1) {
      const startedAtMs = Date.now();
      lastAttemptState = await publishOnce();

      if (lastAttemptState.successCount >= minSuccesses) {
        console.error(
          `  Published to ${lastAttemptState.successCount}/${lastAttemptState.attempted.size} relays ` +
          `(required=${minSuccesses}, timeout=${publishTimeoutMs}ms)`,
        );
        return event;
      }

      const hasTransientFailure = lastAttemptState.failures.some((failure) => isTransientPublishCategory(failure.category));
      const hasPermanentFailure = lastAttemptState.failures.some((failure) => !isTransientPublishCategory(failure.category));
      const canRetry = attemptNumber < maxAttempts && hasTransientFailure && !hasPermanentFailure;

      if (!canRetry) {
        break;
      }

      const elapsedMs = Date.now() - startedAtMs;
      const nextDelayMs = calculateBackoffDelayMs(attemptNumber, retryBaseDelayMs, retryCapDelayMs, randomFn);
      for (const failure of lastAttemptState.failures) {
        if (!isTransientPublishCategory(failure.category)) continue;
        telemetryLogger(JSON.stringify({
          event: 'lock_publish_retry',
          attempt: attemptNumber,
          relayUrl: failure.relay,
          errorCategory: failure.category,
          elapsedMs,
          nextDelayMs,
        }));
      }

      await sleepFn(nextDelayMs);
    }

    const failureLines = lastAttemptState.failures
      .map((result) => `${result.relay} (${result.phase}, category=${result.category}): ${result.message}`);

    throw new Error(
      `Failed relay publish quorum in publish phase: ${lastAttemptState.successCount}/${lastAttemptState.attempted.size} successful ` +
      `(required=${minSuccesses}, timeout=${publishTimeoutMs}ms, attempts=${maxAttempts})\n  ${failureLines.join('\n  ')}`,
    );
  } finally {
    pool.close([...new Set([...relays, ...fallbackRelays])]);
  }
}
