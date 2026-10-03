import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { analyzeRepository } from '../../src/kernel/analyze.mjs';
import { inspectRepository } from '../../src/kernel/git.mjs';
import { proposeDomains } from '../../src/kernel/domains.mjs';
import { installProject } from '../../src/kernel/install.mjs';
import { openControlPlane } from '../../src/control-plane/service.mjs';
import { issueStoppedExecutorEvidence } from '../../src/runtime/stopped-executor-evidence.mjs';
import { withRuntimeTurnGuard } from '../../src/runtime/turn-guard.mjs';
import { configureContinuation, planContinuation, runContinuation } from '../../src/runtime/continuation.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'torch-legacy-recovery-'));
  for (const args of [['init', '-b', 'main'], ['config', 'user.email', 'test@example.invalid'],
    ['config', 'user.name', 'Recovery Fixture']]) execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  writeFileSync(join(root, 'app.js'), 'export const ready = true;\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root, stdio: 'pipe' });
  const repository = inspectRepository(root);
  const proposal = proposeDomains({ repository, analysis: analyzeRepository(repository) });
  proposal.review = { status: 'approved', reviewedAt: '2026-10-03T00:00:00Z', reviewedBy: 'owner', notes: [] };
  const env = { ...process.env, XDG_DATA_HOME: join(root, '.data') };
  installProject({ repository, proposal, env, projectId: 'recovery-fixture' });
  const actualPath = join(root, '.torch', 'install-manifest.json');
  const manifest = JSON.parse(readFileSync(actualPath, 'utf8'));
  const areaId = proposal.domains[0].id;
  manifest.external.push({ type: 'worktree', area: areaId, path: join(root, 'worker') });
  writeFileSync(actualPath, JSON.stringify(manifest));
  let time = Date.parse('2026-10-03T00:00:00Z');
  const control = openControlPlane({ repositoryRoot: root, env, clock: () => new Date(time) });
  control.reportStatus({ areaId, state: 'working', runtime: 'codex', runtimeSessionId: 'fixture-session',
    task: 'TASK-preserved', summary: 'Runtime executor completion is unknown; duplicate launch is blocked pending reconciliation.' });
  const identity = control.getAgent(areaId);
  const unit = `torch-${control.projectId}-worker.service`;
  const properties = { Id: unit, ActiveState: 'failed', SubState: 'failed', MainPID: '0', ControlPID: '0',
    ControlGroup: '', InvocationID: 'a'.repeat(32), ExecStart: `node /tmp/probe.mjs ${areaId} ;`,
    WorkingDirectory: root, ExecMainExitTimestamp: identity.updatedAt };
  let processes = [];
  const issue = () => issueStoppedExecutorEvidence({ controlPlane: control, actorId: 'owner', areaId, unit,
    invocationId: 'a'.repeat(32), readUnit: () => ({ ...properties }), readProcesses: () => processes, now: () => time });
  const apply = issued => control.recoverOwnerStoppedUnknownIdentity({ actorId: 'owner', areaId,
    expectedIdentity: issued.plan.expectedIdentity, evidence: issued.evidence });
  return { control, identity, areaId, properties, issue, apply,
    advance: ms => { time += ms; }, processes: value => { processes = value; } };
}

test('SCN-legacy-runtime-recovery: owner recovery preserves task/session/unknown and records exactly one owner audit', () => {
  const f = fixture();
  try {
    const issued = f.issue();
    assert.equal(f.control.getAgent(f.areaId).state, 'working');
    const result = f.apply(issued);
    assert.equal(result.identity.state, 'offline');
    assert.equal(result.identity.currentTask, 'TASK-preserved');
    assert.equal(result.identity.runtimeSessionId, 'fixture-session');
    assert.equal(result.priorOutcome, 'unknown');
    assert.equal(result.sessionsStarted, false);
    const audits = f.control.readAudit({ limit: 100 }).filter(x => x.operation === 'runtime.legacy-unknown.recover-stopped');
    assert.equal(audits.length, 1);
    assert.equal(audits[0].actorId, 'owner');
    assert.equal(audits[0].details.outcome, 'unknown');
    assert.throws(() => f.apply(issued), { code: 'RUNTIME_RECOVERY_SNAPSHOT_CONFLICT' });
  } finally { f.control.close(); }
});

test('SCN-legacy-runtime-recovery-refusal: live, foreign invocation, area, time and process mismatches cannot issue proof', () => {
  for (const patch of [{ MainPID: '99' }, { ControlPID: '99' }, { ActiveState: 'active' },
    { InvocationID: 'b'.repeat(32) }, { ExecStart: 'node other-area' },
    { ExecMainExitTimestamp: '2026-10-02T00:00:00Z' }, { ControlGroup: '/live' }]) {
    const f = fixture();
    try { Object.assign(f.properties, patch); assert.throws(f.issue, { code: 'RUNTIME_RECOVERY_UNVERIFIED' });
      assert.equal(f.control.getAgent(f.areaId).state, 'working'); } finally { f.control.close(); }
  }
  const f = fixture();
  try { f.processes([{ pid: 999, argv: ['codex', 'resume', 'fixture-session'], cwd: '/tmp' }]);
    assert.throws(f.issue, { code: 'RUNTIME_RECOVERY_UNVERIFIED' }); } finally { f.control.close(); }
});

