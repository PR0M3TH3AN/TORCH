import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { TorchError } from '../kernel/errors.mjs';
import { readInstallManifest } from '../kernel/install.mjs';
import { ensureTaskIgnored, removeTaskIgnore } from '../kernel/worktrees.mjs';

const CHANGE_STATES = Object.freeze(['proposed', 'approved', 'provisioning', 'active', 'rejected']);

function requiredText(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TorchError(`${name} must be a non-empty string`, {
      code: 'INVALID_FLEET_CHANGE', details: { field: name },
    });
  }
  return value.trim();
}

function textList(value, name, { required = false } = {}) {
  if (!Array.isArray(value) || (required && value.length === 0)
    || value.some((entry) => typeof entry !== 'string' || !entry.trim())) {
    throw new TorchError(`${name} must be ${required ? 'a non-empty' : 'an'} array of non-empty strings`, {
      code: 'INVALID_FLEET_CHANGE', details: { field: name },
    });
  }
  return [...new Set(value.map((entry) => entry.trim()))];
}

function readJson(path, code) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch (error) {
    throw new TorchError(`Cannot read ${path}`, { code, details: error.message });
  }
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function git(root, args, { optional = false } = {}) {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    if (optional) return '';
    throw new TorchError(`Git command failed: git ${args.join(' ')}`, {
      code: 'GIT_COMMAND_FAILED', details: error.stderr?.toString().trim() || error.message,
    });
  }
}

function expandPath(value, root) {
  if (value === '~') return homedir();
  if (value.startsWith('~/')) return join(homedir(), value.slice(2));
  return isAbsolute(value) ? value : resolve(root, value);
}

function ownershipPrefixes(pattern) {
  const normalized = pattern.replaceAll('\\', '/');
  const wildcard = normalized.search(/[?*[]/);
  return (wildcard === -1 ? normalized : normalized.slice(0, wildcard)).replace(/\/$/, '');
}

function pathsOverlap(left, right) {
  if (left === right) return true;
  const a = ownershipPrefixes(left);
  const b = ownershipPrefixes(right);
  return Boolean(a && b && (a.startsWith(`${b}/`) || b.startsWith(`${a}/`)));
}

function normalizeDomain(input) {
  const id = requiredText(input?.id, 'domain.id');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id) || id === 'session-manager') {
    throw new TorchError(`Invalid proposed domain ID: ${id}`, {
      code: 'INVALID_FLEET_CHANGE', details: { field: 'domain.id' },
    });
  }
  const runtime = requiredText(input.runtime ?? 'claude', 'domain.runtime');
  const model = input.model === undefined || input.model === null
    ? null : requiredText(input.model, 'domain.model');
  const branch = input.branch === undefined || input.branch === null
    ? null : requiredText(input.branch, 'domain.branch');
  const worktreeName = input.worktree_name === undefined || input.worktree_name === null
    ? null : requiredText(input.worktree_name, 'domain.worktree_name');
  if (worktreeName && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(worktreeName)) {
    throw new TorchError(`Invalid worktree name: ${worktreeName}`, {
      code: 'INVALID_FLEET_CHANGE', details: { field: 'domain.worktree_name' },
    });
  }
  return {
    id,
    title: requiredText(input.title, 'domain.title'),
    kind: requiredText(input.kind ?? 'development', 'domain.kind'),
    scope: textList(input.scope, 'domain.scope', { required: true }),
    not_scope: textList(input.not_scope ?? [], 'domain.not_scope'),
    owned_paths: textList(input.owned_paths, 'domain.owned_paths', { required: true }),
    shared_paths: textList(input.shared_paths ?? [], 'domain.shared_paths'),
    neighbours: textList(input.neighbours ?? [], 'domain.neighbours'),
    required_checks: textList(input.required_checks ?? [], 'domain.required_checks'),
    resources: textList(input.resources ?? [], 'domain.resources'),
    runtime,
    model,
    branch,
    worktree_name: worktreeName,
  };
}

