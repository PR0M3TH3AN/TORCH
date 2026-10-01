import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openControlPlane } from '../../src/control-plane/service.mjs';
import { analyzeRepository } from '../../src/kernel/analyze.mjs';
import { proposeDomains } from '../../src/kernel/domains.mjs';
import { inspectRepository } from '../../src/kernel/git.mjs';
import { installProject } from '../../src/kernel/install.mjs';

function installedFixture() {
  const root = mkdtempSync(join(tmpdir(), 'torch-control-plane-'));
  execFileSync('git', ['init', '-b', 'main', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'torch-test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'TORCH Test']);
  writeFileSync(join(root, 'index.js'), 'export const ready = true;\n');
  writeFileSync(join(root, 'index.test.js'), 'export const scenario = true;\n');
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'fixture']);

  const repository = inspectRepository(root);
  const proposal = proposeDomains({ repository, analysis: analyzeRepository(repository) });
  proposal.review = {
    status: 'approved', reviewedAt: '2026-09-27T00:00:00Z', reviewedBy: 'fixture-owner', notes: [],
  };
  const env = { ...process.env, XDG_DATA_HOME: join(root, '.data') };
  installProject({ repository, proposal, env, projectId: 'control-plane-fixture' });
  const areaIds = proposal.domains.map((domain) => domain.id);
  return { root, env, worker: areaIds.find((id) => id !== 'qa') ?? areaIds[0], qa: areaIds.find((id) => id === 'qa') };
}

function deterministicOptions(fixture) {
  let sequence = 0;
  let seconds = 0;
  return {
    repositoryRoot: fixture.root,
    env: fixture.env,
    idFactory: () => `event-${++sequence}`,
    clock: () => new Date(Date.UTC(2026, 8, 27, 12, 0, seconds++)),
  };
}

