import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createClaudeAdapter } from '../../src/adapters/claude.mjs';
import { openControlPlane } from '../../src/control-plane/service.mjs';
import { analyzeRepository } from '../../src/kernel/analyze.mjs';
import { proposeDomains } from '../../src/kernel/domains.mjs';
import { inspectRepository } from '../../src/kernel/git.mjs';
import { installProject } from '../../src/kernel/install.mjs';
import { callTorchTool, createTorchToolset, TORCH_MCP_TOOL_NAMES } from '../../src/mcp/tools.mjs';

const MCP_SERVER = new URL('../../src/mcp/server.mjs', import.meta.url).pathname;

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'torch-mcp-'));
  execFileSync('git', ['init', '-b', 'main', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'torch-test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'TORCH Test']);
  writeFileSync(join(root, 'app.js'), 'export const app = true;\n');
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'fixture']);
  const repository = inspectRepository(root);
  const proposal = proposeDomains({ repository, analysis: analyzeRepository(repository) });
  proposal.review = {
    status: 'approved', reviewedAt: '2026-09-27T00:00:00Z', reviewedBy: 'fixture-owner', notes: [],
  };
  const env = { ...process.env, XDG_DATA_HOME: join(root, '.data') };
  installProject({ repository, proposal, env, projectId: 'mcp-fixture' });
  return { root, env, worker: proposal.domains[0].id };
}

test('SCN-mcp-parity: every specified MCP tool exists and invokes the same durable service as CLI callers', () => {
  const context = fixture();
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  assert.deepEqual([...createTorchToolset(control).keys()], TORCH_MCP_TOOL_NAMES);
  const sent = callTorchTool(control, 'torch_send_message', {
    sender: 'session-manager', recipient: context.worker, body: 'MCP-visible task', task: 'TASK-MCP',
  });
  const read = callTorchTool(control, 'torch_read_messages', {
    recipient: context.worker, unacknowledged_only: true,
  });
  assert.equal(read.messages[0].id, sent.id);
  assert.equal(read.messages[0].references.task, 'TASK-MCP');
  const owner = callTorchTool(control, 'torch_who_owns', { path: 'app.js' });
  assert.equal(owner.owners.some((candidate) => candidate.areaId === context.worker), true);
  assert.throws(
    () => callTorchTool(control, 'torch_send_message', { sender: 'forged', recipient: context.worker, body: 'No' }),
    (error) => error.code === 'UNKNOWN_FLEET_IDENTITY',
  );
  assert.throws(
    () => callTorchTool(control, 'torch_send_message', {
      sender: 'session-manager', recipient: context.worker, body: 'Impersonated manager',
    }, { actorId: context.worker }),
    (error) => error.code === 'FLEET_IDENTITY_MISMATCH',
  );
  control.close();
});

test('SCN-claude-adapter: planning is deterministic, capabilities are honest, and no process launches without authority', () => {
  const context = fixture();
  const calls = [];
  const adapter = createClaudeAdapter({
    executable: '/opt/claude/bin/claude',
    idFactory: () => 'runtime-123',
    runner: (command, args) => {
      calls.push({ command, args });
      if (args[0] === 'agents') return { status: 0, stdout: '[{"sessionId":"runtime-123","status":"idle"}]' };
      return { status: 0, stdout: '' };
    },
  });
  assert.equal(adapter.capabilities.liveSteering, false);
  assert.equal(adapter.capabilities.sendOrSteer, 'durable-fallback');
  const launch = adapter.createSession({
    areaId: context.worker, title: 'Core', worktree: '/tmp/core', promptFile: '/tmp/core.md',
    firstMessage: 'Resume TASK-1.', model: 'opus',
  });
  assert.equal(launch.runtimeSessionId, 'runtime-123');
  assert.deepEqual(launch.launch.args.slice(0, 7), [
    '--bg', '--model', 'opus', '--session-id', 'runtime-123', '-n', 'TORCH · Core',
  ]);
  assert.equal(calls.length, 0, 'creating a launch plan must not execute Claude');
  assert.equal(adapter.getStatus({ runtimeSessionId: 'runtime-123' }).status, 'idle');
  assert.equal(calls.length, 1);
  assert.throws(() => adapter.installHooks(), (error) => error.code === 'RUNTIME_CAPABILITY_UNSUPPORTED');

  const noRunner = createClaudeAdapter({ idFactory: () => 'never-run' });
  assert.throws(() => noRunner.listSessions(), (error) => error.code === 'RUNTIME_EXECUTION_NOT_AUTHORIZED');
});

test('SCN-mcp-stdio: an MCP host can initialize and list the TORCH tool surface over stdio', async () => {
  const context = fixture();
  const child = spawn(process.execPath, [MCP_SERVER, '--root', context.root, '--area', context.worker], {
    cwd: context.root, env: context.env, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const responses = new Map();
  let stdout = '';
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    const lines = stdout.split('\n');
    stdout = lines.pop();
    for (const line of lines.filter(Boolean)) {
      const message = JSON.parse(line);
      if (message.id !== undefined) responses.get(message.id)?.(message);
    }
  });
  const request = (message) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`MCP response timeout. stderr: ${stderr}`)), 5000);
    responses.set(message.id, (response) => { clearTimeout(timeout); resolve(response); });
    child.stdin.write(`${JSON.stringify(message)}\n`);
  });
  try {
    const initialized = await request({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'torch-test', version: '1.0.0' } },
    });
    assert.equal(initialized.result.serverInfo.name, 'torch-agent-fleet');
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const listed = await request({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    assert.deepEqual(listed.result.tools.map((tool) => tool.name), TORCH_MCP_TOOL_NAMES);
  } finally {
    child.stdin.end();
    await new Promise((resolve) => {
      const timeout = setTimeout(() => { child.kill('SIGTERM'); resolve(); }, 1000);
      child.once('exit', () => { clearTimeout(timeout); resolve(); });
    });
  }
});
