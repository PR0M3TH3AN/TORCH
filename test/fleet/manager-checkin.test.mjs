import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import { openControlPlane } from '../../src/control-plane/service.mjs';
import { analyzeRepository } from '../../src/kernel/analyze.mjs';
import { proposeDomains } from '../../src/kernel/domains.mjs';
import { inspectRepository } from '../../src/kernel/git.mjs';
import { installProject } from '../../src/kernel/install.mjs';
import { callTorchTool } from '../../src/mcp/tools.mjs';
import { planManagerCheckIn, queueManagerCheckIn } from '../../src/observability/manager-checkin.mjs';
import { BacklogService } from '../../src/backlog/service.mjs';
import { createWorktrees } from '../../src/kernel/worktrees.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'torch-manager-check-in-'));
  execFileSync('git', ['init', '-b', 'main', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'torch-test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'TORCH Test']);
  writeFileSync(join(root, 'app.js'), 'export const app = true;\n');
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'fixture']);
  const repository = inspectRepository(root);
  const proposal = proposeDomains({ repository, analysis: analyzeRepository(repository) });
  proposal.domains.push({
    id: 'peer-ai', title: 'Peer AI', scope: ['Review cross-domain contracts.'], not_scope: [],
    owned_paths: ['peer/**'], shared_paths: [], neighbours: [], required_checks: [],
    resources: [], runtime: 'claude', evidence: [],
  });
  proposal.review = {
    status: 'approved', reviewedAt: '2026-09-28T00:00:00Z', reviewedBy: 'fixture-owner', notes: [],
  };
  const env = { ...process.env, XDG_DATA_HOME: join(tmpdir(), `${basename(root)}-state`) };
  installProject({ repository, proposal, env, projectId: 'manager-check-in-fixture' });
  return { root, env, worker: proposal.domains[0].id };
}

