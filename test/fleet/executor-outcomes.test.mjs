import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createCodexAdapter } from '../../src/adapters/codex.mjs';
import { executeRuntimeLaunch, runCli } from '../../src/cli.mjs';
import { openControlPlane } from '../../src/control-plane/service.mjs';
import { analyzeRepository } from '../../src/kernel/analyze.mjs';
import { proposeDomains } from '../../src/kernel/domains.mjs';
import { inspectRepository } from '../../src/kernel/git.mjs';
import { installProject } from '../../src/kernel/install.mjs';
import { startFleet } from '../../src/runtime/lifecycle.mjs';
import { ScheduleService } from '../../src/schedules/service.mjs';

const CODEX_PROTOCOL_REDUCER = new URL('../../src/runtime/codex-protocol-reducer.mjs', import.meta.url).pathname;

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
  installProject({
    repository, proposal, env, projectId: 'executor-outcomes-fixture', runtimes: ['codex'], defaultRuntime: 'codex',
  });
  return { root, env, worker };
}

function planFor(context, {
  runtimeSessionId = 'captured-native-session', requiresRuntimeIdCapture = false,
} = {}) {
  return {
    canProceed: true,
    projectId: 'executor-outcomes-fixture',
    actions: [{
      areaId: context.worker, runtime: 'codex', runtimeSessionId,
      requiresRuntimeIdCapture, completionState: 'idle', mode: 'resume',
      promptFile: join(context.root, 'runtime-prompt.md'), instructionText: 'test prompt',
      launch: { command: 'codex', args: [], cwd: context.root },
    }],
  };
}

function expectInterruptedStart({ context, result, expectedReason, plan = planFor(context), expectedRuntimeSessionId }) {
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  try {
    let failure;
    assert.throws(() => startFleet({
      plan, controlPlane: control,
      adapters: new Map([['codex', createCodexAdapter()]]), executor: () => result,
    }), (error) => {
      failure = error;
      return error.code === 'FLEET_START_FAILED';
    });
    assert.equal(failure.details.executorOutcome.reason, expectedReason);
    assert.equal(control.identity(context.worker).state, 'working');
    assert.equal(control.identity(context.worker).runtimeSessionId,
      expectedRuntimeSessionId ?? plan.actions[0].runtimeSessionId ?? 'overflow-thread');
    return failure;
  } finally { control.close(); }
}

function interruptReducerAfterIdentity() {
  const expectedIdentity = '{"type":"thread.started","thread_id":"interrupted-thread"}\n';
  const childProgram = [
    'process.stdout.write(JSON.stringify({type:"thread.started",thread_id:"interrupted-thread"}) + "\\n");',
    'process.on("SIGTERM", () => process.exit(0));',
    'setInterval(() => {}, 1_000);',
  ].join('');
  const helper = spawn(process.execPath, [CODEX_PROTOCOL_REDUCER, process.execPath, '-e', childProgram], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  helper.stdout.setEncoding('utf8');
  helper.stderr.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let interrupted = false;
    let failure = null;
    const terminate = () => {
      if (helper.exitCode === null && helper.signalCode === null) helper.kill('SIGTERM');
    };
    const watchdog = setTimeout(() => {
      failure ??= new Error('helper did not emit its bounded identity; terminating owned fixture process');
      terminate();
    }, 1_000);
    helper.stdout.on('data', (chunk) => {
      stdout += chunk;
      try {
        if (!interrupted && stdout === expectedIdentity) {
          interrupted = true;
          assert.equal(helper.exitCode, null, 'helper must still be live when the reduced identity arrives');
          assert.equal(helper.signalCode, null, 'identity must not depend on a close event');
          assert.equal(helper.kill('SIGTERM'), true, 'parent must forward interruption through the real helper process');
        } else if (!expectedIdentity.startsWith(stdout)) {
          failure ??= new Error(`helper emitted unexpected reduced protocol bytes: ${JSON.stringify(stdout)}`);
          terminate();
        }
      } catch (error) {
        failure ??= error;
        terminate();
      }
    });
    helper.stderr.on('data', (chunk) => { stderr += chunk; });
    helper.once('error', (error) => {
      failure ??= error;
      terminate();
    });
    helper.once('close', (status, signal) => {
      clearTimeout(watchdog);
      try {
        assert.throws(() => process.kill(helper.pid, 0), { code: 'ESRCH' }, 'owned helper must be absent after close');
        if (failure) reject(failure);
        else resolve({ status, signal, stdout, stderr, interrupted });
      } catch (error) { reject(error); }
    });
  });
}

