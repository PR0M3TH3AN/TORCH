import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import { createClaudeAdapter } from '../../src/adapters/claude.mjs';
import { createCodexAdapter } from '../../src/adapters/codex.mjs';
import { openControlPlane } from '../../src/control-plane/service.mjs';
import { analyzeRepository } from '../../src/kernel/analyze.mjs';
import { proposeDomains } from '../../src/kernel/domains.mjs';
import { inspectRepository } from '../../src/kernel/git.mjs';
import { installProject } from '../../src/kernel/install.mjs';
import { createWorktrees } from '../../src/kernel/worktrees.mjs';
import { ResourceService } from '../../src/resources/service.mjs';
import {
  detachFleet, planFleetDetach, planFleetDown, planFleetUp, startFleet, stopFleet,
} from '../../src/runtime/lifecycle.mjs';

function fleetFixture({ workerRuntime = 'claude' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'torch-lifecycle-'));
  execFileSync('git', ['init', '-b', 'main', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'torch-test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'TORCH Test']);
  writeFileSync(join(root, 'app.js'), 'export const app = true;\n');
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'fixture']);
  let repository = inspectRepository(root);
  const proposal = proposeDomains({ repository, analysis: analyzeRepository(repository) });
  proposal.domains[0].runtime = workerRuntime;
  proposal.domains[0].resources = ['browser'];
  proposal.resources = [{ id: 'browser', capacity: 1, queue: 'fifo', max_hold_seconds: 300 }];
  proposal.review = {
    status: 'approved', reviewedAt: '2026-09-27T00:00:00Z', reviewedBy: 'fixture-owner', notes: [],
  };
  const env = { ...process.env, XDG_DATA_HOME: join(tmpdir(), `${basename(root)}-state`) };
  installProject({ repository, proposal, env, projectId: 'lifecycle-fixture' });
  execFileSync('git', ['-C', root, 'add', '.torch']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'install torch']);
  repository = inspectRepository(root);
  const worktreeParent = join(tmpdir(), `${basename(root)}-worktrees`);
  createWorktrees({ repository, parentOverride: worktreeParent });
  return { root, env, worker: proposal.domains[0].id };
}

test('SCN-fleet-fresh-resume: workers start before manager and stable identities resume captured runtime sessions', () => {
  const fixture = fleetFixture();
  const control = openControlPlane({ repositoryRoot: fixture.root, env: fixture.env });
  const adapter = createClaudeAdapter({ executable: 'claude' });
  const adapters = new Map([['claude', adapter]]);
  const fresh = planFleetUp({ repositoryRoot: fixture.root, controlPlane: control, adapters, fresh: true });
  assert.equal(fresh.actions.at(-1).areaId, 'session-manager');
  assert.equal(fresh.actions.every((action) => action.mode === 'create'), true);
  assert.equal(fresh.actions.every((action) => action.mcp.args.includes(action.areaId)), true);
  assert.equal(fresh.actions.every((action) => action.launch.args.includes('--mcp-config')), true);
  assert.match(fresh.actions.at(-1).launch.args.join(' '), /assess Fleet evolution/);
  assert.equal(fresh.mutationPerformed, false);

  const launches = [];
  const started = startFleet({
    plan: fresh, controlPlane: control, adapters,
    executor: (launch) => {
      launches.push(launch);
      return { status: 0, stdout: `runtime-${launches.length}\n` };
    },
  });
  assert.equal(started.started.at(-1).areaId, 'session-manager');
  assert.equal(launches.length, fresh.actions.length);
  assert.equal(control.identity(fixture.worker).runtimeSessionId.startsWith('runtime-'), true);
  assert.equal(existsSync(fresh.actions[0].promptFile), true);
  assert.equal(readFileSync(fresh.actions[0].promptFile, 'utf8').includes('Common fleet rules'), true);

  control.reportStatus({
    areaId: fixture.worker, state: 'idle', summary: 'Checkpoint safe.', task: 'TASK-RESUME',
  });
  control.reportStatus({ areaId: 'session-manager', state: 'idle', summary: 'Fleet safe.' });
  const stoppedIds = [];
  const down = stopFleet({
    plan: planFleetDown({ repositoryRoot: fixture.root, controlPlane: control }), controlPlane: control,
    stopRuntime: ({ runtimeSessionId }) => { stoppedIds.push(runtimeSessionId); return { stopped: true }; },
  });
  assert.equal(down.stopped.at(-1).areaId, 'session-manager');
  assert.equal(stoppedIds.length, fresh.actions.length);
  assert.equal(existsSync(down.snapshotPath), true);
  assert.equal(existsSync(down.resumeBriefPath), true);
  assert.match(readFileSync(down.resumeBriefPath, 'utf8'), /TASK-RESUME/);
  assert.match(readFileSync(down.resumeBriefPath, 'utf8'), new RegExp(fixture.worker));
  assert.equal(control.identity(fixture.worker).currentTask, 'TASK-RESUME');
  assert.equal(control.readMessages({ recipient: 'session-manager' })
    .some((message) => message.body.startsWith('Final status:')), true);

  const detached = detachFleet({
    plan: planFleetDetach({ repositoryRoot: fixture.root, controlPlane: control }),
    controlPlane: control, stopRuntime: () => ({ stopped: true }),
    now: () => new Date('2026-09-27T13:00:00Z'),
  });
  assert.equal(detached.detachedAt, '2026-09-27T13:00:00.000Z');
  const metadataPath = join(planFleetDown({
    repositoryRoot: fixture.root, controlPlane: control,
  }).stateRoot, 'project.json');
  assert.equal(JSON.parse(readFileSync(metadataPath, 'utf8')).detachedAt, detached.detachedAt);

  const resumed = planFleetUp({ repositoryRoot: fixture.root, controlPlane: control, adapters, fresh: false });
  assert.equal(resumed.actions.every((action) => action.mode === 'resume'), true);
  assert.deepEqual(
    resumed.actions.map((action) => action.runtimeSessionId),
    started.started.map((action) => action.runtimeSessionId),
  );
  startFleet({ plan: resumed, controlPlane: control, adapters, executor: () => ({ status: 0 }) });
  assert.equal(JSON.parse(readFileSync(metadataPath, 'utf8')).detachedAt, null);
  control.close();
});

