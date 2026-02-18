import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import { loadTorchConfig, _resetTorchConfigCache } from '../src/torch-config.mjs';

describe('loadTorchConfig (Unit Tests with Mocked FS)', () => {
  beforeEach(() => {
    _resetTorchConfigCache();
  });

  it('loads valid config correctly', async () => {
    const mockFs = {
      existsSync: mock.fn(() => true),
      promises: {
        readFile: mock.fn(async () => JSON.stringify({
          nostrLock: { namespace: 'unit-test-ns' }
        }))
      }
    };

    const config = await loadTorchConfig(mockFs);

    assert.strictEqual(config.nostrLock.namespace, 'unit-test-ns');
    // loadTorchConfig no longer calls existsSync on the passed fs, only readFile (and catches ENOENT)
    // Actually, getTorchConfigPath calls existsSync on REAL fs.
    // So checking mockFs.existsSync is wrong if loadTorchConfig doesn't call it.
    // In my change, loadTorchConfig calls await fileSystem.promises.readFile.
    assert.strictEqual(mockFs.promises.readFile.mock.calls.length, 1);
  });

  it('returns default config when file is missing', async () => {
    const mockFs = {
      promises: {
        readFile: mock.fn(async () => {
          const err = new Error('ENOENT');
          err.code = 'ENOENT';
          throw err;
        })
      }
    };

    const config = await loadTorchConfig(mockFs);

    assert.strictEqual(config.nostrLock.namespace, null);
    assert.strictEqual(mockFs.promises.readFile.mock.calls.length, 1);
  });

  it('throws error on malformed JSON', async () => {
    const mockFs = {
      promises: {
        readFile: mock.fn(async () => '{ invalid json }')
      }
    };

    await assert.rejects(async () => {
      await loadTorchConfig(mockFs);
    }, /Failed to parse/);
  });

  it('caches the config and ignores subsequent fs calls', async () => {
    const mockFs = {
      promises: {
        readFile: mock.fn(async () => JSON.stringify({ nostrLock: { namespace: 'cached' } }))
      }
    };

    const config1 = await loadTorchConfig(mockFs);
    assert.strictEqual(config1.nostrLock.namespace, 'cached');

    // Second call with a different "fs" (or same) should not trigger fs operations
    const mockFs2 = {
      promises: {
        readFile: mock.fn(async () => JSON.stringify({ nostrLock: { namespace: 'changed' } }))
      }
    };

    const config2 = await loadTorchConfig(mockFs2);

    assert.strictEqual(config2.nostrLock.namespace, 'cached');
    assert.strictEqual(config1, config2);
    assert.strictEqual(mockFs.promises.readFile.mock.calls.length, 1);
    assert.strictEqual(mockFs2.promises.readFile.mock.calls.length, 0);
  });

  it('returns null for empty string lists (new consistent behavior)', async () => {
    const mockFs = {
      promises: {
        readFile: mock.fn(async () => JSON.stringify({
          nostrLock: {
            relays: [],
            relayFallbacks: []
          },
          dashboard: {
            relays: []
          }
        }))
      }
    };

    const config = await loadTorchConfig(mockFs);

    // New behavior: all return null
    assert.strictEqual(config.nostrLock.relays, null);
    assert.strictEqual(config.dashboard.relays, null);
    assert.strictEqual(config.nostrLock.relayFallbacks, null);
  });
});
