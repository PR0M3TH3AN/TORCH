import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeMemoryItem, validateMemoryItem } from '../src/services/memory/schema.js';
import { summarizeEvents } from '../src/services/memory/summarizer.js';
import { ingestMemoryWindow } from '../src/services/memory/ingestor.js';
import { filterAndRankMemories } from '../src/services/memory/retriever.js';
import { createLifecyclePlan } from '../src/services/memory/pruner.js';
import { startMemoryMaintenanceScheduler } from '../src/services/memory/scheduler.js';
import {
  BASE_MEMORY_RECORD,
  EXPECTED_SUMMARY,
  EXPECTED_TAGS,
  FIXED_NOW,
  SYNTHETIC_EVENTS,
} from './fixtures/memory-fixtures.js';

/** Drain the async job queue without wall-clock dependency. */
const flushAsync = async () => {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

const withMockedNow = async (now, run) => {
  const originalNow = Date.now;
  Date.now = () => now;
  try {
    await run();
  } finally {
    Date.now = originalNow;
  }
};

test('schema validation covers required fields, coercion, and rejection paths', () => {
  const normalized = normalizeMemoryItem({
    agent_id: 'agent-alpha',
    content: 'synthetic content',
    summary: 'synthetic summary',
    tags: ['incident', 7, ''],
    importance: 8,
    ttl_days: 4.9,
    pinned: 'true',
  });

  assert.equal(normalized.agent_id, 'agent-alpha');
  assert.deepEqual(normalized.tags, ['incident', '7']);
  assert.equal(normalized.importance, 1);
  assert.equal(normalized.ttl_days, 4);
  assert.equal(normalized.pinned, true);

  const validation = validateMemoryItem({
    ...BASE_MEMORY_RECORD,
    agent_id: '',
    importance: 2,
    ttl_days: -1,
  });

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.field === 'agent_id'));
  assert.ok(validation.errors.some((error) => error.field === 'importance'));
  assert.ok(validation.errors.some((error) => error.field === 'ttl_days'));
});

test('summarizer parser accepts valid json and recovers after malformed json response', async () => {
  let calls = 0;
  const summary = await summarizeEvents(SYNTHETIC_EVENTS, {
    generateSummary() {
      calls += 1;
      if (calls === 1) return '{"summary":"broken"';
      return JSON.stringify({
        summary: EXPECTED_SUMMARY,
        importance: 0.78,
      });
    },
    now: FIXED_NOW,
  });

  assert.equal(calls, 2);
  assert.equal(summary.summary, EXPECTED_SUMMARY);
  assert.equal(summary.importance, 0.78);
});

test('ingest integration persists memory records and links embeddings from event batches', async () => {
  const inserted = [];
  const linked = [];

  const repository = {
    async insertMemory(memory) {
      inserted.push(memory);
      return memory;
    },
    async linkEmbedding(memoryId, embedding) {
      linked.push({ memoryId, embedding });
    },
  };

  const records = await ingestMemoryWindow(
    {
      events: SYNTHETIC_EVENTS,
      windowStart: FIXED_NOW - 10_000,
      windowEnd: FIXED_NOW,
    },
    {
      repository,
      now: FIXED_NOW,
      maxChunkChars: 1_000,
      embedText: () => [0.11, 0.89],
      embedderAdapter: {
        async embedText() {
          return [0.11, 0.89];
        },
        async upsertVector() {},
      },
      generateSummary: async () => JSON.stringify({
        summary: EXPECTED_SUMMARY,
        importance: 0.82,
      }),
    }
  );

  assert.equal(records.length, 1);
  assert.equal(inserted.length, 1);
  assert.equal(linked.length, 1);
  assert.equal(inserted[0].summary, EXPECTED_SUMMARY);
  assert.deepEqual(inserted[0].tags, EXPECTED_TAGS);
  assert.equal(linked[0].memoryId, inserted[0].id);
});

