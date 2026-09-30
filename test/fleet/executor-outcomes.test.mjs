import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createCodexAdapter } from '../../src/adapters/codex.mjs';
import { openControlPlane } from '../../src/control-plane/service.mjs';
import { analyzeRepository } from '../../src/kernel/analyze.mjs';
import { proposeDomains } from '../../src/kernel/domains.mjs';
import { inspectRepository } from '../../src/kernel/git.mjs';
import { installProject } from '../../src/kernel/install.mjs';
import { startFleet } from '../../src/runtime/lifecycle.mjs';
import { ScheduleService } from '../../src/schedules/service.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'torch-executor-outcomes-'));
  const git = (args) => execFileSync('git', ['-C', root, ...args]);
  execFileSync('git', ['init', '-b', 'main', root]);
  git(['config', 'user.email', 'torch-test@example.invalid']);
  git(['config', 'user.name', 'TORCH Test']);
  writeFileSync(join(root, 'app.js'), 'export const app = true;\n');
  git(['add', '.']);
  git(['commit', '-m', 'fixture']);
  const repository = inspectRepository(root);
  const proposal = proposeDomains({ repository, analysis: analyzeRepository(repository) });
  const worker = proposal.domains[0].id;
  proposal.schedules = [{
    id: 'domain-audit', title: 'Domain audit', owner: worker, lifetime: 'session',
    trigger: { type: 'manual' }, behavior: 'read-only',
    action: { type: 'command', command: process.execPath, args: ['-e', 'process.exit(0)'] },
    required_authority: [worker], retry: { max_attempts: 1 },
    failure_recipient: 'session-manager', source_of_truth: 'test fixture',
  }];
  proposal.review = { status: 'approved', reviewedAt: '2026-09-30T00:00:00Z', reviewedBy: 'fixture-owner', notes: [] };
  const env = { ...process.env, XDG_DATA_HOME: mkdtempSync(join(tmpdir(), 'torch-executor-outcomes-state-')) };
  installProject({ repository, proposal, env, projectId: 'executor-outcomes-fixture' });
  return { root, env, worker };
}

function planFor(context, runtimeSessionId = 'captured-native-session') {
  return {
    canProceed: true,
    projectId: 'executor-outcomes-fixture',
    actions: [{
      areaId: context.worker, runtime: 'codex', runtimeSessionId,
      requiresRuntimeIdCapture: false, completionState: 'idle', mode: 'resume',
      promptFile: join(context.root, 'runtime-prompt.md'), instructionText: 'test prompt',
      launch: { command: 'codex', args: [], cwd: context.root },
    }],
  };
}

function expectInterruptedStart({ context, result, expectedReason }) {
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  try {
    let failure;
    assert.throws(() => startFleet({
      plan: planFor(context), controlPlane: control,
      adapters: new Map([['codex', createCodexAdapter()]]), executor: () => result,
    }), (error) => {
      failure = error;
      return error.code === 'FLEET_START_FAILED';
    });
    assert.equal(failure.details.executorOutcome.reason, expectedReason);
    assert.equal(control.identity(context.worker).state, 'working');
    assert.equal(control.identity(context.worker).runtimeSessionId, 'captured-native-session');
    return failure;
  } finally { control.close(); }
}

test('SCN-executor-interrupted-outcomes: a graceful timeout, signal, or ENOBUFS cannot create an idle turn or disclose output', () => {
  const timeout = spawnSync(process.execPath, [
    '-e', 'process.on("SIGTERM", () => process.exit(0)); setInterval(() => {}, 1000);',
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 100, killSignal: 'SIGTERM' });
  assert.equal(timeout.status, 0);
  assert.equal(timeout.error?.code, 'ETIMEDOUT');
  expectInterruptedStart({ context: fixture(), result: timeout, expectedReason: 'executor-error-ETIMEDOUT' });

  expectInterruptedStart({
    context: fixture(), result: { status: null, signal: 'SIGTERM' }, expectedReason: 'executor-signal',
  });

  const screenshotPayload = 'image-data-'.repeat(200_000);
  const overflow = expectInterruptedStart({
    context: fixture(),
    result: {
      status: 0, error: Object.assign(new Error('private reasoning should not be reported'), { code: 'ENOBUFS' }),
      stdout: screenshotPayload,
      stderr: 'token=fixture-token password=fixture-password prompt=private-prompt',
    },
    expectedReason: 'executor-error-ENOBUFS',
  });
  assert.doesNotMatch(JSON.stringify(overflow.details), /image-data|fixture-token|fixture-password|private-prompt/);
});

test('SCN-scheduled-executor-failure: a zero-status executor error records failure and keeps output bounded and redacted', () => {
  const context = fixture();
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  try {
    control.reportStatus({ areaId: 'session-manager', state: 'idle', summary: 'Fixture session is available.' });
    const service = new ScheduleService({
      repositoryRoot: context.root, controlPlane: control,
      executor: () => ({
        status: 0,
        error: Object.assign(new Error('private reasoning=fixture-analysis'), { code: 'ENOBUFS' }),
        stdout: 'screenshot-data-'.repeat(200_000),
        stderr: 'token=fixture-token password=fixture-password',
      }),
    });
    const run = service.run({ scheduleId: 'domain-audit', actorId: context.worker });
    assert.equal(run.result, 'failed');
    assert.equal(run.exitStatus, 0);
    assert.match(run.stdout, /\[truncated\]/);
    assert.doesNotMatch(`${run.stdout}\n${run.stderr}`, /fixture-token|fixture-password|fixture-analysis/);
  } finally { control.close(); }
});
