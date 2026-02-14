import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import { loadTorchConfig, _resetTorchConfigCache } from '../src/torch-config.mjs';

describe('loadTorchConfig (Unit Tests with Mocked FS)', () => {
  beforeEach(() => {
    _resetTorchConfigCache();
  });

  it('loads valid config correctly', () => {
    const mockFs = {
      existsSync: mock.fn(() => true),
      readFileSync: mock.fn(() => JSON.stringify({
        nostrLock: { namespace: 'unit-test-ns' }
      }))
    };

    const config = loadTorchConfig(mockFs);

    assert.strictEqual(config.nostrLock.namespace, 'unit-test-ns');
    assert.strictEqual(mockFs.existsSync.mock.calls.length, 1);
    assert.strictEqual(mockFs.readFileSync.mock.calls.length, 1);
  });

  it('returns default config when file is missing', () => {
    const mockFs = {
      existsSync: mock.fn(() => false),
      readFileSync: mock.fn()
    };

    const config = loadTorchConfig(mockFs);

    assert.strictEqual(config.nostrLock.namespace, null);
    assert.strictEqual(mockFs.existsSync.mock.calls.length, 1);
    assert.strictEqual(mockFs.readFileSync.mock.calls.length, 0);
  });

  it('throws error on malformed JSON', () => {
    const mockFs = {
      existsSync: mock.fn(() => true),
      readFileSync: mock.fn(() => '{ invalid json }')
    };

    assert.throws(() => {
      loadTorchConfig(mockFs);
    }, /Failed to parse/);
  });

  it('caches the config and ignores subsequent fs calls', () => {
    const mockFs = {
      existsSync: mock.fn(() => true),
      readFileSync: mock.fn(() => JSON.stringify({ nostrLock: { namespace: 'cached' } }))
    };

    const config1 = loadTorchConfig(mockFs);
    assert.strictEqual(config1.nostrLock.namespace, 'cached');

    // Second call with a different "fs" (or same) should not trigger fs operations
    const mockFs2 = {
      existsSync: mock.fn(() => true),
      readFileSync: mock.fn(() => JSON.stringify({ nostrLock: { namespace: 'changed' } }))
    };

    const config2 = loadTorchConfig(mockFs2);

    assert.strictEqual(config2.nostrLock.namespace, 'cached');
    assert.strictEqual(config1, config2);
    assert.strictEqual(mockFs.existsSync.mock.calls.length, 1);
    assert.strictEqual(mockFs2.existsSync.mock.calls.length, 0);
  });
});
