import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openControlPlane } from '../../src/control-plane/service.mjs';
import { analyzeRepository } from '../../src/kernel/analyze.mjs';
import { proposeDomains } from '../../src/kernel/domains.mjs';
import { inspectRepository } from '../../src/kernel/git.mjs';
import { installProject, planUninstall } from '../../src/kernel/install.mjs';
import { ScheduleService } from '../../src/schedules/service.mjs';
import { assertLauncherDigest, ScheduleLauncherService } from '../../src/schedules/launcher.mjs';
import { organizationGraphFromConfig, planManagerCheckInSchedules } from '../../src/kernel/organization.mjs';
import { loadProjectConfig, validateProjectConfig } from '../../src/kernel/config.mjs';
import { CheckService } from '../../src/checks/service.mjs';
import { IntegrationService } from '../../src/integration/service.mjs';
import { createWorktrees } from '../../src/kernel/worktrees.mjs';

test('SCN-systemd-native-unit: generated dispatcher is accepted by the real systemd parser', (t) => {
  if (process.platform !== 'linux') return t.skip('Native systemd qualification is Linux-specific');
  const context = fixture();
  const alias = join(mkdtempSync(join(tmpdir(), 'torch-unit-path-')), 'project space % "quoted"');
  symlinkSync(context.root, alias, 'dir');
  const launcher = new ScheduleLauncherService({ repositoryRoot: alias, env: context.env, command: ['/usr/bin/true'] });
  const plan = launcher.plan();
  const service = plan.files.find(file => file.name.endsWith('.service'));
  const directory = mkdtempSync(join(tmpdir(), 'torch-systemd-verify-'));
  const path = join(directory, service.name);
  writeFileSync(path, service.content);
  assert.match(service.content, /WorkingDirectory=\//);
  assert.ok(!service.content.includes('WorkingDirectory="'));
  assert.ok(service.content.includes('project\\x20space\\x20%%\\x20\\x22quoted\\x22'));
  const checked = spawnSync('systemd-analyze', ['--user', 'verify', path], { encoding: 'utf8' });
  assert.equal(checked.error, undefined, checked.error?.message);
  assert.equal(checked.status, 0, checked.stderr);
});
import { createRuntimeAdapterRegistry } from '../../src/adapters/registry.mjs';
import { planAreaUp } from '../../src/runtime/lifecycle.mjs';
import { observeProject } from '../../src/observability/snapshot.mjs';
import { BacklogService } from '../../src/backlog/service.mjs';

const CLI = new URL('../../bin/torch.mjs', import.meta.url).pathname;

function fixture({ managerCheckIn = false, managerWake = null, maxInvocationsPerDay = null, integrationDrain = false, runtimes, managerModel, staleWork } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'torch-schedules-'));
  execFileSync('git', ['init', '-b', 'main', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'torch-test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'TORCH Test']);
  writeFileSync(join(root, 'app.js'), 'export const app = true;\n');
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'fixture']);
  const repository = inspectRepository(root);
  const proposal = proposeDomains({ repository, analysis: analyzeRepository(repository) });
  if (managerModel) proposal.session_manager = { model: managerModel };
  const worker = proposal.domains[0].id;
  proposal.schedules = [
    {
      id: 'fleet-hygiene', title: 'Fleet hygiene', owner: 'session-manager', lifetime: 'session',
      trigger: { type: 'interval', seconds: 900 }, behavior: 'read-only',
      action: { type: 'command', command: process.execPath, args: ['-e', 'process.stdout.write("healthy")'] },
      required_authority: ['session-manager'], retry: { max_attempts: 1 },
      failure_recipient: 'session-manager', source_of_truth: 'fixture proposal',
    },
    {
      id: 'domain-audit', title: 'Domain audit', owner: worker, lifetime: 'session',
      trigger: { type: 'manual' }, behavior: 'read-only',
      action: { type: 'command', command: 'audit-fixture', args: [] },
      required_authority: [worker], retry: { max_attempts: 2 },
      failure_recipient: 'session-manager', source_of_truth: 'fixture proposal',
    },
    {
      id: 'release', title: 'Release', owner: 'owner', lifetime: 'system',
      trigger: { type: 'cron', expression: '0 8,16 * * *' }, behavior: 'mutating',
      action: { type: 'command', command: 'release-fixture', args: [] },
      required_authority: ['owner'], retry: { max_attempts: 1 },
      failure_recipient: 'session-manager', source_of_truth: 'fixture proposal',
    },
  ];
  if (managerCheckIn) {
    proposal.schedules.push({
      id: 'manager-check-in', title: 'Session manager check-in', owner: 'session-manager',
      lifetime: 'system', trigger: { type: 'interval', seconds: 900 }, behavior: 'coordination',
      action: {
        type: 'manager-check-in', manager_id: 'session-manager',
        ...(staleWork ? { stale_work: staleWork } : {}),
        ...(managerWake ? { wake: managerWake } : {}),
      },
      required_authority: ['owner'], retry: { max_attempts: 1 },
      failure_recipient: 'session-manager', source_of_truth: 'active organization direct-report graph',
    });
  }
  if (integrationDrain) {
    proposal.checks.push({
      id: 'drain-pass', title: 'Drain queue check', command: process.execPath,
      args: ['-e', 'process.exit(0)'], resources: [],
    });
    proposal.schedules.push({
      id: 'integration-drain', title: 'Authorized integration queue drain', owner: 'owner',
      lifetime: 'system', trigger: { type: 'interval', seconds: 60 }, behavior: 'mutating',
      action: { type: 'integration-drain', landing_authority_id: 'session-manager', limit: 20 },
      required_authority: ['owner'], retry: { max_attempts: 1 },
      failure_recipient: 'session-manager', source_of_truth: 'owner-approved integration policy',
    });
  }
  if (managerWake) {
    proposal.runtime_wake_budget = { max_invocations_per_day: maxInvocationsPerDay };
    proposal.schedules.push({
      ...structuredClone(proposal.schedules.find((entry) => entry.action?.type === 'manager-check-in')),
      id: 'manager-check-in-secondary', title: 'Secondary manager check-in schedule',
    });
  }
  proposal.review = {
    status: 'approved', reviewedAt: '2026-09-27T00:00:00Z', reviewedBy: 'fixture-owner', notes: [],
  };
  const env = {
    ...process.env,
    XDG_DATA_HOME: mkdtempSync(join(tmpdir(), 'torch-schedules-state-')),
    XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), 'torch-schedules-config-')),
  };
  installProject({ repository, proposal, env, projectId: 'schedule-fixture', runtimes });
  return { root, env, worker };
}

