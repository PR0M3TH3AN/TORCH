
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { cmdDashboard } from '../src/dashboard.mjs';

test('Dashboard File Access Security', async (t) => {
  const testPort = 4175;
  let server;

  t.beforeEach(async () => {
    server = await cmdDashboard(testPort);
  });

  t.afterEach(() => {
    if (server) server.close();
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
});
