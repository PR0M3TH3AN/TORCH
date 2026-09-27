import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import { analyzeRepository } from '../../src/kernel/analyze.mjs';
import { diagnoseProject } from '../../src/kernel/doctor.mjs';
import { proposeDomains } from '../../src/kernel/domains.mjs';
import { inspectRepository } from '../../src/kernel/git.mjs';
import { installProject, planUninstall, uninstallProject } from '../../src/kernel/install.mjs';
import { createWorktrees, planWorktrees } from '../../src/kernel/worktrees.mjs';

function installedFixture() {
  const root = mkdtempSync(join(tmpdir(), 'torch-worktrees-'));
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
  const installed = installProject({ repository, proposal, env, projectId: 'worktree-fixture' });
  execFileSync('git', ['-C', root, 'add', '.torch']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'install torch']);
  repository = inspectRepository(root);
  return { root, repository, env, installed, worktreeParent: join(tmpdir(), `${basename(root)}-managed-worktrees`) };
}

test('SCN-worktree-bootstrap: approved identities receive isolated branches and ignored task markers', () => {
  const fixture = installedFixture();
  const preview = planWorktrees({ repository: fixture.repository, parentOverride: fixture.worktreeParent });
  assert.equal(preview.mutationPerformed, false);
  assert.equal(preview.canProceed, true);
  assert.deepEqual(preview.actions.map((action) => action.area), ['session-manager', 'core']);
  assert.equal(preview.actions.every((action) => action.action === 'create'), true);
  assert.equal(existsSync(preview.fleetRoot), false);

  const created = createWorktrees({ repository: fixture.repository, parentOverride: fixture.worktreeParent });
  assert.equal(created.created.length, 2);
  for (const action of created.created) {
    assert.equal(execFileSync('git', ['-C', action.path, 'branch', '--show-current'], { encoding: 'utf8' }).trim(), action.branch);
    assert.equal(readFileSync(join(action.path, '.task'), 'utf8'), `Unassigned · ${action.area}\n`);
    execFileSync('git', ['-C', action.path, 'check-ignore', '-q', '.task']);
  }
  const repeated = planWorktrees({ repository: inspectRepository(fixture.root), parentOverride: fixture.worktreeParent });
  assert.equal(repeated.actions.every((action) => action.action === 'keep'), true);
  assert.equal(repeated.canProceed, true);
  assert.equal(diagnoseProject({ repository: inspectRepository(fixture.root), env: fixture.env }).healthy, true);

  writeFileSync(join(fixture.root, 'drift.txt'), 'new canonical state\n');
  execFileSync('git', ['-C', fixture.root, 'add', 'drift.txt']);
  execFileSync('git', ['-C', fixture.root, 'commit', '-m', 'advance canonical main']);
  const core = created.created.find((entry) => entry.area === 'core');
  const mergeHead = execFileSync('git', ['-C', core.path, 'rev-parse', '--git-path', 'MERGE_HEAD'], {
    encoding: 'utf8',
  }).trim();
  writeFileSync(mergeHead, `${execFileSync('git', ['-C', fixture.root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()}\n`);
  const diagnosis = diagnoseProject({
    repository: inspectRepository(fixture.root), env: fixture.env,
    now: () => new Date('2026-09-28T00:00:00Z'),
  });
  const drift = diagnosis.findings.find((finding) => finding.code === 'WORKTREE_DRIFT' && finding.area === 'core');
  assert.equal(drift.behind, 1);
  assert.equal(Number.isInteger(drift.driftAgeSeconds), true);
  assert.equal(diagnosis.findings.some((finding) =>
    finding.code === 'GIT_OPERATION_ACTIVE' && finding.operations.includes('MERGE_HEAD')), true);
  assert.equal(diagnosis.findings.some((finding) =>
    finding.code === 'RECOVERABILITY' && finding.level === 'ONE-DISK'), true);
  assert.equal(diagnosis.findings.some((finding) => finding.code.startsWith('RUNTIME_')), true);
  unlinkSync(mergeHead);
  uninstallProject({ repository: inspectRepository(fixture.root), purge: true });
  assert.equal(created.created.some((action) => existsSync(action.path)), false);
  assert.equal(readFileSync(join(fixture.root, '.git', 'info', 'exclude'), 'utf8').includes('.task'), false);
});

test('SCN-worktree-purge-safety: modified or uniquely committed domain work blocks removal', () => {
  const fixture = installedFixture();
  const created = createWorktrees({ repository: fixture.repository, parentOverride: fixture.worktreeParent });
  const core = created.created.find((entry) => entry.area === 'core');
  writeFileSync(join(core.path, 'domain-work.txt'), 'not safe to delete\n');

  const plan = planUninstall({ repository: inspectRepository(fixture.root), purge: true });
  assert.equal(plan.canProceed, false);
  assert.equal(plan.problems.some((problem) =>
    problem.type === 'unsafe-worktree' && problem.area === 'core'
      && problem.problems.includes('worktree-dirty')), true);
  execFileSync('git', ['-C', core.path, 'add', 'domain-work.txt']);
  execFileSync('git', ['-C', core.path, 'commit', '-m', 'domain work']);
  const committedPlan = planUninstall({ repository: inspectRepository(fixture.root), purge: true });
  assert.equal(committedPlan.problems.some((problem) =>
    problem.type === 'unsafe-worktree' && problem.area === 'core'
      && problem.problems.includes('unique-commits:1')), true);
  assert.throws(
    () => uninstallProject({ repository: inspectRepository(fixture.root), purge: true }),
    (error) => error.code === 'UNSAFE_TO_PURGE',
  );
  assert.equal(existsSync(join(core.path, 'domain-work.txt')), true);
});

test('SCN-worktree-collision: an existing fleet branch prevents every worktree mutation', () => {
  const fixture = installedFixture();
  execFileSync('git', ['-C', fixture.root, 'branch', 'torch/core', 'main']);
  const plan = planWorktrees({ repository: inspectRepository(fixture.root), parentOverride: fixture.worktreeParent });
  assert.equal(plan.canProceed, false);
  assert.equal(plan.conflicts.some((conflict) =>
    conflict.type === 'branch-already-exists' && conflict.branch === 'torch/core'), true);
  assert.throws(
    () => createWorktrees({ repository: inspectRepository(fixture.root), parentOverride: fixture.worktreeParent }),
    (error) => error.code === 'WORKTREE_CONFLICT',
  );
  assert.equal(existsSync(plan.fleetRoot), false);
  assert.equal(execFileSync('git', ['-C', fixture.root, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' })
    .includes('torch/session-manager'), false);
});
