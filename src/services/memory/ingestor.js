import { normalizeEvent } from './schema.js';

/**
 * @param {import('./schema.js').MemoryEvent[]} events
 * @returns {import('./schema.js').MemoryEvent[]}
 */
export function normalizeEvents(events) {
  return events.map(normalizeEvent);
}

/**
 * @param {{ insertMemory: (memory: import('./schema.js').MemoryRecord) => Promise<unknown> }} repository
 * @param {import('./schema.js').MemoryRecord} memory
 */
export async function insertMemory(repository, memory) {
  return repository.insertMemory(memory);
}
