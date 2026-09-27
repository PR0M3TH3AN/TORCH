import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { TorchError } from '../kernel/errors.mjs';
import { readInstallManifest } from '../kernel/install.mjs';
import { projectStatePath } from '../kernel/paths.mjs';

export const PRESENCE_STATES = Object.freeze([
  'starting', 'working', 'waiting', 'idle', 'stale', 'stopping', 'offline',
]);

const MESSAGE_KINDS = new Set(['message', 'coordination-request', 'handoff-request', 'completion', 'blocker']);

function readJson(path, code) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new TorchError(`Cannot read TORCH state at ${path}`, { code, details: error.message });
  }
}

function requiredText(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TorchError(`${name} must be a non-empty string`, {
      code: 'INVALID_CONTROL_PLANE_INPUT', details: { field: name },
    });
  }
  return value.trim();
}

function optionalText(value, name) {
  if (value === undefined || value === null || value === '') return null;
  return requiredText(value, name);
}

function normalizeReferences(references = {}) {
  return {
    task: optionalText(references.task, 'references.task'),
    path: optionalText(references.path, 'references.path'),
    commit: optionalText(references.commit, 'references.commit'),
    handoff: optionalText(references.handoff, 'references.handoff'),
  };
}

function globRegex(pattern) {
  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '*' && pattern[index + 1] === '*') {
      source += '.*';
      index += 1;
    } else if (character === '*') source += '[^/]*';
    else if (character === '?') source += '[^/]';
    else source += character.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

function normalizedProjectPath(value) {
  const input = requiredText(value, 'path').replaceAll('\\', '/').replace(/^\.\//, '');
  const normalized = posix.normalize(input);
  if (normalized === '..' || normalized.startsWith('../') || normalized.startsWith('/')) {
    throw new TorchError('Ownership queries require a repository-relative path', {
      code: 'INVALID_PROJECT_PATH', details: { path: value },
    });
  }
  return normalized;
}

function rowToAgent(row, rosterAgent) {
  return {
    areaId: rosterAgent.id,
    title: rosterAgent.title,
    scope: rosterAgent.scope ?? [],
    notScope: rosterAgent.not_scope ?? [],
    ownedPaths: rosterAgent.owned_paths ?? [],
    sharedPaths: rosterAgent.shared_paths ?? [],
    neighbours: rosterAgent.neighbours ?? [],
    requiredChecks: rosterAgent.required_checks ?? [],
    resources: rosterAgent.resources ?? [],
    runtime: row?.runtime ?? null,
    model: rosterAgent.model ?? null,
    runtimeSessionId: row?.runtime_session_id ?? null,
    state: row?.state ?? 'offline',
    summary: row?.summary ?? null,
    currentTask: row?.current_task ?? null,
    heartbeatAt: row?.heartbeat_at ?? null,
    updatedAt: row?.updated_at ?? null,
  };
}

function rowToMessage(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    sender: row.sender_id,
    recipient: row.recipient_id,
    kind: row.kind,
    createdAt: row.created_at,
    body: row.body,
    acknowledgedAt: row.acknowledged_at ?? null,
    deliveredAt: row.delivered_at ?? null,
    references: {
      task: row.task_ref ?? null,
      path: row.path_ref ?? null,
      commit: row.commit_ref ?? null,
      handoff: row.handoff_ref ?? null,
    },
  };
}

