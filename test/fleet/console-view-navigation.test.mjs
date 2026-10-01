import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { chromium } from '@playwright/test';
import { createConsoleServer } from '../../src/console/server.mjs';

const views = [
  ['overview', 'Overview'],
  ['owner-briefing', 'Briefing'],
  ['flow-watch', 'Flow watch'],
  ['work', 'Work'],
  ['initiative-progress', 'Progress'],
  ['fleet', 'Fleet'],
  ['communications', 'Conversations'],
  ['organization', 'Organization'],
  ['evidence', 'Evidence'],
  ['delivery', 'Release gates'],
];

async function openDemo(t, viewport) {
  const server = createConsoleServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let browser;
  t.after(async () => {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.clock.install({ time: new Date('2026-10-01T12:00:00.000Z') });
  await page.goto(`http://127.0.0.1:${server.address().port}/console?demo=1#work`);
  await page.locator('#live-refresh-status[data-generation="1"]').waitFor();
  return { page, context };
}

async function assertSelectedView(page, route, title) {
  const selected = await page.locator('.console-workspace > [data-console-view]:not([hidden])').evaluateAll((sections) =>
    [...new Set(sections.map((section) => section.dataset.consoleView))]);
  assert.deepEqual(selected, [route], `only the ${route} view should be visible`);
  assert.equal(await page.title(), `${title} | TORCH Local Fleet Console`);
  assert.equal(await page.locator(`.console-rail a[aria-current="page"][href="#${route}"]`).count(), 1);
  assert.equal(await page.locator('#project-name').isVisible(), true);
  assert.equal(await page.locator('#snapshot-time').isVisible(), true);
}

test('SCN-console-view-navigation: fragments, direct loads, Back and Forward select one addressable view', async (t) => {
  const { page } = await openDemo(t, { width: 1280, height: 900 });
  await assertSelectedView(page, 'work', 'Work');

  await page.locator('.console-rail a[href="#fleet"]').click();
  await assertSelectedView(page, 'fleet', 'Fleet');
  await page.locator('.console-rail a[href="#evidence"]').click();
  await assertSelectedView(page, 'evidence', 'Evidence');
  await page.goBack();
  await assertSelectedView(page, 'fleet', 'Fleet');
  await page.goForward();
  await assertSelectedView(page, 'evidence', 'Evidence');

  await page.goto(`http://127.0.0.1:${new URL(page.url()).port}/console?demo=1#approval-request-list`);
  await page.locator('#live-refresh-status[data-generation="1"]').waitFor();
  await assertSelectedView(page, 'flow-watch', 'Flow watch');
});

test('SCN-console-mobile-navigation: every destination is visible at 390x844 without horizontal hunting', async (t) => {
  const { page } = await openDemo(t, { width: 390, height: 844 });
  assert.equal(await page.locator('.console-rail a').count(), views.length);

  for (const [route, title] of views) {
    const link = page.locator(`.console-rail a[href="#${route}"]`);
    assert.equal(await link.isVisible(), true, `${title} navigation must remain visible`);
    await link.click();
    await assertSelectedView(page, route, title);
    const widths = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
      navigation: document.querySelector('.console-rail').scrollWidth,
      navigationClient: document.querySelector('.console-rail').clientWidth,
    }));
    assert.ok(widths.document <= widths.viewport, `document overflows horizontally: ${JSON.stringify(widths)}`);
    assert.ok(widths.navigation <= widths.navigationClient, `navigation requires horizontal scrolling: ${JSON.stringify(widths)}`);
  }
});

test('SCN-console-view-drafts: navigation and refresh retain unsent edits and the explicit owner preview boundary', async (t) => {
  const { page } = await openDemo(t, { width: 1280, height: 900 });
  const titleInput = page.locator('#task-create-form [name="title"]');
  await page.locator('.task-create-panel > summary').click();
  await titleInput.fill('Unsent route-change draft');
  await page.locator('.console-rail a[href="#flow-watch"]').click();
  const approval = page.locator('.approval-decision-form').first();
  await approval.locator('[name="decision"]').selectOption('approved');
  await approval.locator('[name="note"]').fill('Review remains explicit after navigation.');
  await approval.locator('[data-approval-preview]').click();
  await approval.locator('[data-approval-confirm]:visible').waitFor();
  const previewToken = await approval.getAttribute('data-preview-token');

  await page.locator('.console-rail a[href="#work"]').click();
  await page.locator('#refresh-console').click();
  await page.locator('#live-refresh-status[data-generation="2"]').waitFor();
  assert.equal(await titleInput.inputValue(), 'Unsent route-change draft');

  await page.locator('.console-rail a[href="#flow-watch"]').click();
  assert.equal(await approval.getAttribute('data-preview-token'), previewToken);
  assert.equal(await approval.locator('[data-approval-confirm]').isVisible(), true);
  assert.equal(await approval.locator('[name="decision"]').isDisabled(), true);
  assert.equal(await approval.locator('[data-approval-edit]').isVisible(), true);
  assert.match(await approval.locator('.approval-decision-status').innerText(), /bound to this request revision/);
  assert.equal(await page.locator('#approval-request-count').innerText(), '1 open');
});
