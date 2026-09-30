import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import { createClaudeAdapter } from '../../src/adapters/claude.mjs';
import { createCodexAdapter } from '../../src/adapters/codex.mjs';
import { createPiAdapter } from '../../src/adapters/pi.mjs';
import { createRuntimeAdapterRegistry } from '../../src/adapters/registry.mjs';
import { createConsoleServer } from '../../src/console/server.mjs';
import { openControlPlane } from '../../src/control-plane/service.mjs';
import { analyzeRepository } from '../../src/kernel/analyze.mjs';
import { proposeDomains } from '../../src/kernel/domains.mjs';
import { diagnoseProject } from '../../src/kernel/doctor.mjs';
import { inspectRepository } from '../../src/kernel/git.mjs';
import { installProject } from '../../src/kernel/install.mjs';
import { createWorktrees } from '../../src/kernel/worktrees.mjs';
import { planAreaUp, planFleetUp } from '../../src/runtime/lifecycle.mjs';
import { unsupportedCapability } from '../../src/adapters/runtime.mjs';
import { observeProject } from '../../src/observability/snapshot.mjs';

function localAdapter() {
  return {
    name: 'local-agent',
    configuration: { worker_pool: 'local' },
    capabilities: {
      detect: true, configure: 'plan-only', modelSelection: true, reasoningSelection: true,
      perInvocationCostCeiling: { createSession: [], resumeSession: [] },
      createSession: true, resumeSession: true, sendOrSteer: false, getStatus: false,
      listSessions: false, stopSession: false, captureRuntimeId: false,
      installHooks: false, removeHooks: false,
    },
    detect: () => ({ available: true, adapter: 'local-agent' }),
    configure: ({ repositoryRoot, areaId }) => ({
      adapter: 'local-agent', mutationPerformed: false,
      mcp: { name: `torch-${areaId}`, command: process.execPath, args: [], cwd: repositoryRoot },
    }),
    createSession: ({ areaId, worktree, model, reasoning }) => ({
      adapter: 'local-agent', areaId, runtimeSessionId: null,
      requiresRuntimeIdCapture: false,
      profile: { model, reasoning },
      launch: { command: 'local-agent', args: [model, reasoning], cwd: worktree, mutatesRuntime: true },
    }),
    resumeSession: ({ areaId, runtimeSessionId, worktree, model, reasoning }) => ({
      adapter: 'local-agent', areaId, runtimeSessionId,
      profile: { model, reasoning },
      launch: { command: 'local-agent', args: [model, reasoning], cwd: worktree, mutatesRuntime: true },
    }),
    sendOrSteer() { return unsupportedCapability(this.name, 'sendOrSteer'); },
    getStatus() { return unsupportedCapability(this.name, 'getStatus'); },
    listSessions() { return unsupportedCapability(this.name, 'listSessions'); },
    stopSession() { return unsupportedCapability(this.name, 'stopSession'); },
    captureRuntimeId() { return unsupportedCapability(this.name, 'captureRuntimeId'); },
    installHooks() { return unsupportedCapability(this.name, 'installHooks'); },
    removeHooks() { return unsupportedCapability(this.name, 'removeHooks'); },
  };
}

