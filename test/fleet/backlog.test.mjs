import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, unlinkSync, writeFileSync } from 'node:fs';
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

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'torch-backlog-'));
  execFileSync('git', ['init', '-b', 'main', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'torch-test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'TORCH Test']);
  writeFileSync(join(root, 'app.js'), 'export const app = true;\n');
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
  return { root, env, worker: proposal.domains[0].id, mainStatus };
}

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
