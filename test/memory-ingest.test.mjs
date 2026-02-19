import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ingestEvents, getRelevantMemories } from '../src/services/memory/index.js';

describe('ingestEvents', () => {
  let repository;
  let telemetryEvents = [];
  let metricsEvents = [];
  let storedMemories = [];
  let storedFingerprints = new Map();
  let linkedEmbeddings = new Map();

  const mockOptions = {
    embedText: async (_text) => Array(128).fill(0.1), // Deterministic embedding
    emitTelemetry: (event, payload) => telemetryEvents.push({ event, payload }),
    metrics: {
      emit: (metric, payload) => metricsEvents.push({ metric, payload }),
    },
    // Mock environment to ensure enabled by default
    env: {
      TORCH_MEMORY_ENABLED: 'true',
      TORCH_MEMORY_INGEST_ENABLED: 'true',
    },
    now: 1600000000000, // Fixed time
  };

  beforeEach(() => {
    telemetryEvents = [];
    metricsEvents = [];
    storedMemories = [];
    storedFingerprints = new Map();
    linkedEmbeddings = new Map();

    repository = {
      async insertMemory(memory) {
        storedMemories.push(memory);
        return memory;
      },
      async hasIngestionFingerprint(key) {
        return storedFingerprints.has(key);
      },
      async storeIngestionFingerprint(key, payload) {
        storedFingerprints.set(key, payload);
      },
      async linkEmbedding(id, embedding) {
        linkedEmbeddings.set(id, embedding);
      },
      // Minimal implementation for getRelevantMemories to work for cache check
      async listMemories() {
        return storedMemories;
      },
      async updateMemoryUsage() {},
    };
  });

  test('happy path: successfully ingests events', async () => {
    const events = [
      {
        agent_id: 'agent-1',
        content: 'User logged in',
        timestamp: mockOptions.now - 1000,
        metadata: { session_id: 'session-1', source: 'test' },
      },
      {
        agent_id: 'agent-1',
        content: 'User clicked button',
        timestamp: mockOptions.now - 500,
        metadata: { session_id: 'session-1', source: 'test' },
      },
    ];

    const result = await ingestEvents(events, { ...mockOptions, repository });

    assert.equal(result.length, 1); // Should be chunked into one memory
    assert.equal(storedMemories.length, 1);
    assert.equal(storedMemories[0].agent_id, 'agent-1');
    assert.match(storedMemories[0].content, /User logged in/);
    assert.match(storedMemories[0].content, /User clicked button/);

    // Verify telemetry
    const ingestedEvent = telemetryEvents.find((e) => e.event === 'memory:ingested');
    assert.ok(ingestedEvent, 'Should emit memory:ingested telemetry');
    assert.equal(ingestedEvent.payload.agent_id, 'agent-1');
    assert.equal(ingestedEvent.payload.chunk_events, 2);

    // Verify metrics
    const ingestedMetric = metricsEvents.find((e) => e.metric === 'memory_ingested_total');
    assert.ok(ingestedMetric, 'Should emit memory_ingested_total metric');
    assert.equal(ingestedMetric.payload.count, 1);

    // Verify embedding link
    assert.ok(linkedEmbeddings.has(storedMemories[0].id), 'Should link embedding');
  });

  test('skips ingestion when feature flag is disabled', async () => {
    const events = [{ agent_id: 'agent-1', content: 'test', timestamp: Date.now() }];
    const options = {
      ...mockOptions,
      repository,
      env: { TORCH_MEMORY_INGEST_ENABLED: 'false' },
    };

    const result = await ingestEvents(events, options);

    assert.equal(result.length, 0);
    assert.equal(storedMemories.length, 0);

    const skippedEvent = telemetryEvents.find((e) => e.event === 'memory:ingest_skipped');
    assert.ok(skippedEvent, 'Should emit memory:ingest_skipped telemetry');
    assert.equal(skippedEvent.payload.reason, 'flag_disabled');
  });

  test('clears cache after ingestion', async () => {
    const agentId = 'agent-cache-test';

    // 1. Populate cache
    await getRelevantMemories({ agent_id: agentId, repository, ...mockOptions });

    // 2. Verify cache hit (by checking telemetry from a second call)
    telemetryEvents = []; // Reset telemetry
    await getRelevantMemories({ agent_id: agentId, repository, ...mockOptions });
    const hitEvent = telemetryEvents.find(e => e.event === 'memory:retrieved');
    assert.ok(hitEvent.payload.cache_hit, 'Should hit cache before ingestion');

    // 3. Ingest event
    await ingestEvents(
      [{ agent_id: agentId, content: 'new event', timestamp: mockOptions.now }],
      { ...mockOptions, repository }
    );

    // 4. Verify cache miss
    telemetryEvents = []; // Reset telemetry
    await getRelevantMemories({ agent_id: agentId, repository, ...mockOptions });
    const missEvent = telemetryEvents.find(e => e.event === 'memory:retrieved');
    assert.equal(missEvent.payload.cache_hit, false, 'Should miss cache after ingestion (cache cleared)');
  });

  test('skips duplicate windows', async () => {
    const events = [{ agent_id: 'agent-dedupe', content: 'repeat', timestamp: mockOptions.now }];

    // First ingestion
    await ingestEvents(events, { ...mockOptions, repository });
    assert.equal(storedMemories.length, 1);

    // Second ingestion (should be duplicate)
    await ingestEvents(events, { ...mockOptions, repository });
    assert.equal(storedMemories.length, 1, 'Should not insert duplicate memory');
  });

  test('propagates repository errors', async () => {
    const errorRepository = {
      ...repository,
      async insertMemory() {
        throw new Error('Database connection failed');
      },
    };

    const events = [{ agent_id: 'agent-err', content: 'fail', timestamp: mockOptions.now }];

    await assert.rejects(
      async () => ingestEvents(events, { ...mockOptions, repository: errorRepository }),
      /Database connection failed/
    );
  });
});
