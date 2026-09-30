import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { openControlPlane } from '../../src/control-plane/service.mjs';
import { BacklogService } from '../../src/backlog/service.mjs';
import { observeProject } from '../../src/observability/snapshot.mjs';
import { HierarchyEvolutionService } from '../../src/evolution/hierarchy.mjs';
import { FleetEvolutionService } from '../../src/evolution/service.mjs';
import { createConsoleServer } from '../../src/console/server.mjs';
import { organizationGraphFromConfig } from '../../src/kernel/organization.mjs';
import { loadProjectConfig } from '../../src/kernel/config.mjs';
import { inspectRepository } from '../../src/kernel/git.mjs';
import { installProject } from '../../src/kernel/install.mjs';
import { createWorktrees } from '../../src/kernel/worktrees.mjs';
import { analyzeRepository } from '../../src/kernel/analyze.mjs';
import { proposeDomains } from '../../src/kernel/domains.mjs';
import { callTorchTool } from '../../src/mcp/tools.mjs';
import { ScheduleLauncherService } from '../../src/schedules/launcher.mjs';

const CLI = fileURLToPath(new URL('../../bin/torch.mjs', import.meta.url));

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'torch-hierarchy-'));
  const worktreeParent = mkdtempSync(join(tmpdir(), 'torch-hierarchy-worktrees-'));
  const env = { ...process.env, XDG_DATA_HOME: mkdtempSync(join(tmpdir(), 'torch-hierarchy-state-')) };
  execFileSync('git', ['init', '-b', 'main', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'torch-test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'TORCH Test']);
  writeFileSync(join(root, 'app.js'), 'export const app = true;\n');
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'fixture']);
  const repository = inspectRepository(root);
  const proposal = proposeDomains({ repository, analysis: analyzeRepository(repository) });
  proposal.paths = { worktree_parent: worktreeParent };
  proposal.review = {
    status: 'approved', reviewedAt: '2026-09-01T00:00:00Z', reviewedBy: 'fixture-owner', notes: [],
  };
  installProject({ repository, proposal, env, projectId: 'hierarchy-fixture' });
  execFileSync('git', ['-C', root, 'add', '.torch']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'install torch']);
  return { root, env };
}

function proposalFor(config, { addDomainManager = false } = {}) {
  const current = organizationGraphFromConfig(config);
  const specialist = current.roles.find((role) => role.kind === 'specialist');
  const graph = {
    ...current,
    revision: current.revision + 1,
    roles: current.roles.map((role) => {
      if (role.id === 'session-manager') return {
        ...role, coordinates: [addDomainManager ? `${specialist.id}-lead` : 'program-director'],
      };
      if (addDomainManager && role.id === specialist.id) {
        return { ...role, reports_to: [`${specialist.id}-lead`] };
      }
      if (role.id === specialist.id) return { ...role, reports_to: ['program-director'] };
      return role;
    }),
  };
  if (addDomainManager) graph.roles.push({
    id: `${specialist.id}-lead`, title: 'Domain Lead', kind: 'domain-coordination',
    identity_id: specialist.id,
    responsibilities: ['Coordinate specialist work and clear direct-report waits.'],
    authority: ['coordinate-domains'], coordinates: [specialist.id], reports_to: ['session-manager'],
    consults_with: ['session-manager', specialist.id],
  });
  else graph.roles.push({
    id: 'program-director', title: 'Program Director', kind: 'program-direction',
    identity_id: 'session-manager',
    responsibilities: ['Sequence project-wide work and summarize cross-domain risks.'],
    authority: ['propose-priorities', 'sequence-domains'],
    coordinates: [specialist.id], reports_to: ['session-manager'], consults_with: [specialist.id],
  });
  return {
    schema: 'torch.dev/hierarchy-proposal/v1alpha1',
    title: 'Pilot project-wide program coordination',
    rationale: 'Repeated cross-domain work is consuming the Session Manager context.',
    observation_window: {
      start_at: '2026-09-01T00:00:00Z', end_at: '2026-09-28T00:00:00Z', days: 27,
      summary: 'Three recurring cross-domain events were observed over four weeks.',
    },
    signals: [
      {
        code: 'recurring-cross-domain-work', summary: 'Several tasks affected the same domains.',
        occurrences: 2, affected_identities: [specialist.id], references: ['TASK-4', 'TASK-9'],
      },
      {
        code: 'late-dependency-decisions', summary: 'Integration decisions repeatedly waited on the manager.',
        occurrences: 1, affected_identities: ['session-manager'], references: ['MSG-12', 'MSG-17'],
      },
    ],
    alternatives: [
      { type: 'no-change', description: 'Keep current flat coordination.', expected_outcome: 'No new management overhead.' },
      { type: 'process-change', description: 'Improve cross-domain backlog sequencing.', expected_outcome: 'May reduce avoidable handoffs.' },
      { type: 'promote-existing', description: 'Promote an existing identity for a bounded pilot.', expected_outcome: 'Adds coordination focus without a new runtime.' },
    ],
    impact: {
      integrated_outcome: 'Cross-domain changes receive timely sequencing and risk ownership.',
      why_existing_roles_are_insufficient: 'Current owner-facing session switches between unrelated domains.',
      expected_benefit: 'Lower coordination wait and retain relevant context in a focused role.',
      added_coordination_cost: 'One role relationship and a weekly review.',
      affected_identities: ['session-manager', specialist.id],
    },
    graph,
    pilot: {
      duration_days: 14,
      baseline_metrics: [{ name: 'cross_domain_wait', value: '3', unit: 'days median' }],
      success_criteria: ['Reduce median cross-domain wait without increasing rework.'],
      stop_criteria: ['Work is delayed by role routing or ownership becomes ambiguous.'],
      reversal_plan: 'Restore the prior organization revision; preserve all existing identities and worktrees.',
    },
  };
}

function hierarchyEvidenceTask(id, createdAt, affectedDomains = ['alpha', 'beta']) {
  return {
    schema: 'torch.dev/backlog-item/v1alpha1', id, title: `Cross-domain integration ${id}`,
    description: 'Recurring integration work used to assess organization pressure.',
    priority: 'normal', affectedDomains, dependencies: [], acceptanceCriteria: ['Both domains verify the interface.'],
    observedAt: '0123456789ab', feature: null, milestone: null, state: 'in_progress', owner: 'alpha',
    evidence: [], commit: null, integrationRequest: null, blockedReason: null,
    createdAt, updatedAt: createdAt, revision: 2,
    history: [
      { from: null, to: 'proposed', actorId: 'session-manager', at: createdAt, note: 'Task created.' },
      { from: 'assigned', to: 'in_progress', actorId: 'alpha', at: createdAt, note: 'Started implementation.' },
    ],
  };
}

