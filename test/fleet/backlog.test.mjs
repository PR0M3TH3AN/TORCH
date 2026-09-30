import assert from 'node:assert/strict';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import { assessBacklogHealth, createBacklogService } from '../../src/backlog/service.mjs';
import { openControlPlane } from '../../src/control-plane/service.mjs';
import { analyzeRepository } from '../../src/kernel/analyze.mjs';
import { diagnoseProject } from '../../src/kernel/doctor.mjs';
import { proposeDomains } from '../../src/kernel/domains.mjs';
import { inspectRepository } from '../../src/kernel/git.mjs';
import { installProject } from '../../src/kernel/install.mjs';
import { createWorktrees } from '../../src/kernel/worktrees.mjs';
import { callTorchTool } from '../../src/mcp/tools.mjs';
import { CheckService } from '../../src/checks/service.mjs';
import { ResourceService } from '../../src/resources/service.mjs';
import { IntegrationService } from '../../src/integration/service.mjs';
import { beginWorktreeGuard, endWorktreeGuard } from '../../src/convergence/service.mjs';

function fixture({ withPeer = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'torch-backlog-'));
  execFileSync('git', ['init', '-b', 'main', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'torch-test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'TORCH Test']);
  writeFileSync(join(root, 'app.js'), 'export const app = true;\n');
  if (withPeer) {
    mkdirSync(join(root, 'test'));
    writeFileSync(join(root, 'test', 'app.test.js'), '// independent verification surface\n');
    writeFileSync(join(root, 'test', 'integration.test.js'), '// independent integration surface\n');
  }
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'fixture']);
  let repository = inspectRepository(root);
  const proposal = proposeDomains({ repository, analysis: analyzeRepository(repository) });
  proposal.review = {
    status: 'approved', reviewedAt: '2026-09-27T00:00:00Z', reviewedBy: 'fixture-owner', notes: [],
  };
  const env = { ...process.env, XDG_DATA_HOME: join(tmpdir(), `${basename(root)}-state`) };
  installProject({ repository, proposal, env, projectId: 'backlog-fixture' });
  execFileSync('git', ['-C', root, 'add', '.torch']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'install torch']);
  repository = inspectRepository(root);
  createWorktrees({ repository, parentOverride: join(tmpdir(), `${basename(root)}-worktrees`) });
  const mainStatus = execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' });
  return { root, env, worker: proposal.domains.find((domain) => domain.id !== 'qa').id,
    peer: proposal.domains.find((domain) => domain.id === 'qa')?.id, mainStatus };
}

function readyTask(backlog, title, affectedDomains, priority = 'normal', dependencies = []) {
  const created = backlog.create({ actorId: 'session-manager', title, description: title,
    acceptanceCriteria: ['Observed and verified.'], affectedDomains, priority, dependencies });
  return backlog.transition({ taskId: created.id, actorId: 'session-manager', to: 'ready', expectedRevision: created.revision });
}

function allowSelfClaim(context, areas) {
  const path = join(context.root, '.torch', 'torch.yaml');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  config.backlog = { self_claim: { enabled: true, areas } };
  writeFileSync(path, JSON.stringify(config));
  return { config, path };
}

