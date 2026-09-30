import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { analyzeRepository } from '../../src/kernel/analyze.mjs';
import { createFleetDesignBrief } from '../../src/design/brief.mjs';
import {
  createArchitectRunPlan, runSessionArchitect, validateArchitectProposal,
} from '../../src/design/architect.mjs';
import { proposeDomains, validateApprovedProposal } from '../../src/kernel/domains.mjs';
import { inspectRepository } from '../../src/kernel/git.mjs';
import { inspectSpecifications } from '../../src/kernel/specifications.mjs';

const CLI = new URL('../../bin/torch.mjs', import.meta.url).pathname;

function repositoryFixture() {
  const root = mkdtempSync(join(tmpdir(), 'torch-spec-project-'));
  execFileSync('git', ['init', '-b', 'main', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'torch-test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'TORCH Test']);
  writeFileSync(join(root, 'README.md'), '# New project\n');
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'empty project shell']);
  return root;
}

function specificationFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'torch-spec-input-'));
  const path = join(directory, 'garden-product.md');
  writeFileSync(path, `# Garden Planner Product Specification

## Client experience

- The client must let a household plan beds and seasonal planting.
- The interface should remain useful offline.

## Plant data service

- The service must maintain the crop catalog and planting rules.
- Data changes require provenance.

## Quality and release

- Testing must cover saved plans and offline recovery.
- Release operations require owner approval.
`);
  return path;
}

function flatOrganizationAssessment(proposal) {
  return {
    shape: 'flat',
    rationale: 'Current evidence does not establish recurring cross-domain integration load that warrants a standing lead.',
    evidence: [proposal.domains.find((domain) => domain.evidence.length)?.evidence[0]],
    authority_boundaries: {
      implementation_ownership: 'Each implementation surface retains one accountable specialist owner.',
      coordination_responsibility: 'The Session Manager coordinates cross-domain sequencing without taking code ownership.',
      fleet_operations_authority: 'The Session Manager handles session, worktree, check, schedule, and fleet-health mechanics.',
      project_priority_authority: 'The owner sets project priorities; the Session Manager dispatches within that direction.',
      independent_review_authority: 'QA reports verification evidence independently from implementation ownership.',
      owner_only_decisions: ['Product direction', 'Owner approval of persistent organization changes'],
    },
    proposed_coordination_roles: [],
    direct_peer_communication: 'preserved',
  };
}

test('SCN-spec-fleet-design: a prose-only project spec produces reviewable responsibilities without invented paths', () => {
  const root = repositoryFixture();
  const specPath = specificationFixture();
  const repository = inspectRepository(root);
  const before = execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' });
  const specifications = inspectSpecifications([specPath], { repositoryRoot: root });
  const proposal = proposeDomains({
    repository,
    analysis: analyzeRepository(repository, { specifications }),
  });
  assert.deepEqual(proposal.domains.map((domain) => domain.id), [
    'client-experience', 'plant-data-service', 'quality-and-release',
  ]);
  assert.equal(proposal.domains.every((domain) => domain.scope.length > 0), true);
  assert.equal(proposal.domains.every((domain) => domain.owned_paths.length === 0), true);
  assert.equal(proposal.domains.every((domain) => domain.design_status === 'needs-owner-path-review'), true);
  assert.equal(proposal.specifications[0].sha256.length, 64);
  assert.equal(execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }), before);

  proposal.review = {
    status: 'approved', reviewedAt: '2026-09-27T00:00:00Z', reviewedBy: 'fixture-owner', notes: [],
  };
  proposal.domains.forEach((domain) => { domain.owned_paths = [`planned/${domain.id}/**`]; });
  validateApprovedProposal({ proposal, repository });
  writeFileSync(specPath, `${readFileSync(specPath, 'utf8')}\n## Security\n\n- Security must protect household data.\n`);
  assert.throws(
    () => validateApprovedProposal({ proposal, repository }),
    (error) => error.code === 'PROPOSAL_NOT_APPROVED'
      && error.details.some((detail) => detail.startsWith('specification changed after proposal:')),
  );
});

