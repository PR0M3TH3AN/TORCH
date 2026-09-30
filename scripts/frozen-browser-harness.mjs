import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

// Qualification harness, not a bundled product dependency. Run from the captured
// input root; module dependencies resolve from this explicitly configured harness.
const expectedBuild = process.argv[2];
assert.ok(expectedBuild, 'Expected build must be declared by the scenario');
const root = process.cwd();
const server = createServer((request, response) => {
  if (request.url !== '/') {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
  response.end(readFileSync(join(root, 'dist', 'index.html')));
});
let browser;
try {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) => route.request().url().startsWith(`${base}/`)
    ? route.continue() : route.abort());
  await page.goto(base);
  const observation = await page.evaluate(async () => {
    const before = performance.now();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {
      build: document.querySelector('[data-build]').dataset.build,
      commit: document.querySelector('[data-commit]').dataset.commit,
      visible: document.visibilityState === 'visible',
      browserClockMoving: performance.now() > before,
    };
  });
  assert.deepEqual(errors, []);
  assert.equal(observation.build, expectedBuild);
  assert.equal(observation.commit, process.env.TORCH_CHECK_COMMIT);
  assert.equal(observation.visible, true);
  assert.equal(observation.browserClockMoving, true);
  assert.match(process.env.TORCH_CHECK_INPUT_DIGEST, /^[a-f0-9]{64}$/);
  console.log(JSON.stringify({ ...observation, inputDigest: process.env.TORCH_CHECK_INPUT_DIGEST }));
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
