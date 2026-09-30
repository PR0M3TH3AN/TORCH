import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import { createPiAdapter } from '../../src/adapters/pi.mjs';
import { createRuntimeAdapterRegistry } from '../../src/adapters/registry.mjs';
import { profileCapabilityIssues } from '../../src/adapters/runtime.mjs';
import { describeTorchTools, TORCH_MCP_TOOL_NAMES } from '../../src/mcp/tools.mjs';
import { createTorchPiExtension } from '../../src/adapters/pi/extension.mjs';
import { analyzeRepository } from '../../src/kernel/analyze.mjs';
import { proposeDomains } from '../../src/kernel/domains.mjs';
import { inspectRepository } from '../../src/kernel/git.mjs';
import { installProject } from '../../src/kernel/install.mjs';
import { createWorktrees } from '../../src/kernel/worktrees.mjs';
import { openControlPlane } from '../../src/control-plane/service.mjs';
import { planFleetUp } from '../../src/runtime/lifecycle.mjs';

const MCP_SERVER = new URL('../../src/mcp/server.mjs', import.meta.url).pathname;

function fixture({ withWorktrees = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'torch-pi-'));
  const env = { ...process.env, XDG_DATA_HOME: join(tmpdir(), `${basename(root)}-data`) };
  execFileSync('git', ['init', '-b', 'main', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'torch-test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'TORCH Test']);
  writeFileSync(join(root, 'app.js'), 'export const app = true;\n');
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'fixture']);
  const repository = inspectRepository(root);
  const proposal = proposeDomains({ repository, analysis: analyzeRepository(repository) });
  const worker = proposal.domains[0];
  worker.runtime = 'pi';
  worker.model = 'openai/test-model';
  worker.reasoning = 'high';
  proposal.review = {
    status: 'approved', reviewedAt: '2026-09-28T00:00:00Z', reviewedBy: 'fixture-owner', notes: [],
  };
  installProject({ repository, proposal, env, projectId: 'pi-fixture', runtimes: ['claude', 'codex', 'pi'] });
  if (withWorktrees) {
    execFileSync('git', ['-C', root, 'add', '.torch']);
    execFileSync('git', ['-C', root, 'commit', '-m', 'install TORCH fixture']);
    createWorktrees({
      repository: inspectRepository(root),
      parentOverride: join(tmpdir(), `${basename(root)}-worktrees`),
    });
  }
  return { root, env, worker: worker.id };
}

test('SCN-pi-adapter: Pi profiles produce isolated resumable-turn plans with an explicit required model', () => {
  const adapter = createPiAdapter({ idFactory: () => 'pi-session-123' });
  const integration = adapter.configure({
    repositoryRoot: '/project', areaId: 'worker', mcpEntry: '/torch/src/mcp/server.mjs',
    stateRoot: '/private/torch/project-state',
  });
  assert.equal(integration.mutationPerformed, false);
  assert.equal(integration.integration.type, 'pi-mcp-extension');
  assert.equal(integration.integration.sessionDir, '/private/torch/project-state/sessions/pi/worker');

  const start = adapter.createSession({
    areaId: 'worker', title: 'Worker', worktree: '/worktree', promptFile: '/private/prompts/worker.md',
    firstMessage: 'Begin.', model: 'openai/test-model', reasoning: 'high', integration: integration.integration,
  });
  assert.equal(start.runtimeSessionId, 'pi-session-123');
  assert.equal(start.requiresRuntimeIdCapture, false);
  assert.equal(start.completionState, 'idle');
  assert.equal(start.launch.command, 'pi');
  assert.equal(start.launch.cwd, '/worktree');
  assert.equal(start.launch.args.includes('--no-extensions'), true);
  assert.equal(start.launch.args.includes('--no-context-files'), true);
  assert.equal(start.launch.args.includes('--no-approve'), true);
  assert.equal(start.launch.args.includes('/private/torch/project-state/sessions/pi/worker'), true);
  assert.equal(start.launch.args.includes('openai/test-model'), true);
  assert.deepEqual(start.launch.args.slice(start.launch.args.indexOf('--thinking'), start.launch.args.indexOf('--thinking') + 2), ['--thinking', 'high']);

  const resumed = adapter.resumeSession({
    areaId: 'worker', runtimeSessionId: start.runtimeSessionId, worktree: '/worktree',
    promptFile: '/private/prompts/worker-current.md',
    message: 'Continue from durable TORCH state.', model: 'openai/test-model', reasoning: 'medium',
    integration: integration.integration,
  });
  assert.equal(resumed.runtimeSessionId, start.runtimeSessionId);
  assert.equal(resumed.launch.args.includes('--session-id'), true);
  assert.equal(resumed.launch.args.includes('Continue from durable TORCH state.'), true);
  assert.deepEqual(resumed.launch.args.slice(resumed.launch.args.indexOf('--append-system-prompt'), resumed.launch.args.indexOf('--append-system-prompt') + 2), [
    '--append-system-prompt', '/private/prompts/worker-current.md',
  ]);
  assert.throws(() => adapter.createSession({
    areaId: 'worker', worktree: '/worktree', promptFile: '/prompt', firstMessage: 'Begin.',
    model: 'openai/test-model', integration: {},
  }), (error) => error.code === 'RUNTIME_CONFIGURATION_INVALID');
  assert.throws(() => adapter.createSession({
    areaId: 'worker', worktree: '/worktree', promptFile: '/prompt', firstMessage: 'Begin.',
    model: 'openai/test-model', reasoning: 'ultra', integration: integration.integration,
  }), (error) => error.code === 'RUNTIME_PROFILE_INVALID');
  assert.deepEqual(adapter.capabilities.processModel, 'resumable-turn');
  assert.throws(() => adapter.stopSession(), (error) => error.code === 'RUNTIME_CAPABILITY_UNSUPPORTED');
  assert.equal(createRuntimeAdapterRegistry().has('pi'), true);
  assert.deepEqual(adapter.capabilities.modelRequired, true);
  assert.deepEqual(profileCapabilityIssues(adapter, { model: null, reasoning: 'high' }), [
    { field: 'model', capability: 'modelSelection', required: true },
  ]);
});

