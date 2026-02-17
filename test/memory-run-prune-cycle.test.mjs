import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const originalCwd = process.cwd();
let tmpDir;

function createMemory(overrides = {}) {
  return {
    schema_version: 1,
    id: overrides.id ?? crypto.randomUUID(),
    agent_id: overrides.agent_id ?? 'agent-1',
    session_id: overrides.session_id ?? 's1',
    type: overrides.type ?? 'event',
    content: overrides.content ?? 'test content',
    summary: overrides.summary ?? 'test summary',
    tags: overrides.tags ?? [],
    importance: overrides.importance ?? 0.5,
    embedding_id: overrides.embedding_id ?? null,
    created_at: overrides.created_at ?? Date.now(),
    last_seen: overrides.last_seen ?? Date.now(),
    source: overrides.source ?? 'ingest',
    ttl_days: overrides.ttl_days ?? null,
    merged_into: overrides.merged_into ?? null,
    pinned: overrides.pinned ?? false,
  };
}

// Global state variables for the module under test
let runPruneCycle;
let listMemories;

// Setup temp environment and load module
test.before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-prune-test-'));

  // Create .scheduler-memory directory
  const memDir = path.join(tmpDir, '.scheduler-memory');
  await fs.mkdir(memDir, { recursive: true });

  // Create initial state
  const now = 200_000;
  // retentionMs will be 100,000
  // cutoff = 100,000

  const memories = [
    createMemory({ id: 'recent', last_seen: 150_000 }), // > 100,000 -> Keep
    createMemory({ id: 'pinned', last_seen: 50_000, pinned: true }), // < 100,000 but pinned -> Keep
    createMemory({ id: 'stale', last_seen: 50_000 }), // < 100,000 -> Delete
    createMemory({ id: 'stale-dry', last_seen: 50_000 }), // < 100,000 -> Delete candidate
    createMemory({ id: 'stale-off', last_seen: 50_000 }), // < 100,000 -> Delete candidate
  ];

  // memory-store.json expects an array of entries [[id, memory], ...]
  const entries = memories.map(m => [m.id, m]);
  await fs.writeFile(path.join(memDir, 'memory-store.json'), JSON.stringify(entries), 'utf8');

  // Change CWD
  process.chdir(tmpDir);

  // Import module (it will load the file we just wrote)
  const mod = await import('../src/services/memory/index.js');
  runPruneCycle = mod.runPruneCycle;
  listMemories = mod.listMemories;
});

test.after(async () => {
  if (originalCwd) process.chdir(originalCwd);
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
});

test('runPruneCycle respects off mode', async () => {
  const now = 200_000;
  const retentionMs = 100_000;

  const result = await runPruneCycle({
    now,
    retentionMs,
    pruneMode: 'off',
  });

  assert.equal(result.mode, 'off');

  // Verify nothing deleted
  const memories = await listMemories();
  assert.equal(memories.length, 5);
});

test('runPruneCycle respects dry-run mode', async () => {
  const now = 200_000;
  const retentionMs = 100_000;

  const result = await runPruneCycle({
    now,
    retentionMs,
    pruneMode: 'dry-run',
  });

  assert.equal(result.mode, 'dry-run');
  // Expect 3 candidates: stale, stale-dry, stale-off
  assert.equal(result.candidates.length, 3);

  // Verify nothing deleted
  const memories = await listMemories();
  assert.equal(memories.length, 5);
});

test('runPruneCycle removes stale unpinned memories in active mode', async () => {
  const now = 200_000;
  const retentionMs = 100_000;

  const telemetry = [];
  const metrics = [];

  const result = await runPruneCycle({
    now,
    retentionMs,
    pruneMode: 'active',
    emitTelemetry: (event, payload) => telemetry.push({ event, payload }),
    emitMetric: (metric, payload) => metrics.push({ metric, payload }),
  });

  assert.equal(result.pruned.length, 3); // stale, stale-dry, stale-off

  // Verify deletion
  const memories = await listMemories();
  assert.equal(memories.length, 2);
  const ids = memories.map(m => m.id);
  assert.ok(ids.includes('recent'));
  assert.ok(ids.includes('pinned'));
  assert.ok(!ids.includes('stale'));

  // Verify telemetry
  const prunedEvent = telemetry.find(t => t.event === 'memory:pruned');
  assert.ok(prunedEvent);
  assert.equal(prunedEvent.payload.pruned_count, 3);

  // Verify metrics
  const prunedMetric = metrics.find(m => m.metric === 'memory_pruned_total');
  assert.ok(prunedMetric);
  assert.equal(prunedMetric.payload.count, 3);
});

test('runPruneCycle starts scheduler if requested', async () => {
  const result = await runPruneCycle({
    scheduleEveryMs: 1000,
    pruneMode: 'active',
  });

  assert.ok(result.scheduler);
  assert.equal(typeof result.scheduler.stop, 'function');
  result.scheduler.stop();
});
