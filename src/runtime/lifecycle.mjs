import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TorchError } from '../kernel/errors.mjs';
import { readInstallManifest } from '../kernel/install.mjs';
import { loadFleetDefinition } from '../kernel/worktrees.mjs';
import { organizationGraphFromConfig } from '../kernel/organization.mjs';
import { sha256 } from '../kernel/files.mjs';
import {
  costCeilingPlanIssues, profileCapabilityIssues, resolveLaunchPolicy, validateRuntimeAdapter,
} from '../adapters/runtime.mjs';
import { hierarchyOrder } from './hierarchy-order.mjs';

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

function selectedAreas(roster, only, blockers, ordered = roster.areas) {
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
    return config.session_manager?.runtime ?? area.runtime ?? config.runtimes?.default;
  }
  return config.domains?.find((domain) => domain.id === area.id)?.runtime ?? area.runtime
    ?? config.runtimes?.default;
}

function configuredProfile(area, config, runtime) {
  const runtimeConfig = config.runtimes?.[runtime] ?? {};
  const configured = area.id === 'session-manager'
    ? config.session_manager : config.domains?.find((domain) => domain.id === area.id);
  const launchPolicy = resolveLaunchPolicy({
    runtime, adapterDefaults: {}, runtimeConfig, identity: configured,
  });
  return {
    model: configured?.model ?? area.model
      ?? runtimeConfig.model ?? null,
    reasoning: configured?.reasoning ?? area.reasoning
      ?? runtimeConfig.reasoning ?? null,
    launchPolicy,
  };
}

function organizationContext(config, areaId) {
  const graph = organizationGraphFromConfig(config);
  const rolesById = new Map(graph.roles.map((role) => [role.id, role]));
  const ownRoles = graph.roles.filter((role) => role.identity_id === areaId);
  const ownRoleIds = new Set(ownRoles.map((role) => role.id));
  const summarizeRole = (role) => ({
    roleId: role.id, title: role.title, kind: role.kind,
    responsibilities: role.responsibilities, authority: role.authority,
    reportsTo: role.reports_to.map((roleId) => rolesById.get(roleId)?.title ?? roleId),
  });
  const directReports = new Map();
  for (const role of graph.roles) {
    if (role.identity_id === areaId || !role.reports_to.some((parent) => ownRoleIds.has(parent))) continue;
    directReports.set(role.identity_id, summarizeRole(role));
  }
  const related = (field) => [...new Map(ownRoles.flatMap((role) => role[field]
    .map((roleId) => rolesById.get(roleId)).filter(Boolean)
    .filter((role) => role.identity_id !== areaId)
    .map((role) => [role.identity_id, { identityId: role.identity_id, title: role.title }]))).values()]
    .sort((left, right) => left.identityId.localeCompare(right.identityId));
  return {
    schema: graph.schema, revision: graph.revision, identityId: areaId,
    roles: ownRoles.map(summarizeRole),
    directReports: [...directReports.entries()].sort(([left], [right]) => left.localeCompare(right))
      .map(([identityId, role]) => ({ identityId, ...role })),
    coordinates: related('coordinates'), consultsWith: related('consults_with'),
    implementationOwnership: graph.implementation_owners
      .filter((owner) => owner.identity_id === areaId),
  };
}

function managerCheckInInstructions(organization) {
  if (!organization.directReports.length) return [];
  return [
    '## Scheduled manager check-ins',
    '',
    'Your active organization role has direct reports. TORCH queues a durable self-directed `manager-check-in` message on the configured schedule; the wake snapshot may be stale, and a currently active session may receive the message only in its durable inbox.',
    '- At startup/resume, after seeing a `manager-check-in` message, and at the start of each new coordination cycle, read your inbox and call `torch_plan_manager_check_in` to refresh direct-report presence, blockers, messages, handoffs, and structured approval waits from current durable state.',
    '- Follow up on each finding within your coordination authority. For a pending approval, decide only when you are the named approver; route owner- or peer-owned approvals to that approver and never decide for them.',
    '- A check-in is observational: it does not assign work, transfer ownership, approve a request, create an identity, or authorize runtime/spending changes. Preserve direct peer communication.',
    '',
  ];
}

