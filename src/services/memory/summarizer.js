/**
 * @param {import('./schema.js').MemoryEvent[]} events
 * @param {{ maxSummaryLength?: number }} [options]
 * @returns {string}
 */
export function summarizeEvents(events, options = {}) {
  const maxSummaryLength = options.maxSummaryLength ?? 280;
  const joined = events.map((event) => event.content).join(' ').trim();
  if (!joined) return '';
  return joined.length > maxSummaryLength ? `${joined.slice(0, maxSummaryLength - 1)}…` : joined;
}