test('SCN-backlog-self-claim: approved routed work is claimed in priority order, resumes first and never grants manager authority', () => {
  const context = fixture();
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  const backlog = createBacklogService({ repositoryRoot: context.root, controlPlane: control });
  const low = readyTask(backlog, 'Earlier low priority', [context.worker], 'low');
  const high = readyTask(backlog, 'Owner prioritized work', [context.worker], 'high');
  assert.equal(backlog.next({ areaId: context.worker }).task.id, high.id);
  const refused = backlog.claimNext({ areaId: context.worker });
  assert.equal(refused.mutationPerformed, false);
  assert.equal(refused.blockers.some((blocker) => blocker.code === 'BACKLOG_SELF_CLAIM_DISABLED'), true);
  assert.equal(backlog.get(high.id).state, 'ready');
  const { config, path } = allowSelfClaim(context, [context.worker]);
  const generic = readyTask(backlog, 'Unrouted owner request', [], 'urgent');
  const dependency = readyTask(backlog, 'Unfinished dependency', [], 'normal');
  const gated = readyTask(backlog, 'Dependent work', [context.worker], 'urgent', [dependency.id]);
  const options = { actorId: context.worker, backlogService: backlog };
  assert.equal(callTorchTool(control, 'torch_plan_backlog_claim', {}, options).task.id, high.id);
  assert.equal(backlog.get(high.id).state, 'ready', 'preview does not assign');
  const claimed = callTorchTool(control, 'torch_claim_next_backlog_task', {}, options);
  assert.equal(claimed.disposition, 'claimed');
  assert.equal(claimed.task.owner, context.worker);
  assert.equal(claimed.task.state, 'assigned');
  assert.equal(claimed.task.history.at(-1).actorId, context.worker);
  assert.equal(backlog.get(generic.id).state, 'ready');
  assert.equal(backlog.get(gated.id).state, 'ready');
  assert.equal(control.readMessages({ recipient: context.worker }).some((message) => message.body.includes(`Assigned ${high.id}`)), false,
    'routine self-claim does not generate acknowledgement-only messages');
  assert.throws(() => backlog.transition({ taskId: low.id, actorId: context.worker, to: 'assigned',
    owner: context.worker, expectedRevision: low.revision, selfClaim: true }),
  (error) => error.code === 'BACKLOG_AUTHORITY_REQUIRED');
  config.backlog.self_claim.enabled = false;
  writeFileSync(path, JSON.stringify(config));
  const resume = backlog.claimNext({ areaId: context.worker });
  assert.equal(resume.disposition, 'resume');
  assert.equal(resume.task.id, high.id);
  assert.equal(resume.mutationPerformed, false);
  assert.equal(control.readAudit({ actorId: context.worker }).filter((event) => event.operation === 'backlog.self-claim').length, 1);
  assert.throws(() => backlog.planClaim({ areaId: 'session-manager' }), (error) => error.code === 'BACKLOG_OWNER_INVALID');
  backlog.transition({ taskId: high.id, actorId: 'session-manager', to: 'cancelled', expectedRevision: claimed.task.revision });
  assert.equal(backlog.claimNext({ areaId: context.worker }).blockers.some((blocker) => blocker.code === 'BACKLOG_SELF_CLAIM_DISABLED'), true);
  control.close();
});

