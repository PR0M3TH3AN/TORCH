import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { createConsoleServer } from '../src/console/server.mjs';
import { createDashboardArtifactDirectory, describeDashboardArtifacts, prepareDashboardArtifactTargets } from './dashboard-artifacts.mjs';

const screenshotNames = [
  'torch-dashboard-operation-outcomes.png', 'torch-dashboard-activity-review.png',
  'torch-dashboard-check-evidence.png', 'torch-dashboard-owner-briefing-desktop.png',
  'torch-dashboard-pilot-conclusion.png', 'torch-dashboard-pilot-review.png',
  'torch-dashboard-manager-wakes.png', 'torch-dashboard-demo-desktop.png',
  'torch-dashboard-demo-mobile.png', 'torch-dashboard-owner-briefing-mobile.png',
  'torch-dashboard-live-refresh.png',
];
const artifacts = createDashboardArtifactDirectory({
  repositoryRoot: fileURLToPath(new URL('..', import.meta.url)),
});
const screenshotPaths = prepareDashboardArtifactTargets(artifacts, screenshotNames);
function screenshotPath(name) {
  return screenshotPaths[name];
}

async function selectView(page, view) {
  const link = page.locator(`.console-rail a[href="#${view}"]`);
  assert.equal(await link.count(), 1, `the ${view} view must have one supported fragment link`);
  if (await link.getAttribute('aria-current') !== 'page') await link.click();
  await page.locator(`.console-workspace > [data-console-view="${view}"]`).waitFor({ state: 'visible' });
}

async function selectViewFor(page, selector) {
  const view = await page.locator(selector).first().evaluate((element) =>
    element.closest('[data-console-view]')?.dataset.consoleView);
  assert.ok(view, `${selector} must belong to a fragment-addressable view`);
  await selectView(page, view);
}

