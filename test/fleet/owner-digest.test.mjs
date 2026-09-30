import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import { BacklogService } from '../../src/backlog/service.mjs';
import { openControlPlane } from '../../src/control-plane/service.mjs';
import { DeliveryService } from '../../src/delivery/service.mjs';
import { OwnerDigestService } from '../../src/observability/owner-digest.mjs';
import { analyzeRepository } from '../../src/kernel/analyze.mjs';
import { proposeDomains } from '../../src/kernel/domains.mjs';
import { inspectRepository } from '../../src/kernel/git.mjs';
import { installProject } from '../../src/kernel/install.mjs';
import { createWorktrees } from '../../src/kernel/worktrees.mjs';
import { ScheduleService } from '../../src/schedules/service.mjs';
import { createConsoleServer } from '../../src/console/server.mjs';
import { CheckService } from '../../src/checks/service.mjs';
import { IntegrationService } from '../../src/integration/service.mjs';

const CLI = new URL('../../bin/torch.mjs', import.meta.url).pathname;
const now = () => new Date('2026-09-30T08:12:00Z');
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'torch-owner-digest-'));
  const git = (args) => execFileSync('git', ['-C', root, ...args], {
    env: { ...process.env, GIT_AUTHOR_DATE: '2026-09-20T12:00:00Z', GIT_COMMITTER_DATE: '2026-09-20T12:00:00Z' },
  });
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 'torch-test@example.invalid']);
  git(['config', 'user.name', 'TORCH Test']);
  writeFileSync(join(root, 'app.js'), 'export const value = 1;\n');
  git(['add', '.']); git(['commit', '-m', 'fixture']);
  const repository = inspectRepository(root);
  const proposal = proposeDomains({ repository, analysis: analyzeRepository(repository) });
  proposal.review = { status: 'approved', reviewedAt: now().toISOString(), reviewedBy: 'owner', notes: [] };
  const env = { ...process.env, XDG_DATA_HOME: join(tmpdir(), `${basename(root)}-state`) };
  installProject({ repository, proposal, env, projectId: 'digest-fixture' });
  git(['add', '.torch']); git(['commit', '-m', 'install']);
  createWorktrees({ repository: inspectRepository(root), parentOverride: join(tmpdir(), `${basename(root)}-trees`) });
  git(['add', '.torch/install-manifest.json']); git(['commit', '-m', 'worktrees']);
  const control = openControlPlane({ repositoryRoot: root, env, clock: now });
  const backlog = new BacklogService({ repositoryRoot: root, controlPlane: control, clock: () => new Date('2026-09-20T12:00:00Z') });
  return { root, env, control, backlog, worker: proposal.domains[0].id };
}

