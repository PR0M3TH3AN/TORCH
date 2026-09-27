import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { TorchError } from './errors.mjs';
import { readInstallManifest, writeInstallManifest } from './install.mjs';

function git(root, args, { optional = false } = {}) {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    if (optional) return '';
    throw new TorchError(`Git command failed: git ${args.join(' ')}`, {
      code: 'GIT_COMMAND_FAILED', details: error.stderr?.toString().trim() || undefined,
    });
  }
}

function parseJson(path, code) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch (error) {
    throw new TorchError(`Cannot read ${path}`, { code, details: error.message });
  }
}

export function loadFleetDefinition(root) {
  const config = parseJson(join(root, '.torch', 'torch.yaml'), 'CONFIG_INVALID');
  const roster = parseJson(join(root, '.torch', 'roster.yaml'), 'ROSTER_INVALID');
  return { config, roster };
}

function expandPath(value, root) {
  if (value === '~') return homedir();
  if (value.startsWith('~/')) return join(homedir(), value.slice(2));
  return isAbsolute(value) ? value : resolve(root, value);
}

function listedWorktrees(root) {
  const text = git(root, ['worktree', 'list', '--porcelain']);
  const records = [];
  let current = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('worktree ')) {
      current = { path: line.slice(9), branch: null, head: null };
      records.push(current);
    } else if (current && line.startsWith('branch refs/heads/')) current.branch = line.slice(18);
    else if (current && line.startsWith('HEAD ')) current.head = line.slice(5);
  }
  return records;
}

function branchExists(root, branch) {
  return Boolean(git(root, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { optional: true })
    || git(root, ['branch', '--list', branch], { optional: true }));
}

function validateAreaId(id) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    throw new TorchError(`Unsafe domain id for a worktree: ${id}`, { code: 'INVALID_DOMAIN_ID' });
  }
}

export function planWorktrees({ repository, parentOverride } = {}) {
  const { config, roster } = loadFleetDefinition(repository.root);
  const manifest = readInstallManifest(repository.root);
  const parent = expandPath(parentOverride ?? config.paths.worktree_parent, repository.root);
  const fleetRoot = join(parent, config.project.id);
  const prefix = config.git.branch_prefix ?? 'torch/';
  const worktrees = listedWorktrees(repository.root);
  const actions = [];
  const conflicts = [];

  for (const area of roster.areas) {
    validateAreaId(area.id);
    const path = join(fleetRoot, area.id);
    const branch = `${prefix}${area.id}`;
    const byPath = worktrees.find((entry) => resolve(entry.path) === resolve(path));
    const byBranch = worktrees.find((entry) => entry.branch === branch);
    if (byPath && byPath.branch === branch) {
      actions.push({ area: area.id, path, branch, action: 'keep' });
    } else if (byPath) {
      conflicts.push({ area: area.id, type: 'path-owned-by-other-branch', path, expected: branch, actual: byPath.branch });
    } else if (byBranch || branchExists(repository.root, branch)) {
      conflicts.push({ area: area.id, type: 'branch-already-exists', path, branch, currentPath: byBranch?.path ?? null });
    } else if (existsSync(path)) {
      conflicts.push({ area: area.id, type: 'path-already-exists', path, branch });
    } else {
      actions.push({ area: area.id, path, branch, action: 'create' });
    }
  }

  const mainBranch = config.project.main_branch;
  if (!branchExists(repository.root, mainBranch)) {
    conflicts.push({ type: 'main-branch-missing', branch: mainBranch });
  }
  if (repository.dirtyEntries.length && actions.some((action) => action.action === 'create')) {
    conflicts.push({ type: 'main-checkout-dirty', entries: repository.dirtyEntries });
  }

  return {
    projectId: manifest.projectId, parent, fleetRoot, mainBranch,
    actions, conflicts, canProceed: conflicts.length === 0, mutationPerformed: false,
  };
}

function ensureTaskIgnored(root, installationId) {
  const common = git(root, ['rev-parse', '--git-common-dir']);
  const commonPath = isAbsolute(common) ? common : resolve(root, common);
  const excludePath = join(commonPath, 'info', 'exclude');
  mkdirSync(dirname(excludePath), { recursive: true });
  const existing = existsSync(excludePath) ? readFileSync(excludePath, 'utf8') : '';
  if (existing.split(/\r?\n/).includes('.task')) return { path: excludePath, added: false };
  appendFileSync(excludePath, `${existing && !existing.endsWith('\n') ? '\n' : ''}# TORCH ${installationId}\n.task\n`, 'utf8');
  return { path: excludePath, added: true };
}

function removeTaskIgnore(record, installationId) {
  if (!record.added || !existsSync(record.path)) return;
  const marker = `# TORCH ${installationId}\n.task\n`;
  const content = readFileSync(record.path, 'utf8');
  if (content.includes(marker)) writeFileSync(record.path, content.replace(marker, ''), 'utf8');
}

export function createWorktrees({ repository, parentOverride } = {}) {
  const plan = planWorktrees({ repository, parentOverride });
  if (!plan.canProceed) {
    throw new TorchError('Worktree creation stopped because the plan has conflicts', {
      code: 'WORKTREE_CONFLICT', details: plan.conflicts,
    });
  }
  const manifest = readInstallManifest(repository.root);
  const ignore = ensureTaskIgnored(repository.root, manifest.installationId);
  mkdirSync(plan.fleetRoot, { recursive: true });
  const created = [];
  try {
    for (const action of plan.actions.filter((item) => item.action === 'create')) {
      git(repository.root, ['worktree', 'add', '-b', action.branch, action.path, plan.mainBranch]);
      writeFileSync(join(action.path, '.task'), `Unassigned · ${action.area}\n`, { encoding: 'utf8', flag: 'wx' });
      created.push(action);
    }
  } catch (error) {
    for (const action of [...created].reverse()) {
      git(repository.root, ['worktree', 'remove', action.path], { optional: true });
      git(repository.root, ['branch', '-d', action.branch], { optional: true });
    }
    removeTaskIgnore(ignore, manifest.installationId);
    throw error;
  }

  manifest.external = (manifest.external ?? []).filter((entry) => entry.type !== 'worktree');
  manifest.external.push(...plan.actions.map((action) => ({
    type: 'worktree', area: action.area, path: action.path, branch: action.branch,
  })));
  if (ignore.added) manifest.patched.push({
    type: 'git-info-exclude-line', path: ignore.path, line: '.task', installationId: manifest.installationId,
  });
  writeInstallManifest(repository.root, manifest);
  return { ...plan, created, mutationPerformed: created.length > 0 };
}
