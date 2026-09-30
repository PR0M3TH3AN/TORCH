import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import { CheckService } from '../../src/checks/service.mjs';
import { openControlPlane } from '../../src/control-plane/service.mjs';
import {
  configureDelivery, DeliveryService, planDeliveryConfiguration,
} from '../../src/delivery/service.mjs';
import { analyzeRepository } from '../../src/kernel/analyze.mjs';
import { proposeDomains } from '../../src/kernel/domains.mjs';
import { inspectRepository } from '../../src/kernel/git.mjs';
import { installProject } from '../../src/kernel/install.mjs';
import { createWorktrees } from '../../src/kernel/worktrees.mjs';
import { IntegrationService } from '../../src/integration/service.mjs';
import { observeProject } from '../../src/observability/snapshot.mjs';

const CLI = new URL('../../bin/torch.mjs', import.meta.url).pathname;

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'torch-delivery-'));
  execFileSync('git', ['init', '-b', 'main', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'torch-test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'TORCH Test']);
  writeFileSync(join(root, 'package.json'), `${JSON.stringify({
    name: 'delivery-fixture', scripts: { 'verify:pass': 'node -e "process.exit(0)"' },
  }, null, 2)}\n`);
  writeFileSync(join(root, 'app.js'), 'export const value = 1;\n');
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'fixture']);
  let repository = inspectRepository(root);
  const proposal = proposeDomains({ repository, analysis: analyzeRepository(repository) });
  proposal.checks = proposal.checks.filter((check) => check.id === 'verify-pass');
  proposal.review = {
    status: 'approved', reviewedAt: '2026-09-27T00:00:00Z', reviewedBy: 'fixture-owner', notes: [],
  };
  const env = { ...process.env, XDG_DATA_HOME: join(tmpdir(), `${basename(root)}-state`) };
  installProject({ repository, proposal, env, projectId: 'delivery-fixture' });
  execFileSync('git', ['-C', root, 'add', '.torch']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'install torch']);
  repository = inspectRepository(root);
  createWorktrees({
    repository, parentOverride: join(tmpdir(), `${basename(root)}-worktrees`),
  });
  execFileSync('git', ['-C', root, 'add', '.torch/install-manifest.json']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'record managed worktrees']);
  const manifest = JSON.parse(readFileSync(join(root, '.torch', 'install-manifest.json'), 'utf8'));
  const worker = proposal.domains[0].id;
  const worktree = manifest.external.find((entry) => entry.type === 'worktree' && entry.area === worker);
  execFileSync('git', ['-C', worktree.path, 'merge', 'main']);
  writeFileSync(join(worktree.path, 'app.js'), 'export const value = 2;\n');
  execFileSync('git', ['-C', worktree.path, 'add', 'app.js']);
  execFileSync('git', ['-C', worktree.path, 'commit', '-m', 'delivery change']);
  return { root, env, worker, worktree };
}

