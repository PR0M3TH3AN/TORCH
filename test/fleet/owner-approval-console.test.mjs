import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createConsoleServer } from '../../src/console/server.mjs';
import { openControlPlane } from '../../src/control-plane/service.mjs';
import { analyzeRepository } from '../../src/kernel/analyze.mjs';
import { proposeDomains } from '../../src/kernel/domains.mjs';
import { inspectRepository } from '../../src/kernel/git.mjs';
import { installProject } from '../../src/kernel/install.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'torch-owner-approval-console-'));
  execFileSync('git', ['init', '-b', 'main', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'torch-test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'TORCH Test']);
  writeFileSync(join(root, 'README.md'), '# Approval console fixture\n');
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'fixture']);
  const repository = inspectRepository(root);
  const proposal = proposeDomains({ repository, analysis: analyzeRepository(repository) });
  proposal.review = { status: 'approved', reviewedAt: '2026-09-28T00:00:00Z', reviewedBy: 'fixture-owner', notes: [] };
  const env = { ...process.env, XDG_DATA_HOME: mkdtempSync(join(tmpdir(), 'torch-owner-approval-state-')) };
  installProject({ repository, proposal, env, projectId: 'owner-approval-console-fixture' });
  return { root, env, requester: proposal.domains[0].id };
}

test('SCN-console-owner-approval: only owner-addressed requests get a revision-bound confirmed decision', async (context) => {
  const { root, env, requester } = fixture();
  const control = openControlPlane({ repositoryRoot: root, env });
  const stale = control.requestApproval({
    requester, approver: 'owner', task: null, title: 'Stale decision test',
    summary: 'A concurrent decision invalidates this preview.', evidence: 'EVIDENCE-STALE',
  });
  const peer = control.requestApproval({
    requester, approver: 'session-manager', task: null, title: 'Manager decision only',
    summary: 'The owner must not decide for the manager.', evidence: 'EVIDENCE-PEER',
  });
  const success = control.requestApproval({
    requester, approver: 'owner', task: null, title: 'Owner decision',
    summary: 'The owner explicitly decides this request.', evidence: 'EVIDENCE-OWNER',
  });
  control.close();

  const server = createConsoleServer({ repositoryRoot: root, env });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (id, suffix, body, requestOrigin = origin) => fetch(`${origin}/api/approvals/${id}/decision${suffix}`, {
    method: 'POST', headers: { origin: requestOrigin, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });

  const crossOrigin = await post(success.id, '/preview', { decision: 'approved' }, 'http://evil.invalid');
  assert.equal(crossOrigin.status, 403);
  assert.equal((await crossOrigin.json()).error, 'SAME_ORIGIN_REQUIRED');

  const peerPreview = await post(peer.id, '/preview', { decision: 'approved' });
  assert.equal(peerPreview.status, 403);
  assert.equal((await peerPreview.json()).error, 'APPROVER_AUTHORITY_REQUIRED');

  const stalePreviewResponse = await post(stale.id, '/preview', { decision: 'rejected', note: 'Needs owner review.' });
  assert.equal(stalePreviewResponse.status, 200);
  const stalePreview = await stalePreviewResponse.json();
  assert.equal(stalePreview.plan.mutationPerformed, false);
  assert.equal(stalePreview.plan.evidence, 'EVIDENCE-STALE');
  assert.equal(stalePreview.plan.revision, 1);
  const concurrent = openControlPlane({ repositoryRoot: root, env });
  concurrent.decideApproval({ approvalId: stale.id, decidedBy: 'owner', decision: 'approved', expectedRevision: 1 });
  concurrent.close();
  const staleConfirm = await post(stale.id, '', {
    decision: 'rejected', note: 'Needs owner review.', token: stalePreview.token, planHash: stalePreview.planHash,
  });
  assert.equal(staleConfirm.status, 409);
  assert.equal((await staleConfirm.json()).error, 'APPROVAL_NOT_PENDING');

  const previewResponse = await post(success.id, '/preview', { decision: 'approved', note: 'Proceed with the reviewed plan.' });
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json();
  assert.match(preview.plan.effect, /audit it, and notify/);
  const payload = { decision: 'approved', note: 'Proceed with the reviewed plan.', token: preview.token, planHash: preview.planHash };
  const confirmed = await post(success.id, '', payload);
  assert.equal(confirmed.status, 200);
  const result = await confirmed.json();
  assert.equal(result.mutationPerformed, true);
  assert.equal(result.approval.status, 'approved');
  assert.equal(result.approval.revision, 2);
  assert.equal(result.approval.decisionNote, 'Proceed with the reviewed plan.');
  const replay = await post(success.id, '', payload);
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).replayed, true);

  const verify = openControlPlane({ repositoryRoot: root, env });
  const messages = verify.readMessages({ recipient: requester });
  assert.equal(messages.filter((message) => message.kind === 'approval-decision' && message.body.includes('Proceed with the reviewed plan.')).length, 1);
  assert.equal(verify.listApprovals({ actorId: 'owner', status: 'pending' }).some((approval) => approval.id === peer.id), true);
  verify.close();
});
