import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  closeSync, existsSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync, writeSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { TorchError } from '../kernel/errors.mjs';
import { readInstallManifest } from '../kernel/install.mjs';
import { loadFleetDefinition } from '../kernel/worktrees.mjs';
import { organizationGraphFromConfig } from '../kernel/organization.mjs';
import { commitTaskReferences, observeTaskActivity } from './activity.mjs';

export const BACKLOG_STATES = Object.freeze([
  'proposed', 'ready', 'assigned', 'in_progress', 'blocked',
  'verification', 'ready_to_integrate', 'completed', 'cancelled',
]);

const TRANSITIONS = new Map([
  ['proposed', new Set(['ready', 'cancelled'])],
  ['ready', new Set(['assigned', 'cancelled'])],
  ['assigned', new Set(['in_progress', 'blocked', 'cancelled'])],
  ['in_progress', new Set(['blocked', 'verification', 'cancelled'])],
  ['blocked', new Set(['assigned', 'in_progress', 'cancelled'])],
  ['verification', new Set(['in_progress', 'blocked', 'ready_to_integrate'])],
  ['ready_to_integrate', new Set(['in_progress', 'blocked', 'completed'])],
  ['completed', new Set()],
  ['cancelled', new Set()],
]);

const PRIORITIES = new Set(['urgent', 'high', 'normal', 'low']);
const WORKER_TRANSITIONS = new Set(['in_progress', 'blocked', 'verification', 'ready_to_integrate']);
const ACTIVE_ASSIGNMENT_STATES = new Set(['assigned', 'in_progress', 'verification', 'ready_to_integrate']);
const PRIORITY_ORDER = { urgent: 0, high: 1, normal: 2, low: 3 };

function queueOrder(left, right) {
  return (PRIORITY_ORDER[left.priority ?? 'normal'] - PRIORITY_ORDER[right.priority ?? 'normal'])
    || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function requiredText(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TorchError(`${name} must be a non-empty string`, {
      code: 'INVALID_BACKLOG_INPUT', details: { field: name },
    });
  }
  return value.trim();
}

function textList(value, name, { required = false } = {}) {
  if (!Array.isArray(value) || (required && value.length === 0)) {
    throw new TorchError(`${name} must be ${required ? 'a non-empty' : 'an'} array`, {
      code: 'INVALID_BACKLOG_INPUT', details: { field: name },
    });
  }
  return [...new Set(value.map((item) => requiredText(item, name)))];
}

function taskId(value) {
  const id = requiredText(value, 'taskId');
  if (!/^TASK-[A-Za-z0-9-]+$/.test(id)) {
    throw new TorchError(`Invalid backlog task ID: ${id}`, { code: 'INVALID_BACKLOG_TASK_ID' });
  }
  return id;
}

function optionalObservedAt(value) {
  if (value === undefined || value === null || value === '') return null;
  const observedAt = requiredText(value, 'observedAt');
  if (!/^[0-9a-f]{7,64}$/i.test(observedAt)) {
    throw new TorchError('observedAt must be a Git commit SHA', {
      code: 'INVALID_BACKLOG_INPUT', details: { field: 'observedAt' },
    });
  }
  return observedAt;
}

function optionalInitiativeLabel(value, name) {
  if (value === undefined || value === null) return null;
  const label = requiredText(value, name);
  if (label.length > 120) {
    throw new TorchError(`${name} must be at most 120 characters`, {
      code: 'INVALID_BACKLOG_INPUT', details: { field: name },
    });
  }
  return label;
}

function normalizeCreateFields({
  title, description, priority = 'normal', affectedDomains = [], dependencies = [],
  acceptanceCriteria, observedAt, feature, milestone,
} = {}, { controlPlane, repositoryRoot, getTask }) {
  if (!PRIORITIES.has(priority)) {
    throw new TorchError(`Invalid backlog priority: ${priority}`, { code: 'INVALID_BACKLOG_PRIORITY' });
  }
  const domains = textList(affectedDomains, 'affectedDomains');
  domains.forEach((areaId) => controlPlane.assertIdentity(areaId));
  const dependencyIds = textList(dependencies, 'dependencies');
  dependencyIds.forEach((id) => getTask(taskId(id)));
  return {
    title: requiredText(title, 'title'),
    description: requiredText(description, 'description'),
    priority,
    affectedDomains: domains,
    dependencies: dependencyIds,
    acceptanceCriteria: textList(acceptanceCriteria, 'acceptanceCriteria', { required: true }),
    observedAt: optionalObservedAt(observedAt) ?? headSha(repositoryRoot),
    feature: feature === '' ? null : optionalInitiativeLabel(feature, 'feature'),
    milestone: milestone === '' ? null : optionalInitiativeLabel(milestone, 'milestone'),
  };
}

