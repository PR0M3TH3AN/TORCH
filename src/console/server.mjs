import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { observeProject } from '../observability/snapshot.mjs';

const SITE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'site');
const ROUTES = new Map([
  ['/', 'index.html'], ['/index.html', 'index.html'], ['/styles.css', 'styles.css'],
  ['/app.js', 'app.js'], ['/console', 'console.html'], ['/console.html', 'console.html'],
  ['/console.js', 'console.js'],
]);
const TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'], ['.svg', 'image/svg+xml'],
]);

function respond(response, status, body, type = 'application/json; charset=utf-8') {
  response.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  });
  response.end(body);
}

export function createConsoleServer({ repositoryRoot = process.cwd(), env = process.env } = {}) {
  return createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://torch.local');
    if (request.method !== 'GET') {
      respond(response, 405, JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }));
      return;
    }
    if (url.pathname === '/api/snapshot') {
      try {
        respond(response, 200, `${JSON.stringify(observeProject({ repositoryRoot, env }))}\n`);
      } catch (error) {
        respond(response, 503, `${JSON.stringify({ error: error.code ?? 'OBSERVATION_FAILED', message: error.message })}\n`);
      }
      return;
    }
    const file = ROUTES.get(url.pathname);
    if (!file) {
      respond(response, 404, 'Not found\n', 'text/plain; charset=utf-8');
      return;
    }
    const path = join(SITE_ROOT, file);
    respond(response, 200, readFileSync(path), TYPES.get(extname(path)) ?? 'application/octet-stream');
  });
}

export function startConsole({ repositoryRoot = process.cwd(), env = process.env, host = '127.0.0.1', port = 4317 } = {}) {
  const server = createConsoleServer({ repositoryRoot, env });
  server.listen(port, host, () => {
    const address = server.address();
    process.stdout.write(`TORCH console: http://${host}:${address.port}/console\n`);
  });
  return server;
}