function fixture(registry) {
  const root = mkdtempSync(join(tmpdir(), 'torch-runtime-profiles-'));
  const env = { ...process.env, XDG_DATA_HOME: join(tmpdir(), `${basename(root)}-state`) };
  execFileSync('git', ['init', '-b', 'main', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'torch-test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'TORCH Test']);
  writeFileSync(join(root, 'app.js'), 'export const app = true;\n');
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'fixture']);
  const repository = inspectRepository(root);
  const proposal = proposeDomains({ repository, analysis: analyzeRepository(repository) });
  const worker = proposal.domains[0];
  worker.runtime = 'codex';
  worker.model = 'gpt-worker';
  worker.reasoning = null;
  worker.resources = [];
  proposal.session_manager = {
    runtime: 'claude', model: 'claude-manager', reasoning: 'high',
  };
  proposal.domains.push({
    id: 'docs', title: 'Documentation', scope: ['documentation maintenance'],
    not_scope: ['application implementation'], owned_paths: ['docs/**'], shared_paths: [],
    neighbours: [worker.id], required_checks: [], resources: [],
    runtime: 'local-agent', model: 'manual-model', reasoning: 'deep',
  });
  proposal.domains.push({
    id: 'codex-defaults', title: 'Codex Defaults', scope: ['default Codex profile'],
    not_scope: ['application implementation'], owned_paths: ['defaults/**'], shared_paths: [],
    neighbours: [], required_checks: [], resources: [], runtime: 'codex',
  });
  proposal.review = {
    status: 'approved', reviewedAt: '2026-09-28T00:00:00Z', reviewedBy: 'fixture-owner', notes: [],
  };
  installProject({
    repository, proposal, env, projectId: 'runtime-profile-fixture',
    runtimes: ['claude', 'codex', 'local-agent'], runtimeRegistry: registry,
  });
  execFileSync('git', ['-C', root, 'add', '.torch']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'install torch']);
  createWorktrees({ repository: inspectRepository(root), parentOverride: join(tmpdir(), `${basename(root)}-worktrees`) });
  return { root, env, worker: worker.id };
}

