import test from 'node:test';
import assert from 'node:assert/strict';
import { getRelevantMemories } from '../src/services/memory/index.js';

function createMockMemory(id) {
  return {
    id,
    content: `content for ${id}`,
    agent_id: 'agent-1',
    created_at: Date.now(),
    last_seen: Date.now(),
  };
}

test('getRelevantMemories uses cached results when available', async (t) => {
  const cachedMemory = createMockMemory('cached-1');
  const cacheGetMock = t.mock.fn((key) => {
    if (key.includes('test-query')) return [cachedMemory];
    return null;
  });
  const cacheSetMock = t.mock.fn();

  const mockCache = {
    get: cacheGetMock,
    set: cacheSetMock,
  };

  const repository = {
    listMemories: t.mock.fn(async () => []),
    updateMemoryUsage: async () => {},
  };

  const result = await getRelevantMemories({
    agent_id: 'agent-1',
    query: 'test-query',
    cache: mockCache,
    repository,
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'cached-1');
  assert.equal(cacheGetMock.mock.callCount(), 1);
  // Should NOT call listMemories on cache hit
  assert.equal(repository.listMemories.mock.callCount(), 0);
  // Should NOT call cache.set on cache hit
  assert.equal(cacheSetMock.mock.callCount(), 0);
});

test('getRelevantMemories calls ranker and updates cache on miss', async (t) => {
  const memories = [createMockMemory('m1'), createMockMemory('m2')];
  const repository = {
    listMemories: t.mock.fn(async () => memories),
    updateMemoryUsage: t.mock.fn(async () => {}),
  };

  // Mock ranker to reverse the list
  const ranker = t.mock.fn(async (source) => [...source].reverse());

  const cacheSetMock = t.mock.fn();
  const mockCache = {
    get: () => null,
    set: cacheSetMock,
  };

  const result = await getRelevantMemories({
    agent_id: 'agent-1',
    query: 'test-query',
    repository,
    ranker,
    cache: mockCache,
  });

  assert.equal(result.length, 2);
  assert.equal(result[0].id, 'm2');
  assert.equal(result[1].id, 'm1');

  // Verify ranker called with correct source
  assert.equal(ranker.mock.callCount(), 1);
  const [sourceArg] = ranker.mock.calls[0].arguments;
  assert.deepEqual(sourceArg, memories);

  // Verify cache updated
  assert.equal(cacheSetMock.mock.callCount(), 1);
  const [keyArg, valueArg] = cacheSetMock.mock.calls[0].arguments;
  assert.ok(typeof keyArg === 'string');
  assert.deepEqual(valueArg, result); // Should cache the ranked result

  // Verify memory usage updated
  assert.equal(repository.updateMemoryUsage.mock.callCount(), 2);
});

test('getRelevantMemories passes correct parameters to ranker', async (t) => {
  const repository = {
    listMemories: async () => [],
    updateMemoryUsage: async () => {},
  };
  const ranker = t.mock.fn(async () => []);
  const mockCache = { get: () => null, set: () => {} };

  const params = {
    agent_id: 'agent-1',
    query: 'my query',
    tags: ['a', 'b'],
    k: 5,
    repository,
    ranker,
    cache: mockCache,
  };

  await getRelevantMemories(params);

  assert.equal(ranker.mock.callCount(), 1);
  const [_, queryParams] = ranker.mock.calls[0].arguments;

  assert.equal(queryParams.agent_id, 'agent-1');
  assert.equal(queryParams.query, 'my query');
  assert.deepEqual(queryParams.tags, ['a', 'b']);
  assert.equal(queryParams.k, 5);

  // Ensure injected deps are NOT in queryParams
  assert.equal(queryParams.repository, undefined);
  assert.equal(queryParams.ranker, undefined);
  assert.equal(queryParams.cache, undefined);
});

test('getRelevantMemories triggers updateMemoryUsage on repository', async (t) => {
  const m1 = createMockMemory('m1');
  const repository = {
    listMemories: async () => [m1],
    updateMemoryUsage: t.mock.fn(async () => {}),
  };
  const ranker = async (source) => source; // identity ranker
  const mockCache = { get: () => null, set: () => {} };

  await getRelevantMemories({
    agent_id: 'agent-1',
    repository,
    ranker,
    cache: mockCache,
  });

  // updateMemoryUsage helper calls repository.updateMemoryUsage for each memory
  assert.equal(repository.updateMemoryUsage.mock.callCount(), 1);
  const [idArg] = repository.updateMemoryUsage.mock.calls[0].arguments;
  assert.equal(idArg, 'm1');
});
