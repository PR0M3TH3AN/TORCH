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
  assert.equal(await page.title(), route === 'overview' ? 'TORCH Dashboard' : `${title} | TORCH Local Fleet Console`);
  assert.equal(await page.locator(`.console-rail a[aria-current="page"][href="#${route}"]`).count(), 1);
  assert.equal(await page.locator('#project-name').isVisible(), true);
  assert.equal(await page.locator('#snapshot-time').isVisible(), true);
}

test('SCN-console-view-title-mapping: Overview retains its dashboard title while other selected views stay contextual', async (t) => {
  const { page } = await openDemo(t, { width: 1280, height: 900 });
  const base = `http://127.0.0.1:${new URL(page.url()).port}/console?demo=1`;
  await page.goto(`${base}#overview`);
  await page.locator('#live-refresh-status[data-generation="1"]').waitFor();
  await assertSelectedView(page, 'overview', 'Overview');

  for (const [route, title] of views.filter(([route]) => route !== 'overview')) {
    await page.locator(`.console-rail a[href="#${route}"]`).click();
    await assertSelectedView(page, route, title);
  }
  await page.locator('.console-rail a[href="#overview"]').click();
  await assertSelectedView(page, 'overview', 'Overview');
});

test('SCN-console-secondary-deeplink-focus-and-history: direct fragments and history land on the actual target', async (t) => {
  const { page } = await openDemo(t, { width: 390, height: 844 });
  const base = `http://127.0.0.1:${new URL(page.url()).port}/console?demo=1`;
  const assertTarget = async (id, route, title) => {
    await assertSelectedView(page, route, title);
    const state = await page.locator(`#${id}`).evaluate((target) => {
      const bounds = target.getBoundingClientRect();
      return {
        activeId: document.activeElement?.id,
        top: bounds.top,
        bottom: bounds.bottom,
        height: innerHeight,
      };
    });
    assert.equal(state.activeId, id, `the ${id} target must receive focus`);
    assert.ok(state.top < state.height && state.bottom > 0, `${id} must intersect the viewport: ${JSON.stringify(state)}`);
  };

  await page.goto(`${base}#organization-proposals`);
  await page.locator('#live-refresh-status[data-generation="1"]').waitFor();
  await assertTarget('organization-proposals', 'organization', 'Organization');
  await page.goto(`${base}#approval-request-list`);
  await page.locator('#live-refresh-status[data-generation="1"]').waitFor();
  await assertTarget('approval-request-list', 'flow-watch', 'Flow watch');
  await page.goBack();
  await assertTarget('organization-proposals', 'organization', 'Organization');
  await page.goForward();
  await assertTarget('approval-request-list', 'flow-watch', 'Flow watch');
});