test('SCN-hierarchy-proposal: sustained evidence creates a deduplicated owner-review proposal without changing the active organization', () => {
  const context = fixture();
  const beforeConfig = readFileSync(join(context.root, '.torch', 'torch.yaml'), 'utf8');
  const beforeRoster = readFileSync(join(context.root, '.torch', 'roster.yaml'), 'utf8');
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  let sequence = 0;
  const service = new HierarchyEvolutionService({
    repositoryRoot: context.root, controlPlane: control,
    clock: () => new Date('2026-09-28T12:00:00Z'), idFactory: () => `HIER-${++sequence}`,
  });
  const currentConfig = loadProjectConfig(context.root);
  const input = proposalFor(currentConfig);
  assert.throws(() => service.propose({ proposer: 'session-manager', proposal: {
    ...input, signals: input.signals.slice(0, 1).map((signal) => ({ ...signal, occurrences: 1 })),
  } }), (error) => error.code === 'HIERARCHY_PROPOSAL_INVALID');
  assert.throws(() => service.propose({ proposer: input.signals[0].affected_identities[0], proposal: input }),
    (error) => error.code === 'HIERARCHY_PROPOSAL_AUTHORITY_REQUIRED');

  const created = service.propose({ proposer: 'session-manager', proposal: input });
  assert.equal(created.state, 'proposed');
  assert.equal(created.proposal.graph.revision, 2);
  assert.equal(service.propose({ proposer: 'session-manager', proposal: input }).deduplicated, true);
  assert.equal(service.list({ state: 'proposed' }).length, 1);
  assert.throws(() => service.decide({
    proposalId: created.id, decision: 'approve-pilot', decidedBy: 'session-manager',
  }), (error) => error.code === 'HIERARCHY_OWNER_AUTHORITY_REQUIRED');
  assert.equal(service.decide({
    proposalId: created.id, decision: 'approve-pilot', decidedBy: 'owner',
  }).state, 'pilot-approved');
  assert.equal(service.planPilot(created.id).canProceed, true);
  const plan = service.planPilot(created.id);
  assert.equal(plan.canProceed, true);
  assert.equal(plan.mutationPerformed, false);
  assert.equal(plan.graphDelta.addedRoles.includes('program-director'), true);
  assert.deepEqual(plan.managerCheckInSchedules.additions, [],
    'promoting the existing Session Manager identity keeps its existing schedule');
  assert.deepEqual(plan.blockers, []);
  assert.equal(readFileSync(join(context.root, '.torch', 'torch.yaml'), 'utf8'), beforeConfig);
  assert.equal(readFileSync(join(context.root, '.torch', 'roster.yaml'), 'utf8'), beforeRoster);
  control.close();
});

test('SCN-hierarchy-reconsideration-after-new-evidence: open proposals revise on fresh evidence and terminal decisions allow future reconsideration', () => {
  const context = fixture();
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  let sequence = 0;
  const service = new HierarchyEvolutionService({
    repositoryRoot: context.root, controlPlane: control,
    clock: () => new Date('2026-12-01T12:00:00Z'), idFactory: () => `HIER-REVISIT-${++sequence}`,
  });
  const firstDraft = proposalFor(loadProjectConfig(context.root));
  const open = service.propose({ proposer: 'session-manager', proposal: firstDraft });
  assert.equal(service.propose({ proposer: 'session-manager', proposal: firstDraft }).deduplicated, true);

  const refreshedDraft = structuredClone(firstDraft);
  refreshedDraft.observation_window = {
    start_at: '2026-09-29T00:00:00Z', end_at: '2026-10-27T00:00:00Z', days: 28,
    summary: 'The cross-domain wait pattern continued in a new four-week window.',
  };
  refreshedDraft.signals[0].occurrences = 4;
  refreshedDraft.signals[0].references = ['TASK-24', 'TASK-31', 'TASK-38', 'TASK-44'];
  refreshedDraft.signals[0].summary = 'The same domains coordinated repeatedly across new tasks.';
  const updated = service.propose({ proposer: 'session-manager', proposal: refreshedDraft });
  assert.equal(updated.id, open.id, 'new evidence revises the one open proposal instead of opening a duplicate');
  assert.equal(updated.revision, 2);
  assert.equal(updated.updatedEvidence, true);
  const revisions = service.proposalHistory(open.id);
  assert.equal(revisions.length, 2);
  assert.deepEqual(revisions[0].proposal.signals[0].references, ['TASK-4', 'TASK-9']);
  assert.deepEqual(revisions[1].proposal.signals[0].references, refreshedDraft.signals[0].references);

  const sameWindowEdit = structuredClone(refreshedDraft);
  sameWindowEdit.rationale = 'Change the rationale without adding a new observation window.';
  assert.throws(() => service.propose({ proposer: 'session-manager', proposal: sameWindowEdit }),
    (error) => error.code === 'HIERARCHY_EVIDENCE_WINDOW_NOT_ADVANCED');

  service.decide({
    proposalId: open.id, decision: 'reject', decidedBy: 'owner',
    reason: 'Wait for another observation window before reconsidering.',
  });
  assert.throws(() => service.propose({ proposer: 'session-manager', proposal: refreshedDraft }),
    (error) => error.code === 'HIERARCHY_EVIDENCE_WINDOW_NOT_ADVANCED',
    'a terminal decision rejects the same evidence rather than silently reopening it');

  const laterDraft = structuredClone(refreshedDraft);
  laterDraft.observation_window = {
    start_at: '2026-10-28T00:00:00Z', end_at: '2026-11-25T00:00:00Z', days: 28,
    summary: 'The coordination pressure persisted through a third review window.',
  };
  laterDraft.signals[0].occurrences = 5;
  laterDraft.signals[0].references = ['TASK-51', 'TASK-58', 'TASK-63', 'TASK-71'];
  laterDraft.signals[0].summary = 'The same domains continued coordinating across later tasks.';

  const reconsidered = service.propose({ proposer: 'session-manager', proposal: laterDraft });
  assert.notEqual(reconsidered.id, open.id);
  assert.equal(reconsidered.deduplicated, undefined);
  assert.equal(reconsidered.state, 'proposed');
  assert.equal(reconsidered.revision, 1);
  assert.equal(service.get(open.id).state, 'rejected');
  assert.equal(service.propose({ proposer: 'session-manager', proposal: laterDraft }).deduplicated, true,
    'an exact retry of the refreshed evidence remains idempotent');
  assert.equal(service.list().length, 2);
  control.close();
});

test('SCN-hierarchy-pressure-assessment: recurring cross-domain, coordination, and approval events yield measured read-only evidence', () => {
  const context = fixture();
  const now = new Date();
  const timestamp = (daysAgo) => new Date(now.getTime() - daysAgo * 86_400_000).toISOString();
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  const specialistId = control.listAgents().find((agent) => agent.areaId !== 'session-manager').areaId;
  const service = new HierarchyEvolutionService({ repositoryRoot: context.root, controlPlane: control });
  const backlogRoot = join(context.root, '.torch', 'backlog');
  mkdirSync(backlogRoot, { recursive: true });
  writeFileSync(join(backlogRoot, 'TASK-HIER-OLD.json'), `${JSON.stringify(
    hierarchyEvidenceTask('TASK-HIER-OLD', timestamp(60), [specialistId, 'session-manager']), null, 2,
  )}\n`);
  writeFileSync(join(backlogRoot, 'TASK-HIER-1.json'), `${JSON.stringify(
    hierarchyEvidenceTask('TASK-HIER-1', timestamp(8), [specialistId, 'session-manager']), null, 2,
  )}\n`);
  control.requestCoordination({ sender: specialistId, participants: ['session-manager'], body: 'Align the first shared boundary.', task: 'TASK-HIER-1' });

  assert.throws(() => service.assess({ assessor: specialistId }),
    (error) => error.code === 'HIERARCHY_ASSESSMENT_AUTHORITY_REQUIRED');
  const baseline = service.assess({ at: now });
  assert.equal(baseline.recommendation.action, 'retain-current-organization',
    'one recent task and one request are below the recurrence threshold');
  assert.deepEqual(baseline.signals, []);
  assert.equal(baseline.sourceCounts.backlogTasksInWindow, 1, 'old evidence is outside the configured 30-day window');

  for (const [index, daysAgo] of [[2, 5], [3, 2]]) {
    const taskId = `TASK-HIER-${index}`;
    writeFileSync(join(backlogRoot, `${taskId}.json`), `${JSON.stringify(
      hierarchyEvidenceTask(taskId, timestamp(daysAgo), [specialistId, 'session-manager']), null, 2,
    )}\n`);
    control.requestCoordination({ sender: specialistId, participants: ['session-manager'],
      body: 'Resolve a repeated integration dependency.', task: taskId });
  }
  for (const requester of [specialistId, specialistId, specialistId]) {
    control.requestApproval({
      requester, approver: 'session-manager', title: 'Cross-domain interface ruling',
      summary: 'A decision is needed before implementation can converge.', task: 'TASK-HIER-3',
    });
  }

  const beforeProposals = service.list().length;
  const assessment = callTorchTool(control, 'torch_assess_hierarchy_needs', {}, {
    actorId: 'session-manager', hierarchyService: service,
  });
  assert.equal(assessment.recommendation.action, 'consider-coordination-role');
  assert.equal(assessment.recommendation.requiresOwnerApproval, true);
  assert.equal(assessment.mutationPerformed, false);
  assert.equal(assessment.observationWindow.days, 30);
  assert.equal(assessment.sourceCounts.backlogTasksInWindow, 3);
  assert.equal(assessment.signals.find((signal) => signal.code === 'recurring-multi-domain-work').occurrences, 3);
  assert.equal(assessment.signals.find((signal) => signal.code === 'recurring-manager-coordination-requests').occurrences, 3);
  assert.equal(assessment.signals.find((signal) => signal.code === 'recurring-manager-approval-waits').occurrences, 3);
  assert.equal(service.list().length, beforeProposals, 'assessment never creates an organization proposal');
  const cliAssessment = spawnSync(process.execPath, [CLI, 'fleet', 'hierarchy-assess', '--json'], {
    cwd: context.root, env: context.env, encoding: 'utf8',
  });
  assert.equal(cliAssessment.status, 0, cliAssessment.stderr);
  const cliResult = JSON.parse(cliAssessment.stdout);
  assert.equal(cliResult.recommendation.action, 'consider-coordination-role');
  assert.equal(cliResult.mutationPerformed, false);
  assert.throws(() => callTorchTool(control, 'torch_assess_hierarchy_needs', {}, {
    actorId: specialistId, hierarchyService: service,
  }), (error) => error.code === 'HIERARCHY_ASSESSMENT_AUTHORITY_REQUIRED');
  control.close();
});

