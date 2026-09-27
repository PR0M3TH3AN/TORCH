import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import { createBacklogService } from '../../src/backlog/service.mjs';
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
  integrations.set('integration-1', {
    state: 'landed', sourceCommit: '1111111111111111111111111111111111111111',
  });
  task = backlog.transition({
    taskId: first.id, actorId: 'session-manager', to: 'completed', expectedRevision: task.revision,
  });
  assert.equal(task.state, 'completed');

  dependentTask = backlog.transition({
    taskId: dependent.id, actorId: 'session-manager', to: 'assigned', expectedRevision: dependentTask.revision,
    owner: context.worker,
  });
  assert.equal(dependentTask.owner, context.worker);
  assert.equal(backlog.list({ state: 'completed' })[0].id, first.id);
  assert.equal(callTorchTool(control, 'torch_list_backlog', {}, {
    actorId: context.worker, backlogService: backlog,
  }).tasks.length, 2);
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
