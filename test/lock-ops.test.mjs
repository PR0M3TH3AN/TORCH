import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseLockEvent, publishLock, queryLocks } from '../src/lock-ops.mjs';

describe('lock-ops', () => {
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
  });

  describe('queryLocks', () => {
    it('falls back to fallback relays when primary query fails', async () => {
      const mockPool = {
        querySync: async (relays) => {
          if (relays[0] === 'wss://primary') {
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
      });

      assert.strictEqual(result, event);
      assert.strictEqual(publishCalls, 2);
      assert.deepStrictEqual(sleepCalls, [250]);
      assert.strictEqual(telemetry.length, 2);
      assert.deepStrictEqual(telemetry[0], {
        event: 'lock_publish_retry',
        attempt: 1,
        relayUrl: 'wss://primary-a',
        errorCategory: 'connection_reset',
        elapsedMs: telemetry[0].elapsedMs,
        nextDelayMs: 250,
      });
      assert.deepStrictEqual(telemetry[1], {
        event: 'lock_publish_retry',
        attempt: 1,
        relayUrl: 'wss://primary-b',
        errorCategory: 'connection_reset',
        elapsedMs: telemetry[1].elapsedMs,
        nextDelayMs: 250,
      });
      assert.ok(Number.isInteger(telemetry[0].elapsedMs));
      assert.ok(Number.isInteger(telemetry[1].elapsedMs));
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
          retryAttempts: 3,
          randomFn: () => 1,
          sleepFn: async (ms) => {
            sleepCalls.push(ms);
          },
          telemetryLogger: () => {},
        }),
        /Failed relay publish quorum in publish phase: 0\/1 successful \(required=1, timeout=200ms, attempts=3\)/,
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
          retryAttempts: 4,
          sleepFn: async () => {
            throw new Error('should not sleep for permanent failures');
          },
          telemetryLogger: () => {
            throw new Error('should not emit retry telemetry for permanent failures');
          },
        }),
        /Failed relay publish quorum in publish phase: 0\/1 successful \(required=1, timeout=200ms, attempts=4\)/,
      );

      assert.strictEqual(publishCalls, 1);
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
        retryAttempts: 3,
        sleepFn: async () => {
          throw new Error('should not sleep when quorum is satisfied');
        },
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
      });

      assert.strictEqual(result, event);
    });
  });
});
