import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { analyzeRepository } from '../../src/kernel/analyze.mjs';
import { diagnoseProject } from '../../src/kernel/doctor.mjs';
import { inspectRepository } from '../../src/kernel/git.mjs';
import {
  PROJECT_CONFIG_SCHEMA, planProjectConfigMigration, validateProjectConfig,
} from '../../src/kernel/config.mjs';
import { installProject, planInstall, uninstallProject } from '../../src/kernel/install.mjs';
import { proposeDomains, validateApprovedProposal } from '../../src/kernel/domains.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'torch-kernel-'));
  execFileSync('git', ['init', '-b', 'main', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'torch-test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'TORCH Test']);
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    name: 'fixture-app', scripts: { test: 'node --test', build: 'node build.mjs' },
  }));
  writeFileSync(join(root, 'index.js'), 'export const ready = true;\n');
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'fixture']);
  const stateHome = join(root, '.xdg-data');
  return { root, env: { ...process.env, XDG_DATA_HOME: stateHome } };
}

function approvedProposal(repository) {
  const proposal = proposeDomains({ repository, analysis: analyzeRepository(repository) });
  proposal.review = {
    status: 'approved', reviewedAt: '2026-09-27T00:00:00Z', reviewedBy: 'fixture-owner', notes: [],
  };
  return proposal;
}

test('SCN-init-read-only: inspection and analysis do not mutate the project', () => {
  const { root, env } = fixture();
  const before = execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' });
  const repository = inspectRepository(root);
  const analysis = analyzeRepository(repository);
  const plan = planInstall({ repository, proposal: approvedProposal(repository), env });
  const after = execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' });

  assert.equal(analysis.mutationPerformed, false);
  assert.equal(plan.mutationPerformed, false);
  assert.equal(existsSync(join(root, '.torch')), false);
  assert.equal(after, before);
  assert.deepEqual(analysis.inventory.languages[0], { name: 'JavaScript', files: 1 });
  assert.equal(analysis.inventory.checks.some((check) => check.name === 'test'), true);
});

test('SCN-install-doctor-purge: a fresh install is healthy and exactly reversible', () => {
  const { root, env } = fixture();
  const repository = inspectRepository(root);
  const proposal = approvedProposal(repository);
  const installed = installProject({
    repository, proposal, env, projectId: 'fixture-project', now: () => new Date('2026-09-27T00:00:00Z'),
  });

  assert.equal(existsSync(join(root, '.torch', 'torch.yaml')), true);
  assert.equal(existsSync(installed.stateRoot), true);
  const config = JSON.parse(readFileSync(join(root, '.torch', 'torch.yaml'), 'utf8'));
  assert.equal(config.project.id, 'fixture-project');

  const diagnosis = diagnoseProject({ repository: inspectRepository(root), env });
  assert.equal(diagnosis.healthy, true);
  assert.equal(diagnosis.status, 'ok');

  const result = uninstallProject({ repository: inspectRepository(root), purge: true });
  assert.equal(result.mutationPerformed, true);
  assert.equal(existsSync(join(root, '.torch')), false);
  assert.equal(existsSync(installed.stateRoot), false);
  assert.equal(readFileSync(join(root, 'index.js'), 'utf8'), 'export const ready = true;\n');
});

test('SCN-purge-protects-user-change: uninstall refuses to delete modified managed files', () => {
  const { root, env } = fixture();
  const repository = inspectRepository(root);
  installProject({ repository, proposal: approvedProposal(repository), env, projectId: 'modified-project' });
  const configPath = join(root, '.torch', 'torch.yaml');
  writeFileSync(configPath, `${readFileSync(configPath, 'utf8')}\n# owner change\n`);

  assert.throws(
    () => uninstallProject({ repository: inspectRepository(root), purge: true }),
    (error) => error.code === 'UNSAFE_TO_PURGE'
      && error.details.some((problem) => problem.type === 'modified' && problem.path === '.torch/torch.yaml'),
  );
  assert.equal(existsSync(configPath), true);
});

test('SCN-domain-approval: installation rejects stale or unapproved organizational proposals', () => {
  const { root, env } = fixture();
  const repository = inspectRepository(root);
  const pending = proposeDomains({ repository, analysis: analyzeRepository(repository) });
  assert.throws(
    () => installProject({ repository, proposal: pending, env }),
    (error) => error.code === 'PROPOSAL_NOT_APPROVED'
      && error.details.includes('proposal review status is not approved'),
  );
  pending.review.status = 'approved';
  pending.repository.head = '0000000000000000000000000000000000000000';
  assert.throws(
    () => validateApprovedProposal({ proposal: pending, repository }),
    (error) => error.details.includes('proposal is stale because HEAD changed'),
  );
  assert.equal(existsSync(join(root, '.torch')), false);
});

test('SCN-install-runtime-selection: approved runtime choices are explicit and cover every identity', () => {
  const { root, env } = fixture();
  const repository = inspectRepository(root);
  const proposal = approvedProposal(repository);
  assert.deepEqual(planInstall({ repository, proposal, env, runtimes: ['claude'] }).runtimes, ['claude']);
  proposal.domains[0].runtime = 'codex';
  assert.throws(
    () => planInstall({ repository, proposal, env, runtimes: ['claude'] }),
    (error) => error.code === 'INSTALL_RUNTIME_MISSING' && error.details.missing.includes('codex'),
  );
  assert.throws(
    () => planInstall({ repository, proposal, env, runtimes: ['unknown'] }),
    (error) => error.code === 'INSTALL_RUNTIME_INVALID',
  );
  const installed = installProject({
    repository, proposal, env, projectId: 'runtime-selection', runtimes: ['claude', 'codex'],
  });
  assert.equal(installed.mutationPerformed, true);
  const config = JSON.parse(readFileSync(join(root, '.torch', 'torch.yaml'), 'utf8'));
  assert.deepEqual(Object.keys(config.runtimes).sort(), ['claude', 'codex', 'default']);
});

test('SCN-config-schema: installed configuration is strict, versioned, and migration-aware', () => {
  const { root, env } = fixture();
  const repository = inspectRepository(root);
  installProject({ repository, proposal: approvedProposal(repository), env, projectId: 'schema-project' });
  const config = JSON.parse(readFileSync(join(root, '.torch', 'torch.yaml'), 'utf8'));

  assert.equal(validateProjectConfig(config), config);
  assert.deepEqual(planProjectConfigMigration(config), {
    from: PROJECT_CONFIG_SCHEMA, to: PROJECT_CONFIG_SCHEMA,
    steps: [], canProceed: true, changed: false, mutationPerformed: false,
  });

  assert.throws(
    () => validateProjectConfig({ ...config, schema: 'torch.dev/v2' }),
    (error) => error.code === 'CONFIG_SCHEMA_UNSUPPORTED'
      && error.details.supported.includes(PROJECT_CONFIG_SCHEMA),
  );
  assert.throws(
    () => validateProjectConfig({ ...config, future_required_policy: true }),
    (error) => error.code === 'CONFIG_SCHEMA_INVALID'
      && error.details.some((issue) => issue.path === '<root>' && issue.code === 'unrecognized_keys'),
  );
  assert.throws(
    () => validateProjectConfig({ ...config, git: { ...config.git, allow_rebase: true } }),
    (error) => error.code === 'CONFIG_SCHEMA_INVALID'
      && error.details.some((issue) => issue.path === 'git.allow_rebase'),
  );
  assert.equal(planProjectConfigMigration({ schema: 'torch.dev/v2' }).canProceed, false);
});
