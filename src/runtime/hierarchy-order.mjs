import { organizationGraphFromConfig } from '../kernel/organization.mjs';

export function hierarchyOrder(roster, config) {
  const rosterIds = new Set(roster.areas.map((area) => area.id));
  const graph = organizationGraphFromConfig(config);
  const rolesById = new Map(graph.roles.map((role) => [role.id, role]));
  const rolesByIdentity = new Map();
  for (const role of graph.roles) {
    if (!rolesByIdentity.has(role.identity_id)) rolesByIdentity.set(role.identity_id, []);
    rolesByIdentity.get(role.identity_id).push(role);
  }
  const managersByIdentity = new Map(roster.areas.map((area) => [area.id, new Set()]));
  const dependencies = new Map(roster.areas.map((area) => [area.id, new Set()]));
  const blockers = [];

  for (const area of roster.areas) {
    if (!rolesByIdentity.has(area.id)) blockers.push({
      code: 'FLEET_STARTUP_ROLE_MISSING', areaId: area.id,
    });
  }

  for (const role of graph.roles) {
    if (!rosterIds.has(role.identity_id)) continue;
    for (const parentRoleId of role.reports_to) {
      const parent = rolesById.get(parentRoleId);
      if (!parent || parent.identity_id === role.identity_id || parent.identity_id === 'owner') continue;
      if (!rosterIds.has(parent.identity_id)) {
        blockers.push({
          code: 'FLEET_STARTUP_MANAGER_MISSING', areaId: role.identity_id,
          managerId: parent.identity_id,
        });
        continue;
      }
      managersByIdentity.get(role.identity_id).add(parent.identity_id);
      dependencies.get(role.identity_id).add(parent.identity_id);
    }
  }

  const remaining = new Set(roster.areas.map((area) => area.id));
  const startupWaves = [];
  while (remaining.size) {
    const ready = roster.areas.filter((area) => remaining.has(area.id)
      && [...dependencies.get(area.id)].every((managerId) => !remaining.has(managerId)));
    if (!ready.length) {
      blockers.push({
        code: 'FLEET_STARTUP_IDENTITY_CYCLE',
        areaIds: roster.areas.filter((area) => remaining.has(area.id)).map((area) => area.id),
      });
      startupWaves.push(roster.areas.filter((area) => remaining.has(area.id)));
      break;
    }
    startupWaves.push(ready);
    for (const area of ready) remaining.delete(area.id);
  }
  const areas = startupWaves.flat();
  return {
    areas,
    startupWaves: startupWaves.map((wave) => wave.map((area) => area.id)),
    startupOrder: areas.map((area) => area.id),
    shutdownOrder: [...areas].reverse().map((area) => area.id),
    managersByIdentity,
    blockers,
  };
}
