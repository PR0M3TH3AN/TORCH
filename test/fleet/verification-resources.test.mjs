import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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