function initializeSchema(database) {
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS identities (
      area_id TEXT PRIMARY KEY,
      runtime TEXT,
      runtime_session_id TEXT,
      state TEXT NOT NULL DEFAULT 'offline',
      summary TEXT,
      current_task TEXT,
      heartbeat_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      recipient_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      created_at TEXT NOT NULL,
      body TEXT NOT NULL,
      task_ref TEXT,
      path_ref TEXT,
      commit_ref TEXT,
      handoff_ref TEXT,
      delivered_at TEXT
    );
    CREATE TABLE IF NOT EXISTS message_acks (
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      area_id TEXT NOT NULL,
      acknowledged_at TEXT NOT NULL,
      PRIMARY KEY (message_id, area_id)
    );
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      area_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      summary TEXT NOT NULL,
      task_ref TEXT,
      evidence TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS handoffs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      recipient_id TEXT NOT NULL,
      path_ref TEXT,
      task_ref TEXT,
      reason TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      details TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS messages_recipient_created
      ON messages(recipient_id, created_at, id);
    PRAGMA user_version = 2;
  `);
}

export class ControlPlane {
  constructor({ repositoryRoot, env = process.env, clock = () => new Date(), idFactory = randomUUID } = {}) {
    this.repositoryRoot = resolve(repositoryRoot ?? process.cwd());
    this.clock = clock;
    this.idFactory = idFactory;
    this.manifest = readInstallManifest(this.repositoryRoot);
    this.config = readJson(join(this.repositoryRoot, '.torch', 'torch.yaml'), 'INVALID_TORCH_CONFIG');
    this.roster = readJson(join(this.repositoryRoot, '.torch', 'roster.yaml'), 'INVALID_TORCH_ROSTER');
    if (this.config.project?.id !== this.manifest.projectId) {
      throw new TorchError('Tracked configuration and installation manifest disagree on project identity', {
        code: 'PROJECT_ID_MISMATCH',
      });
    }
    const localState = (this.manifest.external ?? []).find((entry) => entry.type === 'local-state');
    if (!localState?.path || !existsSync(localState.path)) {
      throw new TorchError('TORCH local project state is unavailable', { code: 'LOCAL_STATE_MISSING' });
    }
    const expectedStateRoot = projectStatePath(this.manifest.projectId, env);
    if (resolve(localState.path) !== resolve(expectedStateRoot)) {
      throw new TorchError('Installation manifest local state path does not match this environment', {
        code: 'LOCAL_STATE_PATH_MISMATCH',
        details: { manifest: localState.path, expected: expectedStateRoot },
      });
    }
    const metadata = readJson(join(expectedStateRoot, 'project.json'), 'LOCAL_STATE_METADATA_INVALID');
    if (metadata.projectId !== this.manifest.projectId || resolve(metadata.root) !== this.repositoryRoot) {
      throw new TorchError('Local state metadata does not belong to this installation root', {
        code: 'LOCAL_STATE_METADATA_MISMATCH',
      });
    }
    this.stateRoot = expectedStateRoot;
    this.projectId = this.manifest.projectId;
    this.agents = new Map((this.roster.areas ?? []).map((area) => [area.id, area]));
    if (!this.agents.has('session-manager')) {
      throw new TorchError('Roster does not contain the required session-manager identity', {
        code: 'INVALID_TORCH_ROSTER',
      });
    }
    this.database = new DatabaseSync(join(this.stateRoot, 'state.db'));
    initializeSchema(this.database);
    const insert = this.database.prepare('INSERT OR IGNORE INTO identities (area_id, state) VALUES (?, ?)');
    for (const areaId of this.agents.keys()) insert.run(areaId, 'offline');
  }

  refreshRoster() {
    const roster = readJson(join(this.repositoryRoot, '.torch', 'roster.yaml'), 'INVALID_TORCH_ROSTER');
    const agents = new Map((roster.areas ?? []).map((area) => [area.id, area]));
    if (!agents.has('session-manager')) {
      throw new TorchError('Roster does not contain the required session-manager identity', {
        code: 'INVALID_TORCH_ROSTER',
      });
    }
    const insert = this.database.prepare('INSERT OR IGNORE INTO identities (area_id, state) VALUES (?, ?)');
    for (const areaId of agents.keys()) insert.run(areaId, 'offline');
    this.roster = roster;
    this.agents = agents;
    return { schema: roster.schema, areaIds: [...agents.keys()] };
  }

  close() {
    this.database.close();
  }

  assertIdentity(areaId) {
    this.refreshRoster();
    const normalized = requiredText(areaId, 'areaId');
    if (!this.agents.has(normalized)) {
      throw new TorchError(`Unknown Fleet identity: ${normalized}`, {
        code: 'UNKNOWN_FLEET_IDENTITY', details: { areaId: normalized },
      });
    }
    return normalized;
  }

  assertRecipient(recipient) {
    const normalized = requiredText(recipient, 'recipient');
    if (normalized !== 'all') this.assertIdentity(normalized);
    return normalized;
  }

  identity(areaId) {
    const id = this.assertIdentity(areaId);
    const row = this.database.prepare('SELECT * FROM identities WHERE area_id = ?').get(id);
    return rowToAgent(row, this.agents.get(id));
  }

  listAgents() {
    return [...this.agents.keys()].map((areaId) => this.identity(areaId));
  }

  getAgent(areaId) {
    return this.identity(areaId);
  }

  getRoster() {
    return {
      projectId: this.projectId,
      schema: this.roster.schema,
      agents: this.listAgents(),
    };
  }

  neighbours(areaId) {
    const agent = this.identity(areaId);
    const ids = agent.neighbours.includes('all')
      ? this.listAgents().map((candidate) => candidate.areaId).filter((id) => id !== areaId)
      : agent.neighbours;
    return ids.map((id) => this.identity(id));
  }

  whoOwns({ path, capability } = {}) {
    if (!path && !capability) {
      throw new TorchError('Ownership lookup requires path or capability', {
        code: 'INVALID_CONTROL_PLANE_INPUT',
      });
    }
    const projectPath = path ? normalizedProjectPath(path) : null;
    const needle = capability ? requiredText(capability, 'capability').toLowerCase() : null;
    const owners = [];
    const shared = [];
    for (const agent of this.agents.values()) {
      const ownedMatch = projectPath
        ? (agent.owned_paths ?? []).find((pattern) => globRegex(pattern).test(projectPath))
        : null;
      const sharedMatch = projectPath
        ? (agent.shared_paths ?? []).find((pattern) => globRegex(pattern).test(projectPath))
        : null;
      const capabilityMatch = needle
        ? (agent.scope ?? []).find((item) => item.toLowerCase().includes(needle))
        : null;
      if (ownedMatch || capabilityMatch) {
        owners.push({ areaId: agent.id, match: ownedMatch ?? capabilityMatch, basis: ownedMatch ? 'owned-path' : 'capability' });
      }
      if (sharedMatch) shared.push({ areaId: agent.id, match: sharedMatch, basis: 'shared-path' });
    }
    return {
      projectId: this.projectId, path: projectPath, capability: capability ?? null,
      owners, shared, coordinationRequired: shared.length > 0 || owners.length > 1,
    };
  }

  sendMessage({ sender, recipient, body, kind = 'message', references = {} } = {}) {
    const senderId = this.assertIdentity(sender);
    const recipientId = this.assertRecipient(recipient);
    const normalizedKind = requiredText(kind, 'kind');
    if (!MESSAGE_KINDS.has(normalizedKind)) {
      throw new TorchError(`Unsupported message kind: ${normalizedKind}`, {
        code: 'INVALID_MESSAGE_KIND', details: { kind: normalizedKind },
      });
    }
    const normalizedBody = requiredText(body, 'body');
    const refs = normalizeReferences(references);
    const record = {
      id: this.idFactory(), projectId: this.projectId, sender: senderId, recipient: recipientId,
      kind: normalizedKind, createdAt: this.clock().toISOString(), body: normalizedBody,
      acknowledgedAt: null, deliveredAt: null, references: refs,
    };
    this.database.prepare(`
      INSERT INTO messages (
        id, project_id, sender_id, recipient_id, kind, created_at, body,
        task_ref, path_ref, commit_ref, handoff_ref
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id, record.projectId, record.sender, record.recipient, record.kind,
      record.createdAt, record.body, refs.task, refs.path, refs.commit, refs.handoff,
    );
    this.audit({ actorId: senderId, operation: 'message.send', entityType: 'message', entityId: record.id });
    return record;
  }

  readMessages({ recipient, unacknowledgedOnly = false, limit = 100 } = {}) {
    const recipientId = this.assertIdentity(recipient);
    const normalizedLimit = Number.isInteger(limit) && limit > 0 && limit <= 1000 ? limit : 100;
    const query = `
      SELECT m.*, a.acknowledged_at
      FROM messages m
      LEFT JOIN message_acks a ON a.message_id = m.id AND a.area_id = ?
      WHERE (m.recipient_id = ? OR m.recipient_id = 'all')
        ${unacknowledgedOnly ? 'AND a.acknowledged_at IS NULL' : ''}
      ORDER BY m.created_at ASC, m.id ASC
      LIMIT ?
    `;
    return this.database.prepare(query).all(recipientId, recipientId, normalizedLimit).map(rowToMessage);
  }

  ackMessage({ recipient, messageId } = {}) {
    const recipientId = this.assertIdentity(recipient);
    const id = requiredText(messageId, 'messageId');
    const message = this.database.prepare('SELECT * FROM messages WHERE id = ?').get(id);
    if (!message) throw new TorchError(`Unknown message: ${id}`, { code: 'MESSAGE_NOT_FOUND' });
    if (message.recipient_id !== recipientId && message.recipient_id !== 'all') {
      throw new TorchError(`Message ${id} is not addressed to ${recipientId}`, {
        code: 'MESSAGE_NOT_ADDRESSABLE', details: { messageId: id, recipient: recipientId },
      });
    }
    const acknowledgedAt = this.clock().toISOString();
    this.database.prepare(`
      INSERT INTO message_acks (message_id, area_id, acknowledged_at) VALUES (?, ?, ?)
      ON CONFLICT(message_id, area_id) DO UPDATE SET acknowledged_at = excluded.acknowledged_at
    `).run(id, recipientId, acknowledgedAt);
    this.audit({ actorId: recipientId, operation: 'message.ack', entityType: 'message', entityId: id });
    return { messageId: id, recipient: recipientId, acknowledgedAt };
  }

  reportStatus({ areaId, state, summary, runtime, runtimeSessionId, task } = {}) {
    const id = this.assertIdentity(areaId);
    const normalizedState = requiredText(state, 'state');
    if (!PRESENCE_STATES.includes(normalizedState)) {
      throw new TorchError(`Invalid presence state: ${normalizedState}`, {
        code: 'INVALID_PRESENCE_STATE', details: { allowed: PRESENCE_STATES },
      });
    }
    const now = this.clock().toISOString();
    this.database.prepare(`
      UPDATE identities SET
        runtime = COALESCE(?, runtime),
        runtime_session_id = COALESCE(?, runtime_session_id),
        state = ?, summary = ?, current_task = ?, heartbeat_at = ?, updated_at = ?
      WHERE area_id = ?
    `).run(
      optionalText(runtime, 'runtime'), optionalText(runtimeSessionId, 'runtimeSessionId'),
      normalizedState, optionalText(summary, 'summary'), optionalText(task, 'task'), now, now, id,
    );
    this.audit({
      actorId: id, operation: 'presence.report', entityType: 'identity', entityId: id,
      details: { state: normalizedState },
    });
    return this.identity(id);
  }

  writeReport({ areaId, kind, summary, task, evidence } = {}) {
    const id = this.assertIdentity(areaId);
    const createdAt = this.clock().toISOString();
    const report = {
      id: this.idFactory(), projectId: this.projectId, areaId: id,
      kind, summary: requiredText(summary, 'summary'), task: optionalText(task, 'task'),
      evidence: optionalText(evidence, 'evidence'), createdAt,
    };
    this.database.prepare(`
      INSERT INTO reports (id, project_id, area_id, kind, summary, task_ref, evidence, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      report.id, report.projectId, report.areaId, report.kind, report.summary,
      report.task, report.evidence, report.createdAt,
    );
    this.audit({ actorId: id, operation: `report.${kind}`, entityType: 'report', entityId: report.id });
    return report;
  }

  reportComplete(input = {}) {
    const report = this.writeReport({ ...input, kind: 'completion' });
    const message = this.sendMessage({
      sender: report.areaId, recipient: 'session-manager', kind: 'completion', body: report.summary,
      references: { task: report.task, commit: input.commit },
    });
    return { ...report, messageId: message.id };
  }

  reportBlocked(input = {}) {
    const report = this.writeReport({ ...input, kind: 'blocker' });
    const message = this.sendMessage({
      sender: report.areaId, recipient: 'session-manager', kind: 'blocker', body: report.summary,
      references: { task: report.task, path: input.path, commit: input.commit },
    });
    return { ...report, messageId: message.id };
  }

  requestCoordination({ sender, participants = [], body, task, path } = {}) {
    const senderId = this.assertIdentity(sender);
    const normalizedParticipants = participants.map((areaId) => this.assertIdentity(areaId));
    const participantText = normalizedParticipants.length
      ? ` Participants: ${normalizedParticipants.join(', ')}.` : '';
    return this.sendMessage({
      sender: senderId, recipient: 'session-manager', kind: 'coordination-request',
      body: `${requiredText(body, 'body')}${participantText}`,
      references: { task, path },
    });
  }

  requestHandoff({ sender, recipient = 'session-manager', path, task, reason } = {}) {
    const senderId = this.assertIdentity(sender);
    const recipientId = this.assertIdentity(recipient);
    const pathRef = path ? normalizedProjectPath(path) : null;
    const taskRef = optionalText(task, 'task');
    if (!pathRef && !taskRef) {
      throw new TorchError('A handoff request requires a path or task reference', {
        code: 'INVALID_CONTROL_PLANE_INPUT',
      });
    }
    const handoff = {
      id: this.idFactory(), projectId: this.projectId, sender: senderId, recipient: recipientId,
      path: pathRef, task: taskRef, reason: requiredText(reason, 'reason'),
      status: 'requested', createdAt: this.clock().toISOString(),
    };
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare(`
        INSERT INTO handoffs (
          id, project_id, sender_id, recipient_id, path_ref, task_ref, reason, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        handoff.id, handoff.projectId, handoff.sender, handoff.recipient, handoff.path,
        handoff.task, handoff.reason, handoff.status, handoff.createdAt,
      );
      const message = this.sendMessage({
        sender: senderId, recipient: recipientId, kind: 'handoff-request', body: handoff.reason,
        references: { path: pathRef, task: taskRef, handoff: handoff.id },
      });
      this.audit({
        actorId: senderId, operation: 'handoff.request', entityType: 'handoff', entityId: handoff.id,
        details: { recipient: recipientId, path: pathRef, task: taskRef },
      });
      this.database.exec('COMMIT');
      return { ...handoff, messageId: message.id };
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  audit({ actorId, operation, entityType, entityId = null, details = null } = {}) {
    const actor = this.assertIdentity(actorId);
    const event = {
      id: this.idFactory(), projectId: this.projectId, actorId: actor,
      operation: requiredText(operation, 'operation'), entityType: requiredText(entityType, 'entityType'),
      entityId: optionalText(entityId, 'entityId'), details, createdAt: this.clock().toISOString(),
    };
    this.database.prepare(`
      INSERT INTO audit_events (
        id, project_id, actor_id, operation, entity_type, entity_id, details, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id, event.projectId, event.actorId, event.operation, event.entityType,
      event.entityId, details ? JSON.stringify(details) : null, event.createdAt,
    );
    return event;
  }

  readAudit({ actorId, limit = 100 } = {}) {
    const normalizedLimit = Number.isInteger(limit) && limit > 0 && limit <= 1000 ? limit : 100;
    const rows = actorId
      ? this.database.prepare(`
        SELECT * FROM audit_events WHERE actor_id = ? ORDER BY created_at DESC, id DESC LIMIT ?
      `).all(this.assertIdentity(actorId), normalizedLimit)
      : this.database.prepare(`
        SELECT * FROM audit_events ORDER BY created_at DESC, id DESC LIMIT ?
      `).all(normalizedLimit);
    return rows.map((row) => ({
      id: row.id, projectId: row.project_id, actorId: row.actor_id,
      operation: row.operation, entityType: row.entity_type, entityId: row.entity_id,
      details: row.details ? JSON.parse(row.details) : null, createdAt: row.created_at,
    }));
  }
}

export function openControlPlane(options) {
  return new ControlPlane(options);
}
