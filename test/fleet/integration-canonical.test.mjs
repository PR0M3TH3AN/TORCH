import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import { BacklogService } from '../../src/backlog/service.mjs';
import { createLocalCanonical, classifyRecoverability, planLocalCanonical } from '../../src/canonical/local.mjs';
import { CheckService } from '../../src/checks/service.mjs';
import { ConvergenceService } from '../../src/convergence/service.mjs';
import { openControlPlane } from '../../src/control-plane/service.mjs';
import { analyzeRepository } from '../../src/kernel/analyze.mjs';
import { proposeDomains } from '../../src/kernel/domains.mjs';
import { inspectRepository } from '../../src/kernel/git.mjs';
import { installProject } from '../../src/kernel/install.mjs';
import { createWorktrees } from '../../src/kernel/worktrees.mjs';
import { IntegrationService } from '../../src/integration/service.mjs';
import { observeProject } from '../../src/observability/snapshot.mjs';
import { createTorchToolset } from '../../src/mcp/tools.mjs';

function baseFixture(name, { extraWorker = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), `${name}-`));
  execFileSync('git', ['init', '-b', 'main', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'torch-test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'TORCH Test']);
  writeFileSync(join(root, 'package.json'), `${JSON.stringify({
    name, scripts: { 'verify:pass': 'node -e "process.exit(0)"' },
  }, null, 2)}\n`);
  writeFileSync(join(root, 'app.js'), 'export const value = 1;\n');
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'fixture']);
  let repository = inspectRepository(root);
  const proposal = proposeDomains({ repository, analysis: analyzeRepository(repository) });
  if (extraWorker) proposal.domains.push({
    id: 'docs-area', title: 'Documentation', kind: 'development',
    scope: ['documentation under docs/**'], not_scope: ['application source under app.js'],
    owned_paths: ['docs/**'], shared_paths: [], neighbours: [], required_checks: ['verify-pass'],
    resources: [], runtime: 'claude', evidence: ['README.md'],
  });
  proposal.checks = proposal.checks.filter((check) => check.id === 'verify-pass');
  proposal.review = {
    status: 'approved', reviewedAt: '2026-09-27T00:00:00Z', reviewedBy: 'fixture-owner', notes: [],
  };
  const env = { ...process.env, XDG_DATA_HOME: join(tmpdir(), `${basename(root)}-state`) };
  installProject({ repository, proposal, env, projectId: name });
  execFileSync('git', ['-C', root, 'add', '.torch']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'install torch']);
  return { root, env, proposal, repository: inspectRepository(root) };
}

function integrationFixture() {
  const context = baseFixture('integration-fixture', { extraWorker: true });
  createWorktrees({
    repository: context.repository,
    parentOverride: join(tmpdir(), `${basename(context.root)}-worktrees`),
  });
  execFileSync('git', ['-C', context.root, 'add', '.torch/install-manifest.json']);
  execFileSync('git', ['-C', context.root, 'commit', '-m', 'record managed worktrees']);
  const manifest = JSON.parse(readFileSync(join(context.root, '.torch', 'install-manifest.json'), 'utf8'));
  const worker = context.proposal.domains[0].id;
  const worktree = manifest.external.find((entry) => entry.type === 'worktree' && entry.area === worker);
  execFileSync('git', ['-C', worktree.path, 'merge', 'main']);
  return { ...context, worker, worktree };
}

