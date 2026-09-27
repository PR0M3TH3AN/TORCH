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