test('SCN-runtime-profiles: each identity launches through its assigned adapter and profile', () => {
  const registry = createRuntimeAdapterRegistry({ adapters: [localAdapter()] });
  const context = fixture(registry);
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  const adapters = registry.toMap();
  adapters.set('codex', createCodexAdapter({ executable: 'codex' }));
  adapters.set('claude', createClaudeAdapter({ executable: 'claude' }));

  const plan = planFleetUp({
    repositoryRoot: context.root, controlPlane: control, adapters, fresh: true,
  });
  assert.equal(plan.canProceed, true, JSON.stringify(plan.blockers));
  const worker = plan.actions.find((action) => action.areaId === context.worker);
  const docs = plan.actions.find((action) => action.areaId === 'docs');
  const manager = plan.actions.find((action) => action.areaId === 'session-manager');
  const defaultCodex = plan.actions.find((action) => action.areaId === 'codex-defaults');
  assert.equal(worker.runtime, 'codex');
  assert.deepEqual(worker.profile, { model: 'gpt-worker', reasoning: 'high', launchPolicy: { approval: 'approve-for-me' } });
  assert.equal(worker.launch.args.includes('gpt-worker'), true);
  assert.equal(worker.profile.reasoning, 'high', 'omitted identity reasoning inherits Codex default');
  assert.equal(manager.runtime, 'claude');
  assert.deepEqual(manager.profile, { model: 'claude-manager', reasoning: 'high', launchPolicy: {} });
  assert.deepEqual(manager.launch.args.slice(manager.launch.args.indexOf('--effort'), manager.launch.args.indexOf('--effort') + 2), ['--effort', 'high']);
  assert.deepEqual(defaultCodex.profile, { model: 'gpt-6-luna', reasoning: 'high', launchPolicy: { approval: 'approve-for-me' } });
  assert.equal(defaultCodex.launch.args.includes('gpt-6-luna'), true);
  assert.equal(defaultCodex.launch.args.includes('model_reasoning_effort="high"'), true);
  assert.deepEqual(
    (({ runtime, model, reasoning }) => ({ runtime, model, reasoning }))(control.identity('codex-defaults')),
    { runtime: 'codex', model: 'gpt-6-luna', reasoning: 'high' },
    'live identity query resolves and exposes the configured adapter defaults',
  );
  assert.deepEqual(
    (({ runtime, model, reasoning }) => ({ runtime, model, reasoning }))(control.identity('session-manager')),
    { runtime: 'claude', model: 'claude-manager', reasoning: 'high' },
    'identity-specific runtime profile overrides remain visible',
  );
  assert.equal(docs.runtime, 'local-agent');
  assert.deepEqual(docs.profile, { model: 'manual-model', reasoning: 'deep', launchPolicy: {} });
  assert.deepEqual(docs.launch.args, ['manual-model', 'deep']);
  assert.equal(plan.mutationPerformed, false);

  const configPath = join(context.root, '.torch', 'torch.yaml');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.deepEqual(config.runtimes.codex, {
    model: 'gpt-6-luna', reasoning: 'high', launchPolicy: { approval: 'approve-for-me' },
  });
  assert.deepEqual(config.runtimes.claude, { model: 'sonnet', background: true });
  assert.equal(config.session_manager.model, 'claude-manager', 'identity overrides remain independent');
  config.runtimes.codex.launchPolicy = { sandbox: 'workspace-write', approval: 'on-request' };
  config.domains.find((area) => area.id === context.worker).launchPolicy = { approval: 'never' };
  config.session_manager.launchPolicy = { permissionMode: 'acceptEdits' };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const policyPlan = planFleetUp({ repositoryRoot: context.root, controlPlane: control, adapters, fresh: true });
  assert.equal(policyPlan.canProceed, true, JSON.stringify(policyPlan.blockers));
  const policyWorker = policyPlan.actions.find((action) => action.areaId === context.worker);
  const policyDefault = policyPlan.actions.find((action) => action.areaId === 'codex-defaults');
  const policyManager = policyPlan.actions.find((action) => action.areaId === 'session-manager');
  assert.deepEqual(policyWorker.profile.launchPolicy, { sandbox: 'workspace-write', approval: 'never' });
  assert.ok(policyWorker.launch.args.includes('--sandbox'));
  assert.ok(policyWorker.launch.args.includes('workspace-write'));
  assert.ok(policyWorker.launch.args.includes('--ask-for-approval'));
  assert.ok(policyWorker.launch.args.includes('never'));
  assert.deepEqual(policyDefault.profile.launchPolicy, { sandbox: 'workspace-write', approval: 'on-request' });
  assert.ok(policyDefault.launch.args.includes('--ask-for-approval'));
  assert.ok(policyDefault.launch.args.includes('on-request'));
  assert.ok(policyManager.launch.args.includes('--permission-mode'));
  assert.ok(policyManager.launch.args.includes('acceptEdits'));
  assert.equal(policyPlan.mutationPerformed, false, 'policy resolution only changes a future launch plan');
  assert.equal(policyPlan.actions.every((action) => action.launch.mutatesRuntime), true, 'plan describes launches but starts none');

  const invalidConfig = JSON.parse(readFileSync(configPath, 'utf8'));
  invalidConfig.runtimes.codex.launchPolicy = { sandbox: 'workspace-write', approval: 'approve-for-me' };
  writeFileSync(configPath, `${JSON.stringify(invalidConfig, null, 2)}\n`);
  const conflictPlan = planFleetUp({ repositoryRoot: context.root, controlPlane: control, adapters, fresh: true });
  assert.equal(conflictPlan.canProceed, false);
  assert.ok(conflictPlan.blockers.some((blocker) => blocker.code === 'RUNTIME_PROFILE_UNSUPPORTED'
    && blocker.capabilities.some((issue) => issue.conflictsWith === 'launchPolicy.sandbox')));
  invalidConfig.runtimes.codex.launchPolicy = { approval: 'never' };
  invalidConfig.domains.find((area) => area.id === 'docs').launchPolicy = { permissionMode: 'bypassPermissions' };
  writeFileSync(configPath, `${JSON.stringify(invalidConfig, null, 2)}\n`);
  const unsafePlan = planFleetUp({ repositoryRoot: context.root, controlPlane: control, adapters, fresh: true });
  assert.equal(unsafePlan.canProceed, false, 'unsafe Claude permission modes block before execution');
  assert.ok(unsafePlan.blockers.some((blocker) => blocker.areaId === 'docs' && blocker.code === 'RUNTIME_PROFILE_UNSUPPORTED'));
  invalidConfig.domains.find((area) => area.id === 'docs').launchPolicy = { sandbox: 'workspace-write' };
  writeFileSync(configPath, `${JSON.stringify(invalidConfig, null, 2)}\n`);
  const unsupportedPlan = planFleetUp({ repositoryRoot: context.root, controlPlane: control, adapters, fresh: true });
  assert.equal(unsupportedPlan.canProceed, false, 'custom adapter without a launch-policy declaration fails closed');
  assert.ok(unsupportedPlan.blockers.some((blocker) => blocker.areaId === 'docs' && blocker.code === 'RUNTIME_PROFILE_UNSUPPORTED'));
  delete invalidConfig.domains.find((area) => area.id === 'docs').launchPolicy;
  writeFileSync(configPath, `${JSON.stringify(invalidConfig, null, 2)}\n`);
  const snapshot = observeProject({ repositoryRoot: context.root, env: context.env, runtimeRegistry: registry });
  assert.deepEqual(
    snapshot.agents.find((agent) => agent.areaId === 'codex-defaults')
      && { model: snapshot.agents.find((agent) => agent.areaId === 'codex-defaults').model,
        reasoning: snapshot.agents.find((agent) => agent.areaId === 'codex-defaults').reasoning },
    { model: 'gpt-6-luna', reasoning: 'high' },
    'dashboard snapshot surfaces effective adapter defaults',
  );
  config.runtimes.codex.reasoning = 'medium';
  config.runtimes.codex.model = 'gpt-6-luna-custom';
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const editedProfilePlan = planFleetUp({
    repositoryRoot: context.root, controlPlane: control, adapters, fresh: true,
  });
  assert.equal(editedProfilePlan.canProceed, true, 'owner can change the project default without replacing the adapter');
  const editedDefault = editedProfilePlan.actions.find((action) => action.areaId === 'codex-defaults');
  assert.deepEqual(editedDefault.profile, {
    model: 'gpt-6-luna-custom', reasoning: 'medium',
    launchPolicy: { sandbox: 'workspace-write', approval: 'on-request' },
  });
  assert.equal(editedDefault.launch.args.includes('gpt-6-luna-custom'), true);
  assert.equal(editedDefault.launch.args.includes('model_reasoning_effort="medium"'), true);
  assert.equal(editedProfilePlan.mutationPerformed, false, 'profile changes only affect a future reviewed launch');
  const editedSnapshot = observeProject({ repositoryRoot: context.root, env: context.env, runtimeRegistry: registry });
  const editedAgent = editedSnapshot.agents.find((agent) => agent.areaId === 'codex-defaults');
  assert.deepEqual({ model: editedAgent.model, reasoning: editedAgent.reasoning }, {
    model: 'gpt-6-luna-custom', reasoning: 'medium',
  });
  const diagnosis = diagnoseProject({
    repository: inspectRepository(context.root), env: context.env, runtimeRegistry: registry,
  });
  assert.equal(diagnosis.findings.some((finding) => finding.code === 'RUNTIME_PROFILE_UNSUPPORTED'), false);
  assert.equal(diagnosis.findings.some((finding) => finding.code === 'RUNTIME_ADAPTER_UNKNOWN'
    && finding.runtime === 'local-agent'), false);
  control.close();
});

