import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openControlPlane } from '../../src/control-plane/service.mjs';
import { analyzeRepository } from '../../src/kernel/analyze.mjs';
import { proposeDomains } from '../../src/kernel/domains.mjs';
import { inspectRepository } from '../../src/kernel/git.mjs';
import { installProject } from '../../src/kernel/install.mjs';

function installedFixture({ projectId = 'owner-reply-fixture', sequencePrefix = 'main' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'torch-owner-reply-'));
  execFileSync('git', ['init', '-b', 'main', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'torch-test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'TORCH Test']);
  writeFileSync(join(root, 'index.js'), 'export const fixture = true;\n');
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'fixture']);
  const repository = inspectRepository(root);
  const proposal = proposeDomains({ repository, analysis: analyzeRepository(repository) });
  proposal.review = { status: 'approved', reviewedAt: '2026-10-03T00:00:00Z', reviewedBy: 'fixture-owner', notes: [] };
  const env = { ...process.env, XDG_DATA_HOME: join(root, '.data') };
  installProject({ repository, proposal, env, projectId });
  let sequence = 0;
  let seconds = 0;
  return {
    root, env,
    worker: proposal.domains.find((domain) => domain.id !== 'qa')?.id ?? proposal.domains[0].id,
    options: {
      repositoryRoot: root, env,
      idFactory: () => `${sequencePrefix}-${++sequence}`,
      clock: () => new Date(Date.UTC(2026, 9, 3, 12, 0, seconds++)),
    },
  };
}

test('SCN-owner-addressed-reply-durability: a registered agent replies to its owner request with durable attribution', () => {
  const fixture = installedFixture();
  let control = openControlPlane(fixture.options);
  const request = control.sendOwnerRequest({ actorId: 'owner', recipient: fixture.worker, body: 'Report the persisted outcome.' });
  const first = control.sendOwnerReply({ sender: fixture.worker, requestId: request.id, body: 'The durable outcome is ready.' });
  const second = control.sendOwnerReply({ sender: fixture.worker, requestId: request.id, body: 'The evidence remains bounded.' });
  control.close();

  control = openControlPlane(fixture.options);
  const firstPage = control.readOwnerConversation({ actorId: 'owner', requestId: request.id, limit: 1 });
  assert.equal(firstPage.request.id, request.id);
  assert.deepEqual(firstPage.replies.map((message) => message.id), [first.id]);
  assert.equal(firstPage.replies[0].recipient, 'owner');
  assert.equal(firstPage.replies[0].references.replyTo, request.id);
  assert.equal(firstPage.page.truncated, true);
  const secondPage = control.readOwnerConversation({ actorId: 'owner', requestId: request.id, cursor: firstPage.page.nextCursor, limit: 1 });
  assert.deepEqual(secondPage.replies.map((message) => message.id), [second.id]);
  assert.equal(secondPage.page.complete, true);
  assert.equal(secondPage.page.nextCursor, null);
  const audit = control.readAudit().find((event) => event.operation === 'message.reply-owner' && event.entityId === first.id);
  assert.deepEqual(audit && { actorId: audit.actorId, details: audit.details }, { actorId: fixture.worker, details: { requestId: request.id } });
  control.close();
});

test('SCN-owner-addressed-reply-refusal: forged owner recipients, senders, and references leave durable state untouched', () => {
  const fixture = installedFixture();
  const foreign = installedFixture({ projectId: 'foreign-owner-reply-fixture', sequencePrefix: 'foreign' });
  const control = openControlPlane(fixture.options);
  const request = control.sendOwnerRequest({ actorId: 'owner', recipient: fixture.worker, body: 'Respond only from your registered identity.' });
  const foreignControl = openControlPlane(foreign.options);
  const foreignRequest = foreignControl.sendOwnerRequest({ actorId: 'owner', recipient: foreign.worker, body: 'Foreign request.' });
  foreignControl.close();
  const beforeAudit = control.readAudit().length;
  const beforeMessages = control.readMessages({ recipient: fixture.worker }).length;
  const beforeConversation = control.readOwnerConversation({ actorId: 'owner', requestId: request.id, limit: 10 });
  assert.deepEqual(beforeConversation.replies, []);

  assert.throws(() => control.sendMessage({ sender: fixture.worker, recipient: 'owner', body: 'Bypass the reply boundary.' }), (error) => error.code === 'UNKNOWN_FLEET_IDENTITY');
  assert.throws(() => control.sendOwnerReply({ sender: 'owner', requestId: request.id, body: 'Spoofed sender.' }), (error) => error.code === 'UNKNOWN_FLEET_IDENTITY');
  assert.throws(() => control.sendOwnerReply({ sender: fixture.worker, requestId: foreignRequest.id, body: 'Foreign reference.' }), (error) => error.code === 'OWNER_REPLY_REFERENCE_INVALID');
  assert.throws(() => control.sendOwnerReply({ sender: fixture.worker, requestId: 'forged-message-id', body: 'Forged reference.' }), (error) => error.code === 'OWNER_REPLY_REFERENCE_INVALID');
  assert.throws(() => control.readOwnerConversation({ actorId: fixture.worker, requestId: request.id, limit: 1 }), (error) => error.code === 'OWNER_AUTHORITY_REQUIRED');
  assert.equal(control.readAudit().length, beforeAudit);
  assert.equal(control.readMessages({ recipient: fixture.worker }).length, beforeMessages);
  const afterConversation = control.readOwnerConversation({ actorId: 'owner', requestId: request.id, limit: 10 });
  assert.deepEqual(afterConversation.replies, []);
  assert.deepEqual(afterConversation.page, beforeConversation.page);
  const direct = control.sendMessage({ sender: 'session-manager', recipient: fixture.worker, body: 'Existing direct delivery.' });
  const broadcast = control.sendMessage({ sender: fixture.worker, recipient: 'all', body: 'Existing broadcast delivery.' });
  assert.deepEqual(control.readMessages({ recipient: fixture.worker }).slice(-2).map((message) => message.id), [direct.id, broadcast.id]);
  control.close();
});