test('SCN-delivery-attempts: approved safe transient retries are bounded, durable and serialized; unknown effects never retry blindly', () => {
  const context = fixture();
  configureDelivery({ repositoryRoot: context.root, releaseProvider: 'fixture', deploymentProvider: 'fixture' });
  const configPath = join(context.root, '.torch', 'torch.yaml');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.delivery.retry = { max_attempts: 3 };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  let count = 0;
  const keys = [];
  let service;
  const adapter = {
    name: 'fixture', capabilities: { release: true, deploy: true, verifyLive: true },
    retrySafety: { release: 'idempotent', deploy: 'idempotent', verifyLive: 'read-only' },
    release: ({ idempotencyKey }) => {
      keys.push(idempotencyKey);
      assert.equal(service.attempts().at(-1).state, 'running');
      assert.equal(service.planTransition({ deliveryId: item.id, targetState: 'released', actor: 'owner' })
        .blockers.some((entry) => entry.code === 'DELIVERY_OPERATION_UNRESOLVED'), true);
      count += 1;
      return count < 3 ? { status: 'failed', failure: { classification: 'transient', effects: 'not-applied', code: 'NETWORK' } }
        : { status: 'succeeded', reference: 'fixture-release' };
    },
    deploy: () => { throw new Error('Uncertain external outcome'); },
    verifyLive: () => ({ status: 'succeeded', reference: 'fixture-live' }),
  };
  service = new DeliveryService({ repositoryRoot: context.root, controlPlane: control, adapters: new Map([['fixture', adapter]]) });
  const item = service.create({ sourceArea: context.worker, label: 'Retry boundary', evidence: ['implementation'] });
  // Fixture setup puts an existing delivery at the release-ready boundary;
  // the independent lifecycle scenario below proves real checks and landing.
  control.database.prepare("UPDATE deliveries SET state = 'release-ready' WHERE id = ?").run(item.id);
  assert.throws(() => service.transition({ deliveryId: item.id, targetState: 'released', actor: 'owner', evidence: ['approval'] }),
    (error) => error.code === 'APPROVAL_REQUIRED');
  assert.equal(service.attempts().length, 0);
  const released = service.transition({ deliveryId: item.id, targetState: 'released', actor: 'owner', evidence: ['approval'], approved: true });
  assert.equal(released.state, 'released');
  assert.equal(count, 3);
  assert.equal(new Set(keys).size, 1);
  assert.ok(keys[0]);
  assert.deepEqual(service.attempts().map((entry) => entry.state), ['failed', 'failed', 'succeeded']);
  assert.equal(service.operations().at(-1).state, 'applied');
  assert.throws(() => service.transition({ deliveryId: item.id, targetState: 'deployed', actor: 'owner', evidence: ['deploy approval'], approved: true }),
    (error) => error.code === 'DELIVERY_ADAPTER_FAILED');
  assert.equal(service.get(item.id).state, 'released');
  assert.equal(service.attempts().at(-1).state, 'unknown');
  assert.equal(service.operations().at(-1).state, 'unknown');
  const uncertain = service.operations().at(-1);
  assert.equal(service.planSucceededRecovery({ operationId: uncertain.id, actor: 'owner' }).canProceed, false);
  assert.throws(() => service.recoverNotApplied({ operationId: uncertain.id, actor: context.worker, approved: true,
    runtimeStopped: true, evidence: ['independent verification'] }), (error) => error.code === 'DELIVERY_AUTHORITY_REQUIRED');
  assert.throws(() => service.recoverNotApplied({ operationId: uncertain.id, actor: 'owner', approved: true,
    evidence: ['independent verification'] }), (error) => error.code === 'APPROVAL_REQUIRED');
  assert.throws(() => service.transition({ deliveryId: item.id, targetState: 'deployed', actor: 'owner', evidence: ['retry'], approved: true }),
    (error) => error.code === 'DELIVERY_TRANSITION_BLOCKED');
  assert.equal(service.attempts().length, 4);
  const snapshot = observeProject({ repositoryRoot: context.root, env: context.env });
  assert.equal(snapshot.deliveryOperations.some((entry) => entry.state === 'unknown'), true);
  control.close();
  const reopened = openControlPlane({ repositoryRoot: context.root, env: context.env });
  const durable = new DeliveryService({ repositoryRoot: context.root, controlPlane: reopened });
  assert.equal(durable.attempts({ deliveryId: item.id }).length, 4);
  assert.equal(durable.operations().at(-1).state, 'unknown');
  reopened.close();
  const cli = spawnSync(process.execPath, [CLI, 'delivery', 'attempts', '--id', item.id, '--json'], {
    cwd: context.root, env: context.env, encoding: 'utf8',
  });
  assert.equal(cli.status, 0, cli.stderr + cli.stdout);
  assert.equal(JSON.parse(cli.stdout).attempts.length, 4);
  const recover = spawnSync(process.execPath, [CLI, 'delivery', 'recover-not-applied', '--operation', uncertain.id,
    '--by', 'owner', '--yes', '--runtime-stopped', '--evidence', 'Independent provider check confirmed no deployment', '--json'], {
    cwd: context.root, env: context.env, encoding: 'utf8',
  });
  assert.equal(recover.status, 0, recover.stderr + recover.stdout);
  assert.equal(JSON.parse(recover.stdout).provenance, 'owner-attested-not-applied');
  const inspected = openControlPlane({ repositoryRoot: context.root, env: context.env });
  const reviewed = new DeliveryService({ repositoryRoot: context.root, controlPlane: inspected });
  assert.equal(reviewed.operations().at(-1).state, 'reviewed-not-applied');
  assert.equal(reviewed.attempts().at(-1).state, 'unknown', 'original uncertainty must not be rewritten as independently measured truth');
  assert.equal(reviewed.get(item.id).state, 'released');
  inspected.close();
});

