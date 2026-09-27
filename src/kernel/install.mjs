import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { TorchError } from './errors.mjs';
import { fileHash, writeNewFile } from './files.mjs';
import { projectStatePath } from './paths.mjs';
import { validateApprovedProposal } from './domains.mjs';
import { inspectManagedWorktree } from './worktree-state.mjs';

const TRACKED_DIR = '.torch';

function jsonYaml(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function initialFiles({ repository, projectId, createdAt, proposal }) {
  const config = {
    schema: 'torch.dev/v1alpha1',
    project: {
      id: projectId,
      name: repository.name,
      main_branch: repository.branch || 'main',
    },
    paths: { tracked_state: TRACKED_DIR, worktree_parent: '~/TORCHWorktrees' },
    repository: repository.canonicalRemote
      ? { canonical: { type: 'remote', remote: repository.canonicalRemote.name } }
      : { canonical: { type: 'unconfigured' } },
    forge: { provider: 'none' },
    git: {
      branch_prefix: 'torch/', convergence: 'merge', allow_rebase: false,
      allow_force_push: false, allow_bare_stash: false,
    },
    synchronization: { strategy: 'dispatcher-managed', auto_merge_worktrees: false },
    runtimes: { default: 'claude', claude: { model: 'opus', background: true } },
    checks: proposal.checks ?? [],
    resources: proposal.resources ?? [],
    integration: {
      provider: 'torch', target: repository.branch || 'main', require_current_main: true,
      required_checks: (proposal.checks ?? []).map((check) => check.id),
      landing_authority: ['session-manager'],
    },
    session_manager: { id: 'session-manager', start_last: true },
    domains: proposal.domains.map((domain) => ({
      id: domain.id,
      title: domain.title,
      scope: domain.scope,
      not_scope: domain.not_scope,
      owned_paths: domain.owned_paths,
      shared_paths: domain.shared_paths ?? [],
      neighbours: domain.neighbours ?? [],
      required_checks: domain.required_checks ?? [],
    })),
  };
  const roster = {
    schema: 'torch.dev/roster/v1alpha1',
    areas: [{
      id: 'session-manager', title: 'TORCH Session Manager',
      scope: ['routing', 'priority', 'ownership rulings', 'fleet health'],
      not_scope: ['project feature implementation by default'],
      neighbours: ['all'],
    }, ...config.domains],
  };

  const files = new Map([
    ['torch.yaml', jsonYaml(config)],
    ['roster.yaml', jsonYaml(roster)],
    ['decisions.md', '# TORCH decisions\n\nNo project decisions recorded yet.\n'],
    ['RESUME-BRIEF.md', '# TORCH resume brief\n\nFleet not started yet.\n'],
    ['prompts/COMMON.md', '# Common fleet rules\n\nRepository state outranks conversation memory. Query ownership before crossing a domain boundary.\n'],
    ['prompts/session-manager.md', '# TORCH Session Manager\n\nRoute owner requests, establish ownership and priority, and keep routine coordination inside the fleet.\n'],
    ['backlog/.gitkeep', ''],
    ['INSTALLATION.md', `# TORCH installation\n\nInstalled ${createdAt}. Run \`torch doctor\` before starting the fleet.\n`],
  ]);
  for (const domain of config.domains) {
    files.set(`prompts/${domain.id}.md`, [
      `# ${domain.title}`,
      '',
      `Area ID: ${domain.id}`,
      '',
      '## Owns',
      '',
      ...domain.scope.map((item) => `- ${item}`),
      '',
      '## Does not own',
      '',
      ...(domain.not_scope.length ? domain.not_scope : ['No exclusions recorded.']).map((item) => `- ${item}`),
      '',
      '## Neighbours',
      '',
      ...(domain.neighbours.length ? domain.neighbours : ['None identified.']).map((item) => `- ${item}`),
      '',
      '## First move',
      '',
      'Query live ownership, read the assigned backlog item, and report current repository evidence to the Session Manager.',
      '',
    ].join('\n'));
  }
  files.set('domain-proposal.approved.json', jsonYaml(proposal));
  return files;
}

export function manifestPath(root) {
  return join(root, TRACKED_DIR, 'install-manifest.json');
}

export function readInstallManifest(root) {
  const path = manifestPath(root);
  if (!existsSync(path)) {
    throw new TorchError(`No TORCH ownership manifest at ${path}`, { code: 'NOT_INSTALLED' });
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new TorchError(`Invalid TORCH ownership manifest: ${path}`, {
      code: 'INVALID_INSTALL_MANIFEST', details: error.message,
    });
  }
}

export function writeInstallManifest(root, manifest) {
  const path = manifestPath(root);
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, jsonYaml(manifest), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  renameSync(temporary, path);
}

function safeProjectPath(root, relativePath) {
  const target = resolve(root, relativePath);
  const prefix = `${resolve(root)}${sep}`;
  if (!target.startsWith(prefix)) {
    throw new TorchError(`Manifest path escapes project root: ${relativePath}`, {
      code: 'UNSAFE_MANIFEST_PATH', details: { relativePath },
    });
  }
  return target;
}

export function planInstall({ repository, proposal, env = process.env }) {
  validateApprovedProposal({ proposal, repository });
  const trackedRoot = join(repository.root, TRACKED_DIR);
  return {
    action: 'install',
    projectRoot: repository.root,
    trackedRoot,
    stateParent: join(projectStatePath('<new-project-id>', env), '..'),
    wouldCreateTrackedState: !existsSync(trackedRoot),
    approvedDomainCount: proposal.domains.length,
    mutationPerformed: false,
  };
}

export function installProject({
  repository,
  proposal,
  env = process.env,
  projectId = randomUUID(),
  now = () => new Date(),
} = {}) {
  validateApprovedProposal({ proposal, repository });
  const trackedRoot = join(repository.root, TRACKED_DIR);
  if (existsSync(trackedRoot)) {
    throw new TorchError(`Refusing to replace existing ${trackedRoot}`, {
      code: 'ALREADY_INSTALLED', details: { trackedRoot },
    });
  }

  const createdAt = now().toISOString();
  const stateRoot = projectStatePath(projectId, env);
  if (existsSync(stateRoot)) {
    throw new TorchError(`Refusing to replace existing TORCH state: ${stateRoot}`, {
      code: 'STATE_ALREADY_EXISTS', details: { stateRoot },
    });
  }

  const created = [];
  try {
    for (const [path, content] of initialFiles({ repository, projectId, createdAt, proposal })) {
      const absolute = join(trackedRoot, path);
      const record = writeNewFile(absolute, content);
      created.push({ path: relative(repository.root, record.path), sha256: record.sha256 });
    }

    mkdirSync(dirname(stateRoot), { recursive: true });
    mkdirSync(stateRoot, { recursive: false });
    for (const dir of ['sessions', 'messages', 'locks', 'leases', 'checks', 'integration', 'logs']) {
      mkdirSync(join(stateRoot, dir));
    }
    writeFileSync(join(stateRoot, 'project.json'), jsonYaml({
      schema: 'torch.dev/local-project/v1alpha1', projectId,
      root: repository.root, createdAt, detachedAt: null,
    }), { encoding: 'utf8', mode: 0o600, flag: 'wx' });

    const manifest = {
      schema: 'torch.dev/install-manifest/v1alpha1',
      installationId: randomUUID(),
      projectId,
      createdAt,
      created,
      patched: [],
      external: [{ type: 'local-state', path: stateRoot }],
    };
    writeNewFile(manifestPath(repository.root), jsonYaml(manifest));
    return { projectId, trackedRoot, stateRoot, manifest, mutationPerformed: true };
  } catch (error) {
    if (existsSync(trackedRoot)) rmSync(trackedRoot, { recursive: true, force: true });
    if (existsSync(stateRoot)) rmSync(stateRoot, { recursive: true, force: true });
    throw error;
  }
}

function nonEmptyEntries(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== 'project.json')
    .map((entry) => entry.name);
}

