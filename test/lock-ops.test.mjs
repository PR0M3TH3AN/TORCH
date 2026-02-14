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
    it('succeeds with partial primary success when minimum successes is 1', async () => {
      const mockPool = {
        publish: (relays) => relays.map((relay) => (
          relay.includes('ok') ? Promise.resolve('ok') : Promise.reject(new Error('offline'))
        )),
        close: () => {},
      };

      const event = { id: 'evt-1' };
      const result = await publishLock(['wss://ok-1', 'wss://bad-1'], event, {
        poolFactory: () => mockPool,
        getPublishTimeoutMsFn: () => 200,
        getMinSuccessfulRelayPublishesFn: () => 1,
        getRelayFallbacksFn: () => [],
      });

      assert.strictEqual(result, event);
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

    it('fails when successful publishes stay below configured minimum', async () => {
      const mockPool = {
        publish: (relays) => relays.map(() => Promise.reject(new Error('offline'))),
        close: () => {},
      };

      await assert.rejects(
        () => publishLock(['wss://primary-bad'], { id: 'evt-3' }, {
          poolFactory: () => mockPool,
          getPublishTimeoutMsFn: () => 200,
          getMinSuccessfulRelayPublishesFn: () => 2,
          getRelayFallbacksFn: () => ['wss://fallback-bad'],
        }),
        /Failed relay publish quorum in publish phase: 0\/2 successful \(required=2, timeout=200ms\)/,
      );
    });
  });
});