test('SCN-hierarchy-proposal: organization proposals cannot transfer implementation ownership', () => {
  const context = fixture();
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  const service = new HierarchyEvolutionService({ repositoryRoot: context.root, controlPlane: control });
  const currentConfig = loadProjectConfig(context.root);
  const input = proposalFor(currentConfig);
  const unrostered = structuredClone(input);
  unrostered.graph.roles.at(-1).identity_id = 'future-manager';
  unrostered.impact.affected_identities.push('future-manager');
  assert.throws(() => service.propose({ proposer: 'session-manager', proposal: unrostered }),
    (error) => error.code === 'HIERARCHY_IDENTITY_UNKNOWN');
  const originalOwner = input.graph.implementation_owners[0].identity_id;
  const otherSpecialist = 'session-manager';
  input.graph.roles.push({
    id: 'manager-specialist', title: 'Manager Specialist', kind: 'specialist', identity_id: otherSpecialist,
    responsibilities: ['Implement the proposed surface.'], authority: ['own-implementation'],
    coordinates: [], reports_to: ['session-manager'], consults_with: [],
  });
  input.graph.implementation_owners[0].identity_id = otherSpecialist;
  input.impact.affected_identities.push(originalOwner, otherSpecialist);
  assert.throws(() => service.propose({ proposer: 'session-manager', proposal: input }),
    (error) => error.code === 'HIERARCHY_IMPLEMENTATION_OWNERSHIP_CHANGED');
  control.close();
});

test('SCN-hierarchy-proposal-mcp: bound Session Manager can propose and inspect a hierarchy pilot without owner-decision tools', () => {
  const context = fixture();
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  const service = new HierarchyEvolutionService({ repositoryRoot: context.root, controlPlane: control });
  const options = { actorId: 'session-manager', hierarchyService: service };
  const created = callTorchTool(control, 'torch_propose_hierarchy_change', {
    proposal: proposalFor(loadProjectConfig(context.root)),
  }, options);
  assert.equal(created.state, 'proposed');
  assert.equal(callTorchTool(control, 'torch_list_hierarchy_proposals', {}, options).proposals.length, 1);
  const plan = callTorchTool(control, 'torch_plan_hierarchy_pilot', { proposal_id: created.id }, options);
  assert.equal(plan.mutationPerformed, false);
  assert.throws(() => callTorchTool(control, 'torch_approve_hierarchy_change', {
    proposal_id: created.id,
  }, options), /Unknown TORCH MCP tool/);
  control.close();
});