test('SCN-console-priority-preview-invalidates-on-newer-evidence: refresh preserves editable drafts and rejects the old preview', async (t) => {
  const { page } = await openDemo(t, { width: 1280, height: 900 });
  const form = page.locator('.priority-change-form[data-task-id="API-08"]');
  const ticket = form.locator('xpath=../..');
  await ticket.locator('.priority-change > summary').click();
  await form.locator('[name="priority"]').selectOption('urgent');
  await form.locator('[name="reason"]').fill('Preserve this unsent explanation across a newer task revision.');
  await form.getByRole('button', { name: 'Review change', exact: true }).click();
  await form.locator('[data-priority-confirm]').waitFor();
  const revisionN = Number(await form.getAttribute('data-revision'));
  const staleToken = await form.getAttribute('data-preview-token');
  assert.equal(await form.locator('[data-priority-preview] dd').nth(2).innerText(), String(revisionN));

  const revisionN1 = await page.evaluate(async (expectedRevision) => {
    const path = '/api/backlog/tasks/API-08/priority';
    const change = { priority: 'low', reason: 'Separate normal sample API action advances authoritative evidence.', expectedRevision };
    const preview = await globalThis.TorchConsoleDemo.request(`${path}/preview`, change);
    const applied = await globalThis.TorchConsoleDemo.request(path, { ...change, token: preview.token, planHash: preview.planHash });
    return applied.task.revision;
  }, revisionN);
  assert.equal(revisionN1, revisionN + 1);

  await page.locator('#refresh-console').click();
  await page.locator('#live-refresh-status[data-generation="2"]').waitFor();
  assert.equal(Number(await form.getAttribute('data-revision')), revisionN1);
  assert.equal(await ticket.locator('.priority').textContent(), 'low');
  assert.equal(await form.getAttribute('data-preview-token'), null);
  assert.equal(await form.locator('[data-priority-preview]').isVisible(), false);
  assert.equal(await form.locator('[data-priority-confirm]').count(), 0);
  assert.equal(await form.locator('[name="priority"]').inputValue(), 'urgent');
  assert.equal(await form.locator('[name="reason"]').inputValue(), 'Preserve this unsent explanation across a newer task revision.');
  assert.equal(await form.locator('[name="priority"]').isDisabled(), false);
  assert.equal(await form.locator('[name="reason"]').isDisabled(), false);
  assert.match(await form.locator('.priority-change-status').innerText(), new RegExp(`revision ${revisionN1}`));

  await page.locator('.console-rail a[href="#overview"]').click();
  await page.locator('.console-rail a[href="#work"]').click();
  await page.locator('#refresh-console').click();
  await page.locator('#live-refresh-status[data-generation="3"]').waitFor();
  const preservedForm = page.locator('.priority-change-form[data-task-id="API-08"]');
  const preservedTicket = preservedForm.locator('xpath=../..');
  assert.equal(Number(await preservedForm.getAttribute('data-revision')), revisionN1);
  assert.equal(await preservedTicket.locator('.priority').textContent(), 'low');
  assert.equal(await preservedForm.getAttribute('data-preview-token'), null);
  assert.equal(await preservedForm.locator('[data-priority-preview]').isVisible(), false);
  assert.equal(await preservedForm.locator('[data-priority-confirm]').count(), 0);
  assert.equal(await preservedForm.locator('[name="priority"]').inputValue(), 'urgent');
  assert.equal(await preservedForm.locator('[name="reason"]').inputValue(), 'Preserve this unsent explanation across a newer task revision.');
  assert.equal(await preservedForm.locator('[name="priority"]').isDisabled(), false);
  assert.equal(await preservedForm.locator('[name="reason"]').isDisabled(), false);

  await preservedForm.getByRole('button', { name: 'Review change', exact: true }).click();
  await preservedForm.locator('[data-priority-confirm]').waitFor();
  const currentToken = await preservedForm.getAttribute('data-preview-token');
  assert.notEqual(currentToken, staleToken);
  assert.equal(await preservedForm.locator('[data-priority-preview] dd').nth(2).innerText(), String(revisionN1));
  await page.locator('#refresh-console').click();
  await page.locator('#live-refresh-status[data-generation="4"]').waitFor();
  const currentForm = page.locator('.priority-change-form[data-task-id="API-08"]');
  assert.equal(await currentForm.getAttribute('data-preview-token'), currentToken);
  assert.equal(await currentForm.locator('[data-priority-preview]').isVisible(), true);
  assert.equal(await currentForm.locator('[data-priority-confirm]').isVisible(), true);
  assert.equal(await currentForm.locator('[name="priority"]').inputValue(), 'urgent');
  assert.equal(await currentForm.locator('[name="reason"]').inputValue(), 'Preserve this unsent explanation across a newer task revision.');
});

test('SCN-console-current-preview-and-draft-survive-unchanged-refresh: a current preview and its fields remain intact', async (t) => {
  const { page } = await openDemo(t, { width: 1280, height: 900 });
  const form = page.locator('.priority-change-form[data-task-id="API-08"]');
  const ticket = form.locator('xpath=../..');
  await ticket.locator('.priority-change > summary').click();
  await form.locator('[name="priority"]').selectOption('urgent');
  await form.locator('[name="reason"]').fill('Keep this current unsent explanation after an unchanged refresh.');
  await form.getByRole('button', { name: 'Review change', exact: true }).click();
  await form.locator('[data-priority-confirm]').waitFor();
  const revision = await form.getAttribute('data-revision');
  const token = await form.getAttribute('data-preview-token');

  await page.locator('#refresh-console').click();
  await page.locator('#live-refresh-status[data-generation="2"]').waitFor();
  assert.equal(await form.getAttribute('data-revision'), revision);
  assert.equal(await form.getAttribute('data-preview-token'), token);
  assert.equal(await form.locator('[data-priority-preview]').isVisible(), true);
  assert.equal(await form.locator('[data-priority-confirm]').isVisible(), true);
  assert.equal(await form.locator('[name="priority"]').inputValue(), 'urgent');
  assert.equal(await form.locator('[name="reason"]').inputValue(), 'Keep this current unsent explanation after an unchanged refresh.');
});

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
