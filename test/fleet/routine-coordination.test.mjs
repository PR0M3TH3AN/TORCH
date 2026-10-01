import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import { createClaudeAdapter } from '../../src/adapters/claude.mjs';
import { createBacklogService } from '../../src/backlog/service.mjs';
import { openControlPlane } from '../../src/control-plane/service.mjs';
import { analyzeRepository } from '../../src/kernel/analyze.mjs';
import { proposeDomains } from '../../src/kernel/domains.mjs';
import { inspectRepository } from '../../src/kernel/git.mjs';
import { installProject } from '../../src/kernel/install.mjs';
import { createWorktrees } from '../../src/kernel/worktrees.mjs';
import { planAreaUp, startFleet } from '../../src/runtime/lifecycle.mjs';
import { ScheduleService } from '../../src/schedules/service.mjs';

function fixture({ pausedManagerWake = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'torch-routine-coordination-'));
  execFileSync('git', ['init', '-b', 'main', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'torch-test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'TORCH Test']);
  mkdirSync(join(root, 'test'));
  writeFileSync(join(root, 'app.js'), 'export const app = true;\n');
  writeFileSync(join(root, 'test', 'app.test.js'), '// independent verification surface\n');
  writeFileSync(join(root, 'test', 'integration.test.js'), '// independent integration surface\n');
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'fixture']);
  const repository = inspectRepository(root);
  const proposal = proposeDomains({ repository, analysis: analyzeRepository(repository) });
  if (pausedManagerWake) {
    const schedule = proposal.schedules.find((entry) => entry.action?.type === 'manager-check-in');
    assert.ok(schedule, 'fixture must configure the Session Manager check-in schedule');
    schedule.action = { ...schedule.action, wake: { enabled: false } };
  }
  proposal.review = {
    status: 'approved', reviewedAt: '2026-09-30T00:00:00Z', reviewedBy: 'fixture-owner', notes: [],
  };
  const env = { ...process.env, XDG_DATA_HOME: join(tmpdir(), `${basename(root)}-state`) };
  installProject({ repository, proposal, env, projectId: 'routine-coordination-fixture' });
  execFileSync('git', ['-C', root, 'add', '.torch']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'install torch']);
  createWorktrees({ repository: inspectRepository(root),
    parentOverride: join(tmpdir(), `${basename(root)}-worktrees`) });
  const worker = proposal.domains.find((domain) => domain.id !== 'qa')?.id;
  const peer = proposal.domains.find((domain) => domain.id === 'qa')?.id;
  assert.ok(worker, 'fixture must provide an implementation specialist');
  assert.ok(peer, 'fixture must provide an independent peer');
  return { root, env, worker, peer };
}

