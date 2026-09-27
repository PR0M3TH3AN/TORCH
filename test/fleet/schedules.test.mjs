import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

const CLI = new URL('../../bin/torch.mjs', import.meta.url).pathname;

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'torch-schedules-'));
  execFileSync('git', ['init', '-b', 'main', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'torch-test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'TORCH Test']);
  writeFileSync(join(root, 'app.js'), 'export const app = true;\n');
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'fixture']);
  const repository = inspectRepository(root);
  const proposal = proposeDomains({ repository, analysis: analyzeRepository(repository) });
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
  proposal.review = {
    status: 'approved', reviewedAt: '2026-09-27T00:00:00Z', reviewedBy: 'fixture-owner', notes: [],
  };
  const env = {
    ...process.env,
    XDG_DATA_HOME: mkdtempSync(join(tmpdir(), 'torch-schedules-state-')),
    XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), 'torch-schedules-config-')),
  };
  installProject({ repository, proposal, env, projectId: 'schedule-fixture' });
  return { root, env, worker };
}

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
});

test('SCN-system-schedule-launcher: exact-config user units install, dispatch, and reverse safely', () => {
  const context = fixture();
  const systemctl = [];
  const launcher = new ScheduleLauncherService({
    repositoryRoot: context.root, env: context.env,
    command: ['/opt/torch/node', '/opt/torch/bin/torch.mjs'],
    executor: (command, args, options) => {
      systemctl.push({ command, args, options });
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
  assert.equal(planUninstall({ repository: inspectRepository(context.root), purge: true }).problems
    .some((problem) => problem.type === 'persistent-integration-installed'), true);

  const originalConfig = readFileSync(join(context.root, '.torch', 'torch.yaml'), 'utf8');
  writeFileSync(join(context.root, '.torch', 'torch.yaml'), `${originalConfig.trimEnd()} \n`);
  assert.throws(
    () => assertLauncherDigest(context.root, installed.digest),
    (error) => error.code === 'SCHEDULE_LAUNCHER_STALE',
  );
  writeFileSync(join(context.root, '.torch', 'torch.yaml'), originalConfig);

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
