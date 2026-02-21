import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  parseLockEvent,
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
});
