import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { chromium } from '@playwright/test';
import { createConsoleServer } from '../../src/console/server.mjs';
import '../../site/attention-projection.js';
import '../../site/attention-actions.js';

const project = (snapshot) => globalThis.TorchAttentionProjection.groups(snapshot);
const taskId = (index) => `TASK-COHORT-${String(index).padStart(2, '0')}`;

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function finding(task, source = {}) {
  return {
    severity: 'warning', code: 'BACKLOG_OBSERVED_COMMIT_STALE', taskId: task.id,
    observedAt: task.observedAt, owner: task.owner, ...source,
  };
}

function cohortFixture(count = 49) {
  const tasks = Array.from({ length: count }, (_, index) => ({
    id: taskId(index + 1), owner: `domain-${String(index + 1).padStart(2, '0')}`,
    observedAt: `2026-09-${String((index % 28) + 1).padStart(2, '0')}T12:00:00.000Z`,
  }));
  const findings = tasks.map((task, index) => finding(task, {
    code: index % 2 ? 'BACKLOG_OBSERVED_COMMIT_MISSING' : 'BACKLOG_OBSERVED_COMMIT_STALE',
  }));
  return {
    repository: { head: '316d8b7480c2e10925ebdff8310fe26ef5a881a8' },
    backlog: tasks,
    doctor: { findings: structuredClone(findings) },
    backlogHealth: { findings: structuredClone(findings), mutationPerformed: false },
  };
}

