import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import {
  existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { TorchError } from './errors.mjs';
import { fileHash, writeNewFile } from './files.mjs';
import { projectStatePath } from './paths.mjs';
import { validateApprovedProposal } from './domains.mjs';
import { inspectManagedWorktree } from './worktree-state.mjs';
import { renderDomainPrompt } from './prompts.mjs';

const TRACKED_DIR = '.torch';

function jsonYaml(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

const RUNTIME_DEFINITIONS = Object.freeze({
  claude: { model: 'opus', background: true },
  codex: { sandbox: 'workspace-write', approval: 'approve-for-me' },
});

function resolveInstallRuntimes(proposal, requested) {
  const selected = requested === undefined
    ? Object.keys(RUNTIME_DEFINITIONS)
    : [...new Set(requested)];
  if (!selected.length || selected.some((runtime) => typeof runtime !== 'string' || !RUNTIME_DEFINITIONS[runtime])) {
    throw new TorchError('Install runtimes must be one or more supported adapters', {
      code: 'INSTALL_RUNTIME_INVALID', details: { requested: selected, supported: Object.keys(RUNTIME_DEFINITIONS) },
    });
  }
  const required = new Set([
    proposal.session_manager?.runtime ?? 'claude',
    ...proposal.domains.map((domain) => domain.runtime ?? 'claude'),
  ]);
  const missing = [...required].filter((runtime) => !selected.includes(runtime));
  if (missing.length) {
    throw new TorchError('Selected install runtimes do not cover the approved Fleet', {
      code: 'INSTALL_RUNTIME_MISSING', details: { selected, required: [...required], missing },
    });
  }
  return selected;
}

function initialFiles({ repository, projectId, createdAt, proposal, runtimes }) {
  const promptContent = (source, fallback) => source
    ? readFileSync(safeProjectPath(repository.root, source), 'utf8')
    : fallback;
  const config = {
    schema: 'torch.dev/v1alpha1',
    project: {
      id: projectId,
      name: repository.name,
      main_branch: repository.branch || 'main',
    },
    paths: {
      tracked_state: TRACKED_DIR,
      worktree_parent: proposal.paths?.worktree_parent ?? '~/TORCHWorktrees',
    },
    repository: repository.canonicalRemote
      ? { canonical: { type: 'remote', remote: repository.canonicalRemote.name } }
      : { canonical: { type: 'unconfigured' } },
    forge: { provider: 'none' },
    git: {
      branch_prefix: 'torch/', convergence: 'merge', allow_rebase: false,
      allow_force_push: false, allow_bare_stash: false,
    },
    synchronization: { strategy: 'dispatcher-managed', auto_merge_worktrees: false },
    runtimes: Object.fromEntries([
      ['default', proposal.session_manager?.runtime ?? 'claude'],
      ...runtimes.map((runtime) => [runtime, RUNTIME_DEFINITIONS[runtime]]),
    ]),
    checks: proposal.checks ?? [],
    resources: proposal.resources ?? [],
    schedules: proposal.schedules ?? [],
    integration: {
      provider: 'torch', target: repository.branch || 'main', require_current_main: true,
      required_checks: (proposal.checks ?? []).map((check) => check.id),
      landing_authority: ['session-manager'],
    },
    delivery: {
      authority: {
        implemented: ['$source'],
        verified: ['$source', 'session-manager'],
        integrated: ['session-manager'],
        release_ready: ['session-manager'],
        released: ['owner'],
        deployed: ['owner'],
        live_verified: ['owner'],
      },
      adapters: {
        release: { provider: 'none' },
        deployment: { provider: 'none' },
      },
    },
    session_manager: {
      id: 'session-manager', runtime: proposal.session_manager?.runtime ?? 'claude', start_last: true,
      branch: proposal.session_manager?.branch ?? null,
      worktree_name: proposal.session_manager?.worktree_name ?? null,
    },
    domains: proposal.domains.map((domain) => ({
      id: domain.id,
      title: domain.title,
      scope: domain.scope,
      not_scope: domain.not_scope,
      owned_paths: domain.owned_paths,
      shared_paths: domain.shared_paths ?? [],
      neighbours: domain.neighbours ?? [],
      required_checks: domain.required_checks ?? [],
      resources: domain.resources ?? [],
      runtime: domain.runtime ?? 'claude',
      model: domain.model ?? null,
      branch: domain.branch ?? null,
      worktree_name: domain.worktree_name ?? null,
    })),
  };
  const roster = {
    schema: 'torch.dev/roster/v1alpha1',
    areas: [{
      id: 'session-manager', title: 'TORCH Session Manager',
      scope: ['routing', 'priority', 'ownership rulings', 'fleet health'],
      not_scope: ['project feature implementation by default'],
      neighbours: ['all'],
      runtime: config.session_manager.runtime,
      branch: config.session_manager.branch,
      worktree_name: config.session_manager.worktree_name,
    }, ...config.domains],
  };

  const managerPrompt = `${promptContent(
    proposal.session_manager?.prompt_source,
    '# TORCH Session Manager\n\nRoute owner requests, establish ownership and priority, and keep routine coordination inside the fleet.\n',
  ).trimEnd()}\n\n## Fleet evolution\n\nAt startup, after backlog intake, and when repeated handoffs or cross-domain work appear, call \`torch_assess_fleet_evolution\`. Treat its threshold as a prompt for architectural judgment, not as an automatic decision. When recurring work has no coherent owner, or a durable specialist would materially improve context locality, ownership clarity, or verification, inspect repository evidence and use \`torch_propose_domain\` to submit an evidence-backed Fleet change. When a specialist no longer earns its coordination cost, use \`torch_propose_domain_retirement\`; retirement preserves its branch and refuses active or unrecoverable work. Use \`torch_list_fleet_changes\` to follow change state. Never create, retire, approve, activate, or start a persistent identity yourself; owner approval, CLI activation, and quota-consuming runtime start are separate. Recommend a merge or split for owner review when boundaries should change but do not silently rewrite ownership.\n`;
  const files = new Map([
    ['torch.yaml', jsonYaml(config)],
    ['roster.yaml', jsonYaml(roster)],
    ['decisions.md', '# TORCH decisions\n\nNo project decisions recorded yet.\n'],
    ['RESUME-BRIEF.md', '# TORCH resume brief\n\nFleet not started yet.\n'],
    ['prompts/COMMON.md', promptContent(
      proposal.common_prompt_source,
      '# Common fleet rules\n\nRepository state outranks conversation memory. Query ownership before crossing a domain boundary.\n',
    )],
    ['prompts/session-manager.md', managerPrompt],
    ['backlog/.gitkeep', ''],
    ['INSTALLATION.md', `# TORCH installation\n\nInstalled ${createdAt}. Run \`torch doctor\` before starting the fleet.\n`],
  ]);
  for (const domain of config.domains) {
    const generatedPrompt = renderDomainPrompt(domain);
    const proposalDomain = proposal.domains.find((candidate) => candidate.id === domain.id);
    files.set(`prompts/${domain.id}.md`, promptContent(proposalDomain?.prompt_source, generatedPrompt));
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

export function planInstall({ repository, proposal, env = process.env, runtimes: requestedRuntimes } = {}) {
  validateApprovedProposal({ proposal, repository });
  const runtimes = resolveInstallRuntimes(proposal, requestedRuntimes);
  const trackedRoot = join(repository.root, TRACKED_DIR);
  return {
    action: 'install',
    projectRoot: repository.root,
    trackedRoot,
    stateParent: join(projectStatePath('<new-project-id>', env), '..'),
    wouldCreateTrackedState: !existsSync(trackedRoot),
    approvedDomainCount: proposal.domains.length,
    runtimes,
    mutationPerformed: false,
  };
}

export function installProject({
  repository,
  proposal,
  env = process.env,
  projectId = randomUUID(),
  now = () => new Date(),
  runtimes: requestedRuntimes,
} = {}) {
  validateApprovedProposal({ proposal, repository });
  const runtimes = resolveInstallRuntimes(proposal, requestedRuntimes);
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
    for (const [path, content] of initialFiles({ repository, projectId, createdAt, proposal, runtimes })) {
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

function inspectLocalState(statePath, manifest, env, problems) {
  const expected = projectStatePath(manifest.projectId, env);
  if (resolve(statePath) !== resolve(expected)) {
    problems.push({ type: 'unsafe-local-state-path', recorded: statePath, expected });
    return;
  }
  try {
    if (!lstatSync(statePath).isDirectory() || realpathSync(statePath) !== resolve(statePath)) {
      problems.push({ type: 'unsafe-local-state-node', path: statePath });
      return;
    }
  } catch (error) {
    problems.push({ type: 'local-state-unreadable', path: statePath, message: error.message });
    return;
  }
  const allowedFiles = new Set(['project.json', 'state.db', 'state.db-shm', 'state.db-wal']);
  const allowedDirectories = new Set([
    'sessions', 'messages', 'locks', 'leases', 'checks', 'integration', 'logs', 'remote.git',
  ]);
  const unexpected = readdirSync(statePath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory()
      ? !allowedDirectories.has(entry.name) : !allowedFiles.has(entry.name))
    .map((entry) => entry.name);
  if (unexpected.length) problems.push({ type: 'unknown-local-state', path: statePath, entries: unexpected });
  const locksPath = join(statePath, 'locks');
  const locks = existsSync(locksPath) ? readdirSync(locksPath) : [];
  if (locks.length) problems.push({ type: 'active-local-locks', path: locksPath, entries: locks });
  const databasePath = join(statePath, 'state.db');
  if (!existsSync(databasePath)) return;
  let database;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const hasTable = (name) => Boolean(database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    ).get(name));
    if (hasTable('identities')) {
      const active = database.prepare(`
        SELECT area_id AS areaId, state, runtime_session_id AS runtimeSessionId
        FROM identities WHERE state != 'offline' ORDER BY area_id
      `).all();
      if (active.length) problems.push({ type: 'active-runtime-sessions', sessions: active });
    }
    if (hasTable('resource_leases')) {
      const leases = database.prepare(`
        SELECT resource_id AS resourceId, area_id AS areaId, expires_at AS expiresAt
        FROM resource_leases WHERE released_at IS NULL ORDER BY resource_id, acquired_at
      `).all();
      if (leases.length) problems.push({ type: 'active-resource-leases', leases });
    }
    if (hasTable('worktree_guards')) {
      const guards = database.prepare(`
        SELECT area_id AS areaId, guard_type AS guardType, reason
        FROM worktree_guards WHERE released_at IS NULL ORDER BY created_at, id
      `).all();
      if (guards.length) problems.push({ type: 'active-worktree-guards', guards });
    }
    if (hasTable('integration_requests')) {
      const landing = database.prepare(`
        SELECT id, source_area AS sourceArea, source_commit AS sourceCommit
        FROM integration_requests WHERE state = 'landing' ORDER BY created_at, id
      `).all();
      if (landing.length) problems.push({ type: 'integration-landing-active', requests: landing });
    }
  } catch (error) {
    problems.push({ type: 'local-state-database-invalid', path: databasePath, message: error.message });
  } finally {
    database?.close();
  }
}

function gitOptional(root, args) {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch { return null; }
}

function inspectCanonicalRemoval(repositoryRoot, entry, localStatePath) {
  const problems = [];
  const expectedRoot = `${resolve(localStatePath)}${sep}`;
  if (!resolve(entry.path).startsWith(expectedRoot)) {
    return [{ type: 'unsafe-canonical-path', path: entry.path, stateRoot: localStatePath }];
  }
  const remoteUrl = gitOptional(repositoryRoot, ['remote', 'get-url', entry.remote]);
  if (remoteUrl === null) problems.push({ type: 'canonical-remote-missing', remote: entry.remote });
  else if (resolve(repositoryRoot, remoteUrl) !== resolve(entry.path)) {
    problems.push({ type: 'canonical-remote-changed', remote: entry.remote, expected: entry.path, actual: remoteUrl });
  }
  if (!existsSync(entry.path)) problems.push({ type: 'canonical-path-missing', path: entry.path });
  else {
    const heads = gitOptional(entry.path, ['for-each-ref', '--format=%(objectname)', 'refs/heads']);
    for (const commit of (heads ?? '').split('\n').filter(Boolean)) {
      if (!gitOptional(repositoryRoot, ['for-each-ref', '--format=%(refname)', '--contains', commit])) {
        problems.push({ type: 'canonical-unique-commit', path: entry.path, commit });
      }
    }
  }
  return problems;
}

export function planUninstall({ repository, purge = false, env = process.env }) {
  const manifest = readInstallManifest(repository.root);
  const problems = [];
  let mainBranch = repository.branch || 'main';
  try {
    const config = JSON.parse(readFileSync(join(repository.root, TRACKED_DIR, 'torch.yaml'), 'utf8'));
    mainBranch = config.project?.main_branch ?? mainBranch;
  } catch { /* created-file validation below reports the invalid config */ }
  const localState = (manifest.external ?? []).find((entry) => entry.type === 'local-state');
  if (localState && !existsSync(join(localState.path, 'project.json'))) {
    problems.push({ type: 'local-state-metadata-missing', path: join(localState.path, 'project.json') });
  } else if (localState) {
    try {
      const metadata = JSON.parse(readFileSync(join(localState.path, 'project.json'), 'utf8'));
      if (resolve(metadata.root) !== resolve(repository.root)) {
        problems.push({ type: 'not-installation-root', expected: metadata.root, actual: repository.root });
      }
      if (metadata.projectId !== manifest.projectId) {
        problems.push({
          type: 'local-state-project-mismatch', expected: manifest.projectId, actual: metadata.projectId ?? null,
        });
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
      if (existsSync(entry.path)) inspectLocalState(entry.path, manifest, env, problems);
    }
    if (entry.type === 'canonical-remote') {
      if (!localState?.path) problems.push({ type: 'local-state-missing-for-canonical', path: entry.path });
      else problems.push(...inspectCanonicalRemoval(repository.root, entry, localState.path));
    }
    if (entry.type === 'worktree') {
      const state = inspectManagedWorktree(repository.root, entry, mainBranch);
      if (!state.safeToRemove) problems.push({ type: 'unsafe-worktree', path: entry.path, area: entry.area, problems: state.problems });
    }
    if (entry.type === 'systemd-user-unit') {
      problems.push({ type: 'persistent-integration-installed', path: entry.path, name: entry.name });
    }
  }
  return {
    action: purge ? 'purge' : 'detach', manifest, problems,
    canProceed: !purge || problems.length === 0,
    mutationPerformed: false,
  };
}

export function uninstallProject({ repository, purge = false, dryRun = false, env = process.env }) {
  const plan = planUninstall({ repository, purge, env });
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
  for (const entry of (plan.manifest.external ?? []).filter((item) => item.type === 'canonical-remote')) {
    execFileSync('git', ['-C', repository.root, 'remote', 'remove', entry.remote], { stdio: 'ignore' });
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
