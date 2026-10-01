import assert from 'node:assert/strict';
import test from 'node:test';
import '../../site/attention-projection.js';

const project = (snapshot) => globalThis.TorchAttentionProjection.groups(snapshot);

test('SCN-console-attention-ownership: only owner-addressed pending decisions enter Waiting on you', () => {
  const groups = project({
    agents: [
      { areaId: 'provider-runtime', title: 'Provider Runtime' },
      { areaId: 'qa', title: 'Independent QA' },
    ],
    approvalRequests: { items: [
      { id: 'owner-review', status: 'pending', approver: 'owner', requester: 'provider-runtime',
        title: 'Review executor boundary', task: 'TASK-RUNTIME', evidence: 'receipt:17', summary: 'Confirm the bounded scope.' },
      { id: 'qa-review', status: 'pending', approver: 'qa', requester: 'owner-console',
        title: 'Confirm scenario path', summary: 'Review the owned test path.' },
    ] },
  });

  assert.deepEqual(groups.owner.map((item) => item.title), ['Review executor boundary']);
  assert.equal(groups.owner[0].href, '#approval-owner-review');
  assert.match(groups.owner[0].detail, /bounded scope/);
  assert.equal(groups.fleet[0].owner, 'Independent QA');
  assert.equal(groups.fleet[0].action, 'Open approval details');
  assert.doesNotMatch(JSON.stringify(groups.fleet), /Approve|Reject/);
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
      { severity: 'error', code: 'WORKTREE_PROBLEM', area: 'qa', path: '/work/qa', problem: 'git-operation:REBASE_HEAD' },
    ] },
    worktrees: [
      { area: 'provider-runtime', branch: 'runtime/fix', path: '/work/provider', ahead: 2, behind: 0 },
      { area: 'qa', branch: 'qa/audit', path: '/work/qa', ahead: 0, behind: 0 },
    ],
  });

  assert.equal(groups.fleet.length, 2);
  const runtime = groups.fleet.find((item) => item.owner === 'Provider Runtime');
  assert.equal(runtime.tone, 'review');
  assert.match(runtime.detail, /retained work progress, not a broken repository/);
  assert.match(runtime.evidence, /runtime\/fix · \/work\/provider/);
  assert.equal(runtime.requestOwner, 'provider-runtime');
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
  assert.equal(recovery.owner, 'Release and Self-host');
  assert.match(recovery.detail, /single disk failure could remove/);
  assert.match(recovery.evidence, /ONE-DISK · abcdef012/);
  assert.match(groups.fleet.find((item) => item.evidence === 'TASK-BLOCKED').detail, /no image was saved/);
});

test('SCN-console-attention-empty: an unavailable signal does not manufacture owner work', () => {
  const groups = project({
    approvalRequests: { available: false, reason: 'Structured approval service unavailable.' },
    messages: { unacknowledged: 0 }, doctor: { findings: [] },
  });

  assert.deepEqual(groups, { owner: [], fleet: [], arbiter: [] });
});