test('SCN-runtime-cost-ceiling: exact session mode must declare and return an enforced per-invocation USD cap', () => {
  const builtinAdapters = [
    createClaudeAdapter({ executable: 'claude' }),
    createCodexAdapter({ executable: 'codex' }),
    createPiAdapter({ executable: 'pi' }),
  ];
  for (const adapter of builtinAdapters) {
    assert.deepEqual(adapter.capabilities.perInvocationCostCeiling, {
      createSession: [], resumeSession: [],
    });
  }

  const local = localAdapter();
  local.capabilities = {
    ...local.capabilities,
    perInvocationCostCeiling: { createSession: ['fixture-hard-cap'], resumeSession: [] },
  };
  const create = local.createSession;
  local.createSession = (input) => {
    const plan = create(input);
    if (input.maxCostUsd === undefined) return plan;
    return {
      ...plan,
      costCeiling: { enforced: true, maxUsd: input.maxCostUsd, mode: 'fixture-hard-cap' },
      launch: { ...plan.launch, args: [...plan.launch.args, '--max-cost-usd', String(input.maxCostUsd)] },
    };
  };
  const registry = createRuntimeAdapterRegistry({ adapters: [local] });
  const context = fixture(registry);
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  const uncapped = planAreaUp({
    repositoryRoot: context.root, controlPlane: control, areaId: 'session-manager',
    adapter: createClaudeAdapter({ executable: 'claude' }), maxCostUsd: 0.25,
  });
  assert.equal(uncapped.canProceed, false);
  assert.equal(uncapped.actions.length, 0);
  assert.equal(uncapped.blockers[0].code, 'RUNTIME_COST_CEILING_UNSUPPORTED');

  const capped = planAreaUp({
    repositoryRoot: context.root, controlPlane: control, areaId: 'docs', adapter: local, maxCostUsd: 0.25,
  });
  assert.equal(capped.canProceed, true, JSON.stringify(capped.blockers));
  assert.deepEqual(capped.actions[0].costCeiling, {
    enforced: true, maxUsd: 0.25, mode: 'fixture-hard-cap',
  });
  assert.deepEqual(capped.actions[0].launch.args.slice(-2), ['--max-cost-usd', '0.25']);
  assert.equal(capped.mutationPerformed, false, 'planning does not invoke the runtime');

  const deceptive = {
    ...local,
    createSession: (input) => ({
      ...local.createSession(input),
      costCeiling: { enforced: true, maxUsd: 10, mode: 'fixture-hard-cap' },
    }),
  };
  const rejected = planAreaUp({
    repositoryRoot: context.root, controlPlane: control, areaId: 'docs', adapter: deceptive, maxCostUsd: 0.25,
  });
  assert.equal(rejected.canProceed, false, 'an adapter receipt for a different cap must fail closed');
  assert.equal(rejected.actions.length, 0);
  assert.equal(rejected.blockers[0].code, 'RUNTIME_COST_CEILING_UNPROVEN');
  control.close();
});

