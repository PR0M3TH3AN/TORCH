import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { TorchError } from '../kernel/errors.mjs';
import { planManagerCheckIn } from '../observability/manager-checkin.mjs';

const optionalReferenceShape = {
  task: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  commit: z.string().min(1).optional(),
  handoff: z.string().min(1).optional(),
};

export const TORCH_CORE_MCP_TOOL_NAMES = Object.freeze([
  'torch_identity',
  'torch_list_agents',
  'torch_plan_manager_check_in',
  'torch_get_agent',
  'torch_get_roster',
  'torch_who_owns',
  'torch_neighbours',
  'torch_send_message',
  'torch_reply_to_owner',
  'torch_read_messages',
  'torch_ack_message',
  'torch_report_status',
  'torch_report_complete',
  'torch_report_blocked',
  'torch_request_approval',
  'torch_list_approvals',
  'torch_decide_approval',
  'torch_request_coordination',
  'torch_request_handoff',
]);

export const TORCH_MCP_TOOL_NAMES = Object.freeze([
  ...TORCH_CORE_MCP_TOOL_NAMES,
  'torch_list_backlog',
  'torch_next_backlog_task',
  'torch_backlog_health',
  'torch_backlog_activity',
  'torch_plan_landed_task_closure',
  'torch_reconcile_landed_tasks',
  'torch_plan_backlog_claim',
  'torch_claim_next_backlog_task',
  'torch_get_backlog_task',
  'torch_create_backlog_task',
  'torch_classify_backlog_task',
  'torch_transition_backlog_task',
  'torch_list_checks',
  'torch_list_check_receipts',
  'torch_plan_check',
  'torch_run_check',
  'torch_prepare_check',
  'torch_list_prepared_checks',
  'torch_run_prepared_check',
  'torch_cancel_prepared_check',
  'torch_list_resources',
  'torch_resource_status',
  'torch_acquire_resource',
  'torch_release_resource',
  'torch_cancel_resource_request',
  'torch_list_integrations',
  'torch_request_integration',
  'torch_evaluate_integration',
  'torch_authorize_integration',
  'torch_plan_integration_landing',
  'torch_land_integration',
  'torch_record_context_usage',
  'torch_context_report',
  'torch_list_schedules',
  'torch_schedule_runs',
  'torch_plan_schedule',
  'torch_run_schedule',
  'torch_list_fleet_changes',
  'torch_get_fleet_change',
  'torch_assess_fleet_evolution',
  'torch_propose_domain',
  'torch_propose_domain_retirement',
  'torch_propose_domain_merge',
  'torch_propose_domain_split',
  'torch_assess_hierarchy_needs',
  'torch_list_hierarchy_proposals',
  'torch_get_hierarchy_proposal',
  'torch_propose_hierarchy_change',
  'torch_plan_hierarchy_pilot',
  'torch_publish_artifact',
]);

function claimedIdentity(controlPlane, actorId, claim, field) {
  const actor = actorId ? controlPlane.assertIdentity(actorId) : null;
  const claimed = claim ? controlPlane.assertIdentity(claim) : null;
  if (actor && claimed && actor !== claimed) {
    throw new TorchError(`Bound Fleet identity ${actor} cannot act as ${claimed} in ${field}`, {
      code: 'FLEET_IDENTITY_MISMATCH', details: { actor, claimed, field },
    });
  }
  if (actor) return actor;
  if (claimed) return claimed;
  throw new TorchError(`${field} is required when the MCP server has no bound Fleet identity`, {
    code: 'FLEET_IDENTITY_REQUIRED', details: { field },
  });
}

function boundActorIdentity(controlPlane, actorId) {
  if (typeof actorId !== 'string' || actorId.trim().length === 0) {
    throw new TorchError('torch_reply_to_owner requires an actual bound Fleet identity', {
      code: 'FLEET_IDENTITY_REQUIRED', details: { field: 'bound_actor' },
    });
  }
  return controlPlane.assertIdentity(actorId);
}

function inputSchema(tool) {
  return typeof tool.schema?.safeParse === 'function' ? tool.schema : z.object(tool.schema);
}

