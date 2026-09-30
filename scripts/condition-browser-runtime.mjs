import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

// Explicit qualification service: one page survives all probe/measurement
// commands. It is not a provider, launcher, or installed TORCH service.
let subject;
let page;
let browser;
let measurements = 0;
let mode;
const server = createServer(async (request, response) => {
  try {
    if (request.url === '/page' && subject) {
      response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
      response.end(readFileSync(join(subject.root, 'dist', 'index.html')));
      return;
    }
    if (!page) { response.writeHead(503).end(); return; }
    let result;
    if (request.url === '/probe' && request.method === 'GET') {
      const observed = await page.evaluate(async () => {
        const before = window.simulationClock;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return {
          commit: document.querySelector('[data-commit]').dataset.commit,
          runtimeId: window.runtimeId,
          conditions: { 'clock-moving': window.simulationClock > before,
            visible: document.visibilityState === 'visible',
            build: document.querySelector('[data-build]').dataset.build },
        };
      });
      result = { schema: 'torch.dev/check-conditions/v1alpha1',
        subject: { commit: observed.commit, inputDigest: subject.inputDigest },
        runtimeId: observed.runtimeId, conditions: observed.conditions };
    } else if (request.url === '/measure' && request.method === 'POST') {
      measurements += 1;
      result = await page.evaluate((freeze) => {
        if (freeze) window.clockFrozen = true;
        return { measurement: 'green', runtimeId: window.runtimeId };
      }, mode === 'drift');
      if (mode === 'replaced') await page.reload();
    } else if (request.url === '/status' && request.method === 'GET') {
      result = { measurements, runtimeId: await page.evaluate(() => window.runtimeId) };
    } else { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(result));
  } catch (error) {
    response.writeHead(500).end(JSON.stringify({ error: error.message }));
  }
});

async function close() {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}

process.on('message', async (message) => {
  try {
    if (message.action === 'load') {
      subject = message.subject;
      mode = message.mode;
      browser = await chromium.launch({ headless: true });
      page = await browser.newPage();
      const base = `http://127.0.0.1:${server.address().port}`;
      await page.route('**/*', (route) => route.request().url().startsWith(`${base}/`)
        ? route.continue() : route.abort());
      await page.goto(`${base}/page`);
      if (mode === 'frozen') await page.evaluate(() => { window.clockFrozen = true; });
      process.send({ event: 'loaded', runtimeId: await page.evaluate(() => window.runtimeId) });
    } else if (message.action === 'close') {
      await close();
      process.disconnect();
    }
  } catch (error) {
    process.send({ event: 'error', message: error.message });
    await close();
    process.exitCode = 1;
    process.disconnect();
  }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
process.send({ event: 'listening', base: `http://127.0.0.1:${server.address().port}` });