test('SCN-delivery-retry-boundaries: limits, permanent failures, missing safety and changed policy cannot trigger extra external effects', () => {
  const context = fixture();
  configureDelivery({ repositoryRoot: context.root, releaseProvider: 'fixture', deploymentProvider: 'fixture' });
  const path = join(context.root, '.torch', 'torch.yaml');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  config.delivery.retry = { max_attempts: 2 };
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  const peerControl = openControlPlane({ repositoryRoot: context.root, env: context.env });
  let mode = 'transient';
  let calls = 0;
  const adapter = {
    name: 'fixture', capabilities: { release: true, deploy: true, verifyLive: true },
    retrySafety: { release: 'idempotent' },
    release: ({ delivery }) => {
      calls += 1;
      const peer = new DeliveryService({ repositoryRoot: context.root, controlPlane: peerControl, adapters: new Map([['fixture', adapter]]) });
      assert.throws(() => peer.transition({ deliveryId: delivery.id, targetState: 'released', actor: 'owner',
        approved: true, evidence: ['competing caller'] }), (error) => error.code === 'DELIVERY_TRANSITION_BLOCKED');
      if (mode === 'policy-change') {
        config.delivery.authority.released = ['session-manager'];
        writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
      }
      return { status: 'failed', failure: { classification: mode === 'permanent' ? 'permanent' : 'transient', effects: 'not-applied' } };
    },
    deploy: () => ({ status: 'succeeded', reference: 'fixture' }),
    verifyLive: () => ({ status: 'succeeded', reference: 'fixture' }),
  };
  const service = new DeliveryService({ repositoryRoot: context.root, controlPlane: control, adapters: new Map([['fixture', adapter]]) });
  let lastDeliveryId;
  for (const [scenario, expected] of [['transient', 2], ['permanent', 1], ['undeclared', 1], ['policy-change', 1]]) {
    mode = scenario;
    calls = 0;
    adapter.retrySafety = scenario === 'undeclared' ? undefined : { release: 'idempotent' };
    const item = service.create({ sourceArea: context.worker, label: scenario, evidence: ['implementation'] });
    lastDeliveryId = item.id;
    control.database.prepare("UPDATE deliveries SET state = 'release-ready' WHERE id = ?").run(item.id);
    assert.throws(() => service.transition({ deliveryId: item.id, targetState: 'released', actor: 'owner', evidence: ['approved'], approved: true }),
      (error) => error.code === (scenario === 'policy-change' ? 'DELIVERY_POLICY_CHANGED' : 'DELIVERY_ADAPTER_FAILED'));
    assert.equal(calls, expected);
    assert.equal(service.get(item.id).state, 'release-ready');
    assert.equal(service.operations({ deliveryId: item.id }).at(-1).state, 'failed');
    assert.equal(service.attempts({ deliveryId: item.id }).length, expected);
  }
  assert.equal(service.planTransition({ deliveryId: lastDeliveryId, targetState: 'released', actor: 'owner' })
    .blockers.some((entry) => entry.code === 'DELIVERY_AUTHORITY_REQUIRED'), true, 'long-lived service must see revoked authority');
  peerControl.close();
  control.close();
});