function rowToChange(row) {
  if (!row) return null;
  return {
    id: row.id, state: row.state, proposer: row.proposer,
    createdAt: row.created_at, updatedAt: row.updated_at, baseCommit: row.base_commit,
    approvedBy: row.approved_by, approvedAt: row.approved_at,
    activationCommit: row.activation_commit, domain: JSON.parse(row.domain_json),
    rationale: row.rationale, expectedBenefit: JSON.parse(row.expected_benefit_json),
    evidence: JSON.parse(row.evidence_json),
  };
}

function promptFor(domain) {
  return [
    `# ${domain.title}`, '', `Area ID: ${domain.id}`, '', '## Owns', '',
    ...domain.scope.map((item) => `- ${item}`), '', '## Does not own', '',
    ...(domain.not_scope.length ? domain.not_scope : ['No exclusions recorded.']).map((item) => `- ${item}`),
    '', '## Neighbours', '',
    ...(domain.neighbours.length ? domain.neighbours : ['None identified.']).map((item) => `- ${item}`),
    '', '## Resources', '',
    ...(domain.resources.length ? domain.resources : ['No scarce resources declared.']).map((item) => `- ${item}`),
    '', '## First move', '',
    'Query live ownership, read the assigned backlog item, and report current repository evidence to the Session Manager.',
    '',
  ].join('\n');
}

