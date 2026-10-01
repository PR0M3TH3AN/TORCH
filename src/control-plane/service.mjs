import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { TorchError } from '../kernel/errors.mjs';
import { readInstallManifest } from '../kernel/install.mjs';
import { projectStatePath } from '../kernel/paths.mjs';
import { loadProjectConfig } from '../kernel/config.mjs';
import { organizationGraphFromConfig } from '../kernel/organization.mjs';

export const PRESENCE_STATES = Object.freeze([
  'starting', 'working', 'waiting', 'idle', 'stale', 'stopping', 'offline',
]);

const MESSAGE_KINDS = new Set([
  'message', 'coordination-request', 'handoff-request', 'completion', 'blocker', 'manager-check-in', 'manager-stale-work-review',
  'approval-request', 'approval-decision',
]);

const CONTROL_PLANE_SCHEMA_VERSION = 3;

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

function messageObservationSelection(value) {
  if (value !== 'unread' && value !== 'history') {
    throw new TorchError('Message observation selection must be unread or history', {
      code: 'INVALID_MESSAGE_SELECTION', details: { selection: value, allowed: ['unread', 'history'] },
    });
  }
  return value;
}

function messageObservationLimit(value) {
  if (!Number.isInteger(value) || value < 1 || value > 1000) {
    throw new TorchError('Message observation limit must be an integer from 1 through 1000', {
      code: 'INVALID_MESSAGE_LIMIT', details: { limit: value, minimum: 1, maximum: 1000 },
    });
  }
  return value;
}

function requiredRecord(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TorchError(`${name} must be a structured record`, {
      code: 'INVALID_RUNTIME_LAUNCH_EVIDENCE', details: { field: name },
    });
  }
  return value;
}

function requiredEvidenceField(record, field) {
  if (!Object.hasOwn(record, field)) {
    throw new TorchError(`Runtime launch evidence requires ${field}`, {
      code: 'INVALID_RUNTIME_LAUNCH_EVIDENCE', details: { field },
    });
  }
  return record[field];
}

function boundedEvidenceText(value, name) {
  const text = requiredText(value, name);
  if (text.length > 240) {
    throw new TorchError(`${name} exceeds the bounded executor-evidence limit`, {
      code: 'INVALID_RUNTIME_LAUNCH_EVIDENCE', details: { field: name, maximum: 240 },
    });
  }
  return text;
}

function boundedEvidenceValue(value, name) {
  if (value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return boundedEvidenceText(value, name);
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
    runtime: row?.runtime ?? rosterAgent.runtime ?? null,
    model: rosterAgent.model ?? null,
    reasoning: rosterAgent.reasoning ?? null,
    runtimeSessionId: row?.runtime_session_id ?? null,
    state: row?.state ?? 'offline',
    summary: row?.summary ?? null,
    currentTask: row?.current_task ?? null,
    heartbeatAt: row?.heartbeat_at ?? null,
    updatedAt: row?.updated_at ?? null,
  };
}

