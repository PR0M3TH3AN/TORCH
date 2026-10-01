import assert from 'node:assert/strict';
import { once } from 'node:events';
import test, { after, before } from 'node:test';
import { chromium } from '@playwright/test';
import { createConsoleServer } from '../../src/console/server.mjs';
import '../../site/attention-projection.js';

let server;
let browser;
let origin;

before(async () => {
  server = createConsoleServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
});

async function openOverview(viewport = { width: 1440, height: 1000 }) {
  const page = await browser.newPage({ viewport });
  await page.goto(`${origin}/console?demo=1#overview`);
  await page.locator('#live-refresh-status[data-generation="1"]').waitFor();
  const snapshot = await page.evaluate(() => structuredClone(globalThis.TorchConsoleDemo.snapshot()));
  return { page, snapshot };
}

async function renderSnapshot(page, snapshot) {
  await page.evaluate((fixed) => { globalThis.TorchConsoleDemo.snapshot = () => structuredClone(fixed); }, snapshot);
  await page.locator('#refresh-console').click();
  await page.locator('#live-refresh-status[data-generation="2"]').waitFor();
}

function unsafeSnapshot(snapshot) {
  snapshot.mode = 'installed';
  snapshot.approvalRequests = { available: true, pendingCount: 1, items: [{
    id: 'owner-review-1', revision: 4, status: 'pending', approver: 'owner', requester: 'qa',
    title: 'Review the exact owner decision', task: 'TASK-CONSOLE-OVERVIEW', evidence: 'same-origin preview and current revision',
  }] };
  snapshot.fleetChanges = [];
  snapshot.hierarchyProposals = [];
  snapshot.doctor = { ...(snapshot.doctor ?? {}), findings: [
    { severity: 'error', code: 'BACKLOG_HEALTH_INVALID', message: 'Current schema validation failed; inspect the evidence before action.' },
    { severity: 'error', code: 'WORKTREE_PROBLEM', area: 'qa', problem: 'git-operation:merge', path: '/work/qa' },
    { severity: 'warning', code: 'BACKLOG_OBSERVED_COMMIT_STALE', taskId: 'TASK-ADVISORY-1', owner: 'provider-runtime', observedAt: 'a'.repeat(40) },
  ] };
  snapshot.backlogHealth = { findings: [] };
  snapshot.worktrees = [{ area: 'qa', branch: 'qa/review', path: '/work/qa', ahead: 2, behind: 0 }];
  snapshot.agents = [...(snapshot.agents ?? []), { areaId: 'qa', title: 'QA' }];
  snapshot.managerWakes = { blockingCount: 1, reservations: [{ managerId: 'qa', scheduleId: 'wake-1', reservedAt: '2026-10-01T00:00:00Z', outcome: 'unknown', blocksManagerWake: true }] };
  snapshot.deliveryOperations = [{ operation: 'apply', state: 'unknown', actor: 'qa', commit: 'c'.repeat(40) }];
  snapshot.backlog = [...(snapshot.backlog ?? []), { id: 'TASK-ADVISORY-1', owner: 'provider-runtime', observedAt: 'a'.repeat(40), state: 'in_progress' }];
  return snapshot;
}

