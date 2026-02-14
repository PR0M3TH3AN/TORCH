import test from 'node:test';
import assert from 'node:assert/strict';

import { filterAndRankMemories } from '../src/services/memory/retriever.js';
import {
  formatMemoriesForPrompt,
  isMemoryRetrievalEnabled,
  renderPromptWithMemoryContext,
} from '../src/services/memory/formatter.js';

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
    created_at: overrides.created_at ?? 1000,
    last_seen: overrides.last_seen ?? 1000,
    source: overrides.source ?? 'ingest',
    ttl_days: overrides.ttl_days ?? null,
    merged_into: overrides.merged_into ?? null,
    pinned: overrides.pinned ?? false,
  };
}

test('filterAndRankMemories applies metadata filters and composite score', async () => {
  const now = 10_000;
  const memories = [
    createMemory({
      id: 'm1',
      content: 'billing incident root cause',
      summary: 'billing incident',
      importance: 0.9,
      tags: ['incident', 'billing'],
      created_at: 9000,
      last_seen: 9500,
      pinned: true,
    }),
    createMemory({
      id: 'm2',
      content: 'billing note',
      summary: 'routine billing note',
      importance: 0.2,
      tags: ['billing'],
      created_at: 8000,
      last_seen: 8000,
      pinned: false,
    }),
    createMemory({
      id: 'm3',
      content: 'other agent record',
      summary: 'not for this agent',
      agent_id: 'agent-2',
      tags: ['incident', 'billing'],
    }),
  ];

  const vectorAdapter = {
    async embedText() {
      return [1, 0];
    },
    async queryVector() {
      return [
        { id: 'm1', score: 0.95 },
        { id: 'm2', score: 0.8 },
      ];
    },
  };

  const ranked = await filterAndRankMemories(memories, {
    agent_id: 'agent-1',
    query: 'billing incident',
    tags: ['billing'],
    timeframe: { from: 7000, to: 10_000 },
    pinnedPreference: 'prefer',
    k: 5,
    now,
    vectorAdapter,
  });

  assert.deepEqual(ranked.map((item) => item.id), ['m1', 'm2']);

  const pinnedOnly = await filterAndRankMemories(memories, {
    agent_id: 'agent-1',
    query: 'billing',
    pinnedPreference: 'only',
    k: 5,
    now,
    vectorAdapter,
  });

  assert.deepEqual(pinnedOnly.map((item) => item.id), ['m1']);
});

test('formatMemoriesForPrompt returns prompt blocks and enforces token budget trimming', () => {
  const memories = [
    createMemory({
      id: 'm1',
      created_at: 1_700_000_000_000,
      importance: 0.95,
      summary: 'A'.repeat(200),
      content: 'B'.repeat(500),
      tags: ['incident', 'urgent'],
    }),
    createMemory({
      id: 'm2',
      created_at: 1_700_000_100_000,
      importance: 0.7,
      summary: 'second',
      content: 'short context',
      tags: ['ops'],
    }),
  ];

  const result = formatMemoriesForPrompt(memories, {
    tokenBudget: 70,
    k: 2,
  });

  assert.ok(result.blocks.length >= 1);
  assert.ok(result.blocks.length <= 2);
  assert.ok(result.usedTokens <= 70);
  assert.ok(result.text.includes('[m1,'));
  if (result.blocks.length === 1) {
    assert.equal(result.truncated, true);
  }
});

test('isMemoryRetrievalEnabled supports global toggle and agent canary list', () => {
  assert.equal(isMemoryRetrievalEnabled('agent-a', { TORCH_MEMORY_RETRIEVAL_ENABLED: 'true' }), true);
  assert.equal(isMemoryRetrievalEnabled('agent-a', { TORCH_MEMORY_RETRIEVAL_ENABLED: 'false' }), false);
  assert.equal(
    isMemoryRetrievalEnabled('agent-a', { TORCH_MEMORY_RETRIEVAL_ENABLED: 'agent-a,agent-b' }),
    true,
  );
  assert.equal(
    isMemoryRetrievalEnabled('agent-c', { TORCH_MEMORY_RETRIEVAL_ENABLED: 'agent-a,agent-b' }),
    false,
  );
  assert.equal(
    isMemoryRetrievalEnabled('agent-a', {
      TORCH_MEMORY_ENABLED: 'false',
      TORCH_MEMORY_RETRIEVAL_ENABLED: 'true',
    }),
    false,
  );
});

test('renderPromptWithMemoryContext injects bounded memory block before base prompt', async () => {
  const memories = [
    createMemory({
      id: 'm-ctx',
      summary: 'Known issue in deploy pipeline',
      content: 'Retry build after rotating temporary token',
      created_at: 1_700_000_000_000,
      importance: 0.91,
      tags: ['deploy', 'incident'],
    }),
  ];

  const calls = [];
  const usageUpdates = [];
  const memoryService = {
    async getRelevantMemories(params) {
      calls.push(params);
      return memories;
    },
    async updateMemoryUsage(id, lastSeen) {
      usageUpdates.push({ id, lastSeen });
    },
  };

  const output = await renderPromptWithMemoryContext({
    basePrompt: 'Base final prompt body',
    userRequest: 'Please debug deployment failure',
    agentContext: { branch: 'main', tool: 'torch' },
    agent_id: 'agent-a',
    memoryService,
    retrievalK: 1,
    tokenBudget: 60,
    env: { TORCH_MEMORY_RETRIEVAL_ENABLED: 'agent-a,agent-b' },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].agent_id, 'agent-a');
  assert.equal(calls[0].k, 1);
  assert.match(calls[0].query, /Please debug deployment failure/);
  assert.match(calls[0].query, /"branch":"main"/);

  const headerIndex = output.indexOf('[CONTEXT — Relevant memories]');
  const baseIndex = output.indexOf('Base final prompt body');
  assert.ok(headerIndex >= 0);
  assert.ok(baseIndex > headerIndex);
  assert.ok(output.includes('[m-ctx,'));

  assert.equal(usageUpdates.length, 1);
  assert.equal(usageUpdates[0].id, 'm-ctx');
  assert.equal(typeof usageUpdates[0].lastSeen, 'number');
});
