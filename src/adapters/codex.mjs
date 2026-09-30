import { accessSync, constants, existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { TorchError } from '../kernel/errors.mjs';
import { profileCapabilityIssues, unsupportedCapability, validateRuntimeAdapter } from './runtime.mjs';

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

function launchPolicyArgs(policy = {}) {
  const issues = profileCapabilityIssues({ name: 'codex', capabilities: {
    launchPolicy: {
      fields: {
        sandbox: ['read-only', 'workspace-write', 'danger-full-access'],
        approval: ['approve-for-me', 'on-request', 'never'],
      },
      conflicts: [{ field: 'approval', value: 'approve-for-me', with: 'sandbox' }],
    },
  } }, { launchPolicy: policy });
  if (issues.length) {
    throw new TorchError('Codex launch policy is invalid or unsupported', {
      code: 'RUNTIME_PROFILE_INVALID', details: { adapter: 'codex', issues },
    });
  }
  const args = [];
  if (policy.sandbox !== undefined) args.push('--sandbox', policy.sandbox);
  if (policy.approval === 'approve-for-me') args.push('--approve-for-me');
  else if (policy.approval !== undefined) args.push('--ask-for-approval', policy.approval);
  return args;
}

const MAX_STARTUP_OUTPUT_BYTES = 16 * 1024;
const MAX_STARTUP_EVENT_COUNT = 64;
const MAX_DIAGNOSTIC_TEXT_LENGTH = 512;

function parseJsonLines(output) {
  const records = [];
  for (const line of String(output ?? '').split('\n').map((value) => value.trim()).filter(Boolean)) {
    try { records.push(JSON.parse(line)); } catch { /* non-JSON diagnostics are not events */ }
  }
  return records;
}

function redactDiagnosticText(value, limit = MAX_DIAGNOSTIC_TEXT_LENGTH) {
  if (typeof value !== 'string') return null;
  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact) return null;
  return compact
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/((?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|token|password|secret|credential|authorization|cookie)\s*(?:=|:|\s)\s*)([^\s,;]+)/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .slice(0, limit);
}

function boundedStartupOutput(output) {
  const text = typeof output === 'string' ? output : String(output ?? '');
  if (Buffer.byteLength(text, 'utf8') > MAX_STARTUP_OUTPUT_BYTES) {
    return { records: null, reason: 'stdout-exceeds-bound' };
  }
  const lines = text.split('\n').map((value) => value.trim()).filter(Boolean);
  if (lines.length > MAX_STARTUP_EVENT_COUNT) return { records: null, reason: 'stdout-too-many-events' };
  const records = [];
  for (const line of lines) {
    try { records.push(JSON.parse(line)); } catch { return { records: null, reason: 'stdout-malformed-json' }; }
  }
  return { records, reason: null };
}

function startupFailureEvent(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  if (record.type === 'error' || record.type === 'turn.failed' || record.type === 'turn.error') {
    const error = record.error && typeof record.error === 'object' && !Array.isArray(record.error)
      ? record.error : record;
    return { code: error.code ?? record.code, message: error.message ?? record.message };
  }
  return null;
}

function safeDiagnosticCode(value) {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_.-]{0,79}$/.test(value) ? value : null;
}

export function diagnoseCodexStartupFailure({ stdout, stderr } = {}) {
  const parsed = boundedStartupOutput(stdout);
  const safeStderr = redactDiagnosticText(stderr);
  if (!parsed.records) {
    return {
      schema: 'torch.dev/runtime-startup-diagnostic/v1alpha1', outcome: 'unknown', reason: parsed.reason,
      stderr: safeStderr,
    };
  }
  const failure = parsed.records.map(startupFailureEvent).find(Boolean);
  if (!failure) {
    return {
      schema: 'torch.dev/runtime-startup-diagnostic/v1alpha1', outcome: 'unknown', reason: 'stdout-no-failure-event',
      stderr: safeStderr,
    };
  }
  const message = redactDiagnosticText(failure.message);
  const code = safeDiagnosticCode(failure.code);
  const modelRejection = /\b(model|unsupported|not supported|unavailable|not available|does not exist)\b/i.test(message ?? '')
    || /MODEL|UNSUPPORTED/i.test(code ?? '');
  return {
    schema: 'torch.dev/runtime-startup-diagnostic/v1alpha1', outcome: 'known',
    category: modelRejection ? 'model-rejection' : 'runtime-error',
    ...(code ? { code } : {}),
    ...(message ? { message } : {}),
    stderr: safeStderr,
  };
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
    this.configuration = Object.freeze({
      model: 'gpt-6-luna', reasoning: 'high',
      launchPolicy: Object.freeze({ approval: 'approve-for-me' }),
    });
    this.capabilities = Object.freeze({
      detect: true,
      configure: 'plan-only',
      modelSelection: true,
      reasoningSelection: true,
      perInvocationCostCeiling: Object.freeze({ createSession: Object.freeze([]), resumeSession: Object.freeze([]) }),
      launchPolicy: Object.freeze({
        fields: Object.freeze({
          sandbox: Object.freeze(['read-only', 'workspace-write', 'danger-full-access']),
          approval: Object.freeze(['approve-for-me', 'on-request', 'never']),
        }),
        conflicts: Object.freeze([
          Object.freeze({ field: 'approval', value: 'approve-for-me', with: 'sandbox' }),
        ]),
      }),
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

  createSession({ areaId, worktree, promptFile, firstMessage, model, reasoning, launchPolicy, mcp } = {}) {
    const id = text(areaId, 'areaId');
    const cwd = text(worktree, 'worktree');
    const args = [
      '--cd', cwd, ...launchPolicyArgs(launchPolicy ?? this.configuration.launchPolicy),
      ...mcpArgs(mcp),
      ...((reasoning ?? this.configuration.reasoning) ? ['-c', `model_reasoning_effort=${JSON.stringify(text(reasoning ?? this.configuration.reasoning, 'reasoning'))}`] : []),
      'exec', '--json',
      ...optionalModelArgs(model ?? this.configuration.model),
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

  resumeSession({ areaId, runtimeSessionId, worktree, message, instructionText, instructionDigest, model, reasoning, launchPolicy, mcp } = {}) {
    const id = text(areaId, 'areaId');
    const sessionId = text(runtimeSessionId, 'runtimeSessionId');
    const cwd = text(worktree, 'worktree');
    const currentInstructions = instructionText
      ? `\n\nAUTHORITATIVE CURRENT TORCH INSTRUCTIONS (sha256 ${text(instructionDigest, 'instructionDigest')}; replace stale briefing or conversation memory):\n${text(instructionText, 'instructionText')}`
      : '';
    const args = [
      '--cd', cwd, ...launchPolicyArgs(launchPolicy ?? this.configuration.launchPolicy),
      ...mcpArgs(mcp),
      ...((reasoning ?? this.configuration.reasoning) ? ['-c', `model_reasoning_effort=${JSON.stringify(text(reasoning ?? this.configuration.reasoning, 'reasoning'))}`] : []),
      'exec', 'resume', '--json',
      ...optionalModelArgs(model ?? this.configuration.model), sessionId, `${text(message, 'message')}${currentInstructions}`,
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

  diagnoseStartupFailure({ stdout, stderr } = {}) {
    return diagnoseCodexStartupFailure({ stdout, stderr });
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