test('SCN-console-overview-owner-decisions-and-urgent-hazards-lead-with-distinct-counts', async (t) => {
  const { page, snapshot } = await openOverview();
  t.after(() => page.close());
  await renderSnapshot(page, unsafeSnapshot(snapshot));
  const groupsForCounts = globalThis.TorchAttentionProjection.groups(unsafeSnapshot(snapshot));
  const ownerDecisions = groupsForCounts.owner.length;
  const urgentHazards = groupsForCounts.fleet.filter((item) => item.tone === 'urgent').length;
  const actionable = ownerDecisions + groupsForCounts.fleet.filter((item) => item.tone !== 'info').length
    + groupsForCounts.arbiter.filter((item) => item.tone !== 'info').length;
  const summarized = globalThis.TorchAttentionProjection.summary(groupsForCounts);
  assert.equal(summarized.ownerDecisions, ownerDecisions);
  assert.equal(summarized.urgentHazards, urgentHazards);
  assert.equal(summarized.actionable, actionable);

  const groups = page.locator('#attention-list > .attention-group');
  assert.match(await groups.nth(0).locator('h3').innerText(), /Waiting on you/);
  assert.match(await groups.nth(1).locator('h3').innerText(), /Fleet handling/);
  assert.equal(await page.locator('#owner-decision-count').innerText(), `${ownerDecisions} owner decision${ownerDecisions === 1 ? '' : 's'}`);
  assert.equal(await page.locator('#urgent-hazard-count').innerText(), `${urgentHazards} urgent hazard${urgentHazards === 1 ? '' : 's'}`);
  assert.equal(await page.locator('#attention-count').innerText(), `${actionable} actionable`);
  assert.match(await page.locator('#advisory-count').innerText(), /1 cohort/);
  assert.equal(await page.locator('#attention-list [data-attention-decision]').count(), 2);
  assert.equal(await page.locator('#attention-list button').filter({ hasText: /Acknowledge|Close|Recover/ }).count(), 0);
  assert.ok(await page.locator('#attention-list .tone-urgent').count() >= 3);
  assert.equal(await page.locator('#attention-list a[href="#manager-wakes"]').count(), 1);
});

test('SCN-console-overview-clean-unique-commits-stay-informational-and-unsafe-workstays-reviewable', async (t) => {
  const { page, snapshot } = await openOverview();
  t.after(() => page.close());
  snapshot.doctor = { ...(snapshot.doctor ?? {}), findings: [
    { severity: 'warning', code: 'WORKTREE_PROBLEM', area: 'project-kernel', problem: 'unique-commits:3', path: '/work/kernel' },
    { severity: 'warning', code: 'WORKTREE_PROBLEM', area: 'provider-runtime', problem: 'worktree-dirty', path: '/work/provider' },
  ] };
  snapshot.worktrees = [
    { area: 'project-kernel', branch: 'kernel/progress', path: '/work/kernel', ahead: 3, behind: 0 },
    { area: 'provider-runtime', branch: 'provider/changes', path: '/work/provider', ahead: 0, behind: 0 },
  ];
  snapshot.agents = [...(snapshot.agents ?? []), { areaId: 'project-kernel', title: 'Project Kernel' }, { areaId: 'provider-runtime', title: 'Provider Runtime' }];
  await renderSnapshot(page, snapshot);

  const records = page.locator('#fleet-attention-list [data-attention-record]');
  const clean = records.filter({ hasText: 'has work ahead of main' });
  const dirty = records.filter({ hasText: 'worktree needs review' });
  assert.equal(await clean.count(), 1);
  assert.ok(await clean.evaluate((item) => item.classList.contains('tone-info')));
  assert.match(await clean.innerText(), /3 unique commit\(s\) are ahead/);
  assert.equal(await dirty.count(), 1);
  assert.ok(await dirty.evaluate((item) => item.classList.contains('tone-review')));
  assert.match(await dirty.innerText(), /Uncommitted changes are present/);
});