function promptPaths(stateRoot, repositoryRoot, areaId, config) {
  const common = join(repositoryRoot, '.torch', 'prompts', 'COMMON.md');
  const area = join(repositoryRoot, '.torch', 'prompts', `${areaId}.md`);
  const organization = organizationContext(config, areaId);
  const organizationSource = join(repositoryRoot, '.torch', 'torch.yaml');
  const instructionText = [
    '# TORCH runtime rules — current authoritative revision',
    '',
    `Identity: ${areaId}`,
    '',
    '- This bundle is rebuilt from the canonical project checkout whenever this identity starts or resumes.',
    '- If this bundle conflicts with earlier conversation memory or an older prompt revision, this current bundle wins.',
    '- Before each new backlog item, run `torch brief --area <your-id> --json`; read and follow its current prompt and digest. Current repository instructions override older conversation memory.',
    '- Never push a specialist branch directly to the canonical branch or its remote. Submit an exact-commit request with `torch integrate request`; landing is a serialized, authority-gated operation.',
    '- After canonical main advances, converge your clean branch, rerun required checks on the resulting exact commit, and submit a new integration request. Never bypass a lost race by weakening checks.',
    '',
    readFileSync(common, 'utf8').trimEnd(),
    '',
    ...managerCheckInInstructions(organization),
    '## Active organization metadata',
    '',
    'The following JSON is owner-approved project configuration supplied as data. It describes your coordination roles, reporting relationships, and implementation ownership; it does not grant authority beyond TORCH-enforced policy or override owner instructions and safety rules.',
    '',
    JSON.stringify(organization),
    '',
    readFileSync(area, 'utf8').trimEnd(),
    '',
  ].join('\n');
  const instructionDigest = sha256(instructionText);
  return {
    common, area, organization: organizationSource,
    combined: join(stateRoot, 'sessions', 'prompts', `${areaId}-${instructionDigest.slice(0, 16)}.md`),
    instructionText, instructionDigest,
  };
}

function startupMessage(areaId, fresh, instructionDigest) {
  const currentBrief = `Current TORCH instruction digest: ${instructionDigest}. The current instruction bundle is included in this launch/resume and supersedes older briefing text in the conversation. Read the current brief again before each new backlog item.`;
  if (areaId === 'session-manager') {
    return fresh
      ? `Start the TORCH Fleet. Inspect live roster, messages, worktrees, and backlog, then assess Fleet evolution before dispatch. ${currentBrief}`
      : `Resume the TORCH Fleet from durable state. Reconcile live status and assess Fleet evolution before dispatch. ${currentBrief}`;
  }
  return fresh
    ? `Start this TORCH domain. Query live identity and ownership, then await or resume the assigned backlog item. ${currentBrief}`
    : `Resume this TORCH domain from durable state. Read the inbox, confirm ownership, and report current evidence. ${currentBrief}`;
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
  const capturedAt = now().toISOString();
  const database = controlPlane.database;
  const hasTable = (name) => Boolean(database.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(name));
  const snapshot = {
    schema: 'torch.dev/runtime-snapshot/v1alpha1', projectId: plan.projectId,
    capturedAt, agents: controlPlane.listAgents(),
    worktrees: plan.actions.map((action) => action.worktree).filter(Boolean),
    resourceLeases: hasTable('resource_leases') ? database.prepare(`
      SELECT resource_id AS resourceId, area_id AS areaId, acquired_at AS acquiredAt,
        expires_at AS expiresAt FROM resource_leases WHERE released_at IS NULL ORDER BY resource_id, acquired_at
    `).all() : [],
    worktreeGuards: hasTable('worktree_guards') ? database.prepare(`
      SELECT area_id AS areaId, guard_type AS type, reason, created_at AS createdAt
      FROM worktree_guards WHERE released_at IS NULL ORDER BY created_at, id
    `).all() : [],
    integration: hasTable('integration_requests') ? database.prepare(`
      SELECT id, source_area AS sourceArea, source_commit AS sourceCommit, state, reason
      FROM integration_requests WHERE state NOT IN ('landed', 'superseded') ORDER BY created_at, id
    `).all() : [],
  };
  atomicJson(snapshotPath, snapshot);
  return { snapshotPath, snapshot };
}

