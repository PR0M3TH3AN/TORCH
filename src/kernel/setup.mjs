import { execFileSync } from 'node:child_process';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inspectRepository } from './git.mjs';
import { readInstallManifest } from './install.mjs';
import { projectStatePath } from './paths.mjs';
import { resolveInstalledProjectRoot } from './project-root.mjs';
import { createWorktrees, planWorktrees } from './worktrees.mjs';
import { TorchError } from './errors.mjs';

const git = (root, args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

export function setupProject({ repository, env = process.env, authorized = false, dryRun = false, parentOverride }) {
  const root = resolveInstalledProjectRoot(repository.root, env);
  repository = inspectRepository(root);
  const manifest = readInstallManifest(root);
  const owned = [...new Set([...manifest.created.map(record => record.path), '.torch/install-manifest.json'])];
  const changed = owned.filter(path => git(root, ['status', '--porcelain=v1', '--', path]));
  const staged = git(root, ['diff', '--cached', '--name-only']);
  if (staged) throw new TorchError('Setup requires an empty staging area; preserve and finish your existing staged work first', { code: 'SETUP_STAGED_WORK', details: staged });
  const unrelated = repository.dirtyEntries.filter(entry => !owned.includes(entry.slice(3)));
  const worktrees = planWorktrees({ repository: { ...repository, dirtyEntries: unrelated }, parentOverride });
  const plan = { action: 'setup', projectId: manifest.projectId, checkpointPaths: changed, worktrees, canProceed: worktrees.canProceed, sessionsStarted: false, mutationPerformed: false };
  if (dryRun) return plan;
  if (!authorized) throw new TorchError('Setup commits TORCH-owned configuration and provisions worktrees; review --dry-run then use --yes', { code: 'APPROVAL_REQUIRED' });
  if (!plan.canProceed) throw new TorchError('Setup has blockers', { code: 'SETUP_BLOCKED', details: worktrees.conflicts });
  const checkpoint = (paths, message) => {
    const pending = paths.filter(path => git(root, ['status', '--porcelain=v1', '--', path]));
    if (!pending.length) return null;
    git(root, ['add', '--', ...pending]);
    git(root, ['commit', '--only', '-m', message, '--', ...pending]);
    return git(root, ['rev-parse', 'HEAD']);
  };
  const configurationCommit = checkpoint(changed, 'Checkpoint approved TORCH configuration');
  const provisioned = createWorktrees({ repository: inspectRepository(root), parentOverride });
  const registrationCommit = checkpoint(['.torch/install-manifest.json'], 'Checkpoint TORCH worktree registration');
  return { ...plan, configurationCommit, registrationCommit, provisioned, mutationPerformed: Boolean(configurationCommit || registrationCommit || provisioned.mutationPerformed) };
}

export function restoreProject({ repository, env = process.env, authorized = false, dryRun = false }) {
  const root = resolveInstalledProjectRoot(repository.root, env);
  const manifest = readInstallManifest(root);
  const path = join(projectStatePath(manifest.projectId, env), 'project.json');
  const metadata = JSON.parse(readFileSync(path, 'utf8'));
  const result = { action: 'restore-installation', projectId: manifest.projectId, installationId: manifest.installationId, wasDetached: Boolean(metadata.detachedAt), preserved: ['configuration', 'worktrees', 'branches', 'session history', 'provider profiles'], sessionsStarted: false, mutationPerformed: false };
  if (dryRun) return result;
  if (!authorized) throw new TorchError('Restoring a retained installation requires --yes', { code: 'APPROVAL_REQUIRED' });
  if (metadata.detachedAt) {
    const temporary = `${path}.restore-${process.pid}`;
    writeFileSync(temporary, `${JSON.stringify({ ...metadata, detachedAt: null, attachedAt: new Date().toISOString() }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    renameSync(temporary, path);
    result.mutationPerformed = true;
  }
  return result;
}