test('SCN-scheduled-stale-work-review: daily owner-approved cadence delivers one bounded review without task mutation or runtime invocation', () => {
  const context = fixture({ managerCheckIn: true, staleWork: { stale_days: 3, max_items: 10 } });
  const configPath = join(context.root, '.torch', 'torch.yaml');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.schedules.find((entry) => entry.id === 'manager-check-in').trigger = { type: 'cron', expression: '17 9 * * *' };
  writeFileSync(configPath, JSON.stringify(config));
  execFileSync('git', ['-C', context.root, 'add', '.torch']);
  execFileSync('git', ['-C', context.root, 'commit', '-m', 'approve daily stale review']);
  createWorktrees({ repository: inspectRepository(context.root), parentOverride: mkdtempSync(join(tmpdir(), 'torch-stale-worktrees-')) });
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  try {
    const backlog = new BacklogService({ repositoryRoot: context.root, controlPlane: control,
      clock: () => new Date('2026-09-20T00:00:00Z') });
    const task = backlog.createOwner({ actorId: 'owner', title: 'Review neglected request',
      description: 'Keep this visible.', acceptanceCriteria: ['Owner request is reviewed.'], affectedDomains: [context.worker] });
    const before = readFileSync(join(backlog.root, `${task.id}.json`), 'utf8');
    // Cron uses the host's local timezone, not UTC wake-budget boundaries.
    const at = new Date(2026, 9, 5, 9, 17);
    const schedules = new ScheduleService({ repositoryRoot: context.root, controlPlane: control,
      clock: () => at, executor: () => { throw new Error('Review must not invoke a shell command'); } });
    assert.equal(schedules.plan({ scheduleId: 'manager-check-in', actorId: 'owner', at }).due, true);
    assert.equal(schedules.plan({ scheduleId: 'manager-check-in', actorId: 'owner', at: new Date(2026, 9, 5, 9, 16) }).due, false);
    assert.throws(() => schedules.run({ scheduleId: 'manager-check-in', actorId: 'owner' }),
      (error) => error.code === 'APPROVAL_REQUIRED');
    const result = schedules.run({ scheduleId: 'manager-check-in', actorId: 'owner', approved: true });
    assert.equal(result.result, 'succeeded', result.stderr);
    const review = JSON.parse(result.stdout);
    assert.equal(review.checkIn.staleWorkReview.stale[0].taskId, task.id);
    assert.equal(review.wake.attempted, false);
    assert.equal(review.checkIn.queued, true);
    assert.equal(schedules.plan({ scheduleId: 'manager-check-in', actorId: 'owner', at }).due, false);
    const repeated = JSON.parse(schedules.run({ scheduleId: 'manager-check-in', actorId: 'owner', approved: true }).stdout);
    assert.equal(repeated.checkIn.reason, 'check-in-already-pending');
    assert.equal(control.readMessages({ recipient: 'session-manager' }).filter((item) => item.kind === 'manager-stale-work-review').length, 1);
    assert.equal(readFileSync(join(backlog.root, `${task.id}.json`), 'utf8'), before);
    config.schedules.find((entry) => entry.id === 'manager-check-in').action.stale_work.max_items = 0;
    assert.throws(() => validateProjectConfig(config));
  } finally { control.close(); }
});

test('SCN-schedule-boundaries: validated lifetimes, authority, retries, and approval govern shell-free actions', () => {
  const context = fixture();
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  const calls = [];
  const service = new ScheduleService({
    repositoryRoot: context.root, controlPlane: control,
    clock: () => new Date('2026-09-27T12:00:00Z'), idFactory: (() => { let id = 0; return () => `run-${++id}`; })(),
    executor: (command, args, options) => {
      calls.push({ command, args, options });
      return command === 'audit-fixture'
        ? { status: 1, stdout: '', stderr: 'audit failed' }
        : { status: 0, stdout: 'ok', stderr: '' };
    },
  });
  assert.deepEqual(service.plan({ scheduleId: 'fleet-hygiene', actorId: 'session-manager' }).blockers, ['session-manager-offline']);
  control.reportStatus({ areaId: 'session-manager', state: 'idle', summary: 'Scheduling.' });
  const hygiene = service.run({ scheduleId: 'fleet-hygiene', actorId: 'session-manager' });
  assert.equal(hygiene.result, 'succeeded');
  assert.equal(calls[0].options.shell, false);

  const failed = service.run({ scheduleId: 'domain-audit', actorId: context.worker });
  assert.equal(failed.result, 'failed');
  assert.equal(failed.attempts, 2);
  assert.equal(control.readMessages({ recipient: 'session-manager' }).at(-1).kind, 'blocker');
  assert.throws(() => service.run({ scheduleId: 'release', actorId: 'owner' }),
    (error) => error.code === 'APPROVAL_REQUIRED');
  assert.equal(service.run({ scheduleId: 'release', actorId: 'owner', approved: true }).result, 'succeeded');
  assert.equal(service.runs({}).length, 3);
  control.close();
});

