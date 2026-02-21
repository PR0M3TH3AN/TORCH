import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import crypto from 'node:crypto';
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

  await t.test('returns 401 when password has different byte length than stored credential', async () => {
    // Regression test for timingSafeCompare: previously the comparison result
    // was discarded and `false` was returned unconditionally for unequal-length
    // inputs, making the timing-safe branch dead code. Verify that a prefix of
    // the correct password (shorter) and an extended version (longer) are both
    // rejected.
    process.env.TORCH_DASHBOARD_AUTH = 'admin:secret';
    _resetTorchConfigCache();

    server = await cmdDashboard(0);
    testPort = server.address().port;

    try {
      const makeRequest = (credentials) => {
        const auth = Buffer.from(credentials).toString('base64');
        return new Promise((resolve) => {
          http.get({
            host: '127.0.0.1',
            port: testPort,
            path: '/dashboard/',
            headers: { 'Authorization': `Basic ${auth}` }
          }, resolve);
        });
      };

      // Shorter than correct password — different byte length
      const resShorter = await makeRequest('admin:secre');
      assert.strictEqual(resShorter.statusCode, 401, 'shorter password must be rejected');

      // Longer than correct password — different byte length
      const resLonger = await makeRequest('admin:secret_extra');
      assert.strictEqual(resLonger.statusCode, 401, 'longer password must be rejected');

      // Correct credentials still work
      const resCorrect = await makeRequest('admin:secret');
      assert.notStrictEqual(resCorrect.statusCode, 401, 'correct credentials must not be rejected');
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

  await t.test('validates correctly using scrypt hashed credentials', async () => {
    // Generate a valid scrypt hash
    const password = 'admin:hashedpassword';
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(password, salt, 64);
    const storedAuth = `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;

    process.env.TORCH_DASHBOARD_AUTH = storedAuth;
    _resetTorchConfigCache();

    server = await cmdDashboard(0);
    testPort = server.address().port;

    try {
      const makeRequest = (credentials) => {
        const auth = Buffer.from(credentials).toString('base64');
        return new Promise((resolve) => {
          http.get({
            host: '127.0.0.1',
            port: testPort,
            path: '/dashboard/',
            headers: { 'Authorization': `Basic ${auth}` }
          }, resolve);
        });
      };

      // Correct password
      const resCorrect = await makeRequest(password);
      assert.notStrictEqual(resCorrect.statusCode, 401, 'correct hashed credentials must not be rejected');

      // Incorrect password
      const resIncorrect = await makeRequest('admin:wrong');
      assert.strictEqual(resIncorrect.statusCode, 401, 'incorrect hashed credentials must be rejected');
    } finally {
      delete process.env.TORCH_DASHBOARD_AUTH;
      _resetTorchConfigCache();
    }
  });
});
