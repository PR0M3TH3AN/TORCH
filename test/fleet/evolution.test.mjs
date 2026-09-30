import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openControlPlane } from '../../src/control-plane/service.mjs';
import { FleetEvolutionService } from '../../src/evolution/service.mjs';
import { analyzeRepository } from '../../src/kernel/analyze.mjs';
import { proposeDomains } from '../../src/kernel/domains.mjs';
import { inspectRepository } from '../../src/kernel/git.mjs';
import { installProject } from '../../src/kernel/install.mjs';
import { callTorchTool } from '../../src/mcp/tools.mjs';
import { createCodexAdapter } from '../../src/adapters/codex.mjs';
import { planAreaUp, startFleet } from '../../src/runtime/lifecycle.mjs';
import { observeProject } from '../../src/observability/snapshot.mjs';

const CLI = new URL('../../bin/torch.mjs', import.meta.url).pathname;

test('SCN-domain-runtime-inheritance: new domain proposals follow a Codex-only Fleet default', () => {
  const context = fixture({ runtimes: ['codex'] });
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  try {
    const evolution = new FleetEvolutionService({ repositoryRoot: context.root, controlPlane: control });
    const count = control.listAgents().length;
    for (const [id, runtime] of [['payments', undefined], ['support', 'default']]) {
      const change = evolution.proposeDomain({ proposer: 'session-manager',
        domain: { id, title: id, scope: ['Recurring specialist work'], not_scope: ['Fleet operations'],
          owned_paths: ['src/' + id + '/**'], ...(runtime === undefined ? {} : { runtime }) },
        rationale: 'Recurring work needs a coherent owner.',
        expectedBenefit: { summary: 'Retain domain context', recurringWork: 'Several milestones',
          contextLocality: 'Stable specialist context', coordinationCost: 'One peer interface' },
        evidence: ['app.js'],
      });
      assert.equal(change.domain.runtime, 'codex');
      assert.equal(change.state, 'proposed');
    }
    assert.equal(control.listAgents().length, count, 'proposing does not create sessions');
  } finally { control.close(); }
});

function fixture({ boundary = false, runtimes } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'torch-evolution-'));
  const worktreeParent = mkdtempSync(join(tmpdir(), 'torch-evolution-worktrees-'));
  const env = { ...process.env, XDG_DATA_HOME: mkdtempSync(join(tmpdir(), 'torch-evolution-state-')) };
  execFileSync('git', ['init', '-b', 'main', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'torch-test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'TORCH Test']);
  writeFileSync(join(root, 'app.js'), 'export const app = true;\n');
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'fixture']);
  let repository = inspectRepository(root);
  const proposal = proposeDomains({ repository, analysis: analyzeRepository(repository) });
  if (boundary) {
    const template = proposal.domains[0];
    proposal.domains = [
      {
        ...template, id: 'alpha', title: 'Alpha', owned_paths: ['app.js', 'src/alpha/**'],
        neighbours: ['beta'], evidence: ['app.js'],
      },
      {
        ...template, id: 'beta', title: 'Beta', owned_paths: ['src/beta/**'],
        neighbours: ['alpha'], evidence: ['app.js'],
      },
    ];
  }
  proposal.paths = { worktree_parent: worktreeParent };
  proposal.review = {
    status: 'approved', reviewedAt: '2026-09-27T00:00:00Z', reviewedBy: 'fixture-owner', notes: [],
  };
  installProject({ repository, proposal, env, projectId: 'evolution-fixture', runtimes });
  execFileSync('git', ['-C', root, 'add', '.torch']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'install torch']);
  repository = inspectRepository(root);
  return { root, env, repository, worktreeParent };
}

function boundaryBenefit() {
  return {
    summary: 'Align persistent sessions with the recurring implementation boundary.',
    recurringWork: 'The same cross-domain changes recur across milestones.',
    contextLocality: 'Keep only the context needed by each durable responsibility.',
    coordinationCost: 'Reduce recurring handoffs without hiding the migration cost.',
  };
}

