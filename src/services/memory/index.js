import { createMemoryCache } from './cache.js';
import { embedText } from './embedder.js';
import { normalizeEvents } from './ingestor.js';
import { selectPrunableMemories } from './pruner.js';
import { filterAndRankMemories } from './retriever.js';
import { startScheduler } from './scheduler.js';
import { createMemoryRecord, validateMemoryItem } from './schema.js';
import { summarizeEvents } from './summarizer.js';

const memoryStore = new Map();
const cache = createMemoryCache();

/**
 * Ingests agent events and stores them as memory records.
 *
 * @param {import('./schema.js').MemoryEvent[]} events - Ordered list of raw events to persist.
 * @param {{ maxSummaryLength?: number, embedText?: (value: string) => Promise<number[]> | number[] }} [options] - Optional ingest tuning.
 * @returns {Promise<import('./schema.js').MemoryRecord[]>} Stored memory records.
 */
export async function ingestEvents(events, options = {}) {
  const normalizedEvents = normalizeEvents(events);
  const records = [];

  for (const event of normalizedEvents) {
    const summary = summarizeEvents([event], options);
    const embedding = await embedText(`${summary}\n${event.content}`, options);
    const record = createMemoryRecord({
      agent_id: event.agent_id,
      session_id: typeof event.metadata?.session_id === 'string' ? event.metadata.session_id : 'unknown',
      type: typeof event.metadata?.type === 'string' ? event.metadata.type : 'event',
      content: event.content,
      summary,
      tags: event.tags,
      importance: Number.isFinite(event.metadata?.importance) ? event.metadata.importance : 0.5,
      embedding_id: Array.isArray(embedding) && embedding.length > 0 ? crypto.randomUUID() : null,
      created_at: event.timestamp,
      last_seen: event.timestamp,
      source: typeof event.metadata?.source === 'string' ? event.metadata.source : 'ingest',
      ttl_days: Number.isFinite(event.metadata?.ttl_days) ? event.metadata.ttl_days : null,
      merged_into: typeof event.metadata?.merged_into === 'string' ? event.metadata.merged_into : null,
      pinned: Boolean(event.metadata?.pinned),
    });

    const validation = validateMemoryItem(record);
    if (!validation.valid) {
      console.error('memory_validation_error', {
        stage: 'ingest',
        reason: 'record_failed_schema_validation',
        fields: validation.errors,
        item: record,
      });
      throw new TypeError('Memory ingest rejected: invalid durable record format');
    }

    memoryStore.set(record.id, record);
    records.push(record);
  }

  cache.clear();
  return records;
}

/**
 * Retrieves top-k memories for an agent query.
 *
 * @param {{ agent_id: string, query?: string, tags?: string[], timeframe?: { from?: number, to?: number }, k?: number }} params - Retrieval filter and ranking inputs.
 * @returns {Promise<import('./schema.js').MemoryRecord[]>} Sorted list of relevant memories.
 */
export async function getRelevantMemories(params) {
  const cacheKey = JSON.stringify(params);
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const ranked = filterAndRankMemories([...memoryStore.values()], params);
  cache.set(cacheKey, ranked);
  return ranked;
}

/**
 * Runs a memory pruning pass and removes unpinned stale records.
 *
 * @param {{ retentionMs?: number, now?: number, scheduleEveryMs?: number }} [options] - Prune configuration; if scheduleEveryMs is set, returns a scheduler handle.
 * @returns {Promise<{ pruned: import('./schema.js').MemoryRecord[], scheduler?: { stop: () => void } }>} Pruned records and optional scheduler handle.
 */
export async function runPruneCycle(options = {}) {
  const retentionMs = options.retentionMs ?? (1000 * 60 * 60 * 24 * 30);
  const prunable = selectPrunableMemories([...memoryStore.values()], {
    retentionMs,
    now: options.now,
  });

  for (const memory of prunable) {
    memoryStore.delete(memory.id);
  }

  cache.clear();

  const result = { pruned: prunable };
  if (Number.isFinite(options.scheduleEveryMs) && options.scheduleEveryMs > 0) {
    result.scheduler = startScheduler(() => runPruneCycle({ retentionMs }), {
      intervalMs: options.scheduleEveryMs,
    });
  }

  return result;
}

/**
 * Pins a memory to prevent pruning and boost retrieval ranking.
 *
 * @param {string} id - Memory record identifier.
 * @returns {import('./schema.js').MemoryRecord | null} Updated memory record or null when not found.
 */
export function pinMemory(id) {
  const memory = memoryStore.get(id);
  if (!memory) return null;

  const updated = { ...memory, pinned: true, last_seen: Date.now() };
  memoryStore.set(id, updated);
  cache.clear();
  return updated;
}

/**
 * Removes a pin from a memory so it can be pruned normally.
 *
 * @param {string} id - Memory record identifier.
 * @returns {import('./schema.js').MemoryRecord | null} Updated memory record or null when not found.
 */
export function unpinMemory(id) {
  const memory = memoryStore.get(id);
  if (!memory) return null;

  const updated = { ...memory, pinned: false, last_seen: Date.now() };
  memoryStore.set(id, updated);
  cache.clear();
  return updated;
}