test('SCN-scheduled-integration-drain: only owner-approved timer dispatch drains individually authorized exact-check requests', () => {
  const context = fixture({ integrationDrain: true });
  const reviewedConfig = loadProjectConfig(context.root);
  const invalidCadence = structuredClone(reviewedConfig);
  invalidCadence.schedules.find((entry) => entry.action.type === 'integration-drain').trigger.seconds = 59;
  assert.throws(() => validateProjectConfig(invalidCadence), (error) =>
    error.code === 'CONFIG_SCHEMA_INVALID'
      && error.details.some((issue) => issue.path === 'schedules.3.trigger.seconds'));
  execFileSync('git', ['-C', context.root, 'add', '.torch']);
  execFileSync('git', ['-C', context.root, 'commit', '-m', 'install schedule drain fixture']);
  createWorktrees({
    repository: inspectRepository(context.root),
    parentOverride: join(tmpdir(), `${context.root.split('/').at(-1)}-worktrees`),
  });
  execFileSync('git', ['-C', context.root, 'add', '.torch/install-manifest.json']);
  execFileSync('git', ['-C', context.root, 'commit', '-m', 'record schedule fixture worktrees']);
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  const manifest = JSON.parse(readFileSync(join(context.root, '.torch', 'install-manifest.json'), 'utf8'));
  const worker = manifest.external.find((entry) => entry.type === 'worktree' && entry.area === context.worker);
  execFileSync('git', ['-C', worker.path, 'merge', 'main']);
  writeFileSync(join(worker.path, 'app.js'), 'export const app = "scheduled integration";\n');
  execFileSync('git', ['-C', worker.path, 'add', 'app.js']);
  execFileSync('git', ['-C', worker.path, 'commit', '-m', 'scheduled integration candidate']);
  const checks = new CheckService({ repositoryRoot: context.root, controlPlane: control });
  const receipt = checks.run({ checkId: 'drain-pass', areaId: context.worker });
  assert.equal(receipt.result, 'pass');
  const integration = new IntegrationService({ repositoryRoot: context.root, controlPlane: control, checkService: checks });
  const request = integration.request({ areaId: context.worker, commit: receipt.commit });
  assert.equal(request.state, 'ready');

  const launcher = new ScheduleLauncherService({
    repositoryRoot: context.root, env: context.env,
    executor: () => ({ status: 0, stdout: '', stderr: '' }),
  });
  assert.equal(launcher.status().installed, false, 'adding a schedule does not install or start the system timer');

  let now = new Date('2026-09-29T15:00:00Z');
  const schedules = new ScheduleService({ repositoryRoot: context.root, controlPlane: control, clock: () => now });
  const firstTick = schedules.dispatchSystem({ actorId: 'owner', approved: true, at: now });
  assert.deepEqual(firstTick.due, ['integration-drain']);
  assert.equal(JSON.parse(firstTick.runs[0].stdout).processed, 0,
    'an unapproved request is not landed by the schedule');
  const main = () => execFileSync('git', ['-C', context.root, 'rev-parse', 'main'], { encoding: 'utf8' }).trim();
  assert.notEqual(main(), receipt.commit);

  integration.authorize({ requestId: request.id, actorId: 'session-manager' });
  now = new Date('2026-09-29T15:01:00Z');
  const secondTick = schedules.dispatchSystem({ actorId: 'owner', approved: true, at: now });
  assert.deepEqual(secondTick.due, ['integration-drain']);
  assert.equal(JSON.parse(secondTick.runs[0].stdout).landed, 1);
  assert.equal(integration.get(request.id).state, 'landed');
  assert.equal(main(), receipt.commit);
  control.close();
});

test('SCN-manager-check-in-count-mode: built-in runtimes plan count-limited wakes, recover pending delivery, and share a UTC budget', () => {
  for (const runtime of ['codex', 'claude', 'pi']) {
    const context = fixture({ managerCheckIn: true,
      managerWake: { enabled: true, budget_mode: 'invocation-count' },
      maxInvocationsPerDay: 1, runtimes: [runtime],
      managerModel: runtime === 'pi' ? 'openai/test-model' : undefined });
    execFileSync('git', ['-C', context.root, 'add', '.torch']);
    execFileSync('git', ['-C', context.root, 'commit', '-m', 'install count-limited fixture']);
    createWorktrees({ repository: inspectRepository(context.root),
      parentOverride: mkdtempSync(join(tmpdir(), 'torch-count-wake-worktrees-')) });
    const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
    try {
      let at = new Date('2026-09-29T20:00:00Z');
      control.reportStatus({ areaId: context.worker, state: 'waiting', summary: 'Waiting for a manager ruling.' });
      const options = { repositoryRoot: context.root, controlPlane: control, clock: () => at };
      const pending = new ScheduleService(options).run({ scheduleId: 'manager-check-in', actorId: 'owner', approved: true });
      assert.equal(JSON.parse(pending.stdout).wake.reason, 'manager-runtime-waker-unavailable');
      let calls = 0;
      const adapters = createRuntimeAdapterRegistry({ env: context.env }).toMap();
      const schedules = new ScheduleService({ ...options, wakeManager: {
        plan: ({ managerId, maxUsd }) => {
          assert.equal(maxUsd, undefined);
          return { plan: planAreaUp({ repositoryRoot: context.root, controlPlane: control,
            areaId: managerId, adapters, maxCostUsd: maxUsd }) };
        },
        invoke: ({ prepared, maxUsd }) => {
          assert.equal(maxUsd, undefined);
          assert.equal(prepared.plan.canProceed, true, JSON.stringify(prepared.plan.blockers));
          assert.equal(prepared.plan.actions.length, 1);
          assert.equal(prepared.plan.actions[0].runtime, runtime);
          assert.equal(prepared.plan.actions[0].costCeiling, undefined);
          calls++;
          return { simulated: true, runtime };
        },
      } });
      const input = { scheduleId: 'manager-check-in', actorId: 'owner', approved: true };
      assert.equal(schedules.plan(input).wakeBudgetMode, 'invocation-count');
      const first = JSON.parse(schedules.run(input).stdout);
      assert.equal(first.checkIn.reason, 'check-in-already-pending');
      assert.equal(first.wake.attempted, true, runtime + ': ' + JSON.stringify(first.wake));
      assert.equal(first.wake.dollarCapEnforced, false);
      assert.equal(first.wake.maxUsd, undefined);
      const repeat = JSON.parse(schedules.run(input).stdout);
      assert.equal(repeat.wake.reason, 'manager-wake-already-attempted');
      assert.equal(calls, 1);
      control.ackMessage({ recipient: 'session-manager', messageId: first.checkIn.messageId });
      const exhausted = JSON.parse(schedules.run({ ...input, scheduleId: 'manager-check-in-secondary' }).stdout);
      assert.equal(exhausted.wake.reason, 'daily-invocation-budget-exhausted');
      assert.equal(calls, 1);
      at = new Date('2026-09-30T00:00:01Z');
      assert.equal(JSON.parse(schedules.run(input).stdout).wake.attempted, true);
      assert.equal(calls, 2);
    } finally { control.close(); }
  }
});