export function createTorchToolset(controlPlane, {
  actorId, backlogService, checkService, resourceService, integrationService, contextTelemetryService, scheduleService,
  evolutionService, hierarchyService, repositoryRoot,
  artifactService,
} = {}) {
  const tools = new Map([
    ['torch_identity', {
      description: 'Return the stable TORCH Fleet identity and current runtime presence for one area.',
      schema: { area_id: z.string().min(1).optional() },
      invoke: ({ area_id: areaId }) => controlPlane.identity(claimedIdentity(controlPlane, actorId, areaId, 'area_id')),
    }],
    ['torch_list_agents', {
      description: 'List all persistent Fleet identities and their live presence.',
      schema: {},
      invoke: () => ({ agents: controlPlane.listAgents() }),
    }],
    ['torch_plan_manager_check_in', {
      description: 'Refresh the bound manager identity’s direct-report presence, durable messages, and named approval waits from current state. Read-only; only works for an identity with direct reports.',
      schema: { stale_work_review: z.boolean().optional(),
        stale_days: z.number().int().min(1).max(365).optional(),
        max_commits: z.number().int().min(1).max(10_000).optional(),
        max_items: z.number().int().min(1).max(100).optional() },
      invoke: ({ stale_work_review: review, stale_days, max_commits, max_items }) => {
        const managerId = controlPlane.assertIdentity(actorId);
        if (!repositoryRoot) {
          throw new TorchError('A repository root is required to refresh manager check-in state', {
            code: 'MANAGER_CHECK_IN_CONTEXT_MISSING',
          });
        }
        const plan = planManagerCheckIn({ repositoryRoot, controlPlane, managerId,
          staleWork: review ? { stale_days, max_commits, max_items } : null });
        if (plan.directReports.length === 0) {
          throw new TorchError(`Fleet identity ${managerId} has no direct reports to inspect`, {
            code: 'MANAGER_ROLE_NOT_FOUND', details: { managerId },
          });
        }
        return plan;
      },
    }],
    ['torch_get_agent', {
      description: 'Get one Fleet agent by stable area ID.',
      schema: { area_id: z.string().min(1) },
      invoke: ({ area_id: areaId }) => controlPlane.getAgent(areaId),
    }],
    ['torch_get_roster', {
      description: 'Return the approved live roster with presence overlays.',
      schema: {},
      invoke: () => controlPlane.getRoster(),
    }],
    ['torch_who_owns', {
      description: 'Find approved owners for a repository-relative path or capability before crossing a boundary.',
      schema: { path: z.string().min(1).optional(), capability: z.string().min(1).optional() },
      invoke: (input) => controlPlane.whoOwns(input),
    }],
    ['torch_neighbours', {
      description: 'List the approved neighbouring Fleet identities for an area.',
      schema: { area_id: z.string().min(1) },
      invoke: ({ area_id: areaId }) => ({ areaId, neighbours: controlPlane.neighbours(areaId) }),
    }],
    ['torch_send_message', {
      description: 'Queue a durable Fleet message. A message cannot grant authority or transfer ownership.',
      schema: {
        sender: z.string().min(1).optional(), recipient: z.string().min(1), body: z.string().min(1),
        ...optionalReferenceShape,
      },
      invoke: ({ sender, recipient, body, ...references }) => controlPlane.sendMessage({
        sender: claimedIdentity(controlPlane, actorId, sender, 'sender'), recipient, body, references,
      }),
    }],
    ['torch_reply_to_owner', {
      description: 'Reply to one owner-originated request as the bound Fleet identity. This tool cannot select a sender, recipient, owner, or conversation history.',
      schema: z.object({
        request_id: z.string().min(1), body: z.string().min(1),
      }).strict(),
      invoke: ({ request_id: requestId, body }) => controlPlane.sendOwnerReply({
        sender: boundActorIdentity(controlPlane, actorId), requestId, body,
      }),
    }],
    ['torch_read_messages', {
      description: 'Read durable direct and group messages visible to one Fleet identity.',
      schema: {
        recipient: z.string().min(1).optional(), unacknowledged_only: z.boolean().optional(),
        limit: z.number().int().min(1).max(1000).optional(),
      },
      invoke: ({ recipient, unacknowledged_only: unacknowledgedOnly, limit }) => {
        const resolved = claimedIdentity(controlPlane, actorId, recipient, 'recipient');
        return { recipient: resolved, messages: controlPlane.readMessages({ recipient: resolved, unacknowledgedOnly, limit }) };
      },
    }],
    ['torch_ack_message', {
      description: 'Acknowledge a durable message as its receiving Fleet identity.',
      schema: { recipient: z.string().min(1).optional(), message_id: z.string().min(1) },
      invoke: ({ recipient, message_id: messageId }) => controlPlane.ackMessage({
        recipient: claimedIdentity(controlPlane, actorId, recipient, 'recipient'), messageId,
      }),
    }],
    ['torch_report_status', {
      description: 'Report a meaningful Fleet presence or task-state transition.',
      schema: {
        area_id: z.string().min(1).optional(), state: z.string().min(1), summary: z.string().min(1).optional(),
        runtime: z.string().min(1).optional(), runtime_session_id: z.string().min(1).optional(),
        task: z.string().min(1).optional(),
      },
      invoke: ({ area_id: areaId, runtime_session_id: runtimeSessionId, ...input }) => controlPlane.reportStatus({
        areaId: claimedIdentity(controlPlane, actorId, areaId, 'area_id'), runtimeSessionId, ...input,
      }),
    }],
    ['torch_report_complete', {
      description: 'Record completion evidence and notify the Session Manager durably.',
      schema: {
        area_id: z.string().min(1).optional(), summary: z.string().min(1), task: z.string().min(1).optional(),
        evidence: z.string().min(1).optional(), commit: z.string().min(1).optional(),
      },
      invoke: ({ area_id: areaId, ...input }) => controlPlane.reportComplete({
        areaId: claimedIdentity(controlPlane, actorId, areaId, 'area_id'), ...input,
      }),
    }],
    ['torch_report_blocked', {
      description: 'Record a blocker and notify the Session Manager durably.',
      schema: {
        area_id: z.string().min(1).optional(), summary: z.string().min(1), task: z.string().min(1).optional(),
        evidence: z.string().min(1).optional(), path: z.string().min(1).optional(),
        commit: z.string().min(1).optional(),
      },
      invoke: ({ area_id: areaId, ...input }) => controlPlane.reportBlocked({
        areaId: claimedIdentity(controlPlane, actorId, areaId, 'area_id'), ...input,
      }),
    }],
    ['torch_request_approval', {
      description: 'Create a durable approval request addressed to one named Fleet identity or the configured owner.',
      schema: {
        requester: z.string().min(1).optional(), approver: z.string().min(1), task: z.string().min(1).optional(),
        title: z.string().min(1).max(240), summary: z.string().min(1).max(4000), evidence: z.string().min(1).max(4000).optional(),
      },
      invoke: ({ requester, ...input }) => controlPlane.requestApproval({
        ...input, requester: claimedIdentity(controlPlane, actorId, requester, 'requester'),
      }),
    }],
    ['torch_list_approvals', {
      description: 'List pending and historical approval requests visible to the bound Fleet identity.',
      schema: { actor_id: z.string().min(1).optional(), status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional() },
      invoke: ({ actor_id: actorIdClaim, status }) => ({ approvals: controlPlane.listApprovals({
        actorId: claimedIdentity(controlPlane, actorId, actorIdClaim, 'actor_id'), status,
      }) }),
    }],
    ['torch_decide_approval', {
      description: 'Approve or reject a request only when the bound identity is its named approver; decisions are audited and notified durably.',
      schema: {
        actor_id: z.string().min(1).optional(), approval_id: z.string().min(1),
        decision: z.enum(['approved', 'rejected']), note: z.string().max(2000).optional(),
        expected_revision: z.number().int().positive(),
      },
      invoke: ({ actor_id: actorIdClaim, approval_id: approvalId, decision, note, expected_revision: expectedRevision }) =>
        controlPlane.decideApproval({
          approvalId, decidedBy: claimedIdentity(controlPlane, actorId, actorIdClaim, 'actor_id'),
          decision, note, expectedRevision,
        }),
    }],
    ['torch_request_coordination', {
      description: 'Ask the Session Manager for a durable cross-domain coordination ruling.',
      schema: {
        sender: z.string().min(1).optional(), participants: z.array(z.string().min(1)).optional(),
        body: z.string().min(1), task: z.string().min(1).optional(), path: z.string().min(1).optional(),
      },
      invoke: ({ sender, ...input }) => controlPlane.requestCoordination({
        sender: claimedIdentity(controlPlane, actorId, sender, 'sender'), ...input,
      }),
    }],
    ['torch_request_handoff', {
      description: 'Request, but do not perform, a task or path ownership handoff.',
      schema: {
        sender: z.string().min(1).optional(), recipient: z.string().min(1).optional(),
        path: z.string().min(1).optional(), task: z.string().min(1).optional(), reason: z.string().min(1),
      },
      invoke: ({ sender, ...input }) => controlPlane.requestHandoff({
        sender: claimedIdentity(controlPlane, actorId, sender, 'sender'), ...input,
      }),
    }],
  ]);
  if (backlogService) {
    tools.set('torch_list_backlog', {
      description: 'List durable tracked backlog tasks, optionally filtered by state or owner.',
      schema: { state: z.string().min(1).optional(), owner: z.string().min(1).optional() },
      invoke: (input) => ({ tasks: backlogService.list(input) }),
    });
    tools.set('torch_next_backlog_task', {
      description: 'Resume this specialist\'s active assignment before returning its first eligible ready task. Read-only.',
      schema: { area_id: z.string().min(1).optional() },
      invoke: ({ area_id: requestedArea }) => {
        const bound = controlPlane.assertIdentity(actorId);
        const areaId = requestedArea ?? bound;
        if (bound !== 'session-manager' && areaId !== bound) {
          throw new TorchError('A specialist may only inspect its own next backlog item', {
            code: 'BACKLOG_AUTHORITY_REQUIRED', details: { actorId: bound, areaId },
          });
        }
        return backlogService.next({ areaId });
      },
    });
    tools.set('torch_backlog_health', {
      description: 'Report unusual backlog conditions without changing any task.',
      schema: {
        stale_after_days: z.number().int().min(0).optional(),
        stale_observed_commits: z.number().int().min(0).optional(),
      },
      invoke: ({ stale_after_days: staleAfterDays, stale_observed_commits: staleObservedCommits }) =>
        backlogService.health({ staleAfterDays, staleObservedCommits }),
    });
    tools.set('torch_backlog_activity', {
      description: 'Observe commit-linked task activity and neglected requests on managed branches. Read-only; closure text is intent, not authority.',
      schema: { stale_days: z.number().int().min(1).max(365).optional(), max_commits: z.number().int().min(1).max(10_000).optional() },
      invoke: ({ stale_days: staleDays, max_commits: maxCommits }) => backlogService.activity({ staleDays, maxCommits }),
    });
    for (const [name, method] of [
      ['torch_plan_landed_task_closure', 'planLandedClosure'], ['torch_reconcile_landed_tasks', 'reconcileLanded'],
    ]) tools.set(name, {
      description: 'Manager-only exact landed task closure: preview or explicitly reconcile Closes intent with current evidence.',
      schema: { integration_request: z.string().min(1), approved: z.boolean().optional() },
      invoke: ({ integration_request: integrationRequest, approved }) => backlogService[method]({ integrationRequest, actorId, approved }),
    });
    for (const [name, method] of [
      ['torch_plan_backlog_claim', 'planClaim'], ['torch_claim_next_backlog_task', 'claimNext'],
    ]) tools.set(name, {
      description: method === 'planClaim'
        ? 'Preview policy-controlled self-claim eligibility for the bound specialist without mutation.'
        : 'Atomically claim the next explicitly routed ready task under approved policy, or resume current work. Never grants manager authority.',
      schema: { area_id: z.string().min(1).optional() },
      invoke: ({ area_id: areaId }) => backlogService[method]({
        areaId: claimedIdentity(controlPlane, actorId, areaId, 'area_id'),
      }),
    });
    tools.set('torch_get_backlog_task', {
      description: 'Read one durable tracked backlog task and its transition history.',
      schema: { task_id: z.string().min(1) },
      invoke: ({ task_id: taskId }) => backlogService.get(taskId),
    });
    tools.set('torch_create_backlog_task', {
      description: 'Create proposed work as the bound Session Manager identity.',
      schema: {
        actor_id: z.string().min(1).optional(), title: z.string().min(1), description: z.string().min(1),
        priority: z.enum(['urgent', 'high', 'normal', 'low']).optional(),
        affected_domains: z.array(z.string().min(1)).optional(),
        dependencies: z.array(z.string().min(1)).optional(),
        feature: z.string().min(1).max(120).optional(), milestone: z.string().min(1).max(120).optional(),
        acceptance_criteria: z.array(z.string().min(1)).min(1),
        observed_at: z.string().min(1).optional(),
      },
      invoke: ({
        actor_id: actorIdClaim, affected_domains: affectedDomains,
        acceptance_criteria: acceptanceCriteria, observed_at: observedAt, ...input
      }) => backlogService.create({
        ...input, affectedDomains, acceptanceCriteria, observedAt,
        actorId: claimedIdentity(controlPlane, actorId, actorIdClaim, 'actor_id'),
      }),
    });
    tools.set('torch_classify_backlog_task', {
      description: 'Set or explicitly clear a task\'s feature and milestone labels as the Session Manager. Revision-checked and non-destructive to status or ownership.',
      schema: {
        task_id: z.string().min(1), actor_id: z.string().min(1).optional(),
        expected_revision: z.number().int().min(1),
        feature: z.string().min(1).max(120).optional(), milestone: z.string().min(1).max(120).optional(),
        clear_feature: z.boolean().optional(), clear_milestone: z.boolean().optional(),
        reason: z.string().min(1),
      },
      invoke: ({
        task_id: taskId, actor_id: actorIdClaim, expected_revision: expectedRevision,
        clear_feature: clearFeature, clear_milestone: clearMilestone, ...input
      }) => backlogService.classify({
        ...input, taskId, expectedRevision, clearFeature, clearMilestone,
        actorId: claimedIdentity(controlPlane, actorId, actorIdClaim, 'actor_id'),
      }),
    });
    tools.set('torch_transition_backlog_task', {
      description: 'Apply one revision-checked backlog state transition under bound Fleet authority.',
      schema: {
        task_id: z.string().min(1), actor_id: z.string().min(1).optional(), to: z.string().min(1),
        expected_revision: z.number().int().min(1), owner: z.string().min(1).optional(),
        evidence: z.array(z.string().min(1)).optional(), commit: z.string().min(1).optional(),
        integration_request: z.string().min(1).optional(), blocked_reason: z.string().min(1).optional(),
        note: z.string().min(1).optional(),
      },
      invoke: ({
        task_id: taskId, actor_id: actorIdClaim, expected_revision: expectedRevision,
        integration_request: integrationRequest, blocked_reason: blockedReason, ...input
      }) => backlogService.transition({
        ...input, taskId, expectedRevision, integrationRequest, blockedReason,
        actorId: claimedIdentity(controlPlane, actorId, actorIdClaim, 'actor_id'),
      }),
    });
  }
  if (checkService) {
    tools.set('torch_list_checks', {
      description: 'List approved project check definitions.', schema: {},
      invoke: () => ({ checks: checkService.listChecks() }),
    });
    tools.set('torch_list_check_receipts', {
      description: 'List immutable check receipts, optionally filtered by exact commit, check, or bound area.',
      schema: {
        commit: z.string().min(1).optional(), check_id: z.string().min(1).optional(),
        area_id: z.string().min(1).optional(),
      },
      invoke: ({ commit, check_id: checkId, area_id: areaId }) => ({
        receipts: checkService.receipts({
          commit, checkId,
          areaId: areaId ? claimedIdentity(controlPlane, actorId, areaId, 'area_id') : undefined,
        }),
      }),
    });
    tools.set('torch_plan_check', {
      description: 'Preview a configured check against the bound area and report blockers without executing it.',
      schema: { check_id: z.string().min(1), area_id: z.string().min(1).optional() },
      invoke: ({ check_id: checkId, area_id: areaId }) => checkService.plan({
        checkId, areaId: claimedIdentity(controlPlane, actorId, areaId, 'area_id'),
      }),
    });
    tools.set('torch_run_check', {
      description: 'Execute an approved shell-free check in the bound clean worktree and record an exact-SHA receipt.',
      schema: { check_id: z.string().min(1), area_id: z.string().min(1).optional() },
      invoke: ({ check_id: checkId, area_id: areaId }) => checkService.run({
        checkId, areaId: claimedIdentity(controlPlane, actorId, areaId, 'area_id'),
      }),
    });
    tools.set('torch_prepare_check', {
      description: 'Capture approved frozen check inputs before waiting for resource leases; does not execute the check.',
      schema: { check_id: z.string().min(1), area_id: z.string().min(1).optional() },
      invoke: ({ check_id: checkId, area_id: areaId }) => checkService.prepare({
        checkId, areaId: claimedIdentity(controlPlane, actorId, areaId, 'area_id'),
      }),
    });
    tools.set('torch_list_prepared_checks', {
      description: 'List durable frozen checks for the bound identity, including interrupted running checks.',
      schema: { area_id: z.string().min(1).optional() },
      invoke: ({ area_id: areaId }) => ({ prepared: checkService.prepared({
        areaId: claimedIdentity(controlPlane, actorId, areaId, 'area_id'),
      }) }),
    });
    for (const [name, method] of [
      ['torch_run_prepared_check', 'runPrepared'], ['torch_cancel_prepared_check', 'cancelPrepared'],
    ]) tools.set(name, {
      description: method === 'runPrepared'
        ? 'Run an owned frozen check after acquiring its resources; record its captured SHA, not the current worktree SHA.'
        : 'Cancel an owned unstarted frozen check and remove only its owned input copy.',
      schema: { prepared_id: z.string().min(1), area_id: z.string().min(1).optional() },
      invoke: ({ prepared_id: preparedId, area_id: areaId }) => checkService[method]({
        preparedId, areaId: claimedIdentity(controlPlane, actorId, areaId, 'area_id'),
      }),
    });
  }
  if (resourceService) {
    tools.set('torch_list_resources', {
      description: 'List configured scarce resources and capacities.', schema: {},
      invoke: () => ({ resources: resourceService.list() }),
    });
    tools.set('torch_resource_status', {
      description: 'Show holders, stale leases, and the FIFO queue for a resource.',
      schema: { resource_id: z.string().min(1) },
      invoke: ({ resource_id: resourceId }) => resourceService.status(resourceId),
    });
    tools.set('torch_acquire_resource', {
      description: 'Acquire or join the FIFO queue for a scarce resource as the bound Fleet identity.',
      schema: { resource_id: z.string().min(1), area_id: z.string().min(1).optional() },
      invoke: ({ resource_id: resourceId, area_id: areaId }) => resourceService.acquire({
        resourceId, areaId: claimedIdentity(controlPlane, actorId, areaId, 'area_id'),
      }),
    });
    tools.set('torch_release_resource', {
      description: 'Release a resource lease held by the bound Fleet identity.',
      schema: { resource_id: z.string().min(1), area_id: z.string().min(1).optional() },
      invoke: ({ resource_id: resourceId, area_id: areaId }) => resourceService.release({
        resourceId, areaId: claimedIdentity(controlPlane, actorId, areaId, 'area_id'),
      }),
    });
    tools.set('torch_cancel_resource_request', {
      description: 'Cancel the bound Fleet identity queued request without leaking a lease.',
      schema: { resource_id: z.string().min(1), area_id: z.string().min(1).optional() },
      invoke: ({ resource_id: resourceId, area_id: areaId }) => resourceService.cancel({
        resourceId, areaId: claimedIdentity(controlPlane, actorId, areaId, 'area_id'),
      }),
    });
  }
  if (integrationService) {
    tools.set('torch_list_integrations', {
      description: 'List native integration queue records and their exact readiness states.',
      schema: { state: z.string().min(1).optional() },
      invoke: ({ state }) => ({ requests: integrationService.list({ state }) }),
    });
    tools.set('torch_request_integration', {
      description: 'Request integration of the bound domain branch tip and its exact commit receipts.',
      schema: { area_id: z.string().min(1).optional(), commit: z.string().min(1).optional() },
      invoke: ({ area_id: areaId, commit }) => integrationService.request({
        areaId: claimedIdentity(controlPlane, actorId, areaId, 'area_id'), commit,
      }),
    });
    tools.set('torch_evaluate_integration', {
      description: 'Re-evaluate source, convergence, and exact-SHA checks for an integration request.',
      schema: { request_id: z.string().min(1) },
      invoke: ({ request_id: requestId }) => integrationService.evaluate(requestId),
    });
    tools.set('torch_authorize_integration', {
      description: 'Authorize a ready integration request as the bound identity when policy grants authority.',
      schema: { request_id: z.string().min(1), area_id: z.string().min(1).optional() },
      invoke: ({ request_id: requestId, area_id: areaId }) => integrationService.authorize({
        requestId, actorId: claimedIdentity(controlPlane, actorId, areaId, 'area_id'),
      }),
    });
    tools.set('torch_plan_integration_landing', {
      description: 'Preview all main-protection gates without changing canonical main.',
      schema: { request_id: z.string().min(1), area_id: z.string().min(1).optional() },
      invoke: ({ request_id: requestId, area_id: areaId }) => integrationService.planLanding({
        requestId, actorId: claimedIdentity(controlPlane, actorId, areaId, 'area_id'),
      }),
    });
    tools.set('torch_land_integration', {
      description: 'Fast-forward canonical main only after durable authorization and every protection gate passes.',
      schema: { request_id: z.string().min(1), area_id: z.string().min(1).optional() },
      invoke: ({ request_id: requestId, area_id: areaId }) => integrationService.land({
        requestId, actorId: claimedIdentity(controlPlane, actorId, areaId, 'area_id'),
      }),
    });
  }
  if (contextTelemetryService) {
    tools.set('torch_record_context_usage', {
      description: 'Record measured or explicitly estimated context usage for the bound Fleet identity and its verified outcomes.',
      schema: {
        area_id: z.string().min(1).optional(), source: z.string().min(1), measurement: z.enum(['measured', 'estimated']),
        runtime: z.string().min(1).optional(), runtime_session_id: z.string().min(1).optional(),
        task: z.string().min(1).optional(), commit: z.string().min(1).optional(),
        cached_input: z.number().int().nonnegative().optional(), uncached_input: z.number().int().nonnegative().optional(),
        cache_creation: z.number().int().nonnegative().optional(), cache_read: z.number().int().nonnegative().optional(),
        compactions: z.number().int().nonnegative().optional(), resumed_prompt_bytes: z.number().int().nonnegative().optional(),
        cost_microusd: z.number().int().nonnegative().optional(), verified_items: z.number().int().nonnegative().optional(),
      },
      invoke: ({
        area_id: areaId, runtime_session_id: runtimeSessionId, cached_input: cachedInput,
        uncached_input: uncachedInput, cache_creation: cacheCreation, cache_read: cacheRead,
        resumed_prompt_bytes: resumedPromptBytes, cost_microusd: costMicrousd,
        verified_items: verifiedItems, ...input
      }) => contextTelemetryService.record({
        ...input, runtimeSessionId, cachedInput, uncachedInput, cacheCreation, cacheRead,
        resumedPromptBytes, costMicrousd, verifiedItems,
        areaId: claimedIdentity(controlPlane, actorId, areaId, 'area_id'),
      }),
    });
    tools.set('torch_context_report', {
      description: 'Aggregate context locality by Fleet identity while keeping measured and estimated evidence separate.',
      schema: {
        area_id: z.string().min(1).optional(), task: z.string().min(1).optional(),
        commit: z.string().min(1).optional(), measurement: z.enum(['measured', 'estimated']).optional(),
      },
      invoke: ({ area_id: areaId, ...input }) => contextTelemetryService.report({
        ...input, areaId: areaId ? claimedIdentity(controlPlane, actorId, areaId, 'area_id') : actorId,
      }),
    });
  }
  if (scheduleService) {
    tools.set('torch_list_schedules', {
      description: 'List validated schedules and their current authority, lifetime, and due status.',
      schema: {}, invoke: () => ({ schedules: scheduleService.list({ actorId }) }),
    });
    tools.set('torch_schedule_runs', {
      description: 'List durable run evidence for configured schedules.',
      schema: { schedule_id: z.string().min(1).optional(), limit: z.number().int().min(1).max(1000).optional() },
      invoke: ({ schedule_id: scheduleId, limit }) => ({ runs: scheduleService.runs({ scheduleId, limit }) }),
    });
    tools.set('torch_plan_schedule', {
      description: 'Preview a configured schedule and its blockers without executing it.',
      schema: { schedule_id: z.string().min(1) },
      invoke: ({ schedule_id: scheduleId }) => scheduleService.plan({ scheduleId, actorId }),
    });
    tools.set('torch_run_schedule', {
      description: 'Run a read-only configured schedule as the bound Fleet identity. Coordination and mutating schedules cannot run through this MCP tool; they require an owner-approved CLI action or an approved, digest-matched system timer.',
      schema: { schedule_id: z.string().min(1) },
      invoke: ({ schedule_id: scheduleId }) => scheduleService.run({ scheduleId, actorId, approved: false }),
    });
  }
  if (evolutionService) {
    tools.set('torch_list_fleet_changes', {
      description: 'List durable proposed, approved, provisioning, or active Fleet organization changes.',
      schema: { state: z.enum(['proposed', 'approved', 'provisioning', 'active', 'retired', 'rejected']).optional() },
      invoke: ({ state }) => ({ changes: evolutionService.list({ state }) }),
    });
    tools.set('torch_get_fleet_change', {
      description: 'Read one durable Fleet organization change and its owner-approval state.',
      schema: { change_id: z.string().min(1) },
      invoke: ({ change_id: changeId }) => evolutionService.get(changeId),
    });
    tools.set('torch_assess_fleet_evolution', {
      description: 'Inspect durable backlog, handoff, coordination, and pending-change evidence for recurring boundaries that may merit a new persistent domain. Advisory and read-only.',
      schema: { assessor: z.string().min(1).optional() },
      invoke: ({ assessor }) => evolutionService.assessDomainNeeds({
        assessor: claimedIdentity(controlPlane, actorId, assessor, 'assessor'),
      }),
    });
    tools.set('torch_propose_domain', {
      description: 'Propose an evidence-backed persistent domain as the bound Session Manager. This never approves or activates it.',
      schema: {
        proposer: z.string().min(1).optional(),
        domain: z.object({
          id: z.string().min(1), title: z.string().min(1), kind: z.string().min(1).optional(),
          scope: z.array(z.string().min(1)).min(1), not_scope: z.array(z.string().min(1)).optional(),
          owned_paths: z.array(z.string().min(1)).min(1), shared_paths: z.array(z.string().min(1)).optional(),
          neighbours: z.array(z.string().min(1)).optional(), required_checks: z.array(z.string().min(1)).optional(),
          resources: z.array(z.string().min(1)).optional(),
          runtime: z.string().min(1).optional(), branch: z.string().min(1).optional(),
          model: z.string().min(1).optional(),
          worktree_name: z.string().min(1).optional(),
        }),
        rationale: z.string().min(1),
        expected_benefit: z.object({
          summary: z.string().min(1), recurring_work: z.string().min(1),
          context_locality: z.string().min(1), coordination_cost: z.string().min(1),
        }),
        evidence: z.array(z.string().min(1)).min(1),
      },
      invoke: ({ proposer, expected_benefit: benefit, ...input }) => evolutionService.proposeDomain({
        ...input,
        proposer: claimedIdentity(controlPlane, actorId, proposer, 'proposer'),
        expectedBenefit: {
          summary: benefit.summary, recurringWork: benefit.recurring_work,
          contextLocality: benefit.context_locality, coordinationCost: benefit.coordination_cost,
        },
      }),
    });
    tools.set('torch_propose_domain_retirement', {
      description: 'Propose retiring a persistent domain when its coordination cost exceeds its continuing benefit. This never approves or activates retirement.',
      schema: {
        proposer: z.string().min(1).optional(), area_id: z.string().min(1), rationale: z.string().min(1),
        expected_benefit: z.object({
          summary: z.string().min(1), recurring_work: z.string().min(1),
          context_locality: z.string().min(1), coordination_cost: z.string().min(1),
        }),
        evidence: z.array(z.string().min(1)).min(1),
      },
      invoke: ({ proposer, area_id: areaId, expected_benefit: benefit, ...input }) => evolutionService.proposeRetirement({
        ...input, areaId,
        proposer: claimedIdentity(controlPlane, actorId, proposer, 'proposer'),
        expectedBenefit: {
          summary: benefit.summary, recurringWork: benefit.recurring_work,
          contextLocality: benefit.context_locality, coordinationCost: benefit.coordination_cost,
        },
      }),
    });
    const boundaryProposalSchema = {
      proposer: z.string().min(1).optional(),
      source_domains: z.array(z.string().min(1)).min(1),
      result_domains: z.array(z.object({
        id: z.string().min(1), title: z.string().min(1), kind: z.string().min(1).optional(),
        scope: z.array(z.string().min(1)).min(1), not_scope: z.array(z.string().min(1)).optional(),
        owned_paths: z.array(z.string().min(1)).min(1), shared_paths: z.array(z.string().min(1)).optional(),
        neighbours: z.array(z.string().min(1)).optional(), required_checks: z.array(z.string().min(1)).optional(),
        resources: z.array(z.string().min(1)).optional(), runtime: z.string().min(1).optional(),
        model: z.string().min(1).optional(), branch: z.string().min(1).optional(),
        worktree_name: z.string().min(1).optional(),
      })).min(1),
      ownership_assignments: z.array(z.object({
        source_domain_id: z.string().min(1), source_path: z.string().min(1), result_domain_id: z.string().min(1),
      })).min(1),
      rationale: z.string().min(1),
      expected_benefit: z.object({
        summary: z.string().min(1), recurring_work: z.string().min(1),
        context_locality: z.string().min(1), coordination_cost: z.string().min(1),
      }),
      evidence: z.array(z.string().min(1)).min(1),
    };
    const invokeBoundaryProposal = (operation) => ({
      proposer, source_domains: sourceDomains, result_domains: resultDomains,
      ownership_assignments: ownershipAssignments, expected_benefit: benefit, ...input
    }) => evolutionService[operation]({
      ...input, sourceDomains, resultDomains, ownershipAssignments,
      proposer: claimedIdentity(controlPlane, actorId, proposer, 'proposer'),
      expectedBenefit: {
        summary: benefit.summary, recurringWork: benefit.recurring_work,
        contextLocality: benefit.context_locality, coordinationCost: benefit.coordination_cost,
      },
    });
    tools.set('torch_propose_domain_merge', {
      description: 'Propose an evidence-backed merge of persistent domains. Approval records intent but cannot automatically migrate ownership.',
      schema: boundaryProposalSchema,
      invoke: invokeBoundaryProposal('proposeMerge'),
    });
    tools.set('torch_propose_domain_split', {
      description: 'Propose an evidence-backed split of a persistent domain. Approval records intent but cannot automatically migrate ownership.',
      schema: boundaryProposalSchema,
      invoke: invokeBoundaryProposal('proposeSplit'),
    });
  }
  if (hierarchyService) {
    tools.set('torch_assess_hierarchy_needs', {
      description: 'Measure recurring coordination, cross-domain work, handoffs, and approval waits in the configured observation window. Read-only; it never creates or activates a role.',
      schema: { assessor: z.string().min(1).optional() },
      invoke: ({ assessor }) => hierarchyService.assess({
        assessor: claimedIdentity(controlPlane, actorId, assessor, 'assessor'),
      }),
    });
    tools.set('torch_list_hierarchy_proposals', {
      description: 'List durable hierarchy proposals and their owner-review state.',
      schema: { state: z.enum(['proposed', 'pilot-approved', 'deferred', 'rejected', 'piloting', 'adopted', 'reversed']).optional() },
      invoke: ({ state }) => ({ proposals: hierarchyService.list({ state }) }),
    });
    tools.set('torch_get_hierarchy_proposal', {
      description: 'Read a durable hierarchy proposal, evidence, pilot criteria, and owner decision.',
      schema: { proposal_id: z.string().min(1) },
      invoke: ({ proposal_id: proposalId }) => hierarchyService.get(proposalId),
    });
    tools.set('torch_propose_hierarchy_change', {
      description: 'Submit a sustained-evidence, owner-review hierarchy proposal. This cannot change active roles or start sessions.',
      schema: {
        proposer: z.string().min(1).optional(),
        proposal: z.record(z.string(), z.unknown()),
      },
      invoke: ({ proposer, proposal }) => hierarchyService.propose({
        proposer: claimedIdentity(controlPlane, actorId, proposer, 'proposer'), proposal,
      }),
    });
    tools.set('torch_plan_hierarchy_pilot', {
      description: 'Preview hierarchy differences, affected work, and blockers for an owner-approved bounded pilot. Read-only.',
      schema: { proposal_id: z.string().min(1) },
      invoke: ({ proposal_id: proposalId }) => hierarchyService.planPilot(proposalId),
    });
  }
  if (artifactService) {
    tools.set('torch_publish_artifact', {
      description: 'Publish an image for an owned backlog task with exact identity, session, and commit provenance. The image is copied into private local TORCH state.',
      schema: {
        area_id: z.string().min(1).optional(), task_id: z.string().regex(/^TASK-[A-Za-z0-9-]+$/),
        title: z.string().min(1), alt: z.string().min(1), file: z.string().min(1), commit: z.string().regex(/^[a-f0-9]{40}$/i),
      },
      invoke: ({ area_id: areaId, task_id: taskId, ...input }) => artifactService.publish({
        areaId: claimedIdentity(controlPlane, actorId, areaId, 'area_id'), taskId, ...input,
      }),
    });
  }
  return tools;
}