test('SCN-pi-lifecycle-plan: installed fleet planning passes identity-bound Pi integration without starting it', () => {
  const context = fixture({ withWorktrees: true });
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  try {
    const registry = createRuntimeAdapterRegistry({ env: context.env });
    const plan = planFleetUp({
      repositoryRoot: context.root, controlPlane: control, adapters: registry.toMap(), fresh: true,
    });
    assert.equal(plan.canProceed, true, JSON.stringify(plan.blockers));
    const action = plan.actions.find((candidate) => candidate.areaId === context.worker);
    assert.equal(action.runtime, 'pi');
    assert.equal(action.profile.model, 'openai/test-model');
    assert.equal(action.profile.reasoning, 'high');
    assert.equal(action.integration.type, 'pi-mcp-extension');
    assert.equal(action.integration.areaId, context.worker);
    assert.equal(action.integration.repositoryRoot, context.root);
    assert.equal(action.launch.args.includes(`--torch-area`), true);
    assert.equal(action.launch.args.includes(context.worker), true);
    assert.equal(action.launch.args.includes('openai/test-model'), true);
    assert.equal(action.requiresRuntimeIdCapture, false);
    assert.equal(action.completionState, 'idle');
    assert.equal(plan.mutationPerformed, false);
    assert.equal(control.identity(context.worker).runtimeSessionId, null);
  } finally {
    control.close();
  }
});

test('SCN-pi-mcp-bridge: Pi exposes every identity-bound TORCH MCP tool without project extension discovery', async () => {
  const context = fixture();
  const tools = [];
  const flags = new Map([
    ['torch-root', context.root], ['torch-area', context.worker],
    ['torch-mcp-entry', MCP_SERVER], ['torch-node', process.execPath],
  ]);
  const pi = {
    registerFlag: (name, options) => flags.set(`registered:${name}`, options),
    getFlag: (name) => flags.get(name),
    registerTool: (tool) => tools.push(tool),
  };
  const result = createTorchPiExtension(pi, {
    Type: { Unsafe: (schema) => schema },
    spawnProcess: (command, args, options) => spawn(command, args, { ...options, env: context.env }),
  });
  assert.deepEqual(result.registered, TORCH_MCP_TOOL_NAMES);
  assert.deepEqual(tools.map((tool) => tool.name), TORCH_MCP_TOOL_NAMES);
  assert.equal(describeTorchTools().length, TORCH_MCP_TOOL_NAMES.length);
  assert.equal(flags.get('registered:torch-area').type, 'string');

  const identityTool = tools.find((tool) => tool.name === 'torch_identity');
  const identityResult = await identityTool.execute('call-1', {}, undefined, undefined, {});
  const identity = JSON.parse(identityResult.content[0].text);
  assert.equal(identity.areaId, context.worker);
  assert.equal(identity.runtime, 'pi');

  await assert.rejects(
    identityTool.execute('call-2', { area_id: 'session-manager' }, undefined, undefined, {}),
    /cannot act as session-manager/i,
  );
  const messageTool = tools.find((tool) => tool.name === 'torch_send_message');
  const messageResult = await messageTool.execute('call-3', {
    recipient: 'session-manager', body: 'Pi MCP bridge verified.',
  }, undefined, undefined, {});
  assert.match(messageResult.content[0].text, /message/i);
});

test('SCN-pi-installed-extension-startup: an installed Pi loads the bundled bridge offline without a provider turn', (t) => {
  const version = spawnSync('pi', ['--version'], { encoding: 'utf8', timeout: 5_000 });
  if (version.error?.code === 'ENOENT') {
    t.skip('Pi CLI is not installed in this environment');
    return;
  }
  assert.equal(version.status, 0, version.stderr);

  const context = fixture();
  const privateConfig = join(context.root, '.pi-smoke-config');
  const privateSessions = join(context.root, '.pi-smoke-sessions');
  const result = spawnSync('pi', [
    '--no-session', '--mode', 'rpc', '--no-extensions', '--no-context-files', '--no-approve', '--offline',
    '--extension', new URL('../../src/adapters/pi/extension.mjs', import.meta.url).pathname,
    '--torch-root', context.root,
    '--torch-area', context.worker,
    '--torch-mcp-entry', MCP_SERVER,
    '--torch-node', process.execPath,
    '--session-dir', privateSessions,
  ], {
    cwd: context.root,
    env: {
      ...context.env,
      PI_OFFLINE: '1',
      PI_TELEMETRY: '0',
      PI_CODING_AGENT_DIR: privateConfig,
      PI_CODING_AGENT_SESSION_DIR: privateSessions,
    },
    input: '{"type":"get_state","id":"torch-extension-smoke"}\n',
    encoding: 'utf8',
    timeout: 15_000,
  });

  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const events = result.stdout.trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(events.some((event) => event.type === 'extension_error'), false, result.stdout);
  assert.equal(events.some((event) => event.type === 'response'
    && event.id === 'torch-extension-smoke' && event.command === 'get_state' && event.success), true, result.stdout);
});
