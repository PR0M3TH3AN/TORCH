import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { cmdDashboard } from '../src/dashboard.mjs';

test('Dashboard Upload Security', async (t) => {
  let server;
  let testPort;

  t.beforeEach(async () => {
    // Start server on a random port (0 lets OS choose)
    server = await cmdDashboard(0);
    testPort = server.address().port;
  });

  t.afterEach((done) => {
    if (server) {
      server.close(done);
    } else {
      done();
    }
  });

  function post(path, body = '', headers = {}) {
    return new Promise((resolve, reject) => {
      const options = {
        host: '127.0.0.1',
        port: testPort,
        path: path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
          ...headers,
        },
      };

      const req = http.request(options, (res) => {
        // Consume response data to free up memory
        res.resume();
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
        });
      });

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  await t.test('POST /upload returns 403 (Forbidden) - not in allowlist', async () => {
    const res = await post('/upload', 'dummy data');
    assert.strictEqual(res.statusCode, 403);
  });

  await t.test('POST /api/upload returns 403 (Forbidden) - not in allowlist', async () => {
    const res = await post('/api/upload', 'dummy data');
    assert.strictEqual(res.statusCode, 403);
  });

  await t.test('POST /dashboard/upload returns 404 (Not Found) - allowed path but file missing', async () => {
    const res = await post('/dashboard/upload', 'dummy data');
    assert.strictEqual(res.statusCode, 404);
  });

  await t.test('POST /content returns 403 (Forbidden) - not in allowlist', async () => {
    const res = await post('/content', 'dummy data');
    assert.strictEqual(res.statusCode, 403);
  });

  await t.test('POST / returns 302 (Redirect)', async () => {
    // The server redirects / to /dashboard/ regardless of method
    const res = await post('/', 'dummy data');
    assert.strictEqual(res.statusCode, 302);
    assert.strictEqual(res.headers.location, '/dashboard/');
  });

  await t.test('POST with multipart/form-data returns 403', async () => {
    const boundary = '--------------------------367946266497677346366835';
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="test.txt"',
      'Content-Type: text/plain',
      '',
      'This is a test file content.',
      `--${boundary}--`,
      ''
    ].join('\r\n');

    const res = await post('/upload', body, {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    });

    assert.strictEqual(res.statusCode, 403);
  });

  await t.test('POST /torch-config.json (readonly endpoint) returns 200 but ignores body', async () => {
      // The handler for /torch-config.json does not check method, so it returns 200 with the config.
      // This confirms no upload/write logic exists there.
      const res = await post('/torch-config.json', '{"malicious":"config"}');
      assert.strictEqual(res.statusCode, 200);
  });
});