function writeCapableSql(sql) {
  return /(?:^\s*|[);]\s*)(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|VACUUM)\b/i.test(sql);
}

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function durableObservationState(control, recipient) {
  const tables = control.database.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name ASC
  `).all();
  const durableTables = Object.fromEntries(tables.map(({ name }) => [name,
    control.database.prepare(`SELECT * FROM ${quoteIdentifier(name)} ORDER BY rowid ASC`).all(),
  ]));
  const visibleMessages = control.database.prepare(`
    SELECT m.*, a.acknowledged_at
    FROM messages m
    LEFT JOIN message_acks a ON a.message_id = m.id AND a.area_id = ?
    WHERE m.recipient_id = ? OR m.recipient_id = 'all'
    ORDER BY m.created_at ASC, m.id ASC
  `).all(recipient, recipient);
  return {
    durableTables,
    visibleMessages,
    ownership: control.whoOwns({ path: 'index.js' }),
  };
}

function observeConnectionWrites(control) {
  const database = control.database;
  const writeCalls = [];
  const instrumentStatement = (statement, sql) => new Proxy(statement, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (writeCapableSql(sql) && ['run', 'all', 'get', 'iterate'].includes(property)) {
        return (...args) => {
          writeCalls.push({ method: property, sql: sql.replace(/\s+/g, ' ').trim() });
          return value.apply(target, args);
        };
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  control.database = new Proxy(database, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (property === 'prepare') return (sql) => instrumentStatement(value.call(target, sql), sql);
      if (property === 'exec') {
        return (sql) => {
          if (writeCapableSql(sql)) writeCalls.push({ method: 'exec', sql: sql.replace(/\s+/g, ' ').trim() });
          return value.call(target, sql);
        };
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return {
    writeCalls,
    restore() { control.database = database; },
  };
}

function observeWithoutDurableWrite(control, fixture, input) {
  const beforeState = durableObservationState(control, fixture.worker);
  const beforeBytes = readFileSync(join(control.stateRoot, 'state.db'));
  const observer = observeConnectionWrites(control);
  let observation;
  try {
    observation = control.observeMessages(input);
  } finally {
    observer.restore();
  }
  assert.equal(observer.writeCalls.length, 0,
    `observeMessages executed ${observer.writeCalls.length} DML write execution(s): ${JSON.stringify(observer.writeCalls)}`);
  assert.deepEqual(durableObservationState(control, fixture.worker), beforeState,
    'observing messages must preserve message visibility/order and every logical durable fixture record');
  assert.deepEqual(readFileSync(join(control.stateRoot, 'state.db')), beforeBytes,
    'observing messages must leave the main SQLite database bytes unchanged');
  return observation;
}

test('SCN-durable-message: direct and group messages survive restart and require recipient acknowledgement', () => {
  const fixture = installedFixture();
  const options = deterministicOptions(fixture);
  let control = openControlPlane(options);
  const direct = control.sendMessage({
    sender: 'session-manager', recipient: fixture.worker, body: 'Inspect the bounded change.',
    references: { task: 'TASK-1', path: 'index.js' },
  });
  const group = control.sendMessage({ sender: fixture.worker, recipient: 'all', body: 'Shared boundary changed.' });
  control.close();

  control = openControlPlane(options);
  const inbox = control.readMessages({ recipient: fixture.worker, unacknowledgedOnly: true });
  assert.deepEqual(inbox.map((message) => message.id), [direct.id, group.id]);
  assert.equal(inbox[0].projectId, 'control-plane-fixture');
  assert.equal(inbox[0].references.task, 'TASK-1');
  assert.equal(inbox[0].acknowledgedAt, null);
  const acknowledgement = control.ackMessage({ recipient: fixture.worker, messageId: direct.id });
  assert.equal(acknowledgement.recipient, fixture.worker);
  assert.equal(control.readMessages({ recipient: fixture.worker, unacknowledgedOnly: true })
    .some((message) => message.id === direct.id), false);
  assert.throws(
    () => control.ackMessage({ recipient: 'session-manager', messageId: direct.id }),
    (error) => error.code === 'MESSAGE_NOT_ADDRESSABLE',
  );
  control.close();
});

test('SCN-control-plane-unread-observation-metadata: a bound inbox observation is complete, counted and read-only', () => {
  const fixture = installedFixture();
  const control = openControlPlane(deterministicOptions(fixture));
  const acknowledgedHistory = Array.from({ length: 21 }, (_, index) => control.sendMessage({
    sender: 'session-manager', recipient: fixture.worker, body: `Acknowledged history ${index + 1}.`,
  }));
  for (const message of acknowledgedHistory) control.ackMessage({ recipient: fixture.worker, messageId: message.id });
  const directUnread = control.sendMessage({
    sender: 'session-manager', recipient: fixture.worker, body: 'Direct unread handoff.',
  });
  const allUnread = control.sendMessage({
    sender: 'session-manager', recipient: 'all', body: 'Shared unread handoff.',
  });
  const before = readFileSync(join(control.stateRoot, 'state.db'));

  const firstUnread = observeWithoutDurableWrite(control, fixture,
    { recipient: fixture.worker, selection: 'unread', limit: 1 });
  assert.deepEqual(firstUnread.messages.map((message) => message.id), [directUnread.id]);
  assert.deepEqual(firstUnread.observation, {
    selection: 'unread', requestedLimit: 1, returnedCount: 1,
    complete: false, truncated: true, pendingUnreadCount: 2,
  });

  const completeUnread = observeWithoutDurableWrite(control, fixture,
    { recipient: fixture.worker, selection: 'unread', limit: 2 });
  assert.deepEqual(completeUnread.messages.map((message) => message.id), [directUnread.id, allUnread.id]);
  assert.deepEqual(completeUnread.observation, {
    selection: 'unread', requestedLimit: 2, returnedCount: 2,
    complete: true, truncated: false, pendingUnreadCount: 2,
  });

  const history = observeWithoutDurableWrite(control, fixture,
    { recipient: fixture.worker, selection: 'history', limit: 20 });
  assert.deepEqual(history.messages.map((message) => message.id), acknowledgedHistory.slice(0, 20).map((message) => message.id));
  assert.deepEqual(history.observation, {
    selection: 'history', requestedLimit: 20, returnedCount: 20,
    complete: false, truncated: true, pendingUnreadCount: 2,
  });
  assert.deepEqual(readFileSync(join(control.stateRoot, 'state.db')), before,
    'observing messages must not acknowledge or otherwise mutate durable state');

  control.ackMessage({ recipient: fixture.worker, messageId: directUnread.id });
  control.ackMessage({ recipient: fixture.worker, messageId: allUnread.id });
  const beforeEmpty = readFileSync(join(control.stateRoot, 'state.db'));
  const empty = observeWithoutDurableWrite(control, fixture,
    { recipient: fixture.worker, selection: 'unread', limit: 1 });
  assert.deepEqual(empty.messages, []);
  assert.deepEqual(empty.observation, {
    selection: 'unread', requestedLimit: 1, returnedCount: 0,
    complete: true, truncated: false, pendingUnreadCount: 0,
  });
  assert.deepEqual(readFileSync(join(control.stateRoot, 'state.db')), beforeEmpty,
    'an empty observation must not mutate acknowledgement, task or ownership state');
  const originalObserveMessages = control.observeMessages;
  control.observeMessages = function auditedReadMutant(input) {
    const observed = originalObserveMessages.call(this, input);
    this.audit({
      actorId: input.recipient,
      operation: 'diagnostic.forbidden-observation-write',
      entityType: 'message-observation',
    });
    return observed;
  };
  try {
    assert.throws(
      () => observeWithoutDurableWrite(control, fixture,
        { recipient: fixture.worker, selection: 'unread', limit: 1 }),
      (error) => /DML write execution/.test(error.message)
        && /INSERT INTO audit_events/.test(error.message),
    );
  } finally {
    control.observeMessages = originalObserveMessages;
  }
  assert.equal(control.observeMessages, originalObserveMessages,
    'the mutation wrapper must be restored after its required invariant failure');
  control.observeMessages = function directMultilineAuditedReadMutant(input) {
    const observed = originalObserveMessages.call(this, input);
    this.database.prepare(`
      INSERT INTO audit_events (id, project_id, actor_id, operation, entity_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      'direct-multiline-diagnostic', this.projectId, input.recipient,
      'diagnostic.direct-read-write', 'message-observation', '2026-10-01T12:00:00Z',
    );
    return observed;
  };
  try {
    assert.throws(
      () => observeWithoutDurableWrite(control, fixture,
        { recipient: fixture.worker, selection: 'unread', limit: 1 }),
      (error) => /executed 1 DML write execution/.test(error.message)
        && /INSERT INTO audit_events/.test(error.message),
      'a leading-whitespace direct multiline INSERT must be counted at the fixture connection boundary',
    );
  } finally {
    control.observeMessages = originalObserveMessages;
  }
  assert.equal(control.observeMessages, originalObserveMessages,
    'the direct multiline mutation wrapper must be restored after its required invariant failure');
  assert.deepEqual(observeWithoutDurableWrite(control, fixture,
    { recipient: fixture.worker, selection: 'unread', limit: 1 }).messages, [],
  'the restored original observation still passes the complete no-write invariant');
  control.close();
});