test('SCN-legacy-runtime-recovery-cas: changed snapshot, live recheck, expiry and caller-forged proof refuse without mutation', () => {
  for (const scenario of ['changed', 'live', 'expired', 'forged']) {
    const f = fixture();
    try {
      const issued = f.issue();
      if (scenario === 'changed') { f.advance(1); f.control.reportStatus({ areaId: f.areaId, state: 'working', runtimeSessionId: 'different', summary: 'Runtime executor completion is unknown' }); }
      if (scenario === 'live') f.properties.MainPID = '99';
      if (scenario === 'expired') f.advance(60_001);
      if (scenario === 'forged') issued.evidence = { stopped: true };
      assert.throws(() => f.apply(issued));
      assert.equal(f.control.getAgent(f.areaId).state, 'working');
      assert.equal(f.control.readAudit({ limit: 100 }).filter(x => x.operation === 'runtime.legacy-unknown.recover-stopped').length, 0);
    } finally { f.control.close(); }
  }
});

test('SCN-legacy-runtime-recovery-authority: specialist and incomplete snapshot cannot use owner recovery', () => {
  const f = fixture();
  try {
    const issued = f.issue();
    assert.throws(() => f.control.recoverOwnerStoppedUnknownIdentity({ actorId: f.areaId, areaId: f.areaId,
      expectedIdentity: issued.plan.expectedIdentity, evidence: issued.evidence }), { code: 'OWNER_AUTHORITY_REQUIRED' });
    assert.throws(() => f.control.recoverOwnerStoppedUnknownIdentity({ actorId: 'owner', areaId: f.areaId,
      expectedIdentity: {}, evidence: issued.evidence }), { code: 'RUNTIME_RECOVERY_SNAPSHOT_REQUIRED' });
    assert.equal(f.control.getAgent(f.areaId).state, 'working');
  } finally { f.control.close(); }
});

test('SCN-runtime-turn-guard: overlapping executors refuse even if an agent reports idle; terminal turns release their own guard', () => {
  const f = fixture();
  try {
    let launches = 0;
    withRuntimeTurnGuard(f.control, f.areaId, () => {
      launches++;
      f.control.reportStatus({ areaId: f.areaId, state: 'idle', summary: 'Agent reported idle before physical exit' });
      assert.throws(() => withRuntimeTurnGuard(f.control, f.areaId, () => { launches++; }), { code: 'RUNTIME_TURN_ACTIVE' });
    });
    withRuntimeTurnGuard(f.control, f.areaId, () => { launches++; });
    assert.equal(launches, 2);
  } finally { f.control.close(); }
});

test('SCN-runtime-continuation: explicit enable, event deduplication, daily cap and pause govern authorized turns', async () => {
  const f = fixture();
  const backlog = { list: () => [] };
  const at = new Date('2026-10-03T00:00:00Z');
  try {
    f.control.reportStatus({ areaId: f.areaId, state: 'idle', summary: 'Physical turn completed' });
    f.control.sendOwnerRequest({ actorId: 'owner', recipient: f.areaId, body: 'Continue assigned work' });
    assert.equal(planContinuation(f.control, backlog, { at }).reason, 'paused');
    assert.throws(() => configureContinuation(f.control, { actorId: f.areaId, enabled: true }), { code: 'OWNER_AUTHORITY_REQUIRED' });
    configureContinuation(f.control, { actorId: 'owner', enabled: true, maxTurnsPerDay: 1 });
    assert.equal(planContinuation(f.control, backlog, { at }).candidates.length, 1);
    let calls = 0;
    const run = () => runContinuation(f.control, backlog, { actorId: 'owner', at, launch: async area => { assert.equal(area, f.areaId); calls++; return 0; } });
    assert.equal((await run()).launched.length, 1);
    assert.equal((await run()).launched.length, 0);
    f.control.sendOwnerRequest({ actorId: 'owner', recipient: f.areaId, body: 'New work' });
    assert.equal(planContinuation(f.control, backlog, { at }).reason, 'daily-turn-cap');
    configureContinuation(f.control, { actorId: 'owner', enabled: true, maxTurnsPerDay: 2 });
    assert.equal(planContinuation(f.control, backlog, { at }).candidates.length, 1);
    configureContinuation(f.control, { actorId: 'owner', enabled: false, maxTurnsPerDay: 2 });
    assert.equal((await run()).launched.length, 0);
    assert.equal(calls, 1);
  } finally { f.control.close(); }
});

test('SCN-runtime-continuation-pause: a pause during one turn prevents another queued turn', async () => {
  const f = fixture();
  try {
    f.control.reportStatus({ areaId: f.areaId, state: 'idle', summary: 'Idle' });
    for (const recipient of [f.areaId, 'session-manager']) f.control.sendOwnerRequest({ actorId: 'owner', recipient, body: 'Review current work' });
    configureContinuation(f.control, { actorId: 'owner', enabled: true, maxTurnsPerDay: 3 });
    const result = await runContinuation(f.control, { list: () => [] }, { actorId: 'owner',
      launch: async () => { configureContinuation(f.control, { actorId: 'owner', enabled: false, maxTurnsPerDay: 3 }); return 0; } });
    assert.equal(result.launched.length, 1);
    assert.equal(planContinuation(f.control, { list: () => [] }).reason, 'paused');
  } finally { f.control.close(); }
});

test('SCN-legacy-runtime-recovery-project: evidence cannot be applied to a different checkout with cloned project/session fields', () => {
  const first = fixture();
  const second = fixture();
  try {
    assert.throws(() => second.control.recoverOwnerStoppedUnknownIdentity({ actorId: 'owner', areaId: second.areaId,
      expectedIdentity: second.identity, evidence: first.issue().evidence }), { code: 'RUNTIME_RECOVERY_UNVERIFIED' });
    assert.equal(second.control.getAgent(second.areaId).state, 'working');
  } finally { first.control.close(); second.control.close(); }
});
