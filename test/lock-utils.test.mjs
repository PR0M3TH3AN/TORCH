import { test } from 'node:test';
import assert from 'node:assert';
import { getCompletedAgents } from '../src/lock-utils.mjs';

test('getCompletedAgents', async (t) => {
  await t.test('returns empty set if directory read fails (non-ENOENT)', async () => {
    const deps = {
      readdir: async () => { throw new Error('Permission denied'); },
      getDateStr: () => '2026-02-24',
      getIsoWeek: () => '2026-W09'
    };
    const completed = await getCompletedAgents('daily', 'logs', deps);
    assert.strictEqual(completed.size, 0);
  });

  await t.test('returns empty set if directory does not exist (ENOENT)', async () => {
    const error = new Error('ENOENT');
    error.code = 'ENOENT';
    const deps = {
      readdir: async () => { throw error; },
      getDateStr: () => '2026-02-24',
      getIsoWeek: () => '2026-W09'
    };
    const completed = await getCompletedAgents('daily', 'logs', deps);
    assert.strictEqual(completed.size, 0);
  });

  await t.test('identifies daily completed agents correctly', async () => {
    const files = [
      '2026-02-24T10-00-00Z__agent-a__completed.md',
      '2026-02-24T11-00-00Z__agent-b__failed.md', // failed, not completed
      '2026-02-23T10-00-00Z__agent-c__completed.md', // yesterday
      'invalid-format.md'
    ];
    const deps = {
      readdir: async () => files,
      getDateStr: () => '2026-02-24',
      getIsoWeek: () => '2026-W09'
    };
    const completed = await getCompletedAgents('daily', 'logs', deps);
    assert.ok(completed.has('agent-a'));
    assert.ok(!completed.has('agent-b'));
    assert.ok(!completed.has('agent-c'));
    assert.strictEqual(completed.size, 1);
  });

  await t.test('identifies weekly completed agents correctly', async () => {
    const files = [
      '2026-02-24T10-00-00Z__agent-a__completed.md', // this week (W09)
      '2026-02-17T10-00-00Z__agent-b__completed.md', // last week (W08)
    ];
    const deps = {
      readdir: async () => files,
      getDateStr: () => '2026-02-24',
      getIsoWeek: (date) => {
          if (date === '2026-02-24') return '2026-W09';
          if (date === '2026-02-17') return '2026-W08';
          return '2026-W09'; // Default for current
      }
    };
    const completed = await getCompletedAgents('weekly', 'logs', deps);
    assert.ok(completed.has('agent-a'));
    assert.ok(!completed.has('agent-b'));
    assert.strictEqual(completed.size, 1);
  });
});
