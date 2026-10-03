import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { TorchError } from '../kernel/errors.mjs';
import { readInstallManifest } from '../kernel/install.mjs';
import { projectStatePath } from '../kernel/paths.mjs';
import { loadProjectConfig } from '../kernel/config.mjs';
import { organizationGraphFromConfig } from '../kernel/organization.mjs';
import { consumeStoppedExecutorEvidence } from '../runtime/stopped-executor-evidence.mjs';

export const PRESENCE_STATES = Object.freeze([
  'starting', 'working', 'waiting', 'idle', 'stale', 'stopping', 'offline',
]);

const MESSAGE_KINDS = new Set([
  'message', 'coordination-request', 'handoff-request', 'completion', 'blocker', 'manager-check-in', 'manager-stale-work-review',
  'approval-request', 'approval-decision',
]);

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
    CREATE INDEX IF NOT EXISTS approval_requests_pending_approver
      ON approval_requests(project_id, approver_id, status, created_at, id);
    CREATE INDEX IF NOT EXISTS approval_requests_pending_requester
      ON approval_requests(project_id, requester_id, status, created_at, id);
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

  recoverOwnerStoppedUnknownIdentity({ actorId, areaId, expectedIdentity, evidence } = {}) {
    const owner = this.assertOwnerActor(actorId);
    const id = this.assertIdentity(areaId);
    if (!expectedIdentity || ['state', 'runtime', 'runtimeSessionId', 'updatedAt'].some(key => !expectedIdentity[key])) {
      throw new TorchError('Recovery requires the complete previewed identity snapshot.', { code: 'RUNTIME_RECOVERY_SNAPSHOT_REQUIRED' });
    }
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const current = this.identity(id);
      if (current.state !== 'working' || !current.summary?.includes('Runtime executor completion is unknown')
        || ['state', 'runtime', 'runtimeSessionId', 'updatedAt'].some(key => current[key] !== expectedIdentity[key])) {
        throw new TorchError('Identity changed since recovery was reviewed.', { code: 'RUNTIME_RECOVERY_SNAPSHOT_CONFLICT' });
      }
      const facts = consumeStoppedExecutorEvidence(evidence, { projectId: this.projectId, repositoryRoot: this.repositoryRoot, identity: current });
      const now = this.clock().toISOString();
      const result = this.database.prepare(`UPDATE identities SET state = 'offline', summary = ?, heartbeat_at = ?, updated_at = ?
        WHERE area_id = ? AND state = ? AND runtime = ? AND runtime_session_id = ? AND updated_at = ?`)
        .run('Owner verified stopped legacy executor; prior outcome remains unknown.', now, now,
          id, current.state, current.runtime, current.runtimeSessionId, current.updatedAt);
      if (result.changes !== 1) throw new TorchError('Recovery lost its identity snapshot.', { code: 'RUNTIME_RECOVERY_SNAPSHOT_CONFLICT' });
      const audit = this.auditOwnerAction({ actorId: owner, operation: 'runtime.legacy-unknown.recover-stopped',
        entityType: 'identity', entityId: id, details: { previousIdentity: expectedIdentity, ...facts } });
      this.database.exec('COMMIT');
      return { identity: this.identity(id), auditId: audit.id, priorOutcome: 'unknown', sessionsStarted: false, mutationPerformed: true };
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
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
    if (!['artifact.feedback', 'backlog.priority', 'backlog.create', 'agent.request', 'approval.decide', 'approval.notify', 'forge.sync', 'canonical.fetch', 'profile.change', 'schedule.launcher.install', 'schedule.launcher.reconcile', 'schedule.wake.recover', 'hierarchy.conclude-pilot', 'check.recover-prepared', 'runtime.legacy-unknown.recover-stopped', 'runtime.continuation.configure'].includes(operation)) {
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