test('SCN-delivery-succeeded-recovery: interrupted local application reuses durable success once, never re-executes and rejects changed destination or authority', () => {
  const context = fixture();
  configureDelivery({ repositoryRoot: context.root, releaseProvider: 'fixture', deploymentProvider: 'fixture' });
  const configPath = join(context.root, '.torch', 'torch.yaml');
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  let calls = 0;
  const adapter = {
    name: 'fixture', capabilities: { release: true, deploy: true, verifyLive: true },
    release: ({ delivery }) => { calls += 1; return { status: 'succeeded', reference: `release:${delivery.commit}` }; },
    deploy: () => ({ status: 'succeeded', reference: 'deploy' }),
    verifyLive: () => ({ status: 'succeeded', reference: 'live' }),
  };
  const service = new DeliveryService({ repositoryRoot: context.root, controlPlane: control, adapters: new Map([['fixture', adapter]]) });
  const item = service.create({ sourceArea: context.worker, label: 'Interrupted success', evidence: ['implementation'] });
  control.database.prepare("UPDATE deliveries SET state = 'release-ready' WHERE id = ?").run(item.id);
  const audit = control.audit.bind(control);
  control.audit = (input) => {
    if (input.operation === 'delivery.released') throw new Error('Local audit storage interrupted');
    return audit(input);
  };
  assert.throws(() => service.transition({ deliveryId: item.id, targetState: 'released', actor: 'owner',
    approved: true, evidence: ['release approval'] }), /Local audit storage interrupted/);
  control.audit = audit;
  assert.equal(calls, 1);
  assert.equal(service.get(item.id).state, 'release-ready');
  const operation = service.operations().at(-1);
  assert.equal(operation.state, 'succeeded');
  assert.equal(service.attempts().at(-1).state, 'succeeded');
  assert.throws(() => service.recoverNotApplied({ operationId: operation.id, actor: 'owner', approved: true,
    runtimeStopped: true, evidence: ['incorrect not-applied claim'] }), (error) => error.code === 'DELIVERY_RECOVERY_BLOCKED');
  control.close();
  const reopened = openControlPlane({ repositoryRoot: context.root, env: context.env });
  const recoveredService = new DeliveryService({ repositoryRoot: context.root, controlPlane: reopened });
  const input = { operationId: operation.id, actor: 'owner' };
  assert.equal(recoveredService.planSucceededRecovery(input).canProceed, true, 'saved success needs no executable adapter to reconcile');
  const savedAdapterHash = reopened.database.prepare('SELECT adapter_config_hash AS hash FROM delivery_operations WHERE id = ?').get(operation.id).hash;
  assert.match(savedAdapterHash, /^[0-9a-f]{64}$/);
  reopened.database.exec('ALTER TABLE delivery_operations DROP COLUMN adapter_config_hash');
  const migrated = new DeliveryService({ repositoryRoot: context.root, controlPlane: reopened });
  assert.equal(migrated.attempts().length, 1, 'additive migration preserves legacy receipts');
  assert.equal(migrated.planSucceededRecovery(input).canProceed, true, 'legacy records require the unchanged full policy hash');
  reopened.database.prepare('UPDATE delivery_operations SET adapter_config_hash = ? WHERE id = ?').run(savedAdapterHash, operation.id);
  assert.throws(() => recoveredService.reconcileSucceeded({ ...input, approved: true, evidence: ['provider confirms success'] }),
    (error) => error.code === 'APPROVAL_REQUIRED');
  assert.throws(() => recoveredService.planSucceededRecovery({ ...input, actor: context.worker }),
    (error) => error.code === 'DELIVERY_AUTHORITY_REQUIRED');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.delivery.adapters.release.destination = 'different-target';
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  assert.equal(recoveredService.planSucceededRecovery(input).blockers.some((entry) => entry.code === 'DELIVERY_RECOVERY_DESTINATION_CHANGED'), true);
  assert.throws(() => recoveredService.reconcileSucceeded({ ...input, approved: true, runtimeStopped: true, evidence: ['approval'] }),
    (error) => error.code === 'DELIVERY_RECOVERY_BLOCKED');
  delete config.delivery.adapters.release.destination;
  config.delivery.authority.released = ['session-manager'];
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  assert.equal(recoveredService.planSucceededRecovery(input).blockers.some((entry) => entry.code === 'DELIVERY_AUTHORITY_REQUIRED'), true);
  config.delivery.authority.released = ['owner'];
  config.backlog = { ...config.backlog, activity: { stale_days: 4 } };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  // Crash after the success receipt but before marking its parent successful.
  reopened.database.prepare("UPDATE delivery_operations SET state = 'running' WHERE id = ?").run(operation.id);
  assert.equal(recoveredService.planSucceededRecovery(input).canProceed, true, 'unrelated policy changes do not change the external destination');
  const recoveredAudit = reopened.audit.bind(reopened);
  reopened.audit = (entry) => {
    if (entry.operation === 'delivery.owner-reconciled-success') throw new Error('Recovery audit interrupted');
    return recoveredAudit(entry);
  };
  assert.throws(() => recoveredService.reconcileSucceeded({ ...input, approved: true, runtimeStopped: true,
    evidence: ['provider confirmation'] }), /Recovery audit interrupted/);
  reopened.audit = recoveredAudit;
  assert.equal(recoveredService.get(item.id).state, 'release-ready');
  assert.equal(recoveredService.operations().at(-1).state, 'running');
  assert.equal(recoveredService.attempts().length, 1);
  const cli = (extra) => spawnSync(process.execPath, [CLI, 'delivery', 'recover-succeeded', '--operation', operation.id,
    '--by', 'owner', '--evidence', 'Provider confirms exact published commit', '--json', ...extra], {
    cwd: context.root, env: context.env, encoding: 'utf8',
  });
  const preview = cli(['--dry-run']);
  assert.equal(preview.status, 0, preview.stderr + preview.stdout);
  assert.equal(JSON.parse(preview.stdout).mutationPerformed, false);
  assert.notEqual(cli(['--runtime-stopped']).status, 0);
  const result = cli(['--runtime-stopped', '--yes']);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(JSON.parse(result.stdout).executorInvoked, false);
  assert.equal(recoveredService.get(item.id).state, 'released');
  assert.equal(recoveredService.get(item.id).adapterReceipts.length, 1);
  assert.equal(recoveredService.operations().at(-1).state, 'applied');
  assert.equal(recoveredService.attempts().length, 1);
  const eventCount = reopened.database.prepare('SELECT COUNT(*) AS count FROM delivery_events WHERE delivery_id = ?').get(item.id).count;
  const replay = recoveredService.reconcileSucceeded({ ...input, approved: true, runtimeStopped: true, evidence: ['repeat review'] });
  assert.equal(replay.mutationPerformed, false);
  assert.equal(reopened.database.prepare('SELECT COUNT(*) AS count FROM delivery_events WHERE delivery_id = ?').get(item.id).count, eventCount);
  assert.equal(calls, 1);
  reopened.close();
});