test('SCN-fleet-boundary-evolution: merge and split proposals are durable, owner-gated, and non-mutating', () => {
  const context = fixture({ boundary: true });
  const configPath = join(context.root, '.torch', 'torch.yaml');
  const rosterPath = join(context.root, '.torch', 'roster.yaml');
  const before = { config: readFileSync(configPath, 'utf8'), roster: readFileSync(rosterPath, 'utf8') };
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  let sequence = 0;
  const evolution = new FleetEvolutionService({
    repositoryRoot: context.root, controlPlane: control,
    clock: () => new Date('2026-09-27T14:00:00Z'), idFactory: () => `BOUNDARY-${++sequence}`,
  });
  const benefit = boundaryBenefit();
  const mergeInput = {
    sourceDomains: ['alpha', 'beta'],
    resultDomains: [{
      id: 'platform', title: 'Platform', kind: 'development',
      scope: ['combined alpha and beta implementation'], not_scope: ['Session Manager work'],
      owned_paths: ['app.js', 'src/alpha/**', 'src/beta/**'], shared_paths: [], neighbours: [],
      required_checks: [], resources: [], runtime: 'claude',
    }],
    ownershipAssignments: [
      { sourceDomainId: 'alpha', sourcePath: 'app.js', resultDomainId: 'platform' },
      { sourceDomainId: 'alpha', sourcePath: 'src/alpha/**', resultDomainId: 'platform' },
      { sourceDomainId: 'beta', sourcePath: 'src/beta/**', resultDomainId: 'platform' },
    ],
    rationale: 'Alpha and beta now change together and retain mostly identical context.',
    expectedBenefit: benefit, evidence: ['TASK-31', 'TASK-38'],
  };
  assert.throws(
    () => evolution.proposeMerge({ ...mergeInput, proposer: 'alpha' }),
    (error) => error.code === 'FLEET_CHANGE_AUTHORITY_REQUIRED',
  );
  assert.throws(
    () => evolution.proposeMerge({
      ...mergeInput, proposer: 'session-manager', ownershipAssignments: mergeInput.ownershipAssignments.slice(1),
    }),
    (error) => error.code === 'FLEET_OWNERSHIP_ASSIGNMENT_INVALID',
  );
  const merged = callTorchTool(control, 'torch_propose_domain_merge', {
    proposer: 'session-manager', source_domains: mergeInput.sourceDomains,
    result_domains: mergeInput.resultDomains.map((domain) => ({
      ...domain, scope: domain.scope, not_scope: domain.not_scope,
      owned_paths: domain.owned_paths, shared_paths: domain.shared_paths,
      required_checks: domain.required_checks,
    })),
    ownership_assignments: mergeInput.ownershipAssignments.map((assignment) => ({
      source_domain_id: assignment.sourceDomainId, source_path: assignment.sourcePath,
      result_domain_id: assignment.resultDomainId,
    })),
    rationale: mergeInput.rationale,
    expected_benefit: {
      summary: benefit.summary, recurring_work: benefit.recurringWork,
      context_locality: benefit.contextLocality, coordination_cost: benefit.coordinationCost,
    },
    evidence: mergeInput.evidence,
  }, { actorId: 'session-manager', evolutionService: evolution });
  assert.equal(merged.type, 'merge-domains');
  assert.equal(merged.proposal.schema, 'torch.dev/fleet-boundary-proposal/v1alpha1');
  evolution.approve({ changeId: merged.id, approvedBy: 'fixture-owner' });
  const plan = evolution.planActivation(merged.id);
  assert.equal(plan.canProceed, false);
  assert.equal(plan.blockers.some((blocker) => blocker.type === 'manual-boundary-redesign-required'), true);
  writeFileSync(configPath, `${before.config.trimEnd()}  \n`);
  assert.equal(evolution.planActivation(merged.id).blockers
    .some((blocker) => blocker.type === 'configuration-changed'), true);
  writeFileSync(configPath, before.config);
  assert.throws(
    () => evolution.activate({ changeId: merged.id, approvedBy: 'fixture-owner' }),
    (error) => error.code === 'FLEET_BOUNDARY_MIGRATION_REQUIRED',
  );
  assert.equal(readFileSync(configPath, 'utf8'), before.config);
  assert.equal(readFileSync(rosterPath, 'utf8'), before.roster);
  assert.deepEqual(control.listAgents().map((agent) => agent.areaId).sort(), ['alpha', 'beta', 'session-manager']);
  control.close();

  const splitPath = join(context.root, 'split-proposal.json');
  writeFileSync(splitPath, `${JSON.stringify({
    sourceDomains: ['alpha'],
    resultDomains: [
      {
        id: 'alpha-app', title: 'Alpha app', scope: ['application entrypoint'], not_scope: ['alpha internals'],
        owned_paths: ['app.js'], shared_paths: [], neighbours: ['alpha-internals'], required_checks: [], resources: [], runtime: 'claude',
      },
      {
        id: 'alpha-internals', title: 'Alpha internals', scope: ['alpha internals'], not_scope: ['application entrypoint'],
        owned_paths: ['src/alpha/**'], shared_paths: [], neighbours: ['alpha-app'], required_checks: [], resources: [], runtime: 'claude',
      },
    ],
    ownershipAssignments: [
      { sourceDomainId: 'alpha', sourcePath: 'app.js', resultDomainId: 'alpha-app' },
      { sourceDomainId: 'alpha', sourcePath: 'src/alpha/**', resultDomainId: 'alpha-internals' },
    ],
    rationale: 'Alpha now contains two recurring responsibilities with different context.',
    expectedBenefit: benefit, evidence: ['TASK-44', 'ownership review'],
  }, null, 2)}\n`);
  const run = (args) => spawnSync(process.execPath, [CLI, ...args], {
    cwd: context.root, env: context.env, encoding: 'utf8',
  });
  const proposed = run(['fleet', 'propose-split', '--from', 'session-manager', '--proposal', splitPath, '--json']);
  assert.equal(proposed.status, 0, proposed.stderr || proposed.stdout);
  const split = JSON.parse(proposed.stdout);
  assert.equal(split.type, 'split-domain');
  const refused = run(['fleet', 'reject', '--change', split.id, '--by', 'fixture-owner', '--reason', 'Wait for milestone.', '--json']);
  assert.equal(refused.status, 2);
  assert.equal(JSON.parse(refused.stdout).error, 'APPROVAL_REQUIRED');
  const rejected = run(['fleet', 'reject', '--change', split.id, '--by', 'fixture-owner', '--reason', 'Wait for milestone.', '--yes', '--json']);
  assert.equal(rejected.status, 0, rejected.stderr || rejected.stdout);
  assert.equal(JSON.parse(rejected.stdout).state, 'rejected');
  assert.equal(JSON.parse(rejected.stdout).rejectionReason, 'Wait for milestone.');
  const reopened = openControlPlane({ repositoryRoot: context.root, env: context.env });
  const persisted = new FleetEvolutionService({ repositoryRoot: context.root, controlPlane: reopened }).get(merged.id);
  assert.equal(persisted.type, 'merge-domains');
  assert.equal(persisted.proposal.resultDomains[0].id, 'platform');
  assert.equal(new FleetEvolutionService({ repositoryRoot: context.root, controlPlane: reopened })
    .get(split.id).rejectionReason, 'Wait for milestone.');
  reopened.close();
});

