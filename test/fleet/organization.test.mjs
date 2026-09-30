import assert from 'node:assert/strict';
import test from 'node:test';
import { projectConfigSchema } from '../../src/kernel/config.mjs';
import { planManagerCheckInSchedules, validateOrganizationGraph } from '../../src/kernel/organization.mjs';

function graph() {
  return {
    schema: 'torch.dev/organization/v1alpha1', revision: 1,
    owner_facing_role: 'session-manager',
    roles: [
      {
        id: 'owner', title: 'Project Owner', kind: 'owner', identity_id: 'owner',
        responsibilities: ['Set product direction and approve organization changes.'],
        authority: ['approve-organization', 'approve-release'],
        coordinates: [], reports_to: [], consults_with: [],
      },
      {
        id: 'session-manager', title: 'Session Manager', kind: 'owner-facing', identity_id: 'session-manager',
        responsibilities: ['Receive owner requests and route project work.'],
        authority: ['receive-owner-requests', 'propose-priorities'],
        coordinates: ['runtime-lead', 'runtime-specialist'], reports_to: [], consults_with: [],
      },
      {
        id: 'runtime-lead', title: 'Runtime Lead', kind: 'domain-coordination', identity_id: 'runtime-lead',
        responsibilities: ['Coordinate runtime integration across specialists.'],
        authority: ['coordinate-domains', 'sequence-domains'],
        coordinates: ['runtime-specialist'], reports_to: ['session-manager'], consults_with: ['runtime-specialist'],
      },
      {
        id: 'runtime-specialist', title: 'Runtime Specialist', kind: 'specialist', identity_id: 'runtime',
        responsibilities: ['Implement the runtime subsystem.'],
        authority: ['own-implementation'], coordinates: [], reports_to: ['runtime-lead'], consults_with: ['runtime-lead'],
      },
    ],
    implementation_owners: [{ surface: 'src/runtime/**', identity_id: 'runtime' }],
  };
}

test('SCN-organization-graph: versioned hierarchy separates implementation, coordination, and owner authority', () => {
  const candidate = graph();
  assert.equal(validateOrganizationGraph(candidate), candidate);
  assert.equal(projectConfigSchema.shape.organization.safeParse(candidate).success, true);
});

test('SCN-organization-graph: allows a specialist identity to be promoted while retaining its implementation role', () => {
  const candidate = graph();
  candidate.roles.push({
    id: 'runtime-promoted-lead', title: 'Runtime Integration Lead', kind: 'domain-coordination', identity_id: 'runtime',
    responsibilities: ['Coordinate runtime and simulation integration.'],
    authority: ['coordinate-domains'], coordinates: ['runtime-specialist'],
    reports_to: ['session-manager'], consults_with: ['runtime-specialist'],
  });
  assert.equal(validateOrganizationGraph(candidate), candidate);
});

test('SCN-organization-graph: rejects duplicate implementation owners and owner-only approval leakage', () => {
  const candidate = graph();
  candidate.implementation_owners.push({ surface: 'src/runtime/**', identity_id: 'runtime' });
        candidate.roles[2].authority.push('approve-release');
  assert.throws(() => validateOrganizationGraph(candidate), (error) => {
    assert.equal(error.code, 'ORGANIZATION_GRAPH_INVALID');
    assert.match(JSON.stringify(error.details), /multiple owners/);
    assert.match(JSON.stringify(error.details), /owner-reserved approval authority/);
    return true;
  });
});

test('SCN-organization-graph: rejects reporting cycles and unknown role references', () => {
  const candidate = graph();
  candidate.roles[1].reports_to = ['runtime-lead'];
  candidate.roles[2].reports_to = ['session-manager'];
  candidate.roles[3].coordinates = ['missing-role'];
  assert.throws(() => validateOrganizationGraph(candidate), (error) => {
    assert.equal(error.code, 'ORGANIZATION_GRAPH_INVALID');
    assert.match(JSON.stringify(error.details), /acyclic/);
    assert.match(JSON.stringify(error.details), /unknown role reference/);
    return true;
  });
});

