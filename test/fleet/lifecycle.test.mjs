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
import { defaultManagerCheckInSchedule, organizationGraphFromConfig } from '../../src/kernel/organization.mjs';
import { createWorktrees } from '../../src/kernel/worktrees.mjs';
import { ResourceService } from '../../src/resources/service.mjs';
import { createTorchToolset } from '../../src/mcp/tools.mjs';
import {
  createFleetBrief, detachFleet, planAreaUp, planFleetDetach, planFleetDown, planFleetUp, startFleet, stopFleet,
} from '../../src/runtime/lifecycle.mjs';

function fleetFixture({ workerRuntime = 'claude', hierarchy = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'torch-lifecycle-'));
  execFileSync('git', ['init', '-b', 'main', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'torch-test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'TORCH Test']);
  writeFileSync(join(root, 'app.js'), 'export const app = true;\n');
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'fixture']);
  let repository = inspectRepository(root);
  const proposal = proposeDomains({ repository, analysis: analyzeRepository(repository) });
  if (hierarchy) proposal.domains.push({
    id: 'runtime-lead', title: 'Runtime Lead', kind: 'cross-cutting',
    scope: ['coordinate runtime integration across specialists'], not_scope: [],
    owned_paths: ['docs/**'], shared_paths: [], neighbours: [], required_checks: [], resources: [],
    runtime: 'claude', evidence: ['app.js'],
  });
  proposal.domains[0].runtime = workerRuntime;
  proposal.domains[0].resources = ['browser'];
  proposal.resources = [{ id: 'browser', capacity: 1, queue: 'fifo', max_hold_seconds: 300 }];
  proposal.review = {
    status: 'approved', reviewedAt: '2026-09-27T00:00:00Z', reviewedBy: 'fixture-owner', notes: [],
  };
  const env = { ...process.env, XDG_DATA_HOME: join(tmpdir(), `${basename(root)}-state`) };
  installProject({ repository, proposal, env, projectId: 'lifecycle-fixture' });
  if (hierarchy) {
    const configPath = join(root, '.torch', 'torch.yaml');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.organization = {
      schema: 'torch.dev/organization/v1alpha1', revision: 1, owner_facing_role: 'session-manager',
      roles: [
        {
          id: 'owner', title: 'Project Owner', kind: 'owner', identity_id: 'owner',
          responsibilities: ['Own project direction.'], authority: ['approve-organization', 'approve-release'],
          coordinates: [], reports_to: [], consults_with: [],
        },
        {
          id: 'session-manager', title: 'Session Manager', kind: 'owner-facing', identity_id: 'session-manager',
          responsibilities: ['Operate the fleet.'], authority: ['receive-owner-requests', 'operate-fleet'],
          coordinates: ['runtime-lead'], reports_to: [], consults_with: [],
        },
        {
          id: 'runtime-lead', title: 'Runtime Lead', kind: 'domain-coordination', identity_id: 'runtime-lead',
          responsibilities: ['Coordinate runtime integration.'], authority: ['coordinate-domains'],
          coordinates: proposal.domains.filter((domain) => domain.id !== 'runtime-lead').map((domain) => domain.id),
          reports_to: ['session-manager'], consults_with: [],
        },
        ...proposal.domains.filter((domain) => domain.id !== 'runtime-lead').map((domain) => ({
          id: domain.id, title: domain.title, kind: 'specialist', identity_id: domain.id,
          responsibilities: domain.scope, authority: ['own-implementation'], coordinates: [],
          reports_to: ['runtime-lead'], consults_with: [],
        })),
      ],
      implementation_owners: [],
    };
    config.schedules.push(defaultManagerCheckInSchedule('runtime-lead'));
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  }
  execFileSync('git', ['-C', root, 'add', '.torch']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'install torch']);
  repository = inspectRepository(root);
  const worktreeParent = join(tmpdir(), `${basename(root)}-worktrees`);
  createWorktrees({ repository, parentOverride: worktreeParent });
  return { root, env, worker: proposal.domains[0].id, middleManager: hierarchy ? 'runtime-lead' : null };
}