test('SCN-attention-advisory-cohort-cardinality-and-exact-references: 49 equivalent observations render as one recheck cohort', async (t) => {
  const groups = project(cohortFixture());
  const expectedReferences = Array.from({ length: 49 }, (_, index) => taskId(index + 1));

  assert.equal(groups.advisory.length, 1);
  assert.equal(groups.advisory[0].title, '49 task evidence rechecks');
  assert.equal(groups.fleet.filter((item) => /BACKLOG_OBSERVED_COMMIT_(STALE|MISSING)/.test(item.title)).length, 0);
  assert.deepEqual(groups.advisory[0].taskReferences, expectedReferences);
  assert.equal(groups.advisory[0].observations.length, 49);
  const fixture = cohortFixture();
  for (const observation of groups.advisory[0].observations) {
    const task = fixture.backlog.find((entry) => entry.id === observation.taskId);
    assert.ok(task, `retained reference ${observation.taskId} belongs to the fixed 49-task scenario`);
    assert.equal(observation.owner, task.owner);
    assert.equal(observation.observedAt, task.observedAt);
    assert.equal(observation.currentObservedCommit, '316d8b7480c2e10925ebdff8310fe26ef5a881a8');
    assert.equal(observation.reproductionStatus, 'UNKNOWN');
    assert.deepEqual(observation.sources, ['doctor', 'backlogHealth']);
  }

  const server = createConsoleServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let browser;
  t.after(async () => {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.clock.install({ time: new Date('2026-10-01T12:00:00.000Z') });
  await page.goto(`http://127.0.0.1:${server.address().port}/console?demo=1#overview`);
  await page.locator('#live-refresh-status[data-generation="1"]').waitFor();
  await page.evaluate((fixedSnapshot) => {
    const demo = globalThis.TorchConsoleDemo;
    const originalSnapshot = demo.snapshot;
    const originalRequest = demo.request;
    let actionCalls = 0;
    demo.snapshot = () => structuredClone(fixedSnapshot);
    demo.request = (...args) => { actionCalls += 1; return originalRequest(...args); };
    globalThis.__attentionCohortReadOnlyProbe = {
      originalSnapshot, get actionCalls() { return actionCalls; },
    };
  }, fixture);
  await page.locator('#refresh-console').click();
  await page.locator('#live-refresh-status[data-generation="2"]').waitFor();
  const advisory = page.locator('#attention-list .attention-group-advisory');
  assert.equal(await advisory.count(), 1);
  assert.match(await advisory.locator('h3').innerText(), /Advisory \/ recheck cohorts/);
  assert.equal(await advisory.locator('.attention-item').count(), 1);
  assert.equal(await advisory.locator('.attention-cohort-details li').count(), 49);
  assert.deepEqual(await advisory.locator('.attention-cohort-details li code').allTextContents(), expectedReferences);
  assert.equal(await page.locator('#attention-list .attention-group-fleet .attention-item').filter({
    hasText: /BACKLOG_OBSERVED_COMMIT_(STALE|MISSING)|task evidence record.*need refresh/,
  }).count(), 0);
  assert.equal(await page.evaluate(() => globalThis.__attentionCohortReadOnlyProbe.actionCalls), 0);
  assert.deepEqual(await page.evaluate(() => {
    const current = globalThis.__attentionCohortReadOnlyProbe.originalSnapshot();
    return [current.doctor.findings.length, current.backlogHealth.findings.length];
  }), [0, 0], 'rendering the synthetic snapshot did not mutate isolated demo state');
});

test('SCN-attention-advisory-provenance-and-semantic-conflicts: equal sources merge and any fingerprint difference stays distinct', () => {
  const conflictCases = [
    { field: 'taskId', firstId: 'TASK-ID-A', secondId: 'TASK-ID-B' },
    { field: 'code', change: { code: 'BACKLOG_OBSERVED_COMMIT_MISSING' } },
    { field: 'owner', change: { owner: 'domain-conflict' } },
    { field: 'observedAt', change: { observedAt: '2026-10-01T12:01:00.000Z' } },
    { field: 'currentObservedCommit', change: { currentObservedCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } },
    { field: 'reproductionStatus', change: { reproductionStatus: 'REPRODUCED' } },
  ];
  const doctor = [];
  const backlogHealth = [];
  const tasks = [];
  for (const [index, conflict] of conflictCases.entries()) {
    const id = `TASK-CONFLICT-${conflict.field}`;
    const firstTask = { id: conflict.firstId ?? id, owner: 'domain-a', observedAt: `2026-10-01T12:0${index}:00.000Z` };
    const secondTask = conflict.secondId
      ? { ...firstTask, id: conflict.secondId }
      : firstTask;
    tasks.push(firstTask, secondTask);
    doctor.push(finding(firstTask, {
      currentObservedCommit: '316d8b7480c2e10925ebdff8310fe26ef5a881a8', reproductionStatus: 'UNKNOWN',
    }));
    backlogHealth.push(finding(secondTask, {
      currentObservedCommit: '316d8b7480c2e10925ebdff8310fe26ef5a881a8', reproductionStatus: 'UNKNOWN',
      ...(conflict.change ?? {}),
    }));
  }
  const groups = project({ repository: { head: '316d8b7480c2e10925ebdff8310fe26ef5a881a8' }, backlog: tasks,
    doctor: { findings: doctor }, backlogHealth: { findings: backlogHealth } });

  assert.equal(groups.advisory.length, 1, 'the advisory label remains one cohort across conflicting records');
  assert.equal(groups.advisory[0].observations.length, 12);
  assert.equal(groups.advisory[0].observations.filter((entry) => entry.sources.length === 2).length, 0,
    'no mismatched fingerprint may inherit both provenance labels');
  for (const observation of groups.advisory[0].observations) {
    assert.equal(observation.sources.length, 1);
    assert.ok(['doctor', 'backlogHealth'].includes(observation.sources[0]));
  }

  const equalTask = { id: 'TASK-EQUAL', owner: 'domain-equal', observedAt: '2026-10-01T13:00:00.000Z' };
  const equalGroups = project({ repository: { head: '316d8b7480c2e10925ebdff8310fe26ef5a881a8' }, backlog: [equalTask],
    doctor: { findings: [finding(equalTask)] }, backlogHealth: { findings: [finding(equalTask)] } });
  assert.equal(equalGroups.advisory[0].observations.length, 1);
  assert.deepEqual(equalGroups.advisory[0].observations[0].sources, ['doctor', 'backlogHealth']);
});

test('SCN-attention-advisory-does-not-hide-owner-or-fleet-risks: unsafe and unknown conditions keep their existing classifications', () => {
  const groups = project({
    agents: [{ areaId: 'provider-runtime', title: 'Provider Runtime' }],
    repository: { head: '316d8b7480c2e10925ebdff8310fe26ef5a881a8' },
    approvalRequests: { items: [{ id: 'owner-decision', status: 'pending', approver: 'owner', requester: 'provider-runtime',
      title: 'Review a real owner decision' }] },
    doctor: { findings: [
      { severity: 'warning', code: 'BACKLOG_OBSERVED_COMMIT_STALE', taskId: 'TASK-ADVISORY' },
      { severity: 'error', code: 'BACKLOG_OBSERVED_COMMIT_STALE', taskId: 'TASK-ERROR', message: 'The source reports an unsafe error.' },
      { severity: 'error', code: 'BACKLOG_HEALTH_INVALID', message: 'Backlog schema validation failed.' },
      { severity: 'warning', code: 'RECOVERABILITY', offMachine: false, recommendation: 'Verify the recovery copy.' },
    ] },
    backlog: [{ id: 'TASK-ADVISORY', owner: 'provider-runtime', observedAt: '2026-10-01T10:00:00.000Z' }],
    managerWakes: { blockingCount: 1, reservations: [{ managerId: 'provider-runtime', scheduleId: 'wake-a', outcome: 'unknown', blocksManagerWake: true }] },
    deliveryOperations: [{ operation: 'publish', state: 'unknown', actor: 'provider-runtime', commit: '316d8b7480c2e10925ebdff8310fe26ef5a881a8' }],
  });

  assert.equal(groups.owner.length, 1);
  assert.equal(groups.owner[0].decisionApprovalId, 'owner-decision');
  assert.equal(groups.advisory.length, 1);
  assert.ok(groups.fleet.some((item) => item.title === 'Backlog observed commit stale'
    && /unsafe error/.test(item.detail)), 'an error with the advisory code remains a Fleet finding');
  assert.ok(groups.fleet.some((item) => item.title === 'Backlog health invalid'));
  assert.ok(groups.fleet.some((item) => item.title === 'Off-machine recovery copy is not verified'));
  assert.ok(groups.fleet.some((item) => /scheduled manager launch/.test(item.title)));
  assert.ok(groups.fleet.some((item) => /delivery operation/.test(item.title)));
  assert.equal(groups.fleet.some((item) => item.decisionApprovalId === 'owner-decision'), false);
});

test('SCN-attention-advisory-projection-is-read-only: projection preserves snapshot and existing owner decision shape', () => {
  const snapshot = {
    repository: { head: '316d8b7480c2e10925ebdff8310fe26ef5a881a8' },
    backlog: [{ id: 'TASK-READONLY', owner: 'provider-runtime', observedAt: '2026-10-01T12:00:00.000Z' }],
    doctor: { findings: [{ severity: 'warning', code: 'BACKLOG_OBSERVED_COMMIT_STALE', taskId: 'TASK-READONLY' }] },
    backlogHealth: { findings: [{ severity: 'warning', code: 'BACKLOG_OBSERVED_COMMIT_STALE', taskId: 'TASK-READONLY' }] },
    approvalRequests: { items: [{ id: 'owner-confirm', revision: 7, status: 'pending', approver: 'owner', requester: 'provider-runtime',
      title: 'Confirm reviewed scope', evidence: 'receipt:exact', summary: 'Inspect before deciding.' }] },
  };
  const before = structuredClone(snapshot);
  deepFreeze(snapshot);
  const groups = project(snapshot);

  assert.deepEqual(snapshot, before);
  assert.equal(groups.owner[0].decisionApprovalId, 'owner-confirm');
  assert.equal(groups.owner[0].evidence, 'receipt:exact');
  assert.equal(groups.owner[0].href, '#approval-owner-confirm');
  assert.deepEqual(groups.advisory[0].observations[0].sources, ['doctor', 'backlogHealth']);
  assert.equal(groups.advisory[0].observations[0].reproductionStatus, 'UNKNOWN');

  const selected = { value: 'approved', disabled: true };
  const note = { value: 'Keep this unsent decision note.' };
  const previewForm = { dataset: { previewToken: 'current-token', revision: '7' },
    elements: { namedItem: () => selected }, querySelector: () => note };
  let previewCalls = 0;
  const shortcut = globalThis.TorchAttentionActions.prepareOwnerDecisionShortcut(previewForm, 'rejected', () => { previewCalls += 1; });
  assert.equal(shortcut.started, false);
  assert.equal(previewCalls, 0);
  assert.equal(selected.value, 'approved');
  assert.equal(note.value, 'Keep this unsent decision note.');
  assert.equal(previewForm.dataset.previewToken, 'current-token');
  assert.equal(previewForm.dataset.revision, '7');
});

test('SCN-attention-advisory-unknown-fields-stay-unknown: absent owner and observation provenance are not manufactured', () => {
  const groups = project({
    doctor: { findings: [{ severity: 'warning', code: 'BACKLOG_OBSERVED_COMMIT_MISSING', taskId: 'TASK-UNKNOWN' }] },
    backlogHealth: { findings: [] },
    backlog: [{ id: 'TASK-UNKNOWN' }],
  });
  const [observation] = groups.advisory[0].observations;

  assert.equal(groups.advisory.length, 1);
  assert.deepEqual(groups.advisory[0].taskReferences, ['TASK-UNKNOWN']);
  assert.equal(observation.owner, null);
  assert.equal(observation.observedAt, null);
  assert.equal(observation.currentObservedCommit, null);
  assert.equal(observation.reproductionStatus, 'UNKNOWN');
  assert.deepEqual(observation.sources, ['doctor']);
});
