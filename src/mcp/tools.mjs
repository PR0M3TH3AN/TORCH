import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { TorchError } from '../kernel/errors.mjs';

const optionalReferenceShape = {
  task: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  commit: z.string().min(1).optional(),
  handoff: z.string().min(1).optional(),
};

export const TORCH_CORE_MCP_TOOL_NAMES = Object.freeze([
  'torch_identity',
  'torch_list_agents',
  'torch_get_agent',
  'torch_get_roster',
  'torch_who_owns',
  'torch_neighbours',
  'torch_send_message',
  'torch_read_messages',
  'torch_ack_message',
  'torch_report_status',
  'torch_report_complete',
  'torch_report_blocked',
  'torch_request_coordination',
  'torch_request_handoff',
]);

export const TORCH_MCP_TOOL_NAMES = Object.freeze([
  ...TORCH_CORE_MCP_TOOL_NAMES,
  'torch_list_backlog',
  'torch_get_backlog_task',
  'torch_create_backlog_task',
  'torch_transition_backlog_task',
  'torch_list_checks',
  'torch_list_check_receipts',
  'torch_plan_check',
  'torch_run_check',
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

export function createTorchToolset(controlPlane, {
  actorId, backlogService, checkService, resourceService, integrationService, contextTelemetryService, scheduleService,
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
        acceptance_criteria: z.array(z.string().min(1)).min(1),
      },
      invoke: ({
        actor_id: actorIdClaim, affected_domains: affectedDomains,
        acceptance_criteria: acceptanceCriteria, ...input
      }) => backlogService.create({
        ...input, affectedDomains, acceptanceCriteria,
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
      description: 'Run a read-only configured schedule as the bound Fleet identity. Mutating schedules require owner CLI approval.',
      schema: { schedule_id: z.string().min(1) },
      invoke: ({ schedule_id: scheduleId }) => scheduleService.run({ scheduleId, actorId, approved: false }),
    });
  }
  return tools;
}

export function callTorchTool(controlPlane, name, input = {}, options = {}) {
  const tool = createTorchToolset(controlPlane, options).get(name);
  if (!tool) throw new Error(`Unknown TORCH MCP tool: ${name}`);
  const parsed = z.object(tool.schema).parse(input);
  return tool.invoke(parsed);
}

export function createTorchMcpServer(controlPlane, {
  actorId, backlogService, checkService, resourceService, integrationService, contextTelemetryService, scheduleService,
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
  })) {
    server.registerTool(name, { description: tool.description, inputSchema: tool.schema }, async (input) => {
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