test('SCN-runtime-profile-cli: owner can change and reset project-local profiles without launching sessions', () => {
  const context = fixture(createRuntimeAdapterRegistry({ adapters: [localAdapter()] }));
  const cli = new URL('../../bin/torch.mjs', import.meta.url).pathname;
  const run = (...args) => spawnSync(process.execPath, [cli, 'profile', ...args], {
    cwd: context.root, env: context.env, encoding: 'utf8',
  });

  const shown = run('show', '--area', 'codex-defaults', '--json');
  assert.equal(shown.status, 0, shown.stderr);
  assert.deepEqual(JSON.parse(shown.stdout), {
    areaId: 'codex-defaults', runtime: 'codex', model: 'gpt-6-luna', reasoning: 'high',
    launchPolicy: { approval: 'approve-for-me' },
    overrides: { runtime: true, model: false, reasoning: false, launchPolicy: false },
  });

  const refused = run('set', '--area', 'codex-defaults', '--model', 'gpt-custom', '--json');
  assert.equal(refused.status, 2);
  assert.match(refused.stdout, /--yes/);

  const dryRun = run('set', '--area', 'codex-defaults', '--runtime', 'claude', '--model', 'dry-run-opus', '--dry-run', '--json');
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.equal(JSON.parse(dryRun.stdout).beforeProfile.runtime, 'codex');
  assert.equal(JSON.parse(dryRun.stdout).profile.runtime, 'claude');
  assert.equal(JSON.parse(dryRun.stdout).mutationPerformed, false);

  const configPath = join(context.root, '.torch', 'torch.yaml');
  const legacyConfig = JSON.parse(readFileSync(configPath, 'utf8'));
  delete legacyConfig.runtimes.codex.launchPolicy;
  legacyConfig.runtimes.codex.sandbox = 'workspace-write';
  legacyConfig.runtimes.codex.approval = 'approve-for-me';
  writeFileSync(configPath, `${JSON.stringify(legacyConfig, null, 2)}\n`);
  const migrated = run('defaults', '--runtime', 'codex', '--launch-policy', 'approval=never', '--yes', '--json');
  assert.equal(migrated.status, 0, migrated.stderr);
  assert.deepEqual(JSON.parse(migrated.stdout).profile.launchPolicy, {
    sandbox: 'workspace-write', approval: 'never',
  });
  const migratedConfig = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.deepEqual(migratedConfig.runtimes.codex.launchPolicy, {
    sandbox: 'workspace-write', approval: 'never',
  }, 'leaving the implicit approve-for-me mode preserves its workspace-write sandbox');
  assert.equal(Object.hasOwn(migratedConfig.runtimes.codex, 'sandbox'), false);
  assert.equal(Object.hasOwn(migratedConfig.runtimes.codex, 'approval'), false);
  const migratedArgs = createCodexAdapter({ executable: 'codex' }).createSession({
    areaId: 'migrated', worktree: context.root, promptFile: '/tmp/prompt.md', firstMessage: 'start',
    model: 'gpt-6-luna', launchPolicy: migratedConfig.runtimes.codex.launchPolicy,
  }).launch.args;
  assert.deepEqual(migratedArgs.slice(migratedArgs.indexOf('--sandbox'), migratedArgs.indexOf('--sandbox') + 2),
    ['--sandbox', 'workspace-write']);
  assert.deepEqual(migratedArgs.slice(migratedArgs.indexOf('--ask-for-approval'), migratedArgs.indexOf('--ask-for-approval') + 2),
    ['--ask-for-approval', 'never']);
  const resetPolicy = run('defaults', '--runtime', 'codex', '--reset-launch-policy', '--yes', '--json');
  assert.equal(resetPolicy.status, 0, resetPolicy.stderr);
  assert.deepEqual(JSON.parse(resetPolicy.stdout).profile.launchPolicy, { approval: 'approve-for-me' });

  const changed = run(
    'set', '--area', 'codex-defaults', '--runtime', 'claude', '--model', 'opus', '--reasoning', 'high', '--yes', '--json',
  );
  assert.equal(changed.status, 0, changed.stderr);
  const changeReceipt = JSON.parse(changed.stdout);
  assert.deepEqual(changeReceipt.profile, {
    areaId: 'codex-defaults', runtime: 'claude', model: 'opus', reasoning: 'high',
    launchPolicy: {},
    overrides: { runtime: true, model: true, reasoning: true, launchPolicy: false },
  });
  assert.equal(changeReceipt.sessionsStarted, false);
  assert.equal(changeReceipt.existingSessionChanged, false);

  const reset = run('set', '--area', 'codex-defaults', '--reset', '--yes', '--json');
  assert.equal(reset.status, 0, reset.stderr);
  assert.deepEqual(JSON.parse(reset.stdout).profile, {
    areaId: 'codex-defaults', runtime: 'claude', model: 'sonnet', reasoning: null,
    launchPolicy: {},
    overrides: { runtime: true, model: false, reasoning: false, launchPolicy: false },
  });
  const config = JSON.parse(readFileSync(join(context.root, '.torch', 'torch.yaml'), 'utf8'));
  assert.equal(config.domains.find((area) => area.id === 'codex-defaults').runtime, 'claude');
  assert.equal(Object.hasOwn(config.domains.find((area) => area.id === 'codex-defaults'), 'model'), false);
  assert.equal(Object.hasOwn(config.domains.find((area) => area.id === 'codex-defaults'), 'reasoning'), false);

  const defaults = run('defaults', '--runtime', 'codex', '--model', 'gpt-custom', '--reasoning', 'medium', '--yes', '--json');
  assert.equal(defaults.status, 0, defaults.stderr);
  assert.deepEqual(JSON.parse(defaults.stdout).profile, {
    model: 'gpt-custom', reasoning: 'medium', launchPolicy: { approval: 'approve-for-me' },
  });
  const workerProfile = run('show', '--area', context.worker, '--json');
  assert.equal(workerProfile.status, 0, workerProfile.stderr);
  assert.deepEqual(JSON.parse(workerProfile.stdout), {
    areaId: context.worker, runtime: 'codex', model: 'gpt-worker', reasoning: 'medium',
    launchPolicy: { approval: 'approve-for-me' },
    overrides: { runtime: true, model: true, reasoning: false, launchPolicy: false },
  });

  const audit = openControlPlane({ repositoryRoot: context.root, env: context.env });
  const profileEvents = audit.database.prepare(`
    SELECT actor_id, entity_type, entity_id FROM audit_events WHERE operation = 'profile.change' ORDER BY rowid
  `).all();
  assert.equal(profileEvents.length, 5, 'confirmed identity and default edits are audited, dry runs are not');
  assert.ok(profileEvents.every((entry) => entry.actor_id === 'owner'));
  assert.equal(profileEvents.some((entry) => entry.entity_id === 'codex-defaults'), true);
  audit.close();
});