test('retrieval ranking blends semantic, importance, and recency signals', async () => {
  const records = [
    {
      ...BASE_MEMORY_RECORD,
      id: 'semantic-high',
      importance: 0.2,
      last_seen: FIXED_NOW - 200_000,
    },
    {
      ...BASE_MEMORY_RECORD,
      id: 'importance-high',
      summary: 'Minor semantic match',
      importance: 0.95,
      last_seen: FIXED_NOW - 90_000_000,
    },
    {
      ...BASE_MEMORY_RECORD,
      id: 'recent-balanced',
      summary: 'Recent task update',
      importance: 0.7,
      last_seen: FIXED_NOW - 10_000,
    },
  ];

  const ranked = await filterAndRankMemories(records, {
    agent_id: 'agent-alpha',
    query: 'incident resolved',
    k: 3,
    now: FIXED_NOW,
    vectorAdapter: {
      async embedText() {
        return [1, 0];
      },
      async queryVector() {
        return [
          { id: 'semantic-high', score: 0.99 },
          { id: 'recent-balanced', score: 0.52 },
          { id: 'importance-high', score: 0.15 },
        ];
      },
    },
  });

  assert.deepEqual(ranked.map((item) => item.id), ['semantic-high', 'recent-balanced', 'importance-high']);
});

test('pruner policy protects pins, merges duplicates, and picks archive/delete outcomes', async () => {
  const memories = [
    {
      ...BASE_MEMORY_RECORD,
      id: 'pinned-memory',
      pinned: true,
      importance: 0.01,
      ttl_days: 1,
      created_at: FIXED_NOW - (120 * 24 * 60 * 60 * 1000),
      last_seen: FIXED_NOW - (120 * 24 * 60 * 60 * 1000),
    },
    {
      ...BASE_MEMORY_RECORD,
      id: 'merge-a',
      summary: 'service restart after outage',
      importance: 0.2,
      created_at: FIXED_NOW - 10_000,
      last_seen: FIXED_NOW - 9_000,
    },
    {
      ...BASE_MEMORY_RECORD,
      id: 'merge-b',
      summary: 'outage triggered service restart',
      importance: 0.2,
      created_at: FIXED_NOW - 9_500,
      last_seen: FIXED_NOW - 8_500,
      tags: ['incident', 'ops'],
    },
    {
      ...BASE_MEMORY_RECORD,
      id: 'delete-me',
      importance: 0.01,
      ttl_days: 1,
      created_at: FIXED_NOW - (100 * 24 * 60 * 60 * 1000),
      last_seen: FIXED_NOW - (100 * 24 * 60 * 60 * 1000),
      pinned: false,
    },
  ];

  const plan = await createLifecyclePlan(memories, {
    now: FIXED_NOW,
    retentionMs: 30 * 24 * 60 * 60 * 1000,
    similarityThreshold: 0.9,
    duplicateWindowMs: 60_000,
    getEmbedding(memory) {
      if (memory.id === 'merge-a') return [1, 0];
      if (memory.id === 'merge-b') return [0.99, 0.01];
      return [0, 1];
    },
    generateSummary: async () => JSON.stringify({
      summary: 'Merged outage restart summary',
      importance: 0.4,
    }),
  });

  const actionById = new Map(plan.actions.map((action) => [action.id, action.action]));
  assert.equal(actionById.get('pinned-memory'), 'keep');
  assert.equal(actionById.get('merge-a'), 'archive');
  assert.equal(actionById.get('merge-b'), 'keep');
  assert.equal(actionById.get('delete-me'), 'delete');
});

test('scheduler smoke test handles mocked clock and lock contention', async () => {
  const metrics = [];

  await withMockedNow(FIXED_NOW, async () => {
    const scheduler = startMemoryMaintenanceScheduler({
      runImmediately: true,
      maxRetries: 0,
      random: () => 0,
      emitMetric(name, payload) {
        metrics.push({ name, payload });
      },
      lockProvider: {
        async withLock(lockKey, task) {
          if (lockKey.includes('consolidate-observations')) {
            return { acquired: false, result: null };
          }
          return { acquired: true, result: await task() };
        },
      },
      handlers: {
        async ingestRecentRuntimeEvents() {
          return { itemCount: 2 };
        },
        async consolidateObservations() {
          return { itemCount: 0 };
        },
        async pruningCycle() {
          return { itemCount: 1 };
        },
        async deepMergeArchivalMaintenance() {
          return { itemCount: 1 };
        },
      },
    });

    await flushAsync();
    scheduler.stop();
  });

  const statuses = new Map(metrics.map((entry) => [entry.payload.job, entry.payload.status]));
  assert.equal(statuses.get('ingestRecentRuntimeEvents'), 'success');
  assert.equal(statuses.get('consolidateObservations'), 'skipped_lock_unavailable');
  assert.equal(statuses.get('pruningCycle'), 'success');
  assert.equal(statuses.get('deepMergeArchivalMaintenance'), 'success');
});
