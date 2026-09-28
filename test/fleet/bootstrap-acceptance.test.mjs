import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import { createClaudeAdapter } from '../../src/adapters/claude.mjs';
import { createBacklogService } from '../../src/backlog/service.mjs';
import { CheckService } from '../../src/checks/service.mjs';
import { openControlPlane } from '../../src/control-plane/service.mjs';
import { analyzeRepository } from '../../src/kernel/analyze.mjs';
import { diagnoseProject } from '../../src/kernel/doctor.mjs';
import { proposeDomains } from '../../src/kernel/domains.mjs';
import { inspectRepository } from '../../src/kernel/git.mjs';
import { installProject, planUninstall } from '../../src/kernel/install.mjs';
import { createWorktrees } from '../../src/kernel/worktrees.mjs';
import { ResourceService } from '../../src/resources/service.mjs';
import { planFleetDown, planFleetUp, startFleet, stopFleet } from '../../src/runtime/lifecycle.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'torch-bootstrap-acceptance-'));
  execFileSync('git', ['init', '-b', 'main', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'torch-test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'TORCH Test']);
  writeFileSync(join(root, 'app.js'), 'export const ready = true;\n');
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'fixture']);
  let repository = inspectRepository(root);
  const proposal = proposeDomains({ repository, analysis: analyzeRepository(repository) });
  proposal.domains = [
    {
      id: 'server', title: 'Server', scope: ['server behavior'], not_scope: ['client presentation'],
      owned_paths: ['src/server/**'], shared_paths: ['src/contracts/**'], neighbours: ['client'],
      required_checks: ['verify'], resources: ['browser'], runtime: 'claude', model: null, branch: null, worktree_name: null,
    },
    {
      id: 'client', title: 'Client', scope: ['client presentation'], not_scope: ['server behavior'],
      owned_paths: ['src/client/**'], shared_paths: ['src/contracts/**'], neighbours: ['server'],
      required_checks: ['verify'], resources: ['browser'], runtime: 'claude', model: null, branch: null, worktree_name: null,
    },
  ];
  proposal.collisions = [];
  proposal.checks = [{
    id: 'verify', title: 'Fixture verification', command: process.execPath,
    args: ['-e', 'process.exit(0)'], resources: [],
  }];
  proposal.resources = [{ id: 'browser', capacity: 1, queue: 'fifo', max_hold_seconds: 300 }];
  proposal.review = {
    status: 'approved', reviewedAt: '2026-09-27T00:00:00Z', reviewedBy: 'fixture-owner', notes: [],
  };
  const env = { ...process.env, XDG_DATA_HOME: join(tmpdir(), `${basename(root)}-state`) };
  installProject({ repository, proposal, env, projectId: 'bootstrap-acceptance' });
  execFileSync('git', ['-C', root, 'add', '.torch']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'install torch']);
  repository = inspectRepository(root);
  createWorktrees({ repository, parentOverride: join(tmpdir(), `${basename(root)}-worktrees`) });
  execFileSync('git', ['-C', root, 'add', '.torch/install-manifest.json']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'record worktrees']);
  return { root, env };
}

