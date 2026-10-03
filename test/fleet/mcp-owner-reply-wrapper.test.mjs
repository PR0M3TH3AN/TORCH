import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openControlPlane } from '../../src/control-plane/service.mjs';
import { analyzeRepository } from '../../src/kernel/analyze.mjs';
import { proposeDomains } from '../../src/kernel/domains.mjs';
import { inspectRepository } from '../../src/kernel/git.mjs';
import { installProject } from '../../src/kernel/install.mjs';

const MCP_SERVER = new URL('../../src/mcp/server.mjs', import.meta.url).pathname;

function installedFixture() {
  const root = mkdtempSync(join(tmpdir(), 'torch-mcp-owner-reply-'));
  execFileSync('git', ['init', '-b', 'main', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'torch-test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'TORCH Test']);
  writeFileSync(join(root, 'index.js'), 'export const fixture = true;\n');
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'fixture']);
  const repository = inspectRepository(root);
  const proposal = proposeDomains({ repository, analysis: analyzeRepository(repository) });
  proposal.review = { status: 'approved', reviewedAt: '2026-10-03T00:00:00Z', reviewedBy: 'fixture-owner', notes: [] };
  const env = { ...process.env, XDG_DATA_HOME: join(root, '.data') };
  installProject({ repository, proposal, env, projectId: 'mcp-owner-reply-fixture' });
  const control = openControlPlane({ repositoryRoot: root, env });
  const identities = control.listAgents().map((agent) => agent.areaId);
  control.close();
  const worker = identities.find((areaId) => areaId !== 'qa' && areaId !== 'session-manager')
    ?? identities.find((areaId) => areaId !== 'qa')
    ?? identities[0];
  const other = identities.find((areaId) => areaId !== worker);
  assert.ok(other, 'fixture requires a second registered Fleet identity');
  return { root, env, worker, other };
}

async function connectMcp({ root, env, actorId }) {
  const child = spawn(process.execPath, [MCP_SERVER, '--root', root, '--area', actorId], {
    cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'],
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
  let nextId = 0;
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timeout = setTimeout(() => reject(new Error(`MCP response timeout. stderr: ${stderr}`)), 5000);
    responses.set(id, (response) => { clearTimeout(timeout); resolve(response); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  const initialized = await request('initialize', {
    protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'torch-test', version: '1.0.0' },
  });
  assert.equal(initialized.result.serverInfo.name, 'torch-agent-fleet');
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  return {
    request,
    async close() {
      child.stdin.end();
      await new Promise((resolve) => {
        const timeout = setTimeout(() => { child.kill('SIGTERM'); resolve(); }, 1000);
        child.once('exit', () => { clearTimeout(timeout); resolve(); });
      });
    },
  };
}

test('SCN-mcp-owner-reply-public-boundary: a bound MCP identity can reply only to its own owner request', async () => {
  const fixture = installedFixture();
  let control = openControlPlane({ repositoryRoot: fixture.root, env: fixture.env });
  const request = control.sendOwnerRequest({ actorId: 'owner', recipient: fixture.worker, body: 'Report the durable outcome.' });
  control.close();

  const workerMcp = await connectMcp({ ...fixture, actorId: fixture.worker });
  try {
    const listed = await workerMcp.request('tools/list', {});
    const replyTool = listed.result.tools.find((tool) => tool.name === 'torch_reply_to_owner');
    assert.ok(replyTool);
    assert.deepEqual(Object.keys(replyTool.inputSchema.properties).sort(), ['body', 'request_id']);
    assert.equal(replyTool.inputSchema.additionalProperties, false);
    assert.equal(listed.result.tools.some((tool) => /owner.*conversation|history/i.test(tool.name)), false);

    const replied = await workerMcp.request('tools/call', {
      name: 'torch_reply_to_owner', arguments: { request_id: request.id, body: 'The durable outcome is ready.' },
    });
    assert.equal(replied.result.isError, undefined);
    const reply = JSON.parse(replied.result.content[0].text);

    control = openControlPlane({ repositoryRoot: fixture.root, env: fixture.env });
    const conversation = control.readOwnerConversation({ actorId: 'owner', requestId: request.id, limit: 10 });
    assert.deepEqual(conversation.replies.map((message) => message.id), [reply.id]);
    assert.equal(conversation.replies[0].references.replyTo, request.id);
    const audit = control.readAudit().find((event) => event.operation === 'message.reply-owner' && event.entityId === reply.id);
    assert.deepEqual(audit && { actorId: audit.actorId, details: audit.details }, { actorId: fixture.worker, details: { requestId: request.id } });
    const before = { audit: control.readAudit().length, replies: conversation.replies.length };
    control.close();

    const schemaRefusal = await workerMcp.request('tools/call', {
      name: 'torch_reply_to_owner',
      arguments: { request_id: request.id, body: 'Attempt to select a sender.', sender: fixture.other },
    });
    assert.equal(schemaRefusal.result.isError, true);
    control = openControlPlane({ repositoryRoot: fixture.root, env: fixture.env });
    assert.equal(control.readAudit().length, before.audit);
    assert.equal(control.readOwnerConversation({ actorId: 'owner', requestId: request.id, limit: 10 }).replies.length, before.replies);
    control.close();
  } finally {
    await workerMcp.close();
  }

  const otherMcp = await connectMcp({ ...fixture, actorId: fixture.other });
  try {
    const wrongActor = await otherMcp.request('tools/call', {
      name: 'torch_reply_to_owner', arguments: { request_id: request.id, body: 'A valid identity cannot reply for another agent.' },
    });
    assert.equal(wrongActor.result.isError, true);
    assert.match(wrongActor.result.content[0].text, /owner request addressed to the sender/i);
  } finally {
    await otherMcp.close();
  }

  control = openControlPlane({ repositoryRoot: fixture.root, env: fixture.env });
  assert.equal(control.readOwnerConversation({ actorId: 'owner', requestId: request.id, limit: 10 }).replies.length, 1);
  control.close();
});
