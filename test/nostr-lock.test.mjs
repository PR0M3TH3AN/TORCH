import { test, describe, it } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';

describe('CLI Smoke Test', () => {
  it('should print usage when no args provided', () => {
    const result = spawnSync('node', ['src/nostr-lock.mjs']);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr.toString(), /Usage:/);
  });

  it('should fail when checking without cadence', () => {
    const result = spawnSync('node', ['src/nostr-lock.mjs', 'check']);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr.toString(), /--cadence <daily|weekly> is required/);
  });
});