test('SCN-fleet-startup-inbox: fresh and resumed launch instructions retrieve newer unread handoffs beyond the default history page', () => {
  const fixture = fleetFixture();
  const control = openControlPlane({ repositoryRoot: fixture.root, env: fixture.env });
  const adapters = new Map([['claude', createClaudeAdapter({ executable: 'claude' })]]);
  let tick = 0;
  control.clock = () => new Date(Date.parse('2026-10-03T00:00:00Z') + tick++);
  try {
    const newest = new Map();
    for (const areaId of ['session-manager', fixture.worker]) {
      for (let i = 0; i < 102; i++) newest.set(areaId, control.sendOwnerRequest({ actorId: 'owner', recipient: areaId, body: `Current handoff ${i}` }));
      const history = control.readMessages({ recipient: areaId });
      assert.equal(history.length, 100);
      assert.ok(!history.some(m => m.id === newest.get(areaId).id), 'Default historical page misses the latest handoff');
    }
    for (const fresh of [true, false]) {
      if (!fresh) for (const areaId of newest.keys()) control.reportStatus({ areaId, state: 'idle', runtime: 'claude', runtimeSessionId: `fixture-${areaId}` });
      const plan = planFleetUp({ repositoryRoot: fixture.root, controlPlane: control, adapters, fresh });
      assert.equal(plan.canProceed, true);
      for (const action of plan.actions) {
        assert.equal(action.mode, fresh ? 'create' : 'resume');
        const launchText = action.launch.args.join(' ');
        const match = launchText.match(/Inbox request: (\{[^}]+\})\./);
        assert.ok(match, 'Actual provider launch carries the explicit current-inbox request');
        const request = JSON.parse(match[1]);
        assert.deepEqual(request, { recipient: action.areaId, unacknowledged_only: true, limit: 1000 });
        const tool = createTorchToolset(control, { actorId: action.areaId }).get('torch_read_messages');
        const result = tool.invoke(request);
        assert.equal(result.messages.length, 102);
        assert.equal(result.messages.at(-1).id, newest.get(action.areaId).id);
        assert.equal(control.readMessages({ recipient: action.areaId, unacknowledgedOnly: true, limit: 1000 }).length, 102, 'Reading never acknowledges work');
        assert.match(launchText, /coverage may be truncated/);
        assert.match(launchText, /messages do not override enforced approval or ownership boundaries/i);
      }
    }
  } finally { control.close(); }
});