test('SCN-landed-task-closure: opt-in automatic closure requires exact real landing, current checks and ownership; replay is harmless', () => {
  const context = integrationFixture();
  const configPath = join(context.root, '.torch', 'torch.yaml');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.backlog = { ...config.backlog, activity: { auto_close_after_landing: true } };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  execFileSync('git', ['-C', context.root, 'add', '.torch/torch.yaml']);
  execFileSync('git', ['-C', context.root, 'commit', '-m', 'owner enables verified landed closure']);
  execFileSync('git', ['-C', context.worktree.path, 'merge', 'main']);
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  const checks = new CheckService({ repositoryRoot: context.root, controlPlane: control });
  const integration = new IntegrationService({ repositoryRoot: context.root, controlPlane: control, checkService: checks });
  const backlog = new BacklogService({ repositoryRoot: context.root, controlPlane: control, checkService: checks,
    integrationLookup: (id) => integration.get(id) });
  let task = backlog.create({ actorId: 'session-manager', title: 'Verified task', description: 'Automatic closure after landing',
    affectedDomains: [context.worker], acceptanceCriteria: ['Current proof and exact landing'] });
  let wrong = backlog.create({ actorId: 'session-manager', title: 'Unrelated task', description: 'Never close unready work',
    acceptanceCriteria: ['Own verified implementation'] });
  const otherArea = context.proposal.domains.find((area) => area.id !== context.worker).id;
  const oldCommit = execFileSync('git', ['-C', context.root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  for (const step of [
    { actorId: 'session-manager', to: 'ready' },
    { actorId: 'session-manager', to: 'assigned', owner: otherArea },
    { actorId: otherArea, to: 'in_progress' },
    { actorId: otherArea, to: 'verification', commit: oldCommit, evidence: ['Different work at another commit'] },
    { actorId: otherArea, to: 'ready_to_integrate' },
  ]) wrong = backlog.transition({ taskId: wrong.id, expectedRevision: wrong.revision, ...step });
  const message = `Implement ${task.id}\n\nCloses: ${task.id}, ${wrong.id}, TASK-unknown`;
  execFileSync('git', ['-C', context.worktree.path, 'commit', '--allow-empty', '-m', message]);
  const receipt = checks.run({ checkId: 'verify-pass', areaId: context.worker });
  for (const step of [
    { actorId: 'session-manager', to: 'ready' },
    { actorId: 'session-manager', to: 'assigned', owner: context.worker },
    { actorId: context.worker, to: 'in_progress' },
    { actorId: context.worker, to: 'verification', commit: receipt.commit, evidence: ['Exact passing receipt'] },
    { actorId: context.worker, to: 'ready_to_integrate' },
  ]) task = backlog.transition({ taskId: task.id, expectedRevision: task.revision, ...step });
  const request = integration.request({ areaId: context.worker, commit: receipt.commit });
  const input = { integrationRequest: request.id, actorId: 'session-manager' };
  assert.equal(backlog.planLandedClosure(input).canProceed, false);
  assert.throws(() => backlog.reconcileLanded({ ...input, approved: true }), (error) => error.code === 'BACKLOG_CLOSURE_BLOCKED');
  assert.throws(() => backlog.planLandedClosure({ ...input, actorId: context.worker }), (error) => error.code === 'BACKLOG_AUTHORITY_REQUIRED');
  integration.authorize({ requestId: request.id, actorId: 'session-manager' });
  const landed = integration.land({ requestId: request.id, actorId: 'session-manager' });
  assert.equal(landed.state, 'landed');
  assert.equal(landed.backlogClosure.results.find((item) => item.taskId === task.id).disposition, 'completed');
  assert.equal(landed.backlogClosure.results.find((item) => item.taskId === wrong.id).disposition, 'blocked');
  assert.deepEqual(landed.backlogClosure.results.find((item) => item.taskId === wrong.id).reasons,
    ['source-owner-mismatch', 'task-commit-mismatch']);
  assert.equal(landed.backlogClosure.results.find((item) => item.taskId === 'TASK-unknown').disposition, 'blocked');
  const completed = backlog.get(task.id);
  assert.equal(completed.integrationRequest, request.id);
  assert.equal(completed.commit, receipt.commit);
  const replay = backlog.reconcileLanded({ ...input, approved: true });
  assert.equal(replay.mutationPerformed, false);
  assert.equal(backlog.get(task.id).revision, completed.revision);
  wrong = backlog.get(wrong.id);
  assert.equal(wrong.state, 'ready_to_integrate');
  assert.equal(wrong.revision, 6);
  const tools = createTorchToolset(control, { actorId: 'session-manager', backlogService: backlog });
  assert.equal(tools.get('torch_plan_landed_task_closure').invoke({ integration_request: request.id }).mutationPerformed, false);
  assert.throws(() => tools.get('torch_reconcile_landed_tasks').invoke({ integration_request: request.id }),
    (error) => error.code === 'APPROVAL_REQUIRED');
  const workerTools = createTorchToolset(control, { actorId: context.worker, backlogService: backlog });
  assert.throws(() => workerTools.get('torch_reconcile_landed_tasks').invoke({ integration_request: request.id, approved: true }),
    (error) => error.code === 'BACKLOG_AUTHORITY_REQUIRED');
  config.checks[0].args = ['-e', 'process.exit(1)'];
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  assert.equal(backlog.planLandedClosure(input).blockers.includes('current-check-evidence-required'), true);
  assert.throws(() => backlog.reconcileLanded({ ...input, approved: true }), (error) => error.code === 'BACKLOG_CLOSURE_BLOCKED');
  control.close();
});

test('SCN-landed-closure-recovery: a bookkeeping failure cannot reverse landing and explicit retry repairs it without a second landing', () => {
  const context = integrationFixture();
  const path = join(context.root, '.torch', 'torch.yaml');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  config.backlog = { ...config.backlog, activity: { auto_close_after_landing: true } };
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  execFileSync('git', ['-C', context.root, 'add', '.torch/torch.yaml']);
  execFileSync('git', ['-C', context.root, 'commit', '-m', 'approved closure policy']);
  execFileSync('git', ['-C', context.worktree.path, 'merge', 'main']);
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  const checks = new CheckService({ repositoryRoot: context.root, controlPlane: control });
  const integration = new IntegrationService({ repositoryRoot: context.root, controlPlane: control, checkService: checks });
  const backlog = new BacklogService({ repositoryRoot: context.root, controlPlane: control, checkService: checks,
    integrationLookup: (id) => integration.get(id) });
  let task = backlog.create({ actorId: 'session-manager', title: 'Recover closure', description: 'Persist landing independently',
    affectedDomains: [context.worker], acceptanceCriteria: ['Retry must not land twice'] });
  execFileSync('git', ['-C', context.worktree.path, 'commit', '--allow-empty', '-m', `Implement ${task.id}\n\nCloses: ${task.id}`]);
  const receipt = checks.run({ checkId: 'verify-pass', areaId: context.worker });
  for (const step of [
    { actorId: 'session-manager', to: 'ready' },
    { actorId: 'session-manager', to: 'assigned', owner: context.worker },
    { actorId: context.worker, to: 'in_progress' },
    { actorId: context.worker, to: 'verification', commit: receipt.commit, evidence: ['Exact receipt'] },
    { actorId: context.worker, to: 'ready_to_integrate' },
  ]) task = backlog.transition({ taskId: task.id, expectedRevision: task.revision, ...step });
  const request = integration.request({ areaId: context.worker, commit: receipt.commit });
  integration.authorize({ requestId: request.id, actorId: 'session-manager' });
  const lockPath = join(control.stateRoot, 'locks', `backlog-${task.id}.lock`);
  writeFileSync(lockPath, 'Competing writer owns this lock\n', { flag: 'wx' });
  const landed = integration.land({ requestId: request.id, actorId: 'session-manager' });
  assert.equal(landed.state, 'landed');
  assert.equal(landed.backlogClosure.disposition, 'needs-review');
  assert.equal(backlog.get(task.id).state, 'ready_to_integrate');
  assert.equal(execFileSync('git', ['-C', context.root, 'rev-parse', 'main'], { encoding: 'utf8' }).trim(), receipt.commit);
  config.backlog.activity.auto_close_after_landing = false;
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  assert.throws(() => backlog.reconcileLanded({ integrationRequest: request.id, actorId: 'session-manager', automatic: true }),
    (error) => error.code === 'APPROVAL_REQUIRED');
  const cliArgs = [new URL('../../bin/torch.mjs', import.meta.url).pathname,
    'backlog', 'close-landed', '--integration', request.id, '--area', 'session-manager', '--json'];
  const preview = JSON.parse(execFileSync(process.execPath, [...cliArgs, '--dry-run'], {
    cwd: context.root, env: context.env, encoding: 'utf8',
  }));
  assert.equal(preview.canProceed, true);
  assert.equal(preview.mutationPerformed, false);
  const unapproved = spawnSync(process.execPath, cliArgs, { cwd: context.root, env: context.env, encoding: 'utf8' });
  assert.notEqual(unapproved.status, 0);
  assert.match(unapproved.stdout + unapproved.stderr, /APPROVAL_REQUIRED/);
  unlinkSync(lockPath);
  const retry = JSON.parse(execFileSync(process.execPath, [...cliArgs, '--yes'], {
    cwd: context.root, env: context.env, encoding: 'utf8',
  }));
  assert.equal(retry.mutationPerformed, true);
  assert.equal(backlog.get(task.id).state, 'completed');
  assert.equal(integration.get(request.id).state, 'landed');
  control.close();
});

test('SCN-native-integration: exact receipts plus manager authority land only an unchanged fast-forward candidate', () => {
  const context = integrationFixture();
  writeFileSync(join(context.worktree.path, 'app.js'), 'export const value = 2;\n');
  execFileSync('git', ['-C', context.worktree.path, 'add', 'app.js']);
  execFileSync('git', ['-C', context.worktree.path, 'commit', '-m', 'bounded domain change']);

  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  let id = 0;
  const checks = new CheckService({
    repositoryRoot: context.root, controlPlane: control, idFactory: () => `check-${++id}`,
  });
  const receipt = checks.run({ checkId: 'verify-pass', areaId: context.worker });
  const integration = new IntegrationService({
    repositoryRoot: context.root, controlPlane: control, checkService: checks,
    idFactory: () => `integration-${++id}`,
  });
  const backlog = new BacklogService({
    repositoryRoot: context.root, controlPlane: control,
    idFactory: () => `integration-task-${++id}`,
    integrationLookup: (requestId) => integration.get(requestId),
  });
  let task = backlog.create({
    actorId: 'session-manager', title: 'Land bounded domain change',
    description: 'Exercise backlog through exact integration.', affectedDomains: [context.worker],
    acceptanceCriteria: ['Exact receipt and landed commit match.'],
  });
  for (const transition of [
    { actorId: 'session-manager', to: 'ready' },
    { actorId: 'session-manager', to: 'assigned', owner: context.worker },
    { actorId: context.worker, to: 'in_progress' },
    { actorId: context.worker, to: 'verification', commit: receipt.commit, evidence: ['verify-pass receipt'] },
    { actorId: context.worker, to: 'ready_to_integrate' },
  ]) {
    task = backlog.transition({ taskId: task.id, expectedRevision: task.revision, ...transition });
  }
  const request = integration.request({ areaId: context.worker, commit: receipt.commit });
  assert.equal(request.state, 'ready');
  assert.throws(
    () => integration.authorize({ requestId: request.id, actorId: context.worker }),
    (error) => error.code === 'INTEGRATION_AUTHORITY_REQUIRED',
  );
  integration.authorize({ requestId: request.id, actorId: 'session-manager' });
  assert.equal(integration.planLanding({ requestId: request.id, actorId: 'session-manager' }).canProceed, true);
  const landed = integration.land({ requestId: request.id, actorId: 'session-manager' });
  assert.equal(landed.state, 'landed');
  assert.equal(execFileSync('git', ['-C', context.root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), receipt.commit);
  assert.equal(readFileSync(join(context.root, 'app.js'), 'utf8'), 'export const value = 2;\n');
  task = backlog.transition({
    taskId: task.id, actorId: 'session-manager', to: 'completed', expectedRevision: task.revision,
    integrationRequest: landed.id,
  });
  assert.equal(task.state, 'completed');

  writeFileSync(join(context.worktree.path, 'app.js'), 'export const value = 3;\n');
  execFileSync('git', ['-C', context.worktree.path, 'add', 'app.js']);
  execFileSync('git', ['-C', context.worktree.path, 'commit', '-m', 'second domain change']);
  const secondReceipt = checks.run({ checkId: 'verify-pass', areaId: context.worker });
  const second = integration.request({ areaId: context.worker, commit: secondReceipt.commit });
  integration.authorize({ requestId: second.id, actorId: 'session-manager' });
  writeFileSync(join(context.root, 'main-only.js'), 'export const mainOnly = true;\n');
  execFileSync('git', ['-C', context.root, 'add', 'main-only.js']);
  execFileSync('git', ['-C', context.root, 'commit', '-m', 'main advanced']);
  const blocked = integration.planLanding({ requestId: second.id, actorId: 'session-manager' });
  assert.equal(blocked.canProceed, false);
  assert.equal(blocked.blockers.some((blocker) => blocker.code === 'TARGET_ADVANCED'), true);
  assert.throws(
    () => integration.land({ requestId: second.id, actorId: 'session-manager' }),
    (error) => error.code === 'INTEGRATION_LANDING_BLOCKED',
  );
  control.close();
});

test('SCN-integration-landing-serialization: a competing lander cannot mutate main while another writer owns the project queue', () => {
  const context = integrationFixture();
  writeFileSync(join(context.worktree.path, 'app.js'), 'export const value = 2;\n');
  execFileSync('git', ['-C', context.worktree.path, 'add', 'app.js']);
  execFileSync('git', ['-C', context.worktree.path, 'commit', '-m', 'serialized integration candidate']);

  const firstControl = openControlPlane({ repositoryRoot: context.root, env: context.env });
  const secondControl = openControlPlane({ repositoryRoot: context.root, env: context.env });
  const firstChecks = new CheckService({ repositoryRoot: context.root, controlPlane: firstControl });
  const secondChecks = new CheckService({ repositoryRoot: context.root, controlPlane: secondControl });
  const firstIntegration = new IntegrationService({ repositoryRoot: context.root, controlPlane: firstControl, checkService: firstChecks });
  const secondIntegration = new IntegrationService({ repositoryRoot: context.root, controlPlane: secondControl, checkService: secondChecks });
  const receipt = firstChecks.run({ checkId: 'verify-pass', areaId: context.worker });
  const request = firstIntegration.request({ areaId: context.worker, commit: receipt.commit });
  assert.equal(request.state, 'ready');
  firstIntegration.authorize({ requestId: request.id, actorId: 'session-manager' });
  const mainBefore = execFileSync('git', ['-C', context.root, 'rev-parse', 'main'], { encoding: 'utf8' }).trim();

  firstControl.database.exec('BEGIN IMMEDIATE');
  secondControl.database.exec('PRAGMA busy_timeout = 0');
  assert.throws(
    () => secondIntegration.land({ requestId: request.id, actorId: 'session-manager' }),
    (error) => error.code === 'INTEGRATION_LANDING_BUSY',
  );
  assert.equal(execFileSync('git', ['-C', context.root, 'rev-parse', 'main'], { encoding: 'utf8' }).trim(), mainBefore);
  firstControl.database.exec('ROLLBACK');

  const landed = secondIntegration.land({ requestId: request.id, actorId: 'session-manager' });
  assert.equal(landed.state, 'landed');
  assert.equal(execFileSync('git', ['-C', context.root, 'rev-parse', 'main'], { encoding: 'utf8' }).trim(), receipt.commit);
  firstControl.close();
  secondControl.close();
});

test('SCN-integration-fifo-drain: one authorized lander processes FIFO and defers stale tips for fresh convergence', () => {
  const context = integrationFixture();
  const manifest = JSON.parse(readFileSync(join(context.root, '.torch', 'install-manifest.json'), 'utf8'));
  const secondArea = context.proposal.domains.find((domain) => domain.id !== context.worker).id;
  const secondWorktree = manifest.external.find((entry) => entry.type === 'worktree' && entry.area === secondArea);
  execFileSync('git', ['-C', secondWorktree.path, 'merge', 'main']);
  const firstPath = join(context.worktree.path, 'first-queue-change.js');
  const secondPath = join(secondWorktree.path, 'second-queue-change.js');
  writeFileSync(firstPath, 'export const first = true;\n');
  execFileSync('git', ['-C', context.worktree.path, 'add', 'first-queue-change.js']);
  execFileSync('git', ['-C', context.worktree.path, 'commit', '-m', 'first queued change']);
  writeFileSync(secondPath, 'export const second = true;\n');
  execFileSync('git', ['-C', secondWorktree.path, 'add', 'second-queue-change.js']);
  execFileSync('git', ['-C', secondWorktree.path, 'commit', '-m', 'second queued change']);

  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  let id = 0;
  const checks = new CheckService({
    repositoryRoot: context.root, controlPlane: control, idFactory: () => `fifo-check-${++id}`,
  });
  const integration = new IntegrationService({
    repositoryRoot: context.root, controlPlane: control, checkService: checks,
    idFactory: () => `fifo-integration-${++id}`,
  });
  const firstReceipt = checks.run({ checkId: 'verify-pass', areaId: context.worker });
  const first = integration.request({ areaId: context.worker, commit: firstReceipt.commit });
  integration.authorize({ requestId: first.id, actorId: 'session-manager' });
  const secondReceipt = checks.run({ checkId: 'verify-pass', areaId: secondArea });
  const second = integration.request({ areaId: secondArea, commit: secondReceipt.commit });
  integration.authorize({ requestId: second.id, actorId: 'session-manager' });
  const queueSnapshot = observeProject({ repositoryRoot: context.root, env: context.env });
  const visibleQueue = queueSnapshot.integration.filter((entry) => [first.id, second.id].includes(entry.id));
  assert.deepEqual(visibleQueue.map((entry) => entry.id), [first.id, second.id]);
  assert.deepEqual(visibleQueue.map((entry) => entry.queueOrder), [1, 2]);
  assert.ok(visibleQueue.every((entry) => entry.authorizedBy === 'session-manager'));
  assert.equal(integration.planLanding({ requestId: second.id, actorId: 'session-manager' })
    .blockers.some((blocker) => blocker.code === 'INTEGRATION_QUEUE_ORDER_REQUIRED'), true);
  assert.throws(
    () => integration.land({ requestId: second.id, actorId: 'session-manager' }),
    (error) => error.code === 'INTEGRATION_LANDING_BLOCKED'
      && error.details.some((blocker) => blocker.code === 'INTEGRATION_QUEUE_ORDER_REQUIRED'),
  );
  assert.throws(
    () => integration.drain({ actorId: context.worker }),
    (error) => error.code === 'INTEGRATION_AUTHORITY_REQUIRED',
  );

  const drained = integration.drain({ actorId: 'session-manager' });
  assert.deepEqual(drained.results.map((entry) => entry.requestId), [first.id, second.id]);
  assert.equal(drained.results[0].state, 'landed');
  assert.equal(drained.results[1].state, 'needs_convergence');
  assert.equal(drained.results[1].reason, 'target-advanced-since-request');
  assert.equal(execFileSync('git', ['-C', context.root, 'rev-parse', 'main'], { encoding: 'utf8' }).trim(), firstReceipt.commit);

  execFileSync('git', ['-C', secondWorktree.path, 'merge', 'main']);
  const refreshedReceipt = checks.run({ checkId: 'verify-pass', areaId: secondArea });
  const refreshed = integration.request({ areaId: secondArea, commit: refreshedReceipt.commit });
  integration.authorize({ requestId: refreshed.id, actorId: 'session-manager' });
  const secondDrain = integration.drain({ actorId: 'session-manager' });
  assert.equal(secondDrain.landed, 1);
  assert.equal(integration.get(refreshed.id).state, 'landed');
  assert.equal(execFileSync('git', ['-C', context.root, 'merge-base', '--is-ancestor', refreshedReceipt.commit, 'main'], { encoding: 'utf8', stdio: 'pipe' }), '');
  control.close();
});

test('SCN-local-canonical: a no-forge project gains a bare canonical remote and honest recoverability grades', () => {
  const context = baseFixture('canonical-fixture');
  const preview = planLocalCanonical({ repositoryRoot: context.root });
  assert.equal(preview.canProceed, true);
  assert.equal(preview.mutationPerformed, false);
  assert.equal(existsSync(preview.path), false);
  const created = createLocalCanonical({ repositoryRoot: context.root });
  assert.equal(created.mutationPerformed, true);
  assert.equal(existsSync(join(created.path, 'HEAD')), true);
  assert.equal(created.recoverability.level, 'LOCAL-REMOTE');
  const config = JSON.parse(readFileSync(join(context.root, '.torch', 'torch.yaml'), 'utf8'));
  assert.equal(config.repository.canonical.type, 'local');
  assert.equal(config.repository.canonical.remote, 'torch-canonical');

  execFileSync('git', ['-C', context.root, 'add', '.torch']);
  execFileSync('git', ['-C', context.root, 'commit', '-m', 'record local canonical']);
  assert.equal(classifyRecoverability({ repositoryRoot: context.root }).level, 'ONE-DISK');
  execFileSync('git', ['-C', context.root, 'push', 'torch-canonical', 'main']);
  assert.equal(classifyRecoverability({ repositoryRoot: context.root }).level, 'LOCAL-REMOTE');
});

test('SCN-safe-convergence: only the owning clean and unguarded worktree merges canonical state', () => {
  const context = integrationFixture();
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  const convergence = new ConvergenceService({ repositoryRoot: context.root, controlPlane: control });
  const checks = new CheckService({
    repositoryRoot: context.root,
    controlPlane: control,
    executor: () => {
      const duringCheck = convergence.plan({ areaId: context.worker });
      assert.equal(duringCheck.blockers.some((blocker) => blocker.code === 'WORKTREE_CHECK_ACTIVE'), true);
      return { status: 0, stdout: 'pass', stderr: '' };
    },
  });
  checks.run({ checkId: 'verify-pass', areaId: context.worker });
  assert.deepEqual(convergence.guards(context.worker), []);

  writeFileSync(join(context.root, 'main-only.js'), 'export const canonical = true;\n');
  execFileSync('git', ['-C', context.root, 'add', 'main-only.js']);
  execFileSync('git', ['-C', context.root, 'commit', '-m', 'canonical advanced']);
  assert.equal(convergence.plan({ areaId: context.worker }).behind, 1);

  convergence.hold({ areaId: context.worker, type: 'measurement', reason: 'Stable benchmark inputs' });
  const guarded = convergence.plan({ areaId: context.worker });
  assert.equal(guarded.canProceed, false);
  assert.equal(guarded.blockers.some((blocker) => blocker.code === 'WORKTREE_MEASUREMENT_ACTIVE'), true);
  assert.throws(
    () => convergence.converge({ areaId: context.worker }),
    (error) => error.code === 'CONVERGENCE_BLOCKED',
  );
  convergence.release({ areaId: context.worker, type: 'measurement' });

  convergence.hold({ areaId: context.worker, type: 'pin', reason: 'Owner-reviewed historical comparison' });
  assert.equal(convergence.plan({ areaId: context.worker }).blockers
    .some((blocker) => blocker.code === 'WORKTREE_PIN_ACTIVE'), true);
  convergence.release({ areaId: context.worker, type: 'pin' });

  writeFileSync(join(context.worktree.path, 'uncommitted.txt'), 'do not merge around this\n');
  assert.equal(convergence.plan({ areaId: context.worker }).blockers
    .some((blocker) => blocker.code === 'WORKTREE_DIRTY'), true);
  unlinkSync(join(context.worktree.path, 'uncommitted.txt'));

  const mergeHead = execFileSync('git', ['-C', context.worktree.path, 'rev-parse', '--git-path', 'MERGE_HEAD'], { encoding: 'utf8' }).trim();
  writeFileSync(mergeHead, `${execFileSync('git', ['-C', context.root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()}\n`);
  assert.equal(convergence.plan({ areaId: context.worker }).blockers
    .some((blocker) => blocker.code === 'GIT_OPERATION_ACTIVE'), true);
  unlinkSync(mergeHead);

  const result = convergence.converge({ areaId: context.worker });
  assert.equal(result.changed, true);
  assert.equal(result.mutationPerformed, true);
  assert.equal(readFileSync(join(context.worktree.path, 'main-only.js'), 'utf8'), 'export const canonical = true;\n');
  assert.equal(convergence.plan({ areaId: context.worker }).upToDate, true);
  control.close();
});
