import test from 'node:test';
import assert from 'node:assert/strict';

import { createMemoryCache } from '../src/services/memory/cache.js';

test('stores runtime events in signer/session namespace and clears scope', () => {
  const cache = createMemoryCache();

  cache.setRuntimeEvent({ signer_id: 'alice', session_id: 's1' }, { id: 1 });
  cache.setRuntimeEvent({ signer_id: 'alice', session_id: 's2' }, { id: 2 });

  assert.deepEqual(
    cache.getRecentRuntimeEvents({ signer_id: 'alice', session_id: 's1' }).map((event) => event.id),
    [1],
  );
  assert.deepEqual(
    cache.getRecentRuntimeEvents({ signer_id: 'alice', session_id: 's2' }).map((event) => event.id),
    [2],
  );

  cache.clearScope({ signer_id: 'alice', session_id: 's1' });
  assert.equal(cache.getRecentRuntimeEvents({ signer_id: 'alice', session_id: 's1' }).length, 0);
  assert.equal(cache.getRecentRuntimeEvents({ signer_id: 'alice', session_id: 's2' }).length, 1);
});

test('expires runtime events and records expiration metrics', async () => {
  const cache = createMemoryCache();
  cache.setRuntimeEvent({ signer_id: 'alice', session_id: 's1' }, { id: 1 }, 1);

  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(cache.getRecentRuntimeEvents({ signer_id: 'alice', session_id: 's1' }).length, 0);
  const metrics = cache.getMetrics();
  assert.equal(metrics.runtime_events_expired, 1);
});

test('enforces LRU bounds and tracks eviction metrics', () => {
  const cache = createMemoryCache({ maxNamespaces: 1, maxEventsPerNamespace: 2, maxTotalEvents: 2 });

  cache.setRuntimeEvent({ signer_id: 'alice', session_id: 's1' }, { id: 1 });
  cache.setRuntimeEvent({ signer_id: 'alice', session_id: 's1' }, { id: 2 });
  cache.setRuntimeEvent({ signer_id: 'alice', session_id: 's1' }, { id: 3 });

  const ids = cache.getRecentRuntimeEvents({ signer_id: 'alice', session_id: 's1' }).map((event) => event.id);
  assert.deepEqual(ids, [2, 3]);

  cache.setRuntimeEvent({ signer_id: 'bob', session_id: 's2' }, { id: 4 });
  assert.equal(cache.getRecentRuntimeEvents({ signer_id: 'alice', session_id: 's1' }).length, 0);

  const metrics = cache.getMetrics();
  assert.ok(metrics.runtime_events_lru_evicted >= 3);
});

test('blocks decrypted/session-sensitive data from durable promotion without sanitizer pass', () => {
  const cache = createMemoryCache();

  cache.setRuntimeEvent(
    { signer_id: 'alice', session_id: 's1' },
    { id: 1, classification: 'decrypted', sanitized_for_durable: false },
  );
  cache.setRuntimeEvent(
    { signer_id: 'alice', session_id: 's1' },
    { id: 2, classification: 'decrypted', sanitized_for_durable: true },
  );

  const events = cache.getRecentRuntimeEvents({ signer_id: 'alice', session_id: 's1' });
  assert.equal(events[0].durable_eligible, false);
  assert.equal(events[1].durable_eligible, true);
  assert.equal(cache.getMetrics().runtime_sensitive_events_blocked, 1);
});
