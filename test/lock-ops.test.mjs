import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  parseLockEvent,
  publishLock,
  queryLocks,
  _resetRelayHealthState,
} from '../src/lock-ops.mjs';

describe('lock-ops', () => {
  beforeEach(() => {
    _resetRelayHealthState();
  });

  describe('parseLockEvent', () => {
    it('parses a valid lock event correctly', () => {
      const event = {
        id: 'mock-event-id',
        pubkey: 'mock-pubkey',
        created_at: 1678886400,
        tags: [['d', 'mock-d-tag'], ['expiration', '1678890000']],
        content: JSON.stringify({
          agent: 'test-agent',
          cadence: 'daily',
          status: 'started',
          date: '2023-03-15',
          platform: 'test-platform',
        }),
      };

      const result = parseLockEvent(event);

      assert.strictEqual(result.dTag, 'mock-d-tag');
      assert.strictEqual(result.expiresAt, 1678890000);
      assert.strictEqual(result.agent, 'test-agent');
      assert.strictEqual(result.platform, 'test-platform');
    });

    it('returns nulls when content is invalid JSON', () => {
      const event = {
        id: 'mock-id',
        pubkey: 'mock-pubkey',
        created_at: 1678886400,
        tags: [],
        content: 'invalid json',
      };
      const result = parseLockEvent(event);
      assert.strictEqual(result.agent, null);
      assert.strictEqual(result.cadence, null);
    });

    it('returns nulls when required content fields are missing', () => {
      const event = {
        id: 'mock-id',
        pubkey: 'mock-pubkey',
        created_at: 1678886400,
        tags: [],
        content: JSON.stringify({}),
      };
      const result = parseLockEvent(event);
      assert.strictEqual(result.agent, null);
      assert.strictEqual(result.cadence, null);
    });

    it('returns nulls when content is an array (not object)', () => {
      const event = {
        id: 'mock-id',
        pubkey: 'mock-pubkey',
        created_at: 1678886400,
        tags: [],
        content: JSON.stringify(['not', 'an', 'object']),
      };
      const result = parseLockEvent(event);
      assert.strictEqual(result.agent, null);
    });
  });

  describe('queryLocks', () => {
    it('falls back to fallback relays when primary query fails', async () => {
      const mockPool = {
        querySync: async (relays) => {
          if (relays.includes('wss://primary')) {
            throw new Error('primary unavailable');
          }
          return [{
            id: 'id-1',
            pubkey: 'pk',
            created_at: Math.floor(Date.now() / 1000),
            tags: [['d', 't']],
            content: JSON.stringify({ agent: 'agent1' }),
          }];
        },
        close: () => {},
      };

      const locks = await queryLocks(
        ['wss://primary'],
        'daily',
        '2026-02-14',
        'torch',
        {
          poolFactory: () => mockPool,
          getQueryTimeoutMsFn: () => 200,
          getRelayFallbacksFn: () => ['wss://fallback'],
          errorLogger: () => {},
          healthLogger: () => {},
        },
      );

      assert.strictEqual(locks.length, 1);
      assert.strictEqual(locks[0].agent, 'agent1');
    });
  });

  describe('publishLock', () => {
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
      assert.ok(Number.isInteger(retryEvents[0].elapsedMs));
      assert.ok(Number.isInteger(retryEvents[1].elapsedMs));

      const metEvent = telemetry.find((entry) => entry.event === 'lock_publish_quorum_met');
      assert.ok(metEvent);
      assert.equal(metEvent.correlationId, 'corr-1');
      assert.equal(metEvent.attemptId, 'attempt-1');
      assert.equal(metEvent.publishAttempt, 2);
      assert.ok(Array.isArray(metEvent.retryTimeline));
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
});
