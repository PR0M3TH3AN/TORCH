import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { publishLock, _resetRelayHealthState } from '../src/lock-ops.mjs';

function createScriptedPool(scriptedOutcomesByAttempt, relaysSeen) {
  let publishCallCount = 0;
  return {
    publish: (relays) => {
      publishCallCount += 1;
      relaysSeen.push({ publishAttempt: publishCallCount, relays: [...relays] });
      const attemptOutcomes = scriptedOutcomesByAttempt[publishCallCount - 1] || {};
      return relays.map((relay) => {
        const outcome = attemptOutcomes[relay] || { ok: true };
        return outcome.ok ? Promise.resolve('ok') : Promise.reject(new Error(outcome.message));
      });
    },
    close: () => {},
    getPublishCallCount: () => publishCallCount,
  };
}

const parseTelemetry = (logs) => logs.map((line) => JSON.parse(line));

describe('publishLock retry behavior', { concurrency: false }, () => {
  beforeEach(() => {
    _resetRelayHealthState();
  });

  afterEach(() => {
    mock.timers.reset();
  });

  it('succeeds immediately on first attempt without retries', async () => {
    const telemetryLogs = [];
    const relaysSeen = [];
    const mockPool = createScriptedPool([
      { 'wss://relay-a': { ok: true } },
    ], relaysSeen);

    const event = { id: 'evt-immediate' };
    const result = await publishLock(['wss://relay-a'], event, {
      poolFactory: () => mockPool,
      getPublishTimeoutMsFn: () => 200,
      getMinSuccessfulRelayPublishesFn: () => 1,
      getRelayFallbacksFn: () => [],
      getMinActiveRelayPoolFn: () => 1,
      retryAttempts: 4,
      telemetryLogger: (line) => telemetryLogs.push(line),
      healthLogger: () => {},
    });

    assert.strictEqual(result, event);
    assert.strictEqual(mockPool.getPublishCallCount(), 1);
    assert.deepStrictEqual(relaysSeen, [{ publishAttempt: 1, relays: ['wss://relay-a'] }]);

    const telemetry = parseTelemetry(telemetryLogs);
    assert.strictEqual(telemetry.filter((entry) => entry.event === 'lock_publish_retry').length, 0);
    const metEvent = telemetry.find((entry) => entry.event === 'lock_publish_quorum_met');
    assert.ok(metEvent);
    assert.strictEqual(metEvent.publishAttempt, 1);
  });

  it('retries a transient failure then succeeds within retry budget with bounded jitter', async () => {
    mock.timers.enable({ apis: ['Date', 'setTimeout'] });

    const telemetryLogs = [];
    const relaysSeen = [];
    const sleepCalls = [];
    const mockPool = createScriptedPool([
      { 'wss://relay-a': { ok: false, message: 'connection reset by peer' } },
      { 'wss://relay-a': { ok: true } },
    ], relaysSeen);

    const result = await publishLock(['wss://relay-a'], { id: 'evt-retry-success' }, {
      poolFactory: () => mockPool,
      getPublishTimeoutMsFn: () => 200,
      getMinSuccessfulRelayPublishesFn: () => 1,
      getRelayFallbacksFn: () => [],
      getMinActiveRelayPoolFn: () => 1,
      retryAttempts: 3,
      retryBaseDelayMs: 100,
      retryCapDelayMs: 500,
      randomFn: () => 0.25,
      sleepFn: async (delayMs) => {
        sleepCalls.push(delayMs);
        mock.timers.tick(delayMs);
      },
      telemetryLogger: (line) => telemetryLogs.push(line),
      healthLogger: () => {},
    });

    assert.strictEqual(result.id, 'evt-retry-success');
    assert.deepStrictEqual(sleepCalls, [25]);
    assert.strictEqual(mockPool.getPublishCallCount(), 2);

    const telemetry = parseTelemetry(telemetryLogs);
    const retryEvents = telemetry.filter((entry) => entry.event === 'lock_publish_retry');
    assert.strictEqual(retryEvents.length, 1);
    assert.strictEqual(retryEvents[0].publishAttempt, 1);
    assert.strictEqual(retryEvents[0].relayUrl, 'wss://relay-a');
    assert.ok(retryEvents[0].nextDelayMs >= 0 && retryEvents[0].nextDelayMs <= 100);
  });

  it('returns terminal relay_publish_quorum_failure after exhausting retry budget', async () => {
    mock.timers.enable({ apis: ['Date', 'setTimeout'] });

    const telemetryLogs = [];
    const relaysSeen = [];
    const sleepCalls = [];
    const randomValues = [0.1, 0.9];
    const mockPool = createScriptedPool([
      { 'wss://relay-a': { ok: false, message: 'relay unavailable' } },
      { 'wss://relay-a': { ok: false, message: 'relay unavailable' } },
      { 'wss://relay-a': { ok: false, message: 'relay unavailable' } },
    ], relaysSeen);

    await assert.rejects(
      () => publishLock(['wss://relay-a'], { id: 'evt-exhausted' }, {
        poolFactory: () => mockPool,
        getPublishTimeoutMsFn: () => 200,
        getMinSuccessfulRelayPublishesFn: () => 1,
        getRelayFallbacksFn: () => [],
        getMinActiveRelayPoolFn: () => 1,
        retryAttempts: 3,
        retryBaseDelayMs: 100,
        retryCapDelayMs: 250,
        randomFn: () => randomValues.shift() ?? 0,
        sleepFn: async (delayMs) => {
          sleepCalls.push(delayMs);
          mock.timers.tick(delayMs);
        },
        telemetryLogger: (line) => telemetryLogs.push(line),
        healthLogger: () => {},
      }),
      /error_category=relay_publish_quorum_failure/,
    );

    assert.strictEqual(mockPool.getPublishCallCount(), 3);
    assert.deepStrictEqual(sleepCalls, [10, 180]);
    assert.deepStrictEqual(relaysSeen.map((entry) => entry.publishAttempt), [1, 2, 3]);

    const telemetry = parseTelemetry(telemetryLogs);
    const retryEvents = telemetry.filter((entry) => entry.event === 'lock_publish_retry');
    assert.strictEqual(retryEvents.length, 2);
    assert.strictEqual(retryEvents[0].publishAttempt, 1);
    assert.strictEqual(retryEvents[0].relayUrl, 'wss://relay-a');
    assert.ok(retryEvents[0].nextDelayMs >= 0 && retryEvents[0].nextDelayMs <= 100);
    assert.strictEqual(retryEvents[1].publishAttempt, 2);
    assert.strictEqual(retryEvents[1].relayUrl, 'wss://relay-a');
    assert.ok(retryEvents[1].nextDelayMs >= retryEvents[0].nextDelayMs);
    assert.ok(retryEvents[1].nextDelayMs <= 200);

    const failedEvent = telemetry.find((entry) => entry.event === 'lock_publish_quorum_failed');
    assert.ok(failedEvent);
    assert.strictEqual(failedEvent.errorCategory, 'relay_publish_quorum_failure');
    assert.strictEqual(failedEvent.attempts, 3);
  });

  it('short-circuits non-retryable failures without extra attempts', async () => {
    const telemetryLogs = [];
    const relaysSeen = [];
    const mockPool = createScriptedPool([
      { 'wss://relay-a': { ok: false, message: 'validation failed: invalid signature' } },
      { 'wss://relay-a': { ok: true } },
    ], relaysSeen);

    await assert.rejects(
      () => publishLock(['wss://relay-a'], { id: 'evt-permanent' }, {
        poolFactory: () => mockPool,
        getPublishTimeoutMsFn: () => 200,
        getMinSuccessfulRelayPublishesFn: () => 1,
        getRelayFallbacksFn: () => [],
        getMinActiveRelayPoolFn: () => 1,
        retryAttempts: 4,
        telemetryLogger: (line) => telemetryLogs.push(line),
        healthLogger: () => {},
      }),
      /error_category=relay_publish_non_retryable/,
    );

    assert.strictEqual(mockPool.getPublishCallCount(), 1);
    assert.deepStrictEqual(relaysSeen, [{ publishAttempt: 1, relays: ['wss://relay-a'] }]);

    const telemetry = parseTelemetry(telemetryLogs);
    assert.strictEqual(telemetry.filter((entry) => entry.event === 'lock_publish_retry').length, 0);

    const failedEvent = telemetry.find((entry) => entry.event === 'lock_publish_quorum_failed');
    assert.ok(failedEvent);
    assert.strictEqual(failedEvent.errorCategory, 'relay_publish_non_retryable');
    assert.notStrictEqual(failedEvent.errorCategory, 'relay_publish_quorum_failure');
  });
});