export function describeTorchTools() {
  const placeholder = Object.freeze({});
  return [...createTorchToolset(placeholder, {
    backlogService: placeholder, checkService: placeholder, resourceService: placeholder,
    integrationService: placeholder, contextTelemetryService: placeholder,
    scheduleService: placeholder, evolutionService: placeholder,
    hierarchyService: placeholder, artifactService: placeholder,
  }).entries()].map(([name, tool]) => ({
    name,
    description: tool.description,
    inputSchema: z.toJSONSchema(inputSchema(tool)),
  }));
}

export function callTorchTool(controlPlane, name, input = {}, options = {}) {
  const tool = createTorchToolset(controlPlane, options).get(name);
  if (!tool) throw new Error(`Unknown TORCH MCP tool: ${name}`);
  const parsed = inputSchema(tool).parse(input);
  return tool.invoke(parsed);
}

export function createTorchMcpServer(controlPlane, {
  actorId, backlogService, checkService, resourceService, integrationService, contextTelemetryService, scheduleService,
  evolutionService, hierarchyService, repositoryRoot, artifactService,
} = {}) {
  controlPlane.assertIdentity(actorId);
  const server = new McpServer(
    { name: 'torch-agent-fleet', version: '0.1.0-alpha.0' },
    {
      instructions: 'Use live TORCH ownership before editing a boundary. Messages never grant owner, spending, deployment, or ownership-transfer authority.',
    },
  );
  for (const [name, tool] of createTorchToolset(controlPlane, {
    actorId, backlogService, checkService, resourceService, integrationService, contextTelemetryService, scheduleService,
    evolutionService, hierarchyService, repositoryRoot, artifactService,
  })) {
    server.registerTool(name, { description: tool.description, inputSchema: inputSchema(tool) }, async (input) => {
      try {
        const result = await tool.invoke(input);
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    });
  }
  return server;
}
