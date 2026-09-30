import assert from 'node:assert/strict';
import { execFileSync, fork, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import { CheckService } from '../../src/checks/service.mjs';
import { openControlPlane } from '../../src/control-plane/service.mjs';
import { analyzeRepository } from '../../src/kernel/analyze.mjs';
import { proposeDomains } from '../../src/kernel/domains.mjs';
import { inspectRepository } from '../../src/kernel/git.mjs';
import { installProject } from '../../src/kernel/install.mjs';
import { createWorktrees } from '../../src/kernel/worktrees.mjs';
import { ResourceService } from '../../src/resources/service.mjs';
import { callTorchTool } from '../../src/mcp/tools.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'torch-verification-'));
  execFileSync('git', ['init', '-b', 'main', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'torch-test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'TORCH Test']);
  writeFileSync(join(root, 'package.json'), `${JSON.stringify({
    name: 'verification-fixture',
    scripts: {
      'verify:pass': 'node -e "process.exit(0)"',
      'verify:fail': 'node -e "process.exit(7)"',
    },
  }, null, 2)}\n`);
  writeFileSync(join(root, 'app.js'), 'export const app = true;\n');
  mkdirSync(join(root, 'test'));
  writeFileSync(join(root, 'test', 'browser.js'), 'export const browserScenario = true;\n');
  writeFileSync(join(root, 'test', 'integration.js'), 'export const integrationScenario = true;\n');
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'fixture']);
  let repository = inspectRepository(root);
  const proposal = proposeDomains({ repository, analysis: analyzeRepository(repository) });
  proposal.review = {
    status: 'approved', reviewedAt: '2026-09-27T00:00:00Z', reviewedBy: 'fixture-owner', notes: [],
  };
  const env = { ...process.env, XDG_DATA_HOME: join(tmpdir(), `${basename(root)}-state`) };
  installProject({ repository, proposal, env, projectId: 'verification-fixture' });
  execFileSync('git', ['-C', root, 'add', '.torch']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'install torch']);
  repository = inspectRepository(root);
  createWorktrees({ repository, parentOverride: join(tmpdir(), `${basename(root)}-worktrees`) });
  return {
    root, env, worker: proposal.domains.find((domain) => domain.id !== 'qa').id,
    peer: proposal.domains.find((domain) => domain.id === 'qa').id,
  };
}

test('SCN-exact-sha-checks: clean committed inputs produce exact receipts and failures never become passes', () => {
  const context = fixture();
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  let id = 0;
  const checks = new CheckService({
    repositoryRoot: context.root, controlPlane: control, idFactory: () => `receipt-${++id}`,
  });
  assert.deepEqual(checks.listChecks().map((check) => check.id), ['verify-pass', 'verify-fail']);
  const passed = checks.run({ checkId: 'verify-pass', areaId: context.worker });
  assert.equal(passed.result, 'pass');
  assert.equal(passed.commit.length, 40);
  assert.equal(checks.exactPasses({ commit: passed.commit, requiredChecks: ['verify-pass'] }), true);
  const failed = checks.run({ checkId: 'verify-fail', areaId: context.worker });
  assert.equal(failed.result, 'fail');
  assert.equal(failed.exitStatus, 7);
  assert.equal(checks.exactPasses({ commit: failed.commit, requiredChecks: ['verify-fail'] }), false);

  const worktree = passed.worktree;
  writeFileSync(join(worktree, 'uncommitted.js'), 'not part of a receipt\n');
  assert.throws(
    () => checks.run({ checkId: 'verify-pass', areaId: context.worker }),
    (error) => error.code === 'CHECK_BLOCKED'
      && error.details.some((blocker) => blocker.code === 'WORKTREE_DIRTY'),
  );
  assert.equal(control.readAudit({ actorId: context.worker })
    .some((event) => event.operation === 'check.run' && event.entityId === passed.id), true);
  control.close();
});

test('SCN-resource-fifo: one holder, queued peer, cancellation, and stale visibility preserve fair ownership', () => {
  const context = fixture();
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  let nowMs = Date.parse('2026-09-27T12:00:00Z');
  let id = 0;
  const resources = new ResourceService({
    repositoryRoot: context.root, controlPlane: control,
    clock: () => new Date(nowMs), idFactory: () => `resource-${++id}`,
  });
  assert.equal(resources.list().some((resource) => resource.id === 'browser'), true);
  const first = resources.acquire({ resourceId: 'browser', areaId: context.worker });
  assert.equal(first.disposition, 'acquired');
  const waiting = resources.acquire({ resourceId: 'browser', areaId: context.peer });
  assert.equal(waiting.disposition, 'queued');
  assert.equal(waiting.request.position, 1);
  assert.equal(resources.status('browser').leases[0].areaId, context.worker);
  assert.throws(
    () => resources.release({ resourceId: 'browser', areaId: context.peer }),
    (error) => error.code === 'RESOURCE_LEASE_NOT_HELD',
  );
  resources.release({ resourceId: 'browser', areaId: context.worker });
  const promoted = resources.acquire({ resourceId: 'browser', areaId: context.peer });
  assert.equal(promoted.disposition, 'acquired');

  nowMs += 3_700_000;
  const stale = resources.status('browser').leases[0];
  assert.equal(stale.state, 'stale');
  const workerAgain = resources.acquire({ resourceId: 'browser', areaId: context.worker });
  assert.equal(workerAgain.disposition, 'queued', 'stale leases are visible but never stolen automatically');
  const cancelled = resources.cancel({ resourceId: 'browser', areaId: context.worker });
  assert.equal(cancelled.state, 'cancelled');
  assert.equal(resources.status('browser').queue.length, 0);
  control.close();
});

