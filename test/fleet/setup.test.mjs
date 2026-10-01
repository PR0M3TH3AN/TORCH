import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { analyzeRepository } from '../../src/kernel/analyze.mjs';
import { proposeDomains } from '../../src/kernel/domains.mjs';
import { inspectRepository } from '../../src/kernel/git.mjs';
import { installProject, readInstallManifest } from '../../src/kernel/install.mjs';
import { resolveInstalledProjectRoot } from '../../src/kernel/project-root.mjs';
import { setupProject, restoreProject } from '../../src/kernel/setup.mjs';
import { openControlPlane } from '../../src/control-plane/service.mjs';
import { createFleetBrief, detachFleet, planFleetDetach } from '../../src/runtime/lifecycle.mjs';

const git = (root, args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'torch-setup-'));
  const env = { ...process.env, XDG_DATA_HOME: join(root, 'external-state') };
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.name', 'Setup Test']);
  git(root, ['config', 'user.email', 'test@example.invalid']);
  writeFileSync(join(root, '.gitignore'), 'external-state/\nworktrees/\n');
  writeFileSync(join(root, 'app.js'), 'export const app = true;\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'fixture']);
  const repository = inspectRepository(root);
  const proposal = proposeDomains({ repository, analysis: analyzeRepository(repository) });
  proposal.review = { status: 'approved', reviewedAt: '2026-09-30T00:00:00Z', reviewedBy: 'owner', notes: [] };
  installProject({ repository, proposal, env });
  return { root, env, parentOverride: join(root, 'worktrees') };
}

test('SCN-guided-setup: approved setup checkpoints owned files and provisions without agents', () => {
  const f = fixture();
  const before = git(f.root, ['rev-parse', 'HEAD']);
  assert.equal(setupProject({ ...f, repository: inspectRepository(f.root), dryRun: true }).canProceed, true);
  assert.equal(git(f.root, ['rev-parse', 'HEAD']), before);
  assert.throws(() => setupProject({ ...f, repository: inspectRepository(f.root) }), { code: 'APPROVAL_REQUIRED' });
  writeFileSync(join(f.root, 'app.js'), 'export const app = false;\n');
  git(f.root, ['add', 'app.js']);
  assert.throws(() => setupProject({ ...f, repository: inspectRepository(f.root), authorized: true }), { code: 'SETUP_STAGED_WORK' });
  assert.equal(git(f.root, ['diff', '--cached', '--name-only']), 'app.js');
  git(f.root, ['restore', '--staged', 'app.js']);
  writeFileSync(join(f.root, 'app.js'), 'export const app = true;\n');
  const result = setupProject({ ...f, repository: inspectRepository(f.root), authorized: true });
  assert.equal(result.sessionsStarted, false);
  assert.ok(result.configurationCommit);
  assert.ok(result.registrationCommit);
  assert.equal(git(f.root, ['status', '--porcelain']), '');
  assert.ok(git(f.root, ['diff', '--name-only', before, 'HEAD']).split('\n').every(path => path.startsWith('.torch/')));
  assert.ok(readInstallManifest(f.root).external.some(entry => entry.type === 'worktree'));
  assert.equal(setupProject({ ...f, repository: inspectRepository(f.root), authorized: true }).mutationPerformed, false);
});

test('SCN-worktree-canonical-brief: current instructions win and unregistered or copied worktrees fail closed', () => {
  const f = fixture();
  setupProject({ ...f, repository: inspectRepository(f.root), authorized: true });
  const entry = readInstallManifest(f.root).external.find(item => item.type === 'worktree');
  const marker = 'Current canonical instructions, not the old worktree copy.';
  writeFileSync(join(f.root, '.torch/prompts/COMMON.md'), marker);
  const canonical = resolveInstalledProjectRoot(entry.path, f.env);
  assert.equal(canonical, f.root);
  const control = openControlPlane({ repositoryRoot: canonical, env: f.env });
  try {
    const brief = createFleetBrief({ repositoryRoot: canonical, controlPlane: control, areaId: entry.area });
    assert.ok(brief.areas[0].prompt.includes(marker));
  } finally { control.close(); }
  const stray = join(f.root, 'worktrees', 'stray');
  git(f.root, ['worktree', 'add', '-b', 'stray', stray]);
  assert.throws(() => resolveInstalledProjectRoot(stray, f.env), { code: 'UNREGISTERED_PROJECT_WORKTREE' });
  const copied = mkdtempSync(join(tmpdir(), 'torch-copy-'));
  cpSync(join(entry.path, '.torch'), join(copied, '.torch'), { recursive: true });
  git(copied, ['init', '-b', entry.branch]);
  assert.throws(() => resolveInstalledProjectRoot(copied, f.env), { code: 'UNREGISTERED_PROJECT_WORKTREE' });
  const localManifest = JSON.parse(readFileSync(join(entry.path, '.torch/install-manifest.json')));
  localManifest.installationId = 'stale-installation';
  writeFileSync(join(entry.path, '.torch/install-manifest.json'), JSON.stringify(localManifest));
  assert.throws(() => resolveInstalledProjectRoot(entry.path, f.env), { code: 'UNREGISTERED_PROJECT_WORKTREE' });
});

test('SCN-install-restore: detach and explicit restore preserve configuration and worktree history without starting sessions', () => {
  const f = fixture();
  setupProject({ ...f, repository: inspectRepository(f.root), authorized: true });
  const manifest = readInstallManifest(f.root);
  const metadataPath = join(manifest.external.find(entry => entry.type === 'local-state').path, 'project.json');
  const config = readFileSync(join(f.root, '.torch/torch.yaml'), 'utf8');
  const heads = manifest.external.filter(entry => entry.type === 'worktree').map(entry => git(entry.path, ['rev-parse', 'HEAD']));
  const control = openControlPlane({ repositoryRoot: f.root, env: f.env });
  try {
    detachFleet({ plan: planFleetDetach({ repositoryRoot: f.root, controlPlane: control, adapters: {} }), controlPlane: control, stopRuntime: () => { throw new Error('Offline setup must not call a provider'); } });
  } finally { control.close(); }
  const before = readFileSync(metadataPath, 'utf8');
  assert.equal(restoreProject({ repository: inspectRepository(f.root), env: f.env, dryRun: true }).wasDetached, true);
  assert.equal(readFileSync(metadataPath, 'utf8'), before);
  assert.throws(() => restoreProject({ repository: inspectRepository(f.root), env: f.env }), { code: 'APPROVAL_REQUIRED' });
  assert.equal(restoreProject({ repository: inspectRepository(f.root), env: f.env, authorized: true }).sessionsStarted, false);
  assert.equal(JSON.parse(readFileSync(metadataPath)).detachedAt, null);
  assert.equal(readFileSync(join(f.root, '.torch/torch.yaml'), 'utf8'), config);
  assert.deepEqual(manifest.external.filter(entry => entry.type === 'worktree').map(entry => git(entry.path, ['rev-parse', 'HEAD'])), heads);
});