test('SCN-fleet-wind-down-safety: active work blocks runtime shutdown and failed startup prevents manager launch', () => {
  const fixture = fleetFixture();
  const control = openControlPlane({ repositoryRoot: fixture.root, env: fixture.env });
  const adapter = createClaudeAdapter();
  const plan = planFleetUp({ repositoryRoot: fixture.root, controlPlane: control, adapter, fresh: true });
  assert.throws(
    () => startFleet({
      plan, controlPlane: control,
      executor: (launch) => ({ status: launch.areaId === fixture.worker ? 1 : 0, stderr: 'launch failed' }),
    }),
    (error) => error.code === 'FLEET_START_FAILED'
      && control.identity('session-manager').state === 'offline',
  );
  control.reportStatus({ areaId: fixture.worker, state: 'working', summary: 'Unfinished change.' });
  const resources = new ResourceService({ repositoryRoot: fixture.root, controlPlane: control });
  resources.acquire({ resourceId: 'browser', areaId: fixture.worker });
  const workerPath = plan.actions.find((action) => action.areaId === fixture.worker).worktree;
  const mergeHead = execFileSync('git', ['-C', workerPath, 'rev-parse', '--git-path', 'MERGE_HEAD'], {
    encoding: 'utf8',
  }).trim();
  writeFileSync(mergeHead, `${execFileSync('git', ['-C', fixture.root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()}\n`);
  const down = planFleetDown({ repositoryRoot: fixture.root, controlPlane: control });
  assert.equal(down.canProceed, false);
  assert.equal(down.blockers.some((blocker) => blocker.areaId === fixture.worker && blocker.state === 'working'), true);
  assert.equal(down.blockers.some((blocker) => blocker.code === 'RESOURCE_LEASE_ACTIVE'), true);
  assert.equal(down.blockers.some((blocker) => blocker.code === 'GIT_OPERATION_ACTIVE'), true);
  assert.throws(
    () => stopFleet({ plan: down, controlPlane: control, stopRuntime: () => ({ stopped: true }) }),
    (error) => error.code === 'FLEET_NOT_READY_TO_STOP',
  );
  unlinkSync(mergeHead);
  resources.release({ resourceId: 'browser', areaId: fixture.worker });
  control.close();
});

test('SCN-mixed-runtime: Codex and Claude share stable identities while planning and capture stay provider-specific', () => {
  const fixture = fleetFixture({ workerRuntime: 'codex' });
  const control = openControlPlane({ repositoryRoot: fixture.root, env: fixture.env });
  const adapters = new Map([
    ['claude', createClaudeAdapter()],
    ['codex', createCodexAdapter({ executable: 'codex' })],
  ]);
  const plan = planFleetUp({
    repositoryRoot: fixture.root, controlPlane: control, adapters, fresh: true,
  });
  assert.equal(plan.canProceed, true);
  assert.equal(plan.actions[0].areaId, fixture.worker);
  assert.equal(plan.actions[0].runtime, 'codex');
  assert.equal(plan.actions[0].launch.args.includes('exec'), true);
  assert.equal(plan.actions[0].launch.args.some((arg) => arg.includes('mcp_servers.')), true);
  assert.equal(plan.actions[0].launch.args.some((arg) => arg.includes(fixture.worker)), true);
  assert.equal(plan.actions.at(-1).runtime, 'claude');
  assert.equal(plan.actions.at(-1).launch.args.includes('--mcp-config'), true);
  assert.equal(plan.actions.at(-1).runtimeSessionId, null);
  assert.equal(plan.actions.at(-1).requiresRuntimeIdCapture, true);

  const started = startFleet({
    plan, controlPlane: control, adapters,
    executor: (launch) => launch.areaId === fixture.worker
      ? { status: 0, stdout: '{"type":"thread.started","thread_id":"codex-worker-1"}\n' }
      : { status: 0, stdout: 'claude-manager-1\n' },
  });
  assert.deepEqual(started.started.map((item) => item.runtimeSessionId), [
    'codex-worker-1', 'claude-manager-1',
  ]);
  assert.equal(control.identity(fixture.worker).runtime, 'codex');
  assert.equal(control.identity(fixture.worker).state, 'idle');
  assert.equal(control.identity('session-manager').runtime, 'claude');
  assert.equal(control.identity('session-manager').state, 'starting');

  control.reportStatus({ areaId: 'session-manager', state: 'idle', summary: 'Ready to stop.' });
  const down = planFleetDown({ repositoryRoot: fixture.root, controlPlane: control, adapters });
  const stoppedRuntimes = [];
  stopFleet({
    plan: down, controlPlane: control,
    stopRuntime: (action) => { stoppedRuntimes.push(action.runtime); return { stopped: true }; },
  });
  assert.deepEqual(stoppedRuntimes, ['claude']);
  assert.equal(control.identity(fixture.worker).state, 'offline');
  control.close();
});
