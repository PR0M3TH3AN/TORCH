import { z } from 'zod';
import { TorchError } from './errors.mjs';

const text = z.string().trim().min(1);
const id = text.regex(/^[a-z0-9][a-z0-9-]*$/);

const role = z.object({
  id,
  title: text,
  kind: z.enum([
    'owner', 'owner-facing', 'program-direction', 'fleet-operations', 'domain-coordination',
    'specialist', 'independent-review',
  ]),
  identity_id: id,
  responsibilities: z.array(text).min(1),
  authority: z.array(z.enum([
    'receive-owner-requests', 'propose-priorities', 'sequence-domains',
    'operate-fleet', 'coordinate-domains', 'review-deliverables',
    'own-implementation', 'approve-organization', 'approve-release',
  ])),
  coordinates: z.array(id),
  reports_to: z.array(id),
  consults_with: z.array(id),
}).strict();

const implementationOwner = z.object({
  surface: text,
  identity_id: id,
}).strict();

export const organizationGraphSchema = z.object({
  schema: z.literal('torch.dev/organization/v1alpha1'),
  revision: z.number().int().positive(),
  owner_facing_role: id,
  roles: z.array(role).min(1),
  implementation_owners: z.array(implementationOwner),
}).strict().superRefine((graph, context) => {
  const rolesById = new Map();
  const roleByIdentity = new Map();
  graph.roles.forEach((entry, index) => {
    if (rolesById.has(entry.id)) {
      context.addIssue({ code: 'custom', path: ['roles', index, 'id'], message: `duplicate role ID: ${entry.id}` });
    }
    rolesById.set(entry.id, entry);
    if (!roleByIdentity.has(entry.identity_id)) roleByIdentity.set(entry.identity_id, []);
    roleByIdentity.get(entry.identity_id).push(entry);
    if (entry.kind !== 'owner' && entry.authority.some((capability) =>
      ['approve-organization', 'approve-release'].includes(capability))) {
      context.addIssue({
        code: 'custom', path: ['roles', index, 'authority'],
        message: 'owner-reserved approval authority cannot be assigned to a fleet role',
      });
    }
    if (entry.kind !== 'specialist' && entry.authority.includes('own-implementation')) {
      context.addIssue({
        code: 'custom', path: ['roles', index, 'authority'],
        message: 'implementation ownership belongs to specialist roles, not coordination roles',
      });
    }
  });

  const owners = graph.roles.filter((entry) => entry.kind === 'owner');
  if (owners.length !== 1 || owners[0]?.identity_id !== 'owner') {
    context.addIssue({
      code: 'custom', path: ['roles'],
      message: 'organization must represent exactly one human owner identity',
    });
  }
  const ownerFacing = graph.roles.filter((entry) => entry.kind === 'owner-facing');
  if (ownerFacing.length !== 1 || ownerFacing[0]?.id !== graph.owner_facing_role) {
    context.addIssue({
      code: 'custom', path: ['owner_facing_role'],
      message: 'organization must name its single owner-facing role',
    });
  }

  const references = ['coordinates', 'reports_to', 'consults_with'];
  graph.roles.forEach((entry, index) => {
    for (const field of references) {
      entry[field].forEach((target, targetIndex) => {
        if (!rolesById.has(target)) {
          context.addIssue({
            code: 'custom', path: ['roles', index, field, targetIndex],
            message: `unknown role reference: ${target}`,
          });
        }
      });
    }
  });

  const visiting = new Set();
  const visited = new Set();
  function visit(roleId) {
    if (visiting.has(roleId)) return true;
    if (visited.has(roleId)) return false;
    visiting.add(roleId);
    const entry = rolesById.get(roleId);
    const cyclic = entry?.reports_to.some((manager) => visit(manager)) ?? false;
    visiting.delete(roleId);
    visited.add(roleId);
    return cyclic;
  }
  graph.roles.forEach((entry, index) => {
    if (visit(entry.id)) {
      context.addIssue({
        code: 'custom', path: ['roles', index, 'reports_to'],
        message: 'reporting relationships must be acyclic',
      });
    }
  });

  const surfaces = new Set();
  graph.implementation_owners.forEach((owner, index) => {
    if (surfaces.has(owner.surface)) {
      context.addIssue({
        code: 'custom', path: ['implementation_owners', index, 'surface'],
        message: `implementation surface has multiple owners: ${owner.surface}`,
      });
    }
    surfaces.add(owner.surface);
    const holders = roleByIdentity.get(owner.identity_id) ?? [];
    if (!holders.some((entry) => entry.kind === 'specialist')) {
      context.addIssue({
        code: 'custom', path: ['implementation_owners', index, 'identity_id'],
        message: 'implementation owner must have a specialist role in the organization',
      });
    }
  });
});

export function validateOrganizationGraph(value) {
  const result = organizationGraphSchema.safeParse(value);
  if (!result.success) {
    throw new TorchError('TORCH organization graph is invalid', {
      code: 'ORGANIZATION_GRAPH_INVALID',
      details: result.error.issues.map((issue) => ({
        path: issue.path.length ? issue.path.join('.') : '<root>',
        message: issue.message,
        code: issue.code,
      })),
    });
  }
  return value;
}