test('SCN-manager-wake-reservation: overlapping schedules cannot invoke the same manager twice', () => {
  const context = fixture({ managerCheckIn: true,
    managerWake: { enabled: true, budget_mode: 'invocation-count' }, maxInvocationsPerDay: 3 });
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  try {
    control.reportStatus({ areaId: context.worker, state: 'waiting', summary: 'Awaiting a ruling.' });
    let calls = 0;
    const options = { repositoryRoot: context.root, controlPlane: control };
    const plan = ({ managerId }) => ({ plan: { canProceed: true, actions: [{ areaId: managerId }] } });
    const second = new ScheduleService({ ...options, wakeManager: { plan,
      invoke: () => { calls++; throw new Error('A concurrent manager must not be invoked.'); } } });
    const first = new ScheduleService({ ...options, wakeManager: { plan,
      invoke: ({ checkIn }) => {
        calls++;
        control.ackMessage({ recipient: 'session-manager', messageId: checkIn.messageId });
        const overlap = second.run({ scheduleId: 'manager-check-in-secondary', actorId: 'owner', approved: true });
        assert.equal(JSON.parse(overlap.stdout).wake.reason, 'manager-runtime-already-active');
        return { simulated: true };
      } } });
    first.run({ scheduleId: 'manager-check-in', actorId: 'owner', approved: true });
    assert.equal(calls, 1);
    assert.equal(control.database.prepare('SELECT COUNT(*) AS count FROM schedule_wake_reservations').get().count, 1);
  } finally { control.close(); }
});

test('SCN-manager-wake-recovery: interrupted launches require owner stopped-runtime evidence and retain replay and budget guards', () => {
  const context = fixture({ managerCheckIn: true,
    managerWake: { enabled: true, budget_mode: 'invocation-count' }, maxInvocationsPerDay: 1 });
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  try {
    let calls = 0;
    const service = new ScheduleService({ repositoryRoot: context.root, controlPlane: control,
      clock: () => new Date('2026-09-30T12:00:00Z'),
      wakeManager: { plan: ({ managerId }) => ({ plan: { canProceed: true, actions: [{ areaId: managerId }] } }),
        invoke: () => { calls++; return { simulated: true }; } },
    });
    assert.deepEqual(service.wakeReservations(), []);
    control.reportStatus({ areaId: context.worker, state: 'waiting', summary: 'Awaiting a decision.' });
    service.run({ scheduleId: 'manager-check-in', actorId: 'owner', approved: true });
    const launched = service.wakeReservations()[0];
    const recovery = { reservationId: launched.id, actorId: 'owner', approved: true,
      runtimeStopped: true, note: 'Operator inspected the runtime and confirmed it stopped.' };
    assert.throws(() => service.recoverWake(recovery), (error) => error.code === 'WAKE_RECOVERY_BLOCKED');
    assert.throws(() => service.recoverWake({ ...recovery, reservationId: 'missing' }),
      (error) => error.code === 'WAKE_RESERVATION_NOT_FOUND');
    // Model a crash between provider invocation and recording its result.
    control.database.prepare("UPDATE schedule_wake_reservations SET outcome = 'reserved' WHERE id = ?").run(launched.id);
    const pending = service.wakeReservations({ managerId: 'session-manager' })[0];
    assert.equal(pending.blocksManagerWake, true);
    assert.equal(pending.runtimeStoppedVerified, false);
    const beforeInspection = control.database.prepare('SELECT * FROM schedule_wake_reservations').all();
    const observation = observeProject({ repositoryRoot: context.root, env: context.env });
    assert.equal(observation.managerWakes.available, true);
    assert.equal(observation.managerWakes.blockingCount, 1);
    assert.equal(observation.managerWakes.reservations[0].id, pending.id);
    assert.equal(observation.managerWakes.reservations[0].runtimeStoppedVerified, false);
    assert.deepEqual(control.database.prepare('SELECT * FROM schedule_wake_reservations').all(), beforeInspection,
      'dashboard observation must not release or modify the reservation');
    assert.throws(() => service.recoverWake({ ...recovery, actorId: context.worker }),
      (error) => error.code === 'OWNER_AUTHORITY_REQUIRED');
    for (const invalid of [{ approved: false }, { runtimeStopped: false }, { note: ' ' }]) {
      assert.throws(() => service.recoverWake({ ...recovery, ...invalid }),
        (error) => error.code === 'WAKE_RECOVERY_APPROVAL_REQUIRED');
    }
    control.reportStatus({ areaId: 'session-manager', state: 'working', summary: 'Still running.' });
    assert.throws(() => service.recoverWake(recovery), (error) => error.code === 'WAKE_RECOVERY_BLOCKED');
    control.reportStatus({ areaId: 'session-manager', state: 'offline', summary: 'Stopped by operator.' });
    assert.equal(service.recoverWake(recovery).outcome, 'recovered-stopped');
    assert.equal(service.recoverWake(recovery).replay, true);
    assert.equal(calls, 1, 'recovery never launches a provider');
    assert.equal(service.wakeReservations()[0].blocksManagerWake, false);
    const recoveredObservation = observeProject({ repositoryRoot: context.root, env: context.env });
    assert.equal(recoveredObservation.managerWakes.blockingCount, 0);
    assert.equal(recoveredObservation.managerWakes.reservations[0].outcome, 'recovered-stopped');
    const events = control.readAudit().filter((event) => event.operation === 'schedule.wake.recover');
    assert.equal(events.length, 1);
    assert.equal(events[0].details.runtimeStoppedVerified, false);
    assert.equal(events[0].details.note, recovery.note);
    const repeated = service.run({ scheduleId: 'manager-check-in', actorId: 'owner', approved: true });
    assert.equal(JSON.parse(repeated.stdout).wake.reason, 'manager-wake-already-attempted');
    control.ackMessage({ recipient: 'session-manager', messageId: pending.messageId });
    const next = service.run({ scheduleId: 'manager-check-in-secondary', actorId: 'owner', approved: true });
    assert.equal(JSON.parse(next.stdout).wake.reason, 'daily-invocation-budget-exhausted');
    assert.equal(calls, 1);
    const inspection = spawnSync(process.execPath, [CLI, 'schedules', 'wakes', '--json'],
      { cwd: context.root, env: context.env, encoding: 'utf8' });
    assert.equal(inspection.status, 0, inspection.stderr);
    assert.equal(JSON.parse(inspection.stdout).reservations[0].outcome, 'recovered-stopped');
    const denied = spawnSync(process.execPath, [CLI, 'schedules', 'recover-wake', '--reservation', pending.id,
      '--runtime-stopped', '--note', recovery.note, '--json'], { cwd: context.root, env: context.env, encoding: 'utf8' });
    assert.notEqual(denied.status, 0, 'CLI requires explicit approval even on replay');
    const replay = spawnSync(process.execPath, [CLI, 'schedules', 'recover-wake', '--reservation', pending.id,
      '--runtime-stopped', '--note', recovery.note, '--yes', '--json'],
    { cwd: context.root, env: context.env, encoding: 'utf8' });
    assert.equal(replay.status, 0, replay.stderr);
    assert.equal(JSON.parse(replay.stdout).replay, true);
    assert.equal(control.readAudit().filter((event) => event.operation === 'schedule.wake.recover').length, 1);
  } finally { control.close(); }
});