const server = createConsoleServer();
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = 'http://127.0.0.1:' + server.address().port;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const apiRequests = [];
  const errors = [];
  await context.route('**/api/**', (route) => {
    apiRequests.push(route.request().url());
    return route.abort();
  });
  context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
  const landing = await context.newPage();
  await landing.goto(base);
  const popup = context.waitForEvent('page');
  await landing.getByRole('link', { name: 'View dashboard demo', exact: true }).click();
  const page = await popup;
  await page.waitForLoadState();
  await page.locator('#project-name').filter({ hasText: 'Northstar' }).waitFor();
  assert.equal(await page.title(), 'TORCH Dashboard');
  await selectView(page, 'work');
  assert.equal(await page.locator('.agent-row').count(), 6);
  assert.equal(await page.locator('.task-ticket').count(), 5);
  assert.equal(await page.getByRole('region', { name: 'Queue', exact: true }).locator('.task-ticket').count(), 2);
  assert.equal(await page.locator('#demo-banner').isVisible(), true);
  await selectViewFor(page, '#operation-outcomes');
  assert.match(await page.locator('#operation-outcomes').innerText(), /Outcome unknown — review required/);
  assert.equal(await page.locator('#operation-outcomes button').count(), 0);
  await page.locator('#operation-outcomes .check-evidence').last().locator('summary').click();
  assert.match(await page.locator('#operation-outcomes').innerText(), /transient failure.*effects unknown/s);
  await selectViewFor(page, '#operation-outcomes');
  await page.locator('#operation-outcomes').screenshot({ path: screenshotPath('torch-dashboard-operation-outcomes.png') });
  await selectViewFor(page, '#activity-review');
  await page.locator('#activity-review > summary').click();
  assert.match(await page.locator('#activity-review').innerText(), /4 days without a named commit/);
  assert.match(await page.locator('#activity-review').innerText(), /waiting may be expected/);
  await selectViewFor(page, '#activity-review');
  await page.locator('#activity-review').screenshot({ path: screenshotPath('torch-dashboard-activity-review.png') });
  await selectViewFor(page, '#check-list');
  assert.match(await page.locator('#check-list').innerText(), /Running — completion unconfirmed/);
  await page.locator('#check-list .check-evidence').filter({ hasText: 'interrupted-browser' }).locator('summary').click();
  assert.match(await page.locator('#check-list').innerText(), /Abandoned — not qualified/);
  assert.match(await page.locator('#check-list').innerText(), /Captured-input cleanup pending/);
  assert.match(await page.locator('#check-list').innerText(), /owner-attested, not independently verified/);
  assert.equal(await page.locator('#check-list button').count(), 0);
  await page.locator('#check-list .check-evidence').filter({ hasText: 'recovery-scenario' }).locator('summary').click();
  assert.match(await page.locator('#check-list').innerText(), /clockMoving.*true/s);
  assert.match(await page.locator('#check-list').innerText(), /not independent sensor truth/);
  await selectViewFor(page, '#check-list');
  await page.locator('#check-list').screenshot({ path: screenshotPath('torch-dashboard-check-evidence.png') });
  await selectViewFor(page, '#owner-briefing');
  assert.match(await page.locator('#owner-briefing').innerText(), /Choose the project home layout/);
  assert.match(await page.locator('#owner-briefing').innerText(), /not independent live verification/);
  await page.locator('#owner-briefing .briefing-detail').first().locator('summary').click();
  assert.match(await page.locator('#owner-briefing').innerText(), /Landed — not necessarily deployed/);
  await selectViewFor(page, '#owner-briefing');
  await page.locator('#owner-briefing').screenshot({ path: screenshotPath('torch-dashboard-owner-briefing-desktop.png') });
  await selectViewFor(page, '#attention-list');
  assert.match(await page.locator('#attention-list').innerText(), /manager launch needs inspection/);
  await page.locator('#attention-list a[href="#manager-wakes"]').click();
  assert.equal(await page.locator('#manager-wakes').isVisible(), true);
  assert.match(await page.locator('#manager-wake-list').innerText(), /Launch outcome unknown/);
  assert.match(await page.locator('#manager-wake-list').innerText(), /sample-wake-01/);
  assert.equal(await page.locator('#manager-wake-list button').count(), 0,
    'uncertain launches must not offer automatic restart or unlocking');
  const pilotPanel = page.locator('.organization-proposal').filter({ hasText: 'Coordination pilot' }).locator('.pilot-review-history');
  await selectViewFor(page, '.organization-proposal');
  await pilotPanel.locator(':scope > summary').click();
  assert.match(await pilotPanel.innerText(), /Recommendation: inconclusive/);
  assert.match(await pilotPanel.innerText(), /reviewer-reported, not independently verified/);
  const comparison = pilotPanel.getByRole('table', { name: 'Baseline compared with pilot observations' });
  assert.equal(await comparison.locator('tbody td').nth(0).innerText(), '3');
  assert.equal(await comparison.locator('tbody td').nth(1).innerText(), 'About 2');
  assert.equal(await comparison.locator('tbody td').nth(2).innerText(), 'qualitative');
  await pilotPanel.getByText('Criterion outcomes and evidence references', { exact: true }).click();
  assert.match(await pilotPanel.innerText(), /Reduce cross-domain waiting.*unknown/);
  assert.match(await pilotPanel.innerText(), /Sample peer handoffs/);
  assert.equal(await pilotPanel.locator('button').count(), 0, 'review recommendations cannot change the organization');
  const conclusion = page.locator('[data-organization-review][data-type="hierarchy-conclusion"]');
  await conclusion.locator('..').locator(':scope > summary').click();
  await conclusion.locator('[name="action"]').selectOption('adopt');
  await conclusion.locator('[name="reason"]').fill('Keep the coordination role if the pilot supports it.');
  await conclusion.locator('[data-review-preview]').click();
  await conclusion.locator('[data-review-preview-panel]').waitFor();
  assert.equal(await conclusion.locator('[data-review-confirm]').isVisible(), false,
    'qualitative inconclusive evidence does not permit adoption');
  await conclusion.locator('[data-review-edit]').click();
  await conclusion.locator('[name="action"]').selectOption('reverse');
  await conclusion.locator('[name="reason"]').fill('Restore direct reporting while collecting better evidence.');
  await conclusion.locator('[data-review-preview]').click();
  await conclusion.locator('[data-review-confirm]').waitFor();
  await conclusion.getByText('Exact proposal and evidence in this decision', { exact: true }).click();
  assert.match(await conclusion.locator('[data-review-scope]').innerText(), /schedulesRetained/);
  await selectViewFor(page, '[data-organization-review][data-type="hierarchy-conclusion"]');
  await conclusion.screenshot({ path: screenshotPath('torch-dashboard-pilot-conclusion.png') });
  await conclusion.locator('[data-review-confirm]').click();
  await page.locator('#organization-action-status').filter({ hasText: 'recorded as reversed' }).waitFor();
  assert.equal(await page.locator('.agent-row').count(), 6);

  await selectViewFor(page, '.task-ticket');
  const ticket = page.locator('.task-ticket').filter({ hasText: 'API-08' });
  await ticket.locator('.priority-change > summary').click();
  await ticket.locator('[name="priority"]').selectOption('urgent');
  await ticket.locator('[name="reason"]').fill('Needed for the beta');
  await ticket.getByRole('button', { name: 'Review change', exact: true }).click();
  await ticket.locator('[data-priority-confirm]').waitFor();
  assert.equal(await ticket.locator('.priority').textContent(), 'high');
  await ticket.locator('[data-priority-confirm]').click();
  await ticket.locator('.priority-urgent').waitFor();

  await selectViewFor(page, '.owner-request-composer');
  await page.locator('.owner-request-composer > summary').click();
  await page.locator('#owner-request-recipient').selectOption('qa');
  await page.locator('#owner-request-body').fill('Please review the home layout.');
  await page.locator('[data-owner-request-preview]').click();
  await page.locator('[data-owner-request-confirm]').waitFor();
  await page.locator('[data-owner-request-confirm]').click();
  await page.locator('#message-list .conversation-item').filter({ hasText: 'Please review the home layout.' }).waitFor();

  await selectViewFor(page, '.artifact-feedback-form');
  const feedback = page.locator('.artifact-feedback-form').first();
  await feedback.locator('textarea').fill('Give active work more room.');
  await feedback.getByRole('button', { name: 'Review feedback' }).click();
  await feedback.locator('[data-feedback-confirm]').waitFor();
  await feedback.locator('[data-feedback-confirm]').click();
  await page.locator('.artifact-feedback blockquote').filter({ hasText: 'Give active work more room.' }).waitFor();

  await selectViewFor(page, '.runtime-profile-tools');
  await page.locator('.runtime-profile-tools > summary').click();
  await page.locator('#runtime-profile-area').selectOption('interface');
  await page.locator('#runtime-profile-runtime').selectOption('claude');
  assert.equal(await page.locator('#runtime-profile-model').inputValue(), 'sonnet');
  await page.locator('[data-runtime-profile-preview]').click();
  await page.locator('[data-runtime-profile-confirm]').waitFor();
  await page.locator('[data-runtime-profile-confirm]').click();
  await page.locator('.agent-row').filter({ hasText: 'interface · claude / sonnet' }).waitFor();

  await selectViewFor(page, '.approval-decision-form');
  await page.locator('.approval-decision-form [name="decision"]').selectOption('approved');
  await page.locator('[data-approval-preview]').click();
  await page.locator('[data-approval-confirm]').waitFor();
  await page.locator('[data-approval-confirm]').click();
  await page.getByText('No open approval requests.', { exact: true }).waitFor();
  await selectViewFor(page, '#owner-briefing');
  assert.match(await page.locator('#owner-briefing').innerText(), /Choose the project home layout/,
    'published briefing is historical even when live approval state changes');

  await selectViewFor(page, '.organization-review');
  await page.locator('.organization-review > summary').click();
  await page.locator('[data-organization-review] [name="action"]').selectOption('approve');
  await page.locator('[data-review-preview]').click();
  await page.locator('[data-review-confirm]').waitFor();
  assert.doesNotMatch(await page.locator('[data-review-preview-panel]').innerText(), /undefined/);
  await page.locator('[data-review-confirm]').click();
  await page.locator('#organization-action-status').filter({ hasText: 'recorded as approved' }).waitFor();

  await selectViewFor(page, '.pilot-review-history');
  await pilotPanel.locator(':scope > summary').click();
  await selectViewFor(page, '.pilot-review-history');
  await pilotPanel.screenshot({ path: screenshotPath('torch-dashboard-pilot-review.png') });
  await selectViewFor(page, '#manager-wakes');
  await page.locator('#manager-wakes').screenshot({ path: screenshotPath('torch-dashboard-manager-wakes.png') });
  await selectView(page, 'overview');
  await page.evaluate(() => scrollTo(0, 0));
  await selectView(page, 'overview');
  await page.screenshot({ path: screenshotPath('torch-dashboard-demo-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  // Let responsive styles and layout finish before measuring the new viewport.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.evaluate(() => scrollTo(0, 0));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false,
    JSON.stringify(await page.evaluate(() => ({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth, overflow: [...document.querySelectorAll('body *')].map((element) => {
      const bounds = element.getBoundingClientRect();
      return { tag: element.tagName, id: element.id, className: element.className, right: bounds.right, width: bounds.width };
    }).filter((element) => element.right > innerWidth + 1).slice(-30) }))));
  await selectView(page, 'overview');
  await page.screenshot({ path: screenshotPath('torch-dashboard-demo-mobile.png') });
  await selectView(page, 'owner-briefing');
  await page.locator('.console-rail a[href="#owner-briefing"]').click();
  const briefingHeading = await page.locator('#owner-briefing-title').boundingBox();
  const stickyRail = await page.locator('.console-rail').boundingBox();
  assert.ok(briefingHeading.y >= stickyRail.y + stickyRail.height, 'briefing anchor must clear sticky mobile navigation');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.locator('#owner-briefing').screenshot({ path: screenshotPath('torch-dashboard-owner-briefing-mobile.png') });
  await page.locator('#owner-briefing .briefing-detail').first().locator('summary').click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'expanded briefing evidence must fit mobile width');
  await page.locator('#reset-demo').click();
  await page.locator('#approval-request-count').filter({ hasText: '1 open' }).waitFor();
  assert.equal(await page.locator('.priority-urgent').count(), 0);
  assert.equal(await page.locator('.agent-row').count(), 6);
  assert.deepEqual(errors, []);
  const livePage = await context.newPage();
  await livePage.clock.install({ time: new Date('2026-09-30T12:00:00Z') });
  await livePage.goto(base + '/console.html?demo=1');
  await livePage.locator('#live-refresh-status[data-generation="1"]').waitFor();
  await selectView(livePage, 'fleet');
  for (const model of ['external-model-1', 'external-model-2']) {
    await livePage.evaluate(async (model) => {
      const payload = { areaId: document.querySelector('#runtime-profile-area').value, runtime: 'codex', model, reasoning: 'high' };
      const preview = await globalThis.TorchConsoleDemo.request('/api/runtime-profiles/preview', payload);
      await globalThis.TorchConsoleDemo.request('/api/runtime-profiles', { ...payload, token: preview.token, planHash: preview.planHash });
    }, model);
    await livePage.locator('#refresh-console').click();
    assert.equal(await livePage.locator('#runtime-profile-model').inputValue(), model, 'clean editor must track successive external model changes');
  }
  await livePage.reload();
  await livePage.locator('#live-refresh-status[data-generation="1"]').waitFor();
  await selectView(livePage, 'fleet');
  await livePage.locator('.runtime-profile-tools > summary').click();
  await livePage.locator('#runtime-profile-model').fill('owner-draft-model');
  await selectViewFor(livePage, '#task-create-form');
  await livePage.locator('#task-create-form').locator('..').locator(':scope > summary').click();
  await livePage.locator('#task-create-form [name="title"]').fill('My unfinished task');
  await selectViewFor(livePage, '.approval-decision-form');
  await livePage.locator('.approval-decision-form [name="decision"]').selectOption('approved');
  await livePage.locator('[data-approval-preview]').click();
  await livePage.locator('[data-approval-confirm]').waitFor();
  const previewToken = await livePage.locator('.approval-decision-form').getAttribute('data-preview-token');
  await livePage.evaluate(() => { globalThis.oldMessageNode = document.querySelector('#message-list p'); });
  await livePage.clock.runFor(15_000);
  await livePage.locator('#live-refresh-status[data-generation="2"]').waitFor();
  assert.equal(await livePage.locator('#runtime-profile-model').inputValue(), 'owner-draft-model');
  assert.equal(await livePage.locator('#task-create-form [name="title"]').inputValue(), 'My unfinished task');
  assert.equal(await livePage.locator('.approval-decision-form').getAttribute('data-preview-token'), previewToken);
  assert.equal(await livePage.evaluate(() => globalThis.oldMessageNode.isConnected), false, 'unprotected read-only panels must keep updating');
  assert.match(await livePage.locator('#live-refresh-status').innerText(), /Edited forms and active previews retained/);
  await livePage.locator('#toggle-live-refresh').click();
  await livePage.clock.runFor(30_000);
  assert.equal(await livePage.locator('#live-refresh-status').getAttribute('data-generation'), '2');
  await livePage.locator('#toggle-live-refresh').click();
  await livePage.locator('#live-refresh-status[data-generation="3"]').waitFor();
  await livePage.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }));
  await livePage.clock.runFor(30_000);
  assert.equal(await livePage.locator('#live-refresh-status').getAttribute('data-generation'), '3', 'hidden tabs must not poll');
  await livePage.evaluate(() => {
    delete document.visibilityState;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await livePage.locator('#live-refresh-status[data-generation="4"]').waitFor();
  await livePage.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide')));
  await livePage.clock.runFor(30_000);
  assert.equal(await livePage.locator('#live-refresh-status').getAttribute('data-generation'), '4');
  await livePage.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await livePage.locator('#live-refresh-status[data-generation="5"]').waitFor();
  await livePage.clock.runFor(15_000);
  await livePage.locator('#live-refresh-status[data-generation="6"]').waitFor();
  await selectViewFor(livePage, '.approval-decision-form');
  await livePage.locator('[data-approval-confirm]').click();
  await livePage.locator('#approval-request-count').filter({ hasText: '0 open' }).waitFor();
  assert.equal(await livePage.locator('#runtime-profile-model').inputValue(), 'owner-draft-model', 'completing an approval must not clear another form');
  assert.equal(await livePage.locator('#task-create-form [name="title"]').inputValue(), 'My unfinished task');
  await livePage.locator('#refresh-console').click();
  assert.equal(await livePage.locator('#runtime-profile-model').inputValue(), 'owner-draft-model');
  await selectViewFor(livePage, '.approval-decision-form');
  await livePage.screenshot({ path: screenshotPath('torch-dashboard-live-refresh.png') });
  await livePage.close();

  const stalePage = await context.newPage();
  await stalePage.clock.install({ time: new Date('2026-10-01T12:00:00.000Z') });
  await stalePage.goto(base + '/console.html?demo=1#work');
  await stalePage.locator('#live-refresh-status[data-generation="1"]').waitFor();
  await selectView(stalePage, 'work');
  const staleTicket = stalePage.locator('.task-ticket').filter({ hasText: 'API-08' });
  const staleForm = staleTicket.locator('.priority-change-form');
  const revisionN = Number(await staleForm.getAttribute('data-revision'));
  await staleTicket.locator('.priority-change > summary').click();
  await staleForm.locator('[name="priority"]').selectOption('urgent');
  await staleForm.locator('[name="reason"]').fill('Review this change against the current task evidence.');
  await staleForm.getByRole('button', { name: 'Review change', exact: true }).click();
  await staleForm.locator('[data-priority-confirm]').waitFor();
  assert.equal(await staleForm.locator('[data-priority-preview]').locator('dd').nth(2).innerText(), String(revisionN));
  const staleToken = await staleForm.getAttribute('data-preview-token');
  const revisionN1 = await stalePage.evaluate(async (expectedRevision) => {
    const path = '/api/backlog/tasks/API-08/priority';
    const change = { priority: 'low', reason: 'A separate confirmed sample change establishes newer task evidence.', expectedRevision };
    const preview = await globalThis.TorchConsoleDemo.request(`${path}/preview`, change);
    const applied = await globalThis.TorchConsoleDemo.request(path, { ...change, token: preview.token, planHash: preview.planHash });
    return applied.task.revision;
  }, revisionN);
  assert.equal(revisionN1, revisionN + 1, 'new authoritative task evidence must advance from revision N to N+1');
  await selectView(stalePage, 'overview');
  await selectView(stalePage, 'work');
  await stalePage.locator('#refresh-console').click();
  await stalePage.locator('#live-refresh-status[data-generation="2"]').waitFor();
  const refreshedTicket = stalePage.locator('.task-ticket').filter({ hasText: 'API-08' });
  const refreshedForm = refreshedTicket.locator('.priority-change-form');
  assert.equal(Number(await refreshedForm.getAttribute('data-revision')), revisionN1);
  assert.equal(await refreshedTicket.locator('.priority').textContent(), 'low');
  assert.equal(await refreshedForm.getAttribute('data-preview-token'), null, 'revision N preview token must be discarded');
  assert.equal(await refreshedForm.locator('[data-priority-preview]').isVisible(), false,
    'revision N preview must not remain presented after revision N+1 is refreshed');
  assert.equal(await refreshedForm.locator('[data-priority-confirm]').count(), 0,
    'the stale revision N preview cannot be confirmed as current');
  assert.equal(await refreshedForm.locator('[name="priority"]').inputValue(), 'urgent', 'the unsent priority choice must survive invalidation');
  assert.equal(await refreshedForm.locator('[name="reason"]').inputValue(), 'Review this change against the current task evidence.',
    'the unsent reason must survive invalidation');
  assert.equal(await refreshedForm.locator('[name="priority"]').isDisabled(), false, 'the preserved priority choice remains editable');
  assert.equal(await refreshedForm.locator('[name="reason"]').isDisabled(), false, 'the preserved reason remains editable');
  assert.match(await refreshedForm.locator('.priority-change-status').innerText(), new RegExp(`revision ${revisionN1}`),
    'the visible status identifies current task evidence');
  await selectView(stalePage, 'overview');
  await selectView(stalePage, 'work');
  await stalePage.locator('#refresh-console').click();
  await stalePage.locator('#live-refresh-status[data-generation="3"]').waitFor();
  assert.equal(Number(await refreshedForm.getAttribute('data-revision')), revisionN1);
  assert.equal(await refreshedTicket.locator('.priority').textContent(), 'low');
  assert.equal(await refreshedForm.getAttribute('data-preview-token'), null);
  assert.equal(await refreshedForm.locator('[data-priority-preview]').isVisible(), false);
  assert.equal(await refreshedForm.locator('[data-priority-confirm]').count(), 0);
  assert.equal(await refreshedForm.locator('[name="priority"]').inputValue(), 'urgent');
  assert.equal(await refreshedForm.locator('[name="reason"]').inputValue(), 'Review this change against the current task evidence.');
  assert.equal(await refreshedForm.locator('[name="priority"]').isDisabled(), false);
  assert.equal(await refreshedForm.locator('[name="reason"]').isDisabled(), false);
  await refreshedTicket.locator('.priority-change > summary').click();
  await refreshedForm.getByRole('button', { name: 'Review change', exact: true }).click();
  await refreshedForm.locator('[data-priority-confirm]').waitFor();
  assert.equal(await refreshedForm.locator('[data-priority-preview]').locator('dd').nth(2).innerText(), String(revisionN1));
  assert.notEqual(await refreshedForm.getAttribute('data-preview-token'), staleToken,
    'a current preview must be regenerated from revision N+1');
  const currentToken = await refreshedForm.getAttribute('data-preview-token');
  await stalePage.locator('#refresh-console').click();
  await stalePage.locator('#live-refresh-status[data-generation="4"]').waitFor();
  assert.equal(await refreshedForm.getAttribute('data-preview-token'), currentToken,
    'unchanged current evidence must retain its active preview');
  assert.equal(await refreshedForm.locator('[data-priority-preview]').isVisible(), true);
  assert.equal(await refreshedForm.locator('[data-priority-confirm]').isVisible(), true);
  assert.equal(await refreshedForm.locator('[name="priority"]').inputValue(), 'urgent');
  assert.equal(await refreshedForm.locator('[name="reason"]').inputValue(), 'Review this change against the current task evidence.');
  await stalePage.close();
  assert.deepEqual(errors, []);
  assert.deepEqual(apiRequests, [], 'demo must never contact live project APIs');
  console.log('PASS: real Console demo; separate tab; priority, messages, feedback, profiles, approval and organization review; reset; mobile layout; zero live API calls.');
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  console.log(JSON.stringify(describeDashboardArtifacts(artifacts)));
}
