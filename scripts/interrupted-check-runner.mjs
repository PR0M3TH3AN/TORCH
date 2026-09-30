import { spawnSync } from 'node:child_process';
import { openControlPlane } from '../src/control-plane/service.mjs';
import { CheckService } from '../src/checks/service.mjs';
import { ResourceService } from '../src/resources/service.mjs';

const [repositoryRoot, preparedId, areaId] = process.argv.slice(2);
const control = openControlPlane({ repositoryRoot });
try {
  const resources = new ResourceService({ repositoryRoot, controlPlane: control });
  const checks = new CheckService({ repositoryRoot, controlPlane: control, resourceService: resources,
    executor: (command, args, options) => spawnSync(command, args, {
      ...options, stdio: ['ignore', 'inherit', 'pipe'],
    }) });
  checks.runPrepared({ preparedId, areaId });
} finally { control.close(); }
