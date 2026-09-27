import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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

function baseFixture(name) {
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
  const context = baseFixture('integration-fixture');
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