test('SCN-manager-check-in and SCN-manager-check-in-refresh: manager scope follows direct reports, refreshes staleable wakes, and queues one durable non-approving check-in', () => {
  const context = fixture();
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  control.reportStatus({ areaId: context.worker, state: 'waiting', summary: 'Need a decision.', task: 'TASK-42' });
  const managerApproval = control.requestApproval({
    requester: context.worker, approver: 'session-manager', task: 'TASK-42',
    title: 'Accept shared interface', summary: 'Review the proposed event contract.', evidence: 'docs/contracts/event.md',
  });
  const ownerApproval = control.requestApproval({
    requester: context.worker, approver: 'owner', task: 'TASK-42',
    title: 'Approve scope change', summary: 'This changes the agreed project scope.',
  });
  const peerApprover = control.listAgents().find((agent) =>
    agent.areaId !== context.worker && agent.areaId !== 'session-manager')?.areaId;
  assert.ok(peerApprover, 'fixture must include another AI identity');
  const peerApproval = control.requestApproval({
    requester: context.worker, approver: peerApprover, task: 'TASK-42',
    title: 'Review cross-domain contract', summary: 'A peer AI owns this interface decision.',
  });
  control.sendMessage({
    sender: context.worker, recipient: 'session-manager', kind: 'blocker',
    body: 'Task is blocked pending review.', references: { task: 'TASK-42' },
  });

  const plan = planManagerCheckIn({
    repositoryRoot: context.root, controlPlane: control, managerId: 'session-manager',
    at: new Date('2026-09-28T20:00:00Z'),
  });
  assert.equal(plan.directReports.some((report) => report.areaId === context.worker), true);
  assert.equal(plan.attentionRequired, true);
  assert.equal(plan.findings.some((finding) => finding.type === 'waiting-unclassified'), false);
  assert.equal(plan.findings.some((finding) => finding.type === 'approval-wait'), true);
  assert.equal(plan.findings.some((finding) => finding.type === 'unacknowledged-blocker'), true);
  assert.deepEqual(plan.approvalWaits.map((wait) => [wait.id, wait.approverKind]).sort((a, b) => a[0].localeCompare(b[0])), [
    [managerApproval.id, 'manager'], [ownerApproval.id, 'owner'], [peerApproval.id, 'peer-ai'],
  ].sort((a, b) => a[0].localeCompare(b[0])));
  assert.equal(plan.approvalWaitDetection, 'structured');
  assert.equal(plan.mutationPerformed, false);

  const queued = queueManagerCheckIn({ repositoryRoot: context.root, controlPlane: control, managerId: 'session-manager' });
  assert.equal(queued.queued, true);
  const pending = control.readMessages({ recipient: 'session-manager', unacknowledgedOnly: true })
    .find((message) => message.id === queued.messageId);
  assert.equal(pending.kind, 'manager-check-in');
  assert.match(pending.body, /Structured approval waits/);
  assert.match(pending.body, /do not decide on their behalf/);
  assert.match(pending.body, /snapshot captured at/i);
  assert.match(pending.body, /torch_plan_manager_check_in/);

  const lateApproval = control.requestApproval({
    requester: context.worker, approver: 'owner', task: 'TASK-42',
    title: 'Approve newly raised budget', summary: 'This approval appeared after the queued snapshot.',
  });
  const refreshed = callTorchTool(control, 'torch_plan_manager_check_in', {}, {
    actorId: 'session-manager', repositoryRoot: context.root,
  });
  assert.equal(refreshed.managerId, 'session-manager');
  assert.equal(refreshed.approvalWaits.some((wait) => wait.id === lateApproval.id), true,
    'the manager refresh sees approvals created after its durable wake message');
  assert.equal(refreshed.approvalWaits.find((wait) => wait.id === lateApproval.id).approverKind, 'owner');
  assert.throws(() => callTorchTool(control, 'torch_plan_manager_check_in', {}, {
    actorId: context.worker, repositoryRoot: context.root,
  }), (error) => error.code === 'MANAGER_ROLE_NOT_FOUND');

  const duplicate = queueManagerCheckIn({ repositoryRoot: context.root, controlPlane: control, managerId: 'session-manager' });
  assert.equal(duplicate.queued, false);
  assert.equal(duplicate.reason, 'check-in-already-pending');
  assert.equal(control.readMessages({ recipient: 'session-manager' })
    .filter((message) => message.kind === 'manager-check-in').length, 1);
  assert.throws(() => control.decideApproval({
    approvalId: ownerApproval.id, decidedBy: 'session-manager', decision: 'approved',
  }), (error) => error.code === 'APPROVER_AUTHORITY_REQUIRED');
  const decided = control.decideApproval({
    approvalId: ownerApproval.id, decidedBy: 'owner', decision: 'rejected', note: 'Scope needs owner review.',
    expectedRevision: ownerApproval.revision,
  });
  assert.equal(decided.status, 'rejected');
  assert.equal(control.readMessages({ recipient: context.worker }).some((message) =>
    message.kind === 'approval-decision' && message.body.includes('Scope needs owner review.')), true);
  assert.equal(control.listApprovals({ actorId: 'owner' }).some((approval) => approval.id === ownerApproval.id), true);
  control.close();
});

test('SCN-manager-check-in-specialist: a role with no direct reports produces no spurious attention', () => {
  const context = fixture();
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  const result = planManagerCheckIn({
    repositoryRoot: context.root, controlPlane: control, managerId: context.worker,
  });
  assert.deepEqual(result.directReports, []);
  assert.equal(result.attentionRequired, false);
  control.close();
});

