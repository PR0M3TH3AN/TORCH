import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { cmdDashboard } from '../src/dashboard.mjs';
import { _resetTorchConfigCache } from '../src/torch-config.mjs';

test('Dashboard Authentication', async (t) => {
  let testPort = 0;
  let server;

  t.beforeEach(async () => {
    // We don't start server here because some tests need env vars set BEFORE starting
  });

  t.afterEach((done) => {
    if (server) server.close(done);
    else done();
    server = null;
  });

  await t.test('returns 401 when auth is required but missing', async () => {
    process.env.TORCH_DASHBOARD_AUTH = 'admin:password';
    _resetTorchConfigCache();

    server = await cmdDashboard(0);
    testPort = server.address().port;

    try {
      const res = await new Promise((resolve) => {
        http.get(`http://127.0.0.1:${testPort}/dashboard/`, resolve);
      });

      assert.strictEqual(res.statusCode, 401);
      assert.strictEqual(res.headers['www-authenticate'], 'Basic realm="TORCH Dashboard"');
    } finally {
      delete process.env.TORCH_DASHBOARD_AUTH;
      _resetTorchConfigCache();
    }
  });

  await t.test('returns 401 when malformed auth header is provided', async () => {
    process.env.TORCH_DASHBOARD_AUTH = 'admin:password';
    _resetTorchConfigCache();

    server = await cmdDashboard(0);
    testPort = server.address().port;

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
      delete process.env.TORCH_DASHBOARD_AUTH;
      _resetTorchConfigCache();
    }
  });

  await t.test('returns 200 when valid credentials are provided', async () => {
    process.env.TORCH_DASHBOARD_AUTH = 'admin:password';
    _resetTorchConfigCache();

    server = await cmdDashboard(0);
    testPort = server.address().port;

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
      delete process.env.TORCH_DASHBOARD_AUTH;
      _resetTorchConfigCache();
    }
  });

  await t.test('returns 200 when auth is disabled', async () => {
    delete process.env.TORCH_DASHBOARD_AUTH;
    _resetTorchConfigCache();

    server = await cmdDashboard(0);
    testPort = server.address().port;

    try {
      const res = await new Promise((resolve) => {
        http.get(`http://127.0.0.1:${testPort}/dashboard/`, resolve);
      });

      assert.notStrictEqual(res.statusCode, 401);
    } finally {
      _resetTorchConfigCache();
    }
  });
});
