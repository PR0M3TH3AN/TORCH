import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createConsoleServer } from '../../src/console/server.mjs';
import { openControlPlane } from '../../src/control-plane/service.mjs';
import { analyzeRepository } from '../../src/kernel/analyze.mjs';
import { proposeDomains } from '../../src/kernel/domains.mjs';
import { diagnoseProject } from '../../src/kernel/doctor.mjs';
import { inspectRepository } from '../../src/kernel/git.mjs';
import { installProject } from '../../src/kernel/install.mjs';
import { organizationGraphFromConfig } from '../../src/kernel/organization.mjs';
import { createWorktrees } from '../../src/kernel/worktrees.mjs';
import { observeProject } from '../../src/observability/snapshot.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'torch-console-'));
  execFileSync('git', ['init', '-b', 'main', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'torch-test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'TORCH Test']);
  writeFileSync(join(root, 'README.md'), '# Console fixture\n');
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'fixture']);
  return root;
}

test('SCN-product-site / SCN-dashboard-demo / SCN-torch-brand-surface: public site opens the real Console in a separate demo workspace', () => {
  const html = readFileSync(new URL('../../site/index.html', import.meta.url), 'utf8');
  const demoHtml = readFileSync(new URL('../../site/demo.html', import.meta.url), 'utf8');
  const consoleHtml = readFileSync(new URL('../../site/console.html', import.meta.url), 'utf8');
  const consoleScript = readFileSync(new URL('../../site/console.js', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../../site/styles.css', import.meta.url), 'utf8');
  const torchMark = readFileSync(new URL('../../site/torch-mark.svg', import.meta.url), 'utf8');
  assert.match(html, /<title>TORCH — an AI fleet shaped by your project<\/title>/);
  assert.match(html, /An AI team shaped by your project/);
  assert.match(html, /Codex, Claude, Pi, or another local runtime for each role/);
  assert.match(html, /href="\/console\.html\?demo=1" target="_blank" rel="noopener">View dashboard demo/);
  assert.doesNotMatch(html, /in a new tab/i);
  assert.doesNotMatch(html, /dashboard-demo-section|demo-tab-overview/);
  assert.match(demoHtml, /<title>TORCH Dashboard<\/title>/);
  assert.match(demoHtml, /<meta name="robots" content="noindex,nofollow">/);
  assert.match(demoHtml, /url=\/console\.html\?demo=1/);
  assert.match(consoleHtml, /id="demo-banner"[\s\S]*Sample project · Changes stay in this tab/);
  assert.match(html, /id="route-toggle"/);
  assert.match(html, /Your runtime for each session/);
  assert.match(html, /authorized, serialized path/);
  assert.match(html, /Codex, Claude, Pi, and local adapters[\s\S]*Live provider gate open/);
  assert.match(html, /Lower cache and context costs are a hypothesis/);
  assert.match(html, /torch bootstrap/);
  assert.doesNotMatch(html, /node bin\/torch\.mjs/);
  assert.match(html, /Isolated candidate checks[\s\S]*Clean install gate open/);
  assert.match(html, /data-label="Evidence"/);
  assert.match(html, /As coordination grows[\s\S]*approve every organization change/i);
  assert.doesNotMatch(html, /Request CR-184|terrain streaming|Terrain specialist/);
  assert.doesNotMatch(html, /nostr|relay coordination|task lock/i);
  assert.match(consoleHtml, /Local Fleet Console/);
  assert.match(html, /rel="icon" type="image\/svg\+xml" href="\/torch-mark\.svg"/);
  assert.match(consoleHtml, /src="\/torch-mark\.svg"/);
  assert.match(styles, /color-scheme: dark/);
  const landingScript = readFileSync(new URL('../../site/app.js', import.meta.url), 'utf8');
  const demoScript = readFileSync(new URL('../../site/demo.js', import.meta.url), 'utf8');
  assert.match(consoleHtml, /src="\/demo\.js"/);
  assert.match(demoScript, /TorchConsoleDemo = createWorkspace/);
  assert.doesNotMatch(landingScript, /data-demo-tab/);
  assert.doesNotMatch(demoScript, /fetch\s*\(|XMLHttpRequest/);
  assert.doesNotMatch(landingScript, /fetch\s*\(|XMLHttpRequest/);
  assert.match(torchMark, /linearGradient id="flameGrad"/);
  assert.match(consoleHtml, /noindex,nofollow/);
  assert.match(consoleHtml, /console-rail/);
  assert.match(consoleHtml, /id="backlog-board"/);
  assert.match(consoleHtml, /id="attention-list"/);
  assert.match(consoleHtml, /src="\/attention-actions\.js" defer/);
  assert.match(consoleScript, /data-attention-decision/);
  assert.match(consoleScript, /data-approval-preview/);
  assert.match(consoleHtml, /id="artifact-list"/);
  assert.match(consoleHtml, /id="organization-map"/);
  assert.match(consoleHtml, /id="organization-lifecycle"/);
  assert.match(consoleHtml, /id="organization-proposals"/);
  assert.match(consoleHtml, /id="organization-action-status"/);
  assert.match(consoleHtml, /id="owner-request-form"/);
  assert.match(consoleHtml, /will not create a task, change ownership, or wake\/start the agent/);
  assert.match(consoleHtml, /id="owner-request-action-status"/);
  assert.match(consoleHtml, /Feedback is previewed with its identity/);
  assert.match(consoleHtml, /id="work-view-select"/);
  assert.match(consoleHtml, /id="work-view-save"/);
  assert.match(consoleHtml, /filters never change tasks/);
  assert.match(consoleHtml, /id="initiative-progress"/);
  assert.match(consoleHtml, /data-schedule-launcher/);
  assert.match(consoleHtml, /data-schedule-launcher-preview/);
  assert.match(consoleHtml, /data-schedule-launcher-confirm/);
  assert.match(consoleHtml, /A schedule with provider wake enabled may invoke its selected local agent/);
  assert.match(consoleHtml, /Feature and milestone progress/);
  assert.match(consoleHtml, /FIFO queue · source commit/);
  assert.match(consoleHtml, /owner-control-note/);
  assert.match(consoleHtml, /Create a task proposal/);
  assert.match(consoleHtml, /Session Manager still owns triage and assignment/);
  assert.match(consoleHtml, /gates remain separate/);
  assert.match(consoleScript, /artifact-feedback/);
  assert.match(consoleScript, /feedback\/preview/);
  assert.match(consoleScript, /data-feedback-confirm/);
  assert.match(consoleScript, /snapshot\.backlogHealth/);
  assert.match(consoleScript, /backlog\/tasks\/preview/);
  assert.match(consoleScript, /data-task-create-confirm/);
  assert.match(consoleScript, /Evidence needs refresh/);
  assert.match(consoleScript, /queueOrder/);
  assert.match(consoleScript, /Awaiting checks or landing review/);
  assert.match(consoleScript, /initializeSavedViews/);
  assert.match(consoleScript, /data-review-preview/);
  assert.match(consoleScript, /data-review-confirm/);
  assert.match(consoleScript, /data-hierarchy-activation-preview/);
  assert.match(consoleScript, /data-hierarchy-activation-confirm/);
  assert.match(consoleScript, /activate\/preview/);
  assert.match(consoleScript, /Commit pilot activation/);
  assert.match(consoleScript, /renderLifecycleOrder/);
  assert.match(consoleScript, /managers first/);
  assert.match(consoleScript, /reports before managers/);
  assert.match(consoleScript, /api\/owner-requests\/preview/);
  assert.match(consoleScript, /api\/owner-requests'/);
  assert.match(consoleHtml, /Send durable request/);
  assert.match(styles, /\.owner-request-preview/);
  const consoleServer = readFileSync(new URL('../../src/console/server.mjs', import.meta.url), 'utf8');
  assert.match(consoleServer, /HIERARCHY_ACTIVATION_PREVIEW_STALE/);
  assert.match(consoleServer, /hierarchy\.activatePilot/);
  assert.match(consoleServer, /does not create or start identities, launch an AI runtime, or change user systemd state/);
  assert.match(consoleServer, /sendOwnerRequest/);
  assert.match(styles, /\.organization-review-preview/);
  assert.match(styles, /\.lifecycle-orders/);
  assert.match(styles, /\.lifecycle-blockers/);
  const workViewsScript = readFileSync(new URL('../../site/work-views.js', import.meta.url), 'utf8');
  assert.match(workViewsScript, /torch\.dev\/console-saved-views/);
  assert.match(workViewsScript, /completed', 'cancelled/);
  const workProgressScript = readFileSync(new URL('../../site/work-progress.js', import.meta.url), 'utf8');
  assert.match(workProgressScript, /summarizeInitiatives/);
  assert.match(workProgressScript, /At risk/);
  assert.match(workProgressScript, /cancelled/);
  for (const action of [
    'data-runtime-profile-preview', 'data-runtime-profile-confirm', 'data-runtime-profile-edit',
  ]) assert.match(consoleHtml, new RegExp(`<button[^>]*${action}`));
  assert.equal((consoleHtml.match(/<button\b[^>]*data-runtime-profile-/g) ?? []).length, 3);
  assert.match(styles, /@media \(max-width: 600px\)/);
  for (const label of ['Ownership', 'Organization map', 'Organization proposals', 'Worktrees', 'Delivery', 'Checks', 'Schedules', 'Providers', 'Decisions']) {
    assert.match(consoleHtml, new RegExp(`>${label}<`));
  }
});

test('SCN-architecture-decisions: every specification decision has an explicit accepted or gated boundary', () => {
  const decisions = readFileSync(new URL('../../docs/ARCHITECTURE_DECISIONS.md', import.meta.url), 'utf8');
  const spec = readFileSync(new URL('../../docs/PORTABLE_AGENT_FLEET_SPEC.md', import.meta.url), 'utf8');
  for (let number = 1; number <= 21; number += 1) {
    assert.match(decisions, new RegExp(`ADR-${String(number).padStart(3, '0')}:`));
  }
  assert.match(decisions, /Multi-machine security[\s\S]*\*\*Status:\*\* gated/);
  assert.match(decisions, /Distribution and update signing[\s\S]*\*\*Status:\*\* gated/);
  assert.match(decisions, /MCP over\s+stdio/);
  assert.match(decisions, /exact Git commit and the exact hash/);
  assert.match(decisions, /Project-specific coordination hierarchy[\s\S]*\*\*Status:\*\* gated/);
  assert.match(decisions, /headcount\s+alone must never trigger an added management layer/);
  assert.match(decisions, /ADR-013: Repository analysis snapshot and approval freshness[\s\S]*working-tree fingerprint/);
  assert.match(decisions, /ADR-014: Local visual evidence and owner feedback[\s\S]*single-use, five-minute token/);
  assert.match(decisions, /ADR-017: Preview-confirmed owner priority changes[\s\S]*revision-bound single-use preview/);
  assert.match(decisions, /ADR-018: Preview-confirmed owner task proposals[\s\S]*proposed.*unassigned/);
  assert.match(decisions, /ADR-019: Serialized canonical integration[\s\S]*cross-process/);
  assert.match(decisions, /ADR-020: Current instruction rehydration on every resume[\s\S]*canonical project checkout/);
  assert.match(decisions, /ADR-021: Hierarchy-aware manager check-ins[\s\S]*Installing a persistent timer and live provider qualification\s+remain gated/);
  assert.match(spec, /same-origin loopback requests[\s\S]*single-use preview/);
  assert.match(spec, /Optional coordination hierarchy/);
  assert.match(spec, /existing single backlog remains the task ledger and queue/);
  assert.match(spec, /COMBATRIG example, not a default organization/);
  assert.match(spec, /The growth pathway MUST be an explicit, durable lifecycle/);
  assert.match(spec, /No repeated assessment should create or repeatedly resend the same proposal/);
  assert.match(spec, /owner-facing organization proposal/);
  assert.match(spec, /bounded pilot/);
  assert.match(spec, /unignored, non-symlink regular files that are not yet tracked/);
  assert.match(spec, /recompute\s+that fingerprint/);
  assert.match(spec, /The initial local artifact catalog stores bounded PNG/);
  assert.match(spec, /Feedback is\s+stored in the durable message stream/);
  assert.match(spec, /owner Console MAY also let the owner send a bounded request[\s\S]*one ordinary durable inbox message/);
  assert.match(spec, /MUST NOT create or change a task, transfer ownership, change presence, wake/);
});

test('SCN-console-readonly / SCN-console-manager-check-ins: HTTP console observes approvals and manager flows without mutation', async (context) => {
  const root = fixture();
  const env = { ...process.env, XDG_DATA_HOME: mkdtempSync(join(tmpdir(), 'torch-console-state-')) };
  const intake = observeProject({ repositoryRoot: root, env });
  assert.equal(intake.organization.status, 'not-installed');
  assert.equal(intake.organization.graph, null);
  const repository = inspectRepository(root);
  const proposal = proposeDomains({ repository, analysis: analyzeRepository(repository) });
  proposal.review = {
    status: 'approved', reviewedAt: '2026-09-27T00:00:00Z', reviewedBy: 'fixture-owner', notes: [],
  };
  installProject({ repository, proposal, env, projectId: 'console-fixture' });
  execFileSync('git', ['-C', root, 'add', '.torch']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'install torch']);
  const createdWorktrees = createWorktrees({
    repository: inspectRepository(root),
    parentOverride: mkdtempSync(join(tmpdir(), 'torch-console-worktrees-')),
  });
  execFileSync('git', ['-C', root, 'add', '.torch/install-manifest.json']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'record worktrees']);
  const managerWorktree = createdWorktrees.created.find((entry) => entry.area === 'session-manager').path;
  writeFileSync(join(managerWorktree, '.torch', 'backlog', 'TASK-CONSOLE.json'), `${JSON.stringify({
    id: 'TASK-CONSOLE', title: 'Expose provenance on work cards',
    description: 'Show task acceptance and commit context in the local board.',
    state: 'in_progress', owner: proposal.domains[0].id, priority: 'high',
    feature: 'Console review', milestone: 'Owner preview',
    affectedDomains: [proposal.domains[0].id], dependencies: ['TASK-BASE'],
    acceptanceCriteria: ['Task status is visible.', 'Commit provenance is visible.'],
    evidence: [], commit: null, observedAt: 'abcdef1234567890',
    createdAt: '2026-09-27T00:00:00Z', updatedAt: '2026-09-27T00:00:00Z', revision: 2,
    history: [{ actorId: 'owner', at: '2026-09-27T00:00:00Z', to: 'proposed' }],
  }, null, 2)}\n`);
  const databasePath = join(env.XDG_DATA_HOME, 'torch', 'projects', 'console-fixture', 'state.db');
  assert.equal(existsSync(databasePath), false);
  const before = execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' });
  const observed = observeProject({ repositoryRoot: root, env, now: () => new Date('2026-09-27T00:00:00Z') });
  assert.equal(observed.mode, 'installed');
  assert.equal(observed.mutationPerformed, false);
  assert.equal(observed.agents.length, proposal.domains.length + 1);
  assert.equal(Object.hasOwn(observed.agents[0], 'reasoning'), true);
  assert.equal(observed.organization.domains.length, proposal.domains.length);
  assert.equal(observed.organization.status, 'active');
  assert.equal(observed.organization.graph.schema, 'torch.dev/organization/v1alpha1');
  assert.equal(observed.organization.graph.roles.length, proposal.domains.length + 2);
  assert.ok(observed.organization.graph.roles.some((role) => role.kind === 'owner'));
  assert.equal(observed.organization.lifecycle.mutationPerformed, false);
  assert.deepEqual(observed.organization.lifecycle.startupOrder[0], 'session-manager');
  assert.deepEqual(observed.organization.lifecycle.shutdownOrder, [...observed.organization.lifecycle.startupOrder].reverse());
  assert.deepEqual(observed.organization.lifecycle.blockers, []);
  assert.deepEqual(observed.organization.lifecycle.managerIdsByIdentity[proposal.domains[0].id], ['session-manager']);
  assert.equal(observed.worktrees.length, proposal.domains.length + 1);
  assert.equal(observed.worktrees.every((worktree) => Number.isInteger(worktree.behind)), true);
  assert.equal(observed.recoverability.level, 'ONE-DISK');
  assert.match(observed.decisions.content, /TORCH decisions/);
  assert.equal(observed.providers.forge.status, 'local-only');
  assert.equal(observed.providers.delivery.release.provider, 'none');
  assert.deepEqual(observed.deliveries, []);
  assert.equal(observed.backlog[0].id, 'TASK-CONSOLE');
  assert.equal(observed.backlogActivity.available, true);
  assert.equal(observed.backlogActivity.tasks.find((task) => task.taskId === 'TASK-CONSOLE').ownerRequested, true);
  assert.equal(observed.backlog[0].createdAt, '2026-09-27T00:00:00Z');
  assert.deepEqual(observed.backlog[0].dependencies, ['TASK-BASE']);
  assert.equal(observed.backlog[0].priority, 'high');
  assert.equal(observed.backlogHealth.mutationPerformed, false);
  assert.equal(observed.backlogHealth.findings.some((finding) =>
    finding.code === 'BACKLOG_OBSERVED_COMMIT_MISSING' && finding.taskId === 'TASK-CONSOLE'), true,
  'an unreachable observedAt commit is surfaced as stale evidence without mutating the task');
  assert.equal(observed.artifacts.available, false);
  assert.deepEqual(observed.hierarchyProposals, []);
  assert.equal(observed.contextLocality.measured, false);
  assert.deepEqual(observed.fleetChanges, []);
  assert.equal(existsSync(databasePath), false);
  assert.equal(execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }), before);

  const control = openControlPlane({ repositoryRoot: root, env });
  control.reportStatus({
    areaId: proposal.domains[0].id, state: 'waiting', summary: 'Waiting for owner direction.', task: 'TASK-CONSOLE',
  });
  const approval = control.requestApproval({
    requester: proposal.domains[0].id, approver: 'owner', task: 'TASK-CONSOLE',
    title: 'Confirm review scope', summary: 'This choice changes the planned owner review scope.', evidence: 'TASK-CONSOLE acceptance criteria',
  });
  control.close();
  const approvalSnapshot = observeProject({ repositoryRoot: root, env, now: () => new Date('2026-09-27T00:00:00Z') });
  assert.equal(approvalSnapshot.mutationPerformed, false);
  assert.equal(approvalSnapshot.approvalRequests.available, true);
  assert.equal(approvalSnapshot.approvalRequests.pendingCount, 1);
  assert.equal(approvalSnapshot.approvalRequests.items[0].id, approval.id);
  const managerView = approvalSnapshot.managerCheckIns.managers.find((entry) => entry.managerId === 'session-manager');
  assert.equal(managerView.attentionRequired, true);
  assert.equal(managerView.directReports.find((entry) => entry.areaId === proposal.domains[0].id).state, 'waiting');
  assert.equal(managerView.approvalWaits[0].approverKind, 'owner');
  assert.equal(managerView.timerStatus, 'installation-not-verified');
  assert.equal(execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }), before);

  const server = createConsoleServer({ repositoryRoot: root, env });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(`${origin}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(await page.text(), /An AI team shaped by your project/);
  const consolePage = await fetch(`${origin}/console`);
  assert.equal(consolePage.status, 200);
  const consoleHtml = await consolePage.text();
  assert.match(consoleHtml, /id="backlog-board"/);
  assert.match(consoleHtml, /id="flow-watch"/);
  assert.match(consoleHtml, /id="manager-checkin-list"/);
  assert.match(consoleHtml, /id="approval-request-list"/);
  assert.match(consoleHtml, /configured cadence does not confirm that a system timer is installed/);
  assert.match(consoleHtml, /Owner decisions gated/);
  assert.match(consoleHtml, /Owner-addressed requests have a review-and-confirm flow/);
  const consoleScript = readFileSync(new URL('../../site/console.js', import.meta.url), 'utf8');
  assert.match(consoleScript, /data-approval-preview/);
  assert.match(consoleScript, /data-approval-confirm/);
  assert.match(consoleScript, /api\/approvals\/.*decision\/preview/);
  const consoleServer = readFileSync(new URL('../../src/console/server.mjs', import.meta.url), 'utf8');
  assert.match(consoleServer, /APPROVAL_DECISION_PREVIEW_STALE/);
  assert.match(consoleServer, /APPROVER_AUTHORITY_REQUIRED/);
  const logo = await fetch(`${origin}/torch-mark.svg`);
  assert.equal(logo.status, 200);
  assert.match(await logo.text(), /flameGrad/);
  assert.match(consoleHtml, /work-views\.js/);
  assert.match(consoleHtml, /work-progress\.js/);
  const workViewsAsset = await fetch(`${origin}/work-views.js`);
  assert.equal(workViewsAsset.status, 200);
  assert.match(await workViewsAsset.text(), /console-saved-views/);
  const workProgressAsset = await fetch(`${origin}/work-progress.js`);
  assert.equal(workProgressAsset.status, 200);
  assert.match(await workProgressAsset.text(), /TorchWorkProgress/);
  const snapshot = await fetch(`${origin}/api/snapshot`);
  assert.equal(snapshot.status, 200);
  const data = await snapshot.json();
  assert.equal(data.mutationPerformed, false);
  assert.equal(data.backlogActivity.available, true);
  assert.equal(data.backlogActivity.tasks.find((task) => task.taskId === 'TASK-CONSOLE').ownerRequested, true);
  assert.equal(data.organization.graph.revision, 1);
  assert.equal(data.approvalRequests.pendingCount, 1);
  assert.equal(data.managerCheckIns.managers.find((entry) => entry.managerId === 'session-manager')
    .approvalWaits[0].approverKind, 'owner');
  assert.equal(data.backlogHealth.findings.some((finding) =>
    finding.code === 'BACKLOG_OBSERVED_COMMIT_MISSING' && finding.taskId === 'TASK-CONSOLE'), true);
  assert.deepEqual(data.backlog[0].dependencies, ['TASK-BASE']);
  assert.equal(data.backlog[0].feature, 'Console review');
  assert.equal(data.backlog[0].milestone, 'Owner preview');
  assert.equal(data.artifacts.available, false);
  const refusedWrite = await fetch(`${origin}/api/snapshot`, { method: 'POST' });
  assert.equal(refusedWrite.status, 405);
  assert.equal((await fetch(`${origin}/../package.json`)).status, 404);
  assert.equal(execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }), before);
});

test('SCN-doctor-organization-identities: missing role identities are explicit and never synthesized', () => {
  const root = fixture();
  const env = { ...process.env, XDG_DATA_HOME: mkdtempSync(join(tmpdir(), 'torch-org-doctor-state-')) };
  const repository = inspectRepository(root);
  const proposal = proposeDomains({ repository, analysis: analyzeRepository(repository) });
  proposal.review = {
    status: 'approved', reviewedAt: '2026-09-27T00:00:00Z', reviewedBy: 'fixture-owner', notes: [],
  };
  installProject({ repository, proposal, env, projectId: 'organization-doctor-fixture' });
  const configPath = join(root, '.torch', 'torch.yaml');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const graph = organizationGraphFromConfig(config);
  graph.roles.push({
    id: 'uninstalled-coordinator', title: 'Uninstalled Coordinator', kind: 'domain-coordination',
    identity_id: 'uninstalled-coordinator', responsibilities: ['Coordinate a future domain.'],
    authority: ['coordinate-domains'], coordinates: [], reports_to: ['session-manager'], consults_with: [],
  });
  config.organization = graph;
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const diagnosis = diagnoseProject({ repository: inspectRepository(root), env });
  const finding = diagnosis.findings.find((item) => item.code === 'ORGANIZATION_IDENTITY_MISSING');
  assert.equal(finding?.severity, 'error');
  assert.deepEqual(finding?.identities, ['uninstalled-coordinator']);
  assert.equal(diagnosis.findings.some((item) => item.code === 'ORGANIZATION_GRAPH_INVALID'), false);
});

test('SCN-console-lifecycle-blockers: observation surfaces identity cycles without mutation', () => {
  const root = fixture();
  const env = { ...process.env, XDG_DATA_HOME: mkdtempSync(join(tmpdir(), 'torch-lifecycle-state-')) };
  const repository = inspectRepository(root);
  const proposal = proposeDomains({ repository, analysis: analyzeRepository(repository) });
  proposal.review = {
    status: 'approved', reviewedAt: '2026-09-27T00:00:00Z', reviewedBy: 'fixture-owner', notes: [],
  };
  installProject({ repository, proposal, env, projectId: 'console-lifecycle-cycle-fixture' });
  const configPath = join(root, '.torch', 'torch.yaml');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const graph = organizationGraphFromConfig(config);
  const report = graph.roles.find((role) => role.kind === 'specialist');
  graph.roles.push({
    id: 'session-manager-secondary', title: 'Session Manager Operations', kind: 'fleet-operations',
    identity_id: 'session-manager', responsibilities: ['Coordinate reporting handoffs.'],
    authority: ['operate-fleet'], coordinates: [], reports_to: [report.id], consults_with: [],
  });
  config.organization = graph;
  const managerSchedule = structuredClone(config.schedules.find((schedule) =>
    schedule.action.type === 'manager-check-in'));
  managerSchedule.id = `${report.identity_id}-check-in`;
  managerSchedule.title = `${report.title} check-in`;
  managerSchedule.owner = report.identity_id;
  managerSchedule.action.manager_id = report.identity_id;
  config.schedules.push(managerSchedule);
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const observed = observeProject({ repositoryRoot: root, env });
  assert.equal(observed.mutationPerformed, false);
  assert.equal(observed.organization.lifecycle.mutationPerformed, false);
  assert.equal(observed.organization.lifecycle.blockers.some((blocker) =>
    blocker.code === 'FLEET_STARTUP_IDENTITY_CYCLE' && blocker.areaIds.includes(report.identity_id)), true);
});