async function captureStdout(action) {
  const originalWrite = process.stdout.write;
  let output = '';
  process.stdout.write = function capture(chunk, ...args) {
    output += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    return originalWrite.call(this, '', ...args);
  };
  try {
    return { status: await action(), output };
  } finally {
    process.stdout.write = originalWrite;
  }
}

function nativeSpawnGuard({ expectedEnv, expectedMarker, delegate } = {}) {
  const calls = [];
  const guard = (command, args, options) => {
    calls.push({ command, args, options });
    assert.equal(command, process.execPath, 'Codex must launch through the real protocol reducer process');
    assert.equal(args[0], CODEX_PROTOCOL_REDUCER);
    assert.equal(args[1], 'codex');
    assert.equal(options.env, expectedEnv, 'runCli must forward the exact injected environment');
    assert.equal(options.env.PATH, expectedEnv.PATH);
    assert.equal(options.env.TORCH_FAKE_CODEX_INVOCATION_MARKER, expectedMarker);
    if (!expectedMarker) throw new Error('fixture guard rejected missing Codex invocation marker before spawn');
    return delegate(command, args, options);
  };
  guard.torchNativeSpawnGuard = true;
  return { guard, calls };
}

test('SCN-executor-interrupted-outcomes: a graceful ready timeout, signal, or ENOBUFS cannot create an idle turn or disclose output', () => {
  const readyDirectory = mkdtempSync(join(tmpdir(), 'torch-executor-ready-'));
  const readyPath = join(readyDirectory, 'ready');
  const timeout = spawnSync(process.execPath, [
    '-e', 'const fs = require("node:fs"); fs.writeFileSync(process.env.TORCH_READY_PATH, "ready"); process.on("SIGTERM", () => process.exit(0)); setInterval(() => {}, 1000);',
  ], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 1_000, killSignal: 'SIGTERM',
    env: { ...process.env, TORCH_READY_PATH: readyPath },
  });
  assert.equal(existsSync(readyPath), true, 'child reached its readiness boundary before timeout delivery');
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

  const overflowContext = fixture();
  expectInterruptedStart({
    context: overflowContext,
    plan: planFor(overflowContext, { runtimeSessionId: null, requiresRuntimeIdCapture: true }),
    result: {
      status: 0, error: Object.assign(new Error('overflow'), { code: 'ENOBUFS' }),
      stdout: `{"type":"thread.started","thread_id":"overflow-thread"}\n${screenshotPayload}`,
    },
    expectedReason: 'executor-error-ENOBUFS',
  });
});

test('SCN-codex-streaming-protocol-reduction: screenshot-heavy successful turns retain only bounded lifecycle facts', () => {
  const childProgram = [
    'const records = [JSON.stringify({type:"thread.started",thread_id:"streamed-thread"}), JSON.stringify({type:"item.completed",image_url:"data:image/png;base64," + "x".repeat(40000)}), JSON.stringify({type:"turn.completed"})].join("\\n") + "\\n";',
    'process.stdout.write(records);',
    'process.stderr.write("private reasoning=fixture-analysis token=fixture-token\\n");',
  ].join('');
  const result = spawnSync(process.execPath, [CODEX_PROTOCOL_REDUCER, process.execPath, '-e', childProgram], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '{"type":"thread.started","thread_id":"streamed-thread"}\n{"type":"turn.completed"}\n');
  assert.ok(Buffer.byteLength(result.stdout) < 256);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /image\/png|fixture-analysis|fixture-token|x{512}/);
  const context = fixture();
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  try {
    startFleet({
      plan: planFor(context, { runtimeSessionId: null, requiresRuntimeIdCapture: true }), controlPlane: control,
      adapters: new Map([['codex', createCodexAdapter()]]), executor: () => result,
    });
    assert.equal(control.identity(context.worker).state, 'idle');
    assert.equal(control.identity(context.worker).runtimeSessionId, 'streamed-thread');
  } finally { control.close(); }
});

