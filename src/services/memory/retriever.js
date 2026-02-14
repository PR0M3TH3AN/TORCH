/**
 * @param {import('./schema.js').MemoryRecord[]} memories
 * @param {{ agent_id: string, query?: string, tags?: string[], timeframe?: { from?: number, to?: number }, k?: number }} params
 * @returns {import('./schema.js').MemoryRecord[]}
 */
export function filterAndRankMemories(memories, params) {
  const { agent_id, query = '', tags = [], timeframe, k = 10 } = params;
  const loweredQuery = query.toLowerCase();

  const filtered = memories.filter((memory) => {
    if (memory.agent_id !== agent_id) return false;

    const inTimeframe = !timeframe
      || ((timeframe.from == null || memory.created_at >= timeframe.from)
        && (timeframe.to == null || memory.created_at <= timeframe.to));

    if (!inTimeframe) return false;

    if (tags.length > 0) {
      const memoryTags = new Set(memory.tags);
      const matchesAllTags = tags.every((tag) => memoryTags.has(tag));
      if (!matchesAllTags) return false;
    }

    return true;
  });

  return filtered
    .map((memory) => {
      const haystack = `${memory.summary} ${memory.content}`.toLowerCase();
      const queryScore = loweredQuery && haystack.includes(loweredQuery) ? 1 : 0;
      const pinBoost = memory.pinned ? 1 : 0;
      const recencyScore = Number.isFinite(memory.last_seen) ? memory.last_seen : memory.created_at;

      return {
        memory,
        score: (queryScore * 10) + (pinBoost * 5) + recencyScore,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((entry) => entry.memory);
}
