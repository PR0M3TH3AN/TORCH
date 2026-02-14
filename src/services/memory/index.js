import { createMemoryCache } from './cache.js';
import { ingestMemoryWindow } from './ingestor.js';
import { listPruneCandidates, selectPrunableMemories } from './pruner.js';
import { filterAndRankMemories, updateMemoryUsage } from './retriever.js';
import { startScheduler } from './scheduler.js';

const memoryStore = new Map();
const cache = createMemoryCache();

const memoryRepository = {
  async insertMemory(memory) {
    memoryStore.set(memory.id, memory);
    return memory;
  },
  async updateMemoryUsage(id, lastSeen = Date.now()) {
    const existing = memoryStore.get(id);
    if (!existing) return null;
    const updated = { ...existing, last_seen: lastSeen };
    memoryStore.set(id, updated);
    return updated;
  },
  async listPruneCandidates({ cutoff }) {
    return [...memoryStore.values()].filter((memory) => !memory.pinned && memory.last_seen < cutoff);
  },
  async markMerged(id, mergedInto) {
    const existing = memoryStore.get(id);
    if (!existing) return false;
    memoryStore.set(id, { ...existing, merged_into: mergedInto, last_seen: Date.now() });
    return true;
  },
  async setPinned(id, pinned) {
    const existing = memoryStore.get(id);
    if (!existing) return null;
    const updated = { ...existing, pinned, last_seen: Date.now() };
    memoryStore.set(id, updated);
    return updated;
  },
};

/**
 * Ingests agent events and stores them as memory records.
 *
 * @param {import('./schema.js').MemoryEvent[]} events - Ordered list of raw events to persist.
 * @param {{ maxSummaryLength?: number, embedText?: (value: string) => Promise<number[]> | number[], repository?: typeof memoryRepository }} [options] - Optional ingest tuning.
 * @returns {Promise<import('./schema.js').MemoryRecord[]>} Stored memory records.
 */
export async function ingestEvents(events, options = {}) {
  const repository = options.repository ?? memoryRepository;
  const records = await ingestMemoryWindow({ events }, { ...options, repository });
  cache.clear();
  return records;
}

/**
 * Retrieves top-k memories for an agent query.
 *
 * @param {{ agent_id: string, query?: string, tags?: string[], timeframe?: { from?: number, to?: number }, k?: number, repository?: typeof memoryRepository }} params - Retrieval filter and ranking inputs.
 * @returns {Promise<import('./schema.js').MemoryRecord[]>} Sorted list of relevant memories.
 */
export async function getRelevantMemories(params) {
  const { repository = memoryRepository, ...queryParams } = params;
  const cacheKey = JSON.stringify(queryParams);
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const ranked = filterAndRankMemories([...memoryStore.values()], queryParams);
  await updateMemoryUsage(repository, ranked.map((memory) => memory.id));
  cache.set(cacheKey, ranked);
  return ranked;
}

/**
 * Runs a memory pruning pass and removes unpinned stale records.
 *
 * @param {{ retentionMs?: number, now?: number, scheduleEveryMs?: number, repository?: typeof memoryRepository }} [options] - Prune configuration; if scheduleEveryMs is set, returns a scheduler handle.
 * @returns {Promise<{ pruned: import('./schema.js').MemoryRecord[], scheduler?: { stop: () => void } }>} Pruned records and optional scheduler handle.
 */
export async function runPruneCycle(options = {}) {
  const repository = options.repository ?? memoryRepository;
  const retentionMs = options.retentionMs ?? (1000 * 60 * 60 * 24 * 30);
  const dbCandidates = await listPruneCandidates(repository, {
    retentionMs,
    now: options.now,
  });

  const prunable = dbCandidates.length > 0
    ? dbCandidates
    : selectPrunableMemories([...memoryStore.values()], {
      retentionMs,
      now: options.now,
    });

  for (const memory of prunable) {
    memoryStore.delete(memory.id);
  }

  cache.clear();

  const result = { pruned: prunable };
  if (Number.isFinite(options.scheduleEveryMs) && options.scheduleEveryMs > 0) {
    result.scheduler = startScheduler(() => runPruneCycle({ retentionMs, repository }), {
      intervalMs: options.scheduleEveryMs,
    });
  }

  return result;
}

/**
 * Pins a memory to prevent pruning and boost retrieval ranking.
 *
 * @param {string} id - Memory record identifier.
 * @returns {Promise<import('./schema.js').MemoryRecord | null>} Updated memory record or null when not found.
 */
export async function pinMemory(id) {
  const updated = await memoryRepository.setPinned(id, true);
  cache.clear();
  return updated;
}

/**
 * Removes a pin from a memory so it can be pruned normally.
 *
 * @param {string} id - Memory record identifier.
 * @returns {Promise<import('./schema.js').MemoryRecord | null>} Updated memory record or null when not found.
 */
export async function unpinMemory(id) {
  const updated = await memoryRepository.setPinned(id, false);
  cache.clear();
  return updated;
}

/**
 * Marks one memory as merged into another.
 *
 * @param {string} id
 * @param {string} mergedInto
 */
export async function markMemoryMerged(id, mergedInto) {
  const merged = await memoryRepository.markMerged(id, mergedInto);
  cache.clear();
  return merged;
}
