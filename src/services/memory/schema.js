/**
 * @typedef {Object} MemoryEvent
 * @property {string} agent_id
 * @property {string} content
 * @property {number} [timestamp]
 * @property {string[]} [tags]
 * @property {Record<string, unknown>} [metadata]
 */

/**
 * @typedef {Object} MemoryRecord
 * @property {string} id
 * @property {string} agent_id
 * @property {string} summary
 * @property {string} content
 * @property {number} created_at
 * @property {number} updated_at
 * @property {string[]} tags
 * @property {number[] | null} embedding
 * @property {boolean} pinned
 * @property {Record<string, unknown>} metadata
 */

/**
 * @param {MemoryEvent} event
 * @returns {MemoryEvent}
 */
export function normalizeEvent(event) {
  return {
    ...event,
    timestamp: Number.isFinite(event?.timestamp) ? event.timestamp : Date.now(),
    tags: Array.isArray(event?.tags) ? event.tags : [],
    metadata: event?.metadata && typeof event.metadata === 'object' ? event.metadata : {},
  };
}

/**
 * @param {Partial<MemoryRecord>} record
 * @returns {MemoryRecord}
 */
export function createMemoryRecord(record) {
  const now = Date.now();
  return {
    id: record.id || crypto.randomUUID(),
    agent_id: record.agent_id || '',
    summary: record.summary || '',
    content: record.content || '',
    created_at: Number.isFinite(record.created_at) ? record.created_at : now,
    updated_at: Number.isFinite(record.updated_at) ? record.updated_at : now,
    tags: Array.isArray(record.tags) ? record.tags : [],
    embedding: Array.isArray(record.embedding) ? record.embedding : null,
    pinned: Boolean(record.pinned),
    metadata: record.metadata && typeof record.metadata === 'object' ? record.metadata : {},
  };
}