function initialize(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS fleet_changes (
      id TEXT PRIMARY KEY,
      state TEXT NOT NULL,
      proposer TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      base_commit TEXT NOT NULL,
      approved_by TEXT,
      approved_at TEXT,
      activation_commit TEXT,
      domain_json TEXT NOT NULL,
      rationale TEXT NOT NULL,
      expected_benefit_json TEXT NOT NULL,
      evidence_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS fleet_changes_state_created
      ON fleet_changes(state, created_at, id);
  `);
}

export class FleetEvolutionService {
  constructor({ repositoryRoot, controlPlane, clock = () => new Date(), idFactory = randomUUID } = {}) {
    if (!controlPlane) throw new TorchError('Fleet evolution requires the TORCH control plane', { code: 'CONTROL_PLANE_REQUIRED' });
    this.repositoryRoot = resolve(repositoryRoot ?? controlPlane.repositoryRoot);
    this.controlPlane = controlPlane;
    this.database = controlPlane.database;
    this.clock = clock;
    this.idFactory = idFactory;
    initialize(this.database);
  }

  get(changeId) {
    const id = requiredText(changeId, 'changeId');
    const change = rowToChange(this.database.prepare('SELECT * FROM fleet_changes WHERE id = ?').get(id));
    if (!change) throw new TorchError(`Unknown Fleet change: ${id}`, { code: 'FLEET_CHANGE_NOT_FOUND' });
    return change;
  }

  list({ state } = {}) {
    if (state && !CHANGE_STATES.includes(state)) {
      throw new TorchError(`Invalid Fleet change state: ${state}`, { code: 'INVALID_FLEET_CHANGE_STATE' });
    }
    const rows = state
      ? this.database.prepare('SELECT * FROM fleet_changes WHERE state = ? ORDER BY created_at, id').all(state)
      : this.database.prepare('SELECT * FROM fleet_changes ORDER BY created_at, id').all();
    return rows.map(rowToChange);
  }

  proposeDomain({ proposer, domain: input, rationale, expectedBenefit, evidence } = {}) {
    const actor = this.controlPlane.assertIdentity(proposer);
    if (actor !== 'session-manager') {
      throw new TorchError('Only the Session Manager may propose a persistent Fleet domain', {
        code: 'FLEET_CHANGE_AUTHORITY_REQUIRED', details: { actor },
      });
    }
    const domain = normalizeDomain(input);
    const agents = this.controlPlane.listAgents();
    if (agents.some((agent) => agent.areaId === domain.id)) {
      throw new TorchError(`Fleet identity already exists: ${domain.id}`, { code: 'FLEET_IDENTITY_EXISTS' });
    }
    for (const neighbour of domain.neighbours) this.controlPlane.assertIdentity(neighbour);
    const benefit = {
      summary: requiredText(expectedBenefit?.summary, 'expectedBenefit.summary'),
      recurringWork: requiredText(expectedBenefit?.recurringWork, 'expectedBenefit.recurringWork'),
      contextLocality: requiredText(expectedBenefit?.contextLocality, 'expectedBenefit.contextLocality'),
      coordinationCost: requiredText(expectedBenefit?.coordinationCost, 'expectedBenefit.coordinationCost'),
    };
    const evidenceList = textList(evidence, 'evidence', { required: true });
    const collisions = agents.flatMap((agent) => domain.owned_paths.flatMap((proposedPath) =>
      agent.ownedPaths.filter((existingPath) => pathsOverlap(proposedPath, existingPath))
        .map((existingPath) => ({ areaId: agent.areaId, proposedPath, existingPath }))));
    if (collisions.length) {
      throw new TorchError('A new domain cannot silently overlap existing owned paths; propose a split or ownership change instead', {
        code: 'FLEET_OWNERSHIP_COLLISION', details: collisions,
      });
    }
    const config = readJson(join(this.repositoryRoot, '.torch', 'torch.yaml'), 'CONFIG_INVALID');
    if (!config.runtimes?.[domain.runtime]) {
      throw new TorchError(`Runtime is not configured for the Fleet: ${domain.runtime}`, {
        code: 'FLEET_RUNTIME_NOT_CONFIGURED', details: { runtime: domain.runtime },
      });
    }
    const knownChecks = new Set((config.checks ?? []).map((check) => check.id));
    const unknownChecks = domain.required_checks.filter((check) => !knownChecks.has(check));
    if (unknownChecks.length) {
      throw new TorchError('Proposed domain references unknown checks', {
        code: 'FLEET_CHECK_NOT_CONFIGURED', details: { checks: unknownChecks },
      });
    }
    const knownResources = new Set((config.resources ?? []).map((resource) => resource.id));
    const unknownResources = domain.resources.filter((resource) => !knownResources.has(resource));
    if (unknownResources.length) {
      throw new TorchError('Proposed domain references unknown resources', {
        code: 'FLEET_RESOURCE_NOT_CONFIGURED', details: { resources: unknownResources },
      });
    }
    const now = this.clock().toISOString();
    const record = {
      id: this.idFactory(), state: 'proposed', proposer: actor, createdAt: now, updatedAt: now,
      baseCommit: git(this.repositoryRoot, ['rev-parse', 'HEAD']), approvedBy: null,
      approvedAt: null, activationCommit: null, domain,
      rationale: requiredText(rationale, 'rationale'), expectedBenefit: benefit, evidence: evidenceList,
    };
    this.database.prepare(`
      INSERT INTO fleet_changes (
        id, state, proposer, created_at, updated_at, base_commit, approved_by,
        approved_at, activation_commit, domain_json, rationale,
        expected_benefit_json, evidence_json
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?)
    `).run(
      record.id, record.state, record.proposer, record.createdAt, record.updatedAt,
      record.baseCommit, JSON.stringify(record.domain), record.rationale,
      JSON.stringify(record.expectedBenefit), JSON.stringify(record.evidence),
    );
    this.controlPlane.audit({
      actorId: actor, operation: 'fleet-change.propose-domain', entityType: 'fleet-change', entityId: record.id,
      details: { domainId: domain.id, baseCommit: record.baseCommit },
    });
    return record;
  }

  approve({ changeId, approvedBy } = {}) {
    const change = this.get(changeId);
    if (change.state !== 'proposed') {
      throw new TorchError(`Fleet change ${change.id} is ${change.state}, not proposed`, { code: 'FLEET_CHANGE_STATE_CONFLICT' });
    }
    const owner = requiredText(approvedBy, 'approvedBy');
    const now = this.clock().toISOString();
    this.database.prepare(`
      UPDATE fleet_changes SET state = 'approved', approved_by = ?, approved_at = ?, updated_at = ?
      WHERE id = ? AND state = 'proposed'
    `).run(owner, now, now, change.id);
    this.controlPlane.audit({
      actorId: 'session-manager', operation: 'fleet-change.owner-approved', entityType: 'fleet-change', entityId: change.id,
      details: { approvedBy: owner },
    });
    return this.get(change.id);
  }

  planActivation(changeId) {
    const change = this.get(changeId);
    const config = readJson(join(this.repositoryRoot, '.torch', 'torch.yaml'), 'CONFIG_INVALID');
    const roster = readJson(join(this.repositoryRoot, '.torch', 'roster.yaml'), 'ROSTER_INVALID');
    const currentHead = git(this.repositoryRoot, ['rev-parse', 'HEAD']);
    const dirtyEntries = git(this.repositoryRoot, ['status', '--porcelain']).split('\n').filter(Boolean);
    const trackedConfig = ['.torch/torch.yaml', '.torch/roster.yaml'].every((path) =>
      Boolean(git(this.repositoryRoot, ['ls-files', '--error-unmatch', path], { optional: true })));
    const prefix = config.git?.branch_prefix ?? 'torch/';
    const branch = change.domain.branch ?? `${prefix}${change.domain.id}`;
    const parent = expandPath(config.paths.worktree_parent, this.repositoryRoot);
    const worktreeName = change.domain.worktree_name ?? change.domain.id;
    const worktree = change.domain.worktree_name
      ? join(parent, worktreeName) : join(parent, config.project.id, worktreeName);
    const blockers = [];
    if (change.state !== 'approved' && change.state !== 'provisioning') blockers.push({ type: 'state', actual: change.state });
    if (change.state === 'approved' && currentHead !== change.baseCommit) {
      blockers.push({ type: 'stale-head', expected: change.baseCommit, actual: currentHead });
    }
    if (change.state === 'approved' && dirtyEntries.length) blockers.push({ type: 'dirty-main', entries: dirtyEntries });
    if (!trackedConfig) blockers.push({ type: 'configuration-not-committed' });
    if (config.domains.some((domain) => domain.id === change.domain.id) && change.state !== 'provisioning') {
      blockers.push({ type: 'domain-already-configured', domainId: change.domain.id });
    }
    if (roster.areas.some((area) => area.id === change.domain.id) && change.state !== 'provisioning') {
      blockers.push({ type: 'identity-already-rostered', domainId: change.domain.id });
    }
    if (git(this.repositoryRoot, ['branch', '--list', branch], { optional: true })) {
      blockers.push({ type: 'branch-exists', branch });
    }
    if (existsSync(worktree)) blockers.push({ type: 'worktree-path-exists', worktree });
    return {
      action: 'activate-domain', changeId: change.id, domainId: change.domain.id,
      state: change.state, branch, worktree, currentHead, baseCommit: change.baseCommit,
      blockers, canProceed: blockers.length === 0, mutationPerformed: false,
    };
  }

  activate({ changeId, approvedBy } = {}) {
    const change = this.get(changeId);
    if (change.approvedBy !== requiredText(approvedBy, 'approvedBy')) {
      throw new TorchError('Fleet activation must name the same owner who approved the change', {
        code: 'FLEET_CHANGE_AUTHORITY_REQUIRED', details: { approvedBy: change.approvedBy },
      });
    }
    const plan = this.planActivation(change.id);
    if (!plan.canProceed) {
      throw new TorchError('Fleet domain activation is blocked', {
        code: 'FLEET_CHANGE_BLOCKED', details: plan.blockers,
      });
    }
    if (change.state === 'approved') {
      const manifest = readInstallManifest(this.repositoryRoot);
      const ignore = ensureTaskIgnored(this.repositoryRoot, manifest.installationId);
      try {
        this.commitConfiguration(change, plan, ignore);
      } catch (error) {
        removeTaskIgnore(ignore, manifest.installationId);
        throw error;
      }
    }
    const current = this.get(change.id);
    mkdirSync(dirname(plan.worktree), { recursive: true });
    git(this.repositoryRoot, ['worktree', 'add', '-b', plan.branch, plan.worktree, current.activationCommit]);
    writeFileSync(join(plan.worktree, '.task'), `Unassigned · ${change.domain.id}\n`, { encoding: 'utf8', flag: 'wx' });
    const now = this.clock().toISOString();
    this.database.prepare("UPDATE fleet_changes SET state = 'active', updated_at = ? WHERE id = ?")
      .run(now, change.id);
    this.controlPlane.refreshRoster();
    this.controlPlane.audit({
      actorId: 'session-manager', operation: 'fleet-change.activate-domain', entityType: 'fleet-change', entityId: change.id,
      details: { domainId: change.domain.id, branch: plan.branch, worktree: plan.worktree },
    });
    return {
      ...this.get(change.id), branch: plan.branch, worktree: plan.worktree,
      identity: this.controlPlane.identity(change.domain.id),
      runtime: { state: 'offline', next: `Start ${change.domain.id} through the approved ${change.domain.runtime} adapter.` },
      mutationPerformed: true,
    };
  }

  commitConfiguration(change, plan, ignore) {
    const configPath = join(this.repositoryRoot, '.torch', 'torch.yaml');
    const rosterPath = join(this.repositoryRoot, '.torch', 'roster.yaml');
    const config = readJson(configPath, 'CONFIG_INVALID');
    const roster = readJson(rosterPath, 'ROSTER_INVALID');
    const manifest = readInstallManifest(this.repositoryRoot);
    const domain = change.domain;
    config.domains.push(domain);
    roster.areas.push(domain);
    for (const neighbourId of domain.neighbours) {
      const configured = config.domains.find((candidate) => candidate.id === neighbourId);
      const rostered = roster.areas.find((candidate) => candidate.id === neighbourId);
      if (configured && !configured.neighbours.includes(domain.id)) configured.neighbours.push(domain.id);
      if (rostered && !rostered.neighbours.includes(domain.id)) rostered.neighbours.push(domain.id);
    }
    const promptRelative = `.torch/prompts/${domain.id}.md`;
    const changeRelative = `.torch/fleet-changes/${change.id}.approved.json`;
    const approvedRecord = {
      schema: 'torch.dev/fleet-change/v1alpha1', ...change, state: 'approved',
      activation: { branch: plan.branch, worktree: plan.worktree },
    };
    const serialized = new Map([
      ['.torch/torch.yaml', `${JSON.stringify(config, null, 2)}\n`],
      ['.torch/roster.yaml', `${JSON.stringify(roster, null, 2)}\n`],
      [promptRelative, promptFor(domain)],
      [changeRelative, `${JSON.stringify(approvedRecord, null, 2)}\n`],
    ]);
    manifest.external.push({ type: 'worktree', area: domain.id, path: plan.worktree, branch: plan.branch });
    if (ignore?.added) manifest.patched.push({
      type: 'git-info-exclude-line', path: ignore.path, line: '.task', installationId: manifest.installationId,
    });
    for (const [relativePath, content] of serialized) {
      const existing = manifest.created.find((record) => record.path === relativePath);
      if (existing) existing.sha256 = sha256(content);
      else manifest.created.push({ path: relativePath, sha256: sha256(content) });
    }
    serialized.set('.torch/install-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
    for (const [relativePath, content] of serialized) {
      const path = join(this.repositoryRoot, relativePath);
      mkdirSync(dirname(path), { recursive: true });
      const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
      writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      renameSync(temporary, path);
    }
    git(this.repositoryRoot, ['add', ...serialized.keys()]);
    git(this.repositoryRoot, ['commit', '-m', `chore(torch): add ${domain.id} domain`]);
    const activationCommit = git(this.repositoryRoot, ['rev-parse', 'HEAD']);
    const now = this.clock().toISOString();
    this.database.prepare(`
      UPDATE fleet_changes SET state = 'provisioning', activation_commit = ?, updated_at = ? WHERE id = ?
    `).run(activationCommit, now, change.id);
  }
}