test('SCN-frozen-resource-check: waiting checks run captured builds after the specialist advances, with exact receipts and cleanup', () => {
  const context = fixture();
  const path = join(context.root, '.torch', 'torch.yaml');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  config.checks.push({
    id: 'frozen-browser', command: 'node', resources: ['browser'],
    args: ['-e', 'const fs=require("node:fs"); if(fs.readFileSync("dist/index.html","utf8")!=="old build")process.exit(8);'],
    snapshot: { paths: ['dist'], source_commit_file: 'dist/source-commit' },
  });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  const resources = new ResourceService({ repositoryRoot: context.root, controlPlane: control });
  const checks = new CheckService({ repositoryRoot: context.root, controlPlane: control, resourceService: resources });
  const worktree = checks.worktrees.get(context.worker).path;
  // Ignored outputs remain build inputs even though Git does not track them.
  writeFileSync(join(worktree, '.gitignore'), 'dist/\n');
  execFileSync('git', ['-C', worktree, 'add', '.gitignore']);
  execFileSync('git', ['-C', worktree, 'commit', '-m', 'ignore build output']);
  const commit = execFileSync('git', ['-C', worktree, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  mkdirSync(join(worktree, 'dist'));
  writeFileSync(join(worktree, 'dist', 'source-commit'), commit);
  writeFileSync(join(worktree, 'dist', 'index.html'), 'old build');
  resources.acquire({ resourceId: 'browser', areaId: context.peer });
  const prepared = checks.prepare({ checkId: 'frozen-browser', areaId: context.worker });
  assert.equal(resources.acquire({ resourceId: 'browser', areaId: context.worker }).disposition, 'queued');
  assert.throws(() => checks.runPrepared({ preparedId: prepared.id, areaId: context.worker }),
    (error) => error.code === 'CHECK_BLOCKED');
  assert.throws(() => checks.runPrepared({ preparedId: prepared.id, areaId: context.peer }),
    (error) => error.code === 'PREPARED_CHECK_UNAVAILABLE');
  writeFileSync(join(worktree, 'app.js'), 'export const app = "new";\n');
  execFileSync('git', ['-C', worktree, 'add', 'app.js']);
  execFileSync('git', ['-C', worktree, 'commit', '-m', 'continue while queued']);
  const nextCommit = execFileSync('git', ['-C', worktree, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  writeFileSync(join(worktree, 'dist', 'source-commit'), nextCommit);
  writeFileSync(join(worktree, 'dist', 'index.html'), 'new build');
  resources.release({ resourceId: 'browser', areaId: context.peer });
  resources.acquire({ resourceId: 'browser', areaId: context.worker });
  // Reopen the service: prepared state is durable, not conversation memory.
  const resumed = new CheckService({ repositoryRoot: context.root, controlPlane: control, resourceService: resources });
  const receipt = resumed.runPrepared({ preparedId: prepared.id, areaId: context.worker });
  assert.equal(receipt.result, 'pass');
  assert.equal(receipt.commit, commit);
  assert.notEqual(receipt.commit, nextCommit);
  assert.equal(resumed.exactPasses({ commit, requiredChecks: ['frozen-browser'] }), true);
  assert.equal(resumed.exactPasses({ commit: nextCommit, requiredChecks: ['frozen-browser'] }), false);
  // Simulate interruption after receipt persistence but before terminal linking.
  control.database.prepare("UPDATE prepared_checks SET state = 'running', receipt_id = NULL WHERE id = ?").run(prepared.id);
  assert.equal(resumed.exactPasses({ commit, requiredChecks: ['frozen-browser'] }), false,
    'orphaned passing output must not qualify before the prepared operation finishes');
  control.database.prepare("UPDATE prepared_checks SET state = 'finished', receipt_id = ? WHERE id = ?").run(receipt.id, prepared.id);
  assert.equal(existsSync(prepared.snapshot.root), false);
  assert.equal(readFileSync(join(worktree, 'dist', 'index.html'), 'utf8'), 'new build');
  assert.equal(JSON.parse(readFileSync(receipt.artifactPath, 'utf8')).snapshot.inputDigest, prepared.snapshot.digest);
  assert.throws(() => resumed.runPrepared({ preparedId: prepared.id, areaId: context.worker }),
    (error) => error.code === 'PREPARED_CHECK_UNAVAILABLE');

  const cancelled = resumed.prepare({ checkId: 'frozen-browser', areaId: context.worker });
  assert.equal(resumed.cancelPrepared({ preparedId: cancelled.id, areaId: context.worker }).removed, true);
  assert.equal(existsSync(cancelled.snapshot.root), false);
  const changed = resumed.prepare({ checkId: 'frozen-browser', areaId: context.worker });
  config.checks.find((check) => check.id === 'frozen-browser').args.push('changed-policy');
  writeFileSync(path, JSON.stringify(config));
  assert.throws(() => resumed.runPrepared({ preparedId: changed.id, areaId: context.worker }),
    (error) => error.code === 'CHECK_POLICY_CHANGED');
  resumed.cancelPrepared({ preparedId: changed.id, areaId: context.worker });
  const cli = (args) => spawnSync(process.execPath, [
    new URL('../../bin/torch.mjs', import.meta.url).pathname, 'checks', ...args, '--json',
  ], { cwd: context.root, env: context.env, encoding: 'utf8' });
  const unapproved = cli(['prepare', '--id', 'frozen-browser', '--area', context.worker]);
  assert.equal(unapproved.status, 2);
  assert.equal(JSON.parse(unapproved.stdout).error, 'APPROVAL_REQUIRED');
  const fromCli = cli(['prepare', '--id', 'frozen-browser', '--area', context.worker, '--yes']);
  assert.equal(fromCli.status, 0, fromCli.stdout || fromCli.stderr);
  const cliPrepared = JSON.parse(fromCli.stdout);
  const tools = { actorId: context.worker, checkService: checks };
  assert.equal(callTorchTool(control, 'torch_list_prepared_checks', {}, tools)
    .prepared.some((item) => item.id === cliPrepared.id), true);
  assert.throws(() => callTorchTool(control, 'torch_run_prepared_check', {
    prepared_id: cliPrepared.id, area_id: context.peer,
  }, tools));
  const fromMcp = callTorchTool(control, 'torch_run_prepared_check', { prepared_id: cliPrepared.id }, tools);
  assert.equal(fromMcp.result, 'fail', 'current new build must not masquerade as the old expected test input');
  assert.equal(fromMcp.commit, nextCommit);
  const listCli = cli(['prepared', '--area', context.worker]);
  assert.equal(listCli.status, 0, listCli.stdout || listCli.stderr);
  assert.equal(JSON.parse(listCli.stdout).prepared.find((item) => item.id === cliPrepared.id).state, 'finished');
  control.close();
});

test('SCN-real-frozen-browser: queued Chromium sees captured code after an in-place rebuild, never the newer commit', {
  skip: process.env.TORCH_QUALIFY_BROWSER !== '1',
}, () => {
  const context = fixture();
  const configPath = join(context.root, '.torch', 'torch.yaml');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.checks.push({
    id: 'real-frozen-browser', command: process.execPath, resources: ['browser'],
    args: [new URL('../../scripts/frozen-browser-harness.mjs', import.meta.url).pathname, 'captured'],
    snapshot: { paths: ['dist'], source_commit_file: 'dist/source-commit' },
  });
  writeFileSync(configPath, JSON.stringify(config));
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  const resources = new ResourceService({ repositoryRoot: context.root, controlPlane: control });
  const checks = new CheckService({ repositoryRoot: context.root, controlPlane: control, resourceService: resources });
  try {
    const worktree = checks.worktrees.get(context.worker).path;
    writeFileSync(join(worktree, '.gitignore'), 'dist/\n');
    execFileSync('git', ['-C', worktree, 'add', '.gitignore']);
    execFileSync('git', ['-C', worktree, 'commit', '-m', 'ignore browser build']);
    const sha = () => execFileSync('git', ['-C', worktree, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const oldCommit = sha();
    mkdirSync(join(worktree, 'dist'));
    const build = (name, commit) => {
      writeFileSync(join(worktree, 'dist', 'source-commit'), commit);
      writeFileSync(join(worktree, 'dist', 'index.html'),
        `<html><body><main data-build="${name}" data-commit="${commit}">${name}</main></body></html>`);
    };
    build('captured', oldCommit);
    resources.acquire({ resourceId: 'browser', areaId: context.peer });
    const prepared = checks.prepare({ checkId: 'real-frozen-browser', areaId: context.worker });
    assert.equal(resources.acquire({ resourceId: 'browser', areaId: context.worker }).disposition, 'queued');
    assert.throws(() => checks.runPrepared({ preparedId: prepared.id, areaId: context.worker }),
      (error) => error.code === 'CHECK_BLOCKED');
    writeFileSync(join(worktree, 'app.js'), 'export const app = "advanced";\n');
    execFileSync('git', ['-C', worktree, 'add', 'app.js']);
    execFileSync('git', ['-C', worktree, 'commit', '-m', 'advance live browser build']);
    const newCommit = sha();
    // Deliberate in-place overwrite catches unsafe hardlink implementations.
    build('live-new', newCommit);
    resources.release({ resourceId: 'browser', areaId: context.peer });
    assert.equal(resources.acquire({ resourceId: 'browser', areaId: context.worker }).disposition, 'acquired');
    const resumed = new CheckService({ repositoryRoot: context.root, controlPlane: control, resourceService: resources });
    const receipt = resumed.runPrepared({ preparedId: prepared.id, areaId: context.worker });
    const artifact = JSON.parse(readFileSync(receipt.artifactPath, 'utf8'));
    assert.equal(receipt.result, 'pass', artifact.stderr);
    const observed = JSON.parse(artifact.stdout);
    assert.equal(observed.build, 'captured');
    assert.equal(observed.commit, oldCommit);
    assert.equal(observed.inputDigest, prepared.snapshot.digest);
    assert.equal(resumed.exactPasses({ commit: oldCommit, requiredChecks: ['real-frozen-browser'] }), true);
    assert.equal(resumed.exactPasses({ commit: newCommit, requiredChecks: ['real-frozen-browser'] }), false);
    assert.match(readFileSync(join(worktree, 'dist', 'index.html'), 'utf8'), /live-new/);
    assert.equal(existsSync(prepared.snapshot.root), false);
    // Negative control: the unchanged harness must reject the new live build.
    const newer = resumed.prepare({ checkId: 'real-frozen-browser', areaId: context.worker });
    const failed = resumed.runPrepared({ preparedId: newer.id, areaId: context.worker });
    assert.equal(failed.result, 'fail');
    assert.equal(failed.commit, newCommit);
    assert.equal(existsSync(newer.snapshot.root), false);
    resources.release({ resourceId: 'browser', areaId: context.worker });
  } finally {
    control.close();
  }
});

test('SCN-real-browser-conditions: one runtime is measured and probed, frozen clocks prevent or invalidate green measurements', {
  skip: process.env.TORCH_QUALIFY_BROWSER !== '1',
}, async () => {
  for (const mode of ['healthy', 'frozen', 'drift', 'replaced']) {
    const context = fixture();
    const daemon = fork(new URL('../../scripts/condition-browser-runtime.mjs', import.meta.url), [], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let stderr = '';
    daemon.stderr.on('data', (chunk) => { stderr += chunk; });
    const nextMessage = () => Promise.race([
      once(daemon, 'message').then(([message]) => {
        assert.notEqual(message.event, 'error', message.message);
        return message;
      }),
      once(daemon, 'exit').then(([code]) => { throw new Error(`Browser runtime exited ${code}: ${stderr}`); }),
    ]);
    let control;
    try {
      const listening = await nextMessage();
      assert.equal(listening.event, 'listening');
      const configPath = join(context.root, '.torch', 'torch.yaml');
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      const client = new URL('../../scripts/condition-browser-command.mjs', import.meta.url).pathname;
      config.checks.push({ id: 'same-runtime-browser', command: process.execPath,
        args: [client, listening.base, 'measure'], resources: ['browser'],
        snapshot: { paths: ['dist'], source_commit_file: 'dist/source-commit' },
        conditions: { command: process.execPath, args: [client, listening.base, 'probe'],
          required: [{ id: 'clock-moving', equals: true }, { id: 'visible', equals: true },
            { id: 'build', equals: 'captured' }] },
      });
      writeFileSync(configPath, JSON.stringify(config));
      control = openControlPlane({ repositoryRoot: context.root, env: context.env });
      const resources = new ResourceService({ repositoryRoot: context.root, controlPlane: control });
      const checks = new CheckService({ repositoryRoot: context.root, controlPlane: control, resourceService: resources });
      const worktree = checks.worktrees.get(context.worker).path;
      writeFileSync(join(worktree, '.gitignore'), 'dist/\n');
      execFileSync('git', ['-C', worktree, 'add', '.gitignore']);
      execFileSync('git', ['-C', worktree, 'commit', '-m', 'ignore runtime fixture output']);
      const commit = execFileSync('git', ['-C', worktree, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      mkdirSync(join(worktree, 'dist'));
      writeFileSync(join(worktree, 'dist', 'source-commit'), commit);
      writeFileSync(join(worktree, 'dist', 'index.html'), `<html><body><main data-build="captured" data-commit="${commit}">Runtime</main>
        <script>window.runtimeId=crypto.randomUUID(); window.simulationClock=0; window.clockFrozen=false;
        function tick(){if(!window.clockFrozen)window.simulationClock++;requestAnimationFrame(tick);} requestAnimationFrame(tick);</script></body></html>`);
      resources.acquire({ resourceId: 'browser', areaId: context.worker });
      const prepared = checks.prepare({ checkId: 'same-runtime-browser', areaId: context.worker });
      const loadedPromise = nextMessage();
      daemon.send({ action: 'load', mode, subject: { root: prepared.snapshot.inputRoot,
        commit, inputDigest: prepared.snapshot.digest } });
      const loaded = await loadedPromise;
      assert.equal(loaded.event, 'loaded');
      const receipt = checks.runPrepared({ preparedId: prepared.id, areaId: context.worker });
      const artifact = JSON.parse(readFileSync(receipt.artifactPath, 'utf8'));
      const status = await (await fetch(`${listening.base}/status`)).json();
      if (mode === 'replaced') assert.notEqual(status.runtimeId, loaded.runtimeId);
      else assert.equal(status.runtimeId, loaded.runtimeId);
      assert.equal(receipt.conditions.before.report.runtimeId, loaded.runtimeId);
      assert.equal(status.measurements, mode === 'frozen' ? 0 : 1);
      assert.equal(artifact.measurementsExecuted, mode !== 'frozen');
      assert.equal(receipt.result, mode === 'healthy' ? 'pass' : 'incomplete', artifact.stderr);
      assert.equal(checks.exactPasses({ commit, requiredChecks: ['same-runtime-browser'] }), mode === 'healthy');
      if (mode === 'healthy') {
        // Historical green flags cannot bypass today's continuity contract.
        const historical = structuredClone(receipt.conditions);
        historical.after.report.runtimeId = 'different-historical-runtime';
        control.database.prepare('UPDATE check_receipts SET conditions_json = ? WHERE id = ?')
          .run(JSON.stringify(historical), receipt.id);
        assert.equal(checks.exactPasses({ commit, requiredChecks: ['same-runtime-browser'] }), false);
      }
      if (mode === 'frozen') {
        assert.equal(receipt.invalidReason, 'test-conditions-invalid-before');
        assert.equal(receipt.conditions.before.reason, 'condition-mismatch:clock-moving');
      } else {
        if (mode === 'replaced') {
          assert.notEqual(receipt.conditions.after.report.runtimeId, loaded.runtimeId);
          assert.equal(receipt.conditions.after.reason, 'condition-runtime-changed');
          assert.equal(receipt.invalidReason, 'test-conditions-invalid-after');
          assert.equal(receipt.conditions.after.report.conditions['clock-moving'], true);
        } else assert.equal(receipt.conditions.after.report.runtimeId, loaded.runtimeId);
        const measured = artifact.stdout.split('\n').find((line) => line.startsWith('{'));
        assert.equal(JSON.parse(measured).runtimeId, loaded.runtimeId);
        assert.equal(receipt.exitStatus, 0, 'green measurement output alone cannot prove valid conditions');
        if (mode === 'drift') {
          assert.equal(receipt.invalidReason, 'test-conditions-invalid-after');
          assert.equal(receipt.conditions.after.reason, 'condition-mismatch:clock-moving');
        }
      }
      assert.equal(existsSync(prepared.snapshot.root), false);
      resources.release({ resourceId: 'browser', areaId: context.worker });
    } finally {
      control?.close();
      if (daemon.exitCode === null && daemon.connected) {
        const exited = once(daemon, 'exit');
        daemon.send({ action: 'close' });
        const [code] = await exited;
        assert.equal(code, 0, stderr);
      }
    }
  }
});

test('SCN-frozen-check-mutating-executor: changed inputs and thrown execution cannot create passing receipts', () => {
  const context = fixture();
  const path = join(context.root, '.torch', 'torch.yaml');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  config.checks.push({ id: 'frozen', command: 'node', snapshot: { paths: ['app.js', 'build-sha'], source_commit_file: 'build-sha' } });
  writeFileSync(path, JSON.stringify(config));
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  let checks = new CheckService({ repositoryRoot: context.root, controlPlane: control });
  const worktree = checks.worktrees.get(context.worker).path;
  writeFileSync(join(worktree, '.gitignore'), 'build-sha\n');
  execFileSync('git', ['-C', worktree, 'add', '.gitignore']);
  execFileSync('git', ['-C', worktree, 'commit', '-m', 'ignore marker']);
  const commit = execFileSync('git', ['-C', worktree, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  writeFileSync(join(worktree, 'build-sha'), commit);
  checks = new CheckService({ repositoryRoot: context.root, controlPlane: control, executor: (_command, _args, { cwd }) => {
    chmodSync(join(cwd, 'app.js'), 0o600);
    writeFileSync(join(cwd, 'app.js'), 'changed input');
    return { status: 0 };
  } });
  const changed = checks.run({ checkId: 'frozen', areaId: context.worker });
  assert.equal(changed.result, 'incomplete');
  assert.equal(changed.invalidReason, 'snapshot-changed-during-check');
  assert.equal(checks.exactPasses({ commit, requiredChecks: ['frozen'] }), false);
  checks.executor = () => { throw new Error('fixture executor launch failed'); };
  const thrown = checks.run({ checkId: 'frozen', areaId: context.worker });
  assert.equal(thrown.result, 'incomplete');
  assert.equal(thrown.invalidReason, 'executor-failed');
  assert.equal(checks.prepared({ areaId: context.worker }).every((item) => item.state === 'finished'), true);
  control.close();
});

test('SCN-browser-descendant-interruption: runner death leaves Chromium live, owner recovery follows explicit observed browser shutdown', {
  skip: process.platform !== 'linux' || process.env.TORCH_QUALIFY_INTERRUPTION !== '1'
    || process.env.TORCH_QUALIFY_BROWSER !== '1',
}, async () => {
  const context = fixture();
  const configPath = join(context.root, '.torch', 'torch.yaml');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.checks.push({ id: 'browser-interruption', command: process.execPath, resources: ['browser'],
    args: [new URL('../../scripts/interrupted-browser-harness.mjs', import.meta.url).pathname],
    snapshot: { paths: ['dist'], source_commit_file: 'dist/source-commit' } });
  writeFileSync(configPath, JSON.stringify(config));
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  const resources = new ResourceService({ repositoryRoot: context.root, controlPlane: control });
  const checks = new CheckService({ repositoryRoot: context.root, controlPlane: control, resourceService: resources });
  const worktree = checks.worktrees.get(context.worker).path;
  writeFileSync(join(worktree, '.gitignore'), 'dist/\n');
  execFileSync('git', ['-C', worktree, 'add', '.gitignore']);
  execFileSync('git', ['-C', worktree, 'commit', '-m', 'ignore interrupted browser output']);
  const commit = execFileSync('git', ['-C', worktree, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  mkdirSync(join(worktree, 'dist'));
  writeFileSync(join(worktree, 'dist', 'source-commit'), commit);
  writeFileSync(join(worktree, 'dist', 'index.html'), `<html><body><main data-build="captured" data-commit="${commit}">Captured</main></body></html>`);
  resources.acquire({ resourceId: 'browser', areaId: context.worker });
  const prepared = checks.prepare({ checkId: 'browser-interruption', areaId: context.worker });
  const runner = fork(new URL('../../scripts/interrupted-check-runner.mjs', import.meta.url),
    [context.root, prepared.id, context.worker], { env: context.env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let ready;
  let stopped = false;
  let watcher;
  try {
    ready = await new Promise((resolve, reject) => {
      let output = '';
      runner.stdout.on('data', (chunk) => { output += chunk; if (output.includes('\n')) resolve(JSON.parse(output.trim())); });
      runner.once('error', reject);
      runner.once('exit', (code) => reject(new Error(`Browser runner exited before readiness: ${code}`)));
    });
    assert.equal(ready.event, 'browser-ready');
    const exited = once(runner, 'exit'); runner.kill('SIGKILL'); await exited;
    const live = await (await fetch(`${ready.base}/status`)).json();
    assert.equal(live.build, 'captured');
    assert.equal(live.commit, commit);
    assert.equal(live.visible, true, 'real browser remains usable after runner death');
    assert.equal(checks.planPreparedRecovery({ preparedId: prepared.id, actorId: 'owner' }).runner.state, 'stopped');
    assert.throws(() => checks.recoverPrepared({ preparedId: prepared.id, actorId: 'owner', approved: true,
      executorsStopped: false, evidence: 'Only runner stopped; browser remains live.' }),
    (error) => error.code === 'PREPARED_CHECK_STOP_EVIDENCE_REQUIRED');
    assert.equal(existsSync(prepared.snapshot.root), true);
    watcher = spawn('python3', [new URL('../../scripts/wait-owned-browser-group.py', import.meta.url).pathname,
      String(ready.browserPid), ready.browserStart, String(ready.executorPid), ready.executorStart], { stdio: ['ignore', 'pipe', 'pipe'] });
    let watcherError = '';
    watcher.stderr.on('data', (chunk) => { watcherError += chunk; });
    const watchedExit = once(watcher, 'exit');
    const watching = await new Promise((resolve, reject) => {
      let output = '';
      watcher.stdout.on('data', (chunk) => { output += chunk; if (output.includes('\n')) resolve(JSON.parse(output.split('\n')[0])); });
      watcher.once('error', reject);
      watcher.once('exit', (code) => reject(new Error(`Watcher exited before handles: ${code} ${watcherError}`)));
    });
    assert.equal(watching.event, 'watching');
    assert.ok(watching.observed > 1);
    const response = await fetch(`${ready.base}/stop`, { method: 'POST', headers: { 'x-fixture-token': ready.token } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).stopped, true);
    stopped = true;
    const [code] = await watchedExit;
    assert.equal(code, 0, watcherError);
    // Watcher captured both browser group and harness handles before shutdown,
    // so terminal notification cannot race with PID disappearance or reuse.
    const result = checks.recoverPrepared({ preparedId: prepared.id, actorId: 'owner', approved: true,
      executorsStopped: true, evidence: 'Runner exit observed; explicit harness shutdown and captured isolated Chromium group pidfd terminal states confirmed.' });
    assert.equal(result.state, 'abandoned');
    assert.equal(result.cleanupPending, false);
    assert.equal(checks.receipts({ checkId: 'browser-interruption' }).length, 0);
    assert.equal(checks.exactPasses({ commit, requiredChecks: ['browser-interruption'] }), false);
    assert.equal(resources.hasActiveLease({ resourceId: 'browser', areaId: context.worker }), true);
    assert.match(readFileSync(join(worktree, 'dist', 'index.html'), 'utf8'), /Captured/);
    resources.release({ resourceId: 'browser', areaId: context.worker });
  } finally {
    if (ready && !stopped) await fetch(`${ready.base}/stop`, { method: 'POST', headers: { 'x-fixture-token': ready.token } });
    if (runner.exitCode === null && runner.signalCode === null) { const exited = once(runner, 'exit'); runner.kill('SIGKILL'); await exited; }
    if (watcher && watcher.exitCode === null && watcher.signalCode === null) await once(watcher, 'exit');
    control.close();
  }
});

test('SCN-hard-killed-prepared-check: stopped runners retain evidence, recovery requires owner confirmation and never creates a pass or releases resources', {
  skip: process.platform !== 'linux' || process.env.TORCH_QUALIFY_INTERRUPTION !== '1',
}, async () => {
  const context = fixture();
  const path = join(context.root, '.torch', 'torch.yaml');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  config.checks.push({ id: 'interrupted', command: process.execPath, resources: ['browser'],
    args: ['-e', 'console.log(JSON.stringify({event:"executor-started",pid:process.pid}));Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);'],
    snapshot: { paths: ['app.js', 'build-sha'], source_commit_file: 'build-sha' } });
  writeFileSync(path, JSON.stringify(config));
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  const resources = new ResourceService({ repositoryRoot: context.root, controlPlane: control });
  const checks = new CheckService({ repositoryRoot: context.root, controlPlane: control, resourceService: resources });
  const worktree = checks.worktrees.get(context.worker).path;
  writeFileSync(join(worktree, '.gitignore'), 'build-sha\n');
  execFileSync('git', ['-C', worktree, 'add', '.gitignore']);
  execFileSync('git', ['-C', worktree, 'commit', '-m', 'ignore interruption marker']);
  const commit = execFileSync('git', ['-C', worktree, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  writeFileSync(join(worktree, 'build-sha'), commit);
  resources.acquire({ resourceId: 'browser', areaId: context.worker });
  const prepared = checks.prepare({ checkId: 'interrupted', areaId: context.worker });
  const runner = fork(new URL('../../scripts/interrupted-check-runner.mjs', import.meta.url),
    [context.root, prepared.id, context.worker], { env: context.env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let executorPid;
  try {
    const started = await new Promise((resolve, reject) => {
      let output = '';
      runner.stdout.on('data', (chunk) => {
        output += chunk;
        if (output.includes('\n')) resolve(JSON.parse(output.trim()));
      });
      runner.once('error', reject);
      runner.once('exit', (code) => reject(new Error(`Runner exited before handshake: ${code}`)));
    });
    assert.equal(started.event, 'executor-started');
    executorPid = started.pid;
    const running = checks.prepared({ areaId: context.worker }).find((item) => item.id === prepared.id);
    assert.equal(running.state, 'running');
    assert.equal(running.runner.pid, runner.pid);
    assert.equal(checks.planPreparedRecovery({ preparedId: prepared.id, actorId: 'owner' }).runner.state, 'live');
    assert.throws(() => checks.recoverPrepared({ preparedId: prepared.id, actorId: 'owner', approved: true,
      executorsStopped: true, evidence: 'Invalid claim while runner still lives.' }), (error) => error.code === 'PREPARED_CHECK_RUNNER_LIVE');
    const exited = once(runner, 'exit');
    runner.kill('SIGKILL');
    await exited;
    // Stop this exact disposable executor via a kernel pidfd and await terminal
    // notification, not a sleep or a guessed PID timeout. No unrelated PID is targeted.
    execFileSync('python3', ['-c', 'import os,signal,select,sys; fd=os.pidfd_open(int(sys.argv[1])); signal.pidfd_send_signal(fd,signal.SIGKILL); assert select.select([fd],[],[],10)[0]; os.close(fd)', String(executorPid)], { timeout: 15000 });
    executorPid = null;
    const resumed = new CheckService({ repositoryRoot: context.root, controlPlane: control, resourceService: resources });
    assert.equal(resumed.planPreparedRecovery({ preparedId: prepared.id, actorId: 'owner' }).runner.state, 'stopped');
    assert.equal(existsSync(prepared.snapshot.root), true);
    assert.throws(() => resumed.runPrepared({ preparedId: prepared.id, areaId: context.worker }),
      (error) => error.code === 'PREPARED_CHECK_UNAVAILABLE');
    assert.throws(() => resumed.recoverPrepared({ preparedId: prepared.id, actorId: 'owner', evidence: 'stopped' }),
      (error) => error.code === 'APPROVAL_REQUIRED');
    assert.throws(() => resumed.recoverPrepared({ preparedId: prepared.id, actorId: 'owner', approved: true }),
      (error) => error.code === 'PREPARED_CHECK_STOP_EVIDENCE_REQUIRED');
    assert.throws(() => resumed.planPreparedRecovery({ preparedId: prepared.id, actorId: context.worker }),
      (error) => error.code === 'OWNER_AUTHORITY_REQUIRED');
    const input = { preparedId: prepared.id, actorId: 'owner', approved: true,
      executorsStopped: true, evidence: 'Owned runner SIGKILL exit observed; owned measurement pidfd termination confirmed.' };
    const marker = join(prepared.snapshot.root, 'snapshot.json');
    const originalMarker = readFileSync(marker, 'utf8');
    writeFileSync(marker, '{}');
    const pendingCleanup = resumed.recoverPrepared(input);
    assert.equal(pendingCleanup.state, 'abandoned');
    assert.equal(pendingCleanup.cleanupPending, true);
    assert.equal(pendingCleanup.cleanupReason, 'CHECK_SNAPSHOT_INVALID');
    assert.equal(new CheckService({ repositoryRoot: context.root, controlPlane: control })
      .prepared().find((item) => item.id === prepared.id).recovery.cleanupPending, true);
    assert.equal(existsSync(prepared.snapshot.root), true, 'unowned cleanup must preserve the directory');
    writeFileSync(marker, originalMarker);
    const recovered = resumed.recoverPrepared(input);
    assert.equal(recovered.state, 'abandoned');
    assert.equal(recovered.cleanupPending, false);
    assert.equal(new CheckService({ repositoryRoot: context.root, controlPlane: control })
      .prepared().find((item) => item.id === prepared.id).recovery.cleanupPending, false);
    assert.equal(recovered.receiptCreated, false);
    assert.equal(recovered.executionPerformed, false);
    assert.equal(existsSync(prepared.snapshot.root), false);
    assert.equal(resumed.receipts({ checkId: 'interrupted' }).length, 0);
    assert.equal(resumed.exactPasses({ commit, requiredChecks: ['interrupted'] }), false);
    assert.equal(resources.hasActiveLease({ resourceId: 'browser', areaId: context.worker }), true);
    assert.equal(resumed.recoverPrepared(input).mutationPerformed, false);
    assert.equal(control.readAudit().filter((event) => event.operation === 'check.recover-prepared'
      && event.entityId === prepared.id).length, 1, 'cleanup replay retains a single original recovery audit');
    assert.equal(readFileSync(join(worktree, 'app.js'), 'utf8'), 'export const app = true;\n');
    const cli = (args) => spawnSync(process.execPath, [new URL('../../bin/torch.mjs', import.meta.url).pathname,
      'checks', ...args, '--json'], { cwd: context.root, env: context.env, encoding: 'utf8' });
    assert.equal(cli(['recovery-plan', '--prepared', prepared.id]).status, 0);
    assert.equal(cli(['recover-prepared', '--prepared', prepared.id]).status, 2);
    assert.equal(cli(['recover-prepared', '--prepared', prepared.id, '--executors-stopped',
      '--evidence', input.evidence, '--yes']).status, 0);
    resources.release({ resourceId: 'browser', areaId: context.worker });
  } finally {
    if (runner.exitCode === null && runner.signalCode === null) {
      const exited = once(runner, 'exit'); runner.kill('SIGKILL'); await exited;
    }
    if (executorPid) {
      execFileSync('python3', ['-c', 'import os,signal,select,sys; fd=os.pidfd_open(int(sys.argv[1])); signal.pidfd_send_signal(fd,signal.SIGKILL); assert select.select([fd],[],[],10)[0]; os.close(fd)', String(executorPid)], { timeout: 15000 });
    }
    control.close();
  }
});

test('SCN-condition-receipts: live and frozen checks persist validated condition evidence and reject bad environment as incomplete', () => {
  const context = fixture();
  const path = join(context.root, '.torch', 'torch.yaml');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  const probe = 'const fs=require("node:fs");const r=JSON.parse(fs.readFileSync("conditions.json","utf8"));console.log(JSON.stringify({schema:"torch.dev/check-conditions/v1alpha1",subject:{commit:r.commit,inputDigest:process.env.TORCH_CHECK_INPUT_DIGEST||undefined},conditions:{"clock-moving":r.moving,visible:r.visible}}));';
  const conditions = { command: 'node', args: ['-e', probe], required: [
    { id: 'clock-moving', equals: true }, { id: 'visible', equals: true },
  ] };
  const measured = join(context.root, 'measurement-evidence');
  for (const id of ['condition-live', 'condition-frozen']) config.checks.push({
    id, command: 'node', args: ['-e', `require("node:fs").writeFileSync(${JSON.stringify(measured)},"executed");`],
    conditions, ...(id === 'condition-frozen' ? {
      snapshot: { paths: ['app.js', 'build-sha', 'conditions.json'], source_commit_file: 'build-sha' },
    } : {}),
  });
  writeFileSync(path, JSON.stringify(config));
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  const checks = new CheckService({ repositoryRoot: context.root, controlPlane: control });
  const worktree = checks.worktrees.get(context.worker).path;
  writeFileSync(join(worktree, '.gitignore'), 'conditions.json\nbuild-sha\n');
  execFileSync('git', ['-C', worktree, 'add', '.gitignore']);
  execFileSync('git', ['-C', worktree, 'commit', '-m', 'ignore diagnostic inputs']);
  const commit = execFileSync('git', ['-C', worktree, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  writeFileSync(join(worktree, 'build-sha'), commit);
  const report = { commit, moving: false, visible: true };
  writeFileSync(join(worktree, 'conditions.json'), JSON.stringify(report));
  const invalid = checks.run({ checkId: 'condition-live', areaId: context.worker });
  assert.equal(invalid.result, 'incomplete');
  assert.equal(invalid.invalidReason, 'test-conditions-invalid-before');
  assert.equal(existsSync(measured), false);
  assert.equal(checks.exactPasses({ commit, requiredChecks: ['condition-live'] }), false);
  report.moving = true;
  writeFileSync(join(worktree, 'conditions.json'), JSON.stringify(report));
  for (const id of ['condition-live', 'condition-frozen']) {
    const passed = checks.run({ checkId: id, areaId: context.worker });
    assert.equal(passed.result, 'pass');
    assert.equal(passed.conditions.before.valid, true);
    assert.equal(passed.conditions.after.valid, true);
    assert.equal(checks.receipts({ checkId: id }).some((receipt) => receipt.conditions?.before.valid), true);
    assert.equal(JSON.parse(readFileSync(passed.artifactPath, 'utf8')).conditions.before.valid, true);
    if (id === 'condition-frozen') assert.equal(passed.conditions.subject.inputDigest, passed.snapshot.inputDigest);
  }
  const changed = new CheckService({ repositoryRoot: context.root, controlPlane: control });
  const validEvidence = checks.receipts({ checkId: 'condition-live' }).find((receipt) => receipt.result === 'pass');
  control.database.prepare('UPDATE check_receipts SET conditions_json = NULL WHERE id = ?').run(validEvidence.id);
  assert.equal(checks.exactPasses({ commit, requiredChecks: ['condition-live'] }), false,
    'passing status alone cannot replace a missing condition receipt');
  config.checks.find((check) => check.id === 'condition-live').conditions.required.push({ id: 'gpu-active', equals: true });
  writeFileSync(path, JSON.stringify(config));
  assert.equal(changed.exactPasses({ commit, requiredChecks: ['condition-live'] }), false,
    'a condition-policy change invalidates prior receipts');
  control.close();
});