test('SCN-manager-wake-policy: enabled wakes require an explicit mode and cannot promise a dollar cap in count mode', () => {
  const context = fixture({ managerCheckIn: true,
    managerWake: { enabled: true, budget_mode: 'invocation-count' }, maxInvocationsPerDay: 2 });
  const config = loadProjectConfig(context.root);
  const missingPolicy = structuredClone(config);
  delete missingPolicy.schedules.find((schedule) => schedule.action.wake).action.wake.budget_mode;
  assert.throws(() => validateProjectConfig(missingPolicy), (error) => error.code === 'CONFIG_SCHEMA_INVALID');
  const ambiguousPolicy = structuredClone(config);
  ambiguousPolicy.schedules.find((schedule) => schedule.action.wake).action.wake.max_usd_per_invocation = 0.25;
  assert.throws(() => validateProjectConfig(ambiguousPolicy), (error) => error.code === 'CONFIG_SCHEMA_INVALID');
  const noDailyBudget = structuredClone(config);
  delete noDailyBudget.runtime_wake_budget;
  assert.throws(() => validateProjectConfig(noDailyBudget), (error) => error.code === 'CONFIG_SCHEMA_INVALID');
});

test('SCN-manager-check-in-budgeted-wake: optional runtime wake is adapter-injected, fail-closed, and capped per UTC day', () => {
  const context = fixture({
    managerCheckIn: true,
    managerWake: { enabled: true, max_usd_per_invocation: 0.35 },
    maxInvocationsPerDay: 1,
  });
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  control.reportStatus({ areaId: context.worker, state: 'waiting', summary: 'Waiting for a decision.', task: 'TASK-WAKE' });
  let at = new Date('2026-09-28T19:00:00Z');
  let wakeCalls = 0;
  const noAdapter = new ScheduleService({ repositoryRoot: context.root, controlPlane: control, clock: () => at });
  const unavailablePlan = noAdapter.plan({ scheduleId: 'manager-check-in', actorId: 'owner', at });
  assert.deepEqual(unavailablePlan.blockers, []);
  assert.equal(unavailablePlan.wakeAvailable, false);
  const queuedWithoutRuntime = noAdapter.run({ scheduleId: 'manager-check-in', actorId: 'owner', approved: true });
  const unavailableResult = JSON.parse(queuedWithoutRuntime.stdout);
  assert.equal(unavailableResult.checkIn.queued, true);
  assert.equal(unavailableResult.wake.reason, 'manager-runtime-waker-unavailable');
  const unawakenedMessage = control.readMessages({ recipient: 'session-manager', unacknowledgedOnly: true })
    .find((message) => message.kind === 'manager-check-in');
  control.ackMessage({ recipient: 'session-manager', messageId: unawakenedMessage.id });

  const schedules = new ScheduleService({
    repositoryRoot: context.root, controlPlane: control, clock: () => at,
    wakeManager: {
      plan: ({ managerId, maxUsd }) => ({
        plan: {
          canProceed: true,
          actions: [{
            areaId: managerId,
            costCeiling: { enforced: true, maxUsd, mode: 'fixture-hard-cap' },
          }],
        },
      }),
      invoke: ({ managerId, checkIn, maxUsd, prepared }) => {
        assert.equal(managerId, 'session-manager');
        assert.equal(checkIn.queued, true);
        assert.equal(maxUsd, 0.35);
        assert.equal(prepared.plan.actions[0].costCeiling.maxUsd, maxUsd);
        wakeCalls += 1;
        return { adapter: 'fixture', invoked: true };
      },
    },
  });
  const first = schedules.run({ scheduleId: 'manager-check-in', actorId: 'owner', approved: true });
  const firstResult = JSON.parse(first.stdout);
  assert.equal(firstResult.wake.attempted, true);
  assert.equal(firstResult.wake.maxUsd, 0.35);
  assert.equal(firstResult.wake.costCeiling.mode, 'fixture-hard-cap');
  assert.equal(firstResult.wake.result.adapter, 'fixture');
  assert.equal(wakeCalls, 1);
  assert.equal(control.identity('session-manager').state, 'offline', 'the test waker does not mutate Fleet presence');
  const firstMessage = control.readMessages({ recipient: 'session-manager', unacknowledgedOnly: true })
    .find((message) => message.kind === 'manager-check-in');
  control.ackMessage({ recipient: 'session-manager', messageId: firstMessage.id });

  at = new Date('2026-09-28T19:15:00Z');
  const second = schedules.run({ scheduleId: 'manager-check-in-secondary', actorId: 'owner', approved: true });
  const secondResult = JSON.parse(second.stdout);
  assert.equal(secondResult.checkIn.queued, true);
  assert.equal(secondResult.wake.attempted, false);
  assert.equal(secondResult.wake.reason, 'daily-invocation-budget-exhausted');
  assert.equal(secondResult.wake.used, 1);
  assert.equal(wakeCalls, 1, 'the configured daily invocation ceiling is enforced');
  assert.equal(control.database.prepare(`
    SELECT COUNT(*) AS count FROM schedule_wake_reservations
  `).get().count, 1);
  control.close();
});

