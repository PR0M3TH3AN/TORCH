import assert from 'node:assert/strict';
import test from 'node:test';
import '../../site/attention-projection.js';
import '../../site/attention-actions.js';
import '../../site/live-refresh.js';

const project = (snapshot) => globalThis.TorchAttentionProjection.groups(snapshot);

test('SCN-console-continuation-stop: exhausted budget is an owner policy decision; no-progress remains manager-owned', () => {
  const groups = project({ continuation: { available: true, stopReason: 'daily-turn-cap', attempts: 12,
    maxTurnsPerDay: 12, day: '2026-10-03', held: [{ areaId: 'owner-console' }] } });
  assert.equal(groups.owner.length, 1);
  assert.match(groups.owner[0].detail, /explicitly change the limit/);
  assert.equal(groups.owner[0].decisionApprovalId, null, 'No fake approval or automatic budget expansion');
  assert.equal(groups.fleet.length, 1);
  assert.equal(groups.fleet[0].owner, 'session-manager');
  assert.equal(groups.fleet[0].requestOwner, 'session-manager');
  assert.equal(project({ continuation: { available: true, stopReason: 'paused', held: [] } }).owner.length, 0);
});

test('SCN-console-attention-ownership: only owner-addressed pending decisions enter Waiting on you', () => {
  const groups = project({
    agents: [
      { areaId: 'provider-runtime', title: 'Provider Runtime' },
      { areaId: 'qa', title: 'Independent QA' },
    ],
    approvalRequests: { items: [
      { id: 'owner-review', status: 'pending', approver: 'owner', requester: 'provider-runtime',
        title: 'Review executor boundary', task: 'TASK-RUNTIME', evidence: 'receipt:17', createdAt: '2026-10-01T06:00:00Z', summary: 'Confirm the bounded scope.' },
      { id: 'qa-review', status: 'pending', approver: 'qa', requester: 'owner-console',
        title: 'Confirm scenario path', summary: 'Review the owned test path.' },
    ] },
  });

  assert.deepEqual(groups.owner.map((item) => item.title), ['Review executor boundary']);
  assert.equal(groups.owner[0].href, '#approval-owner-review');
  assert.equal(groups.owner[0].decisionApprovalId, 'owner-review');
  assert.match(groups.owner[0].detail, /bounded scope/);
  assert.equal(groups.owner[0].waitSince, '2026-10-01T06:00:00Z');
  assert.equal(groups.fleet[0].owner, 'Independent QA');
  assert.equal(groups.fleet[0].decisionApprovalId, null);
  assert.equal(groups.fleet[0].action, 'Open approval details');
  assert.doesNotMatch(JSON.stringify(groups.fleet), /Approve|Reject/);
});

test('SCN-console-attention-owner-shortcut: a shortcut selects only an owner decision and retains the preview-confirm boundary', () => {
  const choice = { value: '', disabled: false };
  const form = { dataset: {}, elements: { namedItem: () => choice } };
  let previewCalls = 0;
  const result = globalThis.TorchAttentionActions.prepareOwnerDecisionShortcut(form, 'approved', () => { previewCalls += 1; });

  assert.equal(result.started, true);
  assert.equal(choice.value, 'approved');
  assert.equal(previewCalls, 1, 'the caller can only start the established preview handler');

  const nonOwnerForm = { dataset: {}, elements: { namedItem: () => ({ value: '', disabled: false }) } };
  const noOwnerShortcut = globalThis.TorchAttentionActions.prepareOwnerDecisionShortcut(nonOwnerForm, 'published', () => { previewCalls += 1; });
  assert.equal(noOwnerShortcut.started, false);
  assert.equal(nonOwnerForm.elements.namedItem().value, '');
});

test('SCN-console-attention-shortcut-drafts: missing forms, active previews, and opposite drafts remain unchanged', () => {
  const missing = globalThis.TorchAttentionActions.prepareOwnerDecisionShortcut(null, 'rejected');
  assert.equal(missing.started, false);
  assert.match(missing.reason, /no longer available/);

  const previewForm = { dataset: { previewToken: 'current-preview' },
    elements: { namedItem: () => ({ value: 'approved', disabled: true }) } };
  const preview = globalThis.TorchAttentionActions.prepareOwnerDecisionShortcut(previewForm, 'rejected');
  assert.equal(preview.started, false);
  assert.equal(previewForm.elements.namedItem().value, 'approved');

  const draftChoice = { value: 'approved', disabled: false };
  const draftForm = { dataset: {}, elements: { namedItem: () => draftChoice } };
  const draft = globalThis.TorchAttentionActions.prepareOwnerDecisionShortcut(draftForm, 'rejected');
  assert.equal(draft.started, false);
  assert.equal(draftChoice.value, 'approved');
  assert.match(draft.reason, /draft is preserved/);
});

test('SCN-console-attention-refresh-draft: an edited owner decision remains protected while newer evidence renders', () => {
  const choice = { value: '', checked: false, tagName: 'SELECT', selectedOptions: [] };
  const note = { value: '', checked: false, tagName: 'TEXTAREA' };
  const fields = [choice, note];
  const form = {
    contains: () => false,
    matches: () => false,
    querySelector: () => null,
    querySelectorAll: () => fields,
  };
  const document = { activeElement: null, querySelectorAll: () => fields };
  const protection = globalThis.TorchLiveRefresh.createProtection(document);
  protection.remember();
  choice.value = 'rejected';
  note.value = 'Need the exact impact first.';

  assert.equal(protection.protects(form), true);
  const dirty = protection.dirty();
  protection.remember({ preserve: dirty });
  assert.equal(protection.protects(form), true);
  assert.equal(choice.value, 'rejected');
  assert.equal(note.value, 'Need the exact impact first.');
});

