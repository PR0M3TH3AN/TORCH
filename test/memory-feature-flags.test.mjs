import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getMemoryPruneMode,
  isMemoryEnabled,
  isMemoryIngestEnabled,
  isMemoryPruneEnabled,
} from '../src/services/memory/feature-flags.js';

test('memory feature flags parse defaults and canary allow-lists', () => {
  assert.equal(isMemoryEnabled({}), true);
  assert.equal(isMemoryEnabled({ TORCH_MEMORY_ENABLED: 'false' }), false);

  assert.equal(isMemoryIngestEnabled('agent-a', {}), true);
  assert.equal(isMemoryIngestEnabled('agent-a', { TORCH_MEMORY_INGEST_ENABLED: 'false' }), false);
  assert.equal(isMemoryIngestEnabled('agent-a', { TORCH_MEMORY_INGEST_ENABLED: 'agent-a,agent-b' }), true);
  assert.equal(isMemoryIngestEnabled('agent-c', { TORCH_MEMORY_INGEST_ENABLED: 'agent-a,agent-b' }), false);
});

test('memory prune flag supports off, dry-run, and active modes', () => {
  assert.equal(getMemoryPruneMode({}), 'active');
  assert.equal(getMemoryPruneMode({ TORCH_MEMORY_PRUNE_ENABLED: 'false' }), 'off');
  assert.equal(getMemoryPruneMode({ TORCH_MEMORY_PRUNE_ENABLED: 'dry-run' }), 'dry-run');
  assert.equal(getMemoryPruneMode({ TORCH_MEMORY_PRUNE_ENABLED: 'true' }), 'active');
  assert.equal(isMemoryPruneEnabled({ TORCH_MEMORY_PRUNE_ENABLED: 'dry-run' }), false);
  assert.equal(isMemoryPruneEnabled({ TORCH_MEMORY_PRUNE_ENABLED: 'true' }), true);
});
