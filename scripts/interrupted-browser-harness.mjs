import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const token = randomUUID();
let browserServer;
let page;
let finish;
const stopped = new Promise((resolve) => { finish = resolve; });
const server = createServer(async (request, response) => {
  try {
    if (request.url === '/' && request.method === 'GET') {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end(readFileSync(join(process.cwd(), 'dist', 'index.html')));
    } else if (request.url === '/status' && page) {
      const observed = await page.evaluate(() => ({ build: document.querySelector('[data-build]').dataset.build,
        commit: document.querySelector('[data-commit]').dataset.commit, visible: document.visibilityState === 'visible' }));
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(observed));
    } else if (request.url === '/stop' && request.method === 'POST' && request.headers['x-fixture-token'] === token) {
      const processHandle = browserServer.process();
      const exited = once(processHandle, 'exit');
      await browserServer.close();
      await exited;
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ stopped: true }));
      server.close(finish);
    } else response.writeHead(404).end();
  } catch (error) { response.writeHead(500).end(JSON.stringify({ error: error.message })); }
});
try {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  browserServer = await chromium.launchServer({ headless: true });
  const browser = await chromium.connect(browserServer.wsEndpoint());
  page = await browser.newPage();
  await page.route('**/*', (route) => route.request().url().startsWith(`${base}/`) ? route.continue() : route.abort());
  await page.goto(base);
  const commit = await page.locator('[data-commit]').getAttribute('data-commit');
  assert.equal(commit, process.env.TORCH_CHECK_COMMIT);
  const browserPid = browserServer.process().pid;
  const stat = readFileSync(`/proc/${browserPid}/stat`, 'utf8');
  const browserStart = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)[19];
  const executorStat = readFileSync(`/proc/${process.pid}/stat`, 'utf8');
  const executorStart = executorStat.slice(executorStat.lastIndexOf(')') + 2).trim().split(/\s+/)[19];
  console.log(JSON.stringify({ event: 'browser-ready', executorPid: process.pid, executorStart, browserPid, browserStart, base, token }));
  await stopped;
} finally {
  await browserServer?.close();
  if (server.listening) await new Promise((resolve) => server.close(resolve));
}
