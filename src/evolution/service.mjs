import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { TorchError } from '../kernel/errors.mjs';
import { BacklogService } from '../backlog/service.mjs';
import { readInstallManifest } from '../kernel/install.mjs';
import { ensureTaskIgnored, removeTaskIgnore } from '../kernel/worktrees.mjs';
import { loadProjectConfig } from '../kernel/config.mjs';
import { inspectManagedWorktree } from '../kernel/worktree-state.mjs';
import { renderDomainPrompt } from '../kernel/prompts.mjs';

const CHANGE_STATES = Object.freeze(['proposed', 'approved', 'provisioning', 'active', 'retired', 'rejected']);

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

function normalizeDomain(input, defaultRuntime) {
  const id = requiredText(input?.id, 'domain.id');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id) || id === 'session-manager') {
    throw new TorchError(`Invalid proposed domain ID: ${id}`, {
      code: 'INVALID_FLEET_CHANGE', details: { field: 'domain.id' },
    });
  }
  const runtime = requiredText(input.runtime === 'default' || input.runtime == null
    ? defaultRuntime : input.runtime, 'domain.runtime');
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
    id: row.id, type: row.change_type ?? 'add-domain', state: row.state, proposer: row.proposer,
    createdAt: row.created_at, updatedAt: row.updated_at, baseCommit: row.base_commit,
    approvedBy: row.approved_by, approvedAt: row.approved_at,
    rejectedBy: row.rejected_by ?? null, rejectedAt: row.rejected_at ?? null,
    rejectionReason: row.rejection_reason ?? null,
    activationCommit: row.activation_commit, domain: JSON.parse(row.domain_json),
    proposal: row.proposal_json ? JSON.parse(row.proposal_json) : null,
    rationale: row.rationale, expectedBenefit: JSON.parse(row.expected_benefit_json),
    evidence: JSON.parse(row.evidence_json),
  };
}

function promptFor(domain) {
  return renderDomainPrompt(domain);
}

