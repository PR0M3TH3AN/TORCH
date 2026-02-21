import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  getCompletedAgents,
  withTimeout,
  relayListLabel,
  mergeRelayList
} from '../src/lock-utils.mjs';

describe('lock-utils', () => {
  describe('withTimeout', () => {
    it('resolves if promise completes before timeout', async () => {
      const result = await withTimeout(
        Promise.resolve('success'),
        100,
        'timed out'
      );
      assert.equal(result, 'success');
    });

    it('rejects with timeout message if promise takes too long', async () => {
      const slowPromise = new Promise((resolve) => setTimeout(resolve, 100));
      await assert.rejects(
        () => withTimeout(slowPromise, 10, 'timed out'),
        { message: 'timed out' }
      );
    });

    it('rejects if the promise rejects before timeout', async () => {
      await assert.rejects(
        () => withTimeout(Promise.reject(new Error('fail')), 100, 'timed out'),
        { message: 'fail' }
      );
    });
  });

  describe('relayListLabel', () => {
    it('joins relays with comma and space', () => {
      assert.equal(relayListLabel(['wss://relay1', 'wss://relay2']), 'wss://relay1, wss://relay2');
    });

    it('handles single relay', () => {
      assert.equal(relayListLabel(['wss://relay1']), 'wss://relay1');
    });

    it('handles empty list', () => {
      assert.equal(relayListLabel([]), '');
    });
  });

  describe('mergeRelayList', () => {
    it('merges two lists', () => {
      const result = mergeRelayList(['r1'], ['r2']);
      assert.deepEqual(result, ['r1', 'r2']);
    });

    it('deduplicates relays', () => {
      const result = mergeRelayList(['r1', 'r2'], ['r2', 'r3']);
      assert.deepEqual(result, ['r1', 'r2', 'r3']);
    });

    it('handles empty lists', () => {
      assert.deepEqual(mergeRelayList([], ['r1']), ['r1']);
      assert.deepEqual(mergeRelayList(['r1'], []), ['r1']);
      assert.deepEqual(mergeRelayList([], []), []);
    });
  });

  describe('getCompletedAgents', () => {
    // Helper to create deps
    const createDeps = (overrides = {}) => ({
      readdir: async () => [],
      getDateStr: () => '2023-01-01',
      getIsoWeek: () => '2023-W01',
      ...overrides,
    });

    it('returns completed agents for daily cadence', async () => {
      const deps = createDeps({
        readdir: async () => [
          '2023-01-01T10-00-00Z__agent1__completed.md',
          '2023-01-01T11-00-00Z__agent2__failed.md',
          '2023-01-02T10-00-00Z__agent3__completed.md', // different day
        ],
        getDateStr: () => '2023-01-01',
      });
      const result = await getCompletedAgents('daily', 'logs', deps);
      assert.deepEqual([...result], ['agent1']);
    });

    it('returns completed agents for weekly cadence', async () => {
      const deps = createDeps({
        readdir: async () => [
          '2023-01-01T10-00-00Z__agent1__completed.md', // Week 52 of 2022 (Sunday) - assuming mock logic
          '2023-01-02T10-00-00Z__agent2__completed.md', // Week 01 of 2023 (Monday)
        ],
        getIsoWeek: (date) => {
             if (!date) return '2023-W01'; // current week
             if (date === '2023-01-01') return '2022-W52';
             if (date === '2023-01-02') return '2023-W01';
             return 'UNKNOWN';
        }
      });
      // cadence is weekly
      const result = await getCompletedAgents('weekly', 'logs', deps);
      assert.deepEqual([...result], ['agent2']);
    });

    it('handles ENOENT gracefully', async () => {
       const error = new Error('No such file or directory');
       error.code = 'ENOENT';
       const deps = createDeps({
         readdir: async () => { throw error; }
       });

       // Spy on console.error to ensure it is NOT called
       const consoleError = mock.method(console, 'error');

       const result = await getCompletedAgents('daily', 'logs', deps);

       assert.equal(consoleError.mock.callCount(), 0);
       assert.deepEqual([...result], []);
       consoleError.mock.restore();
    });

    it('logs error for non-ENOENT errors', async () => {
       const error = new Error('Permission denied');
       error.code = 'EACCES';
       const deps = createDeps({
         readdir: async () => { throw error; }
       });

       // Spy on console.error to verify it IS called
       const consoleError = mock.method(console, 'error');

       const result = await getCompletedAgents('daily', 'logs', deps);

       assert.equal(consoleError.mock.callCount(), 1);
       const call = consoleError.mock.calls[0];
       assert.match(call.arguments[0], /Warning: Failed to read log dir/);
       assert.match(call.arguments[0], /Permission denied/);

       assert.deepEqual([...result], []);
       consoleError.mock.restore();
    });
  });
});