test('SCN-manager-stale-work-review: owner requests lead a bounded read-only review, incomplete coverage never invents inactivity', () => {
  const context = fixture();
  execFileSync('git', ['-C', context.root, 'add', '.torch']);
  execFileSync('git', ['-C', context.root, 'commit', '-m', 'approved installed fleet']);
  createWorktrees({ repository: inspectRepository(context.root), parentOverride: join(tmpdir(), `${basename(context.root)}-worktrees`) });
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  try {
    const backlog = new BacklogService({ repositoryRoot: context.root, controlPlane: control,
      clock: () => new Date('2026-09-20T00:00:00Z') });
    const fields = { title: 'Neglected owner request', description: 'Review instead of silently abandoning it.',
      acceptanceCriteria: ['Review evidence'], affectedDomains: [context.worker] };
    const ownerTask = backlog.createOwner({ ...fields, actorId: 'owner' });
    const routine = backlog.create({ ...fields, title: 'Routine request', actorId: 'session-manager' });
    let blocked = backlog.transition({ taskId: routine.id, actorId: 'session-manager',
      to: 'ready', expectedRevision: routine.revision });
    blocked = backlog.transition({ taskId: routine.id, actorId: 'session-manager', to: 'assigned',
      owner: context.worker, expectedRevision: blocked.revision });
    backlog.transition({ taskId: routine.id, actorId: context.worker, to: 'blocked',
      blockedReason: 'Waiting on an external dependency', expectedRevision: blocked.revision });
    const before = readFileSync(join(backlog.root, `${ownerTask.id}.json`), 'utf8');
    const at = new Date('2026-10-05T00:00:00Z');
    const options = { repositoryRoot: context.root, controlPlane: control, managerId: 'session-manager', at };
    assert.equal(planManagerCheckIn(options).staleWorkReview, null, 'review is opt-in');
    const plan = planManagerCheckIn({ ...options, staleWork: { max_items: 1 } });
    assert.equal(plan.staleWorkReview.available, true);
    assert.equal(plan.staleWorkReview.complete, true);
    assert.equal(plan.staleWorkReview.staleCount, 2);
    assert.equal(plan.staleWorkReview.stale[0].taskId, ownerTask.id);
    assert.equal(plan.staleWorkReview.truncated, true);
    assert.equal(plan.findings.filter((finding) => finding.type === 'stale-work').length, 1);
    assert.equal(plan.findings.find((finding) => finding.type === 'stale-work').ownerRequested, true);
    const queued = queueManagerCheckIn({ ...options, staleWork: {} });
    assert.equal(queued.queued, true);
    const message = control.readMessages({ recipient: 'session-manager' }).find((item) => item.id === queued.messageId);
    assert.equal(message.kind, 'manager-stale-work-review');
    assert.match(message.body, /stale_work_review/);
    assert.match(message.body, /do not authorize closing/i);
    assert.equal(queueManagerCheckIn({ ...options, staleWork: {} }).reason, 'check-in-already-pending');
    assert.equal(readFileSync(join(backlog.root, `${ownerTask.id}.json`), 'utf8'), before);
    assert.equal(backlog.get(routine.id).state, 'blocked');
    const full = planManagerCheckIn({ ...options, staleWork: {} });
    assert.equal(full.staleWorkReview.stale.find((task) => task.taskId === routine.id).expectedWaiting, true);
    const unknown = planManagerCheckIn({ ...options, staleWork: { max_commits: 1 } });
    assert.equal(unknown.staleWorkReview.complete, false);
    assert.equal(unknown.staleWorkReview.staleCount, 0);
    assert.equal(unknown.staleWorkReview.unknownCount, 2);
    assert.equal(unknown.findings.some((finding) => finding.type === 'stale-work-coverage-unknown'), true);
    const scoped = planManagerCheckIn({ ...options, managerId: context.worker, staleWork: {} });
    assert.deepEqual(scoped.staleWorkReview.stale, [], 'specialists do not receive unassigned owner requests');
    assert.throws(() => planManagerCheckIn({ ...options, staleWork: { stale_days: 0 } }),
      (error) => error.code === 'MANAGER_STALE_WORK_INPUT_INVALID');
    const mcp = callTorchTool(control, 'torch_plan_manager_check_in', { stale_work_review: true, max_items: 1 },
      { actorId: 'session-manager', repositoryRoot: context.root });
    assert.equal(mcp.staleWorkReview.maxItems, 1);
  } finally { control.close(); }
});