test('SCN-backlog-self-claim-readiness: dirty work, active guards, queued tests, resources, approvals and integration prevent new claims', () => {
  const context = fixture({ withPeer: true });
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  const backlog = createBacklogService({ repositoryRoot: context.root, controlPlane: control });
  const ready = readyTask(backlog, 'Routed work', [context.worker]);
  const { config, path } = allowSelfClaim(context, [context.worker]);
  config.checks.push({ id: 'frozen', command: 'node', args: ['-e', 'process.exit(0)'],
    snapshot: { paths: ['app.js', 'build-sha'], source_commit_file: 'build-sha' } });
  config.resources.push({ id: 'browser', capacity: 1, queue: 'fifo' });
  writeFileSync(path, JSON.stringify(config));
  const checks = new CheckService({ repositoryRoot: context.root, controlPlane: control });
  const worktree = checks.worktrees.get(context.worker).path;
  const blockedBy = (code) => {
    const result = backlog.claimNext({ areaId: context.worker });
    assert.equal(result.disposition, 'blocked');
    assert.equal(result.blockers.some((blocker) => blocker.code === code), true, JSON.stringify(result.blockers));
    assert.equal(backlog.get(ready.id).state, 'ready');
  };
  writeFileSync(join(worktree, 'unsaved.js'), '// unfinished\n');
  blockedBy('WORKTREE_DIRTY');
  unlinkSync(join(worktree, 'unsaved.js'));
  beginWorktreeGuard(control, { areaId: context.worker, type: 'measurement', reason: 'Outstanding measurement.' });
  blockedBy('WORKTREE_GUARD_ACTIVE');
  endWorktreeGuard(control, { areaId: context.worker, type: 'measurement' });
  writeFileSync(join(worktree, '.gitignore'), 'build-sha\n');
  execFileSync('git', ['-C', worktree, 'add', '.gitignore']);
  execFileSync('git', ['-C', worktree, 'commit', '-m', 'ignore marker']);
  writeFileSync(join(worktree, 'build-sha'), execFileSync('git', ['-C', worktree, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim());
  const prepared = checks.prepare({ checkId: 'frozen', areaId: context.worker });
  blockedBy('CHECKS_PENDING');
  checks.cancelPrepared({ preparedId: prepared.id, areaId: context.worker });
  const resources = new ResourceService({ repositoryRoot: context.root, controlPlane: control });
  resources.acquire({ resourceId: 'browser', areaId: context.worker });
  blockedBy('RESOURCE_HELD');
  resources.release({ resourceId: 'browser', areaId: context.worker });
  resources.acquire({ resourceId: 'browser', areaId: context.peer });
  resources.acquire({ resourceId: 'browser', areaId: context.worker });
  blockedBy('RESOURCE_WAITING');
  resources.cancel({ resourceId: 'browser', areaId: context.worker });
  resources.release({ resourceId: 'browser', areaId: context.peer });
  const approval = control.requestApproval({ requester: context.worker, approver: 'owner', title: 'Owner decision', summary: 'Need a decision.' });
  blockedBy('APPROVAL_PENDING');
  control.decideApproval({ approvalId: approval.id, decidedBy: 'owner', decision: 'rejected', expectedRevision: approval.revision, note: 'Do not proceed.' });
  assert.equal(backlog.planClaim({ areaId: context.worker }).canProceed, true);
  const integration = new IntegrationService({ repositoryRoot: context.root, controlPlane: control, checkService: checks });
  integration.request({ areaId: context.worker });
  blockedBy('INTEGRATION_PENDING');
  control.close();
});

test('SCN-backlog-self-claim-race: competing specialist processes cannot assign two tasks to one owner', async () => {
  const context = fixture();
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  const backlog = createBacklogService({ repositoryRoot: context.root, controlPlane: control });
  readyTask(backlog, 'First work', [context.worker]);
  readyTask(backlog, 'Second work', [context.worker]);
  allowSelfClaim(context, [context.worker]);
  const script = `import { openControlPlane } from ${JSON.stringify(new URL('../../src/control-plane/service.mjs', import.meta.url).href)};
    import { createBacklogService } from ${JSON.stringify(new URL('../../src/backlog/service.mjs', import.meta.url).href)};
    const control=openControlPlane({repositoryRoot:process.cwd(),env:process.env});
    try { console.log(JSON.stringify(createBacklogService({repositoryRoot:process.cwd(),controlPlane:control}).claimNext({areaId:${JSON.stringify(context.worker)}}))); }
    catch(error) { console.log(JSON.stringify({error:error.code})); } finally { control.close(); }`;
  const results = await Promise.all([0, 1].map(() => promisify(execFile)(process.execPath,
    ['--input-type=module', '-e', script], { cwd: context.root, env: context.env })));
  const outputs = results.map((result) => JSON.parse(result.stdout));
  assert.equal(outputs.filter((output) => output.disposition === 'claimed').length, 1);
  assert.equal(outputs.every((output) => ['claimed', 'resume'].includes(output.disposition)
    || output.error === 'BACKLOG_ASSIGNMENT_LOCKED'), true, JSON.stringify(outputs));
  assert.equal(backlog.list({ owner: context.worker }).filter((task) => task.state === 'assigned').length, 1);
  assert.equal(backlog.list({ state: 'ready' }).length, 1);
  assert.equal(backlog.claimNext({ areaId: context.worker }).disposition, 'resume');
  control.close();
});

test('SCN-cli-backlog-self-claim: dry-run, explicit action and identity-bound MCP preserve policy and revisions', () => {
  const context = fixture({ withPeer: true });
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  const backlog = createBacklogService({ repositoryRoot: context.root, controlPlane: control });
  const task = readyTask(backlog, 'CLI work', [context.worker]);
  allowSelfClaim(context, [context.worker]);
  const cli = (args) => spawnSync(process.execPath, [new URL('../../bin/torch.mjs', import.meta.url).pathname,
    'backlog', 'claim-next', '--area', context.worker, ...args, '--json'], { cwd: context.root, env: context.env, encoding: 'utf8' });
  assert.equal(cli([]).status, 2);
  assert.equal(backlog.planClaim({ areaId: context.peer }).blockers.some((blocker) =>
    blocker.code === 'BACKLOG_SELF_CLAIM_DISABLED'), true);
  const preview = cli(['--dry-run']);
  assert.equal(preview.status, 0, preview.stdout || preview.stderr);
  assert.equal(JSON.parse(preview.stdout).task.id, task.id);
  assert.equal(backlog.get(task.id).state, 'ready');
  assert.throws(() => callTorchTool(control, 'torch_claim_next_backlog_task', { area_id: context.worker },
    { actorId: context.peer, backlogService: backlog }), (error) => error.code === 'FLEET_IDENTITY_MISMATCH');
  const result = cli(['--yes']);
  assert.equal(result.status, 0, result.stdout || result.stderr);
  assert.equal(JSON.parse(result.stdout).disposition, 'claimed');
  assert.equal(backlog.get(task.id).revision, task.revision + 1);
  assert.equal(JSON.parse(cli(['--yes']).stdout).disposition, 'resume');
  control.close();
});

test('SCN-backlog-blocked-resume-serialization: a resolved blocked task cannot become a second active assignment', () => {
  const context = fixture();
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  const backlog = createBacklogService({ repositoryRoot: context.root, controlPlane: control });
  const first = readyTask(backlog, 'First work', [context.worker]);
  readyTask(backlog, 'Second work', [context.worker]);
  allowSelfClaim(context, [context.worker]);
  const claimed = backlog.claimNext({ areaId: context.worker });
  assert.equal(claimed.task.id, first.id);
  const blocked = backlog.transition({ taskId: first.id, actorId: context.worker,
    to: 'blocked', expectedRevision: claimed.task.revision, blockedReason: 'External dependency.' });
  const second = backlog.claimNext({ areaId: context.worker });
  assert.equal(second.disposition, 'claimed');
  assert.notEqual(second.task.id, first.id);
  assert.throws(() => backlog.transition({ taskId: first.id, actorId: context.worker,
    to: 'in_progress', expectedRevision: blocked.revision }), (error) => error.code === 'BACKLOG_OWNER_BUSY');
  assert.equal(backlog.get(first.id).state, 'blocked');
  backlog.transition({ taskId: second.task.id, actorId: 'session-manager', to: 'cancelled', expectedRevision: second.task.revision });
  assert.equal(backlog.transition({ taskId: first.id, actorId: context.worker,
    to: 'in_progress', expectedRevision: blocked.revision }).state, 'in_progress');
  control.close();
});

test('SCN-backlog-health: unusual queue conditions are reported without repair', () => {
  const base = {
    schema: 'torch.dev/backlog-item/v1alpha1', priority: 'normal', affectedDomains: ['runtime'],
    dependencies: [], acceptanceCriteria: ['Observed.'], evidence: [], commit: null,
    integrationRequest: null, blockedReason: null, createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z', revision: 1, history: [], observedAt: '1111111',
  };
  const tasks = [
    { ...base, id: 'TASK-active-1', title: 'One', description: 'One', state: 'assigned', owner: 'runtime' },
    { ...base, id: 'TASK-active-2', title: 'Two', description: 'Two', state: 'in_progress', owner: 'runtime' },
    { ...base, id: 'TASK-dependency', title: 'Done', description: 'Done', state: 'completed', owner: 'runtime' },
    {
      ...base, id: 'TASK-blocked', title: 'Blocked', description: 'Blocked', state: 'blocked', owner: 'runtime',
      dependencies: ['TASK-dependency'], blockedReason: 'Waiting on dependency.',
    },
    { ...base, id: 'TASK-ready', title: 'Ready', description: 'Ready', state: 'ready', owner: null },
    {
      ...base, id: 'TASK-retired', title: 'Retired', description: 'Retired', state: 'ready', owner: null,
      affectedDomains: ['retired-area'],
    },
  ];
  const health = assessBacklogHealth({
    tasks, now: new Date('2026-09-27T00:00:00Z'), staleAfterDays: 7, staleObservedCommits: 10,
    agents: [{ areaId: 'runtime', state: 'offline', runtimeSessionId: null }],
    commitDistance: () => 60,
  });
  const codes = new Set(health.findings.map((finding) => finding.code));
  assert.deepEqual([...[
    'BACKLOG_MULTIPLE_ACTIVE_ASSIGNMENTS', 'BACKLOG_ASSIGNED_STALE',
    'BACKLOG_ASSIGNED_SESSION_MISSING', 'BACKLOG_BLOCKED_DEPENDENCIES_RESOLVED',
    'BACKLOG_READY_NO_LIVE_SPECIALIST', 'BACKLOG_AREA_UNKNOWN',
    'BACKLOG_OBSERVED_COMMIT_STALE',
  ]].filter((code) => !codes.has(code)), []);
  assert.equal(health.healthy, false);
  assert.equal(health.mutationPerformed, false);
  assert.equal(tasks[0].state, 'assigned');
});

test('SCN-backlog-lifecycle: tracked tasks enforce authority, revisions, dependencies, evidence, and landed completion', () => {
  const context = fixture();
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  let sequence = 0;
  const integrations = new Map();
  const backlog = createBacklogService({
    repositoryRoot: context.root, controlPlane: control,
    idFactory: () => `task-${++sequence}`,
    clock: () => new Date(`2026-09-27T00:00:0${sequence}Z`),
    integrationLookup: (id) => integrations.get(id),
  });
  const first = backlog.create({
    actorId: 'session-manager', title: 'Implement lifecycle', description: 'Build and verify it.',
    affectedDomains: [context.worker], acceptanceCriteria: ['Exact test passes.'],
  });
  const alternate = backlog.create({
    actorId: 'session-manager', title: 'Follow-up lifecycle', description: 'Wait behind active work.',
    affectedDomains: [context.worker], acceptanceCriteria: ['Runs only after current work.'],
  });
  const dependent = backlog.create({
    actorId: 'session-manager', title: 'Use lifecycle', description: 'Consume the completed work.',
    affectedDomains: [context.worker], dependencies: [first.id], acceptanceCriteria: ['Dependency is complete.'],
  });
  let task = backlog.transition({
    taskId: first.id, actorId: 'session-manager', to: 'ready', expectedRevision: first.revision,
  });
  task = backlog.transition({
    taskId: first.id, actorId: 'session-manager', to: 'assigned', expectedRevision: task.revision,
    owner: context.worker,
  });
  let alternateTask = backlog.transition({
    taskId: alternate.id, actorId: 'session-manager', to: 'ready', expectedRevision: alternate.revision,
  });
  const nextWhileAssigned = backlog.next({ areaId: context.worker });
  assert.equal(nextWhileAssigned.disposition, 'resume');
  assert.equal(nextWhileAssigned.task.id, first.id, 'assigned work must outrank ready work after restart');
  assert.equal(nextWhileAssigned.mutationPerformed, false);
  assert.throws(
    () => backlog.transition({
      taskId: alternate.id, actorId: 'session-manager', to: 'assigned',
      expectedRevision: alternateTask.revision, owner: context.worker,
    }),
    (error) => error.code === 'BACKLOG_OWNER_BUSY' && error.details.taskId === first.id,
  );
  const unhealthy = backlog.health({ staleAfterDays: 0 });
  assert.equal(unhealthy.mutationPerformed, false);
  assert.equal(unhealthy.findings.some((finding) =>
    finding.code === 'BACKLOG_ASSIGNED_STALE' && finding.taskId === first.id), true);
  assert.equal(unhealthy.findings.some((finding) =>
    finding.code === 'BACKLOG_ASSIGNED_SESSION_MISSING' && finding.taskId === first.id), true);
  assert.equal(control.readMessages({ recipient: context.worker }).at(-1).references.task, first.id);
  assert.throws(
    () => backlog.transition({
      taskId: first.id, actorId: context.worker, to: 'in_progress', expectedRevision: task.revision - 1,
    }),
    (error) => error.code === 'BACKLOG_REVISION_CONFLICT',
  );
  const taskLock = join(control.stateRoot, 'locks', `backlog-${first.id}.lock`);
  writeFileSync(taskLock, 'held by concurrent fixture\n');
  assert.throws(
    () => backlog.transition({
      taskId: first.id, actorId: context.worker, to: 'in_progress', expectedRevision: task.revision,
    }),
    (error) => error.code === 'BACKLOG_TASK_LOCKED',
  );
  unlinkSync(taskLock);
  let dependentTask = backlog.transition({
    taskId: dependent.id, actorId: 'session-manager', to: 'ready', expectedRevision: dependent.revision,
  });
  assert.throws(
    () => backlog.transition({
      taskId: dependent.id, actorId: 'session-manager', to: 'assigned',
      expectedRevision: dependentTask.revision, owner: context.worker,
    }),
    (error) => error.code === 'BACKLOG_DEPENDENCY_INCOMPLETE',
  );
  task = backlog.transition({
    taskId: first.id, actorId: context.worker, to: 'in_progress', expectedRevision: task.revision,
  });
  task = backlog.transition({
    taskId: first.id, actorId: context.worker, to: 'blocked', expectedRevision: task.revision,
    blockedReason: 'Need an owner decision.',
  });
  assert.equal(control.readMessages({ recipient: 'session-manager' }).at(-1).kind, 'blocker');
  task = backlog.transition({
    taskId: first.id, actorId: 'session-manager', to: 'assigned', expectedRevision: task.revision,
    owner: context.worker, note: 'Decision supplied.',
  });
  task = backlog.transition({
    taskId: first.id, actorId: context.worker, to: 'in_progress', expectedRevision: task.revision,
  });
  task = backlog.transition({
    taskId: first.id, actorId: context.worker, to: 'verification', expectedRevision: task.revision,
    commit: '1111111111111111111111111111111111111111', evidence: ['SCN-backlog-lifecycle PASS'],
  });
  task = backlog.transition({
    taskId: first.id, actorId: context.worker, to: 'ready_to_integrate', expectedRevision: task.revision,
    integrationRequest: 'integration-1',
  });
  assert.throws(
    () => backlog.transition({
      taskId: first.id, actorId: context.worker, to: 'completed', expectedRevision: task.revision,
    }),
    (error) => error.code === 'BACKLOG_AUTHORITY_REQUIRED',
  );
  const diagnosis = diagnoseProject({ repository: inspectRepository(context.root), env: context.env });
  assert.equal(diagnosis.findings.some((finding) =>
    finding.code === 'BACKLOG_ACTIVITY' && finding.tasks.some((item) => item.id === dependent.id)), true);
  assert.equal(
    diagnosis.findings.some((finding) =>
      finding.code === 'BACKLOG_ASSIGNED_SESSION_MISSING' && finding.taskId === first.id),
    true,
    'doctor must expose backlog health anomalies without a separate queue',
  );
  integrations.set('integration-1', {
    state: 'landed', sourceCommit: '1111111111111111111111111111111111111111',
  });
  task = backlog.transition({
    taskId: first.id, actorId: 'session-manager', to: 'completed', expectedRevision: task.revision,
  });
  assert.equal(task.state, 'completed');
  const nextAfterCompletion = backlog.next({ areaId: context.worker });
  assert.equal(nextAfterCompletion.disposition, 'ready');
  assert.equal(nextAfterCompletion.task.id, alternate.id, 'queue order must remain deterministic');

  dependentTask = backlog.transition({
    taskId: dependent.id, actorId: 'session-manager', to: 'assigned', expectedRevision: dependentTask.revision,
    owner: context.worker,
  });
  assert.equal(dependentTask.owner, context.worker);
  assert.equal(backlog.list({ state: 'completed' })[0].id, first.id);
  assert.equal(callTorchTool(control, 'torch_list_backlog', {}, {
    actorId: context.worker, backlogService: backlog,
  }).tasks.length, 3);
  assert.equal(callTorchTool(control, 'torch_next_backlog_task', {}, {
    actorId: context.worker, backlogService: backlog,
  }).task.id, dependent.id);
  assert.equal(callTorchTool(control, 'torch_backlog_health', {}, {
    actorId: context.worker, backlogService: backlog,
  }).mutationPerformed, false);
  assert.throws(
    () => callTorchTool(control, 'torch_create_backlog_task', {
      title: 'Forged task', description: 'Worker cannot create it.', acceptance_criteria: ['No.'],
    }, { actorId: context.worker, backlogService: backlog }),
    (error) => error.code === 'BACKLOG_AUTHORITY_REQUIRED',
  );
  assert.equal(
    execFileSync('git', ['-C', context.root, 'status', '--porcelain'], { encoding: 'utf8' }),
    context.mainStatus,
    'backlog files must not add dirt to canonical main',
  );
  control.close();
});

test('SCN-backlog-classification: feature and milestone labels are revisioned manager metadata, not another queue', () => {
  const context = fixture();
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  const backlog = createBacklogService({ repositoryRoot: context.root, controlPlane: control });
  const task = backlog.create({
    actorId: 'session-manager', title: 'Build terrain traversal', description: 'Connect world data to movement.',
    affectedDomains: [context.worker], acceptanceCriteria: ['Traversal test passes.'],
    feature: 'World pipeline', milestone: 'Alpha',
  });
  assert.equal(task.feature, 'World pipeline');
  assert.equal(task.milestone, 'Alpha');
  assert.equal(backlog.list()[0].state, 'proposed');
  assert.throws(
    () => backlog.classify({
      taskId: task.id, actorId: context.worker, expectedRevision: task.revision,
      feature: 'Unauthorized change', reason: 'Worker cannot own program planning.',
    }),
    (error) => error.code === 'BACKLOG_AUTHORITY_REQUIRED',
  );
  const classified = callTorchTool(control, 'torch_classify_backlog_task', {
    task_id: task.id, expected_revision: task.revision,
    feature: 'World generation', reason: 'Group recurring terrain and traversal tasks.',
  }, { actorId: 'session-manager', backlogService: backlog });
  assert.equal(classified.mutationPerformed, true);
  assert.equal(classified.feature, 'World generation');
  assert.equal(classified.milestone, 'Alpha');
  assert.equal(classified.revision, task.revision + 1);
  assert.equal(classified.state, 'proposed');
  assert.equal(classified.owner, null);
  assert.equal(classified.classificationHistory[0].from.feature, 'World pipeline');
  assert.throws(
    () => backlog.classify({
      taskId: task.id, actorId: 'session-manager', expectedRevision: task.revision,
      milestone: 'Beta', reason: 'Stale update.',
    }),
    (error) => error.code === 'BACKLOG_REVISION_CONFLICT',
  );
  const cleared = backlog.classify({
    taskId: task.id, actorId: 'session-manager', expectedRevision: classified.revision,
    clearMilestone: true, reason: 'Move this task out of the retired milestone.',
  });
  assert.equal(cleared.feature, 'World generation');
  assert.equal(cleared.milestone, null);
  assert.equal(cleared.revision, classified.revision + 1);
  assert.throws(
    () => backlog.classify({
      taskId: task.id, actorId: 'session-manager', expectedRevision: cleared.revision,
      feature: 'World generation', clearFeature: true, reason: 'Conflicting request.',
    }),
    (error) => error.code === 'INVALID_BACKLOG_CLASSIFICATION',
  );
  assert.equal(control.readAudit().some((entry) => entry.operation === 'backlog.classify'), true);
  control.close();
});

test('SCN-owner-backlog-priority: only the owner may make a revision-checked priority-only change', () => {
  const context = fixture();
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  const backlog = createBacklogService({ repositoryRoot: context.root, controlPlane: control });
  const task = backlog.create({
    actorId: 'session-manager', title: 'Improve navigation cache', description: 'Reduce route recomputation.',
    affectedDomains: [context.worker], acceptanceCriteria: ['Cache validity is tested.'], priority: 'normal',
  });
  assert.throws(() => backlog.planPriorityChange({
    taskId: task.id, actorId: context.worker, expectedRevision: task.revision,
    priority: 'urgent', reason: 'Specialist cannot change owner priority.',
  }), (error) => error.code === 'OWNER_AUTHORITY_REQUIRED');
  const plan = backlog.planPriorityChange({
    taskId: task.id, actorId: 'owner', expectedRevision: task.revision,
    priority: 'high', reason: 'Unblock the current integration milestone.',
  });
  assert.equal(plan.mutationPerformed, false);
  assert.equal(plan.from, 'normal');
  assert.equal(plan.to, 'high');
  assert.equal(backlog.get(task.id).priority, 'normal');
  const changed = backlog.setPriority({
    taskId: task.id, actorId: 'owner', expectedRevision: task.revision,
    priority: 'high', reason: plan.reason,
  });
  assert.equal(changed.priority, 'high');
  assert.equal(changed.revision, task.revision + 1);
  assert.equal(changed.state, task.state);
  assert.equal(changed.owner, task.owner);
  assert.deepEqual(changed.evidence, task.evidence);
  assert.deepEqual(changed.dependencies, task.dependencies);
  assert.equal(changed.priorityHistory[0].reason, plan.reason);
  assert.throws(() => backlog.setPriority({
    taskId: task.id, actorId: 'owner', expectedRevision: task.revision,
    priority: 'urgent', reason: 'Stale preview must not apply.',
  }), (error) => error.code === 'BACKLOG_REVISION_CONFLICT');
  assert.equal(control.readAudit().some((entry) => entry.operation === 'backlog.priority'
    && entry.entityId === task.id), true);
  control.close();
});

test('SCN-owner-backlog-create: the owner may propose audited work but cannot assign or dispatch it', () => {
  const context = fixture();
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  const backlog = createBacklogService({ repositoryRoot: context.root, controlPlane: control });
  const input = {
    title: 'Expose a new project decision', description: 'Give the owner a bounded, reviewable task path.',
    priority: 'high', affectedDomains: [context.worker], dependencies: [],
    acceptanceCriteria: ['The task remains proposed and unassigned.'], feature: '', milestone: '',
  };
  assert.throws(() => backlog.planOwnerCreate({ ...input, actorId: context.worker }),
    (error) => error.code === 'OWNER_AUTHORITY_REQUIRED');
  const before = backlog.list().length;
  assert.throws(() => backlog.create({ ...input, actorId: 'owner' }),
    (error) => ['BACKLOG_AUTHORITY_REQUIRED', 'UNKNOWN_FLEET_IDENTITY'].includes(error.code));
  const plan = backlog.planOwnerCreate({ ...input, actorId: 'owner' });
  assert.equal(plan.mutationPerformed, false);
  assert.equal(plan.task.state, 'proposed');
  assert.equal(plan.task.owner, null);
  assert.deepEqual(plan.task.affectedDomains, [context.worker]);
  assert.equal(backlog.list().length, before);

  const created = backlog.createOwner({ ...input, actorId: 'owner' });
  assert.equal(created.state, 'proposed');
  assert.equal(created.owner, null);
  assert.equal(created.feature, null);
  assert.equal(created.history[0].actorId, 'owner');
  assert.equal(backlog.get(created.id).state, 'proposed');
  assert.equal(control.readAudit().some((entry) => entry.actorId === 'owner'
    && entry.operation === 'backlog.create' && entry.entityId === created.id), true);
  assert.throws(() => backlog.createOwner({ ...input, actorId: context.worker }),
    (error) => error.code === 'OWNER_AUTHORITY_REQUIRED');
  control.close();
});
