#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { resolve } from 'node:path';
import { CheckService } from '../checks/service.mjs';
import { BacklogService } from '../backlog/service.mjs';
import { IntegrationService } from '../integration/service.mjs';
import { openControlPlane } from '../control-plane/service.mjs';
import { ResourceService } from '../resources/service.mjs';
import { createTorchMcpServer } from './tools.mjs';
import { ContextTelemetryService } from '../telemetry/context.mjs';
import { ScheduleService } from '../schedules/service.mjs';
import { FleetEvolutionService } from '../evolution/service.mjs';
import { HierarchyEvolutionService } from '../evolution/hierarchy.mjs';
import { ArtifactService } from '../artifacts/service.mjs';

function optionValue(argv, name) {
  const direct = argv.find((argument) => argument.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

const repositoryRoot = resolve(optionValue(process.argv.slice(2), '--root') ?? process.cwd());
const actorId = optionValue(process.argv.slice(2), '--area');
const controlPlane = openControlPlane({ repositoryRoot });
controlPlane.assertIdentity(actorId);
const resourceService = new ResourceService({ repositoryRoot, controlPlane });
const checkService = new CheckService({ repositoryRoot, controlPlane, resourceService });
const integrationService = new IntegrationService({ repositoryRoot, controlPlane, checkService });
const backlogService = new BacklogService({
  repositoryRoot, controlPlane, checkService, integrationLookup: (requestId) => integrationService.get(requestId),
});
const contextTelemetryService = new ContextTelemetryService({ controlPlane });
const scheduleService = new ScheduleService({ repositoryRoot, controlPlane });
const evolutionService = new FleetEvolutionService({ repositoryRoot, controlPlane });
const hierarchyService = new HierarchyEvolutionService({ repositoryRoot, controlPlane });
const artifactService = new ArtifactService({ repositoryRoot, controlPlane, backlogService });
const handle = serveStdio(() => createTorchMcpServer(controlPlane, {
  actorId, repositoryRoot, backlogService, checkService, resourceService, integrationService, contextTelemetryService, scheduleService,
  evolutionService, hierarchyService, artifactService,
}), {
  onerror: (error) => console.error(`TORCH MCP: ${error.message}`),
});

async function shutdown() {
  await handle.close();
  controlPlane.close();
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