export function organizationGraphFromConfig(config) {
  if (config.organization) return validateOrganizationGraph(config.organization);
  const domains = config.domains ?? [];
  const domainIds = new Set(domains.map((domain) => domain.id));
  const specialistRoles = domains.map((domain) => ({
    id: domain.id,
    title: domain.title,
    kind: 'specialist',
    identity_id: domain.id,
    responsibilities: [...(domain.scope ?? [])],
    authority: ['own-implementation'],
    coordinates: [],
    reports_to: ['session-manager'],
    consults_with: (domain.neighbours ?? []).filter((neighbour) => domainIds.has(neighbour)),
  }));
  const graph = {
    schema: 'torch.dev/organization/v1alpha1',
    revision: 1,
    owner_facing_role: 'session-manager',
    roles: [
      {
        id: 'owner', title: 'Project Owner', kind: 'owner', identity_id: 'owner',
        responsibilities: ['Own project direction and owner-reserved decisions.'],
        authority: ['approve-organization', 'approve-release'],
        coordinates: [], reports_to: [], consults_with: [],
      },
      {
        id: 'session-manager', title: 'Session Manager', kind: 'owner-facing', identity_id: 'session-manager',
        responsibilities: ['Receive owner requests and coordinate the approved Fleet.'],
        authority: ['receive-owner-requests', 'propose-priorities', 'sequence-domains', 'operate-fleet'],
        coordinates: specialistRoles.map((entry) => entry.id), reports_to: [], consults_with: [],
      },
      ...specialistRoles,
    ],
    implementation_owners: domains.flatMap((domain) =>
      (domain.owned_paths ?? []).map((surface) => ({ surface, identity_id: domain.id }))),
  };
  return validateOrganizationGraph(graph);
}

export function defaultManagerCheckInSchedule(managerId, { intervalSeconds = 900 } = {}) {
  if (!id.safeParse(managerId).success) {
    throw new TorchError(`Invalid manager identity for check-in schedule: ${managerId}`, {
      code: 'MANAGER_CHECKIN_IDENTITY_INVALID', details: { managerId },
    });
  }
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 60) {
    throw new TorchError('Manager check-in interval must be at least 60 seconds', {
      code: 'MANAGER_CHECKIN_INTERVAL_INVALID', details: { intervalSeconds },
    });
  }
  const title = managerId === 'session-manager' ? 'Session Manager' : managerId;
  return {
    id: managerId === 'session-manager' ? 'session-manager-check-in' : `${managerId}-check-in`,
    title: `${title} direct-report check-in`, owner: managerId, lifetime: 'system',
    trigger: { type: 'interval', seconds: intervalSeconds }, behavior: 'coordination',
    action: { type: 'manager-check-in', manager_id: managerId },
    required_authority: ['owner'], retry: { max_attempts: 1 },
    failure_recipient: managerId,
    source_of_truth: 'active organization direct-report graph',
  };
}

/**
 * Plan schedule coverage whenever an organization graph changes. Existing
 * manager schedules keep their configured cadence; missing schedules are
 * proposed at the default cadence. Obsolete schedules are reported, not
 * removed automatically, because changing an installed system timer is an
 * owner-authorized operation.
 */
export function planManagerCheckInSchedules({ graph, schedules = [], intervalSeconds = 900 } = {}) {
  const organization = validateOrganizationGraph(graph);
  const parentRoleIds = new Set(organization.roles.flatMap((role) => role.reports_to));
  const managerIds = [...new Set(organization.roles
    .filter((role) => role.kind !== 'owner' && parentRoleIds.has(role.id))
    .map((role) => role.identity_id))].sort();
  const existing = schedules.filter((entry) => entry.action?.type === 'manager-check-in');
  const existingManagerIds = new Set(existing.map((entry) => entry.action.manager_id));
  const additions = managerIds
    .filter((managerId) => !existingManagerIds.has(managerId))
    .map((managerId) => defaultManagerCheckInSchedule(managerId, { intervalSeconds }));
  const existingScheduleIds = new Set(schedules.map((entry) => entry.id));
  const collisions = additions.filter((entry) => existingScheduleIds.has(entry.id));
  if (collisions.length) {
    throw new TorchError('Generated manager check-in schedule IDs conflict with configured schedules', {
      code: 'MANAGER_CHECKIN_SCHEDULE_ID_COLLISION',
      details: collisions.map(({ id: scheduleId, action }) => ({ scheduleId, managerId: action.manager_id })),
    });
  }
  const activeManagerIds = new Set(managerIds);
  return {
    schedules: [...schedules, ...additions], additions,
    obsolete: existing.filter((entry) => !activeManagerIds.has(entry.action.manager_id)),
    coveredManagerIds: managerIds,
    mutationPerformed: false,
  };
}