function effectiveRoster(roster, config) {
  return (roster.areas ?? []).map((area) => {
    const configured = area.id === 'session-manager'
      ? config.session_manager : config.domains.find((domain) => domain.id === area.id);
    const runtime = configured?.runtime ?? area.runtime ?? config.runtimes.default;
    const runtimeConfig = config.runtimes[runtime] ?? {};
    return {
      ...area,
      runtime,
      model: configured?.model ?? runtimeConfig.model ?? null,
      reasoning: configured?.reasoning ?? runtimeConfig.reasoning ?? null,
    };
  });
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
  const currentVersion = database.prepare('PRAGMA user_version').get().user_version;
  const reservationTable = database.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'runtime_launch_reservations'
  `).get();
  if (currentVersion > CONTROL_PLANE_SCHEMA_VERSION) {
    throw new TorchError('Local control-plane state requires a newer engine', {
      code: 'CONTROL_PLANE_SCHEMA_NEWER_THAN_ENGINE',
      details: { currentVersion, supportedVersion: CONTROL_PLANE_SCHEMA_VERSION },
    });
  }
  if (currentVersion < CONTROL_PLANE_SCHEMA_VERSION && reservationTable) {
    throw new TorchError('Local runtime reservation state was opened by an older engine and cannot be relabelled', {
      code: 'CONTROL_PLANE_SCHEMA_DOWNGRADE_DETECTED',
      details: { currentVersion, requiredVersion: CONTROL_PLANE_SCHEMA_VERSION },
    });
  }
  if (currentVersion === CONTROL_PLANE_SCHEMA_VERSION && !reservationTable) {
    throw new TorchError('Local control-plane schema is incomplete for its recorded version', {
      code: 'CONTROL_PLANE_SCHEMA_CORRUPT',
      details: { currentVersion, missingTable: 'runtime_launch_reservations' },
    });
  }
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
    CREATE TABLE IF NOT EXISTS approval_requests (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      requester_id TEXT NOT NULL,
      approver_id TEXT NOT NULL,
      task_ref TEXT,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      evidence TEXT,
      status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
      revision INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      decided_at TEXT,
      decided_by TEXT,
      decision_note TEXT
    );
    CREATE TABLE IF NOT EXISTS runtime_launch_reservations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      area_id TEXT NOT NULL,
      runtime TEXT NOT NULL,
      attempt_id TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('fresh', 'resume')),
      expected_runtime_session_id TEXT,
      captured_runtime_session_id TEXT,
      state TEXT NOT NULL CHECK (state IN ('starting', 'held', 'succeeded', 'failed', 'reconciled-stopped')),
      evidence TEXT,
      created_at TEXT NOT NULL,
      settled_at TEXT
    );
    CREATE INDEX IF NOT EXISTS approval_requests_pending_approver
      ON approval_requests(project_id, approver_id, status, created_at, id);
    CREATE INDEX IF NOT EXISTS approval_requests_pending_requester
      ON approval_requests(project_id, requester_id, status, created_at, id);
    CREATE INDEX IF NOT EXISTS messages_recipient_created
      ON messages(recipient_id, created_at, id);
    CREATE INDEX IF NOT EXISTS runtime_launch_reservations_active_identity
      ON runtime_launch_reservations(project_id, area_id, state, created_at, id);
    CREATE UNIQUE INDEX IF NOT EXISTS runtime_launch_reservations_unique_attempt
      ON runtime_launch_reservations(project_id, area_id, attempt_id);
    PRAGMA user_version = ${CONTROL_PLANE_SCHEMA_VERSION};
  `);
}

export class ControlPlane {
  constructor({
    repositoryRoot,
    env = process.env,
    clock = () => new Date(),
    idFactory = randomUUID,
    verifyRuntimeLaunchEvidence = () => false,
  } = {}) {
    this.repositoryRoot = resolve(repositoryRoot ?? process.cwd());
    this.clock = clock;
    this.idFactory = idFactory;
    this.verifyRuntimeLaunchEvidence = verifyRuntimeLaunchEvidence;
    this.manifest = readInstallManifest(this.repositoryRoot);
    this.config = loadProjectConfig(this.repositoryRoot);
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
    this.agents = new Map(effectiveRoster(this.roster, this.config).map((area) => [area.id, area]));
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
    const config = loadProjectConfig(this.repositoryRoot);
    const agents = new Map(effectiveRoster(roster, config).map((area) => [area.id, area]));
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
    return this.assertLoadedIdentity(areaId);
  }