test('SCN-console-organization-review: proposal decisions are owner-confirmed, stale-safe, and never activate the Fleet', async (context) => {
  const { root, env } = fixture();
  const control = openControlPlane({ repositoryRoot: root, env });
  context.after(() => control.close());
  const hierarchy = new HierarchyEvolutionService({
    repositoryRoot: root, controlPlane: control, clock: () => new Date('2026-10-01T12:00:00Z'),
  });
  const fleet = new FleetEvolutionService({ repositoryRoot: root, controlPlane: control });
  const hierarchyProposal = hierarchy.propose({ proposer: 'session-manager', proposal: proposalFor(loadProjectConfig(root)) });
  const fleetChange = fleet.proposeDomain({
    proposer: 'session-manager',
    domain: {
      id: 'quality-review', title: 'Quality Review', scope: ['cross-cutting quality analysis'],
      not_scope: ['feature implementation'], owned_paths: ['quality/**'], shared_paths: [],
      neighbours: [], required_checks: [], resources: [], runtime: 'claude',
    },
    rationale: 'Repeated quality work needs a persistent coordination boundary.',
    expectedBenefit: {
      summary: 'Keep recurring quality context focused.', recurringWork: 'Quality checks recur each milestone.',
      contextLocality: 'Reduce repeated loading of project-wide quality criteria.',
      coordinationCost: 'Add one session and one explicit review boundary.',
    },
    evidence: ['TASK-22', 'docs/quality-plan.md:4'],
  });
  const initialGraph = loadProjectConfig(root).organization;
  const initialAgents = control.listAgents().map((agent) => agent.areaId).sort();
  const server = createConsoleServer({ repositoryRoot: root, env });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  const origin = `http://127.0.0.1:${port}`;
  const endpoint = (type, id, preview = false) => `${origin}/api/organization-proposals/${type}/${id}${preview ? '/preview' : ''}`;
  const options = (payload, requestOrigin = origin) => ({
    method: 'POST', headers: {
      origin: requestOrigin, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin',
    }, body: JSON.stringify(payload),
  });
  try {
    const crossOrigin = await fetch(endpoint('fleet', fleetChange.id, true), options({ action: 'approve' }, 'http://attacker.invalid'));
    assert.equal(crossOrigin.status, 403);
    assert.equal(fleet.get(fleetChange.id).state, 'proposed');

    const previewResponse = await fetch(endpoint('fleet', fleetChange.id, true), options({ action: 'approve' }));
    assert.equal(previewResponse.status, 200);
    const preview = await previewResponse.json();
    assert.equal(preview.plan.mutationPerformed, false);
    assert.match(preview.plan.effect, /does not edit the active roster, create a worktree, or start an agent/);
    assert.deepEqual(preview.plan.evidence, ['TASK-22', 'docs/quality-plan.md:4']);
    assert.equal(fleet.get(fleetChange.id).state, 'proposed');

    const tampered = await fetch(endpoint('fleet', fleetChange.id), options({
      action: 'reject', reason: 'Changed after preview.', token: preview.token, planHash: preview.planHash,
    }));
    assert.equal(tampered.status, 409);
    assert.equal((await tampered.json()).error, 'ORGANIZATION_REVIEW_PREVIEW_STALE');
    assert.equal(fleet.get(fleetChange.id).state, 'proposed');

    writeFileSync(join(root, 'concurrent-review-change.txt'), 'Repository advanced after preview.\n');
    execFileSync('git', ['-C', root, 'add', 'concurrent-review-change.txt']);
    execFileSync('git', ['-C', root, 'commit', '-m', 'advance repository after review preview']);
    const stale = await fetch(endpoint('fleet', fleetChange.id), options({
      action: 'approve', token: preview.token, planHash: preview.planHash,
    }));
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).error, 'ORGANIZATION_REVIEW_PREVIEW_STALE');
    assert.equal(fleet.get(fleetChange.id).state, 'proposed');

    const freshResponse = await fetch(endpoint('fleet', fleetChange.id, true), options({ action: 'approve' }));
    const fresh = await freshResponse.json();
    const approval = { action: 'approve', token: fresh.token, planHash: fresh.planHash };
    const confirmed = await fetch(endpoint('fleet', fleetChange.id), options(approval));
    assert.equal(confirmed.status, 200);
    const approved = await confirmed.json();
    assert.equal(approved.proposal.state, 'approved');
    assert.equal(approved.mutationPerformed, true);
    assert.deepEqual(control.listAgents().map((agent) => agent.areaId).sort(), initialAgents);
    assert.deepEqual(loadProjectConfig(root).organization, initialGraph);
    const replay = await fetch(endpoint('fleet', fleetChange.id), options(approval));
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).proposal.state, 'approved');

    const noReason = await fetch(endpoint('hierarchy', hierarchyProposal.id, true), options({ action: 'reject' }));
    assert.equal(noReason.status, 400);
    assert.equal((await noReason.json()).error, 'HIERARCHY_DECISION_REASON_REQUIRED');
    const initialHierarchyPreviewResponse = await fetch(endpoint('hierarchy', hierarchyProposal.id, true), options({ action: 'approve-pilot' }));
    const initialHierarchyPreview = await initialHierarchyPreviewResponse.json();
    assert.equal(initialHierarchyPreview.plan.proposalRevision, 1);
    const refreshedHierarchyDraft = proposalFor(loadProjectConfig(root));
    refreshedHierarchyDraft.observation_window = {
      start_at: '2026-09-02T00:00:00Z', end_at: '2026-09-30T00:00:00Z', days: 28,
      summary: 'The same coordination pressure continued through a fresh evidence window.',
    };
    refreshedHierarchyDraft.signals[0].occurrences = 4;
    refreshedHierarchyDraft.signals[0].references = ['TASK-24', 'TASK-31', 'TASK-38', 'TASK-44'];
    assert.equal(hierarchy.propose({ proposer: 'session-manager', proposal: refreshedHierarchyDraft }).revision, 2);
    const staleHierarchyConfirmation = await fetch(endpoint('hierarchy', hierarchyProposal.id), options({
      action: 'approve-pilot', token: initialHierarchyPreview.token, planHash: initialHierarchyPreview.planHash,
    }));
    assert.equal(staleHierarchyConfirmation.status, 409);
    assert.equal((await staleHierarchyConfirmation.json()).error, 'ORGANIZATION_REVIEW_PREVIEW_STALE');

    const hierarchyPreviewResponse = await fetch(endpoint('hierarchy', hierarchyProposal.id, true), options({ action: 'approve-pilot' }));
    const hierarchyPreview = await hierarchyPreviewResponse.json();
    assert.equal(hierarchyPreview.plan.proposalRevision, 2);
    assert.equal(hierarchyPreview.plan.mutationPerformed, false);
    assert.match(hierarchyPreview.plan.effect, /Activation remains a separate fresh-plan CLI action/);
    assert.deepEqual(hierarchyPreview.plan.managerCheckInSchedules.additions, [],
      'promoting the current Session Manager identity keeps its existing cadence');
    assert.equal(hierarchyPreview.plan.timerReconciliation.timerState, 'not-verified');
    assert.equal(hierarchyPreview.plan.timerReconciliation.requiredAfterScheduleConfigChange, false);
    assert.equal(hierarchy.get(hierarchyProposal.id).state, 'proposed');
    const hierarchyConfirmed = await fetch(endpoint('hierarchy', hierarchyProposal.id), options({
      action: 'approve-pilot', token: hierarchyPreview.token, planHash: hierarchyPreview.planHash,
    }));
    assert.equal(hierarchyConfirmed.status, 200);
    assert.equal((await hierarchyConfirmed.json()).proposal.state, 'pilot-approved');
    assert.deepEqual(loadProjectConfig(root).organization, initialGraph);
    writeFileSync(join(root, 'after-hierarchy-approval.txt'), 'Repository advanced after hierarchy approval.\n');
    execFileSync('git', ['-C', root, 'add', 'after-hierarchy-approval.txt']);
    execFileSync('git', ['-C', root, 'commit', '-m', 'advance repository after hierarchy approval']);
    const blockedPilotPlan = hierarchy.planPilot(hierarchyProposal.id);
    assert.equal(blockedPilotPlan.canProceed, false);
    assert.equal(blockedPilotPlan.mutationPerformed, false);
    assert.equal(blockedPilotPlan.blockers.some((blocker) => blocker.type === 'stale-base-commit'), true);
    assert.deepEqual(control.listAgents().map((agent) => agent.areaId).sort(), initialAgents);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('SCN-console-hierarchy-activation: pilot activation requires a fresh owner preview and commits without starting sessions or timers', async (context) => {
  const { root, env } = fixture();
  const control = openControlPlane({ repositoryRoot: root, env });
  context.after(() => control.close());
  const hierarchy = new HierarchyEvolutionService({ repositoryRoot: root, controlPlane: control });
  const firstDraft = proposalFor(loadProjectConfig(root));
  const first = hierarchy.propose({ proposer: 'session-manager', proposal: firstDraft });
  hierarchy.decide({ proposalId: first.id, decision: 'approve-pilot', decidedBy: 'owner' });
  const initialHead = inspectRepository(root).head;
  const initialGraphRevision = organizationGraphFromConfig(loadProjectConfig(root)).revision;
  const identities = control.listAgents().map((agent) => agent.areaId).sort();
  const server = createConsoleServer({ repositoryRoot: root, env });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const endpoint = (id, preview = false) => `${origin}/api/organization-proposals/hierarchy/${id}/activate${preview ? '/preview' : ''}`;
  const options = (payload, requestOrigin = origin) => ({
    method: 'POST', headers: {
      origin: requestOrigin, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin',
    }, body: JSON.stringify(payload),
  });
  try {
    const crossOrigin = await fetch(endpoint(first.id, true), options({}, 'http://attacker.invalid'));
    assert.equal(crossOrigin.status, 403);

    const previewResponse = await fetch(endpoint(first.id, true), options({}));
    assert.equal(previewResponse.status, 200);
    const preview = await previewResponse.json();
    assert.equal(preview.plan.mutationPerformed, false);
    assert.equal(preview.plan.pilotPlan.canProceed, true);
    assert.equal(preview.plan.ownerIdentity, 'owner');
    assert.match(preview.plan.effect, /one scoped local Git commit/);
    assert.match(preview.plan.effect, /does not create or start identities, launch an AI runtime, or change user systemd state/);
    assert.equal(hierarchy.get(first.id).state, 'pilot-approved');
    assert.equal(inspectRepository(root).head, initialHead, 'preview does not commit or activate');

    writeFileSync(join(root, 'concurrent-activation-change.txt'), 'Repository advanced after activation preview.\n');
    execFileSync('git', ['-C', root, 'add', 'concurrent-activation-change.txt']);
    execFileSync('git', ['-C', root, 'commit', '-m', 'advance repository after activation preview']);
    const stale = await fetch(endpoint(first.id), options({ token: preview.token, planHash: preview.planHash }));
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).error, 'HIERARCHY_ACTIVATION_PREVIEW_STALE');
    assert.equal(hierarchy.get(first.id).state, 'pilot-approved');

    const secondDraft = proposalFor(loadProjectConfig(root));
    secondDraft.graph.roles.find((role) => role.id === 'program-director').title = 'Program Director Pilot';
    const second = hierarchy.propose({ proposer: 'session-manager', proposal: secondDraft });
    hierarchy.decide({ proposalId: second.id, decision: 'approve-pilot', decidedBy: 'owner' });
    const freshResponse = await fetch(endpoint(second.id, true), options({}));
    assert.equal(freshResponse.status, 200);
    const fresh = await freshResponse.json();
    assert.equal(fresh.plan.pilotPlan.canProceed, true);
    const activatedResponse = await fetch(endpoint(second.id), options({ token: fresh.token, planHash: fresh.planHash }));
    assert.equal(activatedResponse.status, 200);
    const activated = await activatedResponse.json();
    assert.equal(activated.proposal.state, 'piloting');
    assert.equal(activated.proposal.activationCommit, inspectRepository(root).head);
    assert.equal(activated.proposal.runtimeStarted, false);
    assert.equal(activated.proposal.timerReconciliationRequired, false);
    assert.deepEqual(control.listAgents().map((agent) => agent.areaId).sort(), identities);
    assert.equal(organizationGraphFromConfig(loadProjectConfig(root)).revision, initialGraphRevision + 1);
    assert.equal(activated.plan.mutationPerformed, false, 'the reviewed plan remains evidence, not the mutation receipt');

    const replay = await fetch(endpoint(second.id), options({ token: fresh.token, planHash: fresh.planHash }));
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).proposal.activationCommit, activated.proposal.activationCommit);
    assert.equal(inspectRepository(root).head, activated.proposal.activationCommit,
      'idempotent confirmation does not create a second activation commit');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('SCN-hierarchy-cli: owner can review a manager proposal through the explicit CLI surface', () => {
  const context = fixture();
  const proposalPath = join(context.root, 'hierarchy-proposal.json');
  writeFileSync(proposalPath, `${JSON.stringify(proposalFor(loadProjectConfig(context.root)), null, 2)}\n`);
  const run = (args) => spawnSync(process.execPath, [CLI, ...args], {
    cwd: context.root,
    env: { ...context.env, TORCH_BIN_HOME: join(context.root, '.bin') },
    encoding: 'utf8',
  });
  const created = run(['fleet', 'hierarchy-propose', '--from', 'session-manager', '--proposal', proposalPath, '--json']);
  assert.equal(created.status, 0, created.stderr || created.stdout);
  const proposal = JSON.parse(created.stdout);
  assert.equal(proposal.state, 'proposed');
  const denied = run([
    'fleet', 'hierarchy-decide', '--proposal', proposal.id, '--decision', 'approve-pilot', '--by', 'session-manager', '--yes', '--json',
  ]);
  assert.equal(JSON.parse(denied.stdout).error, 'HIERARCHY_OWNER_AUTHORITY_REQUIRED');
  const approved = run([
    'fleet', 'hierarchy-decide', '--proposal', proposal.id, '--decision', 'approve-pilot', '--by', 'owner', '--yes', '--json',
  ]);
  assert.equal(approved.status, 0, approved.stderr || approved.stdout);
  assert.equal(JSON.parse(approved.stdout).state, 'pilot-approved');
  const plan = run(['fleet', 'hierarchy-plan', '--proposal', proposal.id, '--json']);
  assert.equal(plan.status, 0, plan.stderr || plan.stdout);
  assert.equal(JSON.parse(plan.stdout).mutationPerformed, false);
});

