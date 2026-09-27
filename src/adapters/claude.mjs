import { randomUUID } from 'node:crypto';
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

function commandRecord(command, args, cwd) {
  return { command, args, cwd, mutatesRuntime: true };
}

function mcpName(areaId) {
  return `torch-${areaId.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '')}`;
}

export class ClaudeRuntimeAdapter {
  constructor({
    env = process.env,
    runner = null,
    executable = 'claude',
    nodeExecutable = process.execPath,
    idFactory = randomUUID,
  } = {}) {
    this.name = 'claude';
    this.env = env;
    this.runner = runner;
    this.executable = executable;
    this.nodeExecutable = nodeExecutable;
    this.idFactory = idFactory;
    this.capabilities = Object.freeze({
      detect: true,
      configure: 'plan-only',
      createSession: true,
      resumeSession: true,
      sendOrSteer: 'durable-fallback',
      getStatus: true,
      listSessions: true,
      stopSession: true,
      captureRuntimeId: true,
      installHooks: false,
      removeHooks: false,
      liveSteering: false,
      durableMessaging: true,
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
    const entry = text(mcpEntry, 'mcpEntry');
    const id = text(areaId, 'areaId');
    return {
      adapter: this.name,
      mutationPerformed: false,
      mcp: {
        name: mcpName(id), command: this.nodeExecutable,
        args: [entry, '--root', root, '--area', id], cwd: root,
      },
      note: 'Apply this MCP registration through the owner-approved Claude configuration surface.',
    };
  }

  createSession({ areaId, title, worktree, promptFile, firstMessage, model = 'opus', background = true } = {}) {
    const runtimeSessionId = this.idFactory();
    const args = [];
    if (background) args.push('--bg');
    args.push(
      '--model', text(model, 'model'),
      '--session-id', runtimeSessionId,
      '-n', `TORCH · ${text(title ?? areaId, 'title')}`,
      '--append-system-prompt-file', text(promptFile, 'promptFile'),
    );
    if (firstMessage) args.push(text(firstMessage, 'firstMessage'));
    return {
      adapter: this.name, areaId: text(areaId, 'areaId'), runtimeSessionId,
      launch: commandRecord(this.executable, args, text(worktree, 'worktree')),
    };
  }

  resumeSession({ areaId, runtimeSessionId, worktree, model = 'opus', message, background = true } = {}) {
    const args = [];
    if (background) args.push('--bg');
    args.push('--model', text(model, 'model'), '--resume', text(runtimeSessionId, 'runtimeSessionId'));
    if (message) args.push(text(message, 'message'));
    return {
      adapter: this.name, areaId: text(areaId, 'areaId'), runtimeSessionId,
      launch: commandRecord(this.executable, args, text(worktree, 'worktree')),
    };
  }

  sendOrSteer({ controlPlane, sender = 'session-manager', recipient, body, references } = {}) {
    if (!controlPlane) {
      throw new TorchError('Claude durable messaging requires the TORCH control plane', {
        code: 'CONTROL_PLANE_REQUIRED',
      });
    }
    const message = controlPlane.sendMessage({ sender, recipient, body, references });
    return { delivery: 'durable', liveSteeringAttempted: false, message };
  }

  run(args) {
    if (!this.runner) {
      throw new TorchError('Runtime execution was not authorized for this adapter instance', {
        code: 'RUNTIME_EXECUTION_NOT_AUTHORIZED',
      });
    }
    return this.runner(this.executable, args);
  }

  listSessions() {
    const result = this.run(['agents', '--json']);
    try {
      return JSON.parse(result.stdout ?? result);
    } catch (error) {
      throw new TorchError('Claude session listing returned invalid JSON', {
        code: 'RUNTIME_RESPONSE_INVALID', details: error.message,
      });
    }
  }

  getStatus({ runtimeSessionId } = {}) {
    const id = text(runtimeSessionId, 'runtimeSessionId');
    const session = this.listSessions().find((candidate) =>
      candidate.sessionId === id || candidate.id === id);
    return session ?? { sessionId: id, status: 'offline' };
  }

  stopSession({ runtimeSessionId } = {}) {
    const id = text(runtimeSessionId, 'runtimeSessionId');
    const result = this.run(['stop', id]);
    return { runtimeSessionId: id, stopped: result.status === undefined || result.status === 0 };
  }

  captureRuntimeId({ areaId, runtimeSessionId } = {}) {
    return { areaId: text(areaId, 'areaId'), runtimeSessionId: text(runtimeSessionId, 'runtimeSessionId') };
  }

  installHooks() {
    return unsupportedCapability(this.name, 'installHooks');
  }

  removeHooks() {
    return unsupportedCapability(this.name, 'removeHooks');
  }
}

export function createClaudeAdapter(options) {
  return new ClaudeRuntimeAdapter(options);
}