test('SCN-manager-check-in-cost-ceiling: unsupported runtime cap leaves the check-in queued without reserving or waking', () => {
  const context = fixture({
    managerCheckIn: true,
    managerWake: { enabled: true, max_usd_per_invocation: 0.25 },
    maxInvocationsPerDay: 2,
  });
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  control.reportStatus({ areaId: context.worker, state: 'waiting', summary: 'Waiting for an interface ruling.' });
  let planCalls = 0;
  let wakeCalls = 0;
  const schedules = new ScheduleService({
    repositoryRoot: context.root, controlPlane: control,
    wakeManager: {
      plan: ({ managerId, maxUsd }) => {
        planCalls += 1;
        assert.equal(managerId, 'session-manager');
        assert.equal(maxUsd, 0.25);
        return { plan: { canProceed: false, blockers: [{ code: 'RUNTIME_COST_CEILING_UNSUPPORTED' }] } };
      },
      invoke: () => { wakeCalls += 1; },
    },
  });
  const result = schedules.run({ scheduleId: 'manager-check-in', actorId: 'owner', approved: true });
  const output = JSON.parse(result.stdout);
  assert.equal(output.checkIn.queued, true);
  assert.equal(output.wake.reason, 'runtime-cost-ceiling-unsupported');
  assert.equal(planCalls, 1);
  assert.equal(wakeCalls, 0);
  assert.equal(control.database.prepare('SELECT COUNT(*) AS count FROM schedule_wake_reservations').get().count, 0);
  const unsupportedWakeMessage = control.readMessages({ recipient: 'session-manager', unacknowledgedOnly: true })
    .find((message) => message.kind === 'manager-check-in');
  assert.ok(unsupportedWakeMessage);
  control.ackMessage({ recipient: 'session-manager', messageId: unsupportedWakeMessage.id });
  control.reportStatus({
    areaId: context.worker, state: 'waiting', summary: 'A new interface ruling is still needed.',
  });

  let deceptiveWakeCalls = 0;
  const deceptiveSchedules = new ScheduleService({
    repositoryRoot: context.root, controlPlane: control,
    wakeManager: {
      plan: ({ managerId, maxUsd }) => ({
        plan: {
          canProceed: true,
          actions: [{
            areaId: managerId,
            costCeiling: { enforced: true, maxUsd: maxUsd * 2, mode: 'fixture-hard-cap' },
          }],
        },
      }),
      invoke: () => { deceptiveWakeCalls += 1; },
    },
  });
  const deceptiveResult = deceptiveSchedules.run({ scheduleId: 'manager-check-in', actorId: 'owner', approved: true });
  const deceptiveOutput = JSON.parse(deceptiveResult.stdout);
  assert.equal(deceptiveOutput.checkIn.queued, true, JSON.stringify(deceptiveOutput));
  assert.equal(deceptiveOutput.wake.attempted, false);
  assert.equal(deceptiveOutput.wake.reason, 'runtime-cost-ceiling-unproven');
  assert.equal(deceptiveWakeCalls, 0, 'a receipt for a higher cap is not accepted as proof of the configured ceiling');
  assert.equal(control.database.prepare('SELECT COUNT(*) AS count FROM schedule_wake_reservations').get().count, 0);
  control.close();
});

test('SCN-manager-check-in-active-runtime: scheduled check-in queues attention without duplicating an active manager turn', () => {
  const context = fixture({
    managerCheckIn: true,
    managerWake: { enabled: true, max_usd_per_invocation: 0.35 },
    maxInvocationsPerDay: 2,
  });
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  control.reportStatus({
    areaId: 'session-manager', state: 'working', runtime: 'claude',
    runtimeSessionId: 'claude-active-manager', summary: 'Currently coordinating.',
  });
  control.reportStatus({ areaId: context.worker, state: 'waiting', summary: 'Waiting for review.', task: 'TASK-ACTIVE' });
  let wakeCalls = 0;
  const schedules = new ScheduleService({
    repositoryRoot: context.root, controlPlane: control,
    wakeManager: {
      plan: () => { wakeCalls += 1; return { plan: { canProceed: true, actions: [] } }; },
      invoke: () => { wakeCalls += 1; return { invoked: true }; },
    },
  });
  const result = schedules.run({ scheduleId: 'manager-check-in', actorId: 'owner', approved: true });
  const output = JSON.parse(result.stdout);
  assert.equal(output.checkIn.queued, true);
  assert.equal(output.wake.attempted, false);
  assert.equal(output.wake.reason, 'manager-runtime-already-active');
  assert.equal(wakeCalls, 0);
  assert.equal(control.database.prepare('SELECT COUNT(*) AS count FROM schedule_wake_reservations').get().count, 0);
  assert.equal(control.identity('session-manager').state, 'working');
  control.close();
});

