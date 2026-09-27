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

function fixture() {
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
  proposal.paths = { worktree_parent: worktreeParent };
  proposal.review = {
    status: 'approved', reviewedAt: '2026-09-27T00:00:00Z', reviewedBy: 'fixture-owner', notes: [],
  };
  installProject({ repository, proposal, env, projectId: 'evolution-fixture' });
  execFileSync('git', ['-C', root, 'add', '.torch']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'install torch']);
  repository = inspectRepository(root);
  return { root, env, repository, worktreeParent };
}

test('SCN-fleet-evolution: the manager proposes and owner activates a newly justified persistent domain', () => {
  const context = fixture();
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  const evolution = new FleetEvolutionService({
    repositoryRoot: context.root,
    controlPlane: control,
    clock: () => new Date('2026-09-27T12:00:00Z'),
    idFactory: () => 'CHANGE-1',
  });
  const worker = control.listAgents().find((agent) => agent.areaId !== 'session-manager').areaId;
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
  assert.equal(existsSync(join(activated.worktree, '.torch', 'prompts', 'payments.md')), true);
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