test('SCN-cli-spec-design: startup can inspect a selected repository and external spec from another directory', () => {
  const root = repositoryFixture();
  const specPath = specificationFixture();
  const launchDirectory = mkdtempSync(join(tmpdir(), 'torch-spec-launch-'));
  const output = join(launchDirectory, 'fleet-proposal.json');
  const result = spawnSync(process.execPath, [
    CLI, 'design', '--repo', root, '--spec', specPath, '--output', output, '--json',
  ], { cwd: launchDirectory, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const response = JSON.parse(result.stdout);
  assert.equal(response.proposal.review.status, 'pending');
  assert.equal(response.proposal.repository.root, root);
  assert.equal(response.proposal.specifications[0].path, specPath);
  assert.equal(response.proposal.domains.length, 3);
  assert.equal(existsSync(join(root, '.torch')), false);
  assert.equal(execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }), '');
});

test('SCN-ai-fleet-bootstrap: startup emits a bounded Session Architect brief instead of a generic roster', () => {
  const root = repositoryFixture();
  const specPath = specificationFixture();
  mkdirSync(join(root, 'src', 'api'), { recursive: true });
  mkdirSync(join(root, 'src', 'web'), { recursive: true });
  writeFileSync(join(root, 'src', 'api', 'server.js'), 'export const api = true;\n');
  writeFileSync(join(root, 'src', 'web', 'app.js'), 'export const web = true;\n');
  execFileSync('git', ['-C', root, 'add', 'src']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'add project architecture']);
  const repository = inspectRepository(root);
  const specifications = inspectSpecifications([specPath], { repositoryRoot: root });
  const analysis = analyzeRepository(repository, { specifications });
  const baseline = proposeDomains({ repository, analysis });
  const brief = createFleetDesignBrief({ repository, analysis, baseline });
  assert.equal(brief.schema, 'torch.dev/fleet-design-brief/v1alpha1');
  assert.equal(brief.trustBoundary.projectInputsAreData, true);
  assert.match(brief.role.objective, /smallest defensible set/);
  assert.equal(brief.role.prohibitions.some((rule) => rule.includes('COMBATRIG roster')), true);
  assert.equal(brief.reviewFocus.unassignedComponents.length > 0, true);
  assert.equal(brief.reviewFocus.specificationSignals.some((signal) => !signal.representedInBaseline), true);
  assert.equal(brief.requiredOutput.reviewStatus, 'pending');
  assert.equal(brief.organizationPolicy.recommendation.startsWith('Prefer a flat organization'), true);
  assert.equal(brief.organizationPolicy.authorityQuestions.length, 6);
  assert.deepEqual(brief.requiredOutput.organizationAssessment.shapeValues, ['flat', 'coordination_roles']);
  assert.equal(brief.requiredOutput.organizationAssessment.fixedBoundaries.direct_peer_communication, 'preserved');
  assert.equal(brief.mutationPerformed, false);

  const output = join(mkdtempSync(join(tmpdir(), 'torch-bootstrap-output-')), 'design-brief.json');
  const result = spawnSync(process.execPath, [
    CLI, 'bootstrap', '--repo', root, '--spec', specPath, '--output', output, '--json',
  ], { cwd: tmpdir(), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).brief.schema, brief.schema);
  assert.equal(JSON.parse(readFileSync(output, 'utf8')).role.name, 'Session Architect');
  assert.equal(execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }), '');

});

