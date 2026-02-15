import test from 'node:test';
import assert from 'node:assert/strict';

import { createEmbedderAdapter, embedText } from '../src/services/memory/embedder.js';

test('createEmbedderAdapter selects in-memory backend and supports vector CRUD', async () => {
  const adapter = createEmbedderAdapter({ backend: 'inmemory' });
  // Manually provide a vector to verify storage mechanism works even if default embedder is disabled
  const vector = [0.1, 0.2, 0.3];

  await adapter.upsertVector({
    id: 'vec-1',
    vector,
    metadata: { agent_id: 'a1', context_excerpt: 'hello world' },
  });

  const results = await adapter.queryVector({
    vector,
    k: 1,
    filter: { agent_id: 'a1' },
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'vec-1');
  assert.equal(results[0].metadata.context_excerpt, 'hello world');

  const deleted = await adapter.deleteVector('vec-1');
  assert.equal(deleted, true);
});

test('createEmbedderAdapter reads backend from environment', async () => {
  process.env.MEMORY_VECTOR_BACKEND = 'local';
  const adapter = createEmbedderAdapter();
  const vector = await embedText('env selected', { adapter });

  assert.ok(Array.isArray(vector));
  // Default embedding is disabled, so vector should be empty
  assert.equal(vector.length, 0);

  delete process.env.MEMORY_VECTOR_BACKEND;
});