test('SCN-manager-check-in-schedule: approved system cadence queues direct-report check-ins while the manager is offline', () => {
  const context = fixture({ managerCheckIn: true });
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  control.reportStatus({ areaId: context.worker, state: 'waiting', summary: 'Waiting for a decision.', task: 'TASK-88' });
  let at = new Date('2026-09-28T19:00:00Z');
  let providerOrCommandCalls = 0;
  const schedules = new ScheduleService({
    repositoryRoot: context.root, controlPlane: control, clock: () => at,
    executor: () => { providerOrCommandCalls += 1; throw new Error('manager check-in must not run an external command'); },
  });

  assert.deepEqual(schedules.plan({ scheduleId: 'manager-check-in', actorId: 'owner', at }).blockers, []);
  assert.deepEqual(schedules.plan({ scheduleId: 'manager-check-in', actorId: 'session-manager', at }).blockers,
    ['actor-not-authorized']);
  assert.throws(
    () => schedules.run({ scheduleId: 'manager-check-in', actorId: 'owner', approved: false }),
    (error) => error.code === 'APPROVAL_REQUIRED',
  );
  const first = schedules.dispatchSystem({ actorId: 'owner', approved: true, at });
  assert.deepEqual(first.due, ['manager-check-in']);
  assert.equal(first.runs[0].result, 'succeeded');
  assert.equal(JSON.parse(first.runs[0].stdout).checkIn.queued, true);
  assert.equal(control.identity('session-manager').state, 'offline');
  assert.equal(control.readMessages({ recipient: 'session-manager', unacknowledgedOnly: true })
    .some((message) => message.kind === 'manager-check-in'), true);
  assert.equal(providerOrCommandCalls, 0);

  at = new Date('2026-09-28T19:14:59Z');
  assert.deepEqual(schedules.dispatchSystem({ actorId: 'owner', approved: true, at }).due, []);
  at = new Date('2026-09-28T19:15:00Z');
  const repeated = schedules.dispatchSystem({ actorId: 'owner', approved: true, at });
  assert.deepEqual(repeated.due, ['manager-check-in']);
  assert.equal(JSON.parse(repeated.runs[0].stdout).checkIn.reason, 'check-in-already-pending');
  assert.equal(control.readMessages({ recipient: 'session-manager' })
    .filter((message) => message.kind === 'manager-check-in').length, 1);
  assert.equal(providerOrCommandCalls, 0);
  control.close();
});

test('SCN-cli-schedules: public commands list, plan, and run a read-only session schedule', () => {
  const context = fixture();
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  control.reportStatus({ areaId: 'session-manager', state: 'idle', summary: 'Ready.' });
  control.close();
  const run = (args) => spawnSync(process.execPath, [CLI, ...args, '--json'], {
    cwd: context.root, env: context.env, encoding: 'utf8',
  });
  const listed = run(['schedules', 'list', '--actor', 'session-manager']);
  assert.equal(listed.status, 0, listed.stderr || listed.stdout);
  assert.equal(JSON.parse(listed.stdout).schedules.length, 3);
  const planned = JSON.parse(run(['schedules', 'plan', '--id', 'fleet-hygiene', '--actor', 'session-manager']).stdout);
  assert.equal(planned.canRun, true);
  const executed = run(['schedules', 'run', '--id', 'fleet-hygiene', '--actor', 'session-manager']);
  assert.equal(executed.status, 0, executed.stderr || executed.stdout);
  assert.equal(JSON.parse(executed.stdout).stdout, 'healthy');
  const reconcilePlan = run(['schedules', 'launcher', 'plan-reconcile']);
  assert.notEqual(reconcilePlan.status, 0);
  assert.equal(JSON.parse(reconcilePlan.stdout).blockers[0].code, 'LAUNCHER_NOT_INSTALLED');
  const unapprovedReconcile = run(['schedules', 'launcher', 'reconcile']);
  assert.notEqual(unapprovedReconcile.status, 0);
  assert.match(`${unapprovedReconcile.stdout}\n${unapprovedReconcile.stderr}`, /APPROVAL_REQUIRED/);
});

