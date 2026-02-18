import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { cmdDashboard } from '../src/dashboard.mjs';
import { _resetTorchConfigCache } from '../src/torch-config.mjs';

test('Dashboard Authentication', async (t) => {
  const testPort = 4174;

  await t.test('returns 401 when auth is required but missing', async () => {
    process.env.TORCH_DASHBOARD_AUTH = 'admin:password';
    _resetTorchConfigCache();

    const server = await cmdDashboard(testPort);

    try {
      const res = await new Promise((resolve) => {
        http.get(`http://127.0.0.1:${testPort}/dashboard/`, resolve);
      });

      assert.strictEqual(res.statusCode, 401);
      assert.strictEqual(res.headers['www-authenticate'], 'Basic realm="TORCH Dashboard"');
    } finally {
      server.close();
      delete process.env.TORCH_DASHBOARD_AUTH;
      _resetTorchConfigCache();
    }
  });

  await t.test('returns 401 when malformed auth header is provided', async () => {
    process.env.TORCH_DASHBOARD_AUTH = 'admin:password';
    _resetTorchConfigCache();

    const server = await cmdDashboard(testPort);

    try {
      const res = await new Promise((resolve) => {
        http.get({
          host: '127.0.0.1',
          port: testPort,
          path: '/dashboard/',
          headers: { 'Authorization': 'Basic' }
        }, resolve);
      });

      assert.strictEqual(res.statusCode, 401);
    } finally {
      server.close();
      delete process.env.TORCH_DASHBOARD_AUTH;
      _resetTorchConfigCache();
    }
  });

  await t.test('returns 200 when valid credentials are provided', async () => {
    process.env.TORCH_DASHBOARD_AUTH = 'admin:password';
    _resetTorchConfigCache();

    const server = await cmdDashboard(testPort);

    try {
      const auth = Buffer.from('admin:password').toString('base64');
      const res = await new Promise((resolve) => {
        http.get({
          host: '127.0.0.1',
          port: testPort,
          path: '/dashboard/',
          headers: { 'Authorization': `Basic ${auth}` }
        }, resolve);
      });

      // We expect 200 (if dashboard/index.html exists) or 404 (if not), but not 401
      assert.notStrictEqual(res.statusCode, 401);
    } finally {
      server.close();
      delete process.env.TORCH_DASHBOARD_AUTH;
      _resetTorchConfigCache();
    }
  });

  await t.test('returns 200 when auth is disabled', async () => {
    delete process.env.TORCH_DASHBOARD_AUTH;
    _resetTorchConfigCache();

    const server = await cmdDashboard(testPort);

    try {
      const res = await new Promise((resolve) => {
        http.get(`http://127.0.0.1:${testPort}/dashboard/`, resolve);
      });

      assert.notStrictEqual(res.statusCode, 401);
    } finally {
      server.close();
      _resetTorchConfigCache();
    }
  });
});
