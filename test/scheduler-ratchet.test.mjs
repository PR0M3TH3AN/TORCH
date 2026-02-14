import { describe, it } from 'node:test';
import assert from 'node:assert';
import { cmdCheck } from '../src/lib.mjs';

describe('Scheduler Ratchet Logic (Log Checking)', () => {
  const mockRelays = ['wss://relay.test'];
  const mockNamespace = 'test-ns';
  const mockTtl = 3600;
  const mockRoster = ['agentA', 'agentB', 'agentC'];
  const mockDateStr = '2023-10-27'; // A Friday
  const mockIsoWeekStr = '2023-W43';

  // Base dependencies for cmdCheck
  const baseDeps = {
    getRelays: () => mockRelays,
    getNamespace: () => mockNamespace,
    getTtl: () => mockTtl,
    getRoster: () => mockRoster,
    loadTorchConfig: () => ({ scheduler: { paused: { daily: [], weekly: [] } } }),
    getDateStr: () => mockDateStr,
    getIsoWeek: () => mockIsoWeekStr,
    queryLocks: async () => [], // No active locks by default
    log: () => {},
    error: () => {},
    // Default readdir mock: returns empty array
    readdir: async () => [],
    logDir: 'mock-logs',
  };

  it('excludes agents completed today (daily)', async () => {
    const deps = {
      ...baseDeps,
      readdir: async () => [
        '2023-10-27T10-00-00Z__agentA__completed.md', // Matching date
        '2023-10-26T10-00-00Z__agentB__completed.md', // Old date
        '2023-10-27T12-00-00Z__agentC__failed.md',    // Failed today
      ],
    };

    const result = await cmdCheck('daily', deps);

    assert.deepStrictEqual(result.completed, ['agentA']);
    assert.ok(result.excluded.includes('agentA'));
    assert.ok(!result.excluded.includes('agentB')); // Completed yesterday, not excluded today
    assert.ok(!result.excluded.includes('agentC')); // Failed, not excluded
    assert.deepStrictEqual(result.available, ['agentB', 'agentC']);
  });

  it('excludes agents completed this week (weekly)', async () => {
    const deps = {
      ...baseDeps,
      getIsoWeek: (date) => {
          if (!date) return mockIsoWeekStr;
          // Mock simple week logic: 2023-10-23 to 2023-10-29 is W43
          if (date >= '2023-10-23' && date <= '2023-10-29') return '2023-W43';
          return '2023-W42';
      },
      readdir: async () => [
        '2023-10-23T10-00-00Z__agentA__completed.md', // Monday (in week)
        '2023-10-20T10-00-00Z__agentB__completed.md', // Last week
      ],
    };

    const result = await cmdCheck('weekly', deps);

    assert.deepStrictEqual(result.completed, ['agentA']);
    assert.ok(result.excluded.includes('agentA'));
    assert.ok(!result.excluded.includes('agentB'));
    assert.deepStrictEqual(result.available, ['agentB', 'agentC']);
  });

  it('combines locked and completed agents in exclusion list', async () => {
    const deps = {
      ...baseDeps,
      queryLocks: async () => [{ agent: 'agentB', eventId: 'ev1' }], // agentB is locked
      readdir: async () => [
        '2023-10-27T10-00-00Z__agentA__completed.md', // agentA is completed
      ],
    };

    const result = await cmdCheck('daily', deps);

    assert.deepStrictEqual(result.completed, ['agentA']);
    assert.deepStrictEqual(result.locked, ['agentB']);

    // agentA (completed) and agentB (locked) should be excluded
    assert.ok(result.excluded.includes('agentA'));
    assert.ok(result.excluded.includes('agentB'));
    assert.deepStrictEqual(result.available, ['agentC']);
  });

  it('ignores logs when --ignore-logs is set', async () => {
    const deps = {
      ...baseDeps,
      readdir: async () => [
        '2023-10-27T10-00-00Z__agentA__completed.md',
      ],
      ignoreLogs: true,
    };

    const result = await cmdCheck('daily', deps);

    assert.deepStrictEqual(result.completed, []);
    assert.ok(!result.excluded.includes('agentA'));
    assert.deepStrictEqual(result.available, ['agentA', 'agentB', 'agentC']);
  });

  it('handles missing log directory gracefully', async () => {
    const deps = {
      ...baseDeps,
      readdir: async () => {
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      },
    };

    const result = await cmdCheck('daily', deps);
    assert.deepStrictEqual(result.completed, []);
    assert.deepStrictEqual(result.available, ['agentA', 'agentB', 'agentC']);
  });
});