test('SCN-manager-schedule-coverage / SCN-manager-check-in-cadence-floor: managers require owner-gated cadence with a 60-second minimum', () => {
  const domain = (id, title, path) => ({
    id, title, scope: [`Own ${title}.`], not_scope: [], owned_paths: [path], shared_paths: [],
    neighbours: [], required_checks: [], resources: [], runtime: 'claude',
  });
  const schedule = (managerId) => ({
    id: `${managerId}-check-in`, title: `${managerId} direct-report check-in`, owner: managerId,
    lifetime: 'system', trigger: { type: 'interval', seconds: 900 }, behavior: 'coordination',
    action: { type: 'manager-check-in', manager_id: managerId }, required_authority: ['owner'],
    retry: { max_attempts: 1 }, failure_recipient: managerId,
    source_of_truth: 'active organization direct-report graph',
  });
  const config = {
    schema: 'torch.dev/v1alpha1', project: { id: 'test-project', name: 'Test', main_branch: 'main' },
    paths: { tracked_state: '.torch', worktree_parent: '/tmp/worktrees' },
    repository: { canonical: { type: 'unconfigured' } }, forge: { provider: 'none' },
    git: { branch_prefix: 'torch/', convergence: 'merge', allow_rebase: false, allow_force_push: false, allow_bare_stash: false },
    synchronization: { strategy: 'dispatcher-managed', auto_merge_worktrees: false },
    runtimes: { default: 'claude', claude: {} }, checks: [], resources: [],
    schedules: [schedule('session-manager')],
    integration: { provider: 'torch', target: 'main', require_current_main: true, required_checks: [], landing_authority: ['session-manager'] },
    delivery: {
      authority: Object.fromEntries(['implemented', 'verified', 'integrated', 'release_ready', 'released', 'deployed', 'live_verified']
        .map((key) => [key, ['owner']])),
      adapters: { release: { provider: 'none' }, deployment: { provider: 'none' } },
    },
    session_manager: { id: 'session-manager', runtime: 'claude', start_last: true },
    domains: [domain('runtime-lead', 'Runtime Lead', 'src/runtime-lead/**'), domain('runtime', 'Runtime', 'src/runtime/**')],
    organization: graph(),
  };
  const missing = projectConfigSchema.safeParse(config);
  assert.equal(missing.success, false);
  assert.match(JSON.stringify(missing.error.issues), /runtime-lead.*manager-check-in schedule/);
  config.schedules.push(schedule('runtime-lead'));
  assert.equal(projectConfigSchema.safeParse(config).success, true);
  config.schedules[0].action.wake = { enabled: true };
  const missingWakeBudget = projectConfigSchema.safeParse(config);
  assert.equal(missingWakeBudget.success, false);
  assert.match(JSON.stringify(missingWakeBudget.error.issues), /project-wide daily invocation budget/);
  assert.match(JSON.stringify(missingWakeBudget.error.issues), /positive per-invocation USD ceiling/);
  config.runtime_wake_budget = { max_invocations_per_day: 2 };
  const missingDollarCeiling = projectConfigSchema.safeParse(config);
  assert.equal(missingDollarCeiling.success, false);
  config.schedules[0].action.wake.max_usd_per_invocation = 0.25;
  assert.equal(projectConfigSchema.safeParse(config).success, true);
  config.schedules[0].trigger.seconds = 59;
  const tooFrequent = projectConfigSchema.safeParse(config);
  assert.equal(tooFrequent.success, false);
  assert.match(JSON.stringify(tooFrequent.error.issues), /manager check-in intervals must be at least 60 seconds/);
  config.schedules[0].trigger.seconds = 60;
  assert.equal(projectConfigSchema.safeParse(config).success, true, 'one-minute manager polling remains valid');
});

test('SCN-manager-schedule-growth: hierarchy planning adds schedules for new managers and preserves configured cadence', () => {
  const existing = {
    id: 'session-manager-check-in', title: 'Custom Session Manager cadence', owner: 'session-manager',
    lifetime: 'system', trigger: { type: 'interval', seconds: 600 }, behavior: 'coordination',
    action: { type: 'manager-check-in', manager_id: 'session-manager' }, required_authority: ['owner'],
    retry: { max_attempts: 1 }, failure_recipient: 'session-manager',
    source_of_truth: 'active organization direct-report graph',
  };
  const plan = planManagerCheckInSchedules({ graph: graph(), schedules: [existing] });
  assert.deepEqual(plan.coveredManagerIds, ['runtime-lead', 'session-manager']);
  assert.equal(plan.schedules[0], existing, 'existing cadence and settings stay intact');
  assert.deepEqual(plan.additions.map((schedule) => [schedule.action.manager_id, schedule.trigger.seconds]), [
    ['runtime-lead', 900],
  ]);
  assert.equal(plan.additions[0].required_authority.includes('owner'), true);
  assert.equal(plan.mutationPerformed, false);

  const noLongerManager = structuredClone(graph());
  noLongerManager.roles.find((role) => role.id === 'runtime-specialist').reports_to = [];
  const changed = planManagerCheckInSchedules({ graph: noLongerManager, schedules: [existing, ...plan.additions] });
  assert.deepEqual(changed.obsolete.map((schedule) => schedule.action.manager_id), ['runtime-lead']);
  assert.equal(changed.schedules.length, 2, 'obsolete timers are surfaced but not silently removed');
});
