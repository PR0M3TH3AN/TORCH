import { randomUUID } from 'node:crypto';
import { accessSync, constants, existsSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
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

const CLAUDE_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const CLAUDE_PERMISSION_MODES = new Set(['default', 'acceptEdits', 'auto', 'manual', 'dontAsk', 'plan']);

function effortArgs(reasoning) {
  if (reasoning === undefined || reasoning === null || reasoning === '') return [];
  const effort = text(reasoning, 'reasoning');
  if (!CLAUDE_EFFORTS.has(effort)) {
    throw new TorchError(`Unsupported Claude effort level: ${effort}`, {
      code: 'RUNTIME_PROFILE_INVALID', details: { adapter: 'claude', field: 'reasoning', value: effort },
    });
  }
  return ['--effort', effort];
}

function launchPolicyArgs(policy = {}) {
  const entries = Object.entries(policy ?? {});
  if (entries.some(([field, value]) => field !== 'permissionMode'
    || typeof value !== 'string' || !CLAUDE_PERMISSION_MODES.has(value))) {
    throw new TorchError('Claude launch policy is invalid or unsupported', {
      code: 'RUNTIME_PROFILE_INVALID', details: { adapter: 'claude', launchPolicy: policy },
    });
  }
  return policy.permissionMode === undefined ? [] : ['--permission-mode', policy.permissionMode];
}

function commandRecord(command, args, cwd) {
  return { command, args, cwd, mutatesRuntime: true };
}

function mcpArgs(mcp) {
  if (!mcp) return [];
  if (typeof mcp.name !== 'string' || typeof mcp.command !== 'string' || !Array.isArray(mcp.args)) {
    throw new TorchError('Claude MCP launch configuration is invalid', { code: 'INVALID_RUNTIME_INPUT' });
  }
  return ['--mcp-config', JSON.stringify({
    mcpServers: { [mcp.name]: { command: mcp.command, args: mcp.args } },
  })];
}

function mcpName(areaId) {
  return `torch-${areaId.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '')}`;
}

function backgroundSessionId(output) {
  const lines = String(output ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length !== 1 || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(lines[0])) {
    throw new TorchError('Claude background launch did not return exactly one safe session ID', {
      code: 'RUNTIME_ID_NOT_CAPTURED', details: { adapter: 'claude' },
    });
  }
  return lines[0];
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
    this.configuration = Object.freeze({ model: 'sonnet', background: true });
    this.capabilities = Object.freeze({
      detect: true,
      configure: 'plan-only',
      modelSelection: true,
      reasoningSelection: true,
      perInvocationCostCeiling: Object.freeze({ createSession: Object.freeze([]), resumeSession: Object.freeze([]) }),
      launchPolicy: Object.freeze({ fields: Object.freeze({
        permissionMode: Object.freeze([...CLAUDE_PERMISSION_MODES]),
      }) }),
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

  createSession({ areaId, title, worktree, promptFile, firstMessage, model = 'sonnet', reasoning, launchPolicy, background = true, mcp } = {}) {
    const runtimeSessionId = background ? null : this.idFactory();
    const args = [];
    if (background) args.push('--bg');
    args.push(
      '--model', text(model, 'model'),
      ...launchPolicyArgs(launchPolicy),
      ...effortArgs(reasoning),
      ...(!background ? ['--session-id', runtimeSessionId] : []),
      '-n', `TORCH · ${text(title ?? areaId, 'title')}`,
      '--append-system-prompt-file', text(promptFile, 'promptFile'),
      ...mcpArgs(mcp),
    );
    if (firstMessage) args.push(text(firstMessage, 'firstMessage'));
    return {
      adapter: this.name, areaId: text(areaId, 'areaId'), runtimeSessionId,
      requiresRuntimeIdCapture: background,
      launch: commandRecord(this.executable, args, text(worktree, 'worktree')),
    };
  }

  resumeSession({ areaId, runtimeSessionId, worktree, promptFile, model = 'sonnet', reasoning, launchPolicy, message, background = true, mcp } = {}) {
    const args = [];
    if (background) args.push('--bg');
    args.push(
      '--model', text(model, 'model'), ...launchPolicyArgs(launchPolicy), ...effortArgs(reasoning),
      '--append-system-prompt-file', text(promptFile, 'promptFile'), ...mcpArgs(mcp),
      '--resume', text(runtimeSessionId, 'runtimeSessionId'),
    );
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

  stopSession({ runtimeSessionId, worktree } = {}) {
    const id = text(runtimeSessionId, 'runtimeSessionId');
    const expectedWorktree = resolve(text(worktree, 'worktree'));
    const session = this.getStatus({ runtimeSessionId: id });
    if (session.status === 'offline') {
      return { runtimeSessionId: id, stopped: true, alreadyOffline: true };
    }
    const reportedWorktree = session.cwd ?? session.worktree
      ?? session.workingDirectory ?? session.working_directory;
    if (typeof reportedWorktree !== 'string' || !reportedWorktree.trim()) {
      throw new TorchError('Claude session stop refused because its working directory is unavailable', {
        code: 'RUNTIME_OWNERSHIP_UNVERIFIED', details: { runtimeSessionId: id, expectedWorktree },
      });
    }
    if (resolve(reportedWorktree) !== expectedWorktree) {
      throw new TorchError('Claude session stop refused because its working directory does not match the managed identity', {
        code: 'RUNTIME_OWNERSHIP_MISMATCH',
        details: { runtimeSessionId: id, expectedWorktree, reportedWorktree: resolve(reportedWorktree) },
      });
    }
    const result = this.run(['stop', id]);
    return {
      runtimeSessionId: id, stopped: result.status === undefined || result.status === 0,
      verifiedWorktree: expectedWorktree, alreadyOffline: false,
    };
  }

  captureRuntimeId({ areaId, runtimeSessionId, stdout, output } = {}) {
    const captured = runtimeSessionId ?? backgroundSessionId(stdout ?? output);
    return { areaId: text(areaId, 'areaId'), runtimeSessionId: text(captured, 'runtimeSessionId') };
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
