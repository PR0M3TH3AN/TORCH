
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { cmdDashboard } from '../src/dashboard.mjs';

const tempConfigPath = path.resolve('torch-config-exposure-test.json');

const SENSITIVE_CONFIG = {
  nostrLock: {
    namespace: 'test-namespace',
    relays: ['wss://relay.example.com'],
    dailyRoster: ['user1', 'user2'], // Sensitive roster
    weeklyRoster: ['user3'],
    ttlSeconds: 3600,
    queryTimeoutMs: 5000,
    publishTimeoutMs: 5000,
    minSuccessfulRelayPublishes: 2,
    minActiveRelayPool: 1,
  },
  dashboard: {
    auth: 'secret-auth-string', // stripped by auth check
    relays: ['wss://dashboard.relay.example.com'],
  },
  scheduler: {
    paused: {
      daily: ['user1'],
    },
    firstPromptByCadence: {
      daily: 'some prompt',
    },
  },
};

test('Dashboard Configuration Exposure Security', async (t) => {
  // Setup temp config
  fs.writeFileSync(tempConfigPath, JSON.stringify(SENSITIVE_CONFIG, null, 2));

  // Override env to use this config
  const originalEnvPath = process.env.TORCH_CONFIG_PATH;
  process.env.TORCH_CONFIG_PATH = tempConfigPath;
  // Disable auth via env so we can access the endpoint without credentials
  // The vulnerability is about exposure of *other* fields.
  // We need to bypass the basic auth middleware to test the JSON response.
  // However, cmdDashboard checks config.dashboard.auth too.
  // If we want to test that auth is stripped from JSON, we should enable auth but provide credentials.
  // OR we can just test the sanitization logic which runs regardless of how we got there?
  // No, the endpoint logic runs after auth check.

  // To keep it simple: we want to verify that IF we can access the endpoint, the sensitive data is gone.
  // We can simulate an authorized request or disable auth.
  // If we disable auth in config, we can access it.

  // Let's modify the config for the test to NOT have auth, so we can access it freely.
  // We want to verify that things like 'dailyRoster' are stripped.
  const configForTest = { ...SENSITIVE_CONFIG };
  delete configForTest.dashboard.auth;
  fs.writeFileSync(tempConfigPath, JSON.stringify(configForTest, null, 2));

  let server;
  let serverPort;

  // Cleanup function
  t.after(() => {
    if (server) server.close();
    if (fs.existsSync(tempConfigPath)) fs.unlinkSync(tempConfigPath);
    if (originalEnvPath) process.env.TORCH_CONFIG_PATH = originalEnvPath;
    else delete process.env.TORCH_CONFIG_PATH;
  });

  // Start server
  await new Promise((resolve) => {
    cmdDashboard(0).then((srv) => {
      server = srv;
      serverPort = server.address().port;
      resolve();
    });
  });

  // Fetch config
  const responseBody = await new Promise((resolve, reject) => {
    http.get(`http://localhost:${serverPort}/torch-config.json`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });

  let exposedConfig;
  try {
      exposedConfig = JSON.parse(responseBody);
  } catch (_e) {
      assert.fail(`Failed to parse JSON response: ${responseBody}`);
  }

  // 1. Assert sensitive fields are NOT present
  assert.equal(exposedConfig.nostrLock?.dailyRoster, undefined, 'dailyRoster should NOT be exposed');
  assert.equal(exposedConfig.nostrLock?.weeklyRoster, undefined, 'weeklyRoster should NOT be exposed');
  assert.equal(exposedConfig.nostrLock?.relayFallbacks, undefined, 'relayFallbacks should NOT be exposed');
  assert.equal(exposedConfig.scheduler, undefined, 'scheduler config should NOT be exposed');
  assert.equal(exposedConfig.raw, undefined, 'raw config should NOT be exposed');

  // 2. Assert required fields ARE present
  assert.ok(exposedConfig.dashboard, 'dashboard config should be present');
  // Note: cmdDashboard loads from file, parseTorchConfig normalizes keys.
  // check dashboard.relays
  assert.deepEqual(exposedConfig.dashboard.relays, ['wss://dashboard.relay.example.com'], 'dashboard relays should be present');

  assert.ok(exposedConfig.nostrLock, 'nostrLock config should be present');
  assert.equal(exposedConfig.nostrLock.namespace, 'test-namespace', 'nostrLock namespace should be present');
  assert.deepEqual(exposedConfig.nostrLock.relays, ['wss://relay.example.com'], 'nostrLock relays should be present');
});
