import { randomUUID } from 'node:crypto';
import {
  closeSync, existsSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync, writeSync,
} from 'node:fs';
import { join } from 'node:path';
import { TorchError } from '../kernel/errors.mjs';
import { readInstallManifest } from '../kernel/install.mjs';

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
    repositoryRoot, controlPlane, integrationLookup = null,
    clock = () => new Date(), idFactory = randomUUID,
  } = {}) {
    this.repositoryRoot = repositoryRoot;
    this.controlPlane = controlPlane;
    this.integrationLookup = integrationLookup;
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

  create({
    actorId, title, description, priority = 'normal', affectedDomains = [],
    dependencies = [], acceptanceCriteria,
  } = {}) {
    this.#assertMutable();
    const actor = this.controlPlane.assertIdentity(actorId);
    if (actor !== 'session-manager') {
      throw new TorchError('Only the Session Manager may create durable backlog work', {
        code: 'BACKLOG_AUTHORITY_REQUIRED', details: { actorId: actor },
      });
    }
    if (!PRIORITIES.has(priority)) {
      throw new TorchError(`Invalid backlog priority: ${priority}`, { code: 'INVALID_BACKLOG_PRIORITY' });
    }
    const domains = textList(affectedDomains, 'affectedDomains');
    domains.forEach((areaId) => this.controlPlane.assertIdentity(areaId));
    const dependencyIds = textList(dependencies, 'dependencies');
    dependencyIds.forEach((id) => this.get(id));
    const now = this.clock().toISOString();
    const task = {
      schema: 'torch.dev/backlog-item/v1alpha1',
      id: taskId(`TASK-${this.idFactory()}`), title: requiredText(title, 'title'),
      description: requiredText(description, 'description'), priority,
      state: 'proposed', owner: null, affectedDomains: domains, dependencies: dependencyIds,
      acceptanceCriteria: textList(acceptanceCriteria, 'acceptanceCriteria', { required: true }),
      evidence: [], commit: null, integrationRequest: null, blockedReason: null,
      createdAt: now, updatedAt: now, revision: 1,
      history: [{ from: null, to: 'proposed', actorId: actor, at: now, note: 'Task created.' }],
    };
    const path = this.#path(task.id);
    if (existsSync(path)) throw new TorchError(`Backlog task already exists: ${task.id}`, { code: 'BACKLOG_TASK_EXISTS' });
    atomicTask(path, task);
    this.controlPlane.audit({
      actorId: actor, operation: 'backlog.create', entityType: 'backlog-task', entityId: task.id,
      details: { state: task.state, priority },
    });
    return task;
  }

  transition(input = {}) {
    this.#assertMutable();
    return this.#withTaskLock(input.taskId, () => this.#applyTransition(input));
  }

  #applyTransition({
    taskId: id, actorId, to, expectedRevision, owner, evidence = [], commit,
    integrationRequest, blockedReason, note,
  } = {}) {
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
    if (actor !== 'session-manager' && (actor !== task.owner || !WORKER_TRANSITIONS.has(target))) {
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
      actorId: actor, operation: 'backlog.transition', entityType: 'backlog-task', entityId: task.id,
      details: { from: task.state, to: target, revision: updated.revision },
    });
    if (target === 'assigned') {
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