test('SCN-console-attention-dedup: doctor and snapshot message counts become one honest queue item', () => {
  const groups = project({
    messages: { unacknowledged: 4 },
    doctor: { findings: [
      { severity: 'warning', code: 'MESSAGE_BACKLOG', unacknowledged: 3 },
      { severity: 'warning', code: 'MESSAGE_BACKLOG', unacknowledged: 3 },
    ] },
  });

  const queue = groups.fleet.filter((item) => item.href === '#communications');
  assert.equal(queue.length, 1);
  assert.equal(queue[0].title, '4 durable messages awaiting acknowledgement');
  assert.match(queue[0].detail, /Each named recipient owns their acknowledgement/);
});

test('SCN-console-attention-worktrees: findings group by owning area and distinguish retained commits from unsafe operations', () => {
  const groups = project({
    agents: [{ areaId: 'provider-runtime', title: 'Provider Runtime' }],
    doctor: { findings: [
      { severity: 'warning', code: 'WORKTREE_PROBLEM', area: 'provider-runtime', path: '/work/provider', problem: 'unique-commits:2' },
      { severity: 'warning', code: 'WORKTREE_PROBLEM', areaId: 'provider-runtime', path: '/work/provider', problem: 'worktree-dirty' },
      { severity: 'warning', code: 'WORKTREE_PROBLEM', area: 'project-kernel', path: '/work/kernel', problem: 'unique-commits:1' },
      { severity: 'error', code: 'WORKTREE_PROBLEM', area: 'qa', path: '/work/qa', problem: 'git-operation:REBASE_HEAD' },
    ] },
    worktrees: [
      { area: 'provider-runtime', branch: 'runtime/fix', path: '/work/provider', ahead: 2, behind: 0 },
      { area: 'project-kernel', branch: 'kernel/change', path: '/work/kernel', ahead: 1, behind: 0 },
      { area: 'qa', branch: 'qa/audit', path: '/work/qa', ahead: 0, behind: 0 },
    ],
  });

  assert.equal(groups.fleet.length, 3);
  const runtime = groups.fleet.find((item) => item.owner === 'Provider Runtime');
  assert.equal(runtime.tone, 'review');
  assert.match(runtime.detail, /Ahead commits are retained work progress, not a broken repository/);
  assert.match(runtime.evidence, /runtime\/fix · \/work\/provider/);
  assert.equal(runtime.requestOwner, 'provider-runtime');
  const kernel = groups.fleet.find((item) => item.owner === 'project-kernel');
  assert.equal(kernel.tone, 'info');
  assert.match(kernel.detail, /owning specialist or manager/);
  const qa = groups.fleet.find((item) => item.owner === 'qa');
  assert.equal(qa.tone, 'urgent');
  assert.match(qa.title, /worktree needs review/);
});

test('SCN-console-attention-wait-reasons: recovery and blocked task evidence keep consequences and actual reason visible', () => {
  const groups = project({
    agents: [{ areaId: 'release-self-host', title: 'Release and Self-host' }],
    doctor: { findings: [{ severity: 'warning', code: 'RECOVERABILITY', level: 'ONE-DISK',
      offMachine: false, commit: 'abcdef0123456789', recommendation: 'Configure and synchronize an off-machine canonical Git boundary.' }] },
    backlog: [{ id: 'TASK-BLOCKED', title: 'Capture mobile UI', state: 'blocked', owner: 'owner-console',
      blockedReason: 'Browser CDP timed out; no image was saved.' }],
  });

  const recovery = groups.fleet.find((item) => item.title === 'Off-machine recovery copy is not verified');
  assert.equal(recovery.owner, 'Responsible domain not recorded');
  assert.match(recovery.detail, /single disk failure could remove/);
  assert.match(recovery.evidence, /ONE-DISK · abcdef012/);
  assert.match(groups.fleet.find((item) => item.evidence === 'TASK-BLOCKED').detail, /no image was saved/);
});

test('SCN-console-attention-authority: roster titles name owners and integration stays with Fleet unless arbiter authority is explicit', () => {
  const groups = project({
    agents: [{ areaId: 'coordinator-7', title: 'Delivery Coordinator' }],
    integration: [
      { state: 'awaiting-checks', sourceArea: 'build-team', sourceCommit: '1234567890abcdef', authorizedBy: 'coordinator-7' },
      { state: 'queued', sourceArea: 'docs-team', sourceCommit: 'abcdef0123456789' },
    ],
    managerWakes: { blockingCount: 1, reservations: [{ managerId: 'coordinator-7', scheduleId: 'nightly-review',
      outcome: 'reserved', blocksManagerWake: true }] },
  });

  assert.equal(groups.fleet.length, 3);
  assert.equal(groups.fleet[0].owner, 'Delivery Coordinator');
  assert.match(groups.fleet[0].evidence, /authorized by Delivery Coordinator/);
  assert.equal(groups.fleet[1].owner, 'Integration authority not recorded');
  assert.equal(groups.fleet[2].owner, 'Delivery Coordinator');
  assert.deepEqual(groups.arbiter, []);
});

test('SCN-console-attention-empty: an unavailable signal does not manufacture owner work', () => {
  const groups = project({
    approvalRequests: { available: false, reason: 'Structured approval service unavailable.' },
    messages: { unacknowledged: 0 }, doctor: { findings: [] },
  });

  assert.deepEqual(groups, { owner: [], fleet: [], arbiter: [] });
});
