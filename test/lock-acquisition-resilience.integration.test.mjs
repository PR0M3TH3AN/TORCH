import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert';

import { publishLock, _resetRelayHealthState } from '../src/lock-ops.mjs';

const RELAYS = ['wss://relay-a', 'wss://relay-b', 'wss://relay-c'];

function parseTelemetry(lines) {
  return lines.map((line) => JSON.parse(line));
}

function createDynamicPool(outcomeForAttempt) {
  let publishCallCount = 0;
  return {
    publish(relays) {
      publishCallCount += 1;
      return relays.map((relay) => {
        const outcome = outcomeForAttempt({
          relay,
          attempt: publishCallCount,
          nowMs: Date.now(),
        });
        if (outcome.ok) {
          return Promise.resolve('ok');
        }
        return Promise.reject(new Error(outcome.message));
      });
    },
    close() {},
    getPublishCallCount() {
      return publishCallCount;
    },
  };
}

describe('ci-resilience lock acquisition under unstable relays', { concurrency: false }, () => {
  const healthStabilityOverrides = {
    failureThreshold: 999,
    rollingWindowSize: 100,
  };

  beforeEach(() => {
    _resetRelayHealthState();
    mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  });

  afterEach(() => {
    mock.timers.reset();
  });

  it('recovers after all relays are down for an initial outage window', async () => {
    const telemetryLogs = [];
    const sleepCalls = [];
    const initialOutageMs = 3_000;

    const pool = createDynamicPool(({ relay, nowMs }) => {
      if (nowMs < initialOutageMs) {
        return { ok: false, message: 'relay unavailable during outage' };
      }
      if (relay === 'wss://relay-c') {
        return { ok: true };
      }
      return { ok: false, message: 'relay unavailable during outage recovery' };
    });

    const result = await publishLock(RELAYS, { id: 'evt-outage-recovery' }, {
      poolFactory: () => pool,
      getPublishTimeoutMsFn: () => 25,
      getMinSuccessfulRelayPublishesFn: () => 1,
      getRelayFallbacksFn: () => [],
      getMinActiveRelayPoolFn: () => 1,
      retryAttempts: 8,
      retryBaseDelayMs: 1_000,
      retryCapDelayMs: 1_000,
      randomFn: () => 1,
      sleepFn: async (delayMs) => {
        sleepCalls.push(delayMs);
        mock.timers.tick(delayMs);
      },
      telemetryLogger: (line) => telemetryLogs.push(line),
      healthLogger: () => {},
      ...healthStabilityOverrides,
    });

    assert.strictEqual(result.id, 'evt-outage-recovery');
    assert.strictEqual(pool.getPublishCallCount(), 4);
    assert.deepStrictEqual(sleepCalls, [1_000, 1_000, 1_000]);

    const telemetry = parseTelemetry(telemetryLogs);
    const quorumMet = telemetry.find((entry) => entry.event === 'lock_publish_quorum_met');
    assert.ok(quorumMet);
    assert.strictEqual(quorumMet.publishAttempt, 4);
    assert.ok(quorumMet.totalElapsedMs >= initialOutageMs);
    assert.ok(quorumMet.totalElapsedMs < 6_000);

    const retriesByRelay = telemetry
      .filter((entry) => entry.event === 'lock_publish_retry')
      .reduce((acc, entry) => {
        acc[entry.relayUrl] = (acc[entry.relayUrl] || 0) + 1;
        return acc;
      }, {});

    assert.strictEqual(retriesByRelay['wss://relay-a'], 3);
    assert.strictEqual(retriesByRelay['wss://relay-b'], 3);
    assert.strictEqual(retriesByRelay['wss://relay-c'], 3);
  });

  it('survives intermittent timeout spikes and reaches quorum with bounded retries', async () => {
    const telemetryLogs = [];
    const sleepCalls = [];

    const pool = createDynamicPool(({ relay, attempt }) => {
      if (relay === 'wss://relay-a') {
        return { ok: true };
      }

      if (relay === 'wss://relay-b' && (attempt === 1 || attempt === 3)) {
        return { ok: false, message: 'publish timed out after 25ms (spike)' };
      }

      return { ok: true };
    });

    const result = await publishLock(['wss://relay-a', 'wss://relay-b'], { id: 'evt-timeout-spikes' }, {
      poolFactory: () => pool,
      getPublishTimeoutMsFn: () => 25,
      getMinSuccessfulRelayPublishesFn: () => 2,
      getRelayFallbacksFn: () => [],
      getMinActiveRelayPoolFn: () => 1,
      retryAttempts: 4,
      retryBaseDelayMs: 200,
      retryCapDelayMs: 200,
      randomFn: () => 1,
      sleepFn: async (delayMs) => {
        sleepCalls.push(delayMs);
        mock.timers.tick(delayMs);
      },
      telemetryLogger: (line) => telemetryLogs.push(line),
      healthLogger: () => {},
      ...healthStabilityOverrides,
    });

    assert.strictEqual(result.id, 'evt-timeout-spikes');
    assert.strictEqual(pool.getPublishCallCount(), 2);
    assert.deepStrictEqual(sleepCalls, [200]);

    const telemetry = parseTelemetry(telemetryLogs);
    const retryEvents = telemetry.filter((entry) => entry.event === 'lock_publish_retry');
    assert.strictEqual(retryEvents.length, 1);
    assert.strictEqual(retryEvents[0].relayUrl, 'wss://relay-b');
    assert.strictEqual(retryEvents[0].errorCategory, 'publish_timeout');

    const quorumMet = telemetry.find((entry) => entry.event === 'lock_publish_quorum_met');
    assert.ok(quorumMet);
    assert.strictEqual(quorumMet.publishAttempt, 2);
    assert.ok(quorumMet.totalElapsedMs <= 1_000);
  });

  it('handles staggered relay recovery and never exceeds retry budget', async () => {
    const telemetryLogs = [];
    const sleepCalls = [];

    const pool = createDynamicPool(({ relay, attempt }) => {
      if (attempt <= 2) {
        return { ok: false, message: 'connect timeout during outage' };
      }
      if (attempt === 3) {
        if (relay === 'wss://relay-a') return { ok: true };
        return { ok: false, message: 'connect timeout during staged recovery' };
      }
      if (relay === 'wss://relay-a' || relay === 'wss://relay-b') {
        return { ok: true };
      }
      return { ok: false, message: 'relay unavailable' };
    });

    const retryAttempts = 6;
    const result = await publishLock(RELAYS, { id: 'evt-staggered-recovery' }, {
      poolFactory: () => pool,
      getPublishTimeoutMsFn: () => 25,
      getMinSuccessfulRelayPublishesFn: () => 2,
      getRelayFallbacksFn: () => [],
      getMinActiveRelayPoolFn: () => 1,
      retryAttempts,
      retryBaseDelayMs: 300,
      retryCapDelayMs: 300,
      randomFn: () => 1,
      sleepFn: async (delayMs) => {
        sleepCalls.push(delayMs);
        mock.timers.tick(delayMs);
      },
      telemetryLogger: (line) => telemetryLogs.push(line),
      healthLogger: () => {},
      ...healthStabilityOverrides,
    });

    assert.strictEqual(result.id, 'evt-staggered-recovery');
    assert.strictEqual(pool.getPublishCallCount(), 4);
    assert.ok(pool.getPublishCallCount() <= retryAttempts);
    assert.deepStrictEqual(sleepCalls, [300, 300, 300]);

    const telemetry = parseTelemetry(telemetryLogs);
    const quorumMet = telemetry.find((entry) => entry.event === 'lock_publish_quorum_met');
    assert.ok(quorumMet);
    assert.strictEqual(quorumMet.publishAttempt, 4);
    assert.ok(quorumMet.totalElapsedMs < 3_000);

    const retriesByRelay = telemetry
      .filter((entry) => entry.event === 'lock_publish_retry')
      .reduce((acc, entry) => {
        acc[entry.relayUrl] = (acc[entry.relayUrl] || 0) + 1;
        return acc;
      }, {});

    assert.strictEqual(retriesByRelay['wss://relay-a'], 2);
    assert.strictEqual(retriesByRelay['wss://relay-b'], 3);
    assert.strictEqual(retriesByRelay['wss://relay-c'], 3);
  });
});