function headSha(repositoryRoot) {
  try {
    return execFileSync('git', ['-C', repositoryRoot, 'rev-parse', '--short=12', 'HEAD'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null;
  } catch {
    return null;
  }
}

export function backlogObservedCommitDistance(repositoryRoot, observedAt) {
  try {
    const value = execFileSync('git', ['-C', repositoryRoot, 'rev-list', '--count', `${observedAt}..HEAD`], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return Number.isInteger(Number(value)) ? Number(value) : null;
  } catch {
    return null;
  }
}

export function assessBacklogHealth({
  tasks, agents = [], now = new Date(), staleAfterDays = 7, staleObservedCommits = 50,
  commitDistance = () => null,
} = {}) {
  const assessedAt = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(assessedAt.getTime())) {
    throw new TorchError('Backlog health requires a valid assessment time', { code: 'INVALID_BACKLOG_INPUT' });
  }
  if (!Number.isInteger(staleAfterDays) || staleAfterDays < 0
    || !Number.isInteger(staleObservedCommits) || staleObservedCommits < 0) {
    throw new TorchError('Backlog health thresholds must be non-negative integers', {
      code: 'INVALID_BACKLOG_INPUT',
    });
  }
  const items = Array.isArray(tasks) ? tasks : [];
  const agentById = new Map(agents.map((agent) => [agent.areaId ?? agent.area_id, agent]));
  const taskById = new Map(items.map((task) => [task.id, task]));
  const findings = [];
  const activeByOwner = new Map();

  for (const task of items) {
    if (task.owner && ACTIVE_ASSIGNMENT_STATES.has(task.state)) {
      const owned = activeByOwner.get(task.owner) ?? [];
      owned.push(task);
      activeByOwner.set(task.owner, owned);
    }
  }
  for (const [owner, owned] of activeByOwner) {
    if (owned.length > 1) findings.push({
      severity: 'error', code: 'BACKLOG_MULTIPLE_ACTIVE_ASSIGNMENTS', owner,
      tasks: owned.map((task) => ({ id: task.id, state: task.state })),
      recommendation: 'Keep one active assignment for this specialist and deliberately requeue the others.',
    });
  }

  for (const task of items) {
    const referencedAreas = [...new Set([task.owner, ...(task.affectedDomains ?? [])].filter(Boolean))];
    const unknownAreas = referencedAreas.filter((areaId) => !agentById.has(areaId));
    if (unknownAreas.length) findings.push({
      severity: 'error', code: 'BACKLOG_AREA_UNKNOWN', taskId: task.id, areas: unknownAreas,
      recommendation: 'Route the task to a defined Fleet identity or restore the retired identity before assignment.',
    });

    if (task.state === 'assigned') {
      const updatedAt = Date.parse(task.updatedAt);
      const ageDays = Number.isFinite(updatedAt)
        ? Math.floor(Math.max(0, assessedAt.getTime() - updatedAt) / 86_400_000) : null;
      if (ageDays === null || ageDays >= staleAfterDays) findings.push({
        severity: 'warning', code: 'BACKLOG_ASSIGNED_STALE', taskId: task.id, owner: task.owner, ageDays,
        recommendation: 'Confirm the specialist is still working this assignment before routing more work.',
      });
    }

    if (task.owner && ACTIVE_ASSIGNMENT_STATES.has(task.state)) {
      const agent = agentById.get(task.owner);
      if (agent && (agent.state === 'offline' || !agent.runtimeSessionId && !agent.runtime_session_id)) findings.push({
        severity: 'warning', code: 'BACKLOG_ASSIGNED_SESSION_MISSING', taskId: task.id, owner: task.owner,
        recommendation: 'Resume the owning specialist or explicitly requeue the task; do not silently assign a second item.',
      });
    }

    if (task.state === 'blocked' && (task.dependencies ?? []).length > 0
      && task.dependencies.every((dependency) => taskById.get(dependency)?.state === 'completed')) {
      findings.push({
        severity: 'warning', code: 'BACKLOG_BLOCKED_DEPENDENCIES_RESOLVED', taskId: task.id,
        dependencies: task.dependencies,
        recommendation: 'Re-check the blocker; all recorded dependencies are now complete.',
      });
    }

    if (task.state === 'ready' && (task.affectedDomains ?? []).length > 0) {
      const defined = task.affectedDomains.map((areaId) => agentById.get(areaId)).filter(Boolean);
      if (defined.length > 0 && defined.every((agent) => agent.state === 'offline')) findings.push({
        severity: 'warning', code: 'BACKLOG_READY_NO_LIVE_SPECIALIST', taskId: task.id,
        areas: defined.map((agent) => agent.areaId ?? agent.area_id),
        recommendation: 'Start or restore an eligible specialist when this ready work should be dispatched.',
      });
    }

    if (task.observedAt) {
      const distance = commitDistance(task.observedAt);
      if (distance === null) findings.push({
        severity: 'warning', code: 'BACKLOG_OBSERVED_COMMIT_MISSING', taskId: task.id, observedAt: task.observedAt,
        recommendation: 'Re-observe the task against a reachable commit before implementation.',
      });
      else if (distance >= staleObservedCommits) findings.push({
        severity: 'warning', code: 'BACKLOG_OBSERVED_COMMIT_STALE', taskId: task.id,
        observedAt: task.observedAt, commitsBehind: distance,
        recommendation: 'Verify the issue still reproduces before changing code.',
      });
    }
  }

  return {
    schema: 'torch.dev/backlog-health/v1alpha1', assessedAt: assessedAt.toISOString(),
    healthy: findings.length === 0, findings, mutationPerformed: false,
  };
}

function parseTask(path) {
  let task;
  try { task = JSON.parse(readFileSync(path, 'utf8')); } catch (error) {
    throw new TorchError(`Cannot read backlog task at ${path}`, {
      code: 'BACKLOG_TASK_INVALID', details: error.message,
    });
  }
  if (task.schema !== 'torch.dev/backlog-item/v1alpha1'
    || !BACKLOG_STATES.includes(task.state)
    || !Number.isInteger(task.revision)) {
    throw new TorchError(`Backlog task has invalid schema or state: ${path}`, {
      code: 'BACKLOG_TASK_INVALID', details: { path },
    });
  }
  return task;
}

function atomicTask(path, task) {
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(temporary, `${JSON.stringify(task, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  renameSync(temporary, path);
}

export class BacklogService {
  constructor({
    repositoryRoot, controlPlane, integrationLookup = null, checkService = null,
    clock = () => new Date(), idFactory = randomUUID,
  } = {}) {
    this.repositoryRoot = repositoryRoot;
    this.controlPlane = controlPlane;
    this.integrationLookup = integrationLookup;
    this.checkService = checkService;
    this.clock = clock;
    this.idFactory = idFactory;
    const manifest = readInstallManifest(repositoryRoot);
    const managerWorktree = (manifest.external ?? []).find((entry) =>
      entry.type === 'worktree' && entry.area === 'session-manager');
    this.managerWorktreeAvailable = Boolean(managerWorktree?.path && existsSync(managerWorktree.path));
    this.root = join(
      this.managerWorktreeAvailable ? managerWorktree.path : repositoryRoot,
      '.torch', 'backlog',
    );
    if (!existsSync(this.root)) {
      throw new TorchError('Tracked backlog directory is missing', { code: 'BACKLOG_DIRECTORY_MISSING' });
    }
  }

  #assertMutable() {
    if (!this.managerWorktreeAvailable) {
      throw new TorchError('Backlog mutations require the Session Manager worktree', {
        code: 'BACKLOG_WORKTREE_MISSING',
      });
    }
  }

  #path(id) {
    return join(this.root, `${taskId(id)}.json`);
  }

  #withTaskLock(id, callback) {
    const normalized = taskId(id);
    const path = join(this.controlPlane.stateRoot, 'locks', `backlog-${normalized}.lock`);
    let descriptor;
    try {
      descriptor = openSync(path, 'wx', 0o600);
      writeSync(descriptor, `${JSON.stringify({ taskId: normalized, createdAt: this.clock().toISOString() })}\n`);
    } catch (error) {
      if (error.code === 'EEXIST') {
        throw new TorchError(`Backlog task is already being updated: ${normalized}`, {
          code: 'BACKLOG_TASK_LOCKED', details: { taskId: normalized, lockPath: path },
        });
      }
      throw error;
    }
    try { return callback(); } finally {
      closeSync(descriptor);
      unlinkSync(path);
    }
  }

  #withAssignmentLock(callback) {
    const path = join(this.controlPlane.stateRoot, 'locks', 'backlog-assignment.lock');
    let descriptor;
    try {
      descriptor = openSync(path, 'wx', 0o600);
      writeSync(descriptor, `${JSON.stringify({ createdAt: this.clock().toISOString() })}\n`);
    } catch (error) {
      if (error.code === 'EEXIST') {
        throw new TorchError('Another backlog assignment is already being evaluated', {
          code: 'BACKLOG_ASSIGNMENT_LOCKED', details: { lockPath: path },
        });
      }
      throw error;
    }
    try { return callback(); } finally {
      closeSync(descriptor);
      unlinkSync(path);
    }
  }

  get(id) {
    const path = this.#path(id);
    if (!existsSync(path)) throw new TorchError(`Unknown backlog task: ${id}`, { code: 'BACKLOG_TASK_NOT_FOUND' });
    return parseTask(path);
  }

  list({ state, owner } = {}) {
    if (state && !BACKLOG_STATES.includes(state)) {
      throw new TorchError(`Invalid backlog state: ${state}`, { code: 'INVALID_BACKLOG_STATE' });
    }
    if (owner) this.controlPlane.assertIdentity(owner);
    return readdirSync(this.root)
      .filter((name) => /^TASK-[A-Za-z0-9-]+\.json$/.test(name))
      .map((name) => parseTask(join(this.root, name)))
      .filter((task) => (!state || task.state === state) && (!owner || task.owner === owner))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  }

  next({ areaId } = {}) {
    const area = this.controlPlane.assertIdentity(areaId);
    if (area === 'session-manager') {
      throw new TorchError('Session Manager does not consume the specialist implementation queue', {
        code: 'BACKLOG_OWNER_INVALID', details: { areaId: area },
      });
    }
    const tasks = this.list();
    const active = tasks.filter((task) => task.owner === area && ACTIVE_ASSIGNMENT_STATES.has(task.state));
    if (active.length > 1) {
      throw new TorchError(`${area} has multiple active backlog assignments`, {
        code: 'BACKLOG_MULTIPLE_ACTIVE_ASSIGNMENTS',
        details: { areaId: area, tasks: active.map((task) => ({ id: task.id, state: task.state })) },
      });
    }
    if (active.length === 1) {
      return {
        schema: 'torch.dev/backlog-next/v1alpha1', areaId: area, disposition: 'resume',
        task: active[0], mutationPerformed: false,
      };
    }
    const ready = tasks.filter((task) => task.state === 'ready'
      && (!task.owner || task.owner === area)
      && (!task.affectedDomains.length || task.affectedDomains.includes(area))
      && task.dependencies.every((dependency) => tasks.find((item) => item.id === dependency)?.state === 'completed'))
      .sort(queueOrder)[0];
    return {
      schema: 'torch.dev/backlog-next/v1alpha1', areaId: area,
      disposition: ready ? 'ready' : 'idle', task: ready ?? null, mutationPerformed: false,
    };
  }

  health({ staleAfterDays = 7, staleObservedCommits = 50, now = this.clock() } = {}) {
    const result = assessBacklogHealth({
      tasks: this.list(), agents: this.controlPlane.listAgents(), now,
      staleAfterDays, staleObservedCommits,
      commitDistance: (observedAt) => backlogObservedCommitDistance(this.repositoryRoot, observedAt),
    });
    try {
      result.activity = this.activity({ now });
      result.findings.push(...result.activity.stale.map((task) => ({
        severity: 'warning', code: 'BACKLOG_TASK_NO_RECENT_COMMIT', taskId: task.taskId,
        ownerRequested: task.ownerRequested, ageDays: task.ageDays, state: task.state,
        recommendation: 'Review linked work and acceptance; revive, close with evidence, or record the real wait. No automatic repair.',
      })));
    } catch (error) {
      result.activity = { available: false, reason: error.code ?? error.message };
      result.findings.push({ severity: 'warning', code: 'BACKLOG_ACTIVITY_UNAVAILABLE', reason: result.activity.reason,
        recommendation: 'Restore managed branch observation before treating absence of commits as evidence.' });
    }
    result.healthy = result.findings.length === 0;
    return result;
  }

  activity({ staleDays, maxCommits, now = this.clock() } = {}) {
    const { config } = loadFleetDefinition(this.repositoryRoot);
    const manifest = readInstallManifest(this.repositoryRoot);
    return observeTaskActivity({
      repositoryRoot: this.repositoryRoot, tasks: this.list(), now,
      staleDays: staleDays ?? config.backlog?.activity?.stale_days ?? 3,
      maxCommits: maxCommits ?? config.backlog?.activity?.max_commits ?? 1000,
      branches: [config.project.main_branch, ...(manifest.external ?? [])
        .filter((entry) => entry.type === 'worktree').map((entry) => entry.branch)],
    });
  }

  planLandedClosure({ integrationRequest, actorId } = {}) {
    const actor = this.controlPlane.assertIdentity(actorId);
    if (actor !== 'session-manager') throw new TorchError('Only Fleet Operations may reconcile landed task closure', {
      code: 'BACKLOG_AUTHORITY_REQUIRED',
    });
    const { config } = loadFleetDefinition(this.repositoryRoot);
    const request = this.integrationLookup?.(integrationRequest);
    const blockers = [];
    const target = config.integration?.target ?? config.project.main_branch;
    if (!request || request.state !== 'landed' || request.projectId !== this.controlPlane.projectId
      || request.targetBranch !== target || !/^[0-9a-f]{40,64}$/.test(request.sourceCommit ?? '')) {
      blockers.push('matching-landed-integration-required');
    }
    const sourceArea = config.domains.find((area) => area.id === request?.sourceArea);
    if (!sourceArea) blockers.push('current-source-area-required');
    const requiredChecks = [...new Set([
      ...(config.integration?.required_checks ?? []), ...(request?.requiredChecks ?? []),
      ...(sourceArea?.required_checks ?? []),
    ])];
    if (!this.checkService || !request || !this.checkService.exactPasses({ commit: request.sourceCommit, requiredChecks })) {
      blockers.push('current-check-evidence-required');
    }
    let closes = [];
    if (!blockers.length) {
      try {
        execFileSync('git', ['-C', this.repositoryRoot, 'merge-base', '--is-ancestor', request.sourceCommit,
          `refs/heads/${target}`], { stdio: 'pipe' });
        const message = execFileSync('git', ['-C', this.repositoryRoot, 'show', '-s', '--format=%B', request.sourceCommit], {
          encoding: 'utf8', maxBuffer: 1024 * 1024,
        });
        closes = commitTaskReferences(message).closes;
      } catch { blockers.push('canonical-ancestry-or-message-unavailable'); }
    }
    const tasks = this.list();
    const candidates = closes.map((taskId) => {
      const task = tasks.find((item) => item.id === taskId);
      const reasons = [];
      const unchanged = task?.state === 'completed' && task.commit === request.sourceCommit
        && task.integrationRequest === request.id;
      if (!task) reasons.push('unknown-task');
      else if (!unchanged) {
        if (task.state !== 'ready_to_integrate') reasons.push('task-not-ready-to-integrate');
        if (task.owner !== request.sourceArea) reasons.push('source-owner-mismatch');
        if (task.commit !== request.sourceCommit) reasons.push('task-commit-mismatch');
        if (!task.evidence.length) reasons.push('task-evidence-required');
      }
      return { taskId, revision: task?.revision ?? null, disposition: unchanged ? 'unchanged' : reasons.length ? 'blocked' : 'close', reasons };
    });
    return { schema: 'torch.dev/landed-task-closure/v1alpha1', integrationRequest,
      automaticEnabled: config.backlog?.activity?.auto_close_after_landing === true,
      canProceed: !blockers.length, blockers, candidates, mutationPerformed: false };
  }

  reconcileLanded({ integrationRequest, actorId, approved = false, automatic = false } = {}) {
    this.#assertMutable();
    const initial = this.planLandedClosure({ integrationRequest, actorId });
    if (!approved && !(automatic && initial.automaticEnabled)) throw new TorchError('Landed closure requires explicit approval or approved automatic policy', {
      code: 'APPROVAL_REQUIRED',
    });
    if (!initial.canProceed) throw new TorchError('Landed task closure evidence is incomplete', {
      code: 'BACKLOG_CLOSURE_BLOCKED', details: initial.blockers,
    });
    const results = initial.candidates.map((candidate) => this.#withTaskLock(candidate.taskId, () => {
      const fresh = this.planLandedClosure({ integrationRequest, actorId });
      if (!fresh.canProceed || (automatic && !fresh.automaticEnabled)) throw new TorchError('Closure policy or evidence changed', {
        code: 'BACKLOG_CLOSURE_BLOCKED', details: fresh.blockers,
      });
      const current = fresh.candidates.find((item) => item.taskId === candidate.taskId);
      if (!current || current.disposition !== 'close') return current ?? { ...candidate, disposition: 'blocked', reasons: ['intent-changed'] };
      const task = this.#applyTransition({ taskId: current.taskId, actorId, to: 'completed',
        expectedRevision: current.revision, integrationRequest, note: 'Exact landed Closes intent reconciled with current checks.' });
      return { ...current, disposition: 'completed', revision: task.revision };
    }));
    return { ...initial, results, mutationPerformed: results.some((item) => item.disposition === 'completed') };
  }

  planClaim({ areaId } = {}) {
    const area = this.controlPlane.assertIdentity(areaId);
    const { config } = loadFleetDefinition(this.repositoryRoot);
    const graph = organizationGraphFromConfig(config);
    if (!graph.roles.some((role) => role.identity_id === area && role.kind === 'specialist'
      && role.authority.includes('own-implementation'))) {
      throw new TorchError('Only implementation specialists may self-claim work', { code: 'BACKLOG_OWNER_INVALID' });
    }
    const current = this.next({ areaId: area });
    if (current.disposition === 'resume') return {
      ...current, action: 'claim-next', canProceed: true, blockers: [], policyRequired: false,
    };
    const tasks = this.list();
    const candidate = tasks.filter((task) => task.state === 'ready'
      && (!task.owner || task.owner === area) && task.affectedDomains.includes(area)
      && task.dependencies.every((dependency) => tasks.find((item) => item.id === dependency)?.state === 'completed'))
      .sort(queueOrder)[0];
    const blockers = [];
    const policy = config.backlog?.self_claim;
    if (!policy?.enabled || !policy.areas.includes(area)) blockers.push({ code: 'BACKLOG_SELF_CLAIM_DISABLED' });
    if (!this.managerWorktreeAvailable) blockers.push({ code: 'BACKLOG_WORKTREE_MISSING' });
    const manifest = readInstallManifest(this.repositoryRoot);
    const worktree = (manifest.external ?? []).find((entry) => entry.type === 'worktree' && entry.area === area);
    let commit = null;
    if (!worktree?.path || !existsSync(worktree.path)) blockers.push({ code: 'WORKTREE_MISSING' });
    else {
      const git = (args) => execFileSync('git', ['-C', worktree.path, ...args], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
      commit = git(['rev-parse', 'HEAD']);
      if (git(['branch', '--show-current']) !== worktree.branch) blockers.push({ code: 'WORKTREE_BRANCH_CHANGED' });
      const entries = git(['status', '--porcelain=v1', '--untracked-files=all']).split('\n').filter(Boolean);
      if (entries.length) blockers.push({ code: 'WORKTREE_DIRTY', entries });
      for (const operation of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'rebase-merge', 'rebase-apply', 'BISECT_LOG']) {
        if (existsSync(resolve(worktree.path, git(['rev-parse', '--git-path', operation])))) {
          blockers.push({ code: 'WORKTREE_GIT_OPERATION', operation });
        }
      }
    }
    const database = this.controlPlane.database;
    const unusual = (table, condition, code) => {
      if (!database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)) return;
      const pending = database.prepare(`SELECT id FROM ${table} WHERE project_id = ? AND ${condition}`)
        .all(this.controlPlane.projectId, area);
      if (pending.length) blockers.push({ code, ids: pending.map((row) => row.id) });
    };
    unusual('worktree_guards', 'area_id = ? AND released_at IS NULL', 'WORKTREE_GUARD_ACTIVE');
    unusual('prepared_checks', "area_id = ? AND state IN ('prepared', 'running')", 'CHECKS_PENDING');
    unusual('integration_requests', "source_area = ? AND state NOT IN ('landed', 'superseded')", 'INTEGRATION_PENDING');
    // Resource tables predate project_id columns. Their database is project-scoped.
    for (const [table, condition, code] of [
      ['resource_leases', 'released_at IS NULL', 'RESOURCE_HELD'],
      ['resource_requests', "state = 'waiting'", 'RESOURCE_WAITING'],
    ]) {
      if (database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)) {
        const pending = database.prepare(`SELECT id FROM ${table} WHERE area_id = ? AND ${condition}`).all(area);
        if (pending.length) blockers.push({ code, ids: pending.map((row) => row.id) });
      }
    }
    const approvals = this.controlPlane.listApprovals({ actorId: area, status: 'pending' });
    if (approvals.length) blockers.push({ code: 'APPROVAL_PENDING', ids: approvals.map((approval) => approval.id) });
    return {
      schema: 'torch.dev/backlog-claim-plan/v1alpha1', action: 'claim-next', areaId: area,
      disposition: blockers.length ? 'blocked' : candidate ? 'ready' : 'idle',
      task: candidate ?? null, commit, blockers, canProceed: blockers.length === 0,
      mutationPerformed: false, policyRequired: true,
      policy: { enabled: Boolean(policy?.enabled), areas: policy?.areas ?? [] },
    };
  }

  claimNext({ areaId } = {}) {
    this.#assertMutable();
    return this.#withAssignmentLock(() => {
      const plan = this.planClaim({ areaId });
      if (!plan.canProceed || plan.disposition !== 'ready') return plan;
      return this.#withTaskLock(plan.task.id, () => {
        const updated = this.#applyTransition({
          taskId: plan.task.id, actorId: plan.areaId, owner: plan.areaId,
          to: 'assigned', expectedRevision: plan.task.revision, note: 'Claimed under approved self-claim policy.',
        }, { selfClaim: true });
        return { ...plan, disposition: 'claimed', task: updated, mutationPerformed: true };
      });
    });
  }

  create({
    actorId, ...input
  } = {}) {
    this.#assertMutable();
    const actor = this.controlPlane.assertIdentity(actorId);
    if (actor !== 'session-manager') {
      throw new TorchError('Only the Session Manager may create durable backlog work', {
        code: 'BACKLOG_AUTHORITY_REQUIRED', details: { actorId: actor },
      });
    }
    const fields = normalizeCreateFields(input, {
      controlPlane: this.controlPlane, repositoryRoot: this.repositoryRoot, getTask: (id) => this.get(id),
    });
    return this.#writeTask(fields, actor);
  }

  planOwnerCreate({ actorId, ...input } = {}) {
    this.#assertMutable();
    this.controlPlane.assertOwnerActor(actorId);
    const fields = normalizeCreateFields(input, {
      controlPlane: this.controlPlane, repositoryRoot: this.repositoryRoot, getTask: (id) => this.get(id),
    });
    return {
      schema: 'torch.dev/backlog-create-plan/v1alpha1',
      task: { ...fields, state: 'proposed', owner: null },
      authority: 'Project owner may propose new work; the Session Manager retains triage and assignment authority.',
      effect: 'Create one proposed, unassigned backlog task. It will not be assigned, dispatched, or start a session.',
      mutationPerformed: false,
    };
  }

  createOwner({ actorId, ...input } = {}) {
    this.#assertMutable();
    const actor = this.controlPlane.assertOwnerActor(actorId);
    const fields = normalizeCreateFields(input, {
      controlPlane: this.controlPlane, repositoryRoot: this.repositoryRoot, getTask: (id) => this.get(id),
    });
    return this.#writeTask(fields, actor, { ownerAction: true });
  }

  #writeTask(fields, actor, { ownerAction = false } = {}) {
    const now = this.clock().toISOString();
    const task = {
      schema: 'torch.dev/backlog-item/v1alpha1',
      id: taskId(`TASK-${this.idFactory()}`), ...fields,
      state: 'proposed', owner: null,
      evidence: [], commit: null, integrationRequest: null, blockedReason: null,
      createdAt: now, updatedAt: now, revision: 1,
      history: [{ from: null, to: 'proposed', actorId: actor, at: now, note: 'Task created.' }],
    };
    const path = this.#path(task.id);
    if (existsSync(path)) throw new TorchError(`Backlog task already exists: ${task.id}`, { code: 'BACKLOG_TASK_EXISTS' });
    atomicTask(path, task);
    const audit = {
      actorId: actor, operation: 'backlog.create', entityType: 'backlog-task', entityId: task.id,
      details: { state: task.state, priority: task.priority, affectedDomains: task.affectedDomains },
    };
    if (ownerAction) this.controlPlane.auditOwnerAction(audit);
    else this.controlPlane.audit(audit);
    return task;
  }

  classify({
    taskId: id, actorId, expectedRevision, feature, milestone,
    clearFeature = false, clearMilestone = false, reason,
  } = {}) {
    this.#assertMutable();
    return this.#withTaskLock(id, () => {
      const actor = this.controlPlane.assertIdentity(actorId);
      if (actor !== 'session-manager') {
        throw new TorchError('Only the Session Manager may classify backlog work by feature or milestone', {
          code: 'BACKLOG_AUTHORITY_REQUIRED', details: { actorId: actor },
        });
      }
      if (typeof clearFeature !== 'boolean' || typeof clearMilestone !== 'boolean'
        || clearFeature && feature !== undefined || clearMilestone && milestone !== undefined) {
        throw new TorchError('Choose either a new initiative label or its explicit clear action', {
          code: 'INVALID_BACKLOG_CLASSIFICATION',
        });
      }
      const hasFeature = feature !== undefined || clearFeature;
      const hasMilestone = milestone !== undefined || clearMilestone;
      if (!hasFeature && !hasMilestone) {
        throw new TorchError('Classifying backlog work requires --feature or --milestone', {
          code: 'INVALID_BACKLOG_CLASSIFICATION',
        });
      }
      const task = this.get(id);
      if (!Number.isInteger(expectedRevision) || expectedRevision !== task.revision) {
        throw new TorchError('Backlog task changed since it was read', {
          code: 'BACKLOG_REVISION_CONFLICT', details: { expectedRevision, actualRevision: task.revision },
        });
      }
      const nextFeature = clearFeature ? null
        : (feature !== undefined ? optionalInitiativeLabel(feature, 'feature') : task.feature ?? null);
      const nextMilestone = clearMilestone ? null
        : (milestone !== undefined ? optionalInitiativeLabel(milestone, 'milestone') : task.milestone ?? null);
      if (nextFeature === (task.feature ?? null) && nextMilestone === (task.milestone ?? null)) {
        return { ...task, mutationPerformed: false, disposition: 'unchanged' };
      }
      const now = this.clock().toISOString();
      const record = {
        actorId: actor, at: now, reason: requiredText(reason, 'reason'),
        from: { feature: task.feature ?? null, milestone: task.milestone ?? null },
        to: { feature: nextFeature, milestone: nextMilestone },
      };
      const updated = {
        ...task, feature: nextFeature, milestone: nextMilestone,
        updatedAt: now, revision: task.revision + 1,
        classificationHistory: [...(task.classificationHistory ?? []), record],
      };
      atomicTask(this.#path(task.id), updated);
      this.controlPlane.audit({
        actorId: actor, operation: 'backlog.classify', entityType: 'backlog-task', entityId: task.id,
        details: { revision: updated.revision, feature: nextFeature, milestone: nextMilestone },
      });
      return { ...updated, mutationPerformed: true, disposition: 'classified' };
    });
  }

  planPriorityChange({ taskId: id, actorId, expectedRevision, priority, reason } = {}) {
    this.#assertMutable();
    this.controlPlane.assertOwnerActor(actorId);
    if (!PRIORITIES.has(priority)) {
      throw new TorchError(`Invalid backlog priority: ${priority}`, { code: 'INVALID_BACKLOG_PRIORITY' });
    }
    const task = this.get(id);
    if (!Number.isInteger(expectedRevision) || expectedRevision !== task.revision) {
      throw new TorchError('Backlog task changed since it was read', {
        code: 'BACKLOG_REVISION_CONFLICT', details: { expectedRevision, actualRevision: task.revision },
      });
    }
    return {
      schema: 'torch.dev/backlog-priority-plan/v1alpha1', mutationPerformed: false,
      taskId: task.id, title: task.title, revision: task.revision,
      from: task.priority ?? 'normal', to: priority, reason: requiredText(reason, 'reason'),
      effect: 'Change only this task priority. State, owner, evidence, dependencies, and queue history stay unchanged.',
    };
  }

  setPriority({ taskId: id, actorId, expectedRevision, priority, reason } = {}) {
    this.#assertMutable();
    return this.#withTaskLock(id, () => {
      const actor = this.controlPlane.assertOwnerActor(actorId);
      if (!PRIORITIES.has(priority)) {
        throw new TorchError(`Invalid backlog priority: ${priority}`, { code: 'INVALID_BACKLOG_PRIORITY' });
      }
      const task = this.get(id);
      if (!Number.isInteger(expectedRevision) || expectedRevision !== task.revision) {
        throw new TorchError('Backlog task changed since it was read', {
          code: 'BACKLOG_REVISION_CONFLICT', details: { expectedRevision, actualRevision: task.revision },
        });
      }
      const note = requiredText(reason, 'reason');
      if ((task.priority ?? 'normal') === priority) {
        return { ...task, mutationPerformed: false, disposition: 'unchanged' };
      }
      const now = this.clock().toISOString();
      const updated = {
        ...task, priority, updatedAt: now, revision: task.revision + 1,
        priorityHistory: [...(task.priorityHistory ?? []), {
          actorId: actor, at: now, reason: note, from: task.priority ?? 'normal', to: priority,
        }],
      };
      atomicTask(this.#path(task.id), updated);
      this.controlPlane.auditOwnerAction({
        actorId: actor, operation: 'backlog.priority', entityType: 'backlog-task', entityId: task.id,
        details: { revision: updated.revision, from: task.priority ?? 'normal', to: priority },
      });
      return { ...updated, mutationPerformed: true, disposition: 'reprioritized' };
    });
  }

  transition(input = {}) {
    this.#assertMutable();
    const apply = () => this.#withTaskLock(input.taskId, () => this.#applyTransition(input));
    return ACTIVE_ASSIGNMENT_STATES.has(input.to) ? this.#withAssignmentLock(apply) : apply();
  }

  #applyTransition({
    taskId: id, actorId, to, expectedRevision, owner, evidence = [], commit,
    integrationRequest, blockedReason, note,
  } = {}, { selfClaim = false } = {}) {
    const actor = this.controlPlane.assertIdentity(actorId);
    const target = requiredText(to, 'to');
    if (!BACKLOG_STATES.includes(target)) {
      throw new TorchError(`Invalid backlog state: ${target}`, { code: 'INVALID_BACKLOG_STATE' });
    }
    const task = this.get(id);
    if (!Number.isInteger(expectedRevision) || expectedRevision !== task.revision) {
      throw new TorchError('Backlog task changed since it was read', {
        code: 'BACKLOG_REVISION_CONFLICT', details: { expectedRevision, actualRevision: task.revision },
      });
    }
    if (!TRANSITIONS.get(task.state).has(target)) {
      throw new TorchError(`Backlog transition ${task.state} -> ${target} is not allowed`, {
        code: 'BACKLOG_TRANSITION_INVALID', details: { from: task.state, to: target },
      });
    }
    if (selfClaim && (target !== 'assigned' || actor !== owner || task.state !== 'ready'
      || !task.affectedDomains.includes(actor))) {
      throw new TorchError('Self-claim is restricted to routed ready work for this specialist', { code: 'BACKLOG_AUTHORITY_REQUIRED' });
    }
    if (actor !== 'session-manager' && !selfClaim && (actor !== task.owner || !WORKER_TRANSITIONS.has(target))) {
      throw new TorchError(`${actor} may not transition ${task.id} to ${target}`, {
        code: 'BACKLOG_AUTHORITY_REQUIRED', details: { actorId: actor, owner: task.owner, to: target },
      });
    }
    const nextOwner = owner ?? task.owner;
    if (owner !== undefined && target !== 'assigned' && owner !== task.owner) {
      throw new TorchError('Backlog ownership changes require an assigned transition', {
        code: 'BACKLOG_OWNER_CHANGE_INVALID', details: { from: task.owner, to: owner },
      });
    }
    if (target === 'assigned') {
      const assigned = this.controlPlane.assertIdentity(nextOwner);
      if (assigned === 'session-manager') {
        throw new TorchError('Session Manager does not own implementation tasks by default', {
          code: 'BACKLOG_OWNER_INVALID',
        });
      }
      if (task.affectedDomains.length && !task.affectedDomains.includes(assigned)) {
        throw new TorchError(`${assigned} is outside the task's affected domains`, {
          code: 'BACKLOG_OWNER_INVALID', details: { owner: assigned, affectedDomains: task.affectedDomains },
        });
      }
      for (const dependency of task.dependencies) {
        if (this.get(dependency).state !== 'completed') {
          throw new TorchError(`Backlog dependency is not completed: ${dependency}`, {
            code: 'BACKLOG_DEPENDENCY_INCOMPLETE', details: { dependency },
          });
        }
      }
    }
    if (ACTIVE_ASSIGNMENT_STATES.has(target) && nextOwner) {
      const existing = this.list().find((candidate) => candidate.id !== task.id
        && candidate.owner === nextOwner && ACTIVE_ASSIGNMENT_STATES.has(candidate.state));
      if (existing) {
        throw new TorchError(`${nextOwner} already has active backlog work`, {
          code: 'BACKLOG_OWNER_BUSY',
          details: { owner: nextOwner, taskId: existing.id, state: existing.state },
        });
      }
    }
    const nextEvidence = [...new Set([...task.evidence, ...textList(evidence, 'evidence')])];
    const nextCommit = commit ?? task.commit;
    const nextIntegration = integrationRequest ?? task.integrationRequest;
    if (['verification', 'ready_to_integrate', 'completed'].includes(target)
      && (!nextCommit || nextEvidence.length === 0)) {
      throw new TorchError(`${target} requires commit and evidence`, {
        code: 'BACKLOG_EVIDENCE_REQUIRED', details: { state: target },
      });
    }
    if (target === 'blocked' && !blockedReason) {
      throw new TorchError('Blocked tasks require a reason', { code: 'BACKLOG_BLOCK_REASON_REQUIRED' });
    }
    if (target === 'completed') {
      if (!nextIntegration || typeof this.integrationLookup !== 'function') {
        throw new TorchError('Completion requires a verifiable landed integration request', {
          code: 'BACKLOG_INTEGRATION_REQUIRED',
        });
      }
      const integration = this.integrationLookup(nextIntegration);
      if (!integration || integration.state !== 'landed' || integration.sourceCommit !== nextCommit) {
        throw new TorchError('Backlog completion does not match a landed integration commit', {
          code: 'BACKLOG_INTEGRATION_NOT_LANDED',
          details: { integrationRequest: nextIntegration, state: integration?.state ?? null, taskCommit: nextCommit,
            integrationCommit: integration?.sourceCommit ?? null },
        });
      }
    }
    const now = this.clock().toISOString();
    const updated = {
      ...task, state: target, owner: nextOwner, evidence: nextEvidence,
      commit: nextCommit ?? null, integrationRequest: nextIntegration ?? null,
      blockedReason: target === 'blocked' ? requiredText(blockedReason, 'blockedReason') : null,
      updatedAt: now, revision: task.revision + 1,
      history: [...task.history, {
        from: task.state, to: target, actorId: actor, at: now,
        note: note ? requiredText(note, 'note') : null,
      }],
    };
    atomicTask(this.#path(task.id), updated);
    this.controlPlane.audit({
      actorId: actor, operation: selfClaim ? 'backlog.self-claim' : 'backlog.transition', entityType: 'backlog-task', entityId: task.id,
      details: { from: task.state, to: target, revision: updated.revision },
    });
    if (target === 'assigned' && !selfClaim) {
      this.controlPlane.sendMessage({
        sender: actor, recipient: updated.owner,
        body: `Assigned ${updated.id}: ${updated.title}`,
        references: { task: updated.id },
      });
    } else if (target === 'blocked' && actor !== 'session-manager') {
      this.controlPlane.sendMessage({
        sender: actor, recipient: 'session-manager', kind: 'blocker',
        body: updated.blockedReason, references: { task: updated.id, commit: updated.commit },
      });
    }
    return updated;
  }
}

export function createBacklogService(options) {
  return new BacklogService(options);
}