function initialize(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS fleet_changes (
      id TEXT PRIMARY KEY,
      change_type TEXT NOT NULL DEFAULT 'add-domain',
      state TEXT NOT NULL,
      proposer TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      base_commit TEXT NOT NULL,
      approved_by TEXT,
      approved_at TEXT,
      rejected_by TEXT,
      rejected_at TEXT,
      rejection_reason TEXT,
      activation_commit TEXT,
      domain_json TEXT NOT NULL,
      rationale TEXT NOT NULL,
      expected_benefit_json TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      proposal_json TEXT
    );
    CREATE INDEX IF NOT EXISTS fleet_changes_state_created
      ON fleet_changes(state, created_at, id);
  `);
  const columns = new Set(database.prepare('PRAGMA table_info(fleet_changes)').all().map((column) => column.name));
  if (!columns.has('change_type')) {
    database.exec("ALTER TABLE fleet_changes ADD COLUMN change_type TEXT NOT NULL DEFAULT 'add-domain'");
  }
  if (!columns.has('proposal_json')) {
    database.exec('ALTER TABLE fleet_changes ADD COLUMN proposal_json TEXT');
  }
  if (!columns.has('rejected_by')) database.exec('ALTER TABLE fleet_changes ADD COLUMN rejected_by TEXT');
  if (!columns.has('rejected_at')) database.exec('ALTER TABLE fleet_changes ADD COLUMN rejected_at TEXT');
  if (!columns.has('rejection_reason')) database.exec('ALTER TABLE fleet_changes ADD COLUMN rejection_reason TEXT');
}

function expectedBenefit(input) {
  return {
    summary: requiredText(input?.summary, 'expectedBenefit.summary'),
    recurringWork: requiredText(input?.recurringWork, 'expectedBenefit.recurringWork'),
    contextLocality: requiredText(input?.contextLocality, 'expectedBenefit.contextLocality'),
    coordinationCost: requiredText(input?.coordinationCost, 'expectedBenefit.coordinationCost'),
  };
}

function hasTable(database, name) {
  return Boolean(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function configDigest(repositoryRoot) {
  return sha256(readFileSync(join(repositoryRoot, '.torch', 'torch.yaml')));
}

function normalizeAssignment(input) {
  return {
    sourceDomainId: requiredText(input?.sourceDomainId ?? input?.source_domain_id, 'ownershipAssignments.sourceDomainId'),
    sourcePath: requiredText(input?.sourcePath ?? input?.source_path, 'ownershipAssignments.sourcePath'),
    resultDomainId: requiredText(input?.resultDomainId ?? input?.result_domain_id, 'ownershipAssignments.resultDomainId'),
  };
}

function stableDomain(domain) {
  return JSON.stringify(domain);
}

function pathBoundary(path) {
  const parts = path.replaceAll('\\', '/').split('/').filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? path;
  return parts.slice(0, 2).join('/');
}

function grouped(items, keyFor) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFor(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
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

  assessDomainNeeds({ assessor } = {}) {
    const actor = this.controlPlane.assertIdentity(assessor);
    if (actor !== 'session-manager') {
      throw new TorchError('Only the Session Manager may assess persistent Fleet boundaries', {
        code: 'FLEET_CHANGE_AUTHORITY_REQUIRED', details: { actor },
      });
    }
    const activeStates = new Set([
      'proposed', 'ready', 'assigned', 'in_progress', 'blocked', 'verification', 'ready_to_integrate',
    ]);
    const tasks = new BacklogService({
      repositoryRoot: this.repositoryRoot, controlPlane: this.controlPlane,
    }).list().filter((task) => activeStates.has(task.state));
    const handoffs = this.database.prepare(`
      SELECT id, sender_id AS sender, recipient_id AS recipient, path_ref AS path,
        task_ref AS task, reason, created_at AS createdAt
      FROM handoffs WHERE status = 'requested' ORDER BY created_at, id
    `).all();
    const coordination = this.database.prepare(`
      SELECT id, sender_id AS sender, task_ref AS task, path_ref AS path,
        body, created_at AS createdAt
      FROM messages WHERE kind = 'coordination-request' ORDER BY created_at, id
    `).all();
    const unownedHandoffs = handoffs.filter((handoff) => handoff.path
      && this.controlPlane.whoOwns({ path: handoff.path }).owners.length === 0);
    const signals = [];
    for (const [boundary, entries] of grouped(unownedHandoffs, (handoff) => pathBoundary(handoff.path))) {
      if (entries.length < 2) continue;
      signals.push({
        code: 'RECURRING_UNOWNED_PATH_BOUNDARY', boundary, count: entries.length,
        evidence: entries.map((entry) => `handoff:${entry.id}:${entry.path}`),
        interpretation: 'Repeated handoffs touch the same unowned path boundary.',
      });
    }
    const multiDomain = tasks.filter((task) => task.affectedDomains.length > 1);
    for (const [domains, entries] of grouped(multiDomain, (task) => [...task.affectedDomains].sort().join(','))) {
      if (entries.length < 2) continue;
      signals.push({
        code: 'RECURRING_MULTI_DOMAIN_WORK', domains: domains.split(','), count: entries.length,
        evidence: entries.map((entry) => `backlog:${entry.id}`),
        interpretation: 'The same domain set repeatedly shares active backlog work.',
      });
    }
    const unassigned = tasks.filter((task) => !task.owner);
    const blocked = tasks.filter((task) => task.state === 'blocked');
    const proposedChanges = this.list({ state: 'proposed' });
    const recommendation = signals.length ? {
      action: 'consider-new-domain',
      reason: 'Recurring boundary evidence may justify a persistent specialist.',
      requiresManagerJudgment: true,
      requiresOwnerApproval: true,
      nextTool: 'torch_propose_domain',
    } : {
      action: 'retain-current-fleet',
      reason: 'No repeated structural signal currently crosses the conservative proposal threshold.',
      requiresManagerJudgment: true,
      requiresOwnerApproval: true,
      nextTool: null,
    };
    return {
      schema: 'torch.dev/fleet-evolution-assessment/v1alpha1',
      assessedAt: this.clock().toISOString(), assessor: actor, recommendation,
      signals,
      evidence: {
        openBacklog: tasks.map((task) => ({
          id: task.id, state: task.state, owner: task.owner, affectedDomains: task.affectedDomains,
        })),
        unassignedBacklog: unassigned.map((task) => task.id),
        blockedBacklog: blocked.map((task) => task.id),
        requestedHandoffs: handoffs,
        coordinationRequests: coordination,
        proposedFleetChanges: proposedChanges.map((change) => ({
          id: change.id, type: change.type, domainId: change.domain?.id ?? null,
        })),
      },
      guardrail: 'This assessment is advisory. Inspect repository evidence and coordination cost before proposing; assessment never creates, approves, activates, or starts a session.',
      mutationPerformed: false,
    };
  }

  proposeDomain({ proposer, domain: input, rationale, expectedBenefit: benefitInput, evidence } = {}) {
    const actor = this.controlPlane.assertIdentity(proposer);
    if (actor !== 'session-manager') {
      throw new TorchError('Only the Session Manager may propose a persistent Fleet domain', {
        code: 'FLEET_CHANGE_AUTHORITY_REQUIRED', details: { actor },
      });
    }
    const config = loadProjectConfig(this.repositoryRoot);
    const domain = normalizeDomain(input, config.runtimes.default);
    const agents = this.controlPlane.listAgents();
    if (agents.some((agent) => agent.areaId === domain.id)) {
      throw new TorchError(`Fleet identity already exists: ${domain.id}`, { code: 'FLEET_IDENTITY_EXISTS' });
    }
    for (const neighbour of domain.neighbours) this.controlPlane.assertIdentity(neighbour);
    const benefit = expectedBenefit(benefitInput);
    const evidenceList = textList(evidence, 'evidence', { required: true });
    const collisions = agents.flatMap((agent) => domain.owned_paths.flatMap((proposedPath) =>
      agent.ownedPaths.filter((existingPath) => pathsOverlap(proposedPath, existingPath))
        .map((existingPath) => ({ areaId: agent.areaId, proposedPath, existingPath }))));
    if (collisions.length) {
      throw new TorchError('A new domain cannot silently overlap existing owned paths; propose a split or ownership change instead', {
        code: 'FLEET_OWNERSHIP_COLLISION', details: collisions,
      });
    }
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
        id, change_type, state, proposer, created_at, updated_at, base_commit, approved_by,
        approved_at, activation_commit, domain_json, rationale,
        expected_benefit_json, evidence_json
      ) VALUES (?, 'add-domain', ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?)
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

  proposeRetirement({ proposer, areaId, rationale, expectedBenefit: benefitInput, evidence } = {}) {
    const actor = this.controlPlane.assertIdentity(proposer);
    if (actor !== 'session-manager') {
      throw new TorchError('Only the Session Manager may propose retiring a persistent Fleet domain', {
        code: 'FLEET_CHANGE_AUTHORITY_REQUIRED', details: { actor },
      });
    }
    const target = this.controlPlane.identity(areaId);
    if (target.areaId === 'session-manager') {
      throw new TorchError('The primary Session Manager cannot be retired as a domain', { code: 'FLEET_CHANGE_INVALID' });
    }
    const domain = loadProjectConfig(this.repositoryRoot).domains.find((entry) => entry.id === target.areaId);
    if (!domain) throw new TorchError(`Configured domain not found: ${target.areaId}`, { code: 'FLEET_CHANGE_INVALID' });
    const now = this.clock().toISOString();
    const record = {
      id: this.idFactory(), type: 'retire-domain', state: 'proposed', proposer: actor,
      createdAt: now, updatedAt: now, baseCommit: git(this.repositoryRoot, ['rev-parse', 'HEAD']),
      approvedBy: null, approvedAt: null, activationCommit: null, domain,
      rationale: requiredText(rationale, 'rationale'), expectedBenefit: expectedBenefit(benefitInput),
      evidence: textList(evidence, 'evidence', { required: true }),
    };
    this.database.prepare(`
      INSERT INTO fleet_changes (
        id, change_type, state, proposer, created_at, updated_at, base_commit, approved_by,
        approved_at, activation_commit, domain_json, rationale, expected_benefit_json, evidence_json
      ) VALUES (?, 'retire-domain', ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?)
    `).run(
      record.id, record.state, record.proposer, record.createdAt, record.updatedAt,
      record.baseCommit, JSON.stringify(record.domain), record.rationale,
      JSON.stringify(record.expectedBenefit), JSON.stringify(record.evidence),
    );
    this.controlPlane.audit({
      actorId: actor, operation: 'fleet-change.propose-retirement', entityType: 'fleet-change', entityId: record.id,
      details: { domainId: domain.id, baseCommit: record.baseCommit },
    });
    return record;
  }

  proposeMerge(input = {}) {
    return this.proposeBoundaryChange('merge-domains', input);
  }

  proposeSplit(input = {}) {
    return this.proposeBoundaryChange('split-domain', input);
  }

  proposeBoundaryChange(changeType, {
    proposer, sourceDomains: sourceInput, resultDomains: resultInput,
    ownershipAssignments: assignmentInput, rationale, expectedBenefit: benefitInput, evidence,
  } = {}) {
    const actor = this.controlPlane.assertIdentity(proposer);
    if (actor !== 'session-manager') {
      throw new TorchError('Only the Session Manager may propose changing persistent Fleet boundaries', {
        code: 'FLEET_CHANGE_AUTHORITY_REQUIRED', details: { actor },
      });
    }
    if (!['merge-domains', 'split-domain'].includes(changeType)) {
      throw new TorchError(`Unsupported Fleet boundary change: ${changeType}`, { code: 'FLEET_CHANGE_INVALID' });
    }
    const sourceIds = textList(sourceInput, 'sourceDomains', { required: true });
    if ((changeType === 'merge-domains' && sourceIds.length < 2)
      || (changeType === 'split-domain' && sourceIds.length !== 1)) {
      throw new TorchError(`${changeType} has invalid source-domain cardinality`, {
        code: 'FLEET_CHANGE_INVALID', details: { sourceDomains: sourceIds },
      });
    }
    if (sourceIds.includes('session-manager')) {
      throw new TorchError('The primary Session Manager is not a merge or split source', { code: 'FLEET_CHANGE_INVALID' });
    }
    const config = loadProjectConfig(this.repositoryRoot);
    const configuredById = new Map(config.domains.map((domain) => [domain.id, domain]));
    const unknownSources = sourceIds.filter((id) => !configuredById.has(id));
    if (unknownSources.length) {
      throw new TorchError('Fleet boundary proposal references unknown source domains', {
        code: 'FLEET_CHANGE_INVALID', details: { sourceDomains: unknownSources },
      });
    }
    if (!Array.isArray(resultInput)) {
      throw new TorchError('resultDomains must be an array', {
        code: 'INVALID_FLEET_CHANGE', details: { field: 'resultDomains' },
      });
    }
    const resultDomains = resultInput.map((input) => normalizeDomain(input, config.runtimes.default));
    if ((changeType === 'merge-domains' && resultDomains.length !== 1)
      || (changeType === 'split-domain' && resultDomains.length < 2)) {
      throw new TorchError(`${changeType} has invalid result-domain cardinality`, {
        code: 'FLEET_CHANGE_INVALID', details: { resultDomains: resultDomains.map((domain) => domain.id) },
      });
    }
    const resultIds = resultDomains.map((domain) => domain.id);
    if (new Set(resultIds).size !== resultIds.length) {
      throw new TorchError('Fleet boundary proposal has duplicate result-domain IDs', { code: 'FLEET_CHANGE_INVALID' });
    }
    const collisions = resultIds.filter((id) => configuredById.has(id) && !sourceIds.includes(id));
    if (collisions.length) {
      throw new TorchError('Result-domain IDs collide with unaffected Fleet identities', {
        code: 'FLEET_IDENTITY_EXISTS', details: { domains: collisions },
      });
    }
    const knownFutureIds = new Set([
      'session-manager', ...config.domains.filter((domain) => !sourceIds.includes(domain.id)).map((domain) => domain.id),
      ...resultIds,
    ]);
    const knownRuntimes = new Set(Object.keys(config.runtimes ?? {}));
    const knownChecks = new Set((config.checks ?? []).map((check) => check.id));
    const knownResources = new Set((config.resources ?? []).map((resource) => resource.id));
    for (const domain of resultDomains) {
      const invalid = {
        neighbours: domain.neighbours.filter((id) => !knownFutureIds.has(id)),
        checks: domain.required_checks.filter((id) => !knownChecks.has(id)),
        resources: domain.resources.filter((id) => !knownResources.has(id)),
      };
      if (!knownRuntimes.has(domain.runtime) || Object.values(invalid).some((items) => items.length)) {
        throw new TorchError('Result domain references Fleet configuration that will not exist', {
          code: 'FLEET_CHANGE_INVALID', details: { domainId: domain.id, runtime: domain.runtime, ...invalid },
        });
      }
    }
    const assignments = Array.isArray(assignmentInput) ? assignmentInput.map(normalizeAssignment) : [];
    const expectedOwnership = sourceIds.flatMap((id) => configuredById.get(id).owned_paths
      .map((path) => `${id}\0${path}`));
    const assignedOwnership = assignments.map((assignment) => `${assignment.sourceDomainId}\0${assignment.sourcePath}`);
    if (assignments.some((assignment) => !sourceIds.includes(assignment.sourceDomainId)
      || !resultIds.includes(assignment.resultDomainId))
      || new Set(assignedOwnership).size !== assignedOwnership.length
      || expectedOwnership.length !== assignedOwnership.length
      || expectedOwnership.some((entry) => !assignedOwnership.includes(entry))) {
      throw new TorchError('Every source ownership pattern must be assigned exactly once to a result domain', {
        code: 'FLEET_OWNERSHIP_ASSIGNMENT_INVALID',
        details: { expected: expectedOwnership, assigned: assignedOwnership },
      });
    }
    const resultOwnership = resultDomains.flatMap((domain) => domain.owned_paths
      .map((path) => ({ domainId: domain.id, path })));
    const assignedResults = assignments.map((assignment) => `${assignment.resultDomainId}\0${assignment.sourcePath}`);
    const declaredResults = resultOwnership.map((entry) => `${entry.domainId}\0${entry.path}`);
    if (new Set(declaredResults).size !== declaredResults.length
      || assignedResults.length !== declaredResults.length
      || assignedResults.some((entry) => !declaredResults.includes(entry))) {
      throw new TorchError('Result owned paths must exactly match the explicit ownership assignments', {
        code: 'FLEET_OWNERSHIP_ASSIGNMENT_INVALID', details: { assigned: assignedResults, declared: declaredResults },
      });
    }
    for (let left = 0; left < resultOwnership.length; left += 1) {
      for (let right = left + 1; right < resultOwnership.length; right += 1) {
        if (resultOwnership[left].domainId !== resultOwnership[right].domainId
          && pathsOverlap(resultOwnership[left].path, resultOwnership[right].path)) {
          throw new TorchError('Result domains have overlapping ownership', {
            code: 'FLEET_OWNERSHIP_COLLISION', details: [resultOwnership[left], resultOwnership[right]],
          });
        }
      }
    }
    const unaffected = config.domains.filter((domain) => !sourceIds.includes(domain.id));
    const externalCollisions = resultOwnership.flatMap((result) => unaffected.flatMap((domain) =>
      domain.owned_paths.filter((path) => pathsOverlap(result.path, path))
        .map((path) => ({ resultDomainId: result.domainId, resultPath: result.path, areaId: domain.id, existingPath: path }))));
    if (externalCollisions.length) {
      throw new TorchError('Result ownership overlaps an unaffected Fleet domain', {
        code: 'FLEET_OWNERSHIP_COLLISION', details: externalCollisions,
      });
    }
    const now = this.clock().toISOString();
    const proposal = {
      schema: 'torch.dev/fleet-boundary-proposal/v1alpha1',
      operation: changeType === 'merge-domains' ? 'merge' : 'split',
      configDigest: configDigest(this.repositoryRoot),
      sourceDomains: sourceIds.map((id) => configuredById.get(id)),
      resultDomains, ownershipAssignments: assignments,
    };
    const record = {
      id: this.idFactory(), type: changeType, state: 'proposed', proposer: actor,
      createdAt: now, updatedAt: now, baseCommit: git(this.repositoryRoot, ['rev-parse', 'HEAD']),
      approvedBy: null, approvedAt: null, activationCommit: null, domain: null, proposal,
      rationale: requiredText(rationale, 'rationale'), expectedBenefit: expectedBenefit(benefitInput),
      evidence: textList(evidence, 'evidence', { required: true }),
    };
    this.database.prepare(`
      INSERT INTO fleet_changes (
        id, change_type, state, proposer, created_at, updated_at, base_commit, approved_by,
        approved_at, activation_commit, domain_json, rationale, expected_benefit_json, evidence_json,
        proposal_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 'null', ?, ?, ?, ?)
    `).run(
      record.id, record.type, record.state, record.proposer, record.createdAt, record.updatedAt,
      record.baseCommit, record.rationale, JSON.stringify(record.expectedBenefit),
      JSON.stringify(record.evidence), JSON.stringify(proposal),
    );
    this.controlPlane.audit({
      actorId: actor, operation: `fleet-change.propose-${proposal.operation}`,
      entityType: 'fleet-change', entityId: record.id,
      details: { sourceDomains: sourceIds, resultDomains: resultIds, baseCommit: record.baseCommit },
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

  reject({ changeId, rejectedBy, reason } = {}) {
    const change = this.get(changeId);
    if (change.state !== 'proposed') {
      throw new TorchError(`Fleet change ${change.id} is ${change.state}, not proposed`, { code: 'FLEET_CHANGE_STATE_CONFLICT' });
    }
    const owner = requiredText(rejectedBy, 'rejectedBy');
    const explanation = requiredText(reason, 'reason');
    const now = this.clock().toISOString();
    this.database.prepare(`
      UPDATE fleet_changes SET state = 'rejected', rejected_by = ?, rejected_at = ?,
        rejection_reason = ?, updated_at = ?
      WHERE id = ? AND state = 'proposed'
    `).run(owner, now, explanation, now, change.id);
    this.controlPlane.audit({
      actorId: 'session-manager', operation: 'fleet-change.owner-rejected', entityType: 'fleet-change', entityId: change.id,
      details: { rejectedBy: owner, reason: explanation },
    });
    return this.get(change.id);
  }

  planActivation(changeId) {
    const change = this.get(changeId);
    if (change.type === 'retire-domain') return this.planRetirement(change);
    if (change.type === 'merge-domains' || change.type === 'split-domain') {
      return this.planBoundaryChange(change);
    }
    const config = loadProjectConfig(this.repositoryRoot);
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
    if (change.type === 'retire-domain') return this.retire(change, approvedBy);
    if (change.type === 'merge-domains' || change.type === 'split-domain') {
      throw new TorchError('Merge and split approval does not authorize automatic ownership migration', {
        code: 'FLEET_BOUNDARY_MIGRATION_REQUIRED', details: this.planBoundaryChange(change),
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

  planBoundaryChange(changeOrId) {
    const change = typeof changeOrId === 'string' ? this.get(changeOrId) : changeOrId;
    const currentHead = git(this.repositoryRoot, ['rev-parse', 'HEAD']);
    const config = loadProjectConfig(this.repositoryRoot);
    const configuredById = new Map(config.domains.map((domain) => [domain.id, domain]));
    const proposal = change.proposal;
    const blockers = [];
    if (change.state !== 'approved') blockers.push({ type: 'state', actual: change.state, required: 'approved' });
    if (currentHead !== change.baseCommit) blockers.push({ type: 'stale-head', expected: change.baseCommit, actual: currentHead });
    const currentDigest = configDigest(this.repositoryRoot);
    if (currentDigest !== proposal.configDigest) {
      blockers.push({ type: 'configuration-changed', expected: proposal.configDigest, actual: currentDigest });
    }
    for (const source of proposal.sourceDomains) {
      const current = configuredById.get(source.id);
      if (!current) blockers.push({ type: 'source-domain-missing', domainId: source.id });
      else if (stableDomain(current) !== stableDomain(source)) blockers.push({ type: 'source-domain-changed', domainId: source.id });
    }
    blockers.push({
      type: 'manual-boundary-redesign-required',
      reason: 'A separate migration must prove backlog, branch, prompt, worktree, neighbour, and ownership transfer safety.',
    });
    return {
      action: change.type, changeId: change.id, state: change.state,
      sourceDomains: proposal.sourceDomains.map((domain) => domain.id),
      resultDomains: proposal.resultDomains.map((domain) => domain.id),
      currentHead, baseCommit: change.baseCommit, blockers, canProceed: false, mutationPerformed: false,
    };
  }

  planRetirement(changeOrId) {
    const change = typeof changeOrId === 'string' ? this.get(changeOrId) : changeOrId;
    const config = loadProjectConfig(this.repositoryRoot);
    const roster = readJson(join(this.repositoryRoot, '.torch', 'roster.yaml'), 'ROSTER_INVALID');
    const manifest = readInstallManifest(this.repositoryRoot);
    const currentHead = git(this.repositoryRoot, ['rev-parse', 'HEAD']);
    const dirtyEntries = git(this.repositoryRoot, ['status', '--porcelain']).split('\n').filter(Boolean);
    const worktree = (manifest.external ?? []).find((entry) => entry.type === 'worktree' && entry.area === change.domain.id);
    const blockers = [];
    if (change.state !== 'approved' && change.state !== 'provisioning') blockers.push({ type: 'state', actual: change.state });
    if (change.state === 'approved' && currentHead !== change.baseCommit) blockers.push({ type: 'stale-head', expected: change.baseCommit, actual: currentHead });
    if (change.state === 'approved' && dirtyEntries.length) blockers.push({ type: 'dirty-main', entries: dirtyEntries });
    if (!config.domains.some((entry) => entry.id === change.domain.id)) blockers.push({ type: 'domain-not-configured', domainId: change.domain.id });
    if (config.domains.length <= 1) blockers.push({ type: 'last-development-domain' });
    if (!roster.areas.some((entry) => entry.id === change.domain.id)) blockers.push({ type: 'identity-not-rostered', domainId: change.domain.id });
    if (!worktree) blockers.push({ type: 'worktree-not-managed', domainId: change.domain.id });
    if (worktree) {
      const state = inspectManagedWorktree(this.repositoryRoot, worktree, config.project.main_branch);
      for (const problem of state.problems) blockers.push({ type: 'worktree-unsafe', problem, path: worktree.path });
    }
    const identity = this.controlPlane.identity(change.domain.id);
    if (identity.state !== 'offline') blockers.push({ type: 'runtime-not-offline', state: identity.state });
    if (hasTable(this.database, 'worktree_guards')) {
      const guards = this.database.prepare(`SELECT guard_type AS type, reason FROM worktree_guards
        WHERE area_id = ? AND released_at IS NULL`).all(change.domain.id);
      if (guards.length) blockers.push({ type: 'worktree-guards-active', guards });
    }
    if (hasTable(this.database, 'resource_leases')) {
      const leases = this.database.prepare(`SELECT resource_id AS resourceId FROM resource_leases
        WHERE area_id = ? AND released_at IS NULL`).all(change.domain.id);
      if (leases.length) blockers.push({ type: 'resource-leases-active', leases });
    }
    if (hasTable(this.database, 'integration_requests')) {
      const requests = this.database.prepare(`SELECT id, state FROM integration_requests
        WHERE source_area = ? AND state NOT IN ('landed', 'superseded')`).all(change.domain.id);
      if (requests.length) blockers.push({ type: 'integration-active', requests });
    }
    const manager = (manifest.external ?? []).find((entry) => entry.type === 'worktree' && entry.area === 'session-manager');
    const backlogRoot = join(manager?.path && existsSync(manager.path) ? manager.path : this.repositoryRoot, '.torch', 'backlog');
    if (existsSync(backlogRoot)) {
      const tasks = readdirSync(backlogRoot).filter((name) => name.endsWith('.json')).flatMap((name) => {
        try {
          const task = readJson(join(backlogRoot, name), 'BACKLOG_INVALID');
          const active = !['completed', 'cancelled'].includes(task.state)
            && (task.owner === change.domain.id || task.affectedDomains?.includes(change.domain.id));
          return active ? [{ id: task.id, state: task.state }] : [];
        } catch { return [{ id: name, state: 'invalid' }]; }
      });
      if (tasks.length) blockers.push({ type: 'backlog-active', tasks });
    }
    return {
      action: 'retire-domain', changeId: change.id, domainId: change.domain.id,
      state: change.state, branch: worktree?.branch ?? change.domain.branch,
      worktree: worktree?.path ?? null, currentHead, baseCommit: change.baseCommit,
      blockers, canProceed: blockers.length === 0, mutationPerformed: false,
    };
  }

  retire(change, approvedBy) {
    const plan = this.planRetirement(change);
    if (!plan.canProceed) throw new TorchError('Fleet domain retirement is blocked', { code: 'FLEET_CHANGE_BLOCKED', details: plan.blockers });
    const owner = requiredText(approvedBy, 'approvedBy');
    git(this.repositoryRoot, ['worktree', 'remove', plan.worktree]);
    try {
      this.commitRetirement(change, plan, owner);
    } catch (error) {
      git(this.repositoryRoot, ['worktree', 'add', plan.worktree, plan.branch], { optional: true });
      throw error;
    }
    this.controlPlane.refreshRoster();
    this.controlPlane.audit({
      actorId: 'session-manager', operation: 'fleet-change.retire-domain', entityType: 'fleet-change', entityId: change.id,
      details: { domainId: change.domain.id, branch: plan.branch },
    });
    return { ...this.get(change.id), branch: plan.branch, worktree: plan.worktree, mutationPerformed: true };
  }

  commitRetirement(change, plan, approvedBy) {
    const config = loadProjectConfig(this.repositoryRoot);
    const rosterPath = join(this.repositoryRoot, '.torch', 'roster.yaml');
    const roster = readJson(rosterPath, 'ROSTER_INVALID');
    const manifest = readInstallManifest(this.repositoryRoot);
    config.domains = config.domains.filter((entry) => entry.id !== change.domain.id);
    config.retired_domains ??= [];
    config.retired_domains.push({
      id: change.domain.id, title: change.domain.title, branch: plan.branch,
      change_id: change.id, retired_at: this.clock().toISOString(),
    });
    roster.areas = roster.areas.filter((entry) => entry.id !== change.domain.id)
      .map((entry) => ({ ...entry, neighbours: (entry.neighbours ?? []).filter((id) => id !== change.domain.id) }));
    manifest.external = (manifest.external ?? []).filter((entry) => !(entry.type === 'worktree' && entry.area === change.domain.id));
    const changeRelative = `.torch/fleet-changes/${change.id}.retired.json`;
    const record = {
      schema: 'torch.dev/fleet-change/v1alpha1', ...change, state: 'retired', approvedBy,
      retirement: { branch: plan.branch, worktreeRemoved: plan.worktree, branchPreserved: true },
    };
    const serialized = new Map([
      ['.torch/torch.yaml', `${JSON.stringify(config, null, 2)}\n`],
      ['.torch/roster.yaml', `${JSON.stringify(roster, null, 2)}\n`],
      [changeRelative, `${JSON.stringify(record, null, 2)}\n`],
    ]);
    for (const [relativePath, content] of serialized) {
      const existing = manifest.created.find((entry) => entry.path === relativePath);
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
    git(this.repositoryRoot, ['commit', '-m', `chore(torch): retire ${change.domain.id} domain`]);
    const activationCommit = git(this.repositoryRoot, ['rev-parse', 'HEAD']);
    const now = this.clock().toISOString();
    this.database.prepare(`UPDATE fleet_changes SET state = 'retired', activation_commit = ?, updated_at = ? WHERE id = ?`)
      .run(activationCommit, now, change.id);
  }

  commitConfiguration(change, plan, ignore) {
    const rosterPath = join(this.repositoryRoot, '.torch', 'roster.yaml');
    const config = loadProjectConfig(this.repositoryRoot);
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
