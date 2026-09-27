import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TorchError } from '../kernel/errors.mjs';
import { readInstallManifest } from '../kernel/install.mjs';
import { loadFleetDefinition } from '../kernel/worktrees.mjs';
import { validateRuntimeAdapter } from '../adapters/runtime.mjs';

const MCP_ENTRY = fileURLToPath(new URL('../mcp/server.mjs', import.meta.url));

function localStateRoot(manifest) {
  const record = (manifest.external ?? []).find((entry) => entry.type === 'local-state');
  if (!record?.path) throw new TorchError('Installation manifest has no local state root', { code: 'LOCAL_STATE_MISSING' });
  return record.path;
}

function worktreesByArea(manifest) {
  return new Map((manifest.external ?? [])
    .filter((entry) => entry.type === 'worktree')
    .map((entry) => [entry.area, entry]));
}

function orderedAreas(roster) {
  return [...roster.areas.filter((area) => area.id !== 'session-manager'),
    ...roster.areas.filter((area) => area.id === 'session-manager')];
}

function selectedAreas(roster, only, blockers) {
  const ordered = orderedAreas(roster);
  if (only === undefined) return ordered;
  const selected = Array.isArray(only)
    ? [...new Set(only.map((id) => typeof id === 'string' ? id.trim() : '').filter(Boolean))]
    : [];
  if (!selected.length) {
    blockers.push({ code: 'FLEET_SELECTION_EMPTY' });
    return [];
  }
  const known = new Set(ordered.map((area) => area.id));
  for (const areaId of selected.filter((id) => !known.has(id))) {
    blockers.push({ areaId, code: 'FLEET_IDENTITY_MISSING' });
  }
  const wanted = new Set(selected);
  return ordered.filter((area) => wanted.has(area.id));
}

function adapterMap({ adapter, adapters } = {}) {
  if (adapters instanceof Map) return adapters;
  if (adapters && typeof adapters === 'object') return new Map(Object.entries(adapters));
  if (adapter) return new Map([[adapter.name, adapter]]);
  return new Map();
}

function configuredRuntime(area, config) {
  if (area.id === 'session-manager') {
    return area.runtime ?? config.session_manager?.runtime ?? config.runtimes?.default;
  }
  return area.runtime ?? config.domains?.find((domain) => domain.id === area.id)?.runtime
    ?? config.runtimes?.default;
}

function promptPaths(stateRoot, worktree, areaId) {
  return {
    common: join(worktree.path, '.torch', 'prompts', 'COMMON.md'),
    area: join(worktree.path, '.torch', 'prompts', `${areaId}.md`),
    combined: join(stateRoot, 'sessions', 'prompts', `${areaId}.md`),
  };
}

function startupMessage(areaId, fresh) {
  if (areaId === 'session-manager') {
    return fresh
      ? 'Start the TORCH Fleet. Inspect live roster, messages, worktrees, and backlog before dispatch.'
      : 'Resume the TORCH Fleet from durable state. Reconcile live status before dispatch.';
  }
  return fresh
    ? 'Start this TORCH domain. Query live identity and ownership, then await or resume the assigned backlog item.'
    : 'Resume this TORCH domain from durable state. Read the inbox, confirm ownership, and report current evidence.';
}

function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, path);
}

function projectMetadata(stateRoot) {
  const path = join(stateRoot, 'project.json');
  if (!existsSync(path)) throw new TorchError('TORCH local project metadata is missing', { code: 'LOCAL_STATE_MISSING' });
  try { return { path, value: JSON.parse(readFileSync(path, 'utf8')) }; } catch (error) {
    throw new TorchError('TORCH local project metadata is invalid', { code: 'LOCAL_STATE_INVALID', details: error.message });
  }
}

function captureSnapshot({ plan, controlPlane, now = () => new Date() }) {
  const snapshotPath = join(plan.stateRoot, 'sessions', 'resume.json');
  atomicJson(snapshotPath, {
    schema: 'torch.dev/runtime-snapshot/v1alpha1', projectId: plan.projectId,
    capturedAt: now().toISOString(), agents: controlPlane.listAgents(),
    worktrees: plan.actions.map((action) => action.worktree).filter(Boolean),
  });
  return snapshotPath;
}

