import { accessSync, constants, existsSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { TorchError } from '../kernel/errors.mjs';
import { unsupportedCapability, validateRuntimeAdapter } from './runtime.mjs';

const PI_THINKING_LEVELS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']);
const PI_EXTENSION = fileURLToPath(new URL('./pi/extension.mjs', import.meta.url));

function text(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TorchError(`${name} must be a non-empty string`, {
      code: 'INVALID_RUNTIME_INPUT', details: { field: name },
    });
  }
  return value.trim();
}

function findExecutable(name, env = process.env) {
  if (name.includes('/') && existsSync(name)) {
    try { accessSync(name, constants.X_OK); return name; } catch { return null; }
  }
  for (const directory of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const candidate = join(directory, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch { /* keep searching */ }
  }
  return null;
}

function thinkingArgs(reasoning) {
  if (reasoning === undefined || reasoning === null || reasoning === '') return [];
  const value = text(reasoning, 'reasoning');
  if (!PI_THINKING_LEVELS.has(value)) {
    throw new TorchError(`Unsupported Pi thinking level: ${value}`, {
      code: 'RUNTIME_PROFILE_INVALID', details: { adapter: 'pi', field: 'reasoning', value },
    });
  }
  return ['--thinking', value];
}

function bridgeArgs(integration) {
  if (integration?.type !== 'pi-mcp-extension') {
    throw new TorchError('Pi requires the TORCH identity-bound MCP extension integration', {
      code: 'RUNTIME_CONFIGURATION_INVALID', details: { adapter: 'pi' },
    });
  }
  return [
    '--no-extensions', '--no-context-files', '--no-approve',
    '--extension', text(integration.extensionPath, 'extensionPath'),
    '--torch-root', text(integration.repositoryRoot, 'repositoryRoot'),
    '--torch-area', text(integration.areaId, 'areaId'),
    '--torch-mcp-entry', text(integration.mcpEntry, 'mcpEntry'),
    '--torch-node', text(integration.nodeExecutable, 'nodeExecutable'),
    '--session-dir', text(integration.sessionDir, 'sessionDir'),
  ];
}

function launchPolicyArgs(policy = {}) {
  if (Object.keys(policy ?? {}).length) {
    throw new TorchError('Pi launch policy overrides are unsupported; safe approval and extension flags are fixed by TORCH', {
      code: 'RUNTIME_PROFILE_INVALID', details: { adapter: 'pi', launchPolicy: policy },
    });
  }
  return [];
}

function commandRecord(command, args, cwd) {
  return { command, args, cwd, mutatesRuntime: true };
}

export class PiRuntimeAdapter {
  constructor({
    env = process.env,
    executable = 'pi',
    nodeExecutable = process.execPath,
    extensionPath = PI_EXTENSION,
    idFactory = randomUUID,
  } = {}) {
    this.name = 'pi';
    this.env = env;
    this.executable = executable;
    this.nodeExecutable = nodeExecutable;
    this.extensionPath = resolve(extensionPath);
    this.idFactory = idFactory;
    this.configuration = Object.freeze({ model: null, reasoning: null, mode: 'json' });
    this.capabilities = Object.freeze({
      detect: true,
      configure: 'plan-only',
      modelSelection: true,
      modelRequired: true,
      reasoningSelection: true,
      perInvocationCostCeiling: Object.freeze({ createSession: Object.freeze([]), resumeSession: Object.freeze([]) }),
      launchPolicy: Object.freeze({ fields: Object.freeze({}) }),
      createSession: true,
      resumeSession: true,
      sendOrSteer: 'durable-fallback',
      getStatus: false,
      listSessions: false,
      stopSession: false,
      captureRuntimeId: true,
      installHooks: false,
      removeHooks: false,
      liveSteering: false,
      durableMessaging: true,
      processModel: 'resumable-turn',
    });
    validateRuntimeAdapter(this);
  }

  detect() {
    const path = findExecutable(this.executable, this.env);
    return { available: Boolean(path), executable: path, adapter: this.name };
  }

  configure({ repositoryRoot, areaId, mcpEntry, stateRoot } = {}) {
    const root = resolve(text(repositoryRoot, 'repositoryRoot'));
    const id = text(areaId, 'areaId');
    const entry = resolve(text(mcpEntry, 'mcpEntry'));
    const state = resolve(text(stateRoot, 'stateRoot'));
    return {
      adapter: this.name,
      mutationPerformed: false,
      integration: {
        type: 'pi-mcp-extension',
        extensionPath: this.extensionPath,
        repositoryRoot: root,
        areaId: id,
        mcpEntry: entry,
        nodeExecutable: this.nodeExecutable,
        sessionDir: join(state, 'sessions', 'pi', id),
      },
      note: 'The bundled TORCH Pi extension exposes the same identity-bound MCP tools; its MCP process runs only for a tool call.',
    };
  }

  createSession({ areaId, title, worktree, promptFile, firstMessage, model, reasoning, launchPolicy, integration } = {}) {
    const id = text(areaId, 'areaId');
    const cwd = text(worktree, 'worktree');
    const sessionId = text(this.idFactory(), 'runtimeSessionId');
    const args = [
      '--mode', 'json', '--print',
      ...launchPolicyArgs(launchPolicy),
      ...bridgeArgs(integration),
      '--session-id', sessionId,
      '--model', text(model, 'model'),
      ...thinkingArgs(reasoning),
      '-n', `TORCH · ${text(title ?? areaId, 'title')}`,
      '--append-system-prompt', text(promptFile, 'promptFile'),
      text(firstMessage, 'firstMessage'),
    ];
    return {
      adapter: this.name, areaId: id, runtimeSessionId: sessionId,
      requiresRuntimeIdCapture: false, completionState: 'idle',
      launch: commandRecord(this.executable, args, cwd),
    };
  }

  resumeSession({ areaId, runtimeSessionId, worktree, message, promptFile, model, reasoning, launchPolicy, integration } = {}) {
    const id = text(areaId, 'areaId');
    const sessionId = text(runtimeSessionId, 'runtimeSessionId');
    const args = [
      '--mode', 'json', '--print',
      ...launchPolicyArgs(launchPolicy),
      ...bridgeArgs(integration),
      '--append-system-prompt', text(promptFile, 'promptFile'),
      '--session-id', sessionId,
      '--model', text(model, 'model'),
      ...thinkingArgs(reasoning),
      ...(message ? [text(message, 'message')] : []),
    ];
    return {
      adapter: this.name, areaId: id, runtimeSessionId: sessionId,
      requiresRuntimeIdCapture: false, completionState: 'idle',
      launch: commandRecord(this.executable, args, text(worktree, 'worktree')),
    };
  }

  sendOrSteer({ controlPlane, sender = 'session-manager', recipient, body, references } = {}) {
    if (!controlPlane) {
      throw new TorchError('Pi durable messaging requires the TORCH control plane', {
        code: 'CONTROL_PLANE_REQUIRED',
      });
    }
    const message = controlPlane.sendMessage({ sender, recipient, body, references });
    return { delivery: 'durable', liveSteeringAttempted: false, message };
  }

  captureRuntimeId({ areaId, runtimeSessionId } = {}) {
    return {
      areaId: text(areaId, 'areaId'),
      runtimeSessionId: text(runtimeSessionId, 'runtimeSessionId'),
    };
  }

  getStatus() { return unsupportedCapability(this.name, 'getStatus'); }

  listSessions() { return unsupportedCapability(this.name, 'listSessions'); }

  stopSession() { return unsupportedCapability(this.name, 'stopSession'); }

  installHooks() { return unsupportedCapability(this.name, 'installHooks'); }

  removeHooks() { return unsupportedCapability(this.name, 'removeHooks'); }
}

export function createPiAdapter(options) {
  return new PiRuntimeAdapter(options);
}