test('SCN-bootstrap-primary-ownership: pending and approved rosters reject duplicate and recursive primary claims, not shared consultation', () => {
  const root = repositoryFixture();
  for (const name of ['api', 'world']) {
    mkdirSync(join(root, 'src', name), { recursive: true });
    writeFileSync(join(root, 'src', name, 'index.mjs'), 'export const ready = true;\n');
    writeFileSync(join(root, 'src', name, 'helper.mjs'), 'export const helper = true;\n');
  }
  execFileSync('git', ['-C', root, 'add', 'src']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'independent implementation surfaces']);
  const repository = inspectRepository(root);
  const analysis = analyzeRepository(repository);
  const baseline = proposeDomains({ repository, analysis });
  const brief = createFleetDesignBrief({ repository, analysis, baseline });
  const proposal = structuredClone(baseline);
  proposal.organization_assessment = flatOrganizationAssessment(proposal);
  const api = proposal.domains.find((domain) => domain.owned_paths.includes('src/api/**'));
  const world = proposal.domains.find((domain) => domain.owned_paths.includes('src/world/**'));
  assert.ok(api && world);
  world.shared_paths.push(...api.owned_paths);
  assert.equal(validateArchitectProposal({ brief, proposal }).valid, true);
  const duplicate = structuredClone(proposal);
  duplicate.domains.find((domain) => domain.id === world.id).owned_paths.push(...api.owned_paths);
  const rejected = validateArchitectProposal({ brief, proposal: duplicate });
  assert.equal(rejected.valid, false);
  assert.ok(rejected.problems.some((problem) => problem.includes('primary ownership overlaps:')));
  const approve = (value) => ({ ...structuredClone(value), review: {
    status: 'approved', reviewedAt: '2026-09-30T00:00:00Z', reviewedBy: 'fixture-owner', notes: [],
  } });
  validateApprovedProposal({ proposal: approve(proposal), repository });
  for (const claims of [api.owned_paths, ['src/**'], ['**'], ['src\\api\\**']]) {
    const collision = approve(proposal);
    collision.domains.find((domain) => domain.id === world.id).owned_paths.push(...claims);
    assert.throws(() => validateApprovedProposal({ proposal: collision, repository }),
      (error) => error.code === 'PROPOSAL_NOT_APPROVED'
        && error.details.some((problem) => problem.includes('primary ownership overlaps:')));
  }
  const future = approve(proposal);
  future.domains.find((domain) => domain.id === api.id).owned_paths = ['planned/api/**'];
  future.domains.find((domain) => domain.id === world.id).owned_paths = ['planned/api/new/**'];
  assert.throws(() => validateApprovedProposal({ proposal: future, repository }),
    (error) => error.code === 'PROPOSAL_NOT_APPROVED'
      && error.details.some((problem) => problem.includes('primary ownership overlaps:')));
  assert.equal(execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }), '');
});