function inspectWorktree(worktree) {
  const git = (args) => execFileSync('git', ['-C', worktree.path, ...args], { encoding: 'utf8' }).trim();
  return {
    areaId: worktree.area,
    path: worktree.path,
    branch: git(['branch', '--show-current']),
    commit: git(['rev-parse', 'HEAD']),
    dirtyEntries: git(['status', '--porcelain']).split('\n').filter(Boolean),
  };
}

export function planFleetUp({ repositoryRoot, controlPlane, adapter, adapters, fresh = false, only } = {}) {
  const { config, roster } = loadFleetDefinition(repositoryRoot);
  const manifest = readInstallManifest(repositoryRoot);
  const worktrees = worktreesByArea(manifest);
  const stateRoot = localStateRoot(manifest);
  const runtimes = adapterMap({ adapter, adapters });
  const blockers = [];
  const actions = [];

  for (const area of selectedAreas(roster, only, blockers)) {
    const worktree = worktrees.get(area.id);
    if (!worktree) {
      blockers.push({ areaId: area.id, code: 'WORKTREE_MISSING' });
      continue;
    }
    const runtime = configuredRuntime(area, config);
    const runtimeAdapter = runtimes.get(runtime);
    if (!runtimeAdapter) {
      blockers.push({ areaId: area.id, code: 'RUNTIME_ADAPTER_MISSING', runtime });
      continue;
    }
    if (runtimeAdapter.name !== runtime) {
      blockers.push({
        areaId: area.id, code: 'RUNTIME_ADAPTER_MISMATCH', runtime, adapter: runtimeAdapter.name,
      });
      continue;
    }
    validateRuntimeAdapter(runtimeAdapter);
    const identity = controlPlane.identity(area.id);
    const runtimeIntegration = runtimeAdapter.configure({
      repositoryRoot, areaId: area.id, mcpEntry: MCP_ENTRY,
    });
    if (runtimeIntegration?.mutationPerformed !== false || !runtimeIntegration?.mcp) {
      blockers.push({
        areaId: area.id, code: 'RUNTIME_CONFIGURATION_INVALID', runtime,
      });
      continue;
    }
    const prompts = promptPaths(stateRoot, worktree, area.id);
    const runtimeConfig = config.runtimes?.[runtime] ?? {};
    const model = area.model ?? runtimeConfig.model;
    const background = runtimeConfig.background ?? true;
    const shouldResume = !fresh && identity.runtime === runtime && Boolean(identity.runtimeSessionId);
    const runtimePlan = shouldResume
      ? runtimeAdapter.resumeSession({
        areaId: area.id, runtimeSessionId: identity.runtimeSessionId, worktree: worktree.path,
        model, background, message: startupMessage(area.id, false), mcp: runtimeIntegration.mcp,
      })
      : runtimeAdapter.createSession({
        areaId: area.id, title: area.title, worktree: worktree.path, promptFile: prompts.combined,
        firstMessage: startupMessage(area.id, true), model, background, mcp: runtimeIntegration.mcp,
      });
    actions.push({
      areaId: area.id, title: area.title, mode: shouldResume ? 'resume' : 'create',
      runtime: runtimeAdapter.name, runtimeSessionId: runtimePlan.runtimeSessionId,
      requiresRuntimeIdCapture: runtimePlan.requiresRuntimeIdCapture ?? false,
      completionState: runtimePlan.completionState ?? 'starting',
      worktree: worktree.path, branch: worktree.branch, promptFile: prompts.combined,
      promptSources: [prompts.common, prompts.area], mcp: runtimeIntegration.mcp,
      launch: runtimePlan.launch,
    });
  }

  return {
    action: 'fleet-up', projectId: manifest.projectId, stateRoot, fresh,
    only: only ?? null, actions, blockers,
    canProceed: blockers.length === 0, mutationPerformed: false,
  };
}