test('SCN-routine-coordination-instructions: a fresh install gives common, manager, specialist, and resume surfaces the same bounded policy', () => {
  const context = fixture();
  const files = [
    join(context.root, '.torch', 'prompts', 'COMMON.md'),
    join(context.root, '.torch', 'prompts', 'session-manager.md'),
    join(context.root, '.torch', 'prompts', `${context.worker}.md`),
    join(context.root, '.torch', 'RESUME-BRIEF.md'),
  ].map((path) => readFileSync(path, 'utf8'));
  for (const text of files) {
    assert.match(text, /acknowledgement does not resolve tasks, approvals, or waits|it never resolves its linked task, approval, handoff, or wait/);
    assert.match(text, /responsible peer directly|directly with responsible peers/);
    assert.match(text, /paused execution/);
  }
  assert.match(files[0], /spending or provider changes, remote publication, release or deployment/);
  assert.match(files[1], /cannot decide an owner approval or another specialist's approval/);
  assert.match(files[2], /Do not start providers, change wake\/timer\/budget policy, dispatch arbitrary work/);
});

test('SCN-routine-coordination-boundaries: acknowledgement leaves work pending and only the named approver can decide', () => {
  const context = fixture();
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env,
    clock: () => new Date('2026-09-30T12:00:00Z') });
  try {
    const backlog = createBacklogService({ repositoryRoot: context.root, controlPlane: control });
    const created = backlog.create({ actorId: 'session-manager', title: 'Bounded coordination',
      description: 'Keep the wait visible until an authority acts.', acceptanceCriteria: ['Evidence is retained.'],
      affectedDomains: [context.worker] });
    const ready = backlog.transition({ taskId: created.id, actorId: 'session-manager', to: 'ready',
      expectedRevision: created.revision });
    const assigned = backlog.transition({ taskId: ready.id, actorId: 'session-manager', to: 'assigned',
      owner: context.worker, expectedRevision: ready.revision });
    const taskMessage = control.sendMessage({ sender: 'session-manager', recipient: context.worker,
      body: 'Work is assigned; preserve the decision wait.', references: { task: assigned.id } });
    control.ackMessage({ recipient: context.worker, messageId: taskMessage.id });
    assert.equal(backlog.get(assigned.id).state, 'assigned', 'reading a task message cannot complete or advance work');

    const peerApproval = control.requestApproval({ requester: context.worker, approver: context.peer,
      task: assigned.id, title: 'Peer path consent', summary: 'Confirm the public boundary.', evidence: 'test/fleet/routine-coordination.test.mjs' });
    const peerMessage = control.readMessages({ recipient: context.peer, unacknowledgedOnly: true })
      .find((message) => message.kind === 'approval-request' && message.references.task === assigned.id);
    assert.ok(peerMessage, 'the named approver receives a durable approval request');
    control.ackMessage({ recipient: context.peer, messageId: peerMessage.id });
    assert.equal(control.listApprovals({ actorId: context.peer, status: 'pending' })[0].id, peerApproval.id,
      'acknowledging an approval request cannot decide it');
    assert.throws(() => control.decideApproval({ approvalId: peerApproval.id, decidedBy: 'session-manager',
      decision: 'approved', expectedRevision: peerApproval.revision }),
    (error) => error.code === 'APPROVER_AUTHORITY_REQUIRED');
    const peerDecision = control.decideApproval({ approvalId: peerApproval.id, decidedBy: context.peer,
      decision: 'approved', expectedRevision: peerApproval.revision, note: 'Boundary reviewed.' });
    assert.equal(peerDecision.status, 'approved');
    assert.equal(peerDecision.decidedBy, context.peer);

    const ownerApproval = control.requestApproval({ requester: context.worker, approver: 'owner', task: assigned.id,
      title: 'Owner scope decision', summary: 'A peer cannot make this owner decision.' });
    assert.throws(() => control.decideApproval({ approvalId: ownerApproval.id, decidedBy: 'session-manager',
      decision: 'approved', expectedRevision: ownerApproval.revision }),
    (error) => error.code === 'APPROVER_AUTHORITY_REQUIRED');
    assert.equal(control.listApprovals({ actorId: context.worker, status: 'pending' }).some((item) =>
      item.id === ownerApproval.id), true, 'a rejected manager attempt leaves the owner decision pending');
  } finally {
    control.close();
  }
});

test('SCN-routine-coordination-paused-dispatch: an unapproved public start leaves work and owner waits unresolved', () => {
  const context = fixture();
  let adapterCalls = 0;
  const adapter = createClaudeAdapter({ executable: 'claude', runner: () => {
    adapterCalls++;
    throw new Error('A disabled provider must not run.');
  } });
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env,
    clock: () => new Date('2026-09-30T12:00:00Z') });
  try {
    const backlog = createBacklogService({ repositoryRoot: context.root, controlPlane: control });
    const created = backlog.create({ actorId: 'session-manager', title: 'Paused dispatch boundary',
      description: 'Keep assigned work visible while provider execution is disabled.',
      acceptanceCriteria: ['The start boundary fails closed.'], affectedDomains: [context.worker] });
    const ready = backlog.transition({ taskId: created.id, actorId: 'session-manager', to: 'ready',
      expectedRevision: created.revision });
    const assigned = backlog.transition({ taskId: ready.id, actorId: 'session-manager', to: 'assigned',
      owner: context.worker, expectedRevision: ready.revision });
    const taskMessage = control.sendMessage({ sender: 'session-manager', recipient: context.worker,
      body: 'Wait for explicit provider authorization.', references: { task: assigned.id } });
    control.ackMessage({ recipient: context.worker, messageId: taskMessage.id });
    const peerApproval = control.requestApproval({ requester: context.worker, approver: context.peer,
      task: assigned.id, title: 'Peer consent', summary: 'Approve the bounded routine path.' });
    control.decideApproval({ approvalId: peerApproval.id, decidedBy: context.peer, decision: 'approved',
      expectedRevision: peerApproval.revision, note: 'Routine path reviewed.' });
    const ownerWait = control.requestApproval({ requester: context.worker, approver: 'owner', task: assigned.id,
      title: 'Owner provider decision', summary: 'Provider execution remains owner-reserved.' });

    const plan = planAreaUp({ repositoryRoot: context.root, controlPlane: control, areaId: context.worker,
      adapter, fresh: true });
    assert.equal(plan.canProceed, true, JSON.stringify(plan.blockers));
    assert.throws(() => startFleet({ plan, controlPlane: control }),
      (error) => error.code === 'RUNTIME_EXECUTION_NOT_AUTHORIZED');
    assert.equal(adapterCalls, 0, 'the disabled public start cannot invoke a provider adapter');
    assert.equal(backlog.get(assigned.id).state, 'assigned', 'acknowledgement and refusal cannot complete work');
    assert.equal(control.listApprovals({ actorId: context.worker, status: 'pending' }).some((item) =>
      item.id === ownerWait.id), true, 'the owner wait remains visible after the blocked start');
    assert.equal(control.identity(context.worker).state, 'offline', 'a blocked start cannot report false idle or success');
  } finally {
    control.close();
  }
});

