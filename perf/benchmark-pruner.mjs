import { createLifecyclePlan } from '../src/services/memory/pruner.js';


const COUNT = 30000;
const DUPLICATE_WINDOW_MS = 1000 * 60 * 60; // 1 hour

function createMemory(i) {
  return {
    id: `mem-${i}`,
    agent_id: 'agent-1',
    session_id: 's1',
    type: 'event',
    content: `memory content ${i}`,
    summary: `memory summary ${i}`,
    tags: ['tag-a', 'tag-b'],
    importance: 0.5,
    embedding_id: null,
    created_at: Date.now() - Math.floor(Math.random() * 10 * 24 * 60 * 60 * 1000), // Random time in last 10 days
    last_seen: Date.now(),
    source: 'ingest',
    ttl_days: null,
    merged_into: null,
    pinned: false,
  };
}

const memories = Array.from({ length: COUNT }, (_, i) => createMemory(i));

// Mock embedding function
const getEmbedding = (memory) => {
    // Generate a pseudo-random embedding based on ID to be deterministic but varied
    const val = parseInt(memory.id.split('-')[1]) % 100;
    return [val, 100 - val];
};

console.time('createLifecyclePlan');
await createLifecyclePlan(memories, {
  now: Date.now(),
  retentionMs: 30 * 24 * 60 * 60 * 1000,
  duplicateWindowMs: DUPLICATE_WINDOW_MS,
  getEmbedding,
  generateSummary: async () => JSON.stringify({ summary: 'merged', importance: 0.5 }),
});
console.timeEnd('createLifecyclePlan');