export function planAreaUp({ repositoryRoot, controlPlane, areaId, adapter, adapters, fresh = false } = {}) {
  const { config, roster } = loadFleetDefinition(repositoryRoot);
  const manifest = readInstallManifest(repositoryRoot);
  const worktree = worktreesByArea(manifest).get(areaId);
  const area = roster.areas.find((candidate) => candidate.id === areaId);
  const blockers = [];
  if (!area) blockers.push({ areaId, code: 'FLEET_IDENTITY_MISSING' });
  if (!worktree) blockers.push({ areaId, code: 'WORKTREE_MISSING' });
  if (blockers.length) {
    return {
      action: 'area-up', projectId: manifest.projectId, areaId, fresh,
      actions: [], blockers, canProceed: false, mutationPerformed: false,
    };
  }
  const runtimes = adapterMap({ adapter, adapters });
  const runtime = configuredRuntime(area, config);
  const runtimeAdapter = runtimes.get(runtime);
  if (!runtimeAdapter) blockers.push({ areaId, code: 'RUNTIME_ADAPTER_MISSING', runtime });
  else if (runtimeAdapter.name !== runtime) {
    blockers.push({ areaId, code: 'RUNTIME_ADAPTER_MISMATCH', runtime, adapter: runtimeAdapter.name });
  }
  if (blockers.length) {
    return {
      action: 'area-up', projectId: manifest.projectId, areaId, fresh,
      actions: [], blockers, canProceed: false, mutationPerformed: false,
    };
  }
  validateRuntimeAdapter(runtimeAdapter);
  const identity = controlPlane.identity(area.id);
  const runtimeIntegration = runtimeAdapter.configure({
    repositoryRoot, areaId: area.id, mcpEntry: MCP_ENTRY,
  });
  if (runtimeIntegration?.mutationPerformed !== false || !runtimeIntegration?.mcp) {
    return {
      action: 'area-up', projectId: manifest.projectId, areaId, fresh,
      actions: [], blockers: [{ areaId, code: 'RUNTIME_CONFIGURATION_INVALID', runtime }],
      canProceed: false, mutationPerformed: false,
    };
  }
  const prompts = promptPaths(localStateRoot(manifest), worktree, area.id);
  const runtimeConfig = config.runtimes?.[runtime] ?? {};
  const model = area.model ?? runtimeConfig.model;
  const background = runtimeConfig.background ?? true;
  const shouldResume = !fresh && identity.runtime === runtime && Boolean(identity.runtimeSessionId);
  const runtimePlan = shouldResume
    ? runtimeAdapter.resumeSession({
      areaId: area.id, runtimeSessionId: identity.runtimeSessionId, worktree: worktree.path,
      model, background, message: startupMessage(area.id, false), mcp: runtimeIntegration.mcp,
    })
    : runtimeAdapter.createSession({
      areaId: area.id, title: area.title, worktree: worktree.path, promptFile: prompts.combined,
      firstMessage: startupMessage(area.id, true), model, background, mcp: runtimeIntegration.mcp,
    });
  const action = {
    areaId: area.id, title: area.title, mode: shouldResume ? 'resume' : 'create',
    runtime: runtimeAdapter.name, runtimeSessionId: runtimePlan.runtimeSessionId,
    requiresRuntimeIdCapture: runtimePlan.requiresRuntimeIdCapture ?? false,
    completionState: runtimePlan.completionState ?? 'starting',
    worktree: worktree.path, branch: worktree.branch, promptFile: prompts.combined,
    promptSources: [prompts.common, prompts.area], mcp: runtimeIntegration.mcp,
    launch: runtimePlan.launch,
  };
  return {
    action: 'area-up', projectId: manifest.projectId, areaId, fresh,
    actions: [action], blockers, canProceed: true, mutationPerformed: false,
  };
}

function writeCombinedPrompt(action) {
  const content = action.promptSources.map((path) => readFileSync(path, 'utf8').trimEnd()).join('\n\n');
  mkdirSync(dirname(action.promptFile), { recursive: true });
  writeFileSync(action.promptFile, `${content}\n`, { encoding: 'utf8', mode: 0o600 });
}

