import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getCompletedAgents } from '../src/lock-utils.mjs';

describe('getCompletedAgents', () => {
  it('identifies completed agents for daily cadence today', async () => {
    const today = '2023-10-27';
    const files = [
      `2023-10-27T10-00-00Z__agent1__completed.md`,
      `2023-10-26T10-00-00Z__agent2__completed.md`, // Yesterday
      `2023-10-27T11-00-00Z__agent3__started.md`,   // Not completed
    ];

    const deps = {
      readdir: async () => files,
      getDateStr: () => today,
      getIsoWeek: () => '2023-W43',
    };

    const completed = await getCompletedAgents('daily', 'logs', deps);
    assert.deepStrictEqual([...completed], ['agent1']);
  });

  it('identifies completed agents for weekly cadence this week', async () => {
    const today = '2023-10-27';
    const currentWeek = '2023-W43';

    // agent1: completed this week (today)
    // agent2: completed this week (yesterday)
    // agent3: completed last week
    // agent4: started this week

    const files = [
      `2023-10-27T10-00-00Z__agent1__completed.md`,
      `2023-10-26T10-00-00Z__agent2__completed.md`,
      `2023-10-20T10-00-00Z__agent3__completed.md`,
      `2023-10-27T11-00-00Z__agent4__started.md`,
    ];

    const deps = {
      readdir: async () => files,
      getDateStr: () => today,
      getIsoWeek: (date) => {
        if (!date) return currentWeek;
        if (date === '2023-10-27' || date === '2023-10-26') return '2023-W43';
        if (date === '2023-10-20') return '2023-W42';
        return 'unknown';
      },
    };

    const completed = await getCompletedAgents('weekly', 'logs', deps);
    assert.deepStrictEqual([...completed].sort(), ['agent1', 'agent2']);
  });

  it('handles empty directory gracefully', async () => {
    const deps = {
      readdir: async () => [],
      getDateStr: () => '2023-10-27',
      getIsoWeek: () => '2023-W43',
    };

    const completed = await getCompletedAgents('daily', 'logs', deps);
    assert.strictEqual(completed.size, 0);
  });

  it('ignores malformed filenames', async () => {
    const files = [
      'not-a-valid-log-file.txt',
      '2023-10-27__agent1__completed.md', // Missing time part
    ];

    const deps = {
      readdir: async () => files,
      getDateStr: () => '2023-10-27',
      getIsoWeek: () => '2023-W43',
    };

    const completed = await getCompletedAgents('daily', 'logs', deps);
    assert.strictEqual(completed.size, 0);
  });

  it('handles readdir errors (non-ENOENT) by logging and returning empty set', async () => {
     const originalError = console.error;
     let errorCalled = false;
     console.error = (msg) => { errorCalled = true; };

     const deps = {
       readdir: async () => { throw new Error('Permission denied'); },
       getDateStr: () => '2023-10-27',
       getIsoWeek: () => '2023-W43',
     };

     try {
       const completed = await getCompletedAgents('daily', 'logs', deps);
       assert.strictEqual(completed.size, 0);
       assert.strictEqual(errorCalled, true);
     } finally {
       console.error = originalError;
     }
  });

  it('handles ENOENT (directory missing) silently', async () => {
     const originalError = console.error;
     let errorCalled = false;
     console.error = (msg) => { errorCalled = true; };

     const deps = {
       readdir: async () => {
         const err = new Error('Directory not found');
         err.code = 'ENOENT';
         throw err;
       },
       getDateStr: () => '2023-10-27',
       getIsoWeek: () => '2023-W43',
     };

     try {
       const completed = await getCompletedAgents('daily', 'logs', deps);
       assert.strictEqual(completed.size, 0);
       assert.strictEqual(errorCalled, false);
     } finally {
       console.error = originalError;
     }
  });
});