test('SCN-owner-digest: read-only owner-first report distinguishes implementation from shipping, neglect from unknown coverage and escapes project text', async (t) => {
  const context = fixture();
  const task = context.backlog.createOwner({ actorId: 'owner', title: '<script>alert(1)</script> [bad](javascript:evil)',
    description: 'Owner request', acceptanceCriteria: ['review'], affectedDomains: [context.worker] });
  const approval = context.control.requestApproval({ requester: context.worker, approver: 'owner', task: task.id,
    title: 'Approve direction', summary: 'Owner decision needed' });
  context.control.requestApproval({ requester: context.worker, approver: 'session-manager', title: 'Manager approval', summary: 'Not owner approval' });
  const delivery = new DeliveryService({ repositoryRoot: context.root, controlPlane: context.control, clock: now });
  delivery.create({ sourceArea: context.worker, label: 'Implementation only', evidence: ['source'] });
  const service = new OwnerDigestService({ repositoryRoot: context.root, controlPlane: context.control, backlogService: context.backlog, clock: now });
  const before = JSON.stringify(context.backlog.list());
  const auditCount = context.control.database.prepare('SELECT COUNT(*) AS count FROM audit_events').get().count;
  const report = service.build();
  assert.equal(report.needsOwner.items[0].id, approval.id);
  assert.equal(report.needsOwner.count, 1);
  assert.equal(report.shipped.count, 0);
  assert.equal(report.neglectedRequests.items[0].taskId, task.id);
  assert.equal(report.lastDeployment, null);
  assert.equal(report.mutationPerformed, false);
  assert.ok(report.markdown.indexOf('## Needs you') < report.markdown.indexOf('## Shipped'));
  assert.doesNotMatch(report.markdown, /<script>|\[bad\]\(javascript:/);
  assert.match(report.markdown, /not independently live verified/);
  assert.equal(JSON.stringify(context.backlog.list()), before);
  assert.equal(context.control.database.prepare('SELECT COUNT(*) AS count FROM audit_events').get().count, auditCount);
  assert.equal(service.latest(), null);
  const bounded = service.build({ maxItems: 1, maxCommits: 1 });
  assert.equal(bounded.activityCoverage.complete, false);
  assert.equal(bounded.neglectedRequests.count, 0, 'partial Git history cannot declare owner requests neglected');
  assert.throws(() => service.publish({ actorId: context.worker, approved: true }), (error) => error.code === 'DIGEST_AUTHORITY_REQUIRED');
  assert.throws(() => service.publish({ actorId: 'owner' }), (error) => error.code === 'APPROVAL_REQUIRED');
  const published = service.publish({ actorId: 'owner', approved: true });
  assert.equal(published.report.needsOwner.count, 1);
  context.control.close();
  const reopened = openControlPlane({ repositoryRoot: context.root, env: context.env });
  assert.equal(new OwnerDigestService({ repositoryRoot: context.root, controlPlane: reopened }).latest().id, published.id);
  reopened.close();
  const cli = spawnSync(process.execPath, [CLI, 'digest', 'latest', '--json'], { cwd: context.root, env: context.env, encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr + cli.stdout);
  assert.equal(JSON.parse(cli.stdout).id, published.id);
  const server = createConsoleServer({ repositoryRoot: context.root, env: context.env });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const endpoint = `http://127.0.0.1:${server.address().port}/api/digest`;
  const response = await fetch(endpoint);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).id, published.id);
  assert.equal((await fetch(endpoint, { method: 'POST' })).status, 405);
});

test('SCN-owner-digest-schedule: configurable local publication requires owner-approved scheduling and creates no agent wake or external send', () => {
  const context = fixture();
  const path = join(context.root, '.torch', 'torch.yaml');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  config.owner_digest = { enabled: true, window_hours: 24, max_items: 10 };
  config.schedules.push({ id: 'owner-daily', title: 'Owner daily digest', owner: 'owner', lifetime: 'system',
    trigger: { type: 'cron', expression: '12 8 * * *' }, behavior: 'coordination', action: { type: 'owner-digest' },
    required_authority: ['owner'], retry: { max_attempts: 1 }, source_of_truth: 'project owner-digest policy' });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  let executed = 0;
  const schedules = new ScheduleService({ repositoryRoot: context.root, controlPlane: context.control,
    clock: now, executor: () => { executed += 1; throw new Error('No external command'); },
    wakeManager: () => { executed += 1; throw new Error('No AI wake'); } });
  assert.throws(() => schedules.run({ scheduleId: 'owner-daily', actorId: 'owner' }), (error) => error.code === 'APPROVAL_REQUIRED');
  const result = schedules.run({ scheduleId: 'owner-daily', actorId: 'owner', approved: true });
  assert.equal(result.result, 'succeeded', result.stderr);
  assert.equal(executed, 0);
  const digest = new OwnerDigestService({ repositoryRoot: context.root, controlPlane: context.control });
  assert.equal(digest.latest().report.window.hours, 24);
  config.owner_digest.enabled = false;
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  const revoked = schedules.plan({ scheduleId: 'owner-daily', actorId: 'owner' });
  assert.equal(revoked.canRun, false, 'current policy revocation is honored');
  assert.ok(revoked.blockers.includes('owner-digest-disabled'));
  context.control.close();
});

