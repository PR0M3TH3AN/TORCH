import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getRelevantMemories,
  ingestEvents,
  inspectMemory,
  listMemories,
  markMemoryMerged,
  memoryStats,
  pinMemory,
  runPruneCycle,
  triggerPruneDryRun,
  unpinMemory,
} from '../src/services/memory/index.js';

test('listMemories, inspectMemory, pinMemory, and unpinMemory support admin hooks', async () => {
  const records = [
    { id: 'm1', agent_id: 'agent-a', type: 'event', tags: ['ops'], pinned: false, last_seen: 10, merged_into: null },
    { id: 'm2', agent_id: 'agent-a', type: 'summary', tags: ['ops', 'prod'], pinned: true, last_seen: 20, merged_into: null },
    { id: 'm3', agent_id: 'agent-b', type: 'event', tags: ['dev'], pinned: false, last_seen: 5, merged_into: 'm2' },
  ];

  const repository = {
    async listMemories() {
      return records;
    },
    async getMemoryById(id) {
      return records.find((record) => record.id === id) ?? null;
    },
    async setPinned(id, pinned) {
      const index = records.findIndex((record) => record.id === id);
      if (index < 0) return null;
      records[index] = { ...records[index], pinned };
      return records[index];
    },
  };

  const listed = await listMemories({ agent_id: 'agent-a', tags: ['ops'], includeMerged: false }, { repository });
  assert.deepEqual(listed.map((entry) => entry.id), ['m2', 'm1']);

  const inspected = await inspectMemory('m2', { repository });
  assert.equal(inspected?.id, 'm2');

  const pinned = await pinMemory('m1', { repository });
  assert.equal(pinned?.pinned, true);

  const unpinned = await unpinMemory('m2', { repository });
  assert.equal(unpinned?.pinned, false);
});

test('triggerPruneDryRun returns candidate metadata without deleting records', async () => {
  const repository = {
    async listPruneCandidates() {
      return [
        { id: 'old-1', agent_id: 'agent-z', type: 'event', pinned: false, last_seen: 1, merged_into: null },
      ];
    },
    async listMemories() {
      return [];
    },
  };

  const dryRun = await triggerPruneDryRun({ repository, retentionMs: 1000 });
  assert.equal(dryRun.dryRun, true);
  assert.equal(dryRun.candidateCount, 1);
  assert.deepEqual(dryRun.candidates[0], {
    id: 'old-1',
    agent_id: 'agent-z',
    type: 'event',
    pinned: false,
    last_seen: 1,
    merged_into: null,
  });
});

test('memoryStats reports counts/rates and retrieval telemetry remains redaction-safe', async () => {
  const telemetry = [];
  await ingestEvents([
    {
      agent_id: 'agent-telemetry',
      content: 'customer token ABC123 secret',
      timestamp: Date.now(),
      tags: ['incident'],
      metadata: { session_id: 's-telemetry' },
    },
  ]);

  const retrieved = await getRelevantMemories({
    agent_id: 'agent-telemetry',
    query: 'show customer token ABC123 secret',
    emitTelemetry: (event, payload) => telemetry.push({ event, payload }),
  });

  assert.ok(retrieved.length >= 1);
  const retrievalEvent = telemetry.find((entry) => entry.event === 'memory:retrieved');
  assert.ok(retrievalEvent);
  assert.equal('query' in retrievalEvent.payload, false);
  assert.equal(retrievalEvent.payload.query_present, true);
  assert.ok(retrievalEvent.payload.query_length > 0);

  const stats = await memoryStats({ windowMs: 60 * 60 * 1000 });
  assert.ok(stats.totals.total >= 1);
  assert.ok(Number.isFinite(stats.rates.archivedRate));
  assert.ok(Number.isFinite(stats.rates.deletedRate));
  assert.ok(stats.indexSizeEstimateBytes >= 0);
  assert.ok(Number.isFinite(stats.ingestThroughputPerMinute));
});


test('runPruneCycle respects prune feature-flag modes', async () => {
  const repository = {
    async listPruneCandidates() {
      return [
        { id: 'old-1', agent_id: 'agent-z', type: 'event', pinned: false, last_seen: 1, merged_into: null },
      ];
    },
  };

  const dryRunResult = await runPruneCycle({
    repository,
    env: { TORCH_MEMORY_PRUNE_ENABLED: 'dry-run' },
    retentionMs: 1000,
  });
  assert.equal(dryRunResult.mode, 'dry-run');
  assert.equal(dryRunResult.pruned.length, 0);
  assert.equal(dryRunResult.candidates.length, 1);

  const offResult = await runPruneCycle({
    repository,
    env: { TORCH_MEMORY_PRUNE_ENABLED: 'false' },
    retentionMs: 1000,
  });
  assert.equal(offResult.mode, 'off');
  assert.equal(offResult.pruned.length, 0);
});

test('markMemoryMerged delegates to repository and clears cache', async () => {
  let callCount = 0;
  const repository = {
    async markMerged(id, mergedInto) {
      callCount++;
      return id === 'exists';
    }
  };

  const result1 = await markMemoryMerged('exists', 'target', { repository });
  assert.equal(result1, true);
  assert.equal(callCount, 1);

  const result2 = await markMemoryMerged('missing', 'target', { repository });
  assert.equal(result2, false);
  assert.equal(callCount, 2);

  // Verify cache clearing
  const telemetry = [];
  const emitTelemetry = (event, payload) => telemetry.push({ event, payload });

  // 1. Populate cache
  await getRelevantMemories({ agent_id: 'cache-test', emitTelemetry });
  const hit1 = telemetry.findLast(t => t.event === 'memory:retrieved');
  assert.equal(hit1.payload.cache_hit, false);

  // 2. Hit cache
  await getRelevantMemories({ agent_id: 'cache-test', emitTelemetry });
  const hit2 = telemetry.findLast(t => t.event === 'memory:retrieved');
  assert.equal(hit2.payload.cache_hit, true);

  // 3. Clear cache via side-effect
  await markMemoryMerged('exists', 'target', { repository });

  // 4. Miss cache
  await getRelevantMemories({ agent_id: 'cache-test', emitTelemetry });
  const hit3 = telemetry.findLast(t => t.event === 'memory:retrieved');
  assert.equal(hit3.payload.cache_hit, false);
});
