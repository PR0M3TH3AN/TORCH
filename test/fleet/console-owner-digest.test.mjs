import assert from 'node:assert/strict';
import test from 'node:test';
import '../../site/owner-digest.js';
import '../../site/demo.js';

const views = globalThis.TorchOwnerDigest;
const now = new Date('2026-09-30T12:00:00Z');
const section = (items) => ({ available: true, count: items.length, items, truncated: false });
function publication() {
  return { id: 'report-1', report: {
    schema: 'torch.dev/owner-digest/v1alpha1', generatedAt: '2026-09-30T08:12:00Z',
    window: { since: '2026-09-29T08:12:00Z', until: '2026-09-30T08:12:00Z', hours: 24 },
    needsOwner: section([{ id: 'approval-1', title: '<img src=x onerror=alert(1)>', requester: 'interface' }]),
    deliveryReview: section([]), shipped: section([]), landed: section([{ sourceArea: 'services', commit: 'abc' }]),
    completed: section([]), blocked: section([]), decisions: section([]), neglectedRequests: section([]),
    lastDeployment: { label: 'Public beta', commit: 'abc', state: 'unknown', failureReason: '<script>evil()</script>' },
    activityCoverage: { complete: false }, coverage: ['Structured decisions only'],
    markdown: '<script>Markdown is not trusted HTML</script>',
  } };
}

test('SCN-console-owner-digest: published briefing is safe, owner-first, evidence-labelled and never a live shipping claim', () => {
  const input = publication();
  const before = JSON.stringify(input);
  const html = views.render(input, { now });
  assert.ok(html.indexOf('Needs you') < html.indexOf('Shipping and integration'));
  assert.match(html, /Outcome unknown/);
  assert.match(html, /not independent live verification/);
  assert.match(html, /activity history is incomplete/i);
  assert.match(html, /href="#flow-watch"/);
  assert.match(html, /Landed.*not necessarily deployed/s);
  assert.doesNotMatch(html, /<script>|<img|onerror="|Markdown is not trusted HTML/);
  assert.equal(JSON.stringify(input), before);
  const stale = views.render(input, { now: new Date('2026-10-04T12:00:00Z') });
  assert.match(stale, /Older publication/);
  const future = views.render(input, { now: new Date('2026-09-28T12:00:00Z') });
  assert.match(future, /Check publication clock/);
});

test('SCN-console-owner-digest: unpublished, unavailable and truncated evidence remain explicit', () => {
  assert.match(views.render(null), /No published briefing/);
  assert.match(views.render(null), /torch digest publish/);
  const input = publication();
  input.report.needsOwner = { available: true, count: 20, items: [{ title: 'One decision', id: 'one' }], truncated: true };
  input.report.shipped = { available: false, count: null, items: [] };
  const html = views.render(input, { now });
  assert.match(html, /Showing 1 of 20/);
  assert.match(html, /Evidence unavailable/);
});

test('SCN-demo-owner-digest: the real demo transport supplies an isolated saved briefing that stays historical after owner decisions', async () => {
  const demo = globalThis.TorchDemo.createWorkspace({ clock: () => now });
  const other = globalThis.TorchDemo.createWorkspace({ clock: () => now });
  const saved = demo.snapshot().ownerDigest;
  assert.equal(saved.report.needsOwner.count, 1);
  assert.match(views.render(saved, { now }), /Choose the project home layout/);
  const path = '/api/approvals/review-home/decision';
  const input = { decision: 'approved', note: 'Proceed' };
  const preview = await demo.request(path + '/preview', input);
  await demo.request(path, { ...input, token: preview.token, planHash: preview.planHash });
  assert.equal(demo.snapshot().approvalRequests.pendingCount, 0);
  assert.deepEqual(demo.snapshot().ownerDigest, saved, 'a published report is not silently rewritten as live state');
  assert.deepEqual(other.snapshot().ownerDigest, saved);
});