test('SCN-routine-coordination-paused-schedule-dispatch: configured paused wakes queue attention without a provider invocation', () => {
  const context = fixture({ pausedManagerWake: true });
  const at = new Date('2026-09-30T12:00:00Z');
  let providerWakeCalls = 0;
  let commandCalls = 0;
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env, clock: () => at });
  try {
    const backlog = createBacklogService({ repositoryRoot: context.root, controlPlane: control });
    const created = backlog.create({ actorId: 'session-manager', title: 'Paused scheduled dispatch',
      description: 'Keep assigned work and the owner wait visible while wakes are paused.',
      acceptanceCriteria: ['The paused schedule queues review without a provider invocation.'],
      affectedDomains: [context.worker] });
    const ready = backlog.transition({ taskId: created.id, actorId: 'session-manager', to: 'ready',
      expectedRevision: created.revision });
    const assigned = backlog.transition({ taskId: ready.id, actorId: 'session-manager', to: 'assigned',
      owner: context.worker, expectedRevision: ready.revision });
    control.reportStatus({ areaId: context.worker, state: 'waiting', task: assigned.id,
      summary: 'Waiting for the owner provider decision.' });
    const ownerWait = control.requestApproval({ requester: context.worker, approver: 'owner', task: assigned.id,
      title: 'Owner provider decision', summary: 'Automatic provider execution is paused.' });
    const schedules = new ScheduleService({
      repositoryRoot: context.root, controlPlane: control, clock: () => at,
      executor: () => { commandCalls++; throw new Error('Manager check-in must not invoke a shell command.'); },
      wakeManager: {
        plan: () => { providerWakeCalls++; throw new Error('A paused schedule must not plan a provider wake.'); },
        invoke: () => { providerWakeCalls++; throw new Error('A paused schedule must not invoke a provider.'); },
      },
    });

    const plan = schedules.plan({ scheduleId: 'session-manager-check-in', actorId: 'owner', at });
    assert.equal(plan.wakeEnabled, false, 'the installed schedule must expose an explicit paused wake policy');
    assert.deepEqual(plan.schedule.action.wake, { enabled: false });
    const dispatched = schedules.dispatchSystem({ actorId: 'owner', approved: true, at });
    assert.deepEqual(dispatched.due, ['session-manager-check-in']);
    assert.equal(dispatched.runs[0].result, 'succeeded');
    const observed = JSON.parse(dispatched.runs[0].stdout);
    assert.equal(observed.checkIn.queued, true);
    assert.equal(observed.wake.attempted, false);
    assert.equal(observed.wake.reason, 'wake-disabled');
    assert.equal(providerWakeCalls, 0, 'the public scheduled dispatch cannot plan or invoke a paused provider');
    assert.equal(commandCalls, 0, 'the typed check-in cannot fall through to a shell command');
    assert.equal(backlog.get(assigned.id).state, 'assigned', 'the scheduled review cannot complete assigned work');
    assert.equal(control.listApprovals({ actorId: context.worker, status: 'pending' }).some((item) =>
      item.id === ownerWait.id), true, 'the owner decision remains a durable wait');
    assert.equal(control.identity(context.worker).state, 'waiting', 'the worker cannot report false idle or success');
    assert.equal(control.identity('session-manager').state, 'offline', 'queued review cannot report a manager provider turn');
    assert.equal(control.readMessages({ recipient: 'session-manager', unacknowledgedOnly: true })
      .some((message) => message.kind === 'manager-check-in'), true, 'the manager receives durable attention instead of a wake');
  } finally {
    control.close();
  }
});
