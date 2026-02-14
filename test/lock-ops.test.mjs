import { test, describe, it } from 'node:test';
import assert from 'node:assert';
import { parseLockEvent } from '../src/lib.mjs';

describe('parseLockEvent', () => {
  it('should parse a valid lock event correctly', () => {
    const event = {
      id: 'mock-event-id',
      pubkey: 'mock-pubkey',
      created_at: 1678886400, // 2023-03-15T13:20:00.000Z
      tags: [
        ['d', 'mock-d-tag'],
        ['expiration', '1678890000'], // 2023-03-15T14:20:00.000Z
      ],
      content: JSON.stringify({
        agent: 'test-agent',
        cadence: 'daily',
        status: 'started',
        namespace: 'test-ns',
        date: '2023-03-15',
        platform: 'test-platform',
      }),
    };

    const result = parseLockEvent(event);

    assert.strictEqual(result.eventId, 'mock-event-id');
    assert.strictEqual(result.pubkey, 'mock-pubkey');
    assert.strictEqual(result.createdAt, 1678886400);
    assert.strictEqual(result.createdAtIso, '2023-03-15T13:20:00.000Z');
    assert.strictEqual(result.expiresAt, 1678890000);
    assert.strictEqual(result.expiresAtIso, '2023-03-15T14:20:00.000Z');
    assert.strictEqual(result.dTag, 'mock-d-tag');
    assert.strictEqual(result.agent, 'test-agent');
    assert.strictEqual(result.cadence, 'daily');
    assert.strictEqual(result.status, 'started');
    assert.strictEqual(result.date, '2023-03-15');
    assert.strictEqual(result.platform, 'test-platform');
  });

  it('should handle missing d tag', () => {
    const event = {
      id: 'mock-event-id',
      pubkey: 'mock-pubkey',
      created_at: 1678886400,
      tags: [],
      content: '{}',
    };

    const result = parseLockEvent(event);
    assert.strictEqual(result.dTag, '');
  });

  it('should handle missing expiration tag', () => {
    const event = {
      id: 'mock-event-id',
      pubkey: 'mock-pubkey',
      created_at: 1678886400,
      tags: [['d', 'mock-d-tag']],
      content: '{}',
    };

    const result = parseLockEvent(event);
    assert.strictEqual(result.expiresAt, null);
    assert.strictEqual(result.expiresAtIso, null);
  });

  it('should handle malformed JSON content', () => {
    const event = {
      id: 'mock-event-id',
      pubkey: 'mock-pubkey',
      created_at: 1678886400,
      tags: [],
      content: '{ invalid json }',
    };

    const result = parseLockEvent(event);
    assert.strictEqual(result.agent, null);
    assert.strictEqual(result.cadence, null);
  });

  it('should handle non-object JSON content (string)', () => {
    const event = {
      id: 'mock-event-id',
      pubkey: 'mock-pubkey',
      created_at: 1678886400,
      tags: [],
      content: '"just a string"',
    };

    const result = parseLockEvent(event);
    assert.strictEqual(result.agent, null);
  });

  it('should handle non-object JSON content (array)', () => {
    const event = {
      id: 'mock-event-id',
      pubkey: 'mock-pubkey',
      created_at: 1678886400,
      tags: [],
      content: '["item1", "item2"]',
    };

    const result = parseLockEvent(event);
    assert.strictEqual(result.agent, null);
  });

  it('should handle partial JSON content', () => {
    const event = {
      id: 'mock-event-id',
      pubkey: 'mock-pubkey',
      created_at: 1678886400,
      tags: [],
      content: JSON.stringify({ agent: 'partial-agent' }),
    };

    const result = parseLockEvent(event);
    assert.strictEqual(result.agent, 'partial-agent');
    assert.strictEqual(result.cadence, null);
  });
});
