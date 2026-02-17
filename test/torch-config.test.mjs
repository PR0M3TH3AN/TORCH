import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  getTorchConfigPath,
  parseTorchConfig,
  loadTorchConfig,
  _resetTorchConfigCache,
  getRelays,
  getQueryTimeoutMs,
  getPublishTimeoutMs,
  getMinSuccessfulRelayPublishes,
  getRelayFallbacks,
  getMinActiveRelayPool,
} from '../src/torch-config.mjs';
import { DEFAULT_RELAYS } from '../src/constants.mjs';

describe('torch-config', () => {
  describe('getTorchConfigPath', () => {
    const originalEnv = process.env.TORCH_CONFIG_PATH;

    after(() => {
      if (originalEnv === undefined) delete process.env.TORCH_CONFIG_PATH;
      else process.env.TORCH_CONFIG_PATH = originalEnv;
    });

    it('returns default path when env var is not set', () => {
      delete process.env.TORCH_CONFIG_PATH;
      assert.strictEqual(getTorchConfigPath(), path.resolve(process.cwd(), 'torch-config.json'));
    });

    it('returns custom path when env var is set', () => {
      process.env.TORCH_CONFIG_PATH = 'custom-config.json';
      assert.strictEqual(getTorchConfigPath(), path.resolve(process.cwd(), 'custom-config.json'));
    });
  });

  describe('parseTorchConfig', () => {
    it('parses new lock backend knobs', () => {
      const config = parseTorchConfig({
        nostrLock: {
          namespace: ' test ',
          relays: ['wss://relay1'],
          relayFallbacks: [' wss://fallback-1 ', 'wss://fallback-2'],
          queryTimeoutMs: 5000,
          publishTimeoutMs: 8000,
          minSuccessfulRelayPublishes: 2,
          minActiveRelayPool: 2,
        },
      });

      assert.strictEqual(config.nostrLock.namespace, 'test');
      assert.deepStrictEqual(config.nostrLock.relays, ['wss://relay1']);
      assert.deepStrictEqual(config.nostrLock.relayFallbacks, ['wss://fallback-1', 'wss://fallback-2']);
      assert.strictEqual(config.nostrLock.queryTimeoutMs, 5000);
      assert.strictEqual(config.nostrLock.publishTimeoutMs, 8000);
      assert.strictEqual(config.nostrLock.minSuccessfulRelayPublishes, 2);
      assert.strictEqual(config.nostrLock.minActiveRelayPool, 2);
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
      if (originalEnv === undefined) delete process.env.TORCH_CONFIG_PATH;
      else process.env.TORCH_CONFIG_PATH = originalEnv;
      _resetTorchConfigCache();
    });

    it('throws fatal error for invalid relay URL', async () => {
      fs.writeFileSync(tempConfigPath, JSON.stringify({ nostrLock: { relays: ['https://bad'] } }));
      process.env.TORCH_CONFIG_PATH = tempConfigPath;
      await assert.rejects(() => loadTorchConfig(), /Invalid relay URL in nostrLock\.relays/);
    });

    it('throws fatal error for invalid timeout range', async () => {
      fs.writeFileSync(tempConfigPath, JSON.stringify({ nostrLock: { queryTimeoutMs: 50 } }));
      process.env.TORCH_CONFIG_PATH = tempConfigPath;
      await assert.rejects(() => loadTorchConfig(), /Invalid nostrLock\.queryTimeoutMs/);
    });

    it('throws error for malformed JSON', async () => {
      fs.writeFileSync(badConfigPath, '{ invalid json }');
      process.env.TORCH_CONFIG_PATH = badConfigPath;
      await assert.rejects(() => loadTorchConfig(), /Failed to parse/);
    });
  });

  describe('backend getters', () => {
    const originalEnv = {
      NOSTR_LOCK_RELAYS: process.env.NOSTR_LOCK_RELAYS,
      NOSTR_LOCK_QUERY_TIMEOUT_MS: process.env.NOSTR_LOCK_QUERY_TIMEOUT_MS,
      NOSTR_LOCK_PUBLISH_TIMEOUT_MS: process.env.NOSTR_LOCK_PUBLISH_TIMEOUT_MS,
      NOSTR_LOCK_MIN_SUCCESSFUL_PUBLISHES: process.env.NOSTR_LOCK_MIN_SUCCESSFUL_PUBLISHES,
      NOSTR_LOCK_RELAY_FALLBACKS: process.env.NOSTR_LOCK_RELAY_FALLBACKS,
      NOSTR_LOCK_MIN_ACTIVE_RELAY_POOL: process.env.NOSTR_LOCK_MIN_ACTIVE_RELAY_POOL,
    };

    beforeEach(() => {
      _resetTorchConfigCache();
      delete process.env.NOSTR_LOCK_RELAYS;
      delete process.env.NOSTR_LOCK_QUERY_TIMEOUT_MS;
      delete process.env.NOSTR_LOCK_PUBLISH_TIMEOUT_MS;
      delete process.env.NOSTR_LOCK_MIN_SUCCESSFUL_PUBLISHES;
      delete process.env.NOSTR_LOCK_RELAY_FALLBACKS;
      delete process.env.NOSTR_LOCK_MIN_ACTIVE_RELAY_POOL;
    });

    after(() => {
      for (const [k, v] of Object.entries(originalEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      _resetTorchConfigCache();
    });

    it('returns default relays', async () => {
      assert.deepStrictEqual(await getRelays(), DEFAULT_RELAYS);
    });

    it('validates env knob values', async () => {
      process.env.NOSTR_LOCK_QUERY_TIMEOUT_MS = '99';
      await assert.rejects(() => getQueryTimeoutMs(), /NOSTR_LOCK_QUERY_TIMEOUT_MS/);

      process.env.NOSTR_LOCK_QUERY_TIMEOUT_MS = '5000';
      process.env.NOSTR_LOCK_PUBLISH_TIMEOUT_MS = 'abc';
      await assert.rejects(() => getPublishTimeoutMs(), /NOSTR_LOCK_PUBLISH_TIMEOUT_MS/);

      process.env.NOSTR_LOCK_PUBLISH_TIMEOUT_MS = '8000';
      process.env.NOSTR_LOCK_MIN_SUCCESSFUL_PUBLISHES = '0';
      await assert.rejects(() => getMinSuccessfulRelayPublishes(), /NOSTR_LOCK_MIN_SUCCESSFUL_PUBLISHES/);

      process.env.NOSTR_LOCK_RELAY_FALLBACKS = 'https://bad';
      await assert.rejects(() => getRelayFallbacks(), /NOSTR_LOCK_RELAY_FALLBACKS/);

      process.env.NOSTR_LOCK_RELAY_FALLBACKS = '';
      process.env.NOSTR_LOCK_MIN_ACTIVE_RELAY_POOL = '0';
      await assert.rejects(() => getMinActiveRelayPool(), /NOSTR_LOCK_MIN_ACTIVE_RELAY_POOL/);
    });
  });
});
