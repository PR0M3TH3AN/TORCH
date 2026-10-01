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

  const firstUnread = control.observeMessages({ recipient: fixture.worker, selection: 'unread', limit: 1 });
  assert.deepEqual(firstUnread.messages.map((message) => message.id), [directUnread.id]);
  assert.deepEqual(firstUnread.observation, {
    selection: 'unread', requestedLimit: 1, returnedCount: 1,
    complete: false, truncated: true, pendingUnreadCount: 2,
  });

  const completeUnread = control.observeMessages({ recipient: fixture.worker, selection: 'unread', limit: 2 });
  assert.deepEqual(completeUnread.messages.map((message) => message.id), [directUnread.id, allUnread.id]);
  assert.deepEqual(completeUnread.observation, {
    selection: 'unread', requestedLimit: 2, returnedCount: 2,
    complete: true, truncated: false, pendingUnreadCount: 2,
  });

  const history = control.observeMessages({ recipient: fixture.worker, selection: 'history', limit: 20 });
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
  const empty = control.observeMessages({ recipient: fixture.worker, selection: 'unread', limit: 1 });
  assert.deepEqual(empty.messages, []);
  assert.deepEqual(empty.observation, {
    selection: 'unread', requestedLimit: 1, returnedCount: 0,
    complete: true, truncated: false, pendingUnreadCount: 0,
  });
  assert.deepEqual(readFileSync(join(control.stateRoot, 'state.db')), beforeEmpty,
    'an empty observation must not mutate acknowledgement, task or ownership state');
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
