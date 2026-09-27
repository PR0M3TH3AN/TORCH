import { accessSync, constants, existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { TorchError } from '../kernel/errors.mjs';
import { unsupportedCapability, validateRuntimeAdapter } from './runtime.mjs';

function findExecutable(name, env = process.env) {
  for (const directory of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const candidate = join(directory, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch { /* keep searching */ }
  }
  return null;
}

function text(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TorchError(`${name} must be a non-empty string`, {
      code: 'INVALID_RUNTIME_INPUT', details: { field: name },
    });
  }
  return value.trim();
}

function optionalModelArgs(model) {
  return typeof model === 'string' && model.trim() ? ['--model', model.trim()] : [];
}

function commandRecord(command, args, cwd) {
  return { command, args, cwd, mutatesRuntime: true };
}

function mcpArgs(mcp) {
  if (!mcp) return [];
  if (typeof mcp.name !== 'string' || !/^[a-z0-9_-]+$/.test(mcp.name)
    || typeof mcp.command !== 'string' || !Array.isArray(mcp.args)) {
    throw new TorchError('Codex MCP launch configuration is invalid', { code: 'INVALID_RUNTIME_INPUT' });
  }
  return [
    '-c', `mcp_servers.${mcp.name}.command=${JSON.stringify(mcp.command)}`,
    '-c', `mcp_servers.${mcp.name}.args=${JSON.stringify(mcp.args)}`,
  ];
}

function mcpName(areaId) {
  return `torch-${areaId.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '')}`;
}

function parseJsonLines(output) {
  const records = [];
  for (const line of String(output ?? '').split('\n').map((value) => value.trim()).filter(Boolean)) {
    try { records.push(JSON.parse(line)); } catch { /* non-JSON diagnostics are not events */ }
  }
  return records;
}

export class CodexRuntimeAdapter {
  constructor({
    env = process.env,
    runner = null,
    executable = 'codex',
    nodeExecutable = process.execPath,
  } = {}) {
    this.name = 'codex';
    this.env = env;
    this.runner = runner;
    this.executable = executable;
    this.nodeExecutable = nodeExecutable;
    this.capabilities = Object.freeze({
      detect: true,
      configure: 'plan-only',
      createSession: true,
      resumeSession: true,
      sendOrSteer: 'native-with-durable-fallback',
      getStatus: false,
      listSessions: false,
      stopSession: false,
      captureRuntimeId: true,
      installHooks: false,
      removeHooks: false,
      liveSteering: true,
      durableMessaging: true,
      processModel: 'resumable-turn',
    });
    validateRuntimeAdapter(this);
  }

  detect() {
    const path = this.executable.includes('/') && existsSync(this.executable)
      ? this.executable : findExecutable(this.executable, this.env);
    return { available: Boolean(path), executable: path, adapter: this.name };
  }

  configure({ repositoryRoot, areaId, mcpEntry } = {}) {
    const root = text(repositoryRoot, 'repositoryRoot');
    const id = text(areaId, 'areaId');
    const entry = text(mcpEntry, 'mcpEntry');
    return {
      adapter: this.name,
      mutationPerformed: false,
      mcp: {
        name: mcpName(id),
        command: this.nodeExecutable,
        args: [entry, '--root', root, '--area', id],
        cwd: root,
      },
      note: 'Pass this identity-bound MCP server as an invocation-scoped Codex configuration.',
    };
  }

  createSession({ areaId, worktree, promptFile, firstMessage, model, mcp } = {}) {
    const id = text(areaId, 'areaId');
    const cwd = text(worktree, 'worktree');
    const args = [
      'exec', '--json', '--cd', cwd, '--sandbox', 'workspace-write', '--approve-for-me',
      ...mcpArgs(mcp),
      ...optionalModelArgs(model),
      `${text(firstMessage, 'firstMessage')}\n\nRead and follow the TORCH domain prompt at ${text(promptFile, 'promptFile')}.`,
    ];
    return {
      adapter: this.name,
      areaId: id,
      runtimeSessionId: null,
      requiresRuntimeIdCapture: true,
      completionState: 'idle',
      launch: commandRecord(this.executable, args, cwd),
    };
  }

  resumeSession({ areaId, runtimeSessionId, worktree, message, model, mcp } = {}) {
    const id = text(areaId, 'areaId');
    const sessionId = text(runtimeSessionId, 'runtimeSessionId');
    const cwd = text(worktree, 'worktree');
    const args = [
      'exec', '--json', '--cd', cwd, '--sandbox', 'workspace-write', '--approve-for-me',
      ...mcpArgs(mcp),
      ...optionalModelArgs(model), 'resume', sessionId, text(message, 'message'),
    ];
    return {
      adapter: this.name,
      areaId: id,
      runtimeSessionId: sessionId,
      requiresRuntimeIdCapture: false,
      completionState: 'idle',
      launch: commandRecord(this.executable, args, cwd),
    };
  }

  sendOrSteer({ controlPlane, sender = 'session-manager', recipient, body, references, runtimeSessionId } = {}) {
    if (!controlPlane) {
      throw new TorchError('Codex messaging requires the TORCH durable control plane', {
        code: 'CONTROL_PLANE_REQUIRED',
      });
    }
    const message = controlPlane.sendMessage({ sender, recipient, body, references });
    if (this.runner && runtimeSessionId) {
      try {
        const result = this.runner(this.executable, [
          'queue', '--thread', text(runtimeSessionId, 'runtimeSessionId'), '--message', text(body, 'body'),
        ]);
        if (result?.status === undefined || result.status === 0) {
          return { delivery: 'native+durable', liveSteeringAttempted: true, runtimeSessionId, message };
        }
      } catch { /* the durable message remains available for polling */ }
    }
    return { delivery: 'durable', liveSteeringAttempted: Boolean(this.runner && runtimeSessionId), message };
  }

  captureRuntimeId({ areaId, stdout, output, runtimeSessionId } = {}) {
    if (runtimeSessionId) {
      return { areaId: text(areaId, 'areaId'), runtimeSessionId: text(runtimeSessionId, 'runtimeSessionId') };
    }
    const event = parseJsonLines(stdout ?? output).find((candidate) =>
      candidate?.type === 'thread.started' && (candidate.thread_id || candidate.threadId));
    const captured = event?.thread_id ?? event?.threadId;
    if (!captured) {
      throw new TorchError('Codex launch output did not contain a thread.started event', {
        code: 'RUNTIME_ID_NOT_CAPTURED', details: { adapter: this.name },
      });
    }
    return { areaId: text(areaId, 'areaId'), runtimeSessionId: text(captured, 'runtimeSessionId') };
  }

  getStatus() { return unsupportedCapability(this.name, 'getStatus'); }

  listSessions() { return unsupportedCapability(this.name, 'listSessions'); }

  stopSession() { return unsupportedCapability(this.name, 'stopSession'); }

  installHooks() { return unsupportedCapability(this.name, 'installHooks'); }

  removeHooks() { return unsupportedCapability(this.name, 'removeHooks'); }
}

export function createCodexAdapter(options) {
  return new CodexRuntimeAdapter(options);
}