export function startFleet({ plan, controlPlane, executor, adapters } = {}) {
  if (!plan?.canProceed) {
    throw new TorchError('Fleet startup plan has unresolved blockers', {
      code: 'FLEET_NOT_READY_TO_START', details: plan?.blockers ?? [],
    });
  }
  if (typeof executor !== 'function') {
    throw new TorchError('Fleet startup requires an explicitly authorized runtime executor', {
      code: 'RUNTIME_EXECUTION_NOT_AUTHORIZED',
    });
  }
  const started = [];
  const runtimes = adapterMap({ adapters });
  for (const action of plan.actions) {
    controlPlane.assertIdentity(action.areaId);
    if (action.mode === 'create') writeCombinedPrompt(action);
    const result = executor({ ...action.launch, areaId: action.areaId, runtimeSessionId: action.runtimeSessionId });
    if (result?.status !== undefined && result.status !== 0) {
      controlPlane.reportStatus({
        areaId: action.areaId, state: 'offline', runtime: action.runtime,
        runtimeSessionId: action.runtimeSessionId, summary: 'Runtime launch failed.',
      });
      throw new TorchError(`Fleet startup failed for ${action.areaId}`, {
        code: 'FLEET_START_FAILED',
        details: { areaId: action.areaId, status: result.status, stderr: result.stderr ?? null, started },
      });
    }
    let runtimeSessionId = action.runtimeSessionId;
    if (action.requiresRuntimeIdCapture) {
      const runtimeAdapter = runtimes.get(action.runtime);
      if (!runtimeAdapter) {
        controlPlane.reportStatus({
          areaId: action.areaId, state: 'offline', runtime: action.runtime,
          summary: 'Runtime launched but its durable session ID could not be captured.',
        });
        throw new TorchError(`Fleet startup could not capture a runtime ID for ${action.areaId}`, {
          code: 'RUNTIME_ADAPTER_MISSING', details: { areaId: action.areaId, runtime: action.runtime, started },
        });
      }
      try {
        runtimeSessionId = runtimeAdapter.captureRuntimeId({
          areaId: action.areaId, runtimeSessionId, stdout: result?.stdout, output: result?.output,
        }).runtimeSessionId;
      } catch (error) {
        controlPlane.reportStatus({
          areaId: action.areaId, state: 'offline', runtime: action.runtime,
          summary: 'Runtime launch completed without a capturable durable session ID.',
        });
        throw new TorchError(`Fleet startup could not capture a runtime ID for ${action.areaId}`, {
          code: 'FLEET_START_FAILED',
          details: { areaId: action.areaId, cause: error.code ?? error.message, started },
        });
      }
    }
    const identity = controlPlane.reportStatus({
      areaId: action.areaId, state: action.completionState, runtime: action.runtime,
      runtimeSessionId, summary: action.completionState === 'idle'
        ? `${action.mode} turn completed` : `${action.mode} requested`,
    });
    started.push({ areaId: action.areaId, runtimeSessionId: identity.runtimeSessionId, mode: action.mode });
  }
  if (plan.stateRoot) {
    const metadata = projectMetadata(plan.stateRoot);
    if (metadata.value.detachedAt) {
      atomicJson(metadata.path, { ...metadata.value, detachedAt: null, attachedAt: new Date().toISOString() });
    }
  }
  return { projectId: plan.projectId, started, mutationPerformed: true };
}

export function planFleetDown({ repositoryRoot, controlPlane, adapters } = {}) {
  const { roster } = loadFleetDefinition(repositoryRoot);
  const manifest = readInstallManifest(repositoryRoot);
  const worktrees = worktreesByArea(manifest);
  const runtimes = adapterMap({ adapters });
  const adapterRegistryProvided = adapters !== undefined;
  const actions = orderedAreas(roster).map((area) => {
    const identity = controlPlane.identity(area.id);
    const worktree = worktrees.get(area.id);
    return {
      areaId: area.id, state: identity.state, runtime: identity.runtime,
      runtimeSessionId: identity.runtimeSessionId,
      requiresRuntimeStop: identity.runtimeSessionId
        ? runtimes.get(identity.runtime)?.capabilities.stopSession !== false
        : false,
      runtimeAdapterMissing: Boolean(
        adapterRegistryProvided && identity.runtimeSessionId && !runtimes.has(identity.runtime),
      ),
      worktree: worktree ? inspectWorktree(worktree) : null,
    };
  });
  const blockers = actions
    .filter((action) => ['starting', 'working', 'stopping'].includes(action.state))
    .map((action) => ({ areaId: action.areaId, state: action.state, code: 'ACTIVE_SESSION' }));
  blockers.push(...actions
    .filter((action) => action.runtimeAdapterMissing)
    .map((action) => ({ areaId: action.areaId, runtime: action.runtime, code: 'RUNTIME_ADAPTER_MISSING' })));
  return {
    action: 'fleet-down', projectId: manifest.projectId, stateRoot: localStateRoot(manifest),
    actions, blockers, canProceed: blockers.length === 0, mutationPerformed: false,
  };
}