test('SCN-architect-organization-assessment: hierarchy recommendations are evidence-backed, bounded, and preserve peer links', () => {
  const root = repositoryFixture();
  mkdirSync(join(root, 'src', 'api'), { recursive: true });
  mkdirSync(join(root, 'src', 'world'), { recursive: true });
  writeFileSync(join(root, 'src', 'api', 'server.mjs'), 'export const api = true;\n');
  writeFileSync(join(root, 'src', 'api', 'routes.mjs'), 'export const routes = true;\n');
  writeFileSync(join(root, 'src', 'world', 'map.mjs'), 'export const map = true;\n');
  writeFileSync(join(root, 'src', 'world', 'terrain.mjs'), 'export const terrain = true;\n');
  execFileSync('git', ['-C', root, 'add', 'src']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'add API and world systems']);

  const repository = inspectRepository(root);
  const analysis = analyzeRepository(repository);
  const baseline = proposeDomains({ repository, analysis });
  const brief = createFleetDesignBrief({ repository, analysis, baseline });
  const outputSchema = JSON.parse(readFileSync(new URL('../../schemas/domain-proposal.schema.json', import.meta.url), 'utf8'));
  assert.equal(outputSchema.required.includes('organization_assessment'), true);
  assert.deepEqual(
    outputSchema.properties.organization_assessment.properties.proposed_coordination_roles.items
      .properties.owns_implementation_paths,
    { const: false },
  );
  const api = baseline.domains.find((domain) => domain.owned_paths.includes('src/api/**'));
  const world = baseline.domains.find((domain) => domain.owned_paths.includes('src/world/**'));
  assert.ok(api && world, 'fixture produces independently evidenced domains');
  const proposal = structuredClone(baseline);
  proposal.organization_assessment = {
    shape: 'coordination_roles',
    rationale: 'The API and world systems must repeatedly integrate to deliver a coherent generated environment.',
    evidence: [api.evidence[0], world.evidence[0]],
    authority_boundaries: {
      implementation_ownership: 'API and world specialists retain their own implementation paths.',
      coordination_responsibility: 'The proposed lead sequences the API/world integration outcome.',
      fleet_operations_authority: 'The Session Manager retains session and worktree operations.',
      project_priority_authority: 'The owner controls project priority; cross-domain ordering follows owner direction.',
      independent_review_authority: 'QA verifies the integrated outcome without acquiring implementation ownership.',
      owner_only_decisions: ['Product scope', 'Persistent organization changes'],
    },
    proposed_coordination_roles: [{
      id: 'environment-integration-lead',
      title: 'Environment Integration Lead',
      coordinates_domains: [api.id, world.id],
      integrated_outcome: 'A generated environment whose API-backed world data is traversable and verifiable.',
      decision_scope: ['Sequence shared interface work', 'Resolve domain-level integration ordering'],
      owner_escalations: ['Changes to product scope or owner-set priorities'],
      evidence: [api.evidence[0], world.evidence[0]],
      owns_implementation_paths: false,
      has_owner_approval_authority: false,
    }],
    direct_peer_communication: 'preserved',
  };
  assert.equal(validateArchitectProposal({ brief, proposal }).valid, true);

  for (const runtime of ['default', 'pi', 'local-fixture']) {
    const portable = structuredClone(proposal);
    portable.domains[0].runtime = runtime;
    const validation = validateArchitectProposal({ brief, proposal: portable });
    assert.equal(validation.valid, true, JSON.stringify(validation.problems));
    assert.equal(portable.review.status, 'pending');
  }
  const invalidRuntime = structuredClone(proposal);
  invalidRuntime.domains[0].runtime = '../execute-this';
  assert.equal(validateArchitectProposal({ brief, proposal: invalidRuntime }).problems
    .some((problem) => problem.includes('invalid runtime identifier')), true);

  const missingEvidence = structuredClone(proposal);
  missingEvidence.organization_assessment.proposed_coordination_roles[0].evidence = ['owner-approved-without-evidence'];
  assert.equal(validateArchitectProposal({ brief, proposal: missingEvidence }).problems
    .some((problem) => problem.includes('cited unknown evidence')), true);

  const duplicateOwner = structuredClone(proposal);
  duplicateOwner.organization_assessment.proposed_coordination_roles[0].owns_implementation_paths = true;
  assert.equal(validateArchitectProposal({ brief, proposal: duplicateOwner }).problems
    .some((problem) => problem.includes('must not receive implementation ownership')), true);

  const bypassOwner = structuredClone(proposal);
  bypassOwner.organization_assessment.proposed_coordination_roles[0].has_owner_approval_authority = true;
  assert.equal(validateArchitectProposal({ brief, proposal: bypassOwner }).problems
    .some((problem) => problem.includes('must not receive owner-approval authority')), true);

  const routedPeers = structuredClone(proposal);
  routedPeers.organization_assessment.direct_peer_communication = 'manager-only';
  assert.equal(validateArchitectProposal({ brief, proposal: routedPeers }).problems
    .some((problem) => problem.includes('preserve direct peer communication')), true);

  const unresolved = structuredClone(proposal);
  unresolved.organization_assessment.shape = 'undetermined';
  assert.equal(validateArchitectProposal({ brief, proposal: unresolved }).problems
    .some((problem) => problem.includes('must choose flat or coordination_roles')), true);

  const unknownAuthority = structuredClone(proposal);
  unknownAuthority.organization_assessment.approval_role = 'owner';
  assert.equal(validateArchitectProposal({ brief, proposal: unknownAuthority }).problems
    .some((problem) => problem.includes('unsupported field: approval_role')), true);

  const duplicateDomain = structuredClone(proposal);
  duplicateDomain.organization_assessment.proposed_coordination_roles[0].coordinates_domains = [api.id, api.id];
  assert.equal(validateArchitectProposal({ brief, proposal: duplicateDomain }).problems
    .some((problem) => problem.includes('duplicate domain references')), true);
});