export function planUninstall({ repository, purge = false }) {
  const manifest = readInstallManifest(repository.root);
  const problems = [];
  let mainBranch = repository.branch || 'main';
  try {
    const config = JSON.parse(readFileSync(join(repository.root, TRACKED_DIR, 'torch.yaml'), 'utf8'));
    mainBranch = config.project?.main_branch ?? mainBranch;
  } catch { /* created-file validation below reports the invalid config */ }
  const localState = (manifest.external ?? []).find((entry) => entry.type === 'local-state');
  if (localState && existsSync(join(localState.path, 'project.json'))) {
    try {
      const metadata = JSON.parse(readFileSync(join(localState.path, 'project.json'), 'utf8'));
      if (resolve(metadata.root) !== resolve(repository.root)) {
        problems.push({ type: 'not-installation-root', expected: metadata.root, actual: repository.root });
      }
    } catch {
      problems.push({ type: 'local-state-metadata-invalid', path: localState.path });
    }
  }
  for (const record of manifest.created) {
    const path = safeProjectPath(repository.root, record.path);
    if (!existsSync(path)) problems.push({ type: 'missing', path: record.path });
    else if (fileHash(path) !== record.sha256) problems.push({ type: 'modified', path: record.path });
  }
  for (const entry of manifest.external ?? []) {
    if (entry.type === 'local-state') {
      const extras = nonEmptyEntries(entry.path);
      if (extras.length) problems.push({ type: 'local-state-not-empty', path: entry.path, entries: extras });
    }
    if (entry.type === 'worktree') {
      const state = inspectManagedWorktree(repository.root, entry, mainBranch);
      if (!state.safeToRemove) problems.push({ type: 'unsafe-worktree', path: entry.path, area: entry.area, problems: state.problems });
    }
  }
  return {
    action: purge ? 'purge' : 'detach', manifest, problems,
    canProceed: !purge || problems.length === 0,
    mutationPerformed: false,
  };
}

export function uninstallProject({ repository, purge = false, dryRun = false }) {
  const plan = planUninstall({ repository, purge });
  if (dryRun || !purge) return plan;
  if (!plan.canProceed) {
    throw new TorchError('TORCH purge stopped because managed state changed', {
      code: 'UNSAFE_TO_PURGE', details: plan.problems,
    });
  }

  for (const entry of (plan.manifest.external ?? []).filter((item) => item.type === 'worktree').reverse()) {
    execFileSync('git', ['-C', repository.root, 'worktree', 'remove', entry.path], { stdio: 'ignore' });
    execFileSync('git', ['-C', repository.root, 'branch', '-d', entry.branch], { stdio: 'ignore' });
  }
  for (const patch of plan.manifest.patched ?? []) {
    if (patch.type !== 'git-info-exclude-line' || !existsSync(patch.path)) continue;
    const marker = `# TORCH ${patch.installationId}\n${patch.line}\n`;
    const content = readFileSync(patch.path, 'utf8');
    if (content.includes(marker)) writeFileSync(patch.path, content.replace(marker, ''), 'utf8');
  }

  for (const record of [...plan.manifest.created].reverse()) {
    rmSync(safeProjectPath(repository.root, record.path));
  }
  rmSync(manifestPath(repository.root));
  rmSync(join(repository.root, TRACKED_DIR), { recursive: true });
  for (const entry of plan.manifest.external ?? []) {
    if (entry.type === 'local-state' && existsSync(entry.path)) rmSync(entry.path, { recursive: true });
  }
  return { ...plan, mutationPerformed: true };
}
