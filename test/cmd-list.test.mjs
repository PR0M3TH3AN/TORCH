import { test, describe, it } from 'node:test';
import assert from 'node:assert';
import { cmdList } from '../src/cmd-list.mjs';

describe('cmdList', () => {
  it('should list active locks and identify unknown agents', async () => {
    const logs = [];

    const mockLocks = [
      {
        agent: 'agent-1',
        createdAt: 1000,
        expiresAt: 4600,
        eventId: 'event-1',
        platform: 'linux',
      },
      {
        agent: 'unknown-agent',
        createdAt: 2000,
        eventId: 'event-2',
        platform: 'mac',
      },
    ];

    const deps = {
      getRelays: async () => ['wss://relay.example.com'],
      getNamespace: async () => 'test-namespace',
      queryLocks: async () => mockLocks,
      getRoster: async () => ['agent-1', 'agent-2'],
      todayDateStr: () => '2023-10-27',
      nowUnix: () => 3000, // agent-1 age: 2000s (~33m), unknown-agent age: 1000s (~17m)
      log: (...args) => logs.push(args.join(' ')),
      error: (...args) => logs.push(args.join(' ')),
    };

    await cmdList('daily', deps);

    const output = logs.join('\n');
    // Verify header
    assert.match(output, /Active test-namespace daily locks/);

    // Verify agents listed
    assert.match(output, /agent-1/);
    assert.match(output, /unknown-agent/);

    // Verify unknown warning
    assert.match(output, /Warning: lock events found with non-roster agent names: unknown-agent/);

    // Verify summary stats
    // Locked: 2 (agent-1 and unknown-agent both count as locked agents) / Roster size 2
    assert.match(output, /Locked: 2\/2/);

    // Verify available
    // agent-2 is in roster and not in lockedAgents
    assert.match(output, /Available: agent-2/);
  });
});
