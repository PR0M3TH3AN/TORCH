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
import { observeRuntimeTurn, withRuntimeTurnGuard } from '../../src/runtime/turn-guard.mjs';
import { observeProject } from '../../src/observability/snapshot.mjs';
import { configureContinuation, observeContinuation, planContinuation, runContinuation } from '../../src/runtime/continuation.mjs';

function fixture({ recoveryWorktree = true, extraWorker = false, workerCount = 0 } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'torch-legacy-recovery-'));
  for (const args of [['init', '-b', 'main'], ['config', 'user.email', 'test@example.invalid'],
    ['config', 'user.name', 'Recovery Fixture']]) execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  writeFileSync(join(root, 'app.js'), 'export const ready = true;\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root, stdio: 'pipe' });
  const repository = inspectRepository(root);
  const proposal = proposeDomains({ repository, analysis: analyzeRepository(repository) });
  if (extraWorker) proposal.domains.push({ ...proposal.domains[0], id: 'extra-worker', title: 'Extra worker', owned_paths: ['extra/**'] });
  for (let i = 0; i < workerCount; i++) proposal.domains.push({ ...proposal.domains[0], id: `worker-${i}`, title: `Worker ${i}`, owned_paths: [`worker-${i}/**`] });
  proposal.review = { status: 'approved', reviewedAt: '2026-10-03T00:00:00Z', reviewedBy: 'owner', notes: [] };
  const env = { ...process.env, XDG_DATA_HOME: join(root, '.data') };
  installProject({ repository, proposal, env, projectId: 'recovery-fixture' });
  const actualPath = join(root, '.torch', 'install-manifest.json');
  const manifest = JSON.parse(readFileSync(actualPath, 'utf8'));
  const areaId = proposal.domains[0].id;
  if (recoveryWorktree) manifest.external.push({ type: 'worktree', area: areaId, path: join(root, 'worker') });
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
  return { root, env, control, identity, areaId, properties, issue, apply,
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

test('SCN-runtime-live-presence: live guard phases override stale idle display without changing durable reports or waits', { skip: process.platform !== 'linux' }, () => {
  const f = fixture({ recoveryWorktree: false });
  try {
    f.control.reportStatus({ areaId: f.areaId, state: 'idle', summary: 'Previous turn completed' });
    const observe = () => observeProject({ repositoryRoot: f.root, env: f.env }).agents.find(a => a.areaId === f.areaId);
    withRuntimeTurnGuard(f.control, f.areaId, phase => {
      let agent = observe();
      assert.equal(agent.state, 'starting');
      assert.equal(agent.reportedState, 'idle');
      assert.equal(agent.executor.source, 'live-process-and-turn-guard');
      phase('working');
      agent = observe();
      assert.equal(agent.state, 'working');
      assert.equal(f.control.getAgent(f.areaId).state, 'idle', 'Observation is not an identity mutation');
      f.control.reportStatus({ areaId: f.areaId, state: 'waiting', summary: 'Waiting for named approval' });
      assert.equal(observe().state, 'waiting', 'Live execution must not conceal semantic approval waits');
    });
    assert.equal(observe().executor.state, 'inactive');
    assert.equal(observe().state, 'waiting');
    f.control.reportStatus({ areaId: f.areaId, state: 'idle', summary: 'Turn completed' });
    assert.equal(observe().state, 'idle');
  } finally { f.control.close(); }
});

test('SCN-runtime-live-presence-refusal: dead, replaced, foreign-user and malformed guards never claim active execution', () => {
  const f = fixture();
  try {
    withRuntimeTurnGuard(f.control, f.areaId, () => {
      const path = join(f.control.stateRoot, 'sessions', 'turn-guards', f.areaId, 'owner.json');
      const original = JSON.parse(readFileSync(path, 'utf8'));
      writeFileSync(path, JSON.stringify({ ...original, startTicks: 'fixture-start' }));
      const read = live => observeRuntimeTurn({ stateRoot: f.control.stateRoot, repositoryRoot: f.root,
        projectId: f.control.projectId, areaId: f.areaId, uid: 1000, inspectProcess: () => live });
      const live = { uid: 1000, startTicks: 'fixture-start', state: 'S' };
      assert.equal(read(live).state, 'active');
      for (const mismatch of [{ ...live, uid: 2000 }, { ...live, startTicks: 'reused-pid' }, { ...live, state: 'Z' }]) {
        assert.equal(read(mismatch).state, 'unknown');
      }
      const absent = observeRuntimeTurn({ stateRoot: f.control.stateRoot, repositoryRoot: f.root,
        projectId: f.control.projectId, areaId: f.areaId, inspectProcess: () => { throw new Error('Process gone'); } });
      assert.equal(absent.state, 'unknown');
      writeFileSync(path, JSON.stringify({ ...original, projectId: 'foreign' }));
      assert.equal(read(live).reason, 'guard-invalid');
      writeFileSync(path, JSON.stringify(original));
    });
  } finally { f.control.close(); }
});

test('SCN-runtime-live-presence-legacy: pre-observation guards require exact TORCH identity and project cwd', () => {
  const f = fixture();
  try {
    withRuntimeTurnGuard(f.control, f.areaId, () => {
      const path = join(f.control.stateRoot, 'sessions', 'turn-guards', f.areaId, 'owner.json');
      const original = JSON.parse(readFileSync(path, 'utf8'));
      const legacy = { ...original };
      delete legacy.startTicks;
      delete legacy.phase;
      writeFileSync(path, JSON.stringify(legacy));
      const inspect = live => observeRuntimeTurn({ stateRoot: f.control.stateRoot, repositoryRoot: f.root,
        projectId: f.control.projectId, areaId: f.areaId, uid: 1000, inspectProcess: () => live });
      const live = { uid: 1000, state: 'S', cwd: f.root, argv: ['node', '/runtime/bin/torch.mjs', 'up', '--only', f.areaId] };
      assert.equal(inspect(live).phase, 'working');
      assert.equal(inspect({ ...live, cwd: '/foreign' }).state, 'unknown');
      assert.equal(inspect({ ...live, argv: ['node', 'torch.mjs', 'up', '--only', 'someone-else'] }).state, 'unknown');
      writeFileSync(path, JSON.stringify(original));
    });
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

test('SCN-runtime-continuation-day-override: owner extra allowance preserves charges and expires at UTC reset', async () => {
  const f = fixture();
  const backlog = { list: () => [] };
  const at = new Date('2026-10-03T00:00:00Z');
  try {
    f.control.reportStatus({ areaId: f.areaId, state: 'idle', summary: 'Ready' });
    configureContinuation(f.control, { actorId: 'owner', enabled: true, maxTurnsPerDay: 1 });
    f.control.sendOwnerRequest({ actorId: 'owner', recipient: f.areaId, body: 'First work' });
    const run = () => runContinuation(f.control, backlog, { actorId: 'owner', at, launch: async () => 0 });
    assert.equal((await run()).launched.length, 1);
    assert.equal(planContinuation(f.control, backlog, { at }).reason, 'daily-turn-cap');
    assert.throws(() => configureContinuation(f.control, { actorId: f.areaId, enabled: true, todayMaxTurns: 3 }), { code: 'OWNER_AUTHORITY_REQUIRED' });
    for (const todayMaxTurns of [0, 97, 1.5]) assert.throws(() => configureContinuation(f.control,
      { actorId: 'owner', enabled: true, todayMaxTurns }), { code: 'CONTINUATION_POLICY_INVALID' });
    configureContinuation(f.control, { actorId: 'owner', enabled: true, todayMaxTurns: 3 });
    assert.equal(planContinuation(f.control, backlog, { at }).attempts, 1, 'Previously charged turn is retained');
    assert.equal(planContinuation(f.control, backlog, { at }).remainingTurns, 2);
    f.control.sendOwnerRequest({ actorId: 'owner', recipient: f.areaId, body: 'Additional work' });
    assert.equal((await run()).launched.length, 1);
    configureContinuation(f.control, { actorId: 'owner', enabled: false });
    const sameDay = observeContinuation({ stateRoot: f.control.stateRoot, now: () => at });
    assert.equal(sameDay.attempts, 2);
    assert.equal(sameDay.maxTurnsPerDay, 3);
    assert.equal(sameDay.stopReason, 'paused');
    const nextDay = observeContinuation({ stateRoot: f.control.stateRoot, now: () => new Date('2026-10-04T00:00:00Z') });
    assert.equal(nextDay.maxTurnsPerDay, 1, 'Override cannot widen future daily allowances');
    assert.equal(nextDay.attempts, 0);
    assert.ok(f.control.readAudit({ limit: 100 }).some(a => a.operation === 'runtime.continuation.configure'
      && a.details?.dailyOverride?.maxTurns === 3));
  } finally { f.control.close(); }
});

test('SCN-runtime-continuation-concurrency: seven authorized starts preserve budget and obey tighter limits', async () => {
  const f = fixture({ workerCount: 5 });
  const backlog = { list: () => [] };
  const at = new Date('2026-10-03T00:00:00Z');
  try {
    for (const agent of f.control.listAgents()) {
      f.control.reportStatus({ areaId: agent.areaId, state: 'idle', summary: 'Ready' });
      f.control.sendOwnerRequest({ actorId: 'owner', recipient: agent.areaId, body: 'Review work' });
    }
    configureContinuation(f.control, { actorId: 'owner', enabled: true, maxTurnsPerDay: 48 });
    assert.equal(planContinuation(f.control, backlog, { at }).maxConcurrency, 3);
    assert.equal(planContinuation(f.control, backlog, { at, limit: 7 }).candidates.length, 3, 'Tick cannot exceed approved capacity');
    configureContinuation(f.control, { actorId: 'owner', enabled: true, maxConcurrency: 7 });
    assert.equal(observeContinuation({ stateRoot: f.control.stateRoot }).maxTurnsPerDay, 48);
    assert.equal(planContinuation(f.control, backlog, { at, limit: 2 }).candidates.length, 2);
    for (const value of [0, 8, 1.5]) assert.throws(() => configureContinuation(f.control,
      { actorId: 'owner', enabled: true, maxConcurrency: value }), { code: 'CONTINUATION_POLICY_INVALID' });
    const completions = [];
    const running = runContinuation(f.control, backlog, { actorId: 'owner', at,
      launch: () => new Promise(resolve => completions.push(resolve)) });
    assert.equal(completions.length, 7, 'All seven start before any finishes');
    assert.equal(planContinuation(f.control, backlog, { at }).attempts, 7);
    configureContinuation(f.control, { actorId: 'owner', enabled: false });
    assert.equal(observeContinuation({ stateRoot: f.control.stateRoot, now: () => at }).attempts, 7);
    assert.equal(observeContinuation({ stateRoot: f.control.stateRoot }).maxConcurrency, 7);
    completions.forEach(resolve => resolve(0));
    assert.equal((await running).launched.length, 7);
  } finally { f.control.close(); }
});

test('SCN-runtime-continuation-signals: acknowledgements do not wake; eligible turns start concurrently within the limit', async () => {
  const f = fixture();
  try {
    f.control.reportStatus({ areaId: f.areaId, state: 'idle', summary: 'Idle' });
    const messages = [];
    for (const recipient of [f.areaId, 'session-manager']) {
      messages.push(f.control.sendOwnerRequest({ actorId: 'owner', recipient, body: 'Review current work' }));
      f.control.sendOwnerRequest({ actorId: 'owner', recipient, body: 'Second handoff' });
    }
    configureContinuation(f.control, { actorId: 'owner', enabled: true, maxTurnsPerDay: 4 });
    const completions = [];
    const running = runContinuation(f.control, { list: () => [] }, { actorId: 'owner', limit: 2,
      launch: () => new Promise(resolve => completions.push(resolve)) });
    assert.equal(completions.length, 2, 'Both starts occur without waiting for the first provider to finish');
    assert.equal((await runContinuation(f.control, { list: () => [] }, { actorId: 'owner', launch: () => 0 })).reason,
      'controller-active-or-unreconciled');
    completions.forEach(resolve => resolve(0));
    assert.equal((await running).launched.length, 2);
    for (const message of messages) f.control.ackMessage({ recipient: message.recipient, messageId: message.id });
    assert.equal(planContinuation(f.control, { list: () => [] }).candidates.length, 0);
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

test('SCN-runtime-continuation-refill: a short turn frees capacity while the manager remains running', async () => {
  const f = fixture({ extraWorker: true });
  try {
    f.control.reportStatus({ areaId: f.areaId, state: 'idle', summary: 'Idle' });
    for (const recipient of ['session-manager', f.areaId, 'extra-worker']) {
      f.control.sendOwnerRequest({ actorId: 'owner', recipient, body: 'Eligible handoff' });
    }
    configureContinuation(f.control, { actorId: 'owner', enabled: true, maxTurnsPerDay: 3 });
    const starts = [];
    const finishes = new Map();
    let thirdStarted;
    const third = new Promise(resolve => { thirdStarted = resolve; });
    const run = runContinuation(f.control, { list: () => [] }, { actorId: 'owner', limit: 2,
      launch: area => { starts.push(area); if (starts.length === 3) thirdStarted();
        return new Promise(resolve => finishes.set(area, resolve)); } });
    assert.deepEqual(starts, ['session-manager', f.areaId]);
    finishes.get(f.areaId)(0);
    await third;
    assert.deepEqual(starts, ['session-manager', f.areaId, 'extra-worker']);
    assert.equal(finishes.has('session-manager'), true, 'Manager completion was not required for refill');
    finishes.get('extra-worker')(0);
    finishes.get('session-manager')(0);
    assert.equal((await run).launched.length, 3);
    assert.equal(planContinuation(f.control, { list: () => [] }).reason, 'daily-turn-cap');
  } finally { f.control.close(); }
});

test('SCN-runtime-continuation-no-progress: unfinished assignment continues once then escalates rather than busy-looping', async () => {
  const f = fixture();
  try {
    f.control.reportStatus({ areaId: f.areaId, state: 'idle', summary: 'Idle' });
    configureContinuation(f.control, { actorId: 'owner', enabled: true, maxTurnsPerDay: 8 });
    const task = { id: 'TASK-continue', owner: f.areaId, state: 'assigned', revision: 1, dependencies: [] };
    let specialistTurns = 0;
    const result = await runContinuation(f.control, { list: () => [task] }, { actorId: 'owner', limit: 1,
      launch: area => { if (area === f.areaId) specialistTurns++; return 0; } });
    assert.equal(specialistTurns, 2);
    assert.equal(result.launched.filter(t => t.areaId === f.areaId).length, 2);
    const messages = f.control.readMessages({ recipient: 'session-manager', unacknowledgedOnly: true, limit: 1000 });
    assert.equal(messages.filter(m => m.body.includes('two turns without advancing')).length, 1);
    assert.equal(planContinuation(f.control, { list: () => [task] }).candidates.some(c => c.areaId === f.areaId), false);
    task.revision++;
    assert.equal(planContinuation(f.control, { list: () => [task] }).candidates.some(c => c.areaId === f.areaId), true);
    task.dependencies = ['TASK-unfinished'];
    assert.equal(planContinuation(f.control, { list: () => [task] }).candidates.some(c => c.areaId === f.areaId), false);
  } finally { f.control.close(); }
});

test('SCN-runtime-continuation-capacity: a manually held executor counts against automatic fleet capacity', async () => {
  const f = fixture();
  try {
    f.control.reportStatus({ areaId: f.areaId, state: 'idle', summary: 'Idle' });
    f.control.sendOwnerRequest({ actorId: 'owner', recipient: f.areaId, body: 'Eligible handoff' });
    configureContinuation(f.control, { actorId: 'owner', enabled: true });
    let running;
    withRuntimeTurnGuard(f.control, 'session-manager', () => {
      running = runContinuation(f.control, { list: () => [] }, { actorId: 'owner', limit: 1,
        launch: () => { throw new Error('Capacity must not be exceeded'); } });
    });
    assert.deepEqual((await running).launched, []);
    assert.equal(planContinuation(f.control, { list: () => [] }).attempts, 0);
  } finally { f.control.close(); }
});

test('SCN-runtime-continuation-fairness: a fresh task revision does not let one specialist starve an unstarted peer', async () => {
  const f = fixture({ extraWorker: true });
  try {
    f.control.reportStatus({ areaId: f.areaId, state: 'idle', summary: 'Idle' });
    configureContinuation(f.control, { actorId: 'owner', enabled: true, maxTurnsPerDay: 3 });
    const task = { id: 'TASK-changing', owner: f.areaId, state: 'assigned', revision: 1, dependencies: [] };
    f.control.sendOwnerRequest({ actorId: 'owner', recipient: 'extra-worker', body: 'Peer work' });
    const starts = [];
    await runContinuation(f.control, { list: () => [task] }, { actorId: 'owner', limit: 1,
      launch: area => { starts.push(area); if (area === f.areaId) task.revision++; return 0; } });
    assert.deepEqual(starts.slice(0, 2), [f.areaId, 'extra-worker']);
  } finally { f.control.close(); }
});

test('SCN-runtime-continuation-health: budget stops, day reset, pause and unreadable ledgers are visible without mutation', async () => {
  const f = fixture({ recoveryWorktree: false });
  const at = new Date('2026-10-03T00:00:00Z');
  try {
    f.control.reportStatus({ areaId: f.areaId, state: 'idle', summary: 'Idle' });
    f.control.sendOwnerRequest({ actorId: 'owner', recipient: f.areaId, body: 'Work' });
    configureContinuation(f.control, { actorId: 'owner', enabled: true, maxTurnsPerDay: 1 });
    await runContinuation(f.control, { list: () => [] }, { actorId: 'owner', at, launch: () => 0 });
    const path = join(f.control.stateRoot, 'continuation.json');
    const before = readFileSync(path, 'utf8');
    const health = observeContinuation({ stateRoot: f.control.stateRoot, now: () => at });
    assert.equal(health.stopReason, 'daily-turn-cap');
    assert.equal(health.remainingTurns, 0);
    assert.equal(health.manualTurnsIncluded, false);
    assert.equal(health.timerInstallationVerified, false);
    const snapshot = observeProject({ repositoryRoot: f.root, env: f.env, now: () => at });
    assert.equal(snapshot.continuation.stopReason, 'daily-turn-cap');
    assert.equal(readFileSync(path, 'utf8'), before);
    assert.equal(observeContinuation({ stateRoot: f.control.stateRoot, now: () => new Date('2026-10-04T00:00:00Z') }).remainingTurns, 1);
    configureContinuation(f.control, { actorId: 'owner', enabled: false, maxTurnsPerDay: 1 });
    assert.equal(observeContinuation({ stateRoot: f.control.stateRoot, now: () => at }).stopReason, 'paused');
    writeFileSync(path, 'not-json');
    assert.equal(observeContinuation({ stateRoot: f.control.stateRoot, now: () => at }).stopReason, 'policy-or-ledger-unreadable');
    assert.equal(readFileSync(path, 'utf8'), 'not-json', 'Observation must not repair or reset the attempt ledger');
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
