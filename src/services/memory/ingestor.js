import { normalizeEvent } from './schema.js';

/**
 * @param {import('./schema.js').MemoryEvent[]} events
 * @returns {import('./schema.js').MemoryEvent[]}
 */
export function normalizeEvents(events) {
  return events.map(normalizeEvent);
}
