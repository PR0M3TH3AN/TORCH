import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { triggerPruneDryRun } from '../src/services/memory/index.js';

function createMemory(overrides = {}) {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    agent_id: overrides.agent_id ?? 'agent-1',
    type: overrides.type ?? 'event',
    pinned: overrides.pinned ?? false,
    last_seen: overrides.last_seen ?? Date.now(),
    merged_into: overrides.merged_into ?? null,
    // Add other fields to match schema if necessary, though selectPrunableMemories mainly checks last_seen and pinned
  };
}

test('triggerPruneDryRun uses repository listPruneCandidates if available', async () => {
  const candidates = [createMemory({ id: 'c1' }), createMemory({ id: 'c2' })];
  const repository = {
    listPruneCandidates: async () => candidates,
    listMemories: async () => [],
  };

  const result = await triggerPruneDryRun({ repository });

  assert.equal(result.dryRun, true);
  assert.equal(result.candidateCount, 2);
  assert.deepEqual(result.candidates.map(c => c.id), ['c1', 'c2']);
});

test('triggerPruneDryRun falls back to in-memory filtering if listPruneCandidates returns empty', async () => {
  const now = Date.now();
  const retentionMs = 1000;
  const oldMemory = createMemory({ id: 'old', last_seen: now - 2000 });
  const newMemory = createMemory({ id: 'new', last_seen: now - 500 });

  const repository = {
    listPruneCandidates: async () => [],
    listMemories: async () => [oldMemory, newMemory],
  };

  const result = await triggerPruneDryRun({ repository, retentionMs, now });

  assert.equal(result.candidateCount, 1);
  assert.equal(result.candidates[0].id, 'old');
});

test('triggerPruneDryRun handles empty candidates correctly', async () => {
  const repository = {
    listPruneCandidates: async () => [],
    listMemories: async () => [],
  };

  const result = await triggerPruneDryRun({ repository });

  assert.equal(result.candidateCount, 0);
  assert.deepEqual(result.candidates, []);
});

test('triggerPruneDryRun output structure validation', async () => {
  const memory = createMemory({ id: 'test-mem', agent_id: 'agent-x', type: 'thought', pinned: false, last_seen: 100, merged_into: 'parent-mem' });
  const repository = {
    listPruneCandidates: async () => [memory],
  };

  const result = await triggerPruneDryRun({ repository });

  assert.equal(result.dryRun, true);
  assert.ok(result.retentionMs > 0);
  assert.equal(result.candidateCount, 1);

  const candidate = result.candidates[0];
  assert.equal(candidate.id, 'test-mem');
  assert.equal(candidate.agent_id, 'agent-x');
  assert.equal(candidate.type, 'thought');
  assert.equal(candidate.pinned, false);
  assert.equal(candidate.last_seen, 100);
  assert.equal(candidate.merged_into, 'parent-mem');
});
