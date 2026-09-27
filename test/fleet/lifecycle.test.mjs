import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
import { planFleetDown, planFleetUp, startFleet, stopFleet } from '../../src/runtime/lifecycle.mjs';

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
  let session = 0;
  const adapter = createClaudeAdapter({ executable: 'claude', idFactory: () => `runtime-${++session}` });
  const fresh = planFleetUp({ repositoryRoot: fixture.root, controlPlane: control, adapter, fresh: true });
  assert.equal(fresh.actions.at(-1).areaId, 'session-manager');
  assert.equal(fresh.actions.every((action) => action.mode === 'create'), true);
  assert.equal(fresh.mutationPerformed, false);

  const launches = [];
  const started = startFleet({
    plan: fresh, controlPlane: control,
    executor: (launch) => { launches.push(launch); return { status: 0 }; },
  });
  assert.equal(started.started.at(-1).areaId, 'session-manager');
  assert.equal(launches.length, fresh.actions.length);
  assert.equal(control.identity(fixture.worker).runtimeSessionId.startsWith('runtime-'), true);
  assert.equal(existsSync(fresh.actions[0].promptFile), true);
  assert.equal(readFileSync(fresh.actions[0].promptFile, 'utf8').includes('Common fleet rules'), true);

  control.reportStatus({ areaId: fixture.worker, state: 'idle', summary: 'Checkpoint safe.' });
  control.reportStatus({ areaId: 'session-manager', state: 'idle', summary: 'Fleet safe.' });
  const stoppedIds = [];
  const down = stopFleet({
    plan: planFleetDown({ repositoryRoot: fixture.root, controlPlane: control }), controlPlane: control,
    stopRuntime: ({ runtimeSessionId }) => { stoppedIds.push(runtimeSessionId); return { stopped: true }; },
  });
  assert.equal(down.stopped.at(-1).areaId, 'session-manager');
  assert.equal(stoppedIds.length, fresh.actions.length);
  assert.equal(existsSync(down.snapshotPath), true);

  const resumed = planFleetUp({ repositoryRoot: fixture.root, controlPlane: control, adapter, fresh: false });
  assert.equal(resumed.actions.every((action) => action.mode === 'resume'), true);
  assert.deepEqual(
    resumed.actions.map((action) => action.runtimeSessionId),
    fresh.actions.map((action) => action.runtimeSessionId),
  );
  control.close();
});

test('SCN-fleet-wind-down-safety: active work blocks runtime shutdown and failed startup prevents manager launch', () => {
  const fixture = fleetFixture();
  const control = openControlPlane({ repositoryRoot: fixture.root, env: fixture.env });
  let session = 0;
  const adapter = createClaudeAdapter({ idFactory: () => `failure-${++session}` });
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
  const down = planFleetDown({ repositoryRoot: fixture.root, controlPlane: control });
  assert.equal(down.canProceed, false);
  assert.equal(down.blockers.some((blocker) => blocker.areaId === fixture.worker && blocker.state === 'working'), true);
  assert.throws(
    () => stopFleet({ plan: down, controlPlane: control, stopRuntime: () => ({ stopped: true }) }),
    (error) => error.code === 'FLEET_NOT_READY_TO_STOP',
  );
  control.close();
});

test('SCN-mixed-runtime: Codex and Claude share stable identities while planning and capture stay provider-specific', () => {
  const fixture = fleetFixture({ workerRuntime: 'codex' });
  const control = openControlPlane({ repositoryRoot: fixture.root, env: fixture.env });
  const adapters = new Map([
    ['claude', createClaudeAdapter({ idFactory: () => 'claude-manager-1' })],
    ['codex', createCodexAdapter({ executable: 'codex' })],
  ]);
  const plan = planFleetUp({
    repositoryRoot: fixture.root, controlPlane: control, adapters, fresh: true,
  });
  assert.equal(plan.canProceed, true);
  assert.equal(plan.actions[0].areaId, fixture.worker);
  assert.equal(plan.actions[0].runtime, 'codex');
  assert.equal(plan.actions[0].launch.args[0], 'exec');
  assert.equal(plan.actions.at(-1).runtime, 'claude');
  assert.equal(plan.actions.at(-1).runtimeSessionId, 'claude-manager-1');

  const started = startFleet({
    plan, controlPlane: control, adapters,
    executor: (launch) => launch.areaId === fixture.worker
      ? { status: 0, stdout: '{"type":"thread.started","thread_id":"codex-worker-1"}\n' }
      : { status: 0 },
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
