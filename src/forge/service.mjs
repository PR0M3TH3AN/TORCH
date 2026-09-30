import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TorchError } from '../kernel/errors.mjs';
import { fileHash } from '../kernel/files.mjs';
import { loadProjectConfig } from '../kernel/config.mjs';
import { readInstallManifest, writeInstallManifest } from '../kernel/install.mjs';

function text(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TorchError(`${name} must be a non-empty string`, {
      code: 'FORGE_INPUT_INVALID', details: { field: name },
    });
  }
  return value.trim();
}

function git(root, args, { timeout = 5_000 } = {}) {
  const result = spawnSync('git', ['-C', root, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout,
  });
  return {
    status: result.status ?? 1, stdout: result.stdout?.trim() ?? '', stderr: result.stderr?.trim() ?? '',
    error: result.error?.message ?? null,
  };
}

function configPaths(repositoryRoot) {
  return {
    config: join(repositoryRoot, '.torch', 'torch.yaml'),
    manifest: join(repositoryRoot, '.torch', 'install-manifest.json'),
  };
}

function configurationOwned(repositoryRoot, manifest) {
  const record = manifest.created.find((entry) => entry.path === '.torch/torch.yaml');
  return Boolean(record && fileHash(configPaths(repositoryRoot).config) === record.sha256);
}

function remoteHead(repositoryRoot, remote, branch) {
  const result = git(repositoryRoot, ['ls-remote', '--heads', remote, `refs/heads/${branch}`]);
  if (result.status !== 0) return { available: false, commit: null, error: result.error ?? result.stderr };
  const commit = result.stdout.split(/\s+/)[0] || null;
  return { available: true, commit, error: null };
}

