import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ingestEvents, getRelevantMemories } from '../src/services/memory/index.js';

// Mock repository helpers
function createMockRepository() {
  const store = new Map();
  const fingerprints = new Set();
  const embeddings = new Map();
  let failNextInsert = false;

  return {
    _store: store,
    _fingerprints: fingerprints,
    _embeddings: embeddings,
    setFailNextInsert(fail) { failNextInsert = fail; },

    async insertMemory(memory) {
      if (failNextInsert) {
        throw new Error('Simulated insert failure');
      }
      store.set(memory.id, memory);
      return memory;
    },
    async hasIngestionFingerprint(key) {
      return fingerprints.has(key);
    },
    async storeIngestionFingerprint(key, payload) {
      fingerprints.add(key);
    },
    async linkEmbedding(id, embedding) {
      embeddings.set(id, embedding);
    },
    async listMemories() {
      return [...store.values()];
    },
    async updateMemoryUsage(id) {
      // no-op for this test
    },
    async setPinned(id, pinned) {
      const memory = store.get(id);
      if (memory) {
        memory.pinned = pinned;
        store.set(id, memory);
      }
      return memory;
    }
  };
}

// Mock telemetry collector
function createTelemetryCollector() {
  const events = [];
  return {
    events,
    emit: (event, payload) => events.push({ event, payload }),
    find: (eventName) => events.find(e => e.event === eventName),
    filter: (eventName) => events.filter(e => e.event === eventName),
    clear: () => { events.length = 0; }
  };
}

// Mock metrics collector
function createMetricsCollector() {
  const metrics = [];
  return {
    metrics,
    emit: (metric, payload) => metrics.push({ metric, payload }),
    find: (metricName) => metrics.find(m => m.metric === metricName),
    clear: () => { metrics.length = 0; }
  };
}

test('ingestEvents: Happy path ingestion', async () => {
  const repository = createMockRepository();
  const telemetry = createTelemetryCollector();
  const metrics = createMetricsCollector();

  const events = [
    {
      agent_id: 'test-agent',
      content: 'This is a test event for ingestion.',
      timestamp: Date.now(),
      tags: ['test'],
      metadata: { session_id: 'session-1' }
    }
  ];

  const options = {
    repository,
    emitTelemetry: telemetry.emit,
    metrics: { emit: metrics.emit },
    embedText: async () => [0.1, 0.2, 0.3], // Mock embedding
    agent_id: 'test-agent',
    env: { TORCH_MEMORY_INGEST_ENABLED: 'true' }
  };

  const records = await ingestEvents(events, options);

  // Assertions
  assert.ok(Array.isArray(records), 'Should return an array of records');
  assert.equal(records.length, 1, 'Should return 1 record');
  assert.ok(records[0].id, 'Record should have an ID');
  assert.equal(records[0].content, events[0].content, 'Content should match');

  // Verify repository
  assert.ok(repository._store.has(records[0].id), 'Record should be stored in repository');

  // Verify telemetry
  const ingestedEvent = telemetry.find('memory:ingested');
  assert.ok(ingestedEvent, 'Should emit memory:ingested telemetry');
  assert.equal(ingestedEvent.payload.agent_id, 'test-agent');

  // Verify metrics
  const ingestedMetric = metrics.find('memory_ingested_total');
  assert.ok(ingestedMetric, 'Should emit memory_ingested_total metric');
  assert.equal(ingestedMetric.payload.count, 1);
});

test('ingestEvents: Skips ingestion when disabled via feature flag', async () => {
  const repository = createMockRepository();
  const telemetry = createTelemetryCollector();

  const events = [
    {
      agent_id: 'test-agent',
      content: 'Should be skipped',
      timestamp: Date.now()
    }
  ];

  const options = {
    repository,
    emitTelemetry: telemetry.emit,
    agent_id: 'test-agent',
    env: { TORCH_MEMORY_INGEST_ENABLED: 'false' }
  };

  const records = await ingestEvents(events, options);

  assert.deepEqual(records, [], 'Should return empty array');
  assert.equal(repository._store.size, 0, 'Should not store anything');

  const skippedEvent = telemetry.find('memory:ingest_skipped');
  assert.ok(skippedEvent, 'Should emit memory:ingest_skipped');
  assert.equal(skippedEvent.payload.reason, 'flag_disabled');
});

test('ingestEvents: Clears cache after ingestion', async () => {
  const repository = createMockRepository();
  const telemetry = createTelemetryCollector();
  const agentId = 'cache-test-agent';

  // Pre-populate repository
  const existingMemory = {
    id: 'mem-1',
    agent_id: agentId,
    content: 'Existing memory',
    tags: ['test'],
    last_seen: Date.now(),
    type: 'event'
  };
  await repository.insertMemory(existingMemory);

  // 1. Populate cache
  await getRelevantMemories({ agent_id: agentId, repository, emitTelemetry: telemetry.emit });
  let retrieved = telemetry.filter('memory:retrieved');
  assert.equal(retrieved[0].payload.cache_hit, false, 'First retrieval should be a cache miss');
  telemetry.clear();

  // 2. Verify cache hit
  await getRelevantMemories({ agent_id: agentId, repository, emitTelemetry: telemetry.emit });
  retrieved = telemetry.filter('memory:retrieved');
  assert.equal(retrieved[0].payload.cache_hit, true, 'Second retrieval should be a cache hit');
  telemetry.clear();

  // 3. Ingest new event (should trigger cache clear)
  const events = [
    {
      agent_id: agentId,
      content: 'New memory triggers cache clear',
      timestamp: Date.now()
    }
  ];

  await ingestEvents(events, {
    repository,
    emitTelemetry: telemetry.emit,
    embedText: async () => [0.1],
    agent_id: agentId,
    env: { TORCH_MEMORY_INGEST_ENABLED: 'true' }
  });

  // 4. Verify cache miss
  telemetry.clear(); // Clear ingestion telemetry
  await getRelevantMemories({ agent_id: agentId, repository, emitTelemetry: telemetry.emit });
  retrieved = telemetry.filter('memory:retrieved');
  assert.equal(retrieved[0].payload.cache_hit, false, 'Retrieval after ingestion should be a cache miss');
});

test('ingestEvents: Deduplicates identical events within window', async () => {
  const repository = createMockRepository();
  const agentId = 'dedupe-agent';
  const event = {
    agent_id: agentId,
    content: 'Duplicate content',
    timestamp: 1000,
    tags: ['test']
  };

  const options = {
    repository,
    embedText: async () => [0.1],
    agent_id: agentId,
    env: { TORCH_MEMORY_INGEST_ENABLED: 'true' },
    windowBucketMs: 60000, // Fixed window
    now: 2000 // Fixed time
  };

  // First ingestion
  const records1 = await ingestEvents([event], options);
  assert.equal(records1.length, 1, 'First ingestion should succeed');

  // Second ingestion (same event, same window/bucket)
  const records2 = await ingestEvents([event], options);
  assert.equal(records2.length, 0, 'Second ingestion should be deduplicated (skipped)');
});

test('ingestEvents: Handles repository errors', async () => {
  const repository = createMockRepository();
  repository.setFailNextInsert(true);

  const events = [
    {
      agent_id: 'error-agent',
      content: 'Will fail',
      timestamp: Date.now()
    }
  ];

  const options = {
    repository,
    embedText: async () => [0.1],
    agent_id: 'error-agent',
    env: { TORCH_MEMORY_INGEST_ENABLED: 'true' }
  };

  await assert.rejects(
    async () => ingestEvents(events, options),
    /Simulated insert failure/,
    'Should propagate repository errors'
  );
});