  assertLoadedIdentity(areaId) {
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

  sendOwnerRequest({ actorId, recipient, body, references = {} } = {}) {
    const ownerId = this.assertOwnerActor(actorId);
    const recipientId = this.assertIdentity(recipient);
    const normalizedBody = requiredText(body, 'body');
    if (normalizedBody.length > 4000) {
      throw new TorchError('Owner requests are limited to 4,000 characters', {
        code: 'OWNER_REQUEST_TOO_LONG', details: { maximum: 4000 },
      });
    }
    const refs = normalizeReferences(references);
    const record = {
      id: this.idFactory(), projectId: this.projectId, sender: ownerId, recipient: recipientId,
      kind: 'message', createdAt: this.clock().toISOString(), body: normalizedBody,
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
    this.auditOwnerAction({
      actorId: ownerId, operation: 'agent.request', entityType: 'message', entityId: record.id,
      details: { recipient: recipientId, task: refs.task },
    });
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

  observeMessages({ recipient, selection, limit } = {}) {
    // Unlike legacy readMessages, this observation must not refresh the roster: refreshRoster
    // maintains identity rows and is therefore not a read-only observation.
    const recipientId = this.assertLoadedIdentity(recipient);
    const normalizedSelection = messageObservationSelection(selection);
    const normalizedLimit = messageObservationLimit(limit);
    const rows = this.database.prepare(`
      WITH visible_messages AS MATERIALIZED (
        SELECT m.*, a.acknowledged_at
        FROM messages m
        LEFT JOIN message_acks a ON a.message_id = m.id AND a.area_id = ?
        WHERE m.recipient_id = ? OR m.recipient_id = 'all'
      ),
      selected_messages AS MATERIALIZED (
        SELECT * FROM visible_messages
        WHERE ? = 'history' OR acknowledged_at IS NULL
      ),
      page AS MATERIALIZED (
        SELECT * FROM selected_messages
        ORDER BY created_at ASC, id ASC
        LIMIT ?
      ),
      metadata AS (
        SELECT
          (SELECT COUNT(*) FROM selected_messages) AS selected_count,
          (SELECT COUNT(*) FROM visible_messages WHERE acknowledged_at IS NULL) AS pending_unread_count
      )
      SELECT page.*, metadata.selected_count, metadata.pending_unread_count
      FROM metadata
      LEFT JOIN page ON TRUE
      ORDER BY page.created_at ASC, page.id ASC
    `).all(recipientId, recipientId, normalizedSelection, normalizedLimit);
    const messages = rows.filter((row) => row.id !== null).map(rowToMessage);
    const selectedCount = Number(rows[0]?.selected_count ?? 0);
    const complete = selectedCount <= normalizedLimit;
    return {
      recipient: recipientId,
      messages,
      observation: {
        selection: normalizedSelection,
        requestedLimit: normalizedLimit,
        returnedCount: messages.length,
        complete,
        truncated: !complete,
        pendingUnreadCount: Number(rows[0]?.pending_unread_count ?? 0),
      },
    };
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

  runtimeLaunchReservations({ areaId } = {}) {
    const clauses = ['project_id = ?'];
    const values = [this.projectId];
    if (areaId !== undefined) {
      clauses.push('area_id = ?');
      values.push(this.assertIdentity(areaId));
    }
    return this.database.prepare(`
      SELECT * FROM runtime_launch_reservations WHERE ${clauses.join(' AND ')}
      ORDER BY created_at ASC, id ASC
    `).all(...values).map((row) => ({
      id: row.id, projectId: row.project_id, areaId: row.area_id, runtime: row.runtime,
      attemptId: row.attempt_id, mode: row.mode,
      expectedRuntimeSessionId: row.expected_runtime_session_id ?? null,
      capturedRuntimeSessionId: row.captured_runtime_session_id ?? null,
      state: row.state, evidence: row.evidence ?? null, createdAt: row.created_at,
      settledAt: row.settled_at ?? null,
    }));
  }

  runtimeLaunchEvidence({ evidence, reservation, outcome, terminal, kind }) {
    const record = requiredRecord(evidence, 'evidence');
    const source = boundedEvidenceText(record.source, 'evidence.source');
    const evidenceAttemptId = boundedEvidenceText(record.attemptId, 'evidence.attemptId');
    const evidenceReservationId = boundedEvidenceText(record.reservationId, 'evidence.reservationId');
    const observedAt = boundedEvidenceText(record.observedAt, 'evidence.observedAt');
    if (source !== 'runtime-executor'
      || evidenceAttemptId !== reservation.attempt_id
      || evidenceReservationId !== reservation.id) {
      throw new TorchError('Runtime executor evidence is not attributable to this reservation', {
        code: 'RUNTIME_LAUNCH_EVIDENCE_MISMATCH', details: { reservationId: reservation.id },
      });
    }
    if (record.outcome !== outcome || record.terminal !== terminal) {
      throw new TorchError('Runtime executor evidence has the wrong lifecycle outcome', {
        code: 'RUNTIME_LAUNCH_EVIDENCE_MISMATCH', details: { reservationId: reservation.id },
      });
    }
    for (const field of ['status', 'signal', 'errorCode']) requiredEvidenceField(record, field);
    const status = boundedEvidenceValue(record.status, 'evidence.status');
    const signal = boundedEvidenceValue(record.signal, 'evidence.signal');
    const errorCode = boundedEvidenceValue(record.errorCode, 'evidence.errorCode');
    const reason = terminal === false ? boundedEvidenceText(record.reason, 'evidence.reason') : undefined;
    const verified = (() => {
      try {
        return this.verifyRuntimeLaunchEvidence({ kind, evidence: record, reservation });
      } catch {
        return false;
      }
    })();
    if (verified !== true) {
      throw new TorchError('Runtime launch evidence was not issued by the executor boundary', {
        code: 'RUNTIME_LAUNCH_EVIDENCE_UNVERIFIED', details: { reservationId: reservation.id, kind },
      });
    }
    return {
      source, attemptId: evidenceAttemptId, reservationId: evidenceReservationId, observedAt,
      outcome, terminal, status, signal, errorCode, ...(reason ? { reason } : {}),
    };
  }

  runtimeLaunchStoppedProof({ proof, reservation }) {
    const record = requiredRecord(proof, 'proof');
    const attemptId = boundedEvidenceText(record.attemptId, 'proof.attemptId');
    const reservationId = boundedEvidenceText(record.reservationId, 'proof.reservationId');
    const observedAt = boundedEvidenceText(record.observedAt, 'proof.observedAt');
    const processId = boundedEvidenceText(record.processId, 'proof.processId');
    const processStart = boundedEvidenceText(record.processStart, 'proof.processStart');
    const verifier = boundedEvidenceText(record.verifier, 'proof.verifier');
    if (record.kind !== 'process-proof'
      || attemptId !== reservation.attempt_id
      || reservationId !== reservation.id) {
      throw new TorchError('Stopped-process proof is not attributable to this reservation', {
        code: 'RUNTIME_LAUNCH_RECONCILIATION_BLOCKED', details: { reservationId: reservation.id },
      });
    }
    const verified = (() => {
      try {
        return this.verifyRuntimeLaunchEvidence({ kind: 'process-proof', evidence: record, reservation });
      } catch {
        return false;
      }
    })();
    if (verified !== true) {
      throw new TorchError('Stopped-process proof was not issued by the executor boundary', {
        code: 'RUNTIME_LAUNCH_RECONCILIATION_BLOCKED', details: { reservationId: reservation.id },
      });
    }
    return { kind: 'process-proof', attemptId, reservationId, observedAt, processId, processStart, verifier };
  }

  reserveRuntimeLaunch({ areaId, runtime, attemptId, mode, runtimeSessionId } = {}) {
    const id = this.assertIdentity(areaId);
    const normalizedRuntime = requiredText(runtime, 'runtime');
    const normalizedAttempt = requiredText(attemptId, 'attemptId');
    const normalizedMode = requiredText(mode, 'mode');
    if (!['fresh', 'resume'].includes(normalizedMode)) {
      throw new TorchError('Runtime launch mode must be fresh or resume', { code: 'INVALID_RUNTIME_LAUNCH_MODE' });
    }
    const requestedRuntimeSessionId = optionalText(runtimeSessionId, 'runtimeSessionId');
    if (normalizedMode === 'resume' && !requestedRuntimeSessionId) {
      throw new TorchError('Resumed runtime launches require their expected session ID', {
        code: 'RUNTIME_LAUNCH_SESSION_REQUIRED', details: { areaId: id, mode: normalizedMode },
      });
    }
    const createdAt = this.clock().toISOString();
    const reservation = {
      id: this.idFactory(), projectId: this.projectId, areaId: id, runtime: normalizedRuntime,
      attemptId: normalizedAttempt, mode: normalizedMode, expectedRuntimeSessionId: null,
      capturedRuntimeSessionId: null, state: 'starting', evidence: null, createdAt, settledAt: null,
    };
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const identity = this.database.prepare('SELECT * FROM identities WHERE area_id = ?').get(id);
      const registeredRuntimeSessionId = identity?.runtime_session_id ?? null;
      if (normalizedMode === 'resume' && registeredRuntimeSessionId !== requestedRuntimeSessionId) {
        throw new TorchError('Resumed runtime launch does not match the registered provider session ID', {
          code: 'RUNTIME_LAUNCH_SESSION_MISMATCH', details: { areaId: id, expected: registeredRuntimeSessionId },
        });
      }
      if (normalizedMode === 'fresh' && requestedRuntimeSessionId
        && registeredRuntimeSessionId && requestedRuntimeSessionId !== registeredRuntimeSessionId) {
        throw new TorchError('Fresh runtime launch cannot replace a registered provider session ID', {
          code: 'RUNTIME_LAUNCH_SESSION_MISMATCH', details: { areaId: id, expected: registeredRuntimeSessionId },
        });
      }
      const replay = this.database.prepare(`
        SELECT id FROM runtime_launch_reservations
        WHERE project_id = ? AND area_id = ? AND attempt_id = ?
      `).get(this.projectId, id, normalizedAttempt);
      if (replay) {
        throw new TorchError('A durable runtime launch attempt cannot be replayed', {
          code: 'RUNTIME_LAUNCH_ATTEMPT_REPLAYED', details: { reservationId: replay.id, areaId: id },
        });
      }
      const active = this.database.prepare(`
        SELECT * FROM runtime_launch_reservations
        WHERE project_id = ? AND area_id = ? AND state IN ('starting', 'held')
        ORDER BY created_at ASC, id ASC LIMIT 1
      `).get(this.projectId, id);
      if (active) {
        throw new TorchError('A runtime launch reservation already blocks this identity', {
          code: 'RUNTIME_LAUNCH_ALREADY_RESERVED',
          details: { reservationId: active.id, areaId: id, state: active.state },
        });
      }
      reservation.expectedRuntimeSessionId = registeredRuntimeSessionId;
      this.database.prepare(`
        INSERT INTO runtime_launch_reservations (
          id, project_id, area_id, runtime, attempt_id, mode, expected_runtime_session_id,
          captured_runtime_session_id, state, evidence, created_at, settled_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'starting', NULL, ?, NULL)
      `).run(
        reservation.id, reservation.projectId, reservation.areaId, reservation.runtime,
        reservation.attemptId, reservation.mode, reservation.expectedRuntimeSessionId, reservation.createdAt,
      );
      this.database.prepare(`
        UPDATE identities SET runtime = ?, runtime_session_id = ?, state = 'starting',
          summary = ?, heartbeat_at = ?, updated_at = ? WHERE area_id = ?
      `).run(normalizedRuntime, registeredRuntimeSessionId, 'Runtime launch reserved before provider dispatch.', createdAt, createdAt, id);
      this.audit({
        actorId: id, operation: 'runtime.launch.reserve', entityType: 'runtime-launch-reservation', entityId: reservation.id,
        details: { attemptId: normalizedAttempt, mode: normalizedMode, expectedRuntimeSessionId: registeredRuntimeSessionId },
      });
      this.database.exec('COMMIT');
      return reservation;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  settleRuntimeLaunch({ reservationId, attemptId, outcome, runtimeSessionId, evidence } = {}) {
    const id = requiredText(reservationId, 'reservationId');
    const normalizedAttempt = requiredText(attemptId, 'attemptId');
    const normalizedOutcome = requiredText(outcome, 'outcome');
    if (!['succeeded', 'failed'].includes(normalizedOutcome)) {
      throw new TorchError('Runtime launch settlement must be succeeded or failed', { code: 'INVALID_RUNTIME_LAUNCH_OUTCOME' });
    }
    const capturedRuntimeSessionId = optionalText(runtimeSessionId, 'runtimeSessionId');
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const reservation = this.database.prepare('SELECT * FROM runtime_launch_reservations WHERE id = ? AND project_id = ?').get(id, this.projectId);
      if (!reservation) throw new TorchError('Unknown runtime launch reservation', { code: 'RUNTIME_LAUNCH_RESERVATION_NOT_FOUND' });
      if (!['starting', 'held'].includes(reservation.state)) throw new TorchError('Runtime launch reservation is no longer active', { code: 'RUNTIME_LAUNCH_NOT_ACTIVE' });
      if (reservation.attempt_id !== normalizedAttempt) throw new TorchError('Runtime launch attempt does not match its reservation', { code: 'RUNTIME_LAUNCH_ATTEMPT_MISMATCH' });
      const terminalEvidence = this.runtimeLaunchEvidence({
        evidence, reservation, outcome: normalizedOutcome, terminal: true, kind: 'terminal',
      });
      if (reservation.mode === 'resume' && capturedRuntimeSessionId
        && capturedRuntimeSessionId !== reservation.expected_runtime_session_id) {
        throw new TorchError('Resumed runtime launch captured an unexpected provider session ID', { code: 'RUNTIME_LAUNCH_SESSION_MISMATCH' });
      }
      const settledAt = this.clock().toISOString();
      const knownSessionId = reservation.captured_runtime_session_id ?? reservation.expected_runtime_session_id ?? null;
      if (capturedRuntimeSessionId && knownSessionId && capturedRuntimeSessionId !== knownSessionId) {
        throw new TorchError('Runtime launch captured an unexpected provider session ID', { code: 'RUNTIME_LAUNCH_SESSION_MISMATCH' });
      }
      const boundSessionId = capturedRuntimeSessionId ?? knownSessionId;
      this.database.prepare(`
        UPDATE runtime_launch_reservations SET state = ?, captured_runtime_session_id = ?, evidence = ?, settled_at = ? WHERE id = ?
      `).run(normalizedOutcome, boundSessionId, JSON.stringify(terminalEvidence), settledAt, id);
      this.database.prepare(`
        UPDATE identities SET runtime_session_id = ?, state = ?, summary = ?, heartbeat_at = ?, updated_at = ? WHERE area_id = ?
      `).run(boundSessionId, normalizedOutcome === 'succeeded' ? 'idle' : 'offline',
        normalizedOutcome === 'succeeded' ? 'Runtime launch completed.' : 'Runtime launch failed with terminal evidence.', settledAt, settledAt, reservation.area_id);
      this.audit({ actorId: reservation.area_id, operation: 'runtime.launch.settle', entityType: 'runtime-launch-reservation', entityId: id,
        details: { attemptId: normalizedAttempt, outcome: normalizedOutcome, capturedRuntimeSessionId: boundSessionId } });
      this.database.exec('COMMIT');
      return this.runtimeLaunchReservations({ areaId: reservation.area_id }).find((entry) => entry.id === id);
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  holdRuntimeLaunch({ reservationId, attemptId, outcome, runtimeSessionId, capturedRuntimeSessionId, evidence } = {}) {
    const id = requiredText(reservationId, 'reservationId');
    const normalizedAttempt = requiredText(attemptId, 'attemptId');
    if (requiredText(outcome, 'outcome') !== 'unknown') {
      throw new TorchError('Only unknown runtime interruptions may be held', { code: 'INVALID_RUNTIME_LAUNCH_HOLD' });
    }
    const runtimeSession = optionalText(runtimeSessionId, 'runtimeSessionId');
    const capturedSession = optionalText(capturedRuntimeSessionId, 'capturedRuntimeSessionId');
    if (runtimeSession && capturedSession && runtimeSession !== capturedSession) {
      throw new TorchError('Runtime launch hold received conflicting captured provider IDs', { code: 'RUNTIME_LAUNCH_SESSION_MISMATCH' });
    }
    const observedRuntimeSessionId = capturedSession ?? runtimeSession;
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const reservation = this.database.prepare('SELECT * FROM runtime_launch_reservations WHERE id = ? AND project_id = ?').get(id, this.projectId);
      if (!reservation) throw new TorchError('Unknown runtime launch reservation', { code: 'RUNTIME_LAUNCH_RESERVATION_NOT_FOUND' });
      if (reservation.state !== 'starting') throw new TorchError('Only starting runtime launches may be held', { code: 'RUNTIME_LAUNCH_NOT_ACTIVE' });
      if (reservation.attempt_id !== normalizedAttempt) throw new TorchError('Runtime launch attempt does not match its reservation', { code: 'RUNTIME_LAUNCH_ATTEMPT_MISMATCH' });
      const unknownEvidence = this.runtimeLaunchEvidence({
        evidence, reservation, outcome: 'unknown', terminal: false, kind: 'unknown',
      });
      const knownSessionId = reservation.captured_runtime_session_id ?? reservation.expected_runtime_session_id ?? null;
      if (observedRuntimeSessionId && knownSessionId && observedRuntimeSessionId !== knownSessionId) {
        throw new TorchError('Runtime launch captured an unexpected provider session ID', { code: 'RUNTIME_LAUNCH_SESSION_MISMATCH' });
      }
      const boundSessionId = observedRuntimeSessionId ?? knownSessionId;
      const updatedAt = this.clock().toISOString();
      this.database.prepare('UPDATE runtime_launch_reservations SET state = ?, captured_runtime_session_id = ?, evidence = ? WHERE id = ?')
        .run('held', boundSessionId, JSON.stringify(unknownEvidence), id);
      this.database.prepare(`UPDATE identities SET runtime_session_id = ?, state = 'working', summary = ?, heartbeat_at = ?, updated_at = ? WHERE area_id = ?`)
        .run(boundSessionId, 'Runtime executor completion is unknown; duplicate launch is blocked pending reconciliation.', updatedAt, updatedAt, reservation.area_id);
      this.audit({ actorId: reservation.area_id, operation: 'runtime.launch.hold', entityType: 'runtime-launch-reservation', entityId: id,
        details: { attemptId: normalizedAttempt } });
      this.database.exec('COMMIT');
      return this.runtimeLaunchReservations({ areaId: reservation.area_id }).find((entry) => entry.id === id);
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  reconcileRuntimeLaunch({ reservationId, proof } = {}) {
    const id = requiredText(reservationId, 'reservationId');
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const reservation = this.database.prepare('SELECT * FROM runtime_launch_reservations WHERE id = ? AND project_id = ?').get(id, this.projectId);
      if (!reservation) throw new TorchError('Unknown runtime launch reservation', { code: 'RUNTIME_LAUNCH_RESERVATION_NOT_FOUND' });
      if (reservation.state !== 'held') throw new TorchError('Only held runtime launches require reconciliation', { code: 'RUNTIME_LAUNCH_RECONCILIATION_NOT_ALLOWED' });
      const stoppedProof = this.runtimeLaunchStoppedProof({ proof, reservation });
      const settledAt = this.clock().toISOString();
      this.database.prepare('UPDATE runtime_launch_reservations SET state = ?, evidence = ?, settled_at = ? WHERE id = ?')
        .run('reconciled-stopped', JSON.stringify(stoppedProof), settledAt, id);
      this.database.prepare(`UPDATE identities SET state = 'offline', summary = ?, heartbeat_at = ?, updated_at = ? WHERE area_id = ?`)
        .run('Runtime stopped by explicit reconciliation evidence.', settledAt, settledAt, reservation.area_id);
      this.audit({ actorId: reservation.area_id, operation: 'runtime.launch.reconcile', entityType: 'runtime-launch-reservation', entityId: id,
        details: { attemptId: reservation.attempt_id, proof: 'process-proof' } });
      this.database.exec('COMMIT');
      return this.runtimeLaunchReservations({ areaId: reservation.area_id }).find((entry) => entry.id === id);
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
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

  requestApproval({ requester, approver, task, title, summary, evidence } = {}) {
    const requesterId = this.assertIdentity(requester);
    const approverId = requiredText(approver, 'approver');
    if (approverId === 'owner') this.assertOwnerActor(approverId);
    else this.assertIdentity(approverId);
    if (requesterId === approverId) {
      throw new TorchError('An identity cannot request its own approval', { code: 'INVALID_APPROVAL_REQUEST' });
    }
    const normalizedTitle = requiredText(title, 'title');
    const normalizedSummary = requiredText(summary, 'summary');
    const normalizedEvidence = optionalText(evidence, 'evidence');
    if (normalizedTitle.length > 240 || normalizedSummary.length > 4000 || (normalizedEvidence?.length ?? 0) > 4000) {
      throw new TorchError('Approval title, summary, or evidence exceeds its size limit', {
        code: 'APPROVAL_REQUEST_TOO_LONG', details: { title: 240, summary: 4000, evidence: 4000 },
      });
    }
    const taskRef = optionalText(task, 'task');
    const record = {
      id: this.idFactory(), projectId: this.projectId, requester: requesterId, approver: approverId,
      task: taskRef, title: normalizedTitle, summary: normalizedSummary, evidence: normalizedEvidence,
      status: 'pending', revision: 1, createdAt: this.clock().toISOString(),
      decidedAt: null, decidedBy: null, decisionNote: null,
    };
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare(`
        INSERT INTO approval_requests (
          id, project_id, requester_id, approver_id, task_ref, title, summary, evidence,
          status, revision, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.id, record.projectId, record.requester, record.approver, record.task, record.title,
        record.summary, record.evidence, record.status, record.revision, record.createdAt,
      );
      if (approverId !== 'owner') {
        this.sendMessage({
          sender: requesterId, recipient: approverId, kind: 'approval-request',
          body: `${record.title}: ${record.summary}`, references: { task: taskRef },
        });
      }
      this.audit({ actorId: requesterId, operation: 'approval.request', entityType: 'approval', entityId: record.id });
      this.database.exec('COMMIT');
      return record;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  listApprovals({ actorId, status } = {}) {
    const actor = requiredText(actorId, 'actorId');
    const isOwner = actor === 'owner';
    if (isOwner) this.assertOwnerActor(actor);
    else this.assertIdentity(actor);
    const statusClause = status ? 'AND status = ?' : '';
    const params = isOwner
      ? (status ? [this.projectId, status] : [this.projectId])
      : (status ? [this.projectId, actor, actor, status] : [this.projectId, actor, actor]);
    const actorClause = isOwner ? '' : 'AND (requester_id = ? OR approver_id = ?)';
    return this.database.prepare(`
      SELECT * FROM approval_requests WHERE project_id = ? ${actorClause} ${statusClause}
      ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC, id DESC
    `).all(...params).map((row) => this.rowToApproval(row));
  }

  pendingApprovalsFor(requesterIds = []) {
    const ids = [...new Set(requesterIds.map((id) => this.assertIdentity(id)))];
    if (!ids.length) return [];
    const placeholders = ids.map(() => '?').join(',');
    return this.database.prepare(`
      SELECT * FROM approval_requests WHERE project_id = ? AND status = 'pending'
        AND requester_id IN (${placeholders}) ORDER BY created_at ASC, id ASC
    `).all(this.projectId, ...ids).map((row) => this.rowToApproval(row));
  }

  decideApproval({ approvalId, decidedBy, decision, note, expectedRevision } = {}) {
    const id = requiredText(approvalId, 'approvalId');
    const actor = requiredText(decidedBy, 'decidedBy');
    const owner = actor === 'owner';
    if (owner) this.assertOwnerActor(actor);
    else this.assertIdentity(actor);
    if (!['approved', 'rejected'].includes(decision)) {
      throw new TorchError('Approval decision must be approved or rejected', { code: 'INVALID_APPROVAL_DECISION' });
    }
    const normalizedNote = optionalText(note, 'note');
    if (normalizedNote && normalizedNote.length > 2000) {
      throw new TorchError('Approval decision note is limited to 2,000 characters', { code: 'APPROVAL_NOTE_TOO_LONG' });
    }
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const current = this.database.prepare('SELECT * FROM approval_requests WHERE id = ? AND project_id = ?').get(id, this.projectId);
      if (!current) throw new TorchError(`Unknown approval request: ${id}`, { code: 'APPROVAL_NOT_FOUND' });
      if (current.status !== 'pending') throw new TorchError(`Approval request ${id} is already ${current.status}`, { code: 'APPROVAL_NOT_PENDING' });
      if (current.approver_id !== actor) throw new TorchError('Only the named approver may decide this request', { code: 'APPROVER_AUTHORITY_REQUIRED' });
      if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
        throw new TorchError('Approval decisions require the current request revision', { code: 'APPROVAL_REVISION_REQUIRED' });
      }
      if (current.revision !== expectedRevision) {
        throw new TorchError('Approval request changed since it was read', { code: 'APPROVAL_REVISION_CONFLICT' });
      }
      const decidedAt = this.clock().toISOString();
      const nextRevision = current.revision + 1;
      this.database.prepare(`
        UPDATE approval_requests SET status = ?, revision = ?, decided_at = ?, decided_by = ?, decision_note = ?
        WHERE id = ? AND status = 'pending' AND revision = ?
      `).run(decision, nextRevision, decidedAt, actor, normalizedNote, id, current.revision);
      const details = { status: decision, requester: current.requester_id, approver: actor, note: normalizedNote };
      if (owner) {
        this.auditOwnerAction({ actorId: actor, operation: 'approval.decide', entityType: 'approval', entityId: id, details });
      } else {
        this.audit({ actorId: actor, operation: 'approval.decide', entityType: 'approval', entityId: id, details });
      }
      if (owner) {
        this.insertOwnerApprovalDecisionMessage({
          sender: actor, recipient: current.requester_id, approvalId: id,
          task: current.task_ref, decision, note: normalizedNote,
        });
      } else {
        this.sendMessage({
          sender: actor, recipient: current.requester_id, kind: 'approval-decision',
          body: `Approval ${decision}: ${normalizedNote ?? 'No additional note.'}`,
          references: { task: current.task_ref },
        });
      }
      this.database.exec('COMMIT');
      return this.rowToApproval(this.database.prepare('SELECT * FROM approval_requests WHERE id = ?').get(id));
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  insertOwnerApprovalDecisionMessage({ sender, recipient, approvalId, task, decision, note }) {
    const id = this.idFactory();
    const createdAt = this.clock().toISOString();
    const body = `Approval ${decision}: ${note ?? 'No additional note.'}`;
    this.database.prepare(`
      INSERT INTO messages (id, project_id, sender_id, recipient_id, kind, created_at, body, task_ref)
      VALUES (?, ?, ?, ?, 'approval-decision', ?, ?, ?)
    `).run(id, this.projectId, sender, recipient, createdAt, body, task ?? null);
    this.auditOwnerAction({
      actorId: sender, operation: 'approval.notify', entityType: 'message', entityId: id,
      details: { approvalId, recipient },
    });
  }

  rowToApproval(row) {
    return {
      id: row.id, projectId: row.project_id, requester: row.requester_id, approver: row.approver_id,
      task: row.task_ref ?? null, title: row.title, summary: row.summary, evidence: row.evidence ?? null,
      status: row.status, revision: row.revision, createdAt: row.created_at,
      decidedAt: row.decided_at ?? null, decidedBy: row.decided_by ?? null,
      decisionNote: row.decision_note ?? null,
    };
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

  auditOwnerAction({ actorId, operation, entityType, entityId = null, details = null } = {}) {
    const actor = this.assertOwnerActor(actorId);
    if (!['artifact.feedback', 'backlog.priority', 'backlog.create', 'agent.request', 'approval.decide', 'approval.notify', 'forge.sync', 'canonical.fetch', 'profile.change', 'schedule.launcher.install', 'schedule.launcher.reconcile', 'schedule.wake.recover', 'hierarchy.conclude-pilot', 'check.recover-prepared'].includes(operation)) {
      throw new TorchError('This owner audit surface does not authorize the requested operation', {
        code: 'OWNER_OPERATION_UNSUPPORTED', details: { operation },
      });
    }
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

  assertOwnerActor(actorId) {
    const ownerRole = organizationGraphFromConfig(this.config).roles.find((role) => role.kind === 'owner');
    const actor = requiredText(actorId, 'actorId');
    if (!ownerRole || actor !== ownerRole.identity_id) {
      throw new TorchError('Only the configured project owner may record this action', {
        code: 'OWNER_AUTHORITY_REQUIRED', details: { actorId: actor },
      });
    }
    return actor;
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
