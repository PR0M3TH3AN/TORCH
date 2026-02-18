
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { cmdDashboard } from '../src/dashboard.mjs';

test('Dashboard Path Traversal Security Fix', async (t) => {
  let testPort = 0;
  let server;

  t.beforeEach(async () => {
    // Start dashboard on random port
    server = await cmdDashboard(0);
    testPort = server.address().port;
  });

  t.afterEach((done) => {
    if (server) server.close(done);
    else done();
  });

  function get(path) {
    return new Promise((resolve, reject) => {
      const req = http.get({
        host: '127.0.0.1',
        port: testPort,
        path: path
      }, (res) => {
        // Consume data to avoid memory leaks
        res.resume();
        resolve(res);
      });
      req.on('error', reject);
    });
  }

  // --- Valid Access ---
  await t.test('allows access to valid dashboard index', async () => {
    const res = await get('/dashboard/index.html');
    assert.strictEqual(res.statusCode, 200, 'Should allow access to dashboard index');
  });

  // --- Traversal Attempts ---
  const traversalPayloads = [
    '/../../etc/passwd',
    '/dashboard/../../etc/passwd',
    '/dashboard/../../../etc/passwd',
    '/../package.json',
    '/dashboard/../package.json',
    '/dashboard/%2e%2e/package.json', // URL Encoded ..
    '/dashboard/%2e%2e%2fpackage.json', // URL Encoded ../
    '/..%2fpackage.json',
    '/%2e%2e%2fpackage.json',
    '/dashboard/..%5cpackage.json', // Encoded backslash
    '/dashboard/..%252fpackage.json', // Double encoded
    '/dashboard/....//package.json', // Weird dots
    '/dashboard/.../package.json', // Three dots
    '//etc/passwd', // Double slash
    '/dashboard//../../etc/passwd',
  ];

  for (const payload of traversalPayloads) {
    await t.test(`blocks traversal attempt: ${payload}`, async () => {
      const res = await get(payload);
      // Depending on how it's resolved, it might be 403 (Forbidden) or 404 (Not Found)
      // If it escapes allowed paths, it should be 403.
      // If it stays within allowed paths but file doesn't exist, 404.
      // But we want to ensure it doesn't return 200 for sensitive files if they existed.
      // Since we don't know if /etc/passwd exists on test environment, we assume 403 or 404 is safe.
      // However, for package.json (which exists in root), it MUST be 403 because it's not in allowed paths.

      // If the payload targets a file outside allowed paths (like package.json), it MUST be 403.
      // If the payload targets a file that doesn't exist but is outside allowed paths, it MUST be 403.

      // The current logic returns 403 if not in allowedPaths.
      assert.notStrictEqual(res.statusCode, 200, `Should not return 200 for ${payload}`);

      // If it targets package.json, we expect 403 because it exists but is restricted.
      // EXCEPTION: If the payload uses encoded slashes (%2f) that are NOT decoded by URL parser,
      // it is treated as a filename, not a separator. Thus it looks for a file with %2f in name,
      // which doesn't exist -> 404. This is SAFE.
      // So for package.json payloads, we accept 403 (blocked traversal) or 404 (failed traversal/not found).
      if (payload.includes('package.json')) {
        assert.ok([403, 404].includes(res.statusCode), `Should return 403 or 404 for ${payload}, got ${res.statusCode}`);
      }
    });
  }

  // --- Allowed Traversal (within allowed scope) ---
  await t.test('allows traversal within allowed paths', async () => {
    // /dashboard/../dashboard/index.html -> /dashboard/index.html (Allowed)
    const res = await get('/dashboard/../dashboard/index.html');
    assert.strictEqual(res.statusCode, 200, 'Should allow traversal that stays within allowed paths');
  });
});
