import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { publishLock } from '../src/lock-publisher.mjs';
import { defaultHealthManager } from '../src/relay-health-manager.mjs';

function _resetRelayHealthState() {
  defaultHealthManager.reset();
}

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

describe('LockPublisher', () => {
  beforeEach(() => {
    _resetRelayHealthState();
  });

  afterEach(() => {
    mock.timers.reset();
  });

  describe('publishLock basic and retry logic', () => {
    it('retries transient failures and succeeds on a later attempt', async () => {
      const telemetry = [];
      const sleepCalls = [];
      let publishCalls = 0;

      const mockPool = {
        publish: (relays) => {
          publishCalls += 1;
          if (publishCalls === 1) {
            return relays.map(() => Promise.reject(new Error('connection reset by peer')));
          }
          return relays.map(() => Promise.resolve('ok'));
        },
        close: () => {},
      };

      const event = { id: 'evt-retry' };
      const result = await publishLock(['wss://primary-a', 'wss://primary-b'], event, {
        poolFactory: () => mockPool,
        getPublishTimeoutMsFn: () => 200,
        getMinSuccessfulRelayPublishesFn: () => 1,
        getRelayFallbacksFn: () => [],
        getMinActiveRelayPoolFn: () => 1,
        retryAttempts: 3,
        retryBaseDelayMs: 500,
        retryCapDelayMs: 8_000,
        randomFn: () => 0.5,
        sleepFn: async (ms) => {
          sleepCalls.push(ms);
        },
        telemetryLogger: (line) => {
          telemetry.push(JSON.parse(line));
        },
        healthLogger: () => {},
        diagnostics: {
          attemptId: 'attempt-1',
          correlationId: 'corr-1',
        },
      });

      assert.strictEqual(result, event);
      assert.strictEqual(publishCalls, 2);
      assert.deepStrictEqual(sleepCalls, [250]);

      const retryEvents = telemetry.filter((entry) => entry.event === 'lock_publish_retry');
      assert.strictEqual(retryEvents.length, 2);
      assert.deepStrictEqual(retryEvents[0], {
        event: 'lock_publish_retry',
        correlationId: 'corr-1',
        attemptId: 'attempt-1',
        publishAttempt: 1,
        relayUrl: 'wss://primary-a',
        errorCategory: 'connection_reset',
        elapsedMs: retryEvents[0].elapsedMs,
        nextDelayMs: 250,
      });
      assert.deepStrictEqual(retryEvents[1], {
        event: 'lock_publish_retry',
        correlationId: 'corr-1',
        attemptId: 'attempt-1',
        publishAttempt: 1,
        relayUrl: 'wss://primary-b',
        errorCategory: 'connection_reset',
        elapsedMs: retryEvents[1].elapsedMs,
        nextDelayMs: 250,
      });
    });

    it('fails after retry budget is exhausted for persistent transient failures', async () => {
      let publishCalls = 0;
      const sleepCalls = [];

      const mockPool = {
        publish: (relays) => {
          publishCalls += 1;
          return relays.map(() => Promise.reject(new Error('relay unavailable')));
        },
        close: () => {},
      };

      await assert.rejects(
        () => publishLock(['wss://primary-down'], { id: 'evt-exhausted' }, {
          poolFactory: () => mockPool,
          getPublishTimeoutMsFn: () => 200,
          getMinSuccessfulRelayPublishesFn: () => 1,
          getRelayFallbacksFn: () => [],
          getMinActiveRelayPoolFn: () => 1,
          retryAttempts: 3,
          randomFn: () => 1,
          sleepFn: async (ms) => {
            sleepCalls.push(ms);
          },
          telemetryLogger: () => {},
          healthLogger: () => {},
        }),
        /Failed relay publish quorum in publish phase: 0\/1 successful \(required=1, timeout=200ms, attempts=3,/,
      );

      assert.strictEqual(publishCalls, 3);
      assert.deepStrictEqual(sleepCalls, [500, 1000]);
    });

    it('fails without retry for persistent validation failures', async () => {
      let publishCalls = 0;
      const mockPool = {
        publish: (relays) => {
          publishCalls += 1;
          return relays.map(() => Promise.reject(new Error('validation failed: invalid signature')));
        },
        close: () => {},
      };

      await assert.rejects(
        () => publishLock(['wss://primary-bad'], { id: 'evt-permanent' }, {
          poolFactory: () => mockPool,
          getPublishTimeoutMsFn: () => 200,
          getMinSuccessfulRelayPublishesFn: () => 1,
          getRelayFallbacksFn: () => [],
          getMinActiveRelayPoolFn: () => 1,
          retryAttempts: 4,
          sleepFn: async () => {
            throw new Error('should not sleep for permanent failures');
          },
          telemetryLogger: () => {},
          healthLogger: () => {},
        }),
        /Failed relay publish quorum in publish phase: 0\/1 successful \(required=1, timeout=200ms, attempts=4,/,
      );

      assert.strictEqual(publishCalls, 1);
    });

    it('includes per-relay reason categories and retry metadata in failure diagnostics', async () => {
      const telemetry = [];
      const mockPool = {
        publish: (relays) => relays.map((relay) => {
          if (relay.includes('dns')) return Promise.reject(new Error('getaddrinfo ENOTFOUND relay.example'));
          if (relay.includes('tcp')) return Promise.reject(new Error('connect ETIMEDOUT 1.2.3.4:443'));
          if (relay.includes('tls')) return Promise.reject(new Error('TLS handshake failure'));
          if (relay.includes('ws')) return Promise.reject(new Error('websocket: unexpected server response'));
          return Promise.reject(new Error('[publish:primary] Publish timed out after 200ms'));
        }),
        close: () => {},
      };

      await assert.rejects(
        () => publishLock(['wss://dns', 'wss://tcp', 'wss://tls', 'wss://ws', 'relay-timeout'], { id: 'evt-diag' }, {
          poolFactory: () => mockPool,
          getPublishTimeoutMsFn: () => 200,
          getMinSuccessfulRelayPublishesFn: () => 1,
          getRelayFallbacksFn: () => [],
          getMinActiveRelayPoolFn: () => 1,
          retryAttempts: 1,
          telemetryLogger: (line) => telemetry.push(JSON.parse(line)),
          healthLogger: () => {},
          diagnostics: { attemptId: 'attempt-42', correlationId: 'corr-42' },
        }),
      );

      const summaryEvent = telemetry.find((entry) => entry.event === 'lock_publish_quorum_failed');
      assert.ok(summaryEvent);
      const failureEvents = telemetry.filter((entry) => entry.event === 'lock_publish_failure');
      const failureText = failureEvents.map((entry) => `${entry.relayUrl}:${entry.reason}`).join('\n');

      assert.match(failureText, /wss:\/\/dns:dns_resolution/);
      assert.match(failureText, /wss:\/\/tcp:tcp_connect_timeout/);
      assert.match(failureText, /wss:\/\/tls:tls_handshake/);
      assert.match(failureText, /wss:\/\/ws:websocket_open_failure/);
      assert.match(failureText, /relay-timeout:publish_timeout/);


      assert.deepStrictEqual(summaryEvent.reasonDistribution, {
        dns_resolution: 1,
        tcp_connect_timeout: 1,
        tls_handshake: 1,
        websocket_open_failure: 1,
        publish_timeout: 1,
      });
    });

    it('returns success when mixed relay outcomes still satisfy quorum', async () => {
      let publishCalls = 0;
      const mockPool = {
        publish: (relays) => {
          publishCalls += 1;
          return relays.map((relay) => (
            relay === 'wss://relay-ok'
              ? Promise.resolve('ok')
              : Promise.reject(new Error('validation failed: rejected event'))
          ));
        },
        close: () => {},
      };

      const event = { id: 'evt-mixed' };
      const result = await publishLock(['wss://relay-ok', 'wss://relay-bad'], event, {
        poolFactory: () => mockPool,
        getPublishTimeoutMsFn: () => 200,
        getMinSuccessfulRelayPublishesFn: () => 1,
        getRelayFallbacksFn: () => [],
        getMinActiveRelayPoolFn: () => 1,
        retryAttempts: 3,
        sleepFn: async () => {
          throw new Error('should not sleep when quorum is satisfied');
        },
        healthLogger: () => {},
      });

      assert.strictEqual(result, event);
      assert.strictEqual(publishCalls, 1);
    });

    it('uses fallback relays to satisfy min success quorum', async () => {
      const mockPool = {
        publish: (relays) => relays.map((relay) => (
          relay.includes('fallback-ok') ? Promise.resolve('ok') : Promise.reject(new Error('offline'))
        )),
        close: () => {},
      };

      const event = { id: 'evt-2' };
      const result = await publishLock(['wss://primary-bad'], event, {
        poolFactory: () => mockPool,
        getPublishTimeoutMsFn: () => 200,
        getMinSuccessfulRelayPublishesFn: () => 1,
        getRelayFallbacksFn: () => ['wss://fallback-ok'],
        getMinActiveRelayPoolFn: () => 1,
        healthLogger: () => {},
      });

      assert.strictEqual(result, event);
    });

    it('quarantines repeatedly failing relays and still reaches quorum with one healthy relay', async () => {
      const callOrder = [];
      const mockPool = {
        publish: (relays) => relays.map((relay) => {
          callOrder.push(relay);
          if (relay === 'wss://healthy') {
            return Promise.resolve('ok');
          }
          return Promise.reject(new Error('offline'));
        }),
        close: () => {},
      };

      const event = { id: 'evt-health' };

      for (let i = 0; i < 3; i += 1) {
        await publishLock(['wss://bad', 'wss://healthy'], event, {
          poolFactory: () => mockPool,
          getPublishTimeoutMsFn: () => 200,
          getMinSuccessfulRelayPublishesFn: () => 1,
          getRelayFallbacksFn: () => [],
          getMinActiveRelayPoolFn: () => 1,
          retryAttempts: 1,
          failureThreshold: 2,
          quarantineCooldownMs: 60_000,
          healthLogger: () => {},
        });
      }

      callOrder.length = 0;
      await publishLock(['wss://bad', 'wss://healthy'], event, {
        poolFactory: () => mockPool,
        getPublishTimeoutMsFn: () => 200,
        getMinSuccessfulRelayPublishesFn: () => 1,
        getRelayFallbacksFn: () => [],
        getMinActiveRelayPoolFn: () => 1,
        retryAttempts: 1,
        failureThreshold: 2,
        quarantineCooldownMs: 60_000,
        healthLogger: () => {},
      });

      assert.deepStrictEqual(callOrder, ['wss://healthy']);
    });

    it('uses fallback and min active pool to reintroduce quarantined relay when needed', async () => {
      const attempts = [];
      const mockPool = {
        publish: (relays) => relays.map((relay) => {
          attempts.push(relay);
          if (relay === 'wss://fallback-healthy') {
            return Promise.resolve('ok');
          }
          return Promise.reject(new Error('relay timeout'));
        }),
        close: () => {},
      };

      const event = { id: 'evt-quorum' };
      await publishLock(['wss://primary-a', 'wss://primary-b'], event, {
        poolFactory: () => mockPool,
        getPublishTimeoutMsFn: () => 200,
        getMinSuccessfulRelayPublishesFn: () => 1,
        getRelayFallbacksFn: () => ['wss://fallback-healthy'],
        getMinActiveRelayPoolFn: () => 2,
        retryAttempts: 1,
        failureThreshold: 1,
        quarantineCooldownMs: 60_000,
        healthLogger: () => {},
      });

      assert.ok(attempts.includes('wss://fallback-healthy'));
    });
  });

  describe('scripted retry scenarios', () => {
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
});