function crowdedSnapshot(snapshot) {
  const references = Array.from({ length: 49 }, (_, index) => `TASK-DENSITY-${String(index + 1).padStart(2, '0')}`);
  const tasks = references.map((id, index) => ({
    id, owner: index === 47 ? null : `domain-${String(index + 1).padStart(2, '0')}`,
    observedAt: index === 47 ? null : String(index + 1).padStart(40, '0'), state: 'in_progress',
  }));
  const doctor = tasks.map((task, index) => ({ severity: 'warning', code: 'BACKLOG_OBSERVED_COMMIT_STALE',
    taskId: task.id, owner: task.owner, observedAt: task.observedAt,
    ...(index === 47 ? { currentObservedCommit: null } : {}),
  }));
  const backlogHealth = structuredClone(doctor);
  backlogHealth[48].owner = 'conflicting-owner';
  snapshot.backlog = tasks;
  snapshot.fleetChanges = [];
  snapshot.hierarchyProposals = [];
  snapshot.approvalRequests = { available: true, pendingCount: 0, items: [] };
  snapshot.messages = { ...(snapshot.messages ?? {}), unacknowledged: 0, recent: [] };
  snapshot.integration = [];
  snapshot.worktrees = [];
  snapshot.backlogActivity = { tasks: [] };
  snapshot.managerWakes = { blockingCount: 0, reservations: [] };
  snapshot.deliveryOperations = [];
  snapshot.repository = { ...(snapshot.repository ?? {}), head: 'd'.repeat(40) };
  snapshot.doctor = { ...(snapshot.doctor ?? {}), findings: [
    ...doctor,
    ...Array.from({ length: 3 }, (_, index) => ({ severity: 'error', code: `FIXED_UNSAFE_${index + 1}`,
      area: index === 0 ? null : `domain-${index + 1}`, message: `Urgent evidence ${index + 1}: ${'e'.repeat(180)}` })),
    ...Array.from({ length: 14 }, (_, index) => ({ severity: 'warning', code: `FIXED_REVIEW_${index + 1}`,
      area: index === 0 ? null : `domain-${index + 1}`, message: `Review evidence ${index + 1}: ${'f'.repeat(140)}` })),
  ] };
  snapshot.backlogHealth = { findings: backlogHealth };
  return { snapshot, references };
}

