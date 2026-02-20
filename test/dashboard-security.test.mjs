
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { cmdDashboard } from '../src/dashboard.mjs';

test('Dashboard File Access Security', async (t) => {
  let testPort = 0;
  let server;

  t.beforeEach(async () => {
    server = await cmdDashboard(0);
    testPort = server.address().port;
  });

  t.afterEach((done) => {
    if (server) server.close(done);
    else done();
  });

  function get(path) {
    return new Promise((resolve) => {
      http.get({
        host: '127.0.0.1',
        port: testPort,
        path: path
      }, (res) => {
        // Consume data to avoid memory leaks
        res.resume();
        resolve(res);
      });
    });
  }

  await t.test('allows access to dashboard assets', async () => {
    const res = await get('/dashboard/index.html');
    assert.strictEqual(res.statusCode, 200);
  });

  await t.test('allows access to global assets', async () => {
    // assuming favicon.svg exists
    const res = await get('/assets/favicon.svg');
    assert.strictEqual(res.statusCode, 200);
  });

  await t.test('allows access to landing page', async () => {
    const res = await get('/landing/index.html');
    assert.strictEqual(res.statusCode, 200);
  });

  await t.test('blocks access to package.json', async () => {
    const res = await get('/package.json');
    assert.strictEqual(res.statusCode, 403);
  });

  await t.test('blocks access to src/dashboard.mjs', async () => {
    const res = await get('/src/dashboard.mjs');
    assert.strictEqual(res.statusCode, 403);
  });

  await t.test('blocks access to random root files', async () => {
    const res = await get('/README.md');
    assert.strictEqual(res.statusCode, 403);
  });

  await t.test('allows access to torch-config.json via special handler', async () => {
    const res = await get('/torch-config.json');
    // It exists in root, so it should return 200
    assert.strictEqual(res.statusCode, 200);
  });

  await t.test('blocks directory traversal attempts', async () => {
    const res = await get('/dashboard/../../package.json');
    // path.normalize collapses this to /package.json, which is then blocked
    assert.strictEqual(res.statusCode, 403);
  });

  await t.test('responses include security headers', async () => {
    const res = await get('/dashboard/index.html');
    assert.strictEqual(res.statusCode, 200);

    const headers = res.headers;

    // Content-Security-Policy
    assert.ok(headers['content-security-policy'], 'CSP header missing');
    const csp = headers['content-security-policy'];
    assert.match(csp, /default-src 'self'/, 'CSP: missing default-src self');
    assert.match(csp, /script-src 'self' https:\/\/cdn\.jsdelivr\.net/, 'CSP: missing script-src');
    assert.match(csp, /object-src 'none'/, 'CSP: missing object-src none');

    // X-Content-Type-Options
    assert.strictEqual(headers['x-content-type-options'], 'nosniff', 'X-Content-Type-Options mismatch');

    // X-Frame-Options
    assert.strictEqual(headers['x-frame-options'], 'DENY', 'X-Frame-Options mismatch');

    // Referrer-Policy
    assert.strictEqual(headers['referrer-policy'], 'strict-origin-when-cross-origin', 'Referrer-Policy mismatch');
  });

  await t.test('error responses include security headers', async () => {
    const res = await get('/dashboard/nonexistent.html');
    assert.strictEqual(res.statusCode, 404);

    const headers = res.headers;
    assert.strictEqual(headers['x-content-type-options'], 'nosniff');
    assert.strictEqual(headers['x-frame-options'], 'DENY');
  });
});
