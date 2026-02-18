import test from 'node:test';
import assert from 'node:assert/strict';
import {
  memoryStats,
  ingestEvents,
  runPruneCycle,
} from '../src/services/memory/index.js';

test('memoryStats with empty repository returns zero counts and rates', async () => {
  const repository = {
    async listMemories() {
      return [];
    },
  };
  const stats = await memoryStats({ repository });

  assert.deepEqual(stats.countsByType, {});
  assert.equal(stats.totals.total, 0);
  assert.equal(stats.totals.pinned, 0);
  assert.equal(stats.totals.archived, 0);
  assert.equal(stats.rates.archivedRate, 0);
  assert.ok(Number.isFinite(stats.rates.deletedRate));
  assert.equal(stats.indexSizeEstimateBytes, 0);
  assert.ok(Number.isFinite(stats.ingestThroughputPerMinute));
});

test('memoryStats with populated repository returns correct counts and totals', async () => {
  const memories = [
    { type: 'event', pinned: false, merged_into: null },
    { type: 'event', pinned: true, merged_into: null },
    { type: 'summary', pinned: false, merged_into: 'some-id' },
  ];
  const repository = {
    async listMemories() {
      return memories;
    },
  };

  const stats = await memoryStats({ repository });

  assert.equal(stats.countsByType.event, 2);
  assert.equal(stats.countsByType.summary, 1);
  assert.equal(stats.totals.total, 3);
  assert.equal(stats.totals.pinned, 1);
  assert.equal(stats.totals.archived, 1);

  // archivedRate = archived / max(1, total) = 1 / 3
  assert.equal(stats.rates.archivedRate, 1 / 3);

  // indexSizeEstimateBytes = 3 * 512 = 1536
  assert.equal(stats.indexSizeEstimateBytes, 1536);
});

test('memoryStats calculates ingest throughput based on window', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  const baseTime = 1000000;
  t.mock.timers.setTime(baseTime);

  const repository = {
    async insertMemory() { return {}; },
    async hasIngestionFingerprint() { return false; },
    async storeIngestionFingerprint() { },
    async linkEmbedding() { },
    async listMemories() { return []; },
  };

  // Create 3 distinct records (different agents to avoid batching into one record)
  await ingestEvents([
    { content: 'e1', agent_id: 'agent-1', timestamp: baseTime },
    { content: 'e2', agent_id: 'agent-2', timestamp: baseTime },
    { content: 'e3', agent_id: 'agent-3', timestamp: baseTime },
  ], { repository });

  // Move time forward 30 mins
  const checkTime = baseTime + 30 * 60 * 1000;
  t.mock.timers.setTime(checkTime);

  // Check stats with 60 min window (should include baseTime)
  // Window: [checkTime - 60min, checkTime] = [baseTime - 30min, baseTime + 30min]
  const stats1 = await memoryStats({
    repository,
    now: checkTime,
    windowMs: 60 * 60 * 1000
  });

  // We expect 3 ingested items in this window.
  // throughput = 3 / (60 mins) = 0.05
  assert.equal(stats1.ingestThroughputPerMinute, 3 / 60);

  // Check stats with window that excludes the events (checkTime + 90 mins)
  const farTime = baseTime + 90 * 60 * 1000;
  // Window: [farTime - 60min, farTime] = [baseTime + 30min, baseTime + 90min]
  // Events at baseTime are < baseTime + 30min, so excluded.

  const stats2 = await memoryStats({
    repository,
    now: farTime,
    windowMs: 60 * 60 * 1000
  });

  assert.equal(stats2.ingestThroughputPerMinute, 0);
});

test('memoryStats reflects deleted count from prune cycle', async () => {
  const repository = {
    async listPruneCandidates() {
      // Return 2 candidates to be pruned
      return [
         { id: 'p1', agent_id: 'a', type: 'event', last_seen: 0, pinned: false },
         { id: 'p2', agent_id: 'a', type: 'event', last_seen: 0, pinned: false },
      ];
    },
    async listMemories() { return []; }
  };

  // Run prune cycle
  await runPruneCycle({ repository, retentionMs: 100, now: 1000 });

  const stats = await memoryStats({ repository });

  // deletedObserved should be increased by 2.
  assert.ok(stats.totals.deletedObserved >= 2);

  // deletedRate should be > 0.
  assert.ok(stats.rates.deletedRate > 0);
});

test('memoryStats handles windowMs parameter correctly', async () => {
  const repository = { async listMemories() { return []; } };

  // Test with invalid windowMs, should default to 1 hour (60 mins)
  const statsDefault = await memoryStats({ repository, windowMs: 'invalid' });
  assert.ok(Number.isFinite(statsDefault.ingestThroughputPerMinute));

  // Test with very small window
  const statsSmall = await memoryStats({ repository, windowMs: 1 });
  assert.ok(Number.isFinite(statsSmall.ingestThroughputPerMinute));
});
