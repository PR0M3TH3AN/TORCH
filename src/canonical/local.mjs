import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { TorchError } from '../kernel/errors.mjs';
import { fileHash } from '../kernel/files.mjs';
import { readInstallManifest, writeInstallManifest } from '../kernel/install.mjs';
import { loadProjectConfig } from '../kernel/config.mjs';

const REMOTE_NAME = 'torch-canonical';

function git(root, args, { allowFailure = false } = {}) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  if (result.status !== 0 && !allowFailure) {
    throw new TorchError(`Git command failed: git ${args.join(' ')}`, {
      code: 'GIT_COMMAND_FAILED', details: result.stderr?.trim() || null,
    });
  }
  return { status: result.status, stdout: result.stdout?.trim() ?? '', stderr: result.stderr?.trim() ?? '' };
}

function localStateRoot(manifest) {
  const record = (manifest.external ?? []).find((entry) => entry.type === 'local-state');
  if (!record?.path) throw new TorchError('Installation has no local state root', { code: 'LOCAL_STATE_MISSING' });
  return record.path;
}

function safeCanonicalPath(stateRoot) {
  const path = resolve(stateRoot, 'remote.git');
  if (!path.startsWith(`${resolve(stateRoot)}${sep}`)) {
    throw new TorchError('Canonical repository path escapes local project state', { code: 'UNSAFE_CANONICAL_PATH' });
  }
  return path;
}

function writeConfig(repositoryRoot, manifest, path) {
  const configPath = join(repositoryRoot, '.torch', 'torch.yaml');
  const config = loadProjectConfig(repositoryRoot);
  config.repository = { canonical: { type: 'local', remote: REMOTE_NAME, path } };
  const temporary = `${configPath}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, configPath);
  const record = manifest.created.find((entry) => entry.path === '.torch/torch.yaml');
  if (record) record.sha256 = fileHash(configPath);
  writeInstallManifest(repositoryRoot, manifest);
}

export function planLocalCanonical({ repositoryRoot } = {}) {
  const manifest = readInstallManifest(repositoryRoot);
  const stateRoot = localStateRoot(manifest);
  const path = safeCanonicalPath(stateRoot);
  const remotes = git(repositoryRoot, ['remote']).stdout.split('\n').filter(Boolean);
  const dirtyEntries = git(repositoryRoot, ['status', '--porcelain']).stdout.split('\n').filter(Boolean);
  const blockers = [];
  if (existsSync(path)) blockers.push({ code: 'CANONICAL_PATH_EXISTS', path });
  if (remotes.includes(REMOTE_NAME)) blockers.push({ code: 'CANONICAL_REMOTE_EXISTS', remote: REMOTE_NAME });
  if (dirtyEntries.length) blockers.push({ code: 'WORKTREE_DIRTY', entries: dirtyEntries });
  return {
    action: 'create-local-canonical', projectId: manifest.projectId, stateRoot, path,
    remote: REMOTE_NAME,
    mainBranch: loadProjectConfig(repositoryRoot).project.main_branch,
    blockers, canProceed: blockers.length === 0, mutationPerformed: false,
  };
}

export function createLocalCanonical({ repositoryRoot } = {}) {
  const plan = planLocalCanonical({ repositoryRoot });
  if (!plan.canProceed) {
    throw new TorchError('Local canonical Git creation is blocked', {
      code: 'CANONICAL_CREATION_BLOCKED', details: plan.blockers,
    });
  }
  const manifest = readInstallManifest(repositoryRoot);
  const originalManifest = structuredClone(manifest);
  const configPath = join(repositoryRoot, '.torch', 'torch.yaml');
  const originalConfig = readFileSync(configPath, 'utf8');
  mkdirSync(dirname(plan.path), { recursive: true });
  let remoteAdded = false;
  try {
    const initialized = spawnSync('git', ['init', '--bare', plan.path], { encoding: 'utf8' });
    if (initialized.status !== 0) throw new Error(initialized.stderr || 'git init --bare failed');
    git(repositoryRoot, ['remote', 'add', plan.remote, plan.path]);
    remoteAdded = true;
    git(repositoryRoot, ['push', '--set-upstream', plan.remote, plan.mainBranch]);
    writeConfig(repositoryRoot, manifest, plan.path);
    return {
      ...plan, mutationPerformed: true, requiresCommit: ['.torch/torch.yaml', '.torch/install-manifest.json'],
      recoverability: classifyRecoverability({ repositoryRoot, commit: 'HEAD' }),
    };
  } catch (error) {
    if (remoteAdded) git(repositoryRoot, ['remote', 'remove', plan.remote], { allowFailure: true });
    if (existsSync(plan.path)) rmSync(plan.path, { recursive: true, force: true });
    writeFileSync(configPath, originalConfig, { encoding: 'utf8', mode: 0o600 });
    writeInstallManifest(repositoryRoot, originalManifest);
    throw new TorchError('Failed to create local canonical Git repository', {
      code: 'CANONICAL_CREATION_FAILED', details: error.message,
    });
  }
}

function isLocalRemote(url) {
  return url.startsWith('/') || url.startsWith('./') || url.startsWith('../') || url.startsWith('file://');
}

export function classifyRecoverability({ repositoryRoot, commit = 'HEAD' } = {}) {
  const sha = git(repositoryRoot, ['rev-parse', commit]).stdout;
  const remotes = git(repositoryRoot, ['remote']).stdout.split('\n').filter(Boolean);
  let localRemote = false;
  let offMachine = false;
  for (const remote of remotes) {
    const url = git(repositoryRoot, ['remote', 'get-url', remote]).stdout;
    const contains = git(repositoryRoot, [
      'for-each-ref', '--format=%(refname)', '--contains', sha, `refs/remotes/${remote}`,
    ], { allowFailure: true }).stdout;
    if (!contains) continue;
    if (isLocalRemote(url)) localRemote = true;
    else offMachine = true;
  }
  return {
    commit: sha,
    level: offMachine ? 'OFF-MACHINE' : (localRemote ? 'LOCAL-REMOTE' : 'ONE-DISK'),
    localRemote, offMachine,
  };
}