test('SCN-bootstrap-acceptance: one installed fixture proves the complete organization lifecycle', () => {
  const context = fixture();
  let control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  const roster = control.getRoster();
  assert.deepEqual(roster.agents.map((agent) => agent.areaId), ['session-manager', 'server', 'client']);
  assert.equal(new Set(roster.agents.map((agent) => agent.areaId)).size, roster.agents.length);

  const manifest = JSON.parse(readFileSync(join(context.root, '.torch', 'install-manifest.json'), 'utf8'));
  const worktrees = manifest.external.filter((entry) => entry.type === 'worktree');
  assert.equal(worktrees.length, roster.agents.length);
  for (const agent of roster.agents) {
    const worktree = worktrees.find((entry) => entry.area === agent.areaId);
    assert.ok(worktree);
    assert.equal(existsSync(worktree.path), true);
    assert.equal(existsSync(join(worktree.path, '.torch', 'prompts', `${agent.areaId}.md`)), true);
  }

  const adapter = createClaudeAdapter();
  const adapters = new Map([['claude', adapter]]);
  const up = planFleetUp({ repositoryRoot: context.root, controlPlane: control, adapters, fresh: true });
  assert.equal(up.canProceed, true, JSON.stringify(up.blockers));
  assert.equal(up.actions.at(-1).areaId, 'session-manager');
  let runtime = 0;
  const started = startFleet({
    plan: up, controlPlane: control, adapters,
    executor: () => ({ status: 0, stdout: `bootstrap-runtime-${++runtime}\n` }),
  });
  assert.equal(new Set(started.started.map((entry) => entry.runtimeSessionId)).size, roster.agents.length);
  for (const action of up.actions) {
    assert.match(readFileSync(action.promptFile, 'utf8'), new RegExp(`Area ID: ${action.areaId}|TORCH Session Manager`));
  }
  const serverPrompt = readFileSync(up.actions.find((action) => action.areaId === 'server').promptFile, 'utf8');
  assert.match(serverPrompt, /## Owned paths[\s\S]*src\/server\/\*\*/);
  assert.match(serverPrompt, /## Shared paths[\s\S]*src\/contracts\/\*\*/);
  assert.match(serverPrompt, /## Required checks[\s\S]*verify/);
  assert.match(serverPrompt, /## Authority[\s\S]*Integration authority does not grant release or deployment authority/);
  assert.match(serverPrompt, /## Project invariants[\s\S]*Repository and TORCH durable state outrank conversation memory/);
  assert.match(serverPrompt, /## Initial backlog[\s\S]*No task is implied by session creation/);

  for (const areaId of ['server', 'client']) {
    const message = control.sendMessage({ sender: 'session-manager', recipient: areaId, body: `Own ${areaId} work.` });
    assert.equal(control.readMessages({ recipient: areaId }).some((entry) => entry.id === message.id), true);
  }
  const peer = control.sendMessage({ sender: 'server', recipient: 'client', body: 'Coordinate the shared contract.' });
  control.ackMessage({ recipient: 'client', messageId: peer.id });
  assert.ok(control.readMessages({ recipient: 'client' }).find((entry) => entry.id === peer.id).acknowledgedAt);
  assert.deepEqual(control.whoOwns({ path: 'src/server/router.js' }).owners.map((owner) => owner.areaId), ['server']);

  const resources = new ResourceService({ repositoryRoot: context.root, controlPlane: control });
  assert.equal(resources.acquire({ resourceId: 'browser', areaId: 'server' }).disposition, 'acquired');
  assert.equal(resources.acquire({ resourceId: 'browser', areaId: 'client' }).disposition, 'queued');
  resources.release({ resourceId: 'browser', areaId: 'server' });
  assert.equal(resources.acquire({ resourceId: 'browser', areaId: 'client' }).disposition, 'acquired');
  resources.release({ resourceId: 'browser', areaId: 'client' });

  const checks = new CheckService({ repositoryRoot: context.root, controlPlane: control, resourceService: resources });
  const receipt = checks.run({ checkId: 'verify', areaId: 'server' });
  assert.equal(receipt.result, 'pass');
  assert.equal(receipt.commit, execFileSync('git', ['-C', worktrees.find((entry) => entry.area === 'server').path, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim());

  const backlog = createBacklogService({
    repositoryRoot: context.root, controlPlane: control, idFactory: () => 'BOOTSTRAP-1',
    integrationLookup: () => ({ state: 'landed', sourceCommit: receipt.commit }),
  });
  let task = backlog.create({
    actorId: 'session-manager', title: 'Verify bootstrap', description: 'Exercise durable task state.',
    affectedDomains: ['server'], acceptanceCriteria: ['Exact receipt is recorded.'],
  });
  for (const transition of [
    { actorId: 'session-manager', to: 'ready' },
    { actorId: 'session-manager', to: 'assigned', owner: 'server' },
    { actorId: 'server', to: 'in_progress' },
    { actorId: 'server', to: 'verification', commit: receipt.commit, evidence: ['verify receipt'] },
    { actorId: 'server', to: 'ready_to_integrate', integrationRequest: 'fixture-integration' },
    { actorId: 'session-manager', to: 'completed' },
  ]) task = backlog.transition({ taskId: task.id, expectedRevision: task.revision, ...transition });
  assert.equal(task.state, 'completed');

  const diagnosis = diagnoseProject({ repository: inspectRepository(context.root), env: context.env });
  assert.equal(diagnosis.findings.some((finding) => finding.code === 'FLEET_PRESENCE'), true);
  for (const agent of control.listAgents()) control.reportStatus({ areaId: agent.areaId, state: 'idle', summary: 'Checkpoint safe.' });
  const downPlan = planFleetDown({ repositoryRoot: context.root, controlPlane: control });
  const stopped = stopFleet({ plan: downPlan, controlPlane: control, stopRuntime: () => ({ stopped: true }) });
  assert.equal(existsSync(stopped.snapshotPath), true);
  const stableIds = control.listAgents().map((agent) => agent.areaId);
  control.close();

  control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  assert.deepEqual(control.listAgents().map((agent) => agent.areaId), stableIds);
  const resume = planFleetUp({ repositoryRoot: context.root, controlPlane: control, adapter, fresh: false });
  assert.equal(resume.actions.every((action) => action.mode === 'resume'), true);
  assert.deepEqual(resume.actions.map((action) => action.runtimeSessionId), started.started.map((entry) => entry.runtimeSessionId));
  control.close();

  const reversal = planUninstall({ repository: inspectRepository(context.root), purge: true, env: context.env });
  assert.equal(reversal.mutationPerformed, false);
  assert.equal(reversal.manifest.external.filter((entry) => entry.type === 'worktree').length, roster.agents.length);
  assert.equal(reversal.problems.some((problem) => problem.type === 'unsafe-worktree'), true,
    'dry-run must expose the manager backlog worktree instead of pretending purge is safe');
});
