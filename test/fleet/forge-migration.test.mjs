import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createLocalCanonical } from '../../src/canonical/local.mjs';
import { openControlPlane } from '../../src/control-plane/service.mjs';
import { analyzeRepository } from '../../src/kernel/analyze.mjs';
import { proposeDomains } from '../../src/kernel/domains.mjs';
import { inspectRepository } from '../../src/kernel/git.mjs';
import { installProject } from '../../src/kernel/install.mjs';
import { createWorktrees } from '../../src/kernel/worktrees.mjs';

const CLI = new URL('../../bin/torch.mjs', import.meta.url).pathname;

function run(root, env, args) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd: root, env, encoding: 'utf8' });
}

test('SCN-forge-migration: attach, outage, and detach preserve the local Fleet', () => {
  const root = mkdtempSync(join(tmpdir(), 'torch-forge-migration-'));
  const stateHome = mkdtempSync(join(tmpdir(), 'torch-forge-state-'));
  const worktreeParent = mkdtempSync(join(tmpdir(), 'torch-forge-worktrees-'));
  const forgePath = mkdtempSync(join(tmpdir(), 'torch-forge-remote-'));
  const offlinePath = `${forgePath}-offline`;
  const env = { ...process.env, XDG_DATA_HOME: stateHome };
  execFileSync('git', ['init', '-b', 'main', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'torch-test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'TORCH Test']);
  writeFileSync(join(root, 'app.js'), 'export const app = true;\n');
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'fixture']);
  let repository = inspectRepository(root);
  const proposal = proposeDomains({ repository, analysis: analyzeRepository(repository) });
  proposal.paths = { worktree_parent: worktreeParent };
  proposal.review = {
    status: 'approved', reviewedAt: '2026-09-27T00:00:00Z', reviewedBy: 'fixture-owner', notes: [],
  };
  installProject({ repository, proposal, env, projectId: 'forge-migration' });
  execFileSync('git', ['-C', root, 'add', '.torch']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'install torch']);
  repository = inspectRepository(root);
  createWorktrees({ repository, parentOverride: worktreeParent });
  execFileSync('git', ['-C', root, 'add', '.torch']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'record worktrees']);
  const localCanonical = createLocalCanonical({ repositoryRoot: root });
  execFileSync('git', ['-C', root, 'add', '.torch']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'record local canonical']);
  execFileSync('git', ['-C', root, 'push', 'torch-canonical', 'main']);

  execFileSync('git', ['init', '--bare', forgePath]);
  execFileSync('git', ['-C', root, 'remote', 'add', 'origin', forgePath]);
  execFileSync('git', ['-C', root, 'push', 'origin', 'main']);
  const manifestBefore = JSON.parse(readFileSync(join(root, '.torch', 'install-manifest.json'), 'utf8'));
  const worktreesBefore = manifestBefore.external.filter((entry) => entry.type === 'worktree');
  const control = openControlPlane({ repositoryRoot: root, env });
  const worker = proposal.domains[0].id;
  const message = control.sendMessage({ sender: 'session-manager', recipient: worker, body: 'Survive forge migration.' });
  const agentsBefore = control.listAgents().map((agent) => agent.areaId);
  control.close();

  const planned = run(root, env, ['forge', 'plan', '--remote', 'origin', '--json']);
  assert.equal(planned.status, 0, planned.stderr || planned.stdout);
  assert.equal(JSON.parse(planned.stdout).previousCanonical.path, localCanonical.path);
  assert.equal(JSON.parse(run(root, env, ['forge', 'attach', '--remote', 'origin', '--json']).stdout).error, 'APPROVAL_REQUIRED');
  const attached = run(root, env, ['forge', 'attach', '--remote', 'origin', '--yes', '--json']);
  assert.equal(attached.status, 0, attached.stderr || attached.stdout);
  const attachedConfig = JSON.parse(readFileSync(join(root, '.torch', 'torch.yaml'), 'utf8'));
  assert.equal(attachedConfig.forge.provider, 'generic-git');
  assert.deepEqual(attachedConfig.repository.canonical, { type: 'remote', remote: 'origin' });
  assert.equal(JSON.parse(run(root, env, ['forge', 'status', '--json']).stdout).synchronized, true);

  renameSync(forgePath, offlinePath);
  const degraded = run(root, env, ['forge', 'status', '--json']);
  assert.equal(degraded.status, 1);
  assert.equal(JSON.parse(degraded.stdout).mode, 'forge-degraded');
  assert.equal(JSON.parse(degraded.stdout).localOperational, true);
  const diagnosis = run(root, env, ['doctor', '--json']);
  assert.equal(diagnosis.status, 0, diagnosis.stderr || diagnosis.stdout);
  assert.equal(JSON.parse(diagnosis.stdout).findings.some((finding) =>
    finding.code === 'FORGE_UNAVAILABLE' && finding.localOperational === true), true);

  const detachPlan = run(root, env, ['forge', 'detach', '--dry-run', '--json']);
  assert.equal(detachPlan.status, 0, detachPlan.stderr || detachPlan.stdout);
  const detached = run(root, env, ['forge', 'detach', '--yes', '--json']);
  assert.equal(detached.status, 0, detached.stderr || detached.stdout);
  const detachedConfig = JSON.parse(readFileSync(join(root, '.torch', 'torch.yaml'), 'utf8'));
  assert.equal(detachedConfig.forge.provider, 'none');
  assert.deepEqual(detachedConfig.repository.canonical, {
    type: 'local', remote: 'torch-canonical', path: localCanonical.path,
  });
  const manifestAfter = JSON.parse(readFileSync(join(root, '.torch', 'install-manifest.json'), 'utf8'));
  assert.deepEqual(manifestAfter.external.filter((entry) => entry.type === 'worktree'), worktreesBefore);
  const reopened = openControlPlane({ repositoryRoot: root, env });
  assert.deepEqual(reopened.listAgents().map((agent) => agent.areaId), agentsBefore);
  assert.equal(reopened.readMessages({ recipient: worker }).some((entry) => entry.id === message.id), true);
  reopened.close();
  renameSync(offlinePath, forgePath);
});
