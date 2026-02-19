import test from 'node:test';
import assert from 'node:assert/strict';
import { getRelevantMemories, pinMemory, unpinMemory } from '../src/services/memory/index.js';

test('pinMemory pins the memory and clears the cache', async () => {
  const records = [
    { id: 'm1', agent_id: 'agent-a', type: 'event', tags: ['ops'], pinned: false, last_seen: 10, merged_into: null },
  ];

  let listMemoriesCallCount = 0;
  const repository = {
    async listMemories() {
      listMemoriesCallCount++;
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
    async updateMemoryUsage() { return null; }
  };

  // 1. Populate cache
  await getRelevantMemories({ agent_id: 'agent-a', repository });
  assert.equal(listMemoriesCallCount, 1, 'Repository should be queried initially');

  // 2. Verify cache hit
  await getRelevantMemories({ agent_id: 'agent-a', repository });
  assert.equal(listMemoriesCallCount, 1, 'Repository should NOT be queried on cache hit');

  // 3. Pin memory
  const pinned = await pinMemory('m1', { repository });
  assert.ok(pinned);
  assert.equal(pinned.pinned, true);
  assert.equal(records[0].pinned, true);

  // 4. Verify cache miss (cleared)
  await getRelevantMemories({ agent_id: 'agent-a', repository });
  assert.equal(listMemoriesCallCount, 2, 'Repository should be queried again after cache clear');
});

test('pinMemory returns null for non-existent ID but still clears cache', async () => {
  const records = [];
  let listMemoriesCallCount = 0;
  const repository = {
    async listMemories() {
      listMemoriesCallCount++;
      return records;
    },
    async setPinned(_id, _pinned) {
      return null;
    },
    async updateMemoryUsage() { return null; }
  };

  // 1. Populate cache (use different agent_id to avoid cache collision with previous test)
  await getRelevantMemories({ agent_id: 'agent-b', repository });
  assert.equal(listMemoriesCallCount, 1);

  // 2. Pin non-existent memory
  const result = await pinMemory('non-existent', { repository });
  assert.equal(result, null);

  // 3. Verify cache cleared
  await getRelevantMemories({ agent_id: 'agent-b', repository });
  assert.equal(listMemoriesCallCount, 2, 'Cache should be cleared even if ID not found');
});

test('unpinMemory unpins the memory and clears the cache', async () => {
  const records = [
    { id: 'm1', agent_id: 'agent-c', type: 'event', tags: ['ops'], pinned: true, last_seen: 10, merged_into: null },
  ];

  let listMemoriesCallCount = 0;
  const repository = {
    async listMemories() {
      listMemoriesCallCount++;
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
    async updateMemoryUsage() { return null; }
  };

  // 1. Populate cache
  await getRelevantMemories({ agent_id: 'agent-c', repository });
  assert.equal(listMemoriesCallCount, 1, 'Repository should be queried initially');

  // 2. Verify cache hit
  await getRelevantMemories({ agent_id: 'agent-c', repository });
  assert.equal(listMemoriesCallCount, 1, 'Repository should NOT be queried on cache hit');

  // 3. Unpin memory
  const updated = await unpinMemory('m1', { repository });
  assert.ok(updated);
  assert.equal(updated.pinned, false);
  assert.equal(records[0].pinned, false);

  // 4. Verify cache miss (cleared)
  await getRelevantMemories({ agent_id: 'agent-c', repository });
  assert.equal(listMemoriesCallCount, 2, 'Repository should be queried again after cache clear');
});

test('unpinMemory returns null for non-existent ID but still clears cache', async () => {
  const records = [];
  let listMemoriesCallCount = 0;
  const repository = {
    async listMemories() {
      listMemoriesCallCount++;
      return records;
    },
    async setPinned(_id, _pinned) {
      return null;
    },
    async updateMemoryUsage() { return null; }
  };

  // 1. Populate cache (use different agent_id to avoid cache collision with previous test)
  await getRelevantMemories({ agent_id: 'agent-d', repository });
  assert.equal(listMemoriesCallCount, 1);

  // 2. Unpin non-existent memory
  const result = await unpinMemory('non-existent', { repository });
  assert.equal(result, null);

  // 3. Verify cache cleared
  await getRelevantMemories({ agent_id: 'agent-d', repository });
  assert.equal(listMemoriesCallCount, 2, 'Cache should be cleared even if ID not found');
});