test('SCN-ai-fleet-planning: an explicit provider returns a semantically bounded pending proposal', async () => {
  const root = repositoryFixture();
  const specPath = specificationFixture();
  mkdirSync(join(root, 'src', 'api'), { recursive: true });
  writeFileSync(join(root, 'src', 'api', 'server.js'), 'export const api = true;\n');
  writeFileSync(join(root, 'src', 'api', 'routes.js'), 'export const routes = true;\n');
  execFileSync('git', ['-C', root, 'add', 'src']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'add API architecture']);
  const repository = inspectRepository(root);
  const specifications = inspectSpecifications([specPath], { repositoryRoot: root });
  const analysis = analyzeRepository(repository, { specifications });
  const proposal = proposeDomains({ repository, analysis });
  proposal.organization_assessment = flatOrganizationAssessment(proposal);
  const brief = createFleetDesignBrief({ repository, analysis, baseline: proposal });
  const codexPlan = createArchitectRunPlan({ brief, provider: 'codex', model: 'gpt-test' });
  assert.equal(codexPlan.args.includes('read-only'), true);
  assert.equal(codexPlan.args.includes('--ignore-rules'), true);
  assert.equal(codexPlan.providerCallPerformed, false);
  const claudePlan = createArchitectRunPlan({ brief, provider: 'claude', maxBudgetUsd: 1 });
  assert.equal(claudePlan.args.includes('plan'), true);
  assert.equal(claudePlan.args.includes('--no-session-persistence'), true);
  assert.equal(claudePlan.args.includes('--safe-mode'), true);
  assert.equal(claudePlan.args.includes('--restricted'), true);
  await assert.rejects(
    () => runSessionArchitect({ brief, provider: 'codex', executor: async () => ({ proposal }) }),
    (error) => error.code === 'ARCHITECT_EXECUTION_NOT_AUTHORIZED',
  );
  const result = await runSessionArchitect({
    brief, provider: 'codex', model: 'gpt-test', authorized: true,
    executor: async () => ({
      status: 0,
      stdout: `${JSON.stringify({
        type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify(proposal) },
      })}\n`,
      usage: { measurement: 'measured', inputTokens: 100, outputTokens: 50 },
    }),
  });
  assert.equal(result.validation.valid, true, JSON.stringify(result.validation.problems));
  assert.equal(result.proposal.review.status, 'pending');
  assert.equal(result.providerCallPerformed, true);
  assert.equal(result.usage.measurement, 'measured');

  const invented = structuredClone(proposal);
  invented.domains[0].owned_paths = ['invented/**'];
  invented.review = { status: 'approved', reviewedAt: 'now', reviewedBy: 'model', notes: [] };
  const rejected = validateArchitectProposal({ brief, proposal: invented });
  assert.equal(rejected.valid, false);
  assert.equal(rejected.problems.some((problem) => problem.includes('unapproved')), true);
  assert.equal(rejected.problems.some((problem) => problem.includes('invented owned path')), true);

  const launchDirectory = mkdtempSync(join(tmpdir(), 'torch-architect-cli-'));
  const briefPath = join(launchDirectory, 'brief.json');
  const proposalPath = join(launchDirectory, 'proposal.json');
  writeFileSync(briefPath, `${JSON.stringify(brief, null, 2)}\n`);
  writeFileSync(proposalPath, `${JSON.stringify(proposal, null, 2)}\n`);
  const planned = spawnSync(process.execPath, [
    CLI, 'architect', 'plan', '--brief', briefPath, '--provider', 'codex', '--json',
  ], { cwd: launchDirectory, encoding: 'utf8' });
  assert.equal(planned.status, 0, planned.stderr || planned.stdout);
  assert.equal(JSON.parse(planned.stdout).providerCallPerformed, false);
  const unauthorizedRun = spawnSync(process.execPath, [
    CLI, 'architect', 'run', '--brief', briefPath, '--provider', 'codex',
    '--output', join(launchDirectory, 'should-not-exist.json'), '--json',
  ], { cwd: launchDirectory, encoding: 'utf8' });
  assert.equal(unauthorizedRun.status, 2);
  assert.equal(JSON.parse(unauthorizedRun.stdout).error, 'APPROVAL_REQUIRED');
  assert.equal(existsSync(join(launchDirectory, 'should-not-exist.json')), false);
  const validated = spawnSync(process.execPath, [
    CLI, 'architect', 'validate', '--brief', briefPath, '--response', proposalPath, '--json',
  ], { cwd: launchDirectory, encoding: 'utf8' });
  assert.equal(validated.status, 0, validated.stderr || validated.stdout);
  assert.equal(JSON.parse(validated.stdout).validation.ownerReviewRequired, true);
  assert.equal(execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }), '');

  writeFileSync(join(root, 'src', 'api', 'server.js'), 'export const api = false;\n');
  writeFileSync(specPath, `${readFileSync(specPath, 'utf8')}\n## Changed requirement\n\n- The service must record revised planting dates.\n`);
  const stale = validateArchitectProposal({ brief, proposal });
  assert.equal(stale.problems.includes('repository working tree changed after the design brief was generated'), true);
  assert.equal(stale.problems.some((problem) => problem.startsWith('specification changed after proposal:')), true);
});