test('SCN-console-overview-crowded-preview-preserves-every-fleet-and-advisory-record-at-desktop-and-mobile', async (t) => {
  const desktop = await openOverview();
  t.after(() => desktop.page.close());
  const { snapshot, references } = crowdedSnapshot(desktop.snapshot);
  await renderSnapshot(desktop.page, snapshot);
  const projected = globalThis.TorchAttentionProjection.summary(globalThis.TorchAttentionProjection.groups(snapshot));
  assert.equal(await desktop.page.locator('#advisory-count').innerText(), '1 cohort · 49 task references');
  const previewCount = globalThis.TorchAttentionProjection.fleetPreview(globalThis.TorchAttentionProjection.groups(snapshot)).length;
  assert.equal(previewCount, 6, 'all three urgent records and only three additional preview records are shown');
  assert.equal(projected.fleetTotal, 17, 'the crowded data has exactly 17 original Fleet findings');
  assert.equal(await desktop.page.locator('#fleet-preview-count').innerText(), 'Showing 6 of 17 Fleet findings; 11 remaining');
  assert.equal(await desktop.page.locator('#attention-list .tone-urgent').count(), 3);
  const desktopWidth = await desktop.page.evaluate(() => ({ viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    layout: ['body', '.console-layout', '.console-workspace', '#overview', '.attention-panel', '#attention-list'].map((selector) => {
      const item = document.querySelector(selector); const rect = item.getBoundingClientRect();
      return `${selector}: ${Math.round(rect.left)}..${Math.round(rect.right)} scroll=${item.scrollWidth}/${item.clientWidth}`;
    }),
    offenders: [...document.querySelectorAll('body *')].map((item) => ({ item, rect: item.getBoundingClientRect() }))
      .filter(({ item, rect }) => !item.closest('[hidden]') && rect.width > 0 && (rect.right > document.documentElement.clientWidth + 1 || rect.left < -1 || item.scrollWidth > item.clientWidth + 2))
      .slice(0, 12).map(({ item, rect }) => `${item.tagName.toLowerCase()}${item.id ? `#${item.id}` : ''}.${String(item.className?.baseVal ?? item.className ?? '').split(' ').filter(Boolean).join('.')} ${Math.round(rect.left)}..${Math.round(rect.right)} scroll=${item.scrollWidth}/${item.clientWidth}`) }));
  assert.ok(desktopWidth.document <= desktopWidth.viewport, JSON.stringify(desktopWidth));
  const overviewUrgentBounds = await desktop.page.locator('#attention-list .tone-urgent').evaluateAll((items) => items.map((item) => {
    const rect = item.getBoundingClientRect(); return [rect.left, rect.right];
  }));
  assert.ok(overviewUrgentBounds.every(([left, right]) => left >= 0 && right <= 1440));

  await desktop.page.locator('.attention-footer a[href="#fleet-attention-queue"]').click();
  await desktop.page.waitForFunction(() => location.hash === '#fleet-attention-queue' && document.querySelector('.console-workspace').dataset.currentView === 'fleet');
  assert.equal(await desktop.page.locator('#fleet-attention-list .attention-group-fleet [data-attention-record]').count(), 17);
  assert.equal(await desktop.page.locator('#fleet-attention-list .attention-group-advisory .attention-cohort-details li').count(), 50,
    'the conflicting owner remains a separate observation instead of overwriting provenance');
  assert.deepEqual(await desktop.page.locator('#fleet-attention-list .attention-group-advisory .attention-cohort-details li code').allTextContents(),
    [...references, references[48]]);
  assert.equal(await desktop.page.evaluate(() => document.activeElement.id), 'fleet-attention-queue');
  assert.match(await desktop.page.locator('#fleet-attention-list').innerText(), /Owner: Responsible domain not recorded/);
  await desktop.page.locator('#fleet-attention-list .attention-group-advisory .attention-cohort-details summary').click();
  assert.match(await desktop.page.locator('#fleet-attention-list').innerText(), /Owner: Owner not recorded/);
  assert.match(await desktop.page.locator('#fleet-attention-list').innerText(), /Sources: doctor, backlogHealth/);
  assert.match(await desktop.page.locator('#fleet-attention-list').innerText(), /Urgent evidence 1/);
  const queueFilter = desktop.page.locator('#fleet-attention-filter');
  await queueFilter.fill(references[0]);
  assert.equal(await desktop.page.locator('#fleet-attention-result-count').innerText(), '1 of 18 findings match.');
  await queueFilter.fill('');
  assert.equal(await desktop.page.locator('#fleet-attention-list [data-attention-record]:visible').count(), 18);
  await desktop.page.locator('#fleet-attention-list details').evaluateAll((details) => details.forEach((detail) => { detail.open = true; }));
  assert.ok(await desktop.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    'expanded full evidence and cohort references remain horizontally contained');
  const queueBounds = await desktop.page.locator('#fleet-attention-list [data-attention-record]').evaluateAll((items) => items.map((item) => {
    const rect = item.getBoundingClientRect(); return [rect.left, rect.right];
  }));
  assert.ok(queueBounds.every(([left, right]) => left >= 0 && right <= 1440));

  const mobile = await openOverview({ width: 390, height: 844 });
  t.after(() => mobile.page.close());
  const mobileFixture = crowdedSnapshot(mobile.snapshot);
  await renderSnapshot(mobile.page, mobileFixture.snapshot);
  const mobileWidth = await mobile.page.evaluate(() => ({ viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll('body *')].map((item) => ({ item, rect: item.getBoundingClientRect() }))
      .filter(({ item, rect }) => !item.closest('[hidden]') && rect.width > 0 && rect.right > document.documentElement.clientWidth + 1)
      .slice(0, 8).map(({ item, rect }) => `${item.tagName.toLowerCase()}${item.id ? `#${item.id}` : ''}.${String(item.className?.baseVal ?? item.className ?? '').split(' ').filter(Boolean).join('.')} right=${Math.round(rect.right)}`) }));
  assert.ok(mobileWidth.document <= mobileWidth.viewport, JSON.stringify(mobileWidth));
  await mobile.page.locator('#attention-list .attention-group-advisory summary').click();
  const lastReference = mobile.page.locator('#attention-list .attention-group-advisory .attention-cohort-details li').last();
  const mobileBounds = await lastReference.boundingBox();
  assert.ok(mobileBounds && mobileBounds.x >= 0 && mobileBounds.x + mobileBounds.width <= 390,
    'expanded exact references remain within the mobile viewport');
  assert.ok(await mobile.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    'expanded advisory provenance does not overflow the mobile viewport');
  assert.equal(await mobile.page.locator('#fleet-preview-count').innerText(), 'Showing 6 of 17 Fleet findings; 11 remaining');
});

test('SCN-console-overview-refresh-and-navigation-preserve-owner-drafts-without-adding-unsafe-actions', async (t) => {
  const { page, snapshot } = await openOverview();
  t.after(() => page.close());
  const unreadBefore = snapshot.messages?.unacknowledged ?? 0;
  await renderSnapshot(page, unsafeSnapshot(snapshot));
  await page.locator('.console-rail a[href="#work"]').click();
  await page.locator('.task-create-panel > summary').click();
  const title = page.locator('#task-create-form [name="title"]');
  await title.fill('Unsent route-change draft for the current revision.');
  await page.locator('.console-rail a[href="#overview"]').click();
  await page.locator('#refresh-console').click();
  await page.locator('#live-refresh-status[data-generation="3"]').waitFor();
  await page.locator('.console-rail a[href="#work"]').click();
  assert.equal(await title.inputValue(), 'Unsent route-change draft for the current revision.');
  assert.equal(await page.locator('#attention-list [data-attention-decision]').count(), 2);
  assert.equal(await page.locator('#attention-list button').filter({ hasText: /Acknowledge|Close|Recover/ }).count(), 0);
  assert.equal(await page.evaluate(() => globalThis.TorchConsoleDemo.snapshot().messages?.unacknowledged ?? 0), unreadBefore,
    'rendering and refresh do not acknowledge durable messages');
});

test('SCN-console-overview-retains-ten-destinations-keyboard-routing-and-manager-wake-deep-links', async (t) => {
  const { page, snapshot } = await openOverview({ width: 390, height: 844 });
  t.after(() => page.close());
  await renderSnapshot(page, unsafeSnapshot(snapshot));
  const links = page.locator('.console-rail a[href^="#"]');
  assert.equal(await links.count(), 10);
  const destinations = ['overview', 'owner-briefing', 'flow-watch', 'work', 'initiative-progress', 'fleet',
    'communications', 'organization', 'evidence', 'delivery'];
  for (const destination of destinations) {
    const link = page.locator(`.console-rail a[href="#${destination}"]`);
    if (destination === 'fleet') {
      await link.focus();
      await page.keyboard.press('Enter');
    } else await link.click();
    await page.waitForFunction((view) => location.hash === `#${view}`
      && document.querySelector('.console-workspace').dataset.currentView === view, destination);
  }
  await page.locator('.console-rail a[href="#fleet"]').click();
  await page.waitForFunction(() => location.hash === '#fleet'
    && document.querySelector('.console-workspace').dataset.currentView === 'fleet');
  await page.goto(`${origin}/console?demo=1#manager-wakes`);
  await page.waitForFunction(() => document.querySelector('.console-workspace').dataset.currentView === 'fleet');
  await page.waitForFunction(() => document.activeElement.id === 'manager-wakes');
  assert.equal(await page.locator('#manager-wakes').isVisible(), true);
  await page.goBack();
  await page.waitForFunction(() => document.querySelector('.console-workspace').dataset.currentView === 'fleet');
  await page.goForward();
  await page.waitForFunction(() => document.querySelector('.console-workspace').dataset.currentView === 'fleet');
  await page.waitForFunction(() => document.activeElement.id === 'manager-wakes');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
});