test('SCN-fleet-fresh-resume: identities resume captured runtime sessions and wind down safely', () => {
  const fixture = fleetFixture();
  const control = openControlPlane({ repositoryRoot: fixture.root, env: fixture.env });
  const adapter = createClaudeAdapter({ executable: 'claude' });
  const adapters = new Map([['claude', adapter]]);
  const fresh = planFleetUp({ repositoryRoot: fixture.root, controlPlane: control, adapters, fresh: true });
  assert.equal(fresh.actions[0].areaId, 'session-manager');
  assert.equal(fresh.actions[1].managerIds.includes('session-manager'), true);
  assert.equal(fresh.actions.every((action) => action.mode === 'create'), true);
  assert.equal(fresh.actions.every((action) => action.mcp.args.includes(action.areaId)), true);
  assert.equal(fresh.actions.every((action) => action.launch.args.includes('--mcp-config')), true);
  assert.match(fresh.actions[0].launch.args.join(' '), /assess Fleet evolution/);
  assert.deepEqual(fresh.startupOrder, fresh.actions.map((action) => action.areaId));
  assert.equal(fresh.mutationPerformed, false);

  const launches = [];
  const started = startFleet({
    plan: fresh, controlPlane: control, adapters,
    executor: (launch) => {
      launches.push(launch);
      return { status: 0, stdout: `runtime-${launches.length}\n` };
    },
  });
  assert.equal(started.started[0].areaId, 'session-manager');
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

test('SCN-hierarchy-aware-start-stop: managers start before reports and shutdown status routes bottom-up', () => {
  const fixture = fleetFixture({ hierarchy: true });
  const control = openControlPlane({ repositoryRoot: fixture.root, env: fixture.env });
  const adapter = createClaudeAdapter({ executable: 'claude' });
  const adapters = new Map([['claude', adapter]]);
  const up = planFleetUp({ repositoryRoot: fixture.root, controlPlane: control, adapters, fresh: true });
  assert.equal(up.canProceed, true, JSON.stringify(up.blockers));
  assert.deepEqual(up.startupOrder, ['session-manager', 'runtime-lead', fixture.worker]);
  assert.deepEqual(up.actions.find((action) => action.areaId === fixture.worker).managerIds, ['runtime-lead']);
  assert.deepEqual(up.actions.find((action) => action.areaId === 'runtime-lead').managerIds, ['session-manager']);
  const middleManager = up.actions.find((action) => action.areaId === 'runtime-lead');
  const specialist = up.actions.find((action) => action.areaId === fixture.worker);
  assert.match(middleManager.instructionText, /Scheduled manager check-ins/);
  assert.match(middleManager.instructionText, /torch_plan_manager_check_in/);
  assert.match(middleManager.instructionText, /only when you are the named approver/);
  assert.doesNotMatch(specialist.instructionText, /Scheduled manager check-ins/);

  const launches = [];
  const started = startFleet({
    plan: up, controlPlane: control, adapters,
    executor: (launch) => ({ status: 0, stdout: `session-${launches.push(launch)}\n` }),
  });
  assert.deepEqual(started.started.map((action) => action.areaId), up.startupOrder);
  for (const areaId of ['session-manager', 'runtime-lead', fixture.worker]) {
    control.reportStatus({ areaId, state: 'idle', summary: 'Ready for wind-down.' });
  }

  const down = planFleetDown({ repositoryRoot: fixture.root, controlPlane: control, adapters });
  assert.equal(down.canProceed, true, JSON.stringify(down.blockers));
  assert.deepEqual(down.shutdownOrder, [fixture.worker, 'runtime-lead', 'session-manager']);
  const stopped = stopFleet({
    plan: down, controlPlane: control, stopRuntime: () => ({ stopped: true }),
  });
  assert.deepEqual(stopped.stopped.map((action) => action.areaId), down.shutdownOrder);
  assert.equal(control.readMessages({ recipient: 'runtime-lead' }).some((message) =>
    message.sender === fixture.worker && message.body.startsWith('Final status:')), true);
  assert.equal(control.readMessages({ recipient: 'session-manager' }).some((message) =>
    message.sender === 'runtime-lead' && message.body.startsWith('Final status:')), true);
  control.close();
});

test('SCN-hierarchy-startup-cycle: identity-level reporting cycles block launch and shutdown plans', () => {
  const fixture = fleetFixture({ hierarchy: true });
  const configPath = join(fixture.root, '.torch', 'torch.yaml');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.organization.roles.push({
    id: 'session-manager-secondary', title: 'Session Manager Operations', kind: 'fleet-operations',
    identity_id: 'session-manager', responsibilities: ['Coordinate reporting handoffs.'],
    authority: ['operate-fleet'], coordinates: [], reports_to: ['runtime-lead'], consults_with: [],
  });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const control = openControlPlane({ repositoryRoot: fixture.root, env: fixture.env });
  const up = planFleetUp({ repositoryRoot: fixture.root, controlPlane: control, adapter: createClaudeAdapter(), fresh: true });
  assert.equal(up.canProceed, false);
  assert.equal(up.blockers.some((blocker) => blocker.code === 'FLEET_STARTUP_IDENTITY_CYCLE'), true);
  let launched = false;
  assert.throws(() => startFleet({
    plan: up, controlPlane: control, executor: () => { launched = true; return { status: 0 }; },
  }), (error) => error.code === 'FLEET_NOT_READY_TO_START');
  assert.equal(launched, false);
  const down = planFleetDown({ repositoryRoot: fixture.root, controlPlane: control });
  assert.equal(down.canProceed, false);
  assert.equal(down.blockers.some((blocker) => blocker.code === 'FLEET_STARTUP_IDENTITY_CYCLE'), true);
  control.close();
});

test('SCN-current-instructions-on-resume: an offline identity receives current canonical rules, not stale worktree copies', () => {
  const fixture = fleetFixture();
  const control = openControlPlane({ repositoryRoot: fixture.root, env: fixture.env });
  const adapter = createClaudeAdapter();
  const adapters = new Map([['claude', adapter]]);
  const initial = planFleetUp({ repositoryRoot: fixture.root, controlPlane: control, adapters, fresh: true });
  const initialManager = initial.actions.find((action) => action.areaId === 'session-manager');
  assert.match(initialManager.instructionText, /Active organization metadata/);
  assert.match(initialManager.instructionText, new RegExp(`"identityId":"${fixture.worker}"`));
  assert.match(initialManager.instructionText, /"directReports":\[/);
  startFleet({ plan: initial, controlPlane: control, adapters, executor: () => ({ status: 0, stdout: 'session-id\n' }) });
  const initialWorker = initial.actions.find((action) => action.areaId === fixture.worker);
  const workerPath = initialWorker.worktree;
  const canonicalCommon = join(fixture.root, '.torch', 'prompts', 'COMMON.md');
  const canonicalArea = join(fixture.root, '.torch', 'prompts', `${fixture.worker}.md`);
  writeFileSync(canonicalCommon, '# Current rules\n\nNever land two changes in parallel.\n');
  writeFileSync(canonicalArea, '# Current ownership\n\nResume the active task from the canonical brief.\n');
  writeFileSync(join(workerPath, '.torch', 'prompts', 'COMMON.md'), '# Stale worktree copy\n\nOld landing wording.\n');
  writeFileSync(join(workerPath, '.torch', 'prompts', `${fixture.worker}.md`), '# Stale domain copy\n\nOld task instruction.\n');

  const configPath = join(fixture.root, '.torch', 'torch.yaml');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const graph = organizationGraphFromConfig(config);
  graph.revision += 1;
  graph.roles.find((role) => role.kind === 'specialist' && role.identity_id === fixture.worker)
    .responsibilities = ['Use the revised management handoff contract.'];
  config.organization = graph;
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const resumed = planFleetUp({ repositoryRoot: fixture.root, controlPlane: control, adapters, fresh: false });
  const worker = resumed.actions.find((action) => action.areaId === fixture.worker);
  assert.notEqual(worker.instructionDigest, initialWorker.instructionDigest);
  assert.match(worker.instructionText, /Use the revised management handoff contract/);
  assert.match(worker.instructionText, /Never land two changes in parallel/);
  assert.match(worker.instructionText, /Resume the active task from the canonical brief/);
  assert.doesNotMatch(worker.instructionText, /Stale worktree copy|Old task instruction/);
  assert.ok(worker.launch.args.includes('--append-system-prompt-file'));
  assert.ok(worker.launch.args.includes(worker.promptFile));
  const brief = createFleetBrief({ repositoryRoot: fixture.root, controlPlane: control, areaId: fixture.worker }).areas[0];
  assert.equal(brief.instructionDigest, worker.instructionDigest);
  assert.match(brief.prompt, /TORCH runtime rules/);

  startFleet({ plan: resumed, controlPlane: control, adapters, executor: () => ({ status: 0 }) });
  assert.equal(readFileSync(worker.promptFile, 'utf8'), worker.instructionText);
  assert.equal(control.identity(fixture.worker).runtimeSessionId, 'session-id');
  control.close();
});

test('SCN-fleet-wind-down-safety: active work blocks shutdown and a manager remains available after partial startup', () => {
  const fixture = fleetFixture();
  const control = openControlPlane({ repositoryRoot: fixture.root, env: fixture.env });
  const adapter = createClaudeAdapter();
  const plan = planFleetUp({ repositoryRoot: fixture.root, controlPlane: control, adapter, fresh: true });
  assert.throws(
    () => startFleet({
      plan, controlPlane: control, adapters: new Map([['claude', adapter]]),
      executor: (launch) => launch.areaId === fixture.worker
        ? { status: 1, stderr: 'launch failed' }
        : { status: 0, stdout: 'manager-session\n' },
    }),
    (error) => error.code === 'FLEET_START_FAILED'
      && error.details.started.some((action) => action.areaId === 'session-manager')
      && control.identity('session-manager').runtimeSessionId === 'manager-session',
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
  const workerAction = plan.actions.find((action) => action.areaId === fixture.worker);
  const managerAction = plan.actions.find((action) => action.areaId === 'session-manager');
  assert.equal(plan.actions[0].areaId, 'session-manager');
  assert.equal(workerAction.runtime, 'codex');
  assert.equal(workerAction.launch.args.includes('exec'), true);
  assert.equal(workerAction.launch.args.some((arg) => arg.includes('mcp_servers.')), true);
  assert.equal(workerAction.launch.args.some((arg) => arg.includes(fixture.worker)), true);
  assert.equal(managerAction.runtime, 'claude');
  assert.equal(managerAction.launch.args.includes('--mcp-config'), true);
  assert.equal(managerAction.runtimeSessionId, null);
  assert.equal(managerAction.requiresRuntimeIdCapture, true);

  const started = startFleet({
    plan, controlPlane: control, adapters,
    executor: (launch) => launch.areaId === fixture.worker
      ? { status: 0, stdout: '{"type":"thread.started","thread_id":"codex-worker-1"}\n{"type":"turn.completed"}\n' }
      : { status: 0, stdout: 'claude-manager-1\n' },
  });
  assert.deepEqual(started.started.map((item) => item.runtimeSessionId), [
    'claude-manager-1', 'codex-worker-1',
  ]);
  assert.equal(control.identity(fixture.worker).runtime, 'codex');
  assert.equal(control.identity(fixture.worker).state, 'idle');
  assert.equal(control.identity('session-manager').runtime, 'claude');
  assert.equal(control.identity('session-manager').state, 'starting');

  const resumed = planFleetUp({ repositoryRoot: fixture.root, controlPlane: control, adapters, fresh: false });
  const codexResume = resumed.actions.find((action) => action.areaId === fixture.worker);
  assert.equal(codexResume.mode, 'resume');
  assert.match(codexResume.launch.args.at(-1), /AUTHORITATIVE CURRENT TORCH INSTRUCTIONS/);
  assert.match(codexResume.launch.args.at(-1), new RegExp(codexResume.instructionDigest));
  assert.match(codexResume.launch.args.at(-1), /Never push a specialist branch directly/);

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

test('SCN-codex-terminal-completion: a captured Codex identity is not a completed turn without terminal evidence', () => {
  const fixture = fleetFixture({ workerRuntime: 'codex' });
  const control = openControlPlane({ repositoryRoot: fixture.root, env: fixture.env });
  const adapters = new Map([
    ['claude', createClaudeAdapter()],
    ['codex', createCodexAdapter({ executable: 'codex' })],
  ]);
  const plan = planFleetUp({ repositoryRoot: fixture.root, controlPlane: control, adapters, fresh: true });
  assert.throws(() => startFleet({
    plan, controlPlane: control, adapters,
    executor: (launch) => launch.areaId === fixture.worker
      ? { status: 0, stdout: '{"type":"thread.started","thread_id":"codex-interrupted-1"}\n' }
      : { status: 0, stdout: 'claude-manager-1\n' },
  }), (error) => error.code === 'FLEET_START_FAILED'
    && error.details.executorOutcome.reason === 'codex-terminal-event-missing');
  assert.equal(control.identity(fixture.worker).state, 'working');
  assert.equal(control.identity(fixture.worker).runtimeSessionId, 'codex-interrupted-1');
  const duplicate = planAreaUp({
    repositoryRoot: fixture.root, controlPlane: control, areaId: fixture.worker, adapters,
  });
  assert.equal(duplicate.canProceed, false);
  assert.deepEqual(duplicate.blockers, [{
    areaId: fixture.worker, code: 'RUNTIME_IDENTITY_ACTIVE', state: 'working',
    runtimeSessionId: 'codex-interrupted-1',
  }]);
  control.close();
});

test('SCN-codex-startup-diagnostics: owner-visible startup failures prefer bounded structured Codex evidence without disclosure', () => {
  const modelFixture = fleetFixture({ workerRuntime: 'codex' });
  const modelControl = openControlPlane({ repositoryRoot: modelFixture.root, env: modelFixture.env });
  const modelAdapters = new Map([
    ['claude', createClaudeAdapter()],
    ['codex', createCodexAdapter({ executable: 'codex' })],
  ]);
  const modelPlan = planFleetUp({
    repositoryRoot: modelFixture.root, controlPlane: modelControl, adapters: modelAdapters, fresh: true,
  });
  let modelFailure;
  assert.throws(
    () => startFleet({
      plan: modelPlan, controlPlane: modelControl, adapters: modelAdapters,
      executor: (launch) => launch.areaId === modelFixture.worker
        ? {
          status: 23,
          stdout: '{"type":"error","code":"MODEL_NOT_SUPPORTED","message":"Requested model fixture-model is not supported","prompt":"fixture prompt must not leak"}\n',
          stderr: 'Vercel MCP authentication warning: token=fixture-token password=fixture-password',
        }
        : { status: 0, stdout: 'claude-manager-1\n' },
    }),
    (error) => {
      modelFailure = error;
      return error.code === 'FLEET_START_FAILED' && error.details.status === 23;
    },
  );
  assert.deepEqual(modelFailure.details.diagnostic, {
    schema: 'torch.dev/runtime-startup-diagnostic/v1alpha1', outcome: 'known',
    category: 'model-rejection', code: 'MODEL_NOT_SUPPORTED',
    message: 'Requested model fixture-model is not supported',
    stderr: 'Vercel MCP authentication warning: token=[REDACTED] password=[REDACTED]',
  });
  assert.equal(modelFailure.details.stderr, modelFailure.details.diagnostic.stderr);
  assert.doesNotMatch(JSON.stringify(modelFailure.details), /fixture prompt|fixture-token|fixture-password/);
  assert.equal(modelControl.identity(modelFixture.worker).state, 'offline');
  modelControl.close();

  const malformedFixture = fleetFixture({ workerRuntime: 'codex' });
  const malformedControl = openControlPlane({ repositoryRoot: malformedFixture.root, env: malformedFixture.env });
  const malformedAdapters = new Map([
    ['claude', createClaudeAdapter()],
    ['codex', createCodexAdapter({ executable: 'codex' })],
  ]);
  const malformedPlan = planFleetUp({
    repositoryRoot: malformedFixture.root, controlPlane: malformedControl, adapters: malformedAdapters, fresh: true,
  });
  let malformedFailure;
  assert.throws(
    () => startFleet({
      plan: malformedPlan, controlPlane: malformedControl, adapters: malformedAdapters,
      executor: (launch) => launch.areaId === malformedFixture.worker
        ? { status: 24, stdout: '{malformed Codex event', stderr: 'MCP warning' }
        : { status: 0, stdout: 'claude-manager-2\n' },
    }),
    (error) => {
      malformedFailure = error;
      return error.code === 'FLEET_START_FAILED' && error.details.status === 24;
    },
  );
  assert.equal(malformedFailure.details.diagnostic.outcome, 'unknown');
  assert.equal(malformedFailure.details.diagnostic.reason, 'stdout-malformed-json');
  assert.equal(malformedFailure.details.diagnostic.stderr, 'MCP warning');
  malformedControl.close();

  const oversizedFixture = fleetFixture({ workerRuntime: 'codex' });
  const oversizedControl = openControlPlane({ repositoryRoot: oversizedFixture.root, env: oversizedFixture.env });
  const oversizedAdapters = new Map([
    ['claude', createClaudeAdapter()],
    ['codex', createCodexAdapter({ executable: 'codex' })],
  ]);
  const oversizedPlan = planFleetUp({
    repositoryRoot: oversizedFixture.root, controlPlane: oversizedControl, adapters: oversizedAdapters, fresh: true,
  });
  let oversizedFailure;
  assert.throws(
    () => startFleet({
      plan: oversizedPlan, controlPlane: oversizedControl, adapters: oversizedAdapters,
      executor: (launch) => launch.areaId === oversizedFixture.worker
        ? { status: 25, stdout: 'x'.repeat((16 * 1024) + 1), stderr: 'MCP warning' }
        : { status: 0, stdout: 'claude-manager-3\n' },
    }),
    (error) => {
      oversizedFailure = error;
      return error.code === 'FLEET_START_FAILED' && error.details.status === 25;
    },
  );
  assert.equal(oversizedFailure.details.diagnostic.outcome, 'unknown');
  assert.equal(oversizedFailure.details.diagnostic.reason, 'stdout-exceeds-bound');
  assert.doesNotMatch(JSON.stringify(oversizedFailure.details), /x{512}/);
  oversizedControl.close();
});
