import test from 'node:test';
import assert from 'node:assert/strict';

import { ingestMemoryWindow } from '../src/services/memory/ingestor.js';

test('ingestMemoryWindow gathers sources, redacts pii, chunks, embeds, links, and emits telemetry', async () => {
  const inserted = [];
  const linked = [];
  const telemetry = [];
  const upserted = [];

  const repository = {
    async insertMemory(memory) {
      inserted.push(memory);
      return memory;
    },
    async linkEmbedding(memoryId, embedding) {
      linked.push({ memoryId, embedding });
    },
  };

  const runtimeCache = {
    getRecentRuntimeEvents() {
      return [
        { agent_id: 'agent-1', content: 'runtime event user@email.com', timestamp: 1100, tags: ['runtime'], metadata: {} },
      ];
    },
  };

  const logSource = {
    async getEvents() {
      return [
        { agent_id: 'agent-1', content: 'call me at 555-555-1212', timestamp: 1200, tags: ['log'], metadata: {} },
      ];
    },
  };

  const records = await ingestMemoryWindow(
    {
      events: [
        { agent_id: 'agent-1', content: 'hello', timestamp: 1000, tags: ['direct'], metadata: { session_id: 's1' } },
      ],
      runtimeCache,
      logSource,
      windowStart: 900,
      windowEnd: 2000,
    },
    {
      repository,
      maxChunkChars: 40,
      embedText: (text) => [text.length],
      emitTelemetry: (event, payload) => telemetry.push({ event, payload }),
      embedderAdapter: {
        async embedText(text) {
          return [text.length];
        },
        async upsertVector(entry) {
          upserted.push(entry);
        },
        async queryVector() {
          return [];
        },
        async deleteVector() {
          return false;
        },
      },
      now: 2000,
    }
  );

  assert.equal(records.length, 2);
  assert.equal(inserted.length, 2);
  assert.equal(linked.length, 2);
  assert.equal(telemetry.length, 2);
  assert.equal(upserted.length, 2);
  assert.ok(inserted.some((item) => item.content.includes('[redacted:email]')));
  assert.ok(inserted.some((item) => item.content.includes('[redacted:phone]')));
  assert.ok(telemetry.every((entry) => entry.event === 'memory:ingested'));
  assert.ok(linked.every((entry) => typeof entry.embedding.metadata?.context_excerpt === 'string'));
  assert.ok(linked.every((entry) => entry.embedding.metadata.context_excerpt.length > 0));
});

test('ingestMemoryWindow dedupes overlapping windows by hashed content + agent + timestamp bucket', async () => {
  const inserted = [];

  const repository = {
    async insertMemory(memory) {
      inserted.push(memory);
      return memory;
    },
  };

  const input = {
    events: [
      { agent_id: 'agent-2', content: 'stable content', timestamp: 10_000, tags: ['a'], metadata: {} },
      { agent_id: 'agent-2', content: 'stable content two', timestamp: 10_200, tags: ['b'], metadata: {} },
    ],
    windowStart: 10_000,
    windowEnd: 10_500,
  };

  const first = await ingestMemoryWindow(input, { repository, now: 10_500 });
  const second = await ingestMemoryWindow(input, { repository, now: 10_500 });

  assert.equal(first.length, 1);
  assert.equal(second.length, 0);
  assert.equal(inserted.length, 1);
});
