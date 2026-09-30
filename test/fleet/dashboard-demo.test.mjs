import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../../site/demo.js', import.meta.url), 'utf8');
function workspace() {
  const context = { URLSearchParams };
  runInNewContext(source, context);
  assert.equal(context.TorchConsoleDemo, undefined, 'live Console does not acquire demo state');
  return context.TorchDemo.createWorkspace({ clock: () => new Date('2026-09-29T12:00:00Z') });
}
const confirm = (demo, path, payload, preview) => demo.request(path, {
  ...payload, token: preview.token, planHash: preview.planHash,
});

test('SCN-dashboard-demo: pilot conclusions block unsupported adoption and reverse only after sample confirmation', async () => {
  const demo = workspace();
  const path = '/api/organization-proposals/hierarchy-conclusion/sample-coordination-pilot';
  const blocked = await demo.request(path + '/preview', { action: 'adopt', reason: 'Try adoption.' });
  assert.equal(blocked.plan.canProceed, false);
  assert.equal(blocked.token, null);
  const payload = { action: 'reverse', reason: 'Restore direct reporting.' };
  const preview = await demo.request(path + '/preview', payload);
  assert.equal(demo.snapshot().hierarchyProposals[0].state, 'piloting');
  const before = demo.snapshot();
  await assert.rejects(confirm(demo, path, { ...payload, action: 'adopt' }, preview), /Review/);
  const result = await confirm(demo, path, payload, preview);
  assert.equal(result.proposal.state, 'reversed');
  assert.equal(demo.snapshot().organization.graph.revision, before.organization.graph.revision + 1);
  assert.equal(demo.snapshot().agents.length, before.agents.length);
  assert.equal(JSON.stringify(demo.snapshot().backlog), JSON.stringify(before.backlog));
  assert.equal((await confirm(demo, path, payload, preview)).proposal.state, 'reversed');
});

test('SCN-dashboard-demo: owner actions use isolated sample state with preview and confirmation', async () => {
  const demo = workspace();
  const other = workspace();
  const path = '/api/backlog/tasks/API-08/priority';
  const payload = { priority: 'urgent', reason: 'Needed for the beta', expectedRevision: 1 };
  const preview = await demo.request(path + '/preview', payload);
  assert.equal(demo.snapshot().backlog.find((task) => task.id === 'API-08').priority, 'high');
  await assert.rejects(confirm(demo, path, { ...payload, priority: 'low' }, preview), /Review/);
  const result = await confirm(demo, path, payload, preview);
  assert.equal(result.task.priority, 'urgent');
  assert.equal(result.task.owner, 'services');
  assert.equal(result.task.state, 'in_progress');
  await confirm(demo, path, payload, preview);
  assert.equal(demo.snapshot().backlog.find((task) => task.id === 'API-08').revision, 2);
  assert.equal(other.snapshot().backlog.find((task) => task.id === 'API-08').priority, 'high');
  demo.reset();
  assert.equal(demo.snapshot().backlog.find((task) => task.id === 'API-08').priority, 'high');
});

test('SCN-dashboard-demo: feedback, requests, approvals and profiles update the same sample project', async () => {
  const demo = workspace();
  const feedbackPath = '/api/artifacts/home-wireframe/feedback';
  const payload = { body: 'Give active work more room.' };
  const review = await demo.request(feedbackPath + '/preview', payload);
  assert.equal(review.preview.recipient, 'interface');
  assert.equal(demo.snapshot().artifacts.items[0].feedback.length, 1);
  await confirm(demo, feedbackPath, payload, review);
  assert.equal(demo.snapshot().artifacts.items[0].feedback.length, 2);
  assert.equal(demo.snapshot().messages.recent[0].body, payload.body);

  const requestPath = '/api/owner-requests';
  const request = { recipient: 'qa', body: 'Review the home layout.', taskId: 'APP-12' };
  const requestPreview = await demo.request(requestPath + '/preview', request);
  await confirm(demo, requestPath, { taskId: request.taskId, recipient: request.recipient, body: request.body }, requestPreview);
  assert.equal(demo.snapshot().messages.recent[0].recipient, 'qa');

  const approvalPath = '/api/approvals/review-home/decision';
  const decision = { decision: 'approved', note: 'Proceed with the layout.' };
  await confirm(demo, approvalPath, decision, await demo.request(approvalPath + '/preview', decision));
  assert.equal(demo.snapshot().approvalRequests.pendingCount, 0);
  assert.equal(demo.snapshot().approvalRequests.items[0].status, 'approved');

  const profilePath = '/api/runtime-profiles';
  const profile = { areaId: 'interface', runtime: 'claude', model: '', reasoning: '' };
  await confirm(demo, profilePath, profile, await demo.request(profilePath + '/preview', profile));
  const agent = demo.snapshot().agents.find((item) => item.areaId === 'interface');
  assert.equal(agent.runtime, 'claude');
  assert.equal(agent.model, 'sonnet');
  assert.equal(agent.reasoning, null);
  assert.equal(agent.state, 'waiting');
  await assert.rejects(demo.request('/api/schedule-launcher/preview', { action: 'install' }), /unavailable/);
});