test('SCN-owner-digest-receipts: receipt windows and truncation are explicit, unresolved latest deploy is not reported live, and publication failure rolls back', () => {
  const context = fixture();
  const delivery = new DeliveryService({ repositoryRoot: context.root, controlPlane: context.control, clock: now });
  const shipped = delivery.create({ sourceArea: context.worker, label: 'Recorded prior deploy', evidence: ['fixture source'] });
  const waiting = delivery.create({ sourceArea: context.worker, label: 'Uncertain later deploy', evidence: ['fixture source'] });
  // Seed recorded history, not actual external qualification; delivery scenarios
  // independently prove lifecycle authority and adapter receipts.
  context.control.database.prepare("UPDATE deliveries SET state = 'deployed' WHERE id = ?").run(shipped.id);
  context.control.database.prepare("UPDATE deliveries SET state = 'released' WHERE id = ?").run(waiting.id);
  const insertEvent = context.control.database.prepare(`INSERT INTO delivery_events
    (id, delivery_id, from_state, to_state, actor, created_at, evidence_json, adapter_receipt_json)
    VALUES (?, ?, 'released', 'deployed', 'owner', ?, '[]', '{"status":"succeeded","reference":"fixture-only"}')`);
  insertEvent.run('recent-event', shipped.id, '2026-09-30T07:00:00Z');
  insertEvent.run('old-event', shipped.id, '2026-09-25T07:00:00Z');
  insertEvent.run('future-event', shipped.id, '2026-10-01T07:00:00Z');
  context.control.database.prepare(`INSERT INTO delivery_operations
    (id, delivery_id, commit_sha, from_state, target_state, actor, provider, operation, policy_hash, state, created_at, updated_at, evidence_json)
    VALUES ('uncertain-deploy', ?, ?, 'released', 'deployed', 'owner', 'fixture', 'deploy', 'fixture-hash', 'unknown', ?, ?, '[]')`)
    .run(waiting.id, waiting.commit, '2026-09-30T08:00:00Z', '2026-09-30T08:01:00Z');
  const checks = new CheckService({ repositoryRoot: context.root, controlPlane: context.control });
  new IntegrationService({ repositoryRoot: context.root, controlPlane: context.control, checkService: checks });
  context.control.database.prepare(`INSERT INTO integration_requests
    (id, project_id, source_area, source_branch, source_commit, target_branch, base_target_commit, state,
      required_checks, created_at, updated_at, landed_at)
    VALUES ('recorded-land', ?, ?, 'fixture', ?, 'main', ?, 'landed', '[]', ?, ?, ?)`)
    .run(context.control.projectId, context.worker, shipped.commit, shipped.commit,
      '2026-09-30T06:00:00Z', '2026-09-30T06:00:00Z', '2026-09-30T06:00:00Z');
  const decided = context.control.requestApproval({ requester: context.worker, approver: 'owner', title: 'Recorded decision', summary: 'Review' });
  context.control.decideApproval({ decidedBy: 'owner', approvalId: decided.id, expectedRevision: 1, decision: 'approved', note: 'Accepted' });
  for (const title of ['First wait', 'Second wait']) context.control.requestApproval({ requester: context.worker, approver: 'owner', title, summary: 'Review' });
  const service = new OwnerDigestService({ repositoryRoot: context.root, controlPlane: context.control, clock: now });
  const report = service.build({ maxItems: 1 });
  assert.equal(report.shipped.count, 1);
  assert.equal(report.shipped.items[0].id, 'recent-event');
  assert.equal(report.shipped.items[0].label, 'Recorded prior deploy');
  assert.equal(report.landed.count, 1);
  assert.equal(report.lastDeployment.state, 'unknown');
  assert.equal(report.lastDeployment.failureReason, 'No terminal receipt');
  assert.equal(report.deliveryReview.items[0].id, 'uncertain-deploy');
  assert.equal(report.decisions.count, 1);
  assert.equal(report.needsOwner.count, 2);
  assert.equal(report.needsOwner.truncated, true);
  assert.match(report.markdown, /Showing 1 of 2/);
  const audit = context.control.audit.bind(context.control);
  context.control.audit = (entry) => {
    if (entry.operation === 'owner-digest.publish') throw new Error('Local report storage failed');
    return audit(entry);
  };
  assert.throws(() => service.publish({ actorId: 'owner', approved: true }), /Local report storage failed/);
  assert.equal(service.latest(), null);
  context.control.audit = audit;
  context.control.close();
});
