import test from 'node:test';
import assert from 'node:assert/strict';

import { applyLifecycleActions, createLifecyclePlan } from '../src/services/memory/pruner.js';

function createMemory(overrides = {}) {
  return {
    schema_version: 1,
    id: overrides.id ?? crypto.randomUUID(),
    agent_id: overrides.agent_id ?? 'agent-1',
    session_id: overrides.session_id ?? 's1',
    type: overrides.type ?? 'event',
    content: overrides.content ?? 'default content',
    summary: overrides.summary ?? 'default summary',
    tags: overrides.tags ?? [],
    importance: overrides.importance ?? 0.5,
    embedding_id: overrides.embedding_id ?? null,
    created_at: overrides.created_at ?? 1_000,
    last_seen: overrides.last_seen ?? 1_000,
    source: overrides.source ?? 'ingest',
    ttl_days: overrides.ttl_days ?? null,
    merged_into: overrides.merged_into ?? null,
    pinned: overrides.pinned ?? false,
  };
}

test('createLifecyclePlan respects delete safety constraints and logs reasons', async () => {
  const now = 80 * 24 * 60 * 60 * 1000;
  const memories = [
    createMemory({
      id: 'pinned',
      pinned: true,
      importance: 0.01,
      created_at: 0,
      last_seen: 0,
      ttl_days: 1,
      tags: ['ops'],
    }),
    createMemory({
      id: 'borderline',
      importance: 0.2,
      created_at: 0,
      last_seen: now - (30 * 24 * 60 * 60 * 1000),
      ttl_days: 1,
      tags: ['ops'],
    }),
    createMemory({
      id: 'deletable',
      importance: 0.05,
      created_at: 0,
      last_seen: 0,
      ttl_days: 1,
      tags: ['ops'],
    }),
  ];

  const plan = await createLifecyclePlan(memories, {
    now,
    retentionMs: 30 * 24 * 60 * 60 * 1000,
    getEmbedding: (memory) => (memory.id === 'borderline' ? [1, 0] : [0, 1]),
  });

  const byId = new Map(plan.actions.map((entry) => [entry.id, entry]));
  assert.equal(byId.get('pinned')?.action, 'keep');
  assert.equal(byId.get('borderline')?.action, 'archive');
  assert.equal(byId.get('deletable')?.action, 'delete');

  for (const log of plan.policyLogs) {
    assert.equal(typeof log.reason, 'string');
    assert.ok(log.reason.length > 0);
  }
});

test('createLifecyclePlan condenses near-duplicates and archives merged source records', async () => {
  const now = 100_000;
  const memories = [
    createMemory({
      id: 'a',
      summary: 'service restarted due to outage',
      importance: 0.2,
      created_at: 95_000,
      last_seen: 95_000,
      tags: ['incident', 'ops'],
    }),
    createMemory({
      id: 'b',
      summary: 'outage led to service restart',
      importance: 0.2,
      created_at: 95_100,
      last_seen: 95_100,
      tags: ['incident'],
    }),
  ];

  const plan = await createLifecyclePlan(memories, {
    now,
    retentionMs: 1_000,
    duplicateWindowMs: 10_000,
    similarityThreshold: 0.9,
    getEmbedding: (memory) => (memory.id === 'a' ? [1, 0] : [0.99, 0.01]),
    generateSummary: async () => JSON.stringify({
      summary: 'Service outage and restart incident summary.',
      importance: 0.4,
    }),
  });

  assert.equal(plan.condensedGroups.length, 1);
  assert.equal(plan.condensedGroups[0].merged.id, 'b');

  const mergedDecision = plan.actions.find((item) => item.id === 'a');
  assert.equal(mergedDecision?.action, 'archive');
  assert.equal(mergedDecision?.merged_into, 'b');
});

test('applyLifecycleActions executes keep/archive/delete and merge markers', async () => {
  const calls = [];
  const repository = {
    async markMerged(id, mergedInto) {
      calls.push(['markMerged', id, mergedInto]);
    },
    async keepMemory(id, reason) {
      calls.push(['keepMemory', id, reason]);
    },
    async archiveMemory(id, reason) {
      calls.push(['archiveMemory', id, reason]);
    },
    async deleteMemory(id, reason) {
      calls.push(['deleteMemory', id, reason]);
    },
  };

  const result = await applyLifecycleActions(repository, {
    actions: [
      { id: 'k1', action: 'keep', reason: 'keep reason', merged_into: null },
      { id: 'a1', action: 'archive', reason: 'archive reason', merged_into: 'k1' },
      { id: 'd1', action: 'delete', reason: 'delete reason', merged_into: null },
    ],
    policyLogs: [],
  });

  assert.deepEqual(calls, [
    ['keepMemory', 'k1', 'keep reason'],
    ['markMerged', 'a1', 'k1'],
    ['archiveMemory', 'a1', 'archive reason'],
    ['deleteMemory', 'd1', 'delete reason'],
  ]);
  assert.equal(result.applied.length, 3);
});