test('SCN-console-runtime-profile: owner previews and confirms an audited next-launch profile without touching running sessions', async (context) => {
  const fixtureState = fixture(createRuntimeAdapterRegistry({ adapters: [localAdapter()] }));
  const server = createConsoleServer({ repositoryRoot: fixtureState.root, env: fixtureState.env });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, requestOrigin = origin) => fetch(`${origin}${path}`, {
    method: 'POST', headers: { origin: requestOrigin, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify(body),
  });
  const configPath = join(fixtureState.root, '.torch', 'torch.yaml');
  const configBefore = readFileSync(configPath, 'utf8');
  const crossOrigin = await post('/api/runtime-profiles/preview', {
    areaId: 'codex-defaults', runtime: 'claude', model: 'opus', reasoning: 'high',
  }, 'http://attacker.invalid');
  assert.equal(crossOrigin.status, 403);

  const firstPreviewResponse = await post('/api/runtime-profiles/preview', {
    areaId: 'codex-defaults', runtime: 'claude', model: 'opus', reasoning: 'high',
  });
  assert.equal(firstPreviewResponse.status, 200);
  const firstPreview = await firstPreviewResponse.json();
  assert.equal(firstPreview.plan.mutationPerformed, false);
  assert.equal(firstPreview.plan.beforeProfile.runtime, 'codex');
  assert.equal(firstPreview.plan.profile.runtime, 'claude');
  assert.equal(firstPreview.plan.profile.model, 'opus');
  assert.equal(firstPreview.plan.resetLaunchPolicy, true);
  assert.match(firstPreview.plan.effect, /future launch plans only/);
  assert.equal(readFileSync(configPath, 'utf8'), configBefore, 'preview is read-only');

  const changedConfig = JSON.parse(configBefore);
  changedConfig.runtimes.claude.reasoning = 'medium';
  writeFileSync(configPath, `${JSON.stringify(changedConfig, null, 2)}\n`);
  const stale = await post('/api/runtime-profiles', {
    areaId: 'codex-defaults', runtime: 'claude', model: 'opus', reasoning: 'high',
    token: firstPreview.token, planHash: firstPreview.planHash,
  });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).error, 'RUNTIME_PROFILE_PREVIEW_STALE');

  const previewResponse = await post('/api/runtime-profiles/preview', {
    areaId: 'codex-defaults', runtime: 'claude', model: 'opus', reasoning: 'high',
  });
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json();
  const payload = {
    areaId: 'codex-defaults', runtime: 'claude', model: 'opus', reasoning: 'high',
    token: preview.token, planHash: preview.planHash,
  };
  const confirmed = await post('/api/runtime-profiles', payload);
  assert.equal(confirmed.status, 200, await confirmed.clone().text());
  const result = await confirmed.json();
  assert.deepEqual(
    { runtime: result.profile.runtime, model: result.profile.model, reasoning: result.profile.reasoning },
    { runtime: 'claude', model: 'opus', reasoning: 'high' },
  );
  assert.equal(result.sessionsStarted, false);
  assert.equal(result.existingSessionChanged, false);
  const replay = await post('/api/runtime-profiles', payload);
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), result);

  const verify = openControlPlane({ repositoryRoot: fixtureState.root, env: fixtureState.env });
  const event = verify.database.prepare(`
    SELECT actor_id, entity_type, entity_id, details FROM audit_events WHERE operation = 'profile.change' ORDER BY rowid DESC LIMIT 1
  `).get();
  assert.equal(event.actor_id, 'owner');
  assert.equal(event.entity_type, 'runtime-profile');
  assert.equal(event.entity_id, 'codex-defaults');
  assert.equal(JSON.parse(event.details).after.runtime, 'claude');
  verify.close();

  const html = readFileSync(new URL('../../site/console.html', import.meta.url), 'utf8');
  const client = readFileSync(new URL('../../site/console.js', import.meta.url), 'utf8');
  assert.match(html, /data-runtime-profile-preview/);
  assert.match(html, /data-profile-before/);
  assert.match(html, /Running sessions are not changed or restarted/);
  assert.match(client, /\/api\/runtime-profiles\/preview/);
  assert.match(client, /\/api\/runtime-profiles'/);
});