export function stopFleet({ plan, controlPlane, stopRuntime, now = () => new Date() } = {}) {
  if (!plan?.canProceed) {
    throw new TorchError('Fleet wind-down refused while sessions report active work', {
      code: 'FLEET_NOT_READY_TO_STOP', details: plan?.blockers ?? [],
    });
  }
  if (typeof stopRuntime !== 'function') {
    throw new TorchError('Fleet wind-down requires an explicitly authorized runtime stopper', {
      code: 'RUNTIME_EXECUTION_NOT_AUTHORIZED',
    });
  }
  const stopped = [];
  for (const action of plan.actions) {
    if (!action.runtimeSessionId || action.state === 'offline' || action.requiresRuntimeStop === false) {
      if (action.state !== 'offline') {
        controlPlane.reportStatus({ areaId: action.areaId, state: 'offline', summary: 'No resident runtime process to stop.' });
      }
      stopped.push({
        areaId: action.areaId, runtimeSessionId: action.runtimeSessionId,
        alreadyOffline: true, residentProcess: action.requiresRuntimeStop !== false,
      });
      continue;
    }
    controlPlane.reportStatus({ areaId: action.areaId, state: 'stopping', summary: 'TORCH wind-down requested.' });
    const result = stopRuntime(action);
    if (result?.stopped === false || (result?.status !== undefined && result.status !== 0)) {
      controlPlane.reportStatus({ areaId: action.areaId, state: 'waiting', summary: 'Runtime stop failed.' });
      throw new TorchError(`Fleet wind-down failed for ${action.areaId}`, {
        code: 'FLEET_STOP_FAILED', details: { areaId: action.areaId, result },
      });
    }
    controlPlane.reportStatus({ areaId: action.areaId, state: 'offline', summary: 'Runtime stopped cleanly.' });
    stopped.push({ areaId: action.areaId, runtimeSessionId: action.runtimeSessionId, alreadyOffline: false });
  }
  const snapshotPath = captureSnapshot({ plan, controlPlane, now });
  return { projectId: plan.projectId, stopped, snapshotPath, mutationPerformed: true };
}

export function captureFleet({ repositoryRoot, controlPlane, now = () => new Date() } = {}) {
  const plan = planFleetDown({ repositoryRoot, controlPlane });
  const snapshotPath = captureSnapshot({ plan, controlPlane, now });
  return {
    action: 'capture', projectId: plan.projectId, snapshotPath,
    agents: controlPlane.listAgents(), mutationPerformed: true,
  };
}

export function createFleetBrief({ repositoryRoot, controlPlane, areaId } = {}) {
  const { roster } = loadFleetDefinition(repositoryRoot);
  const selected = areaId
    ? roster.areas.filter((area) => area.id === areaId)
    : orderedAreas(roster);
  if (!selected.length) {
    throw new TorchError(`Unknown Fleet identity: ${areaId}`, { code: 'UNKNOWN_FLEET_IDENTITY' });
  }
  const commonPath = join(repositoryRoot, '.torch', 'prompts', 'COMMON.md');
  const common = readFileSync(commonPath, 'utf8').trimEnd();
  return {
    schema: 'torch.dev/fleet-brief/v1alpha1', mutationPerformed: false,
    areas: selected.map((area) => {
      const promptPath = join(repositoryRoot, '.torch', 'prompts', `${area.id}.md`);
      return {
        areaId: area.id, title: area.title, identity: controlPlane.identity(area.id),
        promptSources: [commonPath, promptPath],
        prompt: `${common}\n\n${readFileSync(promptPath, 'utf8').trimEnd()}\n`,
      };
    }),
  };
}

export function planFleetDetach({ repositoryRoot, controlPlane, adapters } = {}) {
  const plan = planFleetDown({ repositoryRoot, controlPlane, adapters });
  return { ...plan, action: 'fleet-detach' };
}

export function detachFleet({ plan, controlPlane, stopRuntime, now = () => new Date() } = {}) {
  if (plan?.action !== 'fleet-detach') {
    throw new TorchError('Fleet detach requires a reviewed detach plan', { code: 'FLEET_DETACH_PLAN_REQUIRED' });
  }
  const stopped = stopFleet({ plan, controlPlane, stopRuntime, now });
  const metadata = projectMetadata(plan.stateRoot);
  const detachedAt = now().toISOString();
  atomicJson(metadata.path, { ...metadata.value, detachedAt });
  return {
    action: 'fleet-detach', projectId: plan.projectId, detachedAt,
    stopped: stopped.stopped, snapshotPath: stopped.snapshotPath,
    preserved: ['tracked organization', 'worktrees', 'branches', 'local state'],
    mutationPerformed: true,
  };
}