test('SCN-system-schedule-launcher: exact-config user units install, dispatch, and reverse safely', () => {
  const context = fixture();
  const systemctl = [];
  let failNextReload = false;
  const launcher = new ScheduleLauncherService({
    repositoryRoot: context.root, env: context.env,
    command: ['/opt/torch/node', '/opt/torch/bin/torch.mjs'],
    executor: (command, args, options) => {
      systemctl.push({ command, args, options });
      if (failNextReload && args.includes('daemon-reload')) {
        failNextReload = false;
        return { status: 1, stdout: '', stderr: 'simulated reload failure' };
      }
      return { status: 0, stdout: '', stderr: '' };
    },
  });
  const plan = launcher.plan();
  assert.equal(plan.canProceed, true);
  assert.deepEqual(plan.systemSchedules, ['release']);
  assert.equal(plan.files.every((file) => !existsSync(file.path)), true);

  const installed = launcher.install();
  assert.equal(installed.mutationPerformed, true);
  assert.equal(installed.files.every((file) => existsSync(file.path)), true);
  assert.match(readFileSync(installed.files[0].path, 'utf8'), new RegExp(installed.digest));
  assert.deepEqual(systemctl.slice(0, 2).map((call) => call.args.slice(0, 2)), [
    ['--user', 'daemon-reload'], ['--user', 'enable'],
  ]);
  assert.equal(launcher.status().stale, false);
  assert.equal(launcher.planReconcile().canProceed, true);
  assert.equal(launcher.planReconcile().stale, false);
  assert.equal(launcher.planRemoval().canProceed, true);
  assert.equal(planUninstall({ repository: inspectRepository(context.root), purge: true, env: context.env }).problems
    .some((problem) => problem.type === 'persistent-integration-installed'), true);

  const originalConfig = readFileSync(join(context.root, '.torch', 'torch.yaml'), 'utf8');
  writeFileSync(join(context.root, '.torch', 'torch.yaml'), `${originalConfig.trimEnd()} \n`);
  assert.throws(
    () => assertLauncherDigest(context.root, installed.digest),
    (error) => error.code === 'SCHEDULE_LAUNCHER_STALE',
  );
  writeFileSync(join(context.root, '.torch', 'torch.yaml'), originalConfig);

  const updatedConfig = loadProjectConfig(context.root);
  const graph = organizationGraphFromConfig(updatedConfig);
  const specialist = graph.roles.find((role) => role.kind === 'specialist');
  const managerRoleId = `${context.worker}-lead`;
  graph.revision += 1;
  graph.roles = graph.roles.map((role) => role.id === specialist.id
    ? { ...role, reports_to: [managerRoleId] }
    : role);
  graph.roles.push({
    id: managerRoleId, title: 'Domain Lead', kind: 'domain-coordination', identity_id: context.worker,
    responsibilities: ['Coordinate the specialist domain and clear direct-report waits.'],
    authority: ['coordinate-domains'], coordinates: [specialist.id], reports_to: ['session-manager'],
    consults_with: ['session-manager'],
  });
  updatedConfig.organization = graph;
  updatedConfig.schedules = planManagerCheckInSchedules({ graph, schedules: updatedConfig.schedules }).schedules;
  writeFileSync(join(context.root, '.torch', 'torch.yaml'), `${JSON.stringify(updatedConfig, null, 2)}\n`);
  const reconcilePlan = launcher.planReconcile();
  assert.equal(reconcilePlan.canProceed, true);
  assert.equal(reconcilePlan.stale, true);
  assert.equal(reconcilePlan.systemSchedules.includes(`${context.worker}-check-in`), true,
    'hierarchy changes add manager cadence before the installed dispatcher is refreshed');
  assert.equal(reconcilePlan.updates.find((entry) => entry.name.endsWith('.service')).changed, true);
  assert.equal(reconcilePlan.updates.find((entry) => entry.name.endsWith('.timer')).changed, false,
    'only the dispatcher service embeds the digest; the one-minute timer cadence remains stable');
  const reconciled = launcher.reconcile();
  assert.equal(reconciled.mutationPerformed, true);
  assert.equal(launcher.status().stale, false);
  assert.equal(launcher.planReconcile().stale, false);
  const priorUnitContents = new Map(reconcilePlan.files.map((file) => [file.path, readFileSync(file.path, 'utf8')]));
  const priorManifest = readFileSync(join(context.root, '.torch', 'install-manifest.json'), 'utf8');

  updatedConfig.schedules.find((schedule) => schedule.id === `${context.worker}-check-in`).trigger.seconds = 1800;
  writeFileSync(join(context.root, '.torch', 'torch.yaml'), `${JSON.stringify(updatedConfig, null, 2)}\n`);
  assert.equal(launcher.planReconcile().stale, true);
  failNextReload = true;
  assert.throws(() => launcher.reconcile(), (error) => error.code === 'SCHEDULE_LAUNCHER_SYSTEMD_FAILED');
  assert.deepEqual([...priorUnitContents].map(([path]) => [path, readFileSync(path, 'utf8')]), [...priorUnitContents]);
  assert.equal(readFileSync(join(context.root, '.torch', 'install-manifest.json'), 'utf8'), priorManifest,
    'failed systemd reload restores the manifest along with the exact previous launcher files');
  assert.equal(launcher.status().stale, true, 'failed reconciliation remains visibly stale rather than claiming a successful timer update');
  writeFileSync(join(context.root, '.torch', 'torch.yaml'), originalConfig);

  writeFileSync(installed.files[0].path, `${readFileSync(installed.files[0].path, 'utf8')}# owner change\n`);
  assert.equal(launcher.planReconcile().blockers.some((blocker) => blocker.code === 'LAUNCHER_FILE_MODIFIED'), true);
  const unsafeRemoval = launcher.planRemoval();
  assert.equal(unsafeRemoval.canProceed, false);
  assert.equal(unsafeRemoval.blockers[0].code, 'SCHEDULE_LAUNCHER_MODIFIED');
  writeFileSync(installed.files[0].path, priorUnitContents.get(installed.files[0].path));

  const removed = launcher.remove();
  assert.equal(removed.mutationPerformed, true);
  assert.equal(installed.files.every((file) => !existsSync(file.path)), true);
  assert.equal(launcher.status().installed, false);

  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  let at = new Date(2026, 8, 27, 16, 0, 0);
  const executed = [];
  const schedules = new ScheduleService({
    repositoryRoot: context.root, controlPlane: control, clock: () => at,
    executor: (command, args) => {
      executed.push({ command, args });
      return { status: 0, stdout: 'released', stderr: '' };
    },
  });
  const first = schedules.dispatchSystem({ actorId: 'owner', approved: true, at });
  assert.deepEqual(first.due, ['release']);
  assert.equal(executed.length, 1);
  at = new Date(2026, 8, 27, 16, 0, 30);
  assert.deepEqual(schedules.dispatchSystem({ actorId: 'owner', approved: true, at }).due, []);
  control.close();
});