test('SCN-hierarchy-pilot-review: complete baseline comparisons are durable evidence, not automatic adoption', () => {
  const context = fixture();
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  let now = new Date('2026-09-30T12:00:00Z');
  const hierarchy = new HierarchyEvolutionService({ repositoryRoot: context.root, controlPlane: control, clock: () => now });
  try {
    const config = loadProjectConfig(context.root);
    const input = proposalFor(config);
    const proposal = hierarchy.propose({ proposer: 'session-manager', proposal: input });
    const review = { summary: 'Coordination wait decreased in the pilot.', recommendation: 'adopt',
      metrics: [{ name: 'cross_domain_wait', value: '1', unit: 'days median', classification: 'measured',
        evidence: ['reports/pilot-wait.csv'] }],
      success: input.pilot.success_criteria.map((criterion) => ({ criterion, outcome: 'met', evidence: ['reports/pilot-wait.csv'] })),
      stop: input.pilot.stop_criteria.map((criterion) => ({ criterion, outcome: 'not-met', evidence: ['reports/pilot-routing.md'] })),
    };
    const submit = (value = review, reviewer = 'session-manager') => hierarchy.recordPilotReview({ proposalId: proposal.id, reviewer, review: value });
    assert.throws(() => submit(), (error) => error.code === 'HIERARCHY_PILOT_REVIEW_BLOCKED');
    hierarchy.decide({ proposalId: proposal.id, decision: 'approve-pilot', decidedBy: 'owner' });
    hierarchy.activatePilot({ proposalId: proposal.id, activatedBy: 'owner' });
    const graphBefore = readFileSync(join(context.root, '.torch/torch.yaml'), 'utf8');
    const headBefore = execFileSync('git', ['-C', context.root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    assert.throws(() => submit(review, config.domains[0].id), (error) => error.code === 'HIERARCHY_REVIEW_AUTHORITY_REQUIRED');
    assert.throws(() => submit(), (error) => error.code === 'HIERARCHY_REVIEW_ADOPTION_UNPROVEN');
    const interim = submit({ ...review, recommendation: 'inconclusive',
      metrics: [{ ...review.metrics[0], value: 'not measured', classification: 'unavailable' }] });
    assert.equal(interim.window.complete, false);
    assert.equal(interim.comparisons[0].baseline, '3');
    assert.equal(interim.comparisons[0].classification, 'unavailable');
    now = new Date('2026-10-14T12:00:00Z');
    assert.throws(() => submit({ ...review, metrics: [] }), (error) => error.code === 'HIERARCHY_REVIEW_INCOMPLETE');
    assert.throws(() => submit({ ...review, metrics: [review.metrics[0], review.metrics[0]] }),
      (error) => error.code === 'HIERARCHY_REVIEW_INCOMPLETE');
    assert.throws(() => submit({ ...review, metrics: [{ ...review.metrics[0], unit: 'hours' }] }),
      (error) => error.code === 'HIERARCHY_REVIEW_UNIT_MISMATCH');
    assert.throws(() => submit({ ...review, metrics: [{ ...review.metrics[0], classification: 'qualitative' }] }),
      (error) => error.code === 'HIERARCHY_REVIEW_ADOPTION_UNPROVEN');
    assert.throws(() => submit({ ...review, stop: review.stop.map((entry) => ({ ...entry, outcome: 'met' })) }),
      (error) => error.code === 'HIERARCHY_REVIEW_ADOPTION_UNPROVEN');
    const final = submit();
    assert.equal(final.window.complete, true);
    assert.equal(final.comparisons[0].observed, '1');
    assert.equal(final.evidenceVerification, 'reviewer-reported');
    assert.equal(final.ownerDecisionRequired, true);
    assert.equal(final.organizationChanged, false);
    assert.equal(final.runtimeStarted, false);
    assert.equal(submit().deduplicated, true);
    assert.equal(hierarchy.pilotReviews(proposal.id).length, 2);
    const recordsBefore = hierarchy.pilotReviews(proposal.id);
    const observed = observeProject({ repositoryRoot: context.root, env: context.env });
    const observedProposal = observed.hierarchyProposals.find((entry) => entry.id === proposal.id);
    assert.equal(observedProposal.pilotReviews.length, 2);
    assert.equal(observedProposal.pilotReviews[0].comparisons[0].baseline, '3');
    assert.equal(observedProposal.pilotReviews[0].comparisons[0].observed, '1');
    assert.equal(observedProposal.pilotReviews[0].evidenceVerification, 'reviewer-reported');
    assert.deepEqual(hierarchy.pilotReviews(proposal.id), recordsBefore, 'Console observation leaves review history unchanged');
    assert.equal(control.readAudit().filter((event) => event.operation === 'hierarchy.review-pilot').length, 2);
    assert.equal(hierarchy.get(proposal.id).state, 'piloting');
    assert.equal(readFileSync(join(context.root, '.torch/torch.yaml'), 'utf8'), graphBefore);
    assert.equal(execFileSync('git', ['-C', context.root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), headBefore);
    const listed = spawnSync(process.execPath, [CLI, 'fleet', 'hierarchy-pilot-reviews', '--proposal', proposal.id, '--json'],
      { cwd: context.root, env: context.env, encoding: 'utf8' });
    assert.equal(listed.status, 0, listed.stderr);
    assert.equal(JSON.parse(listed.stdout).reviews.length, 2);
    const reason = 'Measured review supports retaining the bounded coordination role.';
    now = new Date('2026-09-30T12:00:00Z');
    assert.equal(hierarchy.planConclusion({ proposalId: proposal.id, decision: 'adopt', reason }).canProceed, false,
      'stored full-window evidence cannot bypass current calendar maturity');
    now = new Date('2026-10-14T12:00:00Z');
    const plan = hierarchy.planConclusion({ proposalId: proposal.id, decision: 'adopt', reason });
    assert.equal(plan.canProceed, true, JSON.stringify(plan.blockers));
    const confirmation = { proposalId: proposal.id, decision: 'adopt', reason, decidedBy: 'owner', approved: true, planHash: plan.planHash };
    assert.throws(() => hierarchy.concludePilot({ ...confirmation, decidedBy: 'session-manager' }),
      (error) => error.code === 'OWNER_AUTHORITY_REQUIRED');
    assert.throws(() => hierarchy.concludePilot({ ...confirmation, approved: false }),
      (error) => error.code === 'APPROVAL_REQUIRED');
    assert.throws(() => hierarchy.concludePilot({ ...confirmation, planHash: 'stale' }),
      (error) => error.code === 'HIERARCHY_CONCLUSION_PLAN_STALE');
    const adopted = hierarchy.concludePilot(confirmation);
    assert.equal(adopted.state, 'adopted');
    assert.equal(adopted.runtimeStarted, false);
    assert.equal(readFileSync(join(context.root, '.torch/torch.yaml'), 'utf8'), graphBefore);
    assert.equal(hierarchy.concludePilot(confirmation).replay, true);
    assert.equal(control.readAudit().filter((event) => event.operation === 'hierarchy.conclude-pilot').length, 1);
  } finally { control.close(); }
});

test('SCN-hierarchy-pilot-reversal: owner-confirmed reversal restores relationships and preserves identities, schedules and durable work', () => {
  const context = fixture();
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  const hierarchy = new HierarchyEvolutionService({ repositoryRoot: context.root, controlPlane: control,
    clock: () => new Date('2026-09-30T12:00:00Z') });
  try {
    const initialConfig = loadProjectConfig(context.root);
    const priorGraph = organizationGraphFromConfig(initialConfig);
    const proposal = hierarchy.propose({ proposer: 'session-manager', proposal: proposalFor(initialConfig, { addDomainManager: true }) });
    hierarchy.decide({ proposalId: proposal.id, decision: 'approve-pilot', decidedBy: 'owner' });
    hierarchy.activatePilot({ proposalId: proposal.id, activatedBy: 'owner' });
    const agents = control.listAgents().map((agent) => agent.areaId);
    const schedules = loadProjectConfig(context.root).schedules;
    const message = control.sendMessage({ sender: 'session-manager', recipient: initialConfig.domains[0].id,
      kind: 'coordination-request', body: 'Continue the existing integration task.' });
    const worktrees = createWorktrees({ repository: inspectRepository(context.root) }).created;
    const backlog = new BacklogService({ repositoryRoot: context.root, controlPlane: control });
    let task = backlog.create({ actorId: 'session-manager', title: 'Preserve implementation work',
      description: 'This work must remain assigned through management reversal.',
      affectedDomains: [initialConfig.domains[0].id], acceptanceCriteria: ['Task ownership survives.'] });
    task = backlog.transition({ taskId: task.id, actorId: 'session-manager', to: 'ready', expectedRevision: task.revision });
    task = backlog.transition({ taskId: task.id, actorId: 'session-manager', to: 'assigned',
      owner: initialConfig.domains[0].id, expectedRevision: task.revision });
    execFileSync('git', ['-C', context.root, 'add', '.torch']);
    execFileSync('git', ['-C', context.root, 'commit', '-m', 'preserve active assignment']);
    const reason = 'Coordination is delaying peer collaboration; restore prior relationships.';
    const first = hierarchy.planConclusion({ proposalId: proposal.id, decision: 'reverse', reason });
    assert.equal(first.canProceed, true, JSON.stringify(first.blockers));
    assert.ok(first.obsoleteScheduleCandidates.length > 0);
    assert.ok(first.activeWork.some((item) => item.id === task.id && item.owner === task.owner));
    writeFileSync(join(context.root, 'note.md'), 'Unrelated project improvement.\n');
    execFileSync('git', ['-C', context.root, 'add', 'note.md']);
    execFileSync('git', ['-C', context.root, 'commit', '-m', 'unrelated project change']);
    const confirmation = { proposalId: proposal.id, decision: 'reverse', reason,
      decidedBy: 'owner', approved: true, planHash: first.planHash };
    assert.throws(() => hierarchy.concludePilot(confirmation), (error) => error.code === 'HIERARCHY_CONCLUSION_PLAN_STALE');
    confirmation.planHash = hierarchy.planConclusion({ proposalId: proposal.id, decision: 'reverse', reason }).planHash;
    const cliPlan = spawnSync(process.execPath, [CLI, 'fleet', 'hierarchy-conclusion-plan', '--proposal', proposal.id,
      '--decision', 'reverse', '--reason', reason, '--json'], { cwd: context.root, env: context.env, encoding: 'utf8' });
    assert.equal(cliPlan.status, 0, cliPlan.stderr);
    assert.equal(JSON.parse(cliPlan.stdout).planHash, confirmation.planHash);
    const cliDenied = spawnSync(process.execPath, [CLI, 'fleet', 'hierarchy-conclude', '--proposal', proposal.id,
      '--decision', 'reverse', '--reason', reason, '--plan-hash', confirmation.planHash, '--by', 'owner', '--json'],
    { cwd: context.root, env: context.env, encoding: 'utf8' });
    assert.notEqual(cliDenied.status, 0, 'CLI refuses unconfirmed conclusion');
    assert.equal(hierarchy.get(proposal.id).state, 'piloting');
    const paths = ['.torch/torch.yaml', '.torch/install-manifest.json', `.torch/hierarchy-pilots/${proposal.id}.json`];
    const beforeFailure = paths.map((path) => readFileSync(join(context.root, path), 'utf8'));
    const hook = join(context.root, '.git/hooks/pre-commit');
    writeFileSync(hook, '#!/bin/sh\nexit 1\n');
    chmodSync(hook, 0o755);
    assert.throws(() => hierarchy.concludePilot(confirmation), (error) => error.code === 'HIERARCHY_CONCLUSION_COMMIT_FAILED');
    assert.deepEqual(paths.map((path) => readFileSync(join(context.root, path), 'utf8')), beforeFailure);
    assert.equal(execFileSync('git', ['-C', context.root, 'status', '--porcelain'], { encoding: 'utf8' }).trim(), '',
      'failed conclusion restores tracked files and index');
    writeFileSync(hook, '#!/bin/sh\nexit 0\n');
    // Inject a local DB failure after the tracked conclusion has committed.
    control.database.exec(`CREATE TEMP TRIGGER reject_conclusion_audit BEFORE INSERT ON audit_events
      WHEN NEW.operation = 'hierarchy.conclude-pilot' BEGIN SELECT RAISE(ABORT, 'injected audit failure'); END;`);
    assert.throws(() => hierarchy.concludePilot(confirmation), /injected audit failure/);
    assert.equal(hierarchy.get(proposal.id).state, 'piloting', 'database state and audit roll back together');
    const committedHead = execFileSync('git', ['-C', context.root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    control.database.exec('DROP TRIGGER reject_conclusion_audit');
    const reconciled = hierarchy.concludePilot(confirmation);
    assert.equal(reconciled.state, 'reversed');
    assert.equal(reconciled.reconciled, true);
    assert.equal(reconciled.runtimeStarted, false);
    assert.equal(execFileSync('git', ['-C', context.root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), committedHead,
      'reconciliation does not repeat the tracked commit');
    const after = loadProjectConfig(context.root);
    assert.deepEqual(after.organization.roles, priorGraph.roles);
    assert.deepEqual(after.organization.implementation_owners, priorGraph.implementation_owners);
    assert.equal(after.organization.revision, priorGraph.revision + 2);
    assert.deepEqual(after.schedules, schedules);
    assert.deepEqual(control.listAgents().map((agent) => agent.areaId), agents);
    for (const worktree of worktrees) assert.equal(existsSync(worktree.path), true, 'existing worktrees survive reversal');
    assert.deepEqual(backlog.get(task.id), task, 'active task ownership, revision and history survive reversal');
    assert.ok(control.readMessages({ recipient: initialConfig.domains[0].id }).some((entry) => entry.id === message.id));
    assert.equal(hierarchy.concludePilot(confirmation).replay, true);
    const cliReplay = spawnSync(process.execPath, [CLI, 'fleet', 'hierarchy-conclude', '--proposal', proposal.id,
      '--decision', 'reverse', '--reason', reason, '--plan-hash', confirmation.planHash, '--by', 'owner', '--yes', '--json'],
    { cwd: context.root, env: context.env, encoding: 'utf8' });
    assert.equal(cliReplay.status, 0, cliReplay.stderr);
    assert.equal(JSON.parse(cliReplay.stdout).replay, true);
    assert.equal(control.readAudit().filter((event) => event.operation === 'hierarchy.conclude-pilot').length, 1);
  } finally { control.close(); }
});

test('SCN-console-hierarchy-conclusion: exact owner previews gate reversal, reject stale or cross-site requests, and replay once', async () => {
  const context = fixture();
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  const hierarchy = new HierarchyEvolutionService({ repositoryRoot: context.root, controlPlane: control,
    clock: () => new Date('2026-09-30T12:00:00Z') });
  const config = loadProjectConfig(context.root);
  const priorGraph = organizationGraphFromConfig(config);
  const proposal = hierarchy.propose({ proposer: 'session-manager', proposal: proposalFor(config) });
  hierarchy.decide({ proposalId: proposal.id, decision: 'approve-pilot', decidedBy: 'owner' });
  hierarchy.activatePilot({ proposalId: proposal.id, activatedBy: 'owner' });
  const server = createConsoleServer({ repositoryRoot: context.root, env: context.env, clock: () => new Date('2026-09-30T12:00:00Z') });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const path = `/api/organization-proposals/hierarchy-conclusion/${proposal.id}`;
  const post = (route, payload, requestOrigin = origin) => fetch(origin + route, {
    method: 'POST', headers: { origin: requestOrigin, 'content-type': 'application/json' }, body: JSON.stringify(payload),
  });
  const body = { action: 'reverse', reason: 'Restore direct coordination after the pilot.' };
  try {
    assert.equal((await fetch(origin + path)).status, 405);
    assert.equal((await post(path + '/preview', body, 'https://example.invalid')).status, 403);
    assert.equal((await post(path, body)).status, 409);
    const blockedResponse = await post(path + '/preview', { action: 'adopt', reason: 'Keep this pilot.' });
    assert.equal(blockedResponse.status, 200);
    const blocked = await blockedResponse.json();
    assert.equal(blocked.token, null);
    assert.equal(blocked.plan.canProceed, false);
    const initial = await (await post(path + '/preview', body)).json();
    assert.equal(initial.plan.canProceed, true);
    assert.equal(hierarchy.get(proposal.id).state, 'piloting', 'preview does not conclude the pilot');
    assert.equal((await post(path, { ...body, reason: 'Changed reason', token: initial.token, planHash: initial.planHash })).status, 409);
    writeFileSync(join(context.root, 'change.md'), 'Main advanced.\n');
    execFileSync('git', ['-C', context.root, 'add', 'change.md']);
    execFileSync('git', ['-C', context.root, 'commit', '-m', 'advance main after preview']);
    assert.equal((await post(path, { ...body, token: initial.token, planHash: initial.planHash })).status, 409);
    const fresh = await (await post(path + '/preview', body)).json();
    const confirmation = { ...body, token: fresh.token, planHash: fresh.planHash };
    assert.equal((await post('/api/organization-proposals/hierarchy/' + proposal.id, confirmation)).status, 409,
      'conclusion tokens cannot authorize a different operation');
    const confirmed = await post(path, confirmation);
    assert.equal(confirmed.status, 200, await confirmed.clone().text());
    assert.equal((await confirmed.json()).proposal.state, 'reversed');
    assert.deepEqual(loadProjectConfig(context.root).organization.roles, priorGraph.roles);
    assert.equal((await post(path, confirmation)).status, 200);
    assert.equal(control.readAudit().filter((event) => event.operation === 'hierarchy.conclude-pilot').length, 1);
    assert.equal((await post(path, { ...confirmation, action: 'adopt' })).status, 409);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    control.close();
  }
});

test('SCN-console-hierarchy-adoption: completed supporting evidence permits a separate owner-confirmed adoption without graph changes', async () => {
  const context = fixture();
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  let now = new Date('2026-09-01T12:00:00Z');
  const hierarchy = new HierarchyEvolutionService({ repositoryRoot: context.root, controlPlane: control, clock: () => now });
  const draft = proposalFor(loadProjectConfig(context.root));
  draft.observation_window = { start_at: '2026-08-01T00:00:00Z', end_at: '2026-08-31T00:00:00Z', days: 30,
    summary: 'Recurring coordination pressure before the pilot.' };
  const proposal = hierarchy.propose({ proposer: 'session-manager', proposal: draft });
  hierarchy.decide({ proposalId: proposal.id, decision: 'approve-pilot', decidedBy: 'owner' });
  hierarchy.activatePilot({ proposalId: proposal.id, activatedBy: 'owner' });
  now = new Date('2026-09-15T12:00:00Z');
  hierarchy.recordPilotReview({ proposalId: proposal.id, review: {
    summary: 'Reported measurements support adoption.', recommendation: 'adopt',
    metrics: draft.pilot.baseline_metrics.map((metric) => ({ ...metric, value: '1', classification: 'measured', evidence: ['reports/pilot.csv'] })),
    success: draft.pilot.success_criteria.map((criterion) => ({ criterion, outcome: 'met', evidence: ['reports/pilot.csv'] })),
    stop: draft.pilot.stop_criteria.map((criterion) => ({ criterion, outcome: 'not-met', evidence: ['reports/pilot.md'] })),
  } });
  const beforeGraph = loadProjectConfig(context.root).organization;
  const server = createConsoleServer({ repositoryRoot: context.root, env: context.env, clock: () => now });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const path = `/api/organization-proposals/hierarchy-conclusion/${proposal.id}`;
  const post = (route, body) => fetch(origin + route, { method: 'POST',
    headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const input = { action: 'adopt', reason: 'Keep the proven pilot organization.' };
    const preview = await (await post(path + '/preview', input)).json();
    assert.equal(preview.plan.canProceed, true, JSON.stringify(preview.plan.scope.blockers));
    assert.equal(hierarchy.get(proposal.id).state, 'piloting');
    const response = await post(path, { ...input, token: preview.token, planHash: preview.planHash });
    assert.equal(response.status, 200, await response.clone().text());
    const result = await response.json();
    assert.equal(result.proposal.state, 'adopted');
    assert.equal(result.proposal.runtimeStarted, false);
    assert.deepEqual(loadProjectConfig(context.root).organization, beforeGraph);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    control.close();
  }
});

test('SCN-hierarchy-activation: owner-confirmed pilot commits graph and manager cadence without starting identities or changing systemd', () => {
  const context = fixture();
  const systemctl = [];
  const launcher = new ScheduleLauncherService({
    repositoryRoot: context.root,
    env: { ...context.env, XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), 'torch-hierarchy-user-config-')) },
    executor: (command, args) => { systemctl.push({ command, args }); return { status: 0, stdout: '', stderr: '' }; },
  });
  launcher.install();
  execFileSync('git', ['-C', context.root, 'add', '.torch/install-manifest.json']);
  execFileSync('git', ['-C', context.root, 'commit', '-m', 'install fake schedule launcher']);
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  let sequence = 0;
  const hierarchy = new HierarchyEvolutionService({
    repositoryRoot: context.root, controlPlane: control,
    clock: () => new Date('2026-09-29T12:00:00Z'), idFactory: () => `HIER-PILOT-${++sequence}`,
  });
  const initialHead = execFileSync('git', ['-C', context.root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const initialAgents = control.listAgents().map((agent) => agent.areaId).sort();
  const config = loadProjectConfig(context.root);
  const worker = config.domains[0].id;
  const proposal = hierarchy.propose({
    proposer: 'session-manager', proposal: proposalFor(config, { addDomainManager: true }),
  });
  hierarchy.decide({ proposalId: proposal.id, decision: 'approve-pilot', decidedBy: 'owner' });

  const plan = hierarchy.planPilot(proposal.id);
  assert.equal(plan.canProceed, true, JSON.stringify(plan.blockers));
  assert.equal(plan.mutationPerformed, false);
  assert.deepEqual(plan.managerCheckInSchedules.additions.map((schedule) => schedule.action.manager_id), [worker]);
  assert.equal(plan.timerReconciliation.requiredAfterActivation, true);
  assert.deepEqual(plan.timerReconciliation.commands, [
    'torch schedules launcher plan-reconcile', 'torch schedules launcher reconcile --yes',
  ]);
  assert.throws(() => hierarchy.activatePilot({ proposalId: proposal.id, activatedBy: 'session-manager' }),
    (error) => error.code === 'HIERARCHY_OWNER_AUTHORITY_REQUIRED');

  const activated = hierarchy.activatePilot({ proposalId: proposal.id, activatedBy: 'owner' });
  assert.equal(activated.state, 'piloting');
  assert.equal(activated.mutationPerformed, true);
  assert.equal(activated.runtimeStarted, false);
  assert.equal(activated.timerReconciliationRequired, true);
  assert.notEqual(activated.activationCommit, initialHead);
  assert.deepEqual(control.listAgents().map((agent) => agent.areaId).sort(), initialAgents);

  const activeConfig = loadProjectConfig(context.root);
  assert.equal(activeConfig.organization.revision, 2);
  assert.equal(activeConfig.schedules.some((schedule) => schedule.action?.manager_id === worker), true);
  assert.equal(activeConfig.schedules.find((schedule) => schedule.action?.manager_id === worker).trigger.seconds, 900);
  assert.equal(activeConfig.schedules.find((schedule) => schedule.action?.manager_id === 'session-manager').trigger.seconds, 900);
  const manifest = JSON.parse(readFileSync(join(context.root, '.torch', 'install-manifest.json'), 'utf8'));
  assert.equal(manifest.external.filter((entry) => entry.type === 'systemd-user-unit').length, 2);
  assert.equal(launcher.status().stale, true, 'activation flags the existing digest-bound timer for explicit follow-up');
  assert.equal(systemctl.length, 2, 'activation did not call the external systemd executor');
  assert.equal(manifest.created.some((entry) => entry.path === `.torch/hierarchy-pilots/${proposal.id}.json`), true);
  const pilot = JSON.parse(readFileSync(join(context.root, '.torch', 'hierarchy-pilots', `${proposal.id}.json`), 'utf8'));
  assert.equal(pilot.state, 'piloting');
  assert.deepEqual(pilot.managerCheckInSchedules.additions.map((schedule) => schedule.action.manager_id), [worker]);
  const configHash = createHash('sha256').update(readFileSync(join(context.root, '.torch', 'torch.yaml'))).digest('hex');
  assert.equal(manifest.created.find((entry) => entry.path === '.torch/torch.yaml').sha256, configHash);
  const committedFiles = execFileSync('git', [
    '-C', context.root, 'show', '--pretty=format:', '--name-only', activated.activationCommit,
  ], { encoding: 'utf8' }).trim().split('\n').sort();
  assert.deepEqual(committedFiles, [
    '.torch/hierarchy-pilots/HIER-PILOT-1.json', '.torch/install-manifest.json', '.torch/torch.yaml',
  ]);
  assert.equal(hierarchy.get(proposal.id).activationCommit, activated.activationCommit);
  assert.equal(hierarchy.planPilot(proposal.id).blockers.some((blocker) => blocker.type === 'owner-pilot-approval-required'), true);
  assert.equal(launcher.planReconcile().canProceed, true);
  launcher.reconcile();
  assert.equal(launcher.status().stale, false, 'the separate launcher reconciliation activates the new manager cadence');
  control.close();
});

test('SCN-hierarchy-cli-activation: only explicit owner confirmation invokes the tracked pilot activation', () => {
  const context = fixture();
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  const hierarchy = new HierarchyEvolutionService({ repositoryRoot: context.root, controlPlane: control });
  const proposal = hierarchy.propose({
    proposer: 'session-manager', proposal: proposalFor(loadProjectConfig(context.root), { addDomainManager: true }),
  });
  hierarchy.decide({ proposalId: proposal.id, decision: 'approve-pilot', decidedBy: 'owner' });
  control.close();
  const run = (args) => spawnSync(process.execPath, [CLI, ...args, '--json'], {
    cwd: context.root, env: context.env, encoding: 'utf8',
  });
  const unconfirmed = run(['fleet', 'hierarchy-activate', '--proposal', proposal.id, '--by', 'owner']);
  assert.notEqual(unconfirmed.status, 0);
  assert.equal(JSON.parse(unconfirmed.stdout).error, 'APPROVAL_REQUIRED');
  const wrongOwner = run(['fleet', 'hierarchy-activate', '--proposal', proposal.id, '--by', 'session-manager', '--yes']);
  assert.notEqual(wrongOwner.status, 0);
  assert.equal(JSON.parse(wrongOwner.stdout).error, 'HIERARCHY_OWNER_AUTHORITY_REQUIRED');
  const confirmed = run(['fleet', 'hierarchy-activate', '--proposal', proposal.id, '--by', 'owner', '--yes']);
  assert.equal(confirmed.status, 0, confirmed.stderr || confirmed.stdout);
  assert.equal(JSON.parse(confirmed.stdout).state, 'piloting');
  assert.equal(JSON.parse(confirmed.stdout).runtimeStarted, false);
});

test('SCN-hierarchy-activation-rollback: failed tracked commit restores config, manifest, pilot record, and index', () => {
  const context = fixture();
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  const hierarchy = new HierarchyEvolutionService({ repositoryRoot: context.root, controlPlane: control });
  const proposal = hierarchy.propose({
    proposer: 'session-manager', proposal: proposalFor(loadProjectConfig(context.root), { addDomainManager: true }),
  });
  hierarchy.decide({ proposalId: proposal.id, decision: 'approve-pilot', decidedBy: 'owner' });
  const configBefore = readFileSync(join(context.root, '.torch', 'torch.yaml'), 'utf8');
  const manifestBefore = readFileSync(join(context.root, '.torch', 'install-manifest.json'), 'utf8');
  const hook = join(context.root, '.git', 'hooks', 'pre-commit');
  writeFileSync(hook, '#!/bin/sh\nexit 1\n');
  chmodSync(hook, 0o700);

  assert.throws(() => hierarchy.activatePilot({ proposalId: proposal.id, activatedBy: 'owner' }),
    (error) => error.code === 'HIERARCHY_ACTIVATION_COMMIT_FAILED');
  assert.equal(readFileSync(join(context.root, '.torch', 'torch.yaml'), 'utf8'), configBefore);
  assert.equal(readFileSync(join(context.root, '.torch', 'install-manifest.json'), 'utf8'), manifestBefore);
  assert.equal(existsSync(join(context.root, '.torch', 'hierarchy-pilots', `${proposal.id}.json`)), false);
  assert.equal(execFileSync('git', ['-C', context.root, 'status', '--porcelain'], { encoding: 'utf8' }).trim(), '');
  assert.equal(hierarchy.get(proposal.id).state, 'pilot-approved');
  control.close();
});
