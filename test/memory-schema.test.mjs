import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ingestEvents } from '../src/services/memory/index.js';
import {
  SCHEMA_VERSION,
  normalizeMemoryItem,
  validateMemoryItem,
} from '../src/services/memory/schema.js';

test('normalizeMemoryItem applies durable schema defaults and coercions', () => {
  const item = normalizeMemoryItem({
    agent_id: 'agent-1',
    content: 'hello',
    summary: 'hello',
    tags: ['a', 2, ''],
    importance: 2,
    ttl_days: 3.8,
    pinned: 'yes',
  });

  assert.equal(item.schema_version, SCHEMA_VERSION);
  assert.equal(item.agent_id, 'agent-1');
  assert.deepEqual(item.tags, ['a', '2']);
  assert.equal(item.importance, 1);
  assert.equal(item.ttl_days, 3);
  assert.equal(item.pinned, true);
  assert.equal(item.type, 'event');
  assert.equal(item.source, 'ingest');
  assert.ok(item.id);
});

test('validateMemoryItem reports field-level errors', () => {
  const result = validateMemoryItem({
    schema_version: SCHEMA_VERSION,
    id: 'id-1',
    agent_id: '',
    session_id: 's-1',
    type: 'event',
    content: 'content',
    summary: 'summary',
    tags: ['tag'],
    importance: 0.4,
    embedding_id: null,
    created_at: Date.now(),
    last_seen: Date.now(),
    source: 'ingest',
    ttl_days: null,
    merged_into: null,
    pinned: false,
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.field === 'agent_id'));
});

test('ingestEvents rejects invalid writes and logs structured validation details', async () => {
  const originalError = console.error;
  const entries = [];
  console.error = (...args) => {
    entries.push(args);
  };

  try {
    await assert.rejects(
      () => ingestEvents([{ content: 'missing agent id' }]),
      /Memory ingest rejected/
    );
  } finally {
    console.error = originalError;
  }

  assert.equal(entries.length, 1);
  const [tag, payload] = entries[0];
  assert.equal(tag, 'memory_validation_error');
  assert.equal(payload.stage, 'ingest');
  assert.ok(Array.isArray(payload.fields));
  assert.ok(payload.fields.some((field) => field.field === 'agent_id'));
});