test('SCN-fleet-evolution: the manager proposes and owner activates a newly justified persistent domain', () => {
  const context = fixture({ runtimes: ['claude', 'codex'] });
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  const evolution = new FleetEvolutionService({
    repositoryRoot: context.root,
    controlPlane: control,
    clock: () => new Date('2026-09-27T12:00:00Z'),
    idFactory: () => 'CHANGE-1',
  });
  const worker = control.listAgents().find((agent) => agent.areaId !== 'session-manager').areaId;
  control.requestHandoff({
    sender: worker, path: 'src/payments/intents.js',
    reason: 'No current domain owns the payment intent boundary.',
  });
  control.requestHandoff({
    sender: worker, path: 'src/payments/settlement.js',
    reason: 'Settlement work again has no coherent owner.',
  });
  assert.throws(
    () => evolution.assessDomainNeeds({ assessor: worker }),
    (error) => error.code === 'FLEET_CHANGE_AUTHORITY_REQUIRED',
  );
  const assessment = callTorchTool(control, 'torch_assess_fleet_evolution', {}, {
    actorId: 'session-manager', evolutionService: evolution,
  });
  assert.equal(assessment.recommendation.action, 'consider-new-domain');
  assert.equal(assessment.signals[0].code, 'RECURRING_UNOWNED_PATH_BOUNDARY');
  assert.equal(assessment.signals[0].boundary, 'src/payments');
  assert.equal(assessment.mutationPerformed, false);
  assert.equal(evolution.list().length, 0, 'assessment must not create a Fleet change');
  const request = {
    domain: {
      id: 'payments', title: 'Payment systems', kind: 'development',
      scope: ['payment intent lifecycle and settlement verification'],
      not_scope: ['checkout presentation'], owned_paths: ['src/payments/**'],
      shared_paths: ['src/contracts/payment-schema.js'], neighbours: [worker],
      required_checks: [], resources: [], runtime: 'codex', model: 'gpt-test',
    },
    rationale: 'Repeated payment work has no coherent owner in the current Fleet.',
    expectedBenefit: {
      summary: 'Retain payment-domain context across recurring settlement work.',
      recurringWork: 'Three queued milestones and ongoing incident ownership.',
      contextLocality: 'Avoid reloading payment invariants into unrelated sessions.',
      coordinationCost: 'One explicit API boundary with the existing core domain.',
    },
    evidence: ['docs/product-spec.md:42', 'TASK-17', 'TASK-23'],
  };
  assert.throws(
    () => evolution.proposeDomain({ ...request, proposer: worker }),
    (error) => error.code === 'FLEET_CHANGE_AUTHORITY_REQUIRED',
  );
  const proposed = callTorchTool(control, 'torch_propose_domain', {
    proposer: 'session-manager', domain: request.domain, rationale: request.rationale,
    expected_benefit: {
      summary: request.expectedBenefit.summary,
      recurring_work: request.expectedBenefit.recurringWork,
      context_locality: request.expectedBenefit.contextLocality,
      coordination_cost: request.expectedBenefit.coordinationCost,
    },
    evidence: request.evidence,
  }, { actorId: 'session-manager', evolutionService: evolution });
  assert.equal(proposed.state, 'proposed');
  assert.equal(control.listAgents().some((agent) => agent.areaId === 'payments'), false);
  assert.throws(
    () => evolution.activate({ changeId: proposed.id, approvedBy: 'fixture-owner' }),
    (error) => error.code === 'FLEET_CHANGE_AUTHORITY_REQUIRED',
  );
  const approved = evolution.approve({ changeId: proposed.id, approvedBy: 'fixture-owner' });
  assert.equal(approved.state, 'approved');
  const observed = observeProject({ repositoryRoot: context.root, env: context.env });
  assert.equal(observed.fleetChanges[0].domainId, 'payments');
  assert.equal(observed.fleetChanges[0].state, 'approved');
  const plan = evolution.planActivation(proposed.id);
  assert.equal(plan.canProceed, true, JSON.stringify(plan.blockers));
  assert.equal(plan.mutationPerformed, false);

  const activated = evolution.activate({ changeId: proposed.id, approvedBy: 'fixture-owner' });
  assert.equal(activated.state, 'active');
  assert.equal(activated.identity.areaId, 'payments');
  assert.equal(activated.identity.state, 'offline');
  assert.equal(activated.identity.model, 'gpt-test');
  assert.equal(existsSync(activated.worktree), true);
  const paymentPromptPath = join(activated.worktree, '.torch', 'prompts', 'payments.md');
  assert.equal(existsSync(paymentPromptPath), true);
  const paymentPrompt = readFileSync(paymentPromptPath, 'utf8');
  assert.match(paymentPrompt, /## Owned paths[\s\S]*src\/payments\/\*\*/);
  assert.match(paymentPrompt, /## Authority/);
  assert.match(paymentPrompt, /## Initial backlog/);
  assert.equal(execFileSync('git', ['-C', activated.worktree, 'status', '--porcelain'], { encoding: 'utf8' }), '');
  assert.equal(execFileSync('git', ['-C', context.root, 'status', '--porcelain'], { encoding: 'utf8' }), '');
  const roster = JSON.parse(readFileSync(join(context.root, '.torch', 'roster.yaml'), 'utf8'));
  assert.equal(roster.areas.find((area) => area.id === worker).neighbours.includes('payments'), true);
  assert.equal(roster.areas.find((area) => area.id === 'payments').neighbours.includes(worker), true);
  assert.match(execFileSync('git', ['-C', context.root, 'log', '-1', '--pretty=%s'], { encoding: 'utf8' }), /add payments domain/);
  const adapter = createCodexAdapter({ executable: '/opt/codex/bin/codex' });
  const adapters = new Map([['codex', adapter]]);
  const startPlan = planAreaUp({
    repositoryRoot: context.root, controlPlane: control, areaId: 'payments', adapters, fresh: true,
  });
  assert.equal(startPlan.canProceed, true, JSON.stringify(startPlan.blockers));
  assert.deepEqual(startPlan.actions.map((action) => action.areaId), ['payments']);
  const started = startFleet({
    plan: startPlan, controlPlane: control, adapters,
    executor: () => ({
      status: 0, stdout: '{"type":"thread.started","thread_id":"payments-thread"}\n{"type":"turn.completed"}\n',
    }),
  });
  assert.equal(started.started[0].runtimeSessionId, 'payments-thread');
  assert.equal(control.identity('payments').state, 'idle');
  control.close();

  const reopened = openControlPlane({ repositoryRoot: context.root, env: context.env });
  assert.equal(reopened.identity('payments').areaId, 'payments');
  const persisted = new FleetEvolutionService({ repositoryRoot: context.root, controlPlane: reopened }).get(proposed.id);
  assert.equal(persisted.activationCommit, activated.activationCommit);
  reopened.close();
});

test('SCN-cli-fleet-evolution: public CLI separates manager proposal, owner approval, plan, and activation', () => {
  const context = fixture();
  const inputPath = join(context.root, 'domain-change.json');
  writeFileSync(inputPath, `${JSON.stringify({
    domain: {
      id: 'security', title: 'Security engineering', scope: ['threat modeling and security checks'],
      not_scope: ['general feature implementation'], owned_paths: ['security/**'],
      shared_paths: [], neighbours: [], required_checks: [], runtime: 'claude',
    },
    rationale: 'Recurring threat-model and audit work lacks a durable owner.',
    expectedBenefit: {
      summary: 'Keep security assumptions focused and reviewable.',
      recurringWork: 'Security review recurs at each release.',
      contextLocality: 'Retain threat models instead of reloading them into feature sessions.',
      coordinationCost: 'The Session Manager coordinates explicit review requests.',
    },
    evidence: ['docs/security-model.md:1', 'release policy'],
  }, null, 2)}\n`);
  execFileSync('git', ['-C', context.root, 'add', 'domain-change.json']);
  execFileSync('git', ['-C', context.root, 'commit', '-m', 'add domain proposal input']);
  const run = (args) => spawnSync(process.execPath, [CLI, ...args], {
    cwd: context.root, env: context.env, encoding: 'utf8',
  });
  const assessment = run(['fleet', 'assess', '--from', 'session-manager', '--json']);
  assert.equal(assessment.status, 0, assessment.stderr || assessment.stdout);
  assert.equal(JSON.parse(assessment.stdout).recommendation.action, 'retain-current-fleet');
  const proposedResult = run(['fleet', 'propose', '--from', 'session-manager', '--proposal', inputPath, '--json']);
  assert.equal(proposedResult.status, 0, proposedResult.stderr || proposedResult.stdout);
  const proposed = JSON.parse(proposedResult.stdout);
  const refused = run(['fleet', 'approve', '--change', proposed.id, '--by', 'fixture-owner', '--json']);
  assert.equal(refused.status, 2);
  assert.equal(JSON.parse(refused.stdout).error, 'APPROVAL_REQUIRED');
  assert.equal(run(['fleet', 'approve', '--change', proposed.id, '--by', 'fixture-owner', '--yes', '--json']).status, 0);
  const plan = run(['fleet', 'plan', '--change', proposed.id, '--json']);
  assert.equal(plan.status, 0, plan.stderr || plan.stdout);
  assert.equal(JSON.parse(plan.stdout).canProceed, true);
  const activated = run(['fleet', 'activate', '--change', proposed.id, '--by', 'fixture-owner', '--yes', '--json']);
  assert.equal(activated.status, 0, activated.stderr || activated.stdout);
  assert.equal(JSON.parse(activated.stdout).identity.areaId, 'security');
  const startPlan = run(['fleet', 'start', '--change', proposed.id, '--fresh', '--dry-run', '--json']);
  assert.equal(startPlan.status, 0, startPlan.stderr || startPlan.stdout);
  assert.deepEqual(JSON.parse(startPlan.stdout).actions.map((action) => action.areaId), ['security']);
  assert.equal(run(['agent', '--area', 'security', '--json']).status, 0);
});

test('SCN-fleet-retirement: owner-approved retirement shrinks the roster without deleting branch history', () => {
  const context = fixture();
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  let sequence = 0;
  const evolution = new FleetEvolutionService({
    repositoryRoot: context.root, controlPlane: control, idFactory: () => `CHANGE-${++sequence}`,
  });
  const existing = control.listAgents().find((agent) => agent.areaId !== 'session-manager').areaId;
  const addition = evolution.proposeDomain({
    proposer: 'session-manager',
    domain: {
      id: 'review', title: 'Review', scope: ['cross-boundary review'], not_scope: ['feature implementation'],
      owned_paths: ['review/**'], shared_paths: [], neighbours: [existing], required_checks: [], resources: [], runtime: 'claude',
    },
    rationale: 'Milestone reviews recur without a coherent owner.',
    expectedBenefit: {
      summary: 'Keep a recurring review boundary focused.', recurringWork: 'Review work recurs each milestone.',
      contextLocality: 'Retain the review assumptions in one session.', coordinationCost: 'One explicit handoff.',
    },
    evidence: ['TASK-9'],
  });
  evolution.approve({ changeId: addition.id, approvedBy: 'fixture-owner' });
  const activated = evolution.activate({ changeId: addition.id, approvedBy: 'fixture-owner' });
  assert.equal(existsSync(activated.worktree), true);

  const retirement = callTorchTool(control, 'torch_propose_domain_retirement', {
    area_id: 'review',
    rationale: 'The review stream ended and a permanent session now costs more coordination than it saves.',
    expected_benefit: {
      summary: 'Shrink routine coordination while preserving review history.',
      recurring_work: 'No recurring review work remains after the milestone.',
      context_locality: 'Future isolated reviews can use bounded temporary help.',
      coordination_cost: 'Removes an idle persistent handoff boundary.',
    },
    evidence: ['TASK-9 completed', 'decision: review milestone closed'],
  }, { actorId: 'session-manager', evolutionService: evolution });
  assert.equal(retirement.type, 'retire-domain');
  evolution.approve({ changeId: retirement.id, approvedBy: 'fixture-owner' });

  control.reportStatus({ areaId: 'review', state: 'idle', summary: 'Awaiting retirement.' });
  assert.equal(evolution.planActivation(retirement.id).blockers
    .some((blocker) => blocker.type === 'runtime-not-offline'), true);
  control.reportStatus({ areaId: 'review', state: 'offline', summary: 'Stopped.' });
  writeFileSync(join(activated.worktree, 'dirty.txt'), 'preserve me\n');
  assert.equal(evolution.planActivation(retirement.id).blockers
    .some((blocker) => blocker.type === 'worktree-unsafe' && blocker.problem === 'worktree-dirty'), true);
  execFileSync('git', ['-C', activated.worktree, 'clean', '-f', '--', 'dirty.txt']);

  const plan = evolution.planActivation(retirement.id);
  assert.equal(plan.canProceed, true, JSON.stringify(plan.blockers));
  const retired = evolution.activate({ changeId: retirement.id, approvedBy: 'fixture-owner' });
  assert.equal(retired.state, 'retired');
  assert.equal(existsSync(activated.worktree), false);
  assert.notEqual(execFileSync('git', ['-C', context.root, 'branch', '--list', activated.branch], { encoding: 'utf8' }).trim(), '');
  assert.equal(control.listAgents().some((agent) => agent.areaId === 'review'), false);
  const config = JSON.parse(readFileSync(join(context.root, '.torch', 'torch.yaml'), 'utf8'));
  assert.equal(config.domains.some((domain) => domain.id === 'review'), false);
  assert.equal(config.retired_domains.some((domain) => domain.id === 'review' && domain.branch === activated.branch), true);
  assert.match(execFileSync('git', ['-C', context.root, 'log', '-1', '--pretty=%s'], { encoding: 'utf8' }), /retire review domain/);
  control.close();
});
