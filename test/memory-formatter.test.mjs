import test from 'node:test';
import assert from 'node:assert/strict';

import {
  estimateTokenCount,
  formatMemoryBlock,
  formatMemoriesForPrompt,
  renderPromptWithMemoryContext,
  isMemoryRetrievalEnabled
} from '../src/services/memory/formatter.js';

function createMemory(overrides = {}) {
  return {
    schema_version: 1,
    id: overrides.id ?? 'm1',
    agent_id: overrides.agent_id ?? 'agent-1',
    session_id: overrides.session_id ?? 's1',
    type: overrides.type ?? 'event',
    content: overrides.content ?? 'default content',
    summary: overrides.summary ?? 'default summary',
    tags: overrides.tags ?? [],
    importance: overrides.importance ?? 0.5,
    embedding_id: overrides.embedding_id ?? null,
    created_at: overrides.created_at ?? 1700000000000,
    last_seen: overrides.last_seen ?? 1700000000000,
    source: overrides.source ?? 'ingest',
    ttl_days: overrides.ttl_days ?? null,
    merged_into: overrides.merged_into ?? null,
    pinned: overrides.pinned ?? false,
  };
}

test('estimateTokenCount returns heuristic count', () => {
  assert.equal(estimateTokenCount(''), 0);
  assert.equal(estimateTokenCount(null), 0);
  assert.equal(estimateTokenCount(undefined), 0);
  assert.equal(estimateTokenCount('abcd'), 1);
  assert.equal(estimateTokenCount('abcde'), 2);
  assert.equal(estimateTokenCount('A'.repeat(400)), 100);
});

test('formatMemoryBlock converts memory record to display block', () => {
  const memory = createMemory({
    id: 'm1',
    summary: 'The quick brown fox',
    content: 'Jumps over the lazy dog',
    importance: 0.856,
    created_at: 1700000000000,
    tags: ['fox', 'dog']
  });

  const block = formatMemoryBlock(memory);

  assert.equal(block.id, 'm1');
  assert.equal(block.summary, 'The quick brown fox');
  assert.equal(block.short_context, 'Jumps over the lazy dog');
  assert.equal(block.importance, '0.86');
  assert.equal(block.timestamp, '2023-11-14T22:13:20.000Z');
  assert.equal(block.tags, 'fox,dog');
});

test('formatMemoryBlock handles missing optional fields and default clamping', () => {
  const memory = {
    id: 'm-minimal',
    created_at: 1700000000000,
  };

  const block = formatMemoryBlock(memory);

  assert.equal(block.id, 'm-minimal');
  assert.equal(block.summary, '');
  assert.equal(block.short_context, '');
  assert.equal(block.importance, '0.00');
  assert.equal(block.tags, '');
});

test('formatMemoryBlock respects custom clamping options', () => {
  const memory = createMemory({
    summary: '1234567890',
    content: 'abcdefghij',
  });

  const block = formatMemoryBlock(memory, {
    maxSummaryChars: 5,
    maxContextChars: 3
  });

  // clampString adds ellipsis if length > maxChars.
  // if length > maxChars, it takes maxChars - 1 and adds …
  assert.equal(block.summary, '1234…');
  assert.equal(block.short_context, 'ab…');
});

test('formatMemoryBlock handles edge cases for clamping', () => {
  const memory = createMemory({
    summary: 'exact',
    content: 'over',
  });

  // Exactly maxChars
  const blockExact = formatMemoryBlock(memory, { maxSummaryChars: 5, maxContextChars: 3 });
  assert.equal(blockExact.summary, 'exact');
  assert.equal(blockExact.short_context, 'ov…');

  // Negative or zero maxChars
  const blockZero = formatMemoryBlock(memory, { maxSummaryChars: 0, maxContextChars: -1 });
  assert.equal(blockZero.summary, '');
  assert.equal(blockZero.short_context, '');
});

test('formatMemoriesForPrompt enforces token budget and k limit', () => {
  const memories = [
    createMemory({ id: 'm1', summary: 'one', importance: 0.9 }),
    createMemory({ id: 'm2', summary: 'two', importance: 0.8 }),
    createMemory({ id: 'm3', summary: 'three', importance: 0.7 }),
  ];

  // Limit k to 2
  const resultK = formatMemoriesForPrompt(memories, { k: 2 });
  assert.equal(resultK.blocks.length, 2);
  assert.equal(resultK.blocks[0].id, 'm1');
  assert.equal(resultK.blocks[1].id, 'm2');
  assert.equal(resultK.truncated, false);

  // Limit token budget
  // A single block line looks like: [m1, 2023-11-14T22:13:20.000Z, 0.90, one, default content, ]
  // Tokens (chars/4): ~70 chars -> 18 tokens
  const resultBudget = formatMemoriesForPrompt(memories, { tokenBudget: 25 });
  assert.equal(resultBudget.blocks.length, 1);
  assert.ok(resultBudget.usedTokens <= 25);
  assert.equal(resultBudget.truncated, true);
});

test('formatMemoriesForPrompt handles aggressive budget fitting', () => {
  const memory = createMemory({
    id: 'm1',
    summary: 'very long summary that will need clamping'.repeat(10),
    content: 'very long content that will need clamping'.repeat(10),
  });

  // Very small budget should force fitting
  const result = formatMemoriesForPrompt([memory], { tokenBudget: 15 });
  assert.equal(result.blocks.length, 1);
  assert.ok(result.usedTokens <= 15);
  assert.ok(result.blocks[0].summary.length <= 8 || result.blocks[0].summary.includes('…'));
});

test('renderPromptWithMemoryContext injects context when enabled', async () => {
  const memoryService = {
    async getRelevantMemories() {
      return [createMemory({ id: 'm-ctx', summary: 'relevant info' })];
    },
    async updateMemoryUsage() {}
  };

  const params = {
    basePrompt: 'Base prompt',
    userRequest: 'Hello',
    agent_id: 'agent-1',
    memoryService,
    env: { TORCH_MEMORY_RETRIEVAL_ENABLED: 'true' }
  };

  const output = await renderPromptWithMemoryContext(params);
  assert.match(output, /\[CONTEXT — Relevant memories\]/);
  assert.match(output, /relevant info/);
  assert.match(output, /Base prompt/);
});

test('renderPromptWithMemoryContext returns base prompt when disabled', async () => {
  const params = {
    basePrompt: 'Base prompt',
    userRequest: 'Hello',
    agent_id: 'agent-1',
    memoryService: {},
    env: { TORCH_MEMORY_RETRIEVAL_ENABLED: 'false' }
  };

  const output = await renderPromptWithMemoryContext(params);
  assert.equal(output, 'Base prompt');
});

test('renderPromptWithMemoryContext handles missing query or service', async () => {
  const params = {
    basePrompt: 'Base prompt',
    userRequest: '',
    agentContext: null,
    agent_id: 'agent-1',
    memoryService: null,
    env: { TORCH_MEMORY_RETRIEVAL_ENABLED: 'true' }
  };

  const output = await renderPromptWithMemoryContext(params);
  assert.equal(output, 'Base prompt');
});
