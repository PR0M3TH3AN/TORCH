import { test, describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { getTorchConfigPath, parseTorchConfig, loadTorchConfig, _resetTorchConfigCache, getRelays } from '../src/torch-config.mjs';
import { DEFAULT_RELAYS } from '../src/constants.mjs';

describe('torch-config', () => {
  describe('getTorchConfigPath', () => {
    const originalEnv = process.env.TORCH_CONFIG_PATH;

    after(() => {
      if (originalEnv === undefined) {
        delete process.env.TORCH_CONFIG_PATH;
      } else {
        process.env.TORCH_CONFIG_PATH = originalEnv;
      }
    });

    it('returns default path when env var is not set', () => {
      delete process.env.TORCH_CONFIG_PATH;
      const expected = path.resolve(process.cwd(), 'torch-config.json');
      assert.strictEqual(getTorchConfigPath(), expected);
    });

    it('returns custom path when env var is set', () => {
      process.env.TORCH_CONFIG_PATH = 'custom-config.json';
      const expected = path.resolve(process.cwd(), 'custom-config.json');
      assert.strictEqual(getTorchConfigPath(), expected);
    });

    it('trims env var value', () => {
      process.env.TORCH_CONFIG_PATH = '  trimmed-config.json  ';
      const expected = path.resolve(process.cwd(), 'trimmed-config.json');
      assert.strictEqual(getTorchConfigPath(), expected);
    });
  });

  describe('parseTorchConfig', () => {
    it('returns default values for empty raw config', () => {
      const config = parseTorchConfig({}, 'some-path.json');
      assert.strictEqual(config.configPath, 'some-path.json');
      assert.deepStrictEqual(config.raw, {});
      assert.strictEqual(config.nostrLock.namespace, null);
      assert.strictEqual(config.dashboard.defaultCadenceView, 'daily');
      assert.strictEqual(config.dashboard.defaultStatusView, 'active');
      assert.deepStrictEqual(config.scheduler.paused.daily, []);
    });

    it('correctly parses and normalizes nostrLock config', () => {
      const raw = {
        nostrLock: {
          namespace: ' test ',
          relays: [' wss://relay1 ', '', 'wss://relay2'],
          ttlSeconds: 3600.5,
          queryTimeoutMs: 5000,
          dailyRoster: ['agent1', 'agent2'],
        }
      };
      const config = parseTorchConfig(raw);
      assert.strictEqual(config.nostrLock.namespace, 'test');
      assert.deepStrictEqual(config.nostrLock.relays, ['wss://relay1', 'wss://relay2']);
      assert.strictEqual(config.nostrLock.ttlSeconds, 3600);
      assert.strictEqual(config.nostrLock.queryTimeoutMs, 5000);
      assert.deepStrictEqual(config.nostrLock.dailyRoster, ['agent1', 'agent2']);
    });

    it('normalizes cadence and status in dashboard config', () => {
      const raw = {
        dashboard: {
          defaultCadenceView: ' WEEKLY ',
          defaultStatusView: ' ALL '
        }
      };
      const config = parseTorchConfig(raw);
      assert.strictEqual(config.dashboard.defaultCadenceView, 'weekly');
      assert.strictEqual(config.dashboard.defaultStatusView, 'all');
    });

    it('falls back to defaults for invalid cadence/status', () => {
      const raw = {
        dashboard: {
          defaultCadenceView: 'invalid',
          defaultStatusView: 'invalid'
        }
      };
      const config = parseTorchConfig(raw);
      assert.strictEqual(config.dashboard.defaultCadenceView, 'daily');
      assert.strictEqual(config.dashboard.defaultStatusView, 'active');
    });

    it('correctly parses scheduler config', () => {
      const raw = {
        scheduler: {
          firstPromptByCadence: {
            daily: ' daily-prompt.md ',
            weekly: ' weekly-prompt.md '
          },
          paused: {
            daily: [' paused1 '],
            weekly: [' paused2 ']
          }
        }
      };
      const config = parseTorchConfig(raw);
      assert.strictEqual(config.scheduler.firstPromptByCadence.daily, 'daily-prompt.md');
      assert.strictEqual(config.scheduler.firstPromptByCadence.weekly, 'weekly-prompt.md');
      assert.deepStrictEqual(config.scheduler.paused.daily, ['paused1']);
      assert.deepStrictEqual(config.scheduler.paused.weekly, ['paused2']);
    });

    it('handles non-array roster values by returning null or empty array', () => {
       const raw = {
         nostrLock: { dailyRoster: 'not-an-array' },
         scheduler: { paused: { daily: 'not-an-array' } }
       };
       const config = parseTorchConfig(raw);
       assert.strictEqual(config.nostrLock.dailyRoster, null);
       assert.deepStrictEqual(config.scheduler.paused.daily, []);
    });
  });

  describe('loadTorchConfig', () => {
    const tempConfigPath = path.resolve(process.cwd(), 'temp-torch-config.json');
    const badConfigPath = path.resolve(process.cwd(), 'bad-torch-config.json');
    const originalEnv = process.env.TORCH_CONFIG_PATH;

    beforeEach(() => {
      _resetTorchConfigCache();
      delete process.env.TORCH_CONFIG_PATH;
    });

    after(() => {
      if (fs.existsSync(tempConfigPath)) fs.unlinkSync(tempConfigPath);
      if (fs.existsSync(badConfigPath)) fs.unlinkSync(badConfigPath);
      if (originalEnv === undefined) {
        delete process.env.TORCH_CONFIG_PATH;
      } else {
        process.env.TORCH_CONFIG_PATH = originalEnv;
      }
      _resetTorchConfigCache();
    });

    it('loads config from disk', () => {
      const raw = { nostrLock: { namespace: 'from-disk' } };
      fs.writeFileSync(tempConfigPath, JSON.stringify(raw));
      process.env.TORCH_CONFIG_PATH = tempConfigPath;

      const config = loadTorchConfig();
      assert.strictEqual(config.nostrLock.namespace, 'from-disk');
      assert.strictEqual(config.configPath, tempConfigPath);
    });

    it('returns defaults if file does not exist', () => {
      process.env.TORCH_CONFIG_PATH = 'non-existent.json';
      const config = loadTorchConfig();
      assert.strictEqual(config.nostrLock.namespace, null);
    });

    it('throws error for malformed JSON', () => {
       fs.writeFileSync(badConfigPath, '{ invalid json }');
       process.env.TORCH_CONFIG_PATH = badConfigPath;

       assert.throws(() => {
         loadTorchConfig();
       }, /Failed to parse/);
    });

    it('caches the config', () => {
      const raw1 = { nostrLock: { namespace: 'first' } };
      fs.writeFileSync(tempConfigPath, JSON.stringify(raw1));
      process.env.TORCH_CONFIG_PATH = tempConfigPath;

      const config1 = loadTorchConfig();
      assert.strictEqual(config1.nostrLock.namespace, 'first');

      const raw2 = { nostrLock: { namespace: 'second' } };
      fs.writeFileSync(tempConfigPath, JSON.stringify(raw2));

      const config2 = loadTorchConfig();
      assert.strictEqual(config2.nostrLock.namespace, 'first', 'Should return cached value');
      assert.strictEqual(config1, config2, 'Should be the same object');
    });
  });

  describe('getRelays', () => {
    const originalEnv = process.env.NOSTR_LOCK_RELAYS;

    beforeEach(() => {
      _resetTorchConfigCache();
      delete process.env.NOSTR_LOCK_RELAYS;
    });

    after(() => {
      if (originalEnv === undefined) {
        delete process.env.NOSTR_LOCK_RELAYS;
      } else {
        process.env.NOSTR_LOCK_RELAYS = originalEnv;
      }
      _resetTorchConfigCache();
    });

    it('returns default relays when no config or env var is set', () => {
      const relays = getRelays();
      assert.deepStrictEqual(relays, DEFAULT_RELAYS);
    });

    it('returns relays from env var if set', () => {
      process.env.NOSTR_LOCK_RELAYS = 'wss://env.relay,wss://env.relay2';
      const relays = getRelays();
      assert.deepStrictEqual(relays, ['wss://env.relay', 'wss://env.relay2']);
    });
  });
});
