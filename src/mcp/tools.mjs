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
  actorId, checkService, resourceService, integrationService,
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
  return tools;
}

export function callTorchTool(controlPlane, name, input = {}, options = {}) {
  const tool = createTorchToolset(controlPlane, options).get(name);
  if (!tool) throw new Error(`Unknown TORCH MCP tool: ${name}`);
  const parsed = z.object(tool.schema).parse(input);
  return tool.invoke(parsed);
}

export function createTorchMcpServer(controlPlane, {
  actorId, checkService, resourceService, integrationService,
} = {}) {
  controlPlane.assertIdentity(actorId);
  const server = new McpServer(
    { name: 'torch-agent-fleet', version: '0.1.0-alpha.0' },
    {
      instructions: 'Use live TORCH ownership before editing a boundary. Messages never grant owner, spending, deployment, or ownership-transfer authority.',
    },
  );
  for (const [name, tool] of createTorchToolset(controlPlane, {
    actorId, checkService, resourceService, integrationService,
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
