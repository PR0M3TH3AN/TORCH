#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { resolve } from 'node:path';
import { openControlPlane } from '../control-plane/service.mjs';
import { createTorchMcpServer } from './tools.mjs';

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
const handle = serveStdio(() => createTorchMcpServer(controlPlane, { actorId }), {
  onerror: (error) => console.error(`TORCH MCP: ${error.message}`),
});

async function shutdown() {
  await handle.close();
  controlPlane.close();
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