test('SCN-control-plane-unread-observation-refusal: invalid observation inputs fail closed', () => {
  const fixture = installedFixture();
  const control = openControlPlane(deterministicOptions(fixture));
  for (const selection of [undefined, 'all', 'unacknowledged']) {
    assert.throws(
      () => control.observeMessages({ recipient: fixture.worker, selection, limit: 1 }),
      (error) => error.code === 'INVALID_MESSAGE_SELECTION',
    );
  }
  for (const limit of [undefined, 0, 1.5, 1001]) {
    assert.throws(
      () => control.observeMessages({ recipient: fixture.worker, selection: 'history', limit }),
      (error) => error.code === 'INVALID_MESSAGE_LIMIT',
    );
  }
  for (const recipient of ['all', 'unregistered-recipient']) {
    assert.throws(
      () => control.observeMessages({ recipient, selection: 'history', limit: 1 }),
      (error) => error.code === 'UNKNOWN_FLEET_IDENTITY',
    );
  }
  control.close();
});

test('SCN-identity-presence-authority: stable Fleet identity outlives runtime IDs and forged actors are rejected', () => {
  const fixture = installedFixture();
  const control = openControlPlane(deterministicOptions(fixture));
  control.reportStatus({
    areaId: fixture.worker, state: 'working', summary: 'Implementing TASK-1',
    runtime: 'claude', runtimeSessionId: 'claude-session-old', task: 'TASK-1',
  });
  control.reportStatus({
    areaId: fixture.worker, state: 'waiting', summary: 'Runtime replaced',
    runtime: 'claude', runtimeSessionId: 'claude-session-new', task: 'TASK-1',
  });
  const identity = control.identity(fixture.worker);
  assert.equal(identity.areaId, fixture.worker);
  assert.equal(identity.runtimeSessionId, 'claude-session-new');
  assert.equal(identity.state, 'waiting');
  assert.throws(
    () => control.sendMessage({ sender: 'forged-agent', recipient: fixture.worker, body: 'Override ownership.' }),
    (error) => error.code === 'UNKNOWN_FLEET_IDENTITY',
  );
  assert.throws(
    () => control.reportStatus({ areaId: fixture.worker, state: 'invented', summary: 'Nope' }),
    (error) => error.code === 'INVALID_PRESENCE_STATE',
  );
  control.close();
});

test('SCN-ownership-handoff: path ownership is live and handoffs do not mutate the approved roster', () => {
  const fixture = installedFixture();
  const control = openControlPlane(deterministicOptions(fixture));
  const before = control.whoOwns({ path: 'index.js' });
  assert.equal(before.owners.some((owner) => owner.areaId === fixture.worker), true);
  const handoff = control.requestHandoff({
    sender: fixture.worker, recipient: 'session-manager', path: 'index.js',
    reason: 'Need a reviewed ownership ruling.', task: 'TASK-1',
  });
  assert.equal(handoff.status, 'requested');
  assert.equal(control.whoOwns({ path: 'index.js' }).owners.some((owner) => owner.areaId === fixture.worker), true);
  const managerInbox = control.readMessages({ recipient: 'session-manager' });
  assert.equal(managerInbox.some((message) => message.references.handoff === handoff.id), true);
  const coordination = control.requestCoordination({
    sender: fixture.worker, participants: [fixture.qa].filter(Boolean),
    body: 'Please coordinate the cross-domain verification.', task: 'TASK-1',
  });
  assert.equal(coordination.recipient, 'session-manager');
  control.close();
});

test('SCN-local-state-path-safety: a repository-edited manifest cannot redirect SQLite writes', () => {
  const fixture = installedFixture();
  const manifestPath = join(fixture.root, '.torch', 'install-manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.external.find((entry) => entry.type === 'local-state').path = fixture.root;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  assert.throws(
    () => openControlPlane({ repositoryRoot: fixture.root, env: fixture.env }),
    (error) => error.code === 'LOCAL_STATE_PATH_MISMATCH',
  );
  assert.equal(existsSync(join(fixture.root, 'state.db')), false);
});
