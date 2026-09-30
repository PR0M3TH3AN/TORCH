import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { describeTorchTools } from '../../mcp/tools.mjs';

const PROTOCOL_VERSION = '2025-06-18';
const REQUEST_TIMEOUT_MS = 120_000;

function requiredFlag(pi, name) {
  const value = pi.getFlag(name);
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`TORCH Pi extension requires --${name}`);
  }
  return value.trim();
}

function safeArguments(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

export async function callTorchMcp({
  nodeExecutable, mcpEntry, repositoryRoot, areaId, name, input,
  spawnProcess = spawn, signal,
} = {}) {
  const executable = requiredString(nodeExecutable, 'nodeExecutable');
  const entry = requiredString(mcpEntry, 'mcpEntry');
  const root = requiredString(repositoryRoot, 'repositoryRoot');
  const identity = requiredString(areaId, 'areaId');
  const toolName = requiredString(name, 'name');
  const child = spawnProcess(executable, [entry, '--root', root, '--area', identity], {
    cwd: root, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map();
  let nextId = 0;
  let buffer = '';
  let stderr = '';
  let terminated = false;

  const failPending = (error) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
  };

  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines.map((entryLine) => entryLine.trim()).filter(Boolean)) {
      let message;
      try { message = JSON.parse(line); } catch {
        failPending(new Error('TORCH MCP bridge returned invalid JSON.'));
        continue;
      }
      if (message.id === undefined) continue;
      const request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error.message ?? 'TORCH MCP request failed.'));
      else request.resolve(message.result);
    }
  });
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk.toString()}`.slice(-8192);
  });
  child.on('error', (error) => failPending(error));
  child.on('exit', (code, childSignal) => {
    if (!terminated) {
      failPending(new Error(`TORCH MCP bridge exited (${code ?? childSignal ?? 'unknown'}). ${stderr}`.trim()));
    }
  });

  const request = (method, params, timeoutMs = REQUEST_TIMEOUT_MS) => {
    if (signal?.aborted) return Promise.reject(new Error('TORCH MCP tool call was cancelled.'));
    const id = ++nextId;
    return new Promise((resolveResponse, rejectResponse) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        rejectResponse(new Error(`TORCH MCP ${method} timed out after ${timeoutMs} ms. ${stderr}`.trim()));
      }, timeoutMs);
      pending.set(id, { resolve: resolveResponse, reject: rejectResponse, timer });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`, (error) => {
        if (!error) return;
        clearTimeout(timer);
        pending.delete(id);
        rejectResponse(error);
      });
    });
  };

  const abort = () => {
    terminated = true;
    child.kill('SIGTERM');
    failPending(new Error('TORCH MCP tool call was cancelled.'));
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    await request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'torch-pi-extension', version: '0.1.0-alpha.0' },
    }, 15_000);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const result = await request('tools/call', {
      name: toolName, arguments: safeArguments(input),
    });
    if (result?.isError) {
      throw new Error(result.content?.map((part) => part.text ?? '').filter(Boolean).join('\n') || 'TORCH tool returned an error.');
    }
    return result;
  } finally {
    signal?.removeEventListener('abort', abort);
    terminated = true;
    child.stdin.end();
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise((resolveExit) => {
        const timer = setTimeout(() => {
          child.kill('SIGTERM');
          resolveExit();
        }, 1000);
        timer.unref?.();
        child.once('exit', () => {
          clearTimeout(timer);
          resolveExit();
        });
      });
    }
  }
}

function requiredString(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}

export function createTorchPiExtension(pi, {
  Type,
  spawnProcess = spawn,
} = {}) {
  for (const [name, description] of [
    ['torch-root', 'Absolute TORCH project repository root.'],
    ['torch-area', 'Bound TORCH Fleet identity for this Pi session.'],
    ['torch-mcp-entry', 'Absolute path to TORCH MCP server entry point.'],
    ['torch-node', 'Node.js executable used to launch the TORCH MCP server.'],
  ]) {
    pi.registerFlag(name, { type: 'string', description });
  }
  const registered = [];
  for (const tool of describeTorchTools()) {
    pi.registerTool({
      name: tool.name,
      label: `TORCH ${tool.name}`,
      description: tool.description,
      parameters: Type.Unsafe(tool.inputSchema),
      async execute(_toolCallId, input, signal) {
        const result = await callTorchMcp({
          nodeExecutable: requiredFlag(pi, 'torch-node'),
          mcpEntry: requiredFlag(pi, 'torch-mcp-entry'),
          repositoryRoot: resolve(requiredFlag(pi, 'torch-root')),
          areaId: requiredFlag(pi, 'torch-area'),
          name: tool.name, input, spawnProcess, signal,
        });
        const text = result?.content?.map((part) => part.text ?? '').filter(Boolean).join('\n')
          || JSON.stringify(result?.structuredContent ?? result ?? {});
        return {
          content: [{ type: 'text', text }],
          details: result?.structuredContent ?? result ?? null,
        };
      },
    });
    registered.push(tool.name);
  }
  return { registered };
}

export default async function torchPiExtension(pi) {
  const { Type } = await import('typebox');
  createTorchPiExtension(pi, { Type });
}
