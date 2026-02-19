import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { cmdDashboard } from '../src/dashboard.mjs';
import { _resetTorchConfigCache } from '../src/torch-config.mjs';

const CONFIG_FILE = 'torch-config-test.json';

// Helper to fetch JSON
function fetchJson(url, auth) {
  return new Promise((resolve, reject) => {
    const options = {
        headers: {}
    };
    if (auth) {
        options.headers['Authorization'] = `Basic ${Buffer.from(auth).toString('base64')}`;
    }
    http.get(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

test('Dashboard Configuration Security', async (t) => {
  process.env.TORCH_CONFIG_PATH = CONFIG_FILE;
  const configPath = path.resolve(process.cwd(), CONFIG_FILE);
  let server;

  // Ensure clean state
  if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
  _resetTorchConfigCache();

  t.afterEach((done) => {
    if (server) {
      server.close(done);
      server = null;
    } else {
      done();
    }
    if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
  });

  t.after(() => {
    delete process.env.TORCH_CONFIG_PATH;
  });

  // Scenario 1: Unauthenticated access (no auth configured), sensitive fields in config
  await t.test('sanitizes config when auth is disabled', async () => {
    const sensitiveConfig = {
      dashboard: {
        relays: ["wss://public.relay.com"]
      },
      super_secret_key: "DO_NOT_LEAK",
      nostrLock: {
        relays: ["wss://lock.relay.com"]
      }
    };
    fs.writeFileSync(configPath, JSON.stringify(sensitiveConfig, null, 2));
    _resetTorchConfigCache();

    server = await cmdDashboard(0);
    const testPort = server.address().port;

    try {
      const { statusCode, body } = await fetchJson(`http://127.0.0.1:${testPort}/torch-config.json`);

      assert.strictEqual(statusCode, 200);
      const json = JSON.parse(body);

      // Check for leaks
      assert.strictEqual(json.super_secret_key, undefined, 'Unknown fields should be stripped');

      // Check for valid fields
      assert.deepStrictEqual(json.dashboard.relays, sensitiveConfig.dashboard.relays);
      assert.deepStrictEqual(json.nostrLock.relays, sensitiveConfig.nostrLock.relays);

      // Check that configPath is not leaked
      assert.strictEqual(json.configPath, undefined, 'configPath should not be exposed');

    } finally {
      // server closed by afterEach
    }
  });

  // Scenario 2: Authenticated access, auth credentials in config
  await t.test('sanitizes auth credentials even when authenticated', async () => {
    const authConfig = {
      dashboard: {
        auth: "admin:password123",
        relays: ["wss://secure.relay.com"]
      }
    };
    fs.writeFileSync(configPath, JSON.stringify(authConfig, null, 2));
    _resetTorchConfigCache();

    server = await cmdDashboard(0);
    const testPort = server.address().port;

    try {
      // 1. Verify 401 without auth
      const res401 = await fetchJson(`http://127.0.0.1:${testPort}/torch-config.json`);
      assert.strictEqual(res401.statusCode, 401);

      // 2. Verify 200 with auth
      const { statusCode, body } = await fetchJson(`http://127.0.0.1:${testPort}/torch-config.json`, "admin:password123");
      assert.strictEqual(statusCode, 200);

      const json = JSON.parse(body);

      // Check for leaks
      assert.strictEqual(json.dashboard.auth, undefined, 'Auth credentials should be stripped');

      // Check for valid fields
      assert.deepStrictEqual(json.dashboard.relays, authConfig.dashboard.relays);

    } finally {
      // server closed by afterEach
    }
  });

});