function writeResumeBrief(plan, snapshot) {
  if (!plan.resumeBriefPath) return null;
  const lines = [
    '# TORCH resume brief', '',
    `Captured: ${snapshot.capturedAt}`,
    `Project: ${snapshot.projectId}`,
    '', '## Fleet identities', '',
    ...snapshot.agents.map((agent) =>
      `- ${agent.areaId}: ${agent.state}; runtime=${agent.runtime ?? 'none'}; task=${agent.currentTask ?? agent.task ?? 'none'}; summary=${agent.summary ?? 'none'}`),
    '', '## Worktrees', '',
    ...(snapshot.worktrees.length ? snapshot.worktrees.map((worktree) =>
      `- ${worktree.areaId}: branch=${worktree.branch}; commit=${worktree.commit}; dirty=${worktree.dirtyEntries.length ? worktree.dirtyEntries.join(', ') : 'no'}`) : ['- No managed worktrees recorded.']),
    '', '## Open integration', '',
    ...(snapshot.integration.length ? snapshot.integration.map((request) =>
      `- ${request.id}: ${request.sourceArea} ${request.sourceCommit} is ${request.state}${request.reason ? ` (${request.reason})` : ''}`) : ['- None.']),
    '', '## Guards and leases', '',
    ...(snapshot.worktreeGuards.length ? snapshot.worktreeGuards.map((guard) =>
      `- guard: ${guard.areaId} ${guard.type} — ${guard.reason}`) : ['- No active worktree guards.']),
    ...(snapshot.resourceLeases.length ? snapshot.resourceLeases.map((lease) =>
      `- lease: ${lease.areaId} holds ${lease.resourceId} until ${lease.expiresAt}`) : ['- No active resource leases.']),
    '', 'Resume by checking live identity, inbox, backlog, worktree state, and exact check receipts before dispatch.', '',
  ];
  const temporary = `${plan.resumeBriefPath}.tmp-${process.pid}`;
  writeFileSync(temporary, `${lines.join('\n')}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  renameSync(temporary, plan.resumeBriefPath);
  return plan.resumeBriefPath;
}

function inspectWorktree(worktree) {
  const git = (args) => execFileSync('git', ['-C', worktree.path, ...args], { encoding: 'utf8' }).trim();
  const operations = ['MERGE_HEAD', 'REBASE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']
    .filter((name) => existsSync(git(['rev-parse', '--git-path', name])));
  return {
    areaId: worktree.area,
    path: worktree.path,
    branch: git(['branch', '--show-current']),
    commit: git(['rev-parse', 'HEAD']),
    dirtyEntries: git(['status', '--porcelain']).split('\n').filter(Boolean),
    operations,
  };
}

export function planFleetUp({ repositoryRoot, controlPlane, adapter, adapters, fresh = false, only } = {}) {
  const { config, roster } = loadFleetDefinition(repositoryRoot);
  const hierarchy = hierarchyOrder(roster, config);
  const manifest = readInstallManifest(repositoryRoot);
  const worktrees = worktreesByArea(manifest);
  const stateRoot = localStateRoot(manifest);
  const runtimes = adapterMap({ adapter, adapters });
  const blockers = [...hierarchy.blockers];
  const actions = [];

  for (const area of selectedAreas(roster, only, blockers, hierarchy.areas)) {
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
      projectId: manifest.projectId, stateRoot,
    });
    if (runtimeIntegration?.mutationPerformed !== false
      || !(runtimeIntegration?.mcp || runtimeIntegration?.integration)) {
      blockers.push({
        areaId: area.id, code: 'RUNTIME_CONFIGURATION_INVALID', runtime,
      });
      continue;
    }
    const prompts = promptPaths(stateRoot, repositoryRoot, area.id, config);
    const profile = configuredProfile(area, config, runtime);
    const unsupported = profileCapabilityIssues(runtimeAdapter, profile);
    if (unsupported.length) {
      blockers.push({
        areaId: area.id, code: 'RUNTIME_PROFILE_UNSUPPORTED', runtime,
        adapter: runtimeAdapter.name, profile, capabilities: unsupported,
      });
      continue;
    }
    const runtimeConfig = config.runtimes?.[runtime] ?? {};
    const { model, reasoning, launchPolicy } = profile;
    const background = runtimeConfig.background ?? true;
    const shouldResume = !fresh && identity.runtime === runtime && Boolean(identity.runtimeSessionId);
    const runtimePlan = shouldResume
      ? runtimeAdapter.resumeSession({
        areaId: area.id, runtimeSessionId: identity.runtimeSessionId, worktree: worktree.path,
        model, reasoning, launchPolicy, background,
        message: startupMessage(area.id, false, prompts.instructionDigest),
        promptFile: prompts.combined, instructionText: prompts.instructionText,
        instructionDigest: prompts.instructionDigest, mcp: runtimeIntegration.mcp,
        integration: runtimeIntegration.integration,
      })
      : runtimeAdapter.createSession({
        areaId: area.id, title: area.title, worktree: worktree.path, promptFile: prompts.combined,
        firstMessage: startupMessage(area.id, true, prompts.instructionDigest),
        model, reasoning, launchPolicy, background, mcp: runtimeIntegration.mcp,
        integration: runtimeIntegration.integration,
      });
    actions.push({
      areaId: area.id, title: area.title, mode: shouldResume ? 'resume' : 'create',
      managerIds: [...(hierarchy.managersByIdentity.get(area.id) ?? [])],
      runtime: runtimeAdapter.name, runtimeSessionId: runtimePlan.runtimeSessionId,
      profile,
      requiresRuntimeIdCapture: runtimePlan.requiresRuntimeIdCapture ?? false,
      completionState: runtimePlan.completionState ?? 'starting',
      worktree: worktree.path, branch: worktree.branch, promptFile: prompts.combined,
      promptSources: [prompts.common, prompts.area, prompts.organization], instructionText: prompts.instructionText,
      instructionDigest: prompts.instructionDigest, mcp: runtimeIntegration.mcp ?? null,
      integration: runtimeIntegration.integration ?? null,
      launch: runtimePlan.launch,
    });
  }

  return {
    action: 'fleet-up', projectId: manifest.projectId, stateRoot, fresh,
    only: only ?? null, startupOrder: actions.map((action) => action.areaId), actions, blockers,
    canProceed: blockers.length === 0, mutationPerformed: false,
  };
}

export function planAreaUp({ repositoryRoot, controlPlane, areaId, adapter, adapters, fresh = false, maxCostUsd } = {}) {
  const { config, roster } = loadFleetDefinition(repositoryRoot);
  const manifest = readInstallManifest(repositoryRoot);
  const worktree = worktreesByArea(manifest).get(areaId);
  const area = roster.areas.find((candidate) => candidate.id === areaId);
  const blockers = [];
  if (maxCostUsd !== undefined && (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0)) {
    blockers.push({ areaId, code: 'RUNTIME_COST_CEILING_INVALID', maxUsd: maxCostUsd });
  }
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
    projectId: manifest.projectId, stateRoot: localStateRoot(manifest),
  });
  if (runtimeIntegration?.mutationPerformed !== false
    || !(runtimeIntegration?.mcp || runtimeIntegration?.integration)) {
    return {
      action: 'area-up', projectId: manifest.projectId, areaId, fresh,
      actions: [], blockers: [{ areaId, code: 'RUNTIME_CONFIGURATION_INVALID', runtime }],
      canProceed: false, mutationPerformed: false,
    };
  }
  const prompts = promptPaths(localStateRoot(manifest), repositoryRoot, area.id, config);
  const profile = configuredProfile(area, config, runtime);
  const unsupported = profileCapabilityIssues(runtimeAdapter, profile);
  if (unsupported.length) {
    return {
      action: 'area-up', projectId: manifest.projectId, areaId, fresh,
      actions: [], blockers: [{
        areaId: area.id, code: 'RUNTIME_PROFILE_UNSUPPORTED', runtime,
        adapter: runtimeAdapter.name, profile, capabilities: unsupported,
      }], canProceed: false, mutationPerformed: false,
    };
  }
  const runtimeConfig = config.runtimes?.[runtime] ?? {};
  const { model, reasoning, launchPolicy } = profile;
  const background = runtimeConfig.background ?? true;
  const shouldResume = !fresh && identity.runtime === runtime && Boolean(identity.runtimeSessionId);
  const operation = shouldResume ? 'resumeSession' : 'createSession';
  const declaredCostModes = runtimeAdapter.capabilities.perInvocationCostCeiling[operation];
  if (maxCostUsd !== undefined && declaredCostModes.length === 0) {
    return {
      action: 'area-up', projectId: manifest.projectId, areaId, fresh,
      actions: [], blockers: [{
        areaId, code: 'RUNTIME_COST_CEILING_UNSUPPORTED', runtime: runtimeAdapter.name,
        operation, maxUsd: maxCostUsd, background,
      }], canProceed: false, mutationPerformed: false,
    };
  }
  const runtimePlan = shouldResume
    ? runtimeAdapter.resumeSession({
      areaId: area.id, runtimeSessionId: identity.runtimeSessionId, worktree: worktree.path,
      model, reasoning, launchPolicy, background,
      message: startupMessage(area.id, false, prompts.instructionDigest),
      promptFile: prompts.combined, instructionText: prompts.instructionText,
      instructionDigest: prompts.instructionDigest, mcp: runtimeIntegration.mcp,
        integration: runtimeIntegration.integration,
        ...(maxCostUsd === undefined ? {} : { maxCostUsd }),
      })
    : runtimeAdapter.createSession({
      areaId: area.id, title: area.title, worktree: worktree.path, promptFile: prompts.combined,
      firstMessage: startupMessage(area.id, true, prompts.instructionDigest),
      model, reasoning, launchPolicy, background, mcp: runtimeIntegration.mcp,
        integration: runtimeIntegration.integration,
        ...(maxCostUsd === undefined ? {} : { maxCostUsd }),
      });
  if (maxCostUsd !== undefined) {
    const ceilingIssues = costCeilingPlanIssues(runtimeAdapter, operation, maxCostUsd, runtimePlan);
    if (ceilingIssues.length) {
      return {
        action: 'area-up', projectId: manifest.projectId, areaId, fresh,
        actions: [], blockers: ceilingIssues.map((issue) => ({ areaId, ...issue, background })),
        canProceed: false, mutationPerformed: false,
      };
    }
  }
  const action = {
    areaId: area.id, title: area.title, mode: shouldResume ? 'resume' : 'create',
    runtime: runtimeAdapter.name, runtimeSessionId: runtimePlan.runtimeSessionId,
    profile,
    ...(maxCostUsd === undefined ? {} : { costCeiling: runtimePlan.costCeiling }),
    requiresRuntimeIdCapture: runtimePlan.requiresRuntimeIdCapture ?? false,
    completionState: runtimePlan.completionState ?? 'starting',
    worktree: worktree.path, branch: worktree.branch, promptFile: prompts.combined,
    promptSources: [prompts.common, prompts.area, prompts.organization], instructionText: prompts.instructionText,
    instructionDigest: prompts.instructionDigest, mcp: runtimeIntegration.mcp ?? null,
    integration: runtimeIntegration.integration ?? null,
    launch: runtimePlan.launch,
  };
  return {
    action: 'area-up', projectId: manifest.projectId, areaId, fresh,
    actions: [action], blockers, canProceed: true, mutationPerformed: false,
  };
}

function writeCombinedPrompt(action) {
  mkdirSync(dirname(action.promptFile), { recursive: true });
  writeFileSync(action.promptFile, action.instructionText, { encoding: 'utf8', mode: 0o600 });
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
    writeCombinedPrompt(action);
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
  const { config, roster } = loadFleetDefinition(repositoryRoot);
  const hierarchy = hierarchyOrder(roster, config);
  const manifest = readInstallManifest(repositoryRoot);
  const worktrees = worktreesByArea(manifest);
  const runtimes = adapterMap({ adapters });
  const adapterRegistryProvided = adapters !== undefined;
  const database = controlPlane.database;
  const hasTable = (name) => Boolean(database.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(name));
  const actions = [...hierarchy.areas].reverse().map((area) => {
    const identity = controlPlane.identity(area.id);
    const worktree = worktrees.get(area.id);
    return {
      areaId: area.id, state: identity.state, runtime: identity.runtime,
      managerIds: [...(hierarchy.managersByIdentity.get(area.id) ?? [])],
      runtimeSessionId: identity.runtimeSessionId, currentTask: identity.currentTask,
      requiresRuntimeStop: identity.runtimeSessionId
        ? runtimes.get(identity.runtime)?.capabilities.stopSession !== false
        : false,
      runtimeAdapterMissing: Boolean(
        adapterRegistryProvided && identity.runtimeSessionId && !runtimes.has(identity.runtime),
      ),
      worktree: worktree ? inspectWorktree(worktree) : null,
    };
  });
  const blockers = [...hierarchy.blockers, ...actions
    .filter((action) => ['starting', 'working', 'stopping'].includes(action.state))
    .map((action) => ({ areaId: action.areaId, state: action.state, code: 'ACTIVE_SESSION' }))];
  blockers.push(...actions
    .filter((action) => action.runtimeAdapterMissing)
    .map((action) => ({ areaId: action.areaId, runtime: action.runtime, code: 'RUNTIME_ADAPTER_MISSING' })));
  blockers.push(...actions
    .filter((action) => action.worktree?.operations.length)
    .map((action) => ({
      areaId: action.areaId, code: 'GIT_OPERATION_ACTIVE', operations: action.worktree.operations,
    })));
  if (hasTable('resource_leases')) {
    blockers.push(...database.prepare(`
      SELECT resource_id AS resourceId, area_id AS areaId, expires_at AS expiresAt
      FROM resource_leases WHERE released_at IS NULL ORDER BY resource_id, acquired_at
    `).all().map((lease) => ({ ...lease, code: 'RESOURCE_LEASE_ACTIVE' })));
  }
  if (hasTable('worktree_guards')) {
    blockers.push(...database.prepare(`
      SELECT area_id AS areaId, guard_type AS type, reason
      FROM worktree_guards WHERE released_at IS NULL AND guard_type IN ('check', 'measurement')
      ORDER BY created_at, id
    `).all().map((guard) => ({ ...guard, code: 'WORKTREE_GUARD_ACTIVE' })));
  }
  if (hasTable('integration_requests')) {
    blockers.push(...database.prepare(`
      SELECT id, source_area AS areaId FROM integration_requests WHERE state = 'landing' ORDER BY created_at, id
    `).all().map((request) => ({ ...request, code: 'INTEGRATION_LANDING_ACTIVE' })));
  }
  const managerWorktree = worktrees.get('session-manager');
  return {
    action: 'fleet-down', projectId: manifest.projectId, stateRoot: localStateRoot(manifest),
    resumeBriefPath: managerWorktree ? join(managerWorktree.path, '.torch', 'RESUME-BRIEF.md') : null,
    shutdownOrder: actions.map((action) => action.areaId),
    actions, blockers, canProceed: blockers.length === 0, mutationPerformed: false,
  };
}

export function stopFleet({ plan, controlPlane, stopRuntime, now = () => new Date() } = {}) {
  if (!plan?.canProceed) {
    throw new TorchError('Fleet wind-down refused while safety conditions remain unresolved', {
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
    if (action.state !== 'offline') {
      for (const managerId of action.managerIds ?? []) {
        controlPlane.sendMessage({
          sender: action.areaId, recipient: managerId,
          body: `Final status: ${action.state}. ${action.worktree
            ? `Branch ${action.worktree.branch} at ${action.worktree.commit}; ${action.worktree.dirtyEntries.length} dirty entries.`
            : 'No managed worktree.'}`,
          references: { commit: action.worktree?.commit },
        });
      }
    }
    if (!action.runtimeSessionId || action.state === 'offline' || action.requiresRuntimeStop === false) {
      if (action.state !== 'offline') {
        controlPlane.reportStatus({
          areaId: action.areaId, state: 'offline', summary: 'No resident runtime process to stop.',
          task: action.currentTask,
        });
      }
      stopped.push({
        areaId: action.areaId, runtimeSessionId: action.runtimeSessionId,
        alreadyOffline: true, residentProcess: action.requiresRuntimeStop !== false,
      });
      continue;
    }
    controlPlane.reportStatus({
      areaId: action.areaId, state: 'stopping', summary: 'TORCH wind-down requested.', task: action.currentTask,
    });
    const result = stopRuntime(action);
    if (result?.stopped === false || (result?.status !== undefined && result.status !== 0)) {
      controlPlane.reportStatus({
        areaId: action.areaId, state: 'waiting', summary: 'Runtime stop failed.', task: action.currentTask,
      });
      throw new TorchError(`Fleet wind-down failed for ${action.areaId}`, {
        code: 'FLEET_STOP_FAILED', details: { areaId: action.areaId, result },
      });
    }
    controlPlane.reportStatus({
      areaId: action.areaId, state: 'offline', summary: 'Runtime stopped cleanly.', task: action.currentTask,
    });
    stopped.push({ areaId: action.areaId, runtimeSessionId: action.runtimeSessionId, alreadyOffline: false });
  }
  const captured = captureSnapshot({ plan, controlPlane, now });
  const resumeBriefPath = writeResumeBrief(plan, captured.snapshot);
  return {
    projectId: plan.projectId, stopped, snapshotPath: captured.snapshotPath,
    resumeBriefPath, mutationPerformed: true,
  };
}

export function captureFleet({ repositoryRoot, controlPlane, now = () => new Date() } = {}) {
  const plan = planFleetDown({ repositoryRoot, controlPlane });
  const { snapshotPath } = captureSnapshot({ plan, controlPlane, now });
  return {
    action: 'capture', projectId: plan.projectId, snapshotPath,
    agents: controlPlane.listAgents(), mutationPerformed: true,
  };
}

export function createFleetBrief({ repositoryRoot, controlPlane, areaId } = {}) {
  const { config, roster } = loadFleetDefinition(repositoryRoot);
  const manifest = readInstallManifest(repositoryRoot);
  const selected = areaId
    ? roster.areas.filter((area) => area.id === areaId)
    : hierarchyOrder(roster, config).areas;
  if (!selected.length) {
    throw new TorchError(`Unknown Fleet identity: ${areaId}`, { code: 'UNKNOWN_FLEET_IDENTITY' });
  }
  return {
    schema: 'torch.dev/fleet-brief/v1alpha1', mutationPerformed: false,
    areas: selected.map((area) => {
      const prompts = promptPaths(localStateRoot(manifest), repositoryRoot, area.id, config);
      return {
        areaId: area.id, title: area.title, identity: controlPlane.identity(area.id),
        promptSources: [prompts.common, prompts.area, prompts.organization],
        instructionDigest: prompts.instructionDigest,
        prompt: prompts.instructionText,
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