test('SCN-delivery-lifecycle: delivery authority, evidence, integration, and adapters are distinct gates', () => {
  const context = fixture();
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  let serial = 0;
  const idFactory = () => `delivery-id-${++serial}`;
  const checks = new CheckService({ repositoryRoot: context.root, controlPlane: control, idFactory });
  let service = new DeliveryService({
    repositoryRoot: context.root, controlPlane: control, checkService: checks, idFactory,
  });
  let delivery = service.create({
    sourceArea: context.worker, label: 'Portable release boundary', evidence: ['implementation commit'],
  });
  assert.equal(delivery.state, 'implemented');
  assert.throws(
    () => service.planTransition({ deliveryId: delivery.id, targetState: 'integrated', actor: 'session-manager' }),
    (error) => error.code === 'DELIVERY_TRANSITION_INVALID',
  );
  assert.equal(service.planTransition({
    deliveryId: delivery.id, targetState: 'verified', actor: context.worker,
  }).blockers.some((blocker) => blocker.code === 'DELIVERY_CHECKS_REQUIRED'), true);

  const receipt = checks.run({ checkId: 'verify-pass', areaId: context.worker });
  delivery = service.transition({
    deliveryId: delivery.id, targetState: 'verified', actor: context.worker,
    evidence: [`check:${receipt.id}`],
  });
  assert.equal(delivery.state, 'verified');
  assert.equal(service.planTransition({
    deliveryId: delivery.id, targetState: 'integrated', actor: 'session-manager',
  }).blockers.some((blocker) => blocker.code === 'DELIVERY_INTEGRATION_REQUIRED'), true);

  const integration = new IntegrationService({
    repositoryRoot: context.root, controlPlane: control, checkService: checks, idFactory,
  });
  const request = integration.request({ areaId: context.worker, commit: receipt.commit });
  integration.authorize({ requestId: request.id, actorId: 'session-manager' });
  const landed = integration.land({ requestId: request.id, actorId: 'session-manager' });
  delivery = service.transition({
    deliveryId: delivery.id, targetState: 'integrated', actor: 'session-manager',
    evidence: [`integration:${landed.id}`],
  });
  delivery = service.transition({
    deliveryId: delivery.id, targetState: 'release-ready', actor: 'session-manager',
    evidence: ['release checklist complete'],
  });
  assert.equal(delivery.state, 'release-ready');
  assert.equal(service.planTransition({
    deliveryId: delivery.id, targetState: 'released', actor: 'owner',
  }).blockers[0].code, 'DELIVERY_ADAPTER_NOT_CONFIGURED');

  const configurationPlan = planDeliveryConfiguration({
    repositoryRoot: context.root, releaseProvider: 'fixture', deploymentProvider: 'fixture',
  });
  assert.equal(configurationPlan.canProceed, true);
  assert.equal(configurationPlan.mutationPerformed, false);
  configureDelivery({
    repositoryRoot: context.root, releaseProvider: 'fixture', deploymentProvider: 'fixture',
  });
  const invocations = [];
  const adapter = {
    name: 'fixture', capabilities: { release: true, deploy: true, verifyLive: true },
    release: ({ delivery: item }) => {
      invocations.push('release'); return { status: 'succeeded', reference: `release:${item.commit}` };
    },
    deploy: ({ delivery: item }) => {
      invocations.push('deploy'); return { status: 'succeeded', reference: `deploy:${item.commit}` };
    },
    verifyLive: ({ delivery: item }) => {
      invocations.push('verifyLive'); return { status: 'succeeded', reference: `live:${item.commit}` };
    },
  };
  service = new DeliveryService({
    repositoryRoot: context.root, controlPlane: control, checkService: checks,
    adapters: new Map([['fixture', adapter]]), idFactory,
  });
  assert.equal(service.planTransition({
    deliveryId: delivery.id, targetState: 'released', actor: 'session-manager',
  }).blockers[0].code, 'DELIVERY_AUTHORITY_REQUIRED');
  assert.throws(
    () => service.transition({
      deliveryId: delivery.id, targetState: 'released', actor: 'owner', evidence: ['release candidate'],
    }),
    (error) => error.code === 'APPROVAL_REQUIRED',
  );
  for (const [state, evidence] of [
    ['released', 'published artifact'], ['deployed', 'deployment receipt'], ['live-verified', 'live probe'],
  ]) {
    delivery = service.transition({
      deliveryId: delivery.id, targetState: state, actor: 'owner', evidence: [evidence], approved: true,
    });
  }
  assert.equal(delivery.state, 'live-verified');
  assert.deepEqual(invocations, ['release', 'deploy', 'verifyLive']);
  assert.equal(delivery.adapterReceipts.length, 3);
  assert.equal(observeProject({ repositoryRoot: context.root, env: context.env }).deliveries[0].state, 'live-verified');
  control.close();

  const reopened = openControlPlane({ repositoryRoot: context.root, env: context.env });
  const durable = new DeliveryService({
    repositoryRoot: context.root, controlPlane: reopened, adapters: new Map([['fixture', adapter]]),
  }).get(delivery.id);
  assert.equal(durable.state, 'live-verified');
  assert.equal(durable.adapterReceipts.length, 3);
  reopened.close();

  const cliCreate = spawnSync(process.execPath, [
    CLI, 'delivery', 'create', '--area', context.worker, '--label', 'CLI delivery',
    '--evidence', 'clean source tip', '--json',
  ], { cwd: context.root, env: context.env, encoding: 'utf8' });
  assert.equal(cliCreate.status, 0, cliCreate.stderr || cliCreate.stdout);
  const cliDelivery = JSON.parse(cliCreate.stdout);
  assert.equal(cliDelivery.state, 'implemented');
  const cliList = spawnSync(process.execPath, [CLI, 'delivery', 'list', '--json'], {
    cwd: context.root, env: context.env, encoding: 'utf8',
  });
  assert.equal(cliList.status, 0, cliList.stderr || cliList.stdout);
  assert.equal(JSON.parse(cliList.stdout).deliveries.some((item) => item.id === cliDelivery.id), true);
});