function writeConfiguration(repositoryRoot, config, manifest) {
  const paths = configPaths(repositoryRoot);
  const temporary = `${paths.config}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: 'utf8', mode: 0o600, flag: 'wx',
  });
  renameSync(temporary, paths.config);
  const record = manifest.created.find((entry) => entry.path === '.torch/torch.yaml');
  if (!record) throw new TorchError('Installation manifest does not own project configuration', { code: 'MANIFEST_INVALID' });
  record.sha256 = fileHash(paths.config);
  writeInstallManifest(repositoryRoot, manifest);
}

export function forgeStatus({ repositoryRoot } = {}) {
  const config = loadProjectConfig(repositoryRoot);
  const provider = config.forge?.provider ?? 'none';
  if (provider === 'none') {
    return {
      mode: 'local-only', provider: 'none', remote: null, available: null,
      synchronized: null, pendingSynchronization: false, localOperational: true,
      mutationPerformed: false,
    };
  }
  const remote = config.forge.remote;
  const localCommit = git(repositoryRoot, ['rev-parse', config.project.main_branch]).stdout;
  const observed = remoteHead(repositoryRoot, remote, config.project.main_branch);
  return {
    mode: observed.available ? 'forge-backed' : 'forge-degraded', provider, remote,
    available: observed.available, localCommit, remoteCommit: observed.commit,
    synchronized: observed.available && observed.commit === localCommit,
    pendingSynchronization: !observed.available || observed.commit !== localCommit,
    error: observed.error, localOperational: true, mutationPerformed: false,
  };
}

export function planForgeSync({ repositoryRoot } = {}) {
  const config = loadProjectConfig(repositoryRoot);
  const remote = config.forge?.remote ?? null;
  const branch = config.project.main_branch;
  const localCommit = git(repositoryRoot, ['rev-parse', `refs/heads/${branch}`]).stdout;
  const remotes = git(repositoryRoot, ['remote']).stdout.split('\n').filter(Boolean);
  const blockers = [];
  if (config.forge?.provider === 'none' || !remote) {
    blockers.push({ code: 'FORGE_NOT_ATTACHED' });
  }
  if (config.repository.canonical.type !== 'remote'
    || config.repository.canonical.remote !== remote) {
    blockers.push({ code: 'FORGE_CANONICAL_CHANGED', canonical: config.repository.canonical });
  }
  if (remote && !remotes.includes(remote)) blockers.push({ code: 'FORGE_REMOTE_MISSING', remote });
  const branchCheck = git(repositoryRoot, ['check-ref-format', '--branch', branch]);
  if (branchCheck.status !== 0) blockers.push({ code: 'FORGE_TARGET_BRANCH_INVALID', branch });
  const observed = remote && remotes.includes(remote)
    ? remoteHead(repositoryRoot, remote, branch)
    : { available: false, commit: null, error: 'configured remote is unavailable' };
  if (!observed.available) blockers.push({ code: 'FORGE_UNAVAILABLE', remote, error: observed.error });

  let disposition = 'blocked';
  if (blockers.length === 0) {
    if (observed.commit === localCommit) disposition = 'already-synchronized';
    else if (!observed.commit) disposition = 'publish-new-branch';
    else if (git(repositoryRoot, ['cat-file', '-e', `${observed.commit}^{commit}`], { timeout: 5_000 }).status !== 0) {
      blockers.push({ code: 'FORGE_SYNC_FETCH_REQUIRED', remoteCommit: observed.commit,
        message: `Fetch ${remote}/${branch} before syncing so TORCH can verify ancestry.` });
    } else if (git(repositoryRoot, [
      'merge-base', '--is-ancestor', localCommit, observed.commit,
    ], { timeout: 5_000 }).status === 0) {
      blockers.push({ code: 'FORGE_REMOTE_AHEAD', localCommit, remoteCommit: observed.commit });
    } else if (git(repositoryRoot, [
      'merge-base', '--is-ancestor', observed.commit, localCommit,
    ], { timeout: 5_000 }).status === 0) disposition = 'fast-forward-remote';
    else blockers.push({ code: 'FORGE_REMOTE_DIVERGED', localCommit, remoteCommit: observed.commit });
  }
  return {
    action: 'sync-forge-canonical-branch', remote, branch, localCommit,
    remoteCommit: observed.commit, disposition, requiresConfirmation: disposition !== 'already-synchronized',
    blockers, canProceed: blockers.length === 0, mutationPerformed: false,
  };
}

export function syncForgeRemote({ repositoryRoot, controlPlane, actorId = 'owner' } = {}) {
  if (!controlPlane) throw new TorchError('Forge synchronization requires the project control plane for owner audit', {
    code: 'FORGE_AUDIT_REQUIRED',
  });
  controlPlane.assertOwnerActor(actorId);
  const plan = planForgeSync({ repositoryRoot });
  if (!plan.canProceed) throw new TorchError('Forge synchronization is blocked', {
    code: 'FORGE_SYNC_BLOCKED', details: plan.blockers,
  });
  if (plan.disposition === 'already-synchronized') {
    return { ...plan, synchronized: true, publishedCommit: null, mutationPerformed: false };
  }
  const result = git(repositoryRoot, [
    'push', '--porcelain', '--', plan.remote, `${plan.localCommit}:refs/heads/${plan.branch}`,
  ], { timeout: 60_000 });
  if (result.status !== 0) throw new TorchError('Forge rejected canonical synchronization; no force push was attempted', {
    code: 'FORGE_SYNC_PUSH_REJECTED', details: { remote: plan.remote, branch: plan.branch, stderr: result.stderr },
  });
  const observed = remoteHead(repositoryRoot, plan.remote, plan.branch);
  const synchronized = observed.available && observed.commit === plan.localCommit;
  controlPlane.auditOwnerAction({
    actorId, operation: 'forge.sync', entityType: 'forge-publication', entityId: plan.localCommit,
    details: {
      remote: plan.remote, branch: plan.branch, previousRemoteCommit: plan.remoteCommit,
      publishedCommit: plan.localCommit, observedRemoteCommit: observed.commit,
      synchronized,
    },
  });
  return {
    ...plan, synchronized, publishedCommit: plan.localCommit,
    observedRemoteCommit: observed.commit, mutationPerformed: true,
    output: result.stdout, pendingSynchronization: !synchronized,
  };
}

export function planForgeAttach({ repositoryRoot, remote, provider = 'generic-git' } = {}) {
  const selectedRemote = text(remote, 'remote');
  const selectedProvider = text(provider, 'provider');
  if (selectedProvider === 'none') throw new TorchError('Forge provider cannot be none during attach', { code: 'FORGE_INPUT_INVALID' });
  const config = loadProjectConfig(repositoryRoot);
  const manifest = readInstallManifest(repositoryRoot);
  const blockers = [];
  const remotes = git(repositoryRoot, ['remote']).stdout.split('\n').filter(Boolean);
  if (!remotes.includes(selectedRemote)) blockers.push({ code: 'FORGE_REMOTE_MISSING', remote: selectedRemote });
  if (config.forge.provider !== 'none') blockers.push({ code: 'FORGE_ALREADY_ATTACHED', provider: config.forge.provider });
  if (!configurationOwned(repositoryRoot, manifest)) blockers.push({ code: 'FORGE_CONFIGURATION_MODIFIED' });
  const localCommit = git(repositoryRoot, ['rev-parse', config.project.main_branch]).stdout;
  const observed = remotes.includes(selectedRemote)
    ? remoteHead(repositoryRoot, selectedRemote, config.project.main_branch)
    : { available: false, commit: null, error: 'remote missing' };
  if (!observed.available) blockers.push({ code: 'FORGE_UNAVAILABLE', remote: selectedRemote, error: observed.error });
  else if (!observed.commit) blockers.push({ code: 'FORGE_BRANCH_MISSING', remote: selectedRemote, branch: config.project.main_branch });
  else if (observed.commit !== localCommit) blockers.push({
    code: 'FORGE_REF_MISMATCH', remote: selectedRemote, branch: config.project.main_branch,
    localCommit, remoteCommit: observed.commit,
  });
  return {
    action: 'forge-attach', provider: selectedProvider, remote: selectedRemote,
    branch: config.project.main_branch, localCommit, remoteCommit: observed.commit,
    previousCanonical: config.repository.canonical,
    blockers, canProceed: blockers.length === 0, mutationPerformed: false,
  };
}

export function attachForge(input = {}) {
  const plan = planForgeAttach(input);
  if (!plan.canProceed) throw new TorchError('Forge attach is blocked', { code: 'FORGE_ATTACH_BLOCKED', details: plan.blockers });
  const config = loadProjectConfig(input.repositoryRoot);
  const manifest = readInstallManifest(input.repositoryRoot);
  const attachedAt = new Date().toISOString();
  config.forge = {
    provider: plan.provider, remote: plan.remote, attached_at: attachedAt,
    previous_canonical: plan.previousCanonical,
  };
  config.repository.canonical = { type: 'remote', remote: plan.remote };
  writeConfiguration(input.repositoryRoot, config, manifest);
  return { ...plan, attachedAt, mutationPerformed: true };
}

export function planForgeDetach({ repositoryRoot } = {}) {
  const config = loadProjectConfig(repositoryRoot);
  const manifest = readInstallManifest(repositoryRoot);
  const blockers = [];
  if (config.forge.provider === 'none') blockers.push({ code: 'FORGE_NOT_ATTACHED' });
  if (!configurationOwned(repositoryRoot, manifest)) blockers.push({ code: 'FORGE_CONFIGURATION_MODIFIED' });
  if (config.repository.canonical.type !== 'remote'
    || config.repository.canonical.remote !== config.forge.remote) {
    blockers.push({ code: 'FORGE_CANONICAL_CHANGED', canonical: config.repository.canonical });
  }
  const restoreCanonical = config.forge.previous_canonical ?? { type: 'unconfigured' };
  return {
    action: 'forge-detach', provider: config.forge.provider, remote: config.forge.remote ?? null,
    restoreCanonical, blockers, canProceed: blockers.length === 0, mutationPerformed: false,
  };
}

export function detachForge({ repositoryRoot } = {}) {
  const plan = planForgeDetach({ repositoryRoot });
  if (!plan.canProceed) throw new TorchError('Forge detach is blocked', { code: 'FORGE_DETACH_BLOCKED', details: plan.blockers });
  const config = loadProjectConfig(repositoryRoot);
  const manifest = readInstallManifest(repositoryRoot);
  const detachedAt = new Date().toISOString();
  config.repository.canonical = plan.restoreCanonical;
  config.forge = {
    provider: 'none', last_provider: plan.provider, last_remote: plan.remote,
    detached_at: detachedAt,
  };
  writeConfiguration(repositoryRoot, config, manifest);
  return {
    ...plan, detachedAt, localOperational: true,
    preserved: ['identities', 'worktrees', 'backlog', 'decisions', 'messages', 'local state'],
    mutationPerformed: true,
  };
}