test('SCN-codex-final-terminal-state: a later failed terminal overrides an earlier completion and child signals/errors remain explicit', () => {
  const failedTerminal = spawnSync(process.execPath, [CODEX_PROTOCOL_REDUCER, process.execPath, '-e', [
    'process.stdout.write([JSON.stringify({type:"thread.started",thread_id:"terminal-thread"}), JSON.stringify({type:"turn.completed"}), JSON.stringify({type:"turn.failed",code:"MODEL_NOT_SUPPORTED",message:"private reasoning=hidden"})].join("\\n") + "\\n");',
  ].join('')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(failedTerminal.status, 0, failedTerminal.stderr);
  assert.equal(failedTerminal.stdout, '{"type":"thread.started","thread_id":"terminal-thread"}\n{"type":"turn.failed","code":"MODEL_NOT_SUPPORTED"}\n');
  const context = fixture();
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  try {
    assert.throws(() => startFleet({
      plan: planFor(context, { runtimeSessionId: null, requiresRuntimeIdCapture: true }), controlPlane: control,
      adapters: new Map([['codex', createCodexAdapter()]]), executor: () => failedTerminal,
    }), (error) => error.code === 'FLEET_START_FAILED'
      && error.details.executorOutcome.reason === 'codex-terminal-event-missing'
      && error.details.diagnostic.code === 'MODEL_NOT_SUPPORTED');
    assert.equal(control.identity(context.worker).runtimeSessionId, 'terminal-thread');
    assert.equal(control.identity(context.worker).state, 'working');
  } finally { control.close(); }

  const signalled = spawnSync(process.execPath, [CODEX_PROTOCOL_REDUCER, process.execPath,
    '-e', 'process.kill(process.pid, "SIGTERM")'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(signalled.signal, 'SIGTERM');
  expectInterruptedStart({ context: fixture(), result: signalled, expectedReason: 'executor-signal' });

  const unavailable = spawnSync(process.execPath, [CODEX_PROTOCOL_REDUCER, '/definitely/missing-torch-runtime'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(unavailable.status, 1);
  assert.equal(unavailable.stdout, '{"type":"error","code":"ENOENT"}\n');
});

test('SCN-codex-interrupted-identity: a real helper emits a bounded identity before deterministic parent interruption and remains uncertain', async () => {
  const result = await interruptReducerAfterIdentity();
  assert.equal(result.interrupted, true);
  assert.equal(result.status, null);
  assert.equal(result.signal, 'SIGTERM');
  assert.equal(result.stdout, '{"type":"thread.started","thread_id":"interrupted-thread"}\n');
  assert.equal(result.stderr, '');
  const context = fixture();
  expectInterruptedStart({
    context,
    plan: planFor(context, { runtimeSessionId: null, requiresRuntimeIdCapture: true }),
    result,
    expectedReason: 'executor-signal',
    expectedRuntimeSessionId: 'interrupted-thread',
  });
});

test('SCN-codex-code-less-diagnostics: no-code model, authentication, and quota errors retain only safe categories', () => {
  const cases = [
    ['The requested model is not supported; prompt=private-prompt', 'model-rejection'],
    ['Authentication rejected this credential; private reasoning=secret-analysis', 'authentication'],
    ['Quota exceeded for this account; image=data:image/png;base64,fixture-image', 'quota'],
  ];
  for (const [message, category] of cases) {
    const childProgram = `process.stdout.write(${JSON.stringify(`${JSON.stringify({ type: 'error', message, prompt: 'private-prompt', reasoning: 'secret-analysis', image_url: 'data:image/png;base64,fixture-image' })}\n`)});`;
    const result = spawnSync(process.execPath, [CODEX_PROTOCOL_REDUCER, process.execPath, '-e', childProgram], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `{"type":"turn.failed","category":"${category}"}\n`);
    const diagnostic = createCodexAdapter().diagnoseStartupFailure(result);
    assert.deepEqual(diagnostic, {
      schema: 'torch.dev/runtime-startup-diagnostic/v1alpha1', outcome: 'known', category, stderr: null,
    });
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}\n${JSON.stringify(diagnostic)}`,
      /private-prompt|secret-analysis|fixture-image|image\/png/);
  }
});

test('SCN-cli-codex-protocol-routing: the CLI routes Codex launch output through the bounded protocol reducer', () => {
  const result = executeRuntimeLaunch(spawnSync, {
    runtime: 'codex', command: process.execPath,
    args: ['-e', 'process.stdout.write("{\\"type\\":\\"thread.started\\",\\"thread_id\\":\\"cli-thread\\"}\\n{\\"type\\":\\"turn.completed\\"}\\n")'],
  }, { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1024 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '{"type":"thread.started","thread_id":"cli-thread"}\n{"type":"turn.completed"}\n');
});

test('SCN-cli-codex-real-executable: an actual runCli invocation reaches the isolated Codex executable through the reducer', async () => {
  const context = fixture();
  const bin = mkdtempSync(join(tmpdir(), 'torch-codex-bin-'));
  const executable = join(bin, 'codex');
  const marker = join(bin, 'invocation.json');
  const markerEnv = 'TORCH_FAKE_CODEX_INVOCATION_MARKER';
  const inheritedMarker = process.env[markerEnv];
  writeFileSync(executable, [
    '#!/usr/bin/env node',
    'const fs = require("node:fs");',
    `const marker = process.env.${markerEnv};`,
    'if (!marker) { process.stderr.write("missing isolated invocation marker\\n"); process.exit(86); }',
    'fs.writeFileSync(marker, JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }));',
    'process.stdout.write(JSON.stringify({type:"thread.started",thread_id:"cli-boundary-thread"}) + "\\n");',
    'process.stdout.write(JSON.stringify({type:"turn.completed"}) + "\\n");',
  ].join('\n'));
  chmodSync(executable, 0o755);
  const cliOptions = {
    cwd: context.root,
    env: { ...context.env, PATH: `${bin}:${process.env.PATH}`, [markerEnv]: marker },
  };
  const worktreeParent = mkdtempSync(join(tmpdir(), 'torch-cli-worktrees-'));
  execFileSync('git', ['-C', context.root, 'add', '.torch']);
  execFileSync('git', ['-C', context.root, 'commit', '-m', 'commit fixture installation state']);
  const worktrees = await captureStdout(() => runCli([
    'worktrees', '--parent', worktreeParent, '--yes', '--json',
  ], cliOptions));
  assert.equal(worktrees.status, 0, worktrees.output);
  const missingEnv = { ...context.env, PATH: `${bin}:${process.env.PATH}` };
  const missingMarkerGuard = nativeSpawnGuard({
    expectedEnv: missingEnv, expectedMarker: undefined, delegate: spawnSync,
  });
  const missingMarker = await captureStdout(() => runCli([
    'up', '--fresh', '--only', context.worker, '--yes', '--json',
  ], {
    cwd: context.root,
    env: missingEnv,
    spawn: missingMarkerGuard.guard,
  }));
  assert.equal(missingMarker.status, 1, missingMarker.output);
  assert.equal(JSON.parse(missingMarker.output).error, 'UNEXPECTED_ERROR');
  assert.equal(missingMarkerGuard.calls.length, 1, 'guard must reject before any native child starts');
  assert.equal(existsSync(marker), false, 'fake executable must fail before it can claim invocation without its marker');
  assert.ok(Buffer.byteLength(missingMarker.output) < 4 * 1024, 'failed CLI response must remain bounded');
  const validGuard = nativeSpawnGuard({
    expectedEnv: cliOptions.env, expectedMarker: marker, delegate: spawnSync,
  });
  const captured = await captureStdout(() => runCli([
    'up', '--fresh', '--only', context.worker, '--yes', '--json',
  ], { ...cliOptions, spawn: validGuard.guard }));
  assert.equal(captured.status, 0, captured.output);
  assert.equal(validGuard.calls.length, 1, 'valid guard must delegate exactly one native reducer launch');
  assert.equal(process.env[markerEnv], inheritedMarker, 'runCli must not mutate the process environment');
  const invocation = JSON.parse(readFileSync(marker, 'utf8'));
  assert.equal(invocation.args.includes('exec'), true, 'the isolated executable must receive the Codex exec invocation');
  assert.equal(invocation.args.includes('--json'), true);
  assert.match(invocation.cwd, /\/core$/);
  assert.ok(Buffer.byteLength(captured.output) < 4 * 1024, 'CLI response must remain bounded');
  const response = JSON.parse(captured.output);
  assert.deepEqual(response.started, [{
    areaId: context.worker, runtimeSessionId: 'cli-boundary-thread', mode: 'create',
  }]);
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  try {
    assert.equal(control.identity(context.worker).state, 'idle');
    assert.equal(control.identity(context.worker).runtimeSessionId, 'cli-boundary-thread');
  } finally { control.close(); }
});

test('SCN-scheduled-manager-wake-terminal-failure: the real manager-check-in boundary fails rather than invoking a successful wake receipt', () => {
  const context = fixture();
  const configPath = join(context.root, '.torch', 'torch.yaml');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.runtime_wake_budget = { max_invocations_per_day: 1 };
  config.schedules.push({
    id: 'manager-check-in', title: 'Manager check-in', owner: 'session-manager', lifetime: 'system',
    trigger: { type: 'manual' }, behavior: 'coordination', required_authority: ['owner'],
    action: { type: 'manager-check-in', manager_id: 'session-manager', wake: { enabled: true, budget_mode: 'invocation-count' } },
    retry: { max_attempts: 1 }, failure_recipient: 'owner', source_of_truth: 'test fixture',
  });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  try {
    const service = new ScheduleService({
      repositoryRoot: context.root, controlPlane: control,
      wakeManager: {
        plan: ({ managerId }) => ({ plan: {
          canProceed: true, actions: [{ areaId: managerId, runtime: 'codex' }],
        }, adapters: new Map([['codex', createCodexAdapter()]]) }),
        invoke: ({ managerId, prepared }) => startFleet({
          plan: {
            canProceed: true, projectId: 'executor-outcomes-fixture', actions: [{
              areaId: managerId, runtime: 'codex', runtimeSessionId: null, requiresRuntimeIdCapture: true,
              completionState: 'idle', mode: 'create', promptFile: join(context.root, 'manager-prompt.md'),
              instructionText: 'manager wake', launch: { command: 'codex', args: [], cwd: context.root },
            }],
          }, controlPlane: control, adapters: prepared.adapters,
          executor: () => ({ status: 0, stdout: '{"type":"thread.started","thread_id":"manager-interrupted"}\n' }),
        }),
      },
    });
    const run = service.run({ scheduleId: 'manager-check-in', actorId: 'owner', approved: true });
    assert.equal(run.result, 'failed');
    assert.equal(control.identity('session-manager').state, 'working');
    assert.equal(control.identity('session-manager').runtimeSessionId, 'manager-interrupted');
    assert.equal(service.wakeReservations({ managerId: 'session-manager' })[0].outcome, 'failed');
  } finally { control.close(); }
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
