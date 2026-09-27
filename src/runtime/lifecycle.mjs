import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { TorchError } from '../kernel/errors.mjs';
import { readInstallManifest } from '../kernel/install.mjs';
import { loadFleetDefinition } from '../kernel/worktrees.mjs';

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

export function planFleetUp({ repositoryRoot, controlPlane, adapter, fresh = false } = {}) {
  const { config, roster } = loadFleetDefinition(repositoryRoot);
  const manifest = readInstallManifest(repositoryRoot);
  const worktrees = worktreesByArea(manifest);
  const stateRoot = localStateRoot(manifest);
  const actions = [];
  const blockers = [];

  for (const area of orderedAreas(roster)) {
    const worktree = worktrees.get(area.id);
    if (!worktree) {
      blockers.push({ areaId: area.id, code: 'WORKTREE_MISSING' });
      continue;
    }
    const identity = controlPlane.identity(area.id);
    const prompts = promptPaths(stateRoot, worktree, area.id);
    const model = area.model ?? config.runtimes?.claude?.model ?? 'opus';
    const background = config.runtimes?.claude?.background ?? true;
    const shouldResume = !fresh && Boolean(identity.runtimeSessionId);
    const runtimePlan = shouldResume
      ? adapter.resumeSession({
        areaId: area.id, runtimeSessionId: identity.runtimeSessionId, worktree: worktree.path,
        model, background, message: startupMessage(area.id, false),
      })
      : adapter.createSession({
        areaId: area.id, title: area.title, worktree: worktree.path, promptFile: prompts.combined,
        firstMessage: startupMessage(area.id, true), model, background,
      });
    actions.push({
      areaId: area.id, title: area.title, mode: shouldResume ? 'resume' : 'create',
      runtime: adapter.name, runtimeSessionId: runtimePlan.runtimeSessionId,
      worktree: worktree.path, branch: worktree.branch, promptFile: prompts.combined,
      promptSources: [prompts.common, prompts.area], launch: runtimePlan.launch,
    });
  }

  return {
    action: 'fleet-up', projectId: manifest.projectId, fresh, actions, blockers,
    canProceed: blockers.length === 0, mutationPerformed: false,
  };
}

function writeCombinedPrompt(action) {
  const content = action.promptSources.map((path) => readFileSync(path, 'utf8').trimEnd()).join('\n\n');
  mkdirSync(dirname(action.promptFile), { recursive: true });
  writeFileSync(action.promptFile, `${content}\n`, { encoding: 'utf8', mode: 0o600 });
}

export function startFleet({ plan, controlPlane, executor } = {}) {
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
    const identity = controlPlane.reportStatus({
      areaId: action.areaId, state: 'starting', runtime: action.runtime,
      runtimeSessionId: action.runtimeSessionId, summary: `${action.mode} requested`,
    });
    started.push({ areaId: action.areaId, runtimeSessionId: identity.runtimeSessionId, mode: action.mode });
  }
  return { projectId: plan.projectId, started, mutationPerformed: true };
}

export function planFleetDown({ repositoryRoot, controlPlane } = {}) {
  const { roster } = loadFleetDefinition(repositoryRoot);
  const manifest = readInstallManifest(repositoryRoot);
  const worktrees = worktreesByArea(manifest);
  const actions = orderedAreas(roster).map((area) => {
    const identity = controlPlane.identity(area.id);
    const worktree = worktrees.get(area.id);
    return {
      areaId: area.id, state: identity.state, runtime: identity.runtime,
      runtimeSessionId: identity.runtimeSessionId,
      worktree: worktree ? inspectWorktree(worktree) : null,
    };
  });
  const blockers = actions
    .filter((action) => ['starting', 'working', 'stopping'].includes(action.state))
    .map((action) => ({ areaId: action.areaId, state: action.state, code: 'ACTIVE_SESSION' }));
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
    if (!action.runtimeSessionId || action.state === 'offline') {
      stopped.push({ areaId: action.areaId, runtimeSessionId: action.runtimeSessionId, alreadyOffline: true });
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
  const snapshotPath = join(plan.stateRoot, 'sessions', 'resume.json');
  atomicJson(snapshotPath, {
    schema: 'torch.dev/runtime-snapshot/v1alpha1', projectId: plan.projectId,
    capturedAt: now().toISOString(), agents: controlPlane.listAgents(),
    worktrees: plan.actions.map((action) => action.worktree).filter(Boolean),
  });
  return { projectId: plan.projectId, stopped, snapshotPath, mutationPerformed: true };
}
