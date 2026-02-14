/**
 * @param {import('./schema.js').MemoryRecord[]} memories
 * @param {{ retentionMs: number, now?: number }} options
 * @returns {import('./schema.js').MemoryRecord[]}
 */
export function selectPrunableMemories(memories, options) {
  const now = options.now ?? Date.now();
  const cutoff = now - options.retentionMs;

  return memories.filter((memory) => !memory.pinned && memory.last_seen < cutoff);
}


/**
 * @param {{ listPruneCandidates: (options: { cutoff: number, limit?: number }) => Promise<import('./schema.js').MemoryRecord[]> }} repository
 * @param {{ retentionMs: number, now?: number, limit?: number }} options
 */
export async function listPruneCandidates(repository, options) {
  const now = options.now ?? Date.now();
  const cutoff = now - options.retentionMs;
  return repository.listPruneCandidates({ cutoff, limit: options.limit });
}
