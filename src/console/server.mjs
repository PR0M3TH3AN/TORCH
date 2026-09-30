import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { observeProject } from '../observability/snapshot.mjs';
import { ArtifactService, readPublishedArtifact } from '../artifacts/service.mjs';
import { BacklogService } from '../backlog/service.mjs';
import { openControlPlane } from '../control-plane/service.mjs';
import { FleetEvolutionService } from '../evolution/service.mjs';
import { HierarchyEvolutionService } from '../evolution/hierarchy.mjs';
import { loadProjectConfig } from '../kernel/config.mjs';
import { inspectRepository } from '../kernel/git.mjs';
import { organizationGraphFromConfig } from '../kernel/organization.mjs';
import { fileHash } from '../kernel/files.mjs';
import { ScheduleLauncherService } from '../schedules/launcher.mjs';

const SITE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'site');
const TORCH_CLI = fileURLToPath(new URL('../../bin/torch.mjs', import.meta.url));
const ROUTES = new Map([
  ['/', 'index.html'], ['/index.html', 'index.html'], ['/styles.css', 'styles.css'],
  ['/app.js', 'app.js'], ['/console', 'console.html'], ['/console.html', 'console.html'],
  ['/demo.html', 'demo.html'], ['/demo.js', 'demo.js'], ['/demo-artifact.svg', 'demo-artifact.svg'],
  ['/console.js', 'console.js'], ['/work-views.js', 'work-views.js'],
  ['/work-progress.js', 'work-progress.js'], ['/torch-mark.svg', 'torch-mark.svg'],
  ['/owner-digest.js', 'owner-digest.js'],
  ['/check-evidence.js', 'check-evidence.js'],
  ['/task-activity.js', 'task-activity.js'],
  ['/operation-outcomes.js', 'operation-outcomes.js'],
  ['/live-refresh.js', 'live-refresh.js'],
]);
const TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'], ['.svg', 'image/svg+xml'],
]);
const MAX_FEEDBACK_BYTES = 8 * 1024;
const FEEDBACK_PREVIEW_TTL_MS = 5 * 60 * 1000;
const MAX_FEEDBACK_PREVIEWS = 200;
const ORGANIZATION_REVIEW_PREVIEW_TTL_MS = 5 * 60 * 1000;
const HIERARCHY_ACTIVATION_PREVIEW_TTL_MS = 5 * 60 * 1000;
const OWNER_REQUEST_PREVIEW_TTL_MS = 5 * 60 * 1000;
const APPROVAL_DECISION_PREVIEW_TTL_MS = 5 * 60 * 1000;
const RUNTIME_PROFILE_PREVIEW_TTL_MS = 5 * 60 * 1000;
const SCHEDULE_LAUNCHER_PREVIEW_TTL_MS = 5 * 60 * 1000;

function feedbackPlanHash(plan) {
  return createHash('sha256').update(JSON.stringify(plan)).digest('hex');
}

function priorityPlanHash(plan) {
  return createHash('sha256').update(JSON.stringify(plan)).digest('hex');
}

function sameOriginLoopback(request) {
  const origin = request.headers.origin;
  const host = request.headers.host;
  const peerAddress = String(request.socket.remoteAddress ?? '').toLowerCase().replace(/^::ffff:/, '');
  const loopbackPeer = peerAddress === '127.0.0.1' || peerAddress === '::1';
  if (!loopbackPeer || typeof origin !== 'string' || typeof host !== 'string') return false;
  try {
    const parsed = new URL(origin);
    const requestOrigin = new URL(`http://${host}`).origin;
    return parsed.protocol === 'http:'
      && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname.toLowerCase())
      && parsed.origin === requestOrigin
      && (request.headers['sec-fetch-site'] === undefined
        || request.headers['sec-fetch-site'] === 'same-origin');
  } catch { return false; }
}

async function readJsonRequest(request) {
  const mediaType = String(request.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase();
  if (mediaType !== 'application/json') {
    const error = new Error('Console actions must use application/json');
    error.code = 'REQUEST_CONTENT_TYPE_INVALID';
    throw error;
  }
  const declaredSize = Number(request.headers['content-length'] ?? 0);
  if (Number.isFinite(declaredSize) && declaredSize > MAX_FEEDBACK_BYTES) {
    const error = new Error('Console action request is too large');
    error.code = 'REQUEST_TOO_LARGE';
    throw error;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_FEEDBACK_BYTES) {
      const error = new Error('Console action request is too large');
      error.code = 'REQUEST_TOO_LARGE';
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object');
    return value;
  } catch {
    const invalid = new Error('Console action request must contain a valid JSON object');
    invalid.code = 'REQUEST_JSON_INVALID';
    throw invalid;
  }
}

function withArtifactService({ repositoryRoot, env }, callback) {
  const controlPlane = openControlPlane({ repositoryRoot, env });
  try {
    const backlogService = new BacklogService({ repositoryRoot, controlPlane });
    const artifactService = new ArtifactService({ repositoryRoot, controlPlane, backlogService });
    return callback(artifactService);
  } finally { controlPlane.close(); }
}

function withOrganizationServices({ repositoryRoot, env, clock }, callback) {
  const controlPlane = openControlPlane({ repositoryRoot, env });
  try {
    return callback({
      fleet: new FleetEvolutionService({ repositoryRoot, controlPlane }),
      hierarchy: new HierarchyEvolutionService({ repositoryRoot, controlPlane, clock }),
    });
  } finally { controlPlane.close(); }
}

function organizationReviewPlan({ repositoryRoot, env, type, id, action, reason, clock }) {
  const currentHead = inspectRepository(repositoryRoot).head;
  return withOrganizationServices({ repositoryRoot, env, clock }, ({ fleet, hierarchy }) => {
    const config = loadProjectConfig(repositoryRoot);
    const graph = organizationGraphFromConfig(config);
    const owner = graph.roles.find((role) => role.kind === 'owner')?.identity_id;
    const activeGraphDigest = createHash('sha256').update(JSON.stringify(graph)).digest('hex');
    if (owner !== 'owner') {
      const error = new Error('The active organization does not identify the project owner as owner.');
      error.code = 'OWNER_AUTHORITY_REQUIRED';
      throw error;
    }
    if (type === 'hierarchy-conclusion') {
      const proposal = hierarchy.get(id);
      const conclusionPlan = hierarchy.planConclusion({ proposalId: id, decision: action, reason });
      return { type, id, action, reason, ownerIdentity: owner, title: proposal.proposal.title,
        currentState: proposal.state, currentHead, activeGraphRevision: graph.revision, activeGraphDigest,
        canProceed: conclusionPlan.canProceed, scope: conclusionPlan,
        conclusionPlanHash: conclusionPlan.planHash,
        confirmationLabel: action === 'adopt' ? 'Commit pilot adoption' : 'Commit pilot reversal',
        effect: action === 'adopt'
          ? 'Record owner adoption in one scoped local commit. The active graph is retained. No runtime or timer is started or stopped.'
          : 'Restore prior reporting relationships at a new graph revision in one scoped local commit. Identities, worktrees, implementation owners and active work are preserved. Schedules remain for explicit review. No runtime or timer is started or stopped.',
        mutationPerformed: false };
    }
    if (type === 'fleet') {
      const change = fleet.get(id);
      if (change.state !== 'proposed') {
        const error = new Error(`Fleet proposal ${change.id} is ${change.state}, not proposed.`);
        error.code = 'FLEET_CHANGE_STATE_CONFLICT';
        throw error;
      }
      if (!['approve', 'reject'].includes(action)) {
        const error = new Error('Fleet proposals support approve or reject review decisions.');
        error.code = 'FLEET_CHANGE_DECISION_INVALID';
        throw error;
      }
      if (action === 'reject' && !reason) {
        const error = new Error('Add a reason before rejecting a Fleet proposal.');
        error.code = 'FLEET_CHANGE_REASON_REQUIRED';
        throw error;
      }
      return {
        type, id: change.id, action, reason: reason || null, currentState: change.state,
        ownerIdentity: owner, baseCommit: change.baseCommit, currentHead,
        activeGraphRevision: graph.revision, activeGraphDigest,
        title: change.domain?.title ?? change.proposal?.title ?? change.id,
        summary: change.rationale ?? change.proposal?.rationale ?? '',
        scope: change.domain ?? change.proposal ?? null,
        expectedBenefit: change.expectedBenefit ?? null, evidence: change.evidence ?? [],
        effect: action === 'approve'
          ? 'Approves this Fleet change for a separate activation review. It does not edit the active roster, create a worktree, or start an agent.'
          : 'Rejects this Fleet change and records the supplied reason. The active Fleet is unchanged.',
        confirmationLabel: action === 'approve' ? 'Confirm approval for later activation review' : 'Confirm rejection',
        mutationPerformed: false,
      };
    }
    if (type !== 'hierarchy') {
      const error = new Error('Unsupported organization proposal type.');
      error.code = 'ORGANIZATION_PROPOSAL_TYPE_INVALID';
      throw error;
    }
    const proposal = hierarchy.get(id);
    if (proposal.state !== 'proposed') {
      const error = new Error(`Hierarchy proposal ${proposal.id} is ${proposal.state}, not proposed.`);
      error.code = 'HIERARCHY_PROPOSAL_STATE_CONFLICT';
      throw error;
    }
    if (!['approve-pilot', 'defer', 'reject'].includes(action)) {
      const error = new Error('Hierarchy proposals support approve-pilot, defer, or reject.');
      error.code = 'HIERARCHY_DECISION_INVALID';
      throw error;
    }
    if (action !== 'approve-pilot' && !reason) {
      const error = new Error('Add a reason before deferring or rejecting a hierarchy proposal.');
      error.code = 'HIERARCHY_DECISION_REASON_REQUIRED';
      throw error;
    }
    const details = proposal.proposal;
    const pilotPlan = hierarchy.planPilot(id);
    const activeRoles = new Set(graph.roles.map((role) => role.id));
    const proposedRoles = details.graph.roles.map((role) => role.id);
    const roleChanges = {
      added: proposedRoles.filter((roleId) => !activeRoles.has(roleId)),
      removed: [...activeRoles].filter((roleId) => !proposedRoles.includes(roleId)),
      totalProposedRoles: proposedRoles.length,
    };
    const effects = {
      'approve-pilot': 'Records owner approval for bounded pilot planning only. Activation remains a separate fresh-plan CLI action; it updates and commits the approved organization graph and derived manager schedules, but does not start/create an identity, launch a runtime, or change user systemd state.',
      defer: 'Defers this proposal without changing the active organization graph.',
      reject: 'Rejects this proposal and records the supplied reason. The active organization graph is unchanged.',
    };
    return {
      type, id: proposal.id, proposalRevision: proposal.revision, action, reason: reason || null, currentState: proposal.state,
      ownerIdentity: owner, baseCommit: proposal.baseCommit, currentHead,
      activeGraphRevision: graph.revision, activeGraphDigest,
      title: details.title, summary: details.rationale,
      impact: details.impact, observationWindow: details.observation_window,
      signals: details.signals, alternatives: details.alternatives,
      pilot: details.pilot, roleChanges,
      managerCheckInSchedules: pilotPlan.managerCheckInSchedules,
      timerReconciliation: {
        timerState: 'not-verified',
        requiredAfterScheduleConfigChange: pilotPlan.timerReconciliation.requiredAfterActivation,
        command: pilotPlan.timerReconciliation.commands,
        note: 'A proposed manager cadence is not an installed timer. If an exact-config launcher is installed, hierarchy activation requires the owner to reconcile it separately before its new schedule is trusted.',
      },
      effect: effects[action],
      confirmationLabel: action === 'approve-pilot' ? 'Confirm pilot-plan approval' : `Confirm ${action}`,
      mutationPerformed: false,
    };
  });
}

function hierarchyActivationPlan({ repositoryRoot, env, id }) {
  const currentHead = inspectRepository(repositoryRoot).head;
  return withOrganizationServices({ repositoryRoot, env }, ({ hierarchy }) => {
    const proposal = hierarchy.get(id);
    if (proposal.state !== 'pilot-approved') {
      const error = new Error(`Hierarchy proposal ${proposal.id} is ${proposal.state}, not pilot-approved.`);
      error.code = 'HIERARCHY_PROPOSAL_STATE_CONFLICT';
      throw error;
    }
    const graph = organizationGraphFromConfig(loadProjectConfig(repositoryRoot));
    const ownerIdentity = graph.roles.find((role) => role.kind === 'owner')?.identity_id;
    if (ownerIdentity !== 'owner' || proposal.decidedBy !== ownerIdentity) {
      const error = new Error('Only the project owner who approved this pilot can activate it.');
      error.code = 'HIERARCHY_OWNER_AUTHORITY_REQUIRED';
      throw error;
    }
    const pilotPlan = hierarchy.planPilot(id);
    return {
      type: 'hierarchy-activation', id: proposal.id, title: proposal.proposal.title,
      state: proposal.state, ownerIdentity, currentHead,
      pilotPlan,
      effect: 'This writes the approved organization graph and manager schedules, records the pilot, and creates one scoped local Git commit. It does not create or start identities, launch an AI runtime, or change user systemd state. If a timer is installed, reconcile it separately after activation.',
      confirmationLabel: 'Commit pilot activation',
      mutationPerformed: false,
    };
  });
}

function ownerRequestPlan({ repositoryRoot, env, recipient, body, taskId }) {
  const currentHead = inspectRepository(repositoryRoot).head;
  const controlPlane = openControlPlane({ repositoryRoot, env });
  try {
    const owner = controlPlane.assertOwnerActor('owner');
    const recipientId = controlPlane.assertIdentity(recipient);
    const identity = controlPlane.agents.get(recipientId);
    let task = null;
    if (taskId) {
      task = new BacklogService({ repositoryRoot, controlPlane }).list().find((candidate) => candidate.id === taskId) ?? null;
      if (!task || ['completed', 'cancelled'].includes(task.state)) {
        const error = new Error(`Owner request task ${taskId} is missing or no longer active.`);
        error.code = 'OWNER_REQUEST_TASK_NOT_FOUND';
        throw error;
      }
      task = { id: task.id, title: task.title, state: task.state, owner: task.owner ?? null };
    }
    const graph = organizationGraphFromConfig(loadProjectConfig(repositoryRoot));
    const activeGraphDigest = createHash('sha256').update(JSON.stringify(graph)).digest('hex');
    return {
      owner, recipient: recipientId, recipientTitle: identity?.title ?? recipientId,
      body, task, currentHead, activeGraphRevision: graph.revision, activeGraphDigest,
      effect: 'Stores one durable owner request in the selected identity inbox. It does not create or change a task, reassign ownership, wake or start a session, or expand the recipient’s authority.',
      mutationPerformed: false,
    };
  } finally { controlPlane.close(); }
}

function approvalDecisionPlan({ repositoryRoot, env, approvalId, decision, note }) {
  const controlPlane = openControlPlane({ repositoryRoot, env });
  try {
    controlPlane.assertOwnerActor('owner');
    if (!['approved', 'rejected'].includes(decision)) {
      const error = new Error('Choose approve or reject for this request.');
      error.code = 'INVALID_APPROVAL_DECISION';
      throw error;
    }
    const normalizedNote = typeof note === 'string' ? note.trim() : '';
    if (normalizedNote.length > 2000) {
      const error = new Error('Decision note is limited to 2,000 characters.');
      error.code = 'APPROVAL_NOTE_TOO_LONG';
      throw error;
    }
    const approval = controlPlane.listApprovals({ actorId: 'owner' })
      .find((candidate) => candidate.id === approvalId);
    if (!approval) {
      const error = new Error(`Pending approval request not found: ${approvalId}`);
      error.code = 'APPROVAL_NOT_FOUND';
      throw error;
    }
    if (approval.approver !== 'owner') {
      const error = new Error(`Only the named approver (${approval.approver}) may decide this request.`);
      error.code = 'APPROVER_AUTHORITY_REQUIRED';
      throw error;
    }
    if (approval.status !== 'pending') {
      const error = new Error(`Approval request ${approvalId} is already ${approval.status}.`);
      error.code = 'APPROVAL_NOT_PENDING';
      throw error;
    }
    return {
      approvalId: approval.id, requester: approval.requester, approver: approval.approver,
      revision: approval.revision, title: approval.title, summary: approval.summary,
      task: approval.task, evidence: approval.evidence, decision,
      note: normalizedNote || null,
      effect: `Record this ${decision} decision against approval revision ${approval.revision}, audit it, and notify ${approval.requester}. This does not change task status, assignment, or agent state.`,
      mutationPerformed: false,
    };
  } finally { controlPlane.close(); }
}

function normalizeRuntimeProfileRequest(input) {
  const areaId = typeof input.areaId === 'string' ? input.areaId.trim() : '';
  const runtime = typeof input.runtime === 'string' ? input.runtime.trim() : '';
  const model = typeof input.model === 'string' ? input.model.trim() : '';
  const reasoning = typeof input.reasoning === 'string' ? input.reasoning.trim() : '';
  if (!areaId || !runtime || !/^[a-z][a-z0-9-]*$/.test(runtime)) {
    const error = new Error('Choose a Fleet identity and an available runtime.');
    error.code = 'RUNTIME_PROFILE_INPUT_INVALID';
    throw error;
  }
  if (areaId.length > 120 || model.length > 180 || reasoning.length > 40) {
    const error = new Error('Profile fields exceed their allowed length.');
    error.code = 'RUNTIME_PROFILE_INPUT_INVALID';
    throw error;
  }
  return { areaId, runtime, model, reasoning };
}

function runProfileCli({ repositoryRoot, env, args }) {
  const result = spawnSync(process.execPath, [TORCH_CLI, ...args, '--json'], {
    cwd: repositoryRoot, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000, maxBuffer: 1024 * 1024,
  });
  let output;
  try { output = JSON.parse(result.stdout ?? ''); } catch {
    const error = new Error(result.error?.message ?? result.stderr?.trim() ?? 'Profile command returned invalid output.');
    error.code = 'RUNTIME_PROFILE_COMMAND_FAILED';
    throw error;
  }
  if (result.status !== 0) {
    const error = new Error(output.message ?? result.stderr?.trim() ?? 'Runtime profile change was refused.');
    error.code = output.error ?? 'RUNTIME_PROFILE_COMMAND_FAILED';
    throw error;
  }
  return output;
}

function runtimeProfileCliArgs(request, { dryRun = false, yes = false, configSha256 } = {}) {
  const args = ['profile', 'set', '--area', request.areaId, '--runtime', request.runtime];
  if (request.model) args.push('--model', request.model);
  else args.push('--inherit-model');
  if (request.reasoning) args.push('--reasoning', request.reasoning);
  else args.push('--reasoning', 'none');
  if (request.resetLaunchPolicy) args.push('--reset-launch-policy');
  if (dryRun) args.push('--dry-run');
  if (yes) args.push('--yes');
  if (configSha256) args.push('--expect-config-sha256', configSha256);
  return args;
}

function runtimeProfilePlan({ repositoryRoot, env, input }) {
  const request = normalizeRuntimeProfileRequest(input);
  const controlPlane = openControlPlane({ repositoryRoot, env });
  try { controlPlane.assertOwnerActor('owner'); } finally { controlPlane.close(); }
  const current = runProfileCli({
    repositoryRoot, env, args: ['profile', 'show', '--area', request.areaId],
  });
  request.resetLaunchPolicy = current.runtime !== request.runtime;
  const plan = runProfileCli({
    repositoryRoot, env, args: runtimeProfileCliArgs(request, { dryRun: true }),
  });
  return {
    ...plan, areaId: request.areaId, currentHead: inspectRepository(repositoryRoot).head,
    resetLaunchPolicy: request.resetLaunchPolicy,
    currentConfigSha256: fileHash(resolve(repositoryRoot, '.torch', 'torch.yaml')),
    mutationPerformed: false,
  };
}

function scheduleLauncherPlan({ repositoryRoot, env, action, executor }) {
  if (!['install', 'reconcile'].includes(action)) {
    const error = new Error('Choose whether to install or refresh the TORCH schedule timer.');
    error.code = 'SCHEDULE_LAUNCHER_ACTION_INVALID';
    throw error;
  }
  const controlPlane = openControlPlane({ repositoryRoot, env });
  try { controlPlane.assertOwnerActor('owner'); } finally { controlPlane.close(); }
  const launcher = new ScheduleLauncherService({ repositoryRoot, env, executor });
  const fullPlan = action === 'install' ? launcher.plan() : launcher.planReconcile();
  const config = loadProjectConfig(repositoryRoot);
  const status = launcher.status();
  const systemSchedules = config.schedules.filter((schedule) => schedule.lifetime === 'system').map((schedule) => ({
    id: schedule.id, title: schedule.title, owner: schedule.owner, trigger: schedule.trigger,
    behavior: schedule.behavior, action: schedule.action,
  }));
  const files = (fullPlan.files ?? []).map((file) => ({
    name: file.name, path: file.path,
    sha256: createHash('sha256').update(file.content).digest('hex'),
  }));
  return {
    action, projectId: fullPlan.projectId, digest: fullPlan.digest,
    currentHead: inspectRepository(repositoryRoot).head,
    canProceed: fullPlan.canProceed, blockers: fullPlan.blockers,
    timerName: fullPlan.timerName, serviceName: fullPlan.serviceName,
    files, updates: fullPlan.updates ?? [], stale: fullPlan.stale ?? false,
    installed: status.installed, installedStale: status.stale,
    installedUnits: status.units.map(({ name, path, exists, configDigest }) => ({ name, path, exists, configDigest })),
    systemSchedules,
    runtimeWakeBudget: config.runtime_wake_budget ?? null,
    effect: action === 'install'
      ? 'Writes the two reviewed user-systemd unit files and ownership manifest, reloads the user systemd manager, then enables and starts the timer. Due system schedules may run; a manager runtime wakes only when its schedule explicitly enables wake and the daily invocation budget allows it.'
      : 'Refreshes only unchanged TORCH-owned unit files, updates the ownership manifest, reloads the user systemd manager, and enables/starts the timer. Due system schedules may run; a manager runtime wakes only when its schedule explicitly enables wake and the daily invocation budget allows it.',
    mutationPerformed: false,
  };
}

function publicScheduleLauncherResult(result) {
  return {
    action: result.action, projectId: result.projectId, digest: result.digest,
    timerName: result.timerName, serviceName: result.serviceName,
    files: (result.files ?? []).map(({ name, path, sha256 }) => ({ name, path, sha256 })),
    systemSchedules: result.systemSchedules, effect: result.effect,
    mutationPerformed: result.mutationPerformed, changed: result.changed ?? null,
    requiresCommit: result.requiresCommit ?? [],
  };
}

function respond(response, status, body, type = 'application/json; charset=utf-8') {
  response.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  });
  response.end(body);
}

export function createConsoleServer({ repositoryRoot = process.cwd(), env = process.env, scheduleLauncherExecutor, clock } = {}) {
  const feedbackPreviews = new Map();
  const priorityPreviews = new Map();
  const taskCreatePreviews = new Map();
  const organizationPreviews = new Map();
  const hierarchyActivationPreviews = new Map();
  const ownerRequestPreviews = new Map();
  const approvalDecisionPreviews = new Map();
  const runtimeProfilePreviews = new Map();
  const scheduleLauncherPreviews = new Map();
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://torch.local');
    if (['/api/schedule-launcher/preview', '/api/schedule-launcher'].includes(url.pathname)) {
      if (request.method !== 'POST') {
        respond(response, 405, JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }));
        return;
      }
      if (!sameOriginLoopback(request)) {
        respond(response, 403, JSON.stringify({ error: 'SAME_ORIGIN_REQUIRED' }));
        return;
      }
      let input;
      try { input = await readJsonRequest(request); } catch (error) {
        const status = error.code === 'REQUEST_TOO_LARGE' ? 413
          : error.code === 'REQUEST_CONTENT_TYPE_INVALID' ? 415 : 400;
        respond(response, status, JSON.stringify({ error: error.code, message: error.message }));
        return;
      }
      try {
        const action = input.action;
        if (url.pathname.endsWith('/preview')) {
          const plan = scheduleLauncherPlan({
            repositoryRoot, env, action, executor: scheduleLauncherExecutor,
          });
          const planHash = priorityPlanHash(plan);
          const now = Date.now();
          for (const [previewToken, record] of scheduleLauncherPreviews) {
            if (record.expiresAt <= now) scheduleLauncherPreviews.delete(previewToken);
          }
          while (scheduleLauncherPreviews.size >= MAX_FEEDBACK_PREVIEWS) {
            scheduleLauncherPreviews.delete(scheduleLauncherPreviews.keys().next().value);
          }
          const token = randomUUID();
          const expiresAt = new Date(now + SCHEDULE_LAUNCHER_PREVIEW_TTL_MS).toISOString();
          scheduleLauncherPreviews.set(token, {
            action, planHash, digest: plan.digest, expiresAt: Date.parse(expiresAt),
            consumed: false, result: null,
          });
          respond(response, 200, `${JSON.stringify({ plan, planHash, token, expiresAt })}\n`);
          return;
        }

        const token = typeof input.token === 'string' ? input.token : '';
        const preview = scheduleLauncherPreviews.get(token);
        if (!preview || preview.expiresAt <= Date.now()) {
          respond(response, 409, JSON.stringify({ error: 'SCHEDULE_LAUNCHER_PREVIEW_EXPIRED', message: 'Review the timer setup again before applying it.' }));
          return;
        }
        if (preview.consumed) {
          if (preview.result && input.planHash === preview.planHash && action === preview.action) {
            respond(response, 200, `${JSON.stringify(preview.result)}\n`);
          } else {
            respond(response, 409, JSON.stringify({ error: 'SCHEDULE_LAUNCHER_PREVIEW_EXPIRED', message: 'This timer review has already been used. Review it again.' }));
          }
          return;
        }
        if (action !== preview.action || input.planHash !== preview.planHash) {
          respond(response, 409, JSON.stringify({ error: 'SCHEDULE_LAUNCHER_PREVIEW_STALE', message: 'The requested timer action differs from the reviewed action. Review it again.' }));
          return;
        }
        const current = scheduleLauncherPlan({
          repositoryRoot, env, action, executor: scheduleLauncherExecutor,
        });
        if (priorityPlanHash(current) !== preview.planHash) {
          respond(response, 409, JSON.stringify({ error: 'SCHEDULE_LAUNCHER_PREVIEW_STALE', message: 'Project schedules or owned unit files changed after review. Review the new plan.' }));
          return;
        }
        if (!current.canProceed) {
          respond(response, 409, JSON.stringify({ error: 'SCHEDULE_LAUNCHER_BLOCKED', message: 'The timer action is blocked by current ownership or configuration checks.', blockers: current.blockers }));
          return;
        }
        const launcher = new ScheduleLauncherService({
          repositoryRoot, env, executor: scheduleLauncherExecutor,
        });
        const rawResult = action === 'install'
          ? launcher.install({ expectedDigest: preview.digest })
          : launcher.reconcile({ expectedDigest: preview.digest });
        const controlPlane = openControlPlane({ repositoryRoot, env });
        let audit;
        try {
          audit = controlPlane.auditOwnerAction({
            actorId: 'owner', operation: `schedule.launcher.${action}`,
            entityType: 'system-schedule-launcher', entityId: rawResult.projectId,
            details: {
              digest: rawResult.digest, timerName: rawResult.timerName,
              systemSchedules: current.systemSchedules.map((schedule) => schedule.id),
              files: (rawResult.files ?? []).map(({ name, path }) => ({ name, path })),
              mutationPerformed: rawResult.mutationPerformed, changed: rawResult.changed ?? null,
            },
          });
        } finally { controlPlane.close(); }
        preview.consumed = true;
        preview.result = {
          ...publicScheduleLauncherResult({
            ...rawResult, action, files: current.files,
            systemSchedules: current.systemSchedules, effect: current.effect,
          }), auditEventId: audit.id,
        };
        respond(response, 200, `${JSON.stringify(preview.result)}\n`);
      } catch (error) {
        const status = error.code === 'OWNER_AUTHORITY_REQUIRED' ? 403
          : ['SCHEDULE_LAUNCHER_PLAN_STALE', 'SCHEDULE_LAUNCHER_BLOCKED',
            'SCHEDULE_LAUNCHER_RECONCILE_BLOCKED', 'SCHEDULE_LAUNCHER_SYSTEMD_FAILED'].includes(error.code) ? 409 : 400;
        respond(response, status, `${JSON.stringify({ error: error.code ?? 'SCHEDULE_LAUNCHER_FAILED', message: error.message, details: error.details ?? null })}\n`);
      }
      return;
    }
    if (['/api/runtime-profiles/preview', '/api/runtime-profiles'].includes(url.pathname)) {
      if (request.method !== 'POST') {
        respond(response, 405, JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }));
        return;
      }
      if (!sameOriginLoopback(request)) {
        respond(response, 403, JSON.stringify({ error: 'SAME_ORIGIN_REQUIRED' }));
        return;
      }
      let input;
      try { input = await readJsonRequest(request); } catch (error) {
        const status = error.code === 'REQUEST_TOO_LARGE' ? 413
          : error.code === 'REQUEST_CONTENT_TYPE_INVALID' ? 415 : 400;
        respond(response, status, JSON.stringify({ error: error.code, message: error.message }));
        return;
      }
      let normalized;
      try { normalized = normalizeRuntimeProfileRequest(input); } catch (error) {
        respond(response, 400, JSON.stringify({ error: error.code, message: error.message }));
        return;
      }
      if (url.pathname.endsWith('/preview')) {
        try {
          const plan = runtimeProfilePlan({ repositoryRoot, env, input: normalized });
          const planHash = priorityPlanHash(plan);
          const now = Date.now();
          for (const [previewToken, record] of runtimeProfilePreviews) {
            if (record.expiresAt <= now) runtimeProfilePreviews.delete(previewToken);
          }
          while (runtimeProfilePreviews.size >= MAX_FEEDBACK_PREVIEWS) {
            runtimeProfilePreviews.delete(runtimeProfilePreviews.keys().next().value);
          }
          const token = randomUUID();
          const expiresAt = new Date(now + RUNTIME_PROFILE_PREVIEW_TTL_MS).toISOString();
          runtimeProfilePreviews.set(token, {
            input: normalized, planHash, expiresAt: Date.parse(expiresAt), consumed: false, result: null,
          });
          respond(response, 200, `${JSON.stringify({ plan, planHash, token, expiresAt })}\n`);
        } catch (error) {
          const status = error.code === 'OWNER_AUTHORITY_REQUIRED' ? 403 : 400;
          respond(response, status, `${JSON.stringify({ error: error.code ?? 'RUNTIME_PROFILE_PLAN_FAILED', message: error.message })}\n`);
        }
        return;
      }

      const token = typeof input.token === 'string' ? input.token : '';
      const preview = runtimeProfilePreviews.get(token);
      if (!preview || preview.expiresAt <= Date.now()) {
        respond(response, 409, JSON.stringify({ error: 'RUNTIME_PROFILE_PREVIEW_EXPIRED', message: 'Review a fresh identity profile before changing it.' }));
        return;
      }
      if (preview.consumed) {
        if (preview.result && input.planHash === preview.planHash) {
          respond(response, 200, `${JSON.stringify(preview.result)}\n`);
        } else {
          respond(response, 409, JSON.stringify({ error: 'RUNTIME_PROFILE_PREVIEW_EXPIRED', message: 'This profile review has already been used. Review the change again.' }));
        }
        return;
      }
      if (JSON.stringify(normalized) !== JSON.stringify(preview.input)
        || input.planHash !== preview.planHash) {
        respond(response, 409, JSON.stringify({ error: 'RUNTIME_PROFILE_PREVIEW_STALE', message: 'The requested profile differs from the reviewed change. Review it again.' }));
        return;
      }
      try {
        const currentPlan = runtimeProfilePlan({ repositoryRoot, env, input: normalized });
        if (priorityPlanHash(currentPlan) !== preview.planHash) {
          respond(response, 409, JSON.stringify({ error: 'RUNTIME_PROFILE_PREVIEW_STALE', message: 'The project, identity profile, or runtime configuration changed after preview. Review the new state.' }));
          return;
        }
        preview.consumed = true;
        const profileInput = { ...normalized, resetLaunchPolicy: currentPlan.resetLaunchPolicy };
        const result = runProfileCli({
          repositoryRoot, env,
          args: runtimeProfileCliArgs(profileInput, {
            yes: true, configSha256: currentPlan.currentConfigSha256,
          }),
        });
        preview.result = result;
        respond(response, 200, `${JSON.stringify(result)}\n`);
      } catch (error) {
        const status = error.code === 'OWNER_AUTHORITY_REQUIRED' ? 403
          : error.code === 'RUNTIME_PROFILE_REVIEW_STALE' ? 409 : 400;
        respond(response, status, `${JSON.stringify({ error: error.code ?? 'RUNTIME_PROFILE_CHANGE_FAILED', message: error.message })}\n`);
      }
      return;
    }
    if (['/api/backlog/tasks', '/api/backlog/tasks/preview'].includes(url.pathname)) {
      if (request.method !== 'POST') {
        respond(response, 405, JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }));
        return;
      }
      if (!sameOriginLoopback(request)) {
        respond(response, 403, JSON.stringify({ error: 'SAME_ORIGIN_REQUIRED' }));
        return;
      }
      let input;
      try { input = await readJsonRequest(request); } catch (error) {
        const status = error.code === 'REQUEST_TOO_LARGE' ? 413
          : error.code === 'REQUEST_CONTENT_TYPE_INVALID' ? 415 : 400;
        respond(response, status, JSON.stringify({ error: error.code, message: error.message }));
        return;
      }
      try {
        const withBacklog = (callback) => {
          const controlPlane = openControlPlane({ repositoryRoot, env });
          try {
            const service = new BacklogService({ repositoryRoot, controlPlane });
            return callback(service);
          } finally { controlPlane.close(); }
        };
        const taskInput = { ...input, actorId: 'owner' };
        if (url.pathname.endsWith('/preview')) {
          const plan = withBacklog((service) => service.planOwnerCreate(taskInput));
          const planHash = priorityPlanHash(plan);
          const now = Date.now();
          for (const [token, record] of taskCreatePreviews) {
            if (record.expiresAt <= now) taskCreatePreviews.delete(token);
          }
          while (taskCreatePreviews.size >= MAX_FEEDBACK_PREVIEWS) {
            taskCreatePreviews.delete(taskCreatePreviews.keys().next().value);
          }
          const token = randomUUID();
          const expiresAt = new Date(now + FEEDBACK_PREVIEW_TTL_MS).toISOString();
          taskCreatePreviews.set(token, { planHash, expiresAt: Date.parse(expiresAt), consumed: false, result: null });
          respond(response, 200, `${JSON.stringify({ plan, planHash, token, expiresAt })}\n`);
          return;
        }

        const token = typeof input.token === 'string' ? input.token : '';
        const approvedPreview = taskCreatePreviews.get(token);
        if (!approvedPreview || approvedPreview.expiresAt <= Date.now()) {
          respond(response, 409, JSON.stringify({ error: 'TASK_CREATE_PREVIEW_EXPIRED', message: 'Review a fresh task preview before creating work.' }));
          return;
        }
        if (approvedPreview.consumed) {
          if (approvedPreview.result && input.planHash === approvedPreview.planHash) {
            respond(response, 201, `${JSON.stringify(approvedPreview.result)}\n`);
          } else {
            respond(response, 409, JSON.stringify({ error: 'TASK_CREATE_PREVIEW_EXPIRED', message: 'This task preview has already been used. Review a fresh proposal.' }));
          }
          return;
        }
        approvedPreview.consumed = true;
        const result = withBacklog((service) => {
          const current = service.planOwnerCreate(taskInput);
          const planHash = priorityPlanHash(current);
          if (planHash !== approvedPreview.planHash || planHash !== input.planHash) return { stale: true };
          return { task: service.createOwner(taskInput), mutationPerformed: true };
        });
        if (result.stale) {
          respond(response, 409, JSON.stringify({ error: 'TASK_CREATE_PREVIEW_STALE', message: 'Task proposal inputs or repository evidence changed. Review a fresh preview.' }));
          return;
        }
        approvedPreview.result = result;
        respond(response, 201, `${JSON.stringify(result)}\n`);
      } catch (error) {
        const status = ['OWNER_AUTHORITY_REQUIRED', 'BACKLOG_AUTHORITY_REQUIRED'].includes(error.code) ? 403
          : ['BACKLOG_WORKTREE_MISSING', 'BACKLOG_TASK_NOT_FOUND'].includes(error.code) ? 409 : 400;
        respond(response, status, `${JSON.stringify({ error: error.code ?? 'TASK_CREATE_FAILED', message: error.message })}\n`);
      }
      return;
    }
    if (['/api/owner-requests', '/api/owner-requests/preview'].includes(url.pathname)) {
      if (request.method !== 'POST') {
        respond(response, 405, JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }));
        return;
      }
      if (!sameOriginLoopback(request)) {
        respond(response, 403, JSON.stringify({ error: 'SAME_ORIGIN_REQUIRED' }));
        return;
      }
      let input;
      try { input = await readJsonRequest(request); } catch (error) {
        const status = error.code === 'REQUEST_TOO_LARGE' ? 413
          : error.code === 'REQUEST_CONTENT_TYPE_INVALID' ? 415 : 400;
        respond(response, status, JSON.stringify({ error: error.code, message: error.message }));
        return;
      }
      const recipient = typeof input.recipient === 'string' ? input.recipient.trim() : '';
      const body = typeof input.body === 'string' ? input.body.trim() : '';
      const taskId = typeof input.taskId === 'string' ? input.taskId.trim() : '';
      if (!recipient || !body) {
        respond(response, 400, JSON.stringify({ error: 'OWNER_REQUEST_INPUT_REQUIRED', message: 'Choose an active identity and write a request.' }));
        return;
      }
      if (body.length > 4000) {
        respond(response, 400, JSON.stringify({ error: 'OWNER_REQUEST_TOO_LONG', message: 'Keep the request under 4,000 characters.' }));
        return;
      }
      try {
        const plan = ownerRequestPlan({ repositoryRoot, env, recipient, body, taskId: taskId || null });
        if (url.pathname.endsWith('/preview')) {
          const planHash = priorityPlanHash(plan);
          const now = Date.now();
          for (const [token, record] of ownerRequestPreviews) {
            if (record.expiresAt <= now) ownerRequestPreviews.delete(token);
          }
          while (ownerRequestPreviews.size >= MAX_FEEDBACK_PREVIEWS) {
            ownerRequestPreviews.delete(ownerRequestPreviews.keys().next().value);
          }
          const token = randomUUID();
          const expiresAt = new Date(now + OWNER_REQUEST_PREVIEW_TTL_MS).toISOString();
          ownerRequestPreviews.set(token, { planHash, expiresAt: Date.parse(expiresAt), consumed: false, result: null });
          respond(response, 200, `${JSON.stringify({ plan, planHash, token, expiresAt })}\n`);
          return;
        }

        const token = typeof input.token === 'string' ? input.token : '';
        const preview = ownerRequestPreviews.get(token);
        if (!preview || preview.expiresAt <= Date.now()) {
          respond(response, 409, JSON.stringify({ error: 'OWNER_REQUEST_PREVIEW_EXPIRED', message: 'Review the recipient and exact request before sending.' }));
          return;
        }
        if (preview.consumed) {
          if (preview.result && input.planHash === preview.planHash) {
            respond(response, 201, `${JSON.stringify(preview.result)}\n`);
          } else {
            respond(response, 409, JSON.stringify({ error: 'OWNER_REQUEST_PREVIEW_EXPIRED', message: 'This request preview has already been used. Review a fresh request.' }));
          }
          return;
        }
        const currentPlanHash = priorityPlanHash(plan);
        if (currentPlanHash !== preview.planHash || currentPlanHash !== input.planHash) {
          respond(response, 409, JSON.stringify({ error: 'OWNER_REQUEST_PREVIEW_STALE', message: 'The request, recipient, task, active organization, or repository changed after preview. Review it again.' }));
          return;
        }
        preview.consumed = true;
        const controlPlane = openControlPlane({ repositoryRoot, env });
        let message;
        try {
          message = controlPlane.sendOwnerRequest({
            actorId: plan.owner, recipient, body,
            references: { task: taskId || null },
          });
        } finally { controlPlane.close(); }
        const result = { message, mutationPerformed: true, effect: plan.effect };
        preview.result = result;
        respond(response, 201, `${JSON.stringify(result)}\n`);
      } catch (error) {
        const status = error.code === 'OWNER_AUTHORITY_REQUIRED' ? 403
          : error.code?.includes('NOT_FOUND') ? 404
            : error.code?.includes('STATE_CONFLICT') ? 409 : 400;
        respond(response, status, `${JSON.stringify({ error: error.code ?? 'OWNER_REQUEST_FAILED', message: error.message })}\n`);
      }
      return;
    }
    const hierarchyActivation = url.pathname.match(/^\/api\/organization-proposals\/hierarchy\/([A-Za-z0-9._-]+)\/activate(\/preview)?$/);
    if (hierarchyActivation) {
      if (request.method !== 'POST') {
        respond(response, 405, JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }));
        return;
      }
      if (!sameOriginLoopback(request)) {
        respond(response, 403, JSON.stringify({ error: 'SAME_ORIGIN_REQUIRED' }));
        return;
      }
      let input;
      try { input = await readJsonRequest(request); } catch (error) {
        const status = error.code === 'REQUEST_TOO_LARGE' ? 413
          : error.code === 'REQUEST_CONTENT_TYPE_INVALID' ? 415 : 400;
        respond(response, status, JSON.stringify({ error: error.code, message: error.message }));
        return;
      }
      const [, id, previewPath] = hierarchyActivation;
      try {
        if (previewPath) {
          const plan = hierarchyActivationPlan({ repositoryRoot, env, id });
          const planHash = priorityPlanHash(plan);
          let token = null;
          let expiresAt = null;
          if (plan.pilotPlan.canProceed) {
            const now = Date.now();
            for (const [candidate, record] of hierarchyActivationPreviews) {
              if (record.expiresAt <= now) hierarchyActivationPreviews.delete(candidate);
            }
            while (hierarchyActivationPreviews.size >= MAX_FEEDBACK_PREVIEWS) {
              hierarchyActivationPreviews.delete(hierarchyActivationPreviews.keys().next().value);
            }
            token = randomUUID();
            expiresAt = new Date(now + HIERARCHY_ACTIVATION_PREVIEW_TTL_MS).toISOString();
            hierarchyActivationPreviews.set(token, {
              id, planHash, expiresAt: Date.parse(expiresAt), consumed: false, result: null,
            });
          }
          respond(response, 200, `${JSON.stringify({ plan, planHash, token, expiresAt })}\n`);
          return;
        }

        const token = typeof input.token === 'string' ? input.token : '';
        const preview = hierarchyActivationPreviews.get(token);
        if (!preview || preview.id !== id || preview.expiresAt <= Date.now()) {
          respond(response, 409, JSON.stringify({ error: 'HIERARCHY_ACTIVATION_PREVIEW_EXPIRED', message: 'Review a fresh, owner-approved pilot plan before activating it.' }));
          return;
        }
        if (preview.consumed) {
          if (preview.result && input.planHash === preview.planHash) {
            respond(response, 200, `${JSON.stringify(preview.result)}\n`);
          } else {
            respond(response, 409, JSON.stringify({ error: 'HIERARCHY_ACTIVATION_PREVIEW_EXPIRED', message: 'This activation review has already been used. Preview the current pilot again.' }));
          }
          return;
        }
        const plan = hierarchyActivationPlan({ repositoryRoot, env, id });
        const planHash = priorityPlanHash(plan);
        if (!plan.pilotPlan.canProceed || planHash !== preview.planHash || planHash !== input.planHash) {
          respond(response, 409, JSON.stringify({ error: 'HIERARCHY_ACTIVATION_PREVIEW_STALE', message: 'The pilot, active organization, repository, or work state changed after preview. Review a fresh plan.' }));
          return;
        }
        preview.consumed = true;
        const result = withOrganizationServices({ repositoryRoot, env }, ({ hierarchy }) => ({
          proposal: hierarchy.activatePilot({ proposalId: id, activatedBy: plan.ownerIdentity }),
          plan, mutationPerformed: true,
        }));
        preview.result = result;
        respond(response, 200, `${JSON.stringify(result)}\n`);
      } catch (error) {
        const status = ['HIERARCHY_OWNER_AUTHORITY_REQUIRED'].includes(error.code) ? 403
          : ['HIERARCHY_PILOT_BLOCKED', 'HIERARCHY_PROPOSAL_STATE_CONFLICT', 'HIERARCHY_ACTIVATION_COMMIT_FAILED'].includes(error.code) ? 409
            : error.code?.includes('NOT_FOUND') ? 404 : 400;
        respond(response, status, `${JSON.stringify({ error: error.code ?? 'HIERARCHY_ACTIVATION_FAILED', message: error.message, details: error.details ?? null })}\n`);
      }
      return;
    }
    const organizationReview = url.pathname.match(/^\/api\/organization-proposals\/(fleet|hierarchy|hierarchy-conclusion)\/([A-Za-z0-9._-]+)(\/preview)?$/);
    if (organizationReview) {
      if (request.method !== 'POST') {
        respond(response, 405, JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }));
        return;
      }
      if (!sameOriginLoopback(request)) {
        respond(response, 403, JSON.stringify({ error: 'SAME_ORIGIN_REQUIRED' }));
        return;
      }
      let input;
      try { input = await readJsonRequest(request); } catch (error) {
        const status = error.code === 'REQUEST_TOO_LARGE' ? 413
          : error.code === 'REQUEST_CONTENT_TYPE_INVALID' ? 415 : 400;
        respond(response, status, JSON.stringify({ error: error.code, message: error.message }));
        return;
      }
      const [, type, id, previewPath] = organizationReview;
      const action = typeof input.action === 'string' ? input.action : '';
      const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
      if (reason.length > 2000) {
        respond(response, 400, JSON.stringify({ error: 'ORGANIZATION_REVIEW_REASON_TOO_LONG', message: 'Keep the decision reason under 2,000 characters.' }));
        return;
      }
      try {
        if (previewPath) {
          const plan = organizationReviewPlan({ repositoryRoot, env, type, id, action, reason, clock });
          const planHash = priorityPlanHash(plan);
          if (plan.canProceed === false) {
            respond(response, 200, `${JSON.stringify({ plan, planHash, token: null, expiresAt: null })}\n`);
            return;
          }
          const now = Date.now();
          for (const [token, record] of organizationPreviews) {
            if (record.expiresAt <= now) organizationPreviews.delete(token);
          }
          while (organizationPreviews.size >= MAX_FEEDBACK_PREVIEWS) {
            organizationPreviews.delete(organizationPreviews.keys().next().value);
          }
          const token = randomUUID();
          const expiresAt = new Date(now + ORGANIZATION_REVIEW_PREVIEW_TTL_MS).toISOString();
          organizationPreviews.set(token, { type, id, action, reason, planHash, expiresAt: Date.parse(expiresAt), consumed: false, result: null });
          respond(response, 200, `${JSON.stringify({ plan, planHash, token, expiresAt })}\n`);
          return;
        }

        const token = typeof input.token === 'string' ? input.token : '';
        const preview = organizationPreviews.get(token);
        if (!preview || preview.expiresAt <= Date.now()) {
          respond(response, 409, JSON.stringify({ error: 'ORGANIZATION_REVIEW_PREVIEW_EXPIRED', message: 'Review a fresh organization proposal before deciding.' }));
          return;
        }
        if (preview.type !== type || preview.id !== id || preview.action !== action || preview.reason !== reason) {
          respond(response, 409, JSON.stringify({ error: 'ORGANIZATION_REVIEW_PREVIEW_STALE', message: 'The target, operation or decision differs from the reviewed plan. Preview the exact decision again.' }));
          return;
        }
        if (preview.consumed) {
          if (preview.result && input.planHash === preview.planHash) {
            respond(response, 200, `${JSON.stringify(preview.result)}\n`);
          } else {
            respond(response, 409, JSON.stringify({ error: 'ORGANIZATION_REVIEW_PREVIEW_EXPIRED', message: 'This review has already been used. Preview the current proposal again.' }));
          }
          return;
        }
        const plan = organizationReviewPlan({ repositoryRoot, env, type, id, action, reason, clock });
        const planHash = priorityPlanHash(plan);
        if (plan.canProceed === false || planHash !== preview.planHash || planHash !== input.planHash) {
          respond(response, 409, JSON.stringify({ error: 'ORGANIZATION_REVIEW_PREVIEW_STALE', message: 'The proposal, active organization, or repository changed after preview. Review a fresh plan.' }));
          return;
        }
        preview.consumed = true;
        const result = withOrganizationServices({ repositoryRoot, env, clock }, ({ fleet, hierarchy }) => {
          const decided = type === 'fleet'
            ? action === 'approve'
              ? fleet.approve({ changeId: id, approvedBy: plan.ownerIdentity })
              : fleet.reject({ changeId: id, rejectedBy: plan.ownerIdentity, reason })
            : type === 'hierarchy-conclusion'
              ? hierarchy.concludePilot({ proposalId: id, decision: action, reason, decidedBy: plan.ownerIdentity,
                approved: true, planHash: plan.conclusionPlanHash })
              : hierarchy.decide({ proposalId: id, decision: action, decidedBy: plan.ownerIdentity, reason });
          return { type, decision: action, proposal: decided, plan, mutationPerformed: true };
        });
        preview.result = result;
        respond(response, 200, `${JSON.stringify(result)}\n`);
      } catch (error) {
        const status = error.code?.includes('AUTHORITY_REQUIRED') ? 403
          : error.code?.includes('NOT_FOUND') ? 404
            : error.code?.includes('STATE_CONFLICT') || error.code?.includes('CONCLUSION_') ? 409 : 400;
        respond(response, status, `${JSON.stringify({ error: error.code ?? 'ORGANIZATION_REVIEW_FAILED', message: error.message })}\n`);
      }
      return;
    }
    const priority = url.pathname.match(/^\/api\/backlog\/tasks\/(TASK-[A-Za-z0-9-]+)\/priority(\/preview)?$/);
    if (priority) {
      if (request.method !== 'POST') {
        respond(response, 405, JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }));
        return;
      }
      if (!sameOriginLoopback(request)) {
        respond(response, 403, JSON.stringify({ error: 'SAME_ORIGIN_REQUIRED' }));
        return;
      }
      let input;
      try { input = await readJsonRequest(request); } catch (error) {
        const status = error.code === 'REQUEST_TOO_LARGE' ? 413
          : error.code === 'REQUEST_CONTENT_TYPE_INVALID' ? 415 : 400;
        respond(response, status, JSON.stringify({ error: error.code, message: error.message }));
        return;
      }
      try {
        const withBacklog = (callback) => {
          const controlPlane = openControlPlane({ repositoryRoot, env });
          try {
            const service = new BacklogService({ repositoryRoot, controlPlane });
            return callback(service);
          } finally { controlPlane.close(); }
        };
        const taskId = priority[1];
        if (priority[2]) {
          const plan = withBacklog((service) => service.planPriorityChange({
            taskId, actorId: 'owner', expectedRevision: input.expectedRevision,
            priority: input.priority, reason: input.reason,
          }));
          const planHash = priorityPlanHash(plan);
          const now = Date.now();
          for (const [token, record] of priorityPreviews) {
            if (record.expiresAt <= now) priorityPreviews.delete(token);
          }
          while (priorityPreviews.size >= MAX_FEEDBACK_PREVIEWS) {
            priorityPreviews.delete(priorityPreviews.keys().next().value);
          }
          const token = randomUUID();
          const expiresAt = new Date(now + FEEDBACK_PREVIEW_TTL_MS).toISOString();
          priorityPreviews.set(token, { taskId, planHash, expiresAt: Date.parse(expiresAt) });
          respond(response, 200, `${JSON.stringify({ plan, planHash, token, expiresAt })}\n`);
          return;
        }

        const token = typeof input.token === 'string' ? input.token : '';
        const approvedPreview = priorityPreviews.get(token);
        if (approvedPreview) priorityPreviews.delete(token);
        if (!approvedPreview || approvedPreview.expiresAt <= Date.now() || approvedPreview.taskId !== taskId) {
          respond(response, 409, JSON.stringify({ error: 'PRIORITY_PREVIEW_EXPIRED', message: 'Preview the priority change again before applying it.' }));
          return;
        }
        const result = withBacklog((service) => {
          const current = service.planPriorityChange({
            taskId, actorId: 'owner', expectedRevision: input.expectedRevision,
            priority: input.priority, reason: input.reason,
          });
          const planHash = priorityPlanHash(current);
          if (planHash !== approvedPreview.planHash || planHash !== input.planHash) return { stale: true };
          return { task: service.setPriority({
            taskId, actorId: 'owner', expectedRevision: input.expectedRevision,
            priority: input.priority, reason: input.reason,
          }) };
        });
        if (result.stale) {
          respond(response, 409, JSON.stringify({ error: 'PRIORITY_PREVIEW_STALE', message: 'Task changed since preview. Review a fresh priority change.' }));
          return;
        }
        respond(response, 200, `${JSON.stringify(result)}\n`);
      } catch (error) {
        const status = error.code === 'BACKLOG_TASK_NOT_FOUND' ? 404
          : ['OWNER_AUTHORITY_REQUIRED', 'SAME_ORIGIN_REQUIRED'].includes(error.code) ? 403
            : ['BACKLOG_REVISION_CONFLICT', 'PRIORITY_PREVIEW_EXPIRED'].includes(error.code) ? 409 : 400;
        respond(response, status, `${JSON.stringify({ error: error.code ?? 'PRIORITY_CHANGE_FAILED', message: error.message })}\n`);
      }
      return;
    }
    const approvalDecision = url.pathname.match(/^\/api\/approvals\/([a-f0-9-]{36})\/decision(\/preview)?$/i);
    if (approvalDecision) {
      if (request.method !== 'POST') {
        respond(response, 405, JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }));
        return;
      }
      if (!sameOriginLoopback(request)) {
        respond(response, 403, JSON.stringify({ error: 'SAME_ORIGIN_REQUIRED' }));
        return;
      }
      let input;
      try { input = await readJsonRequest(request); } catch (error) {
        const status = error.code === 'REQUEST_TOO_LARGE' ? 413
          : error.code === 'REQUEST_CONTENT_TYPE_INVALID' ? 415 : 400;
        respond(response, status, JSON.stringify({ error: error.code, message: error.message }));
        return;
      }
      const approvalId = approvalDecision[1];
      try {
        if (approvalDecision[2]) {
          const plan = approvalDecisionPlan({ repositoryRoot, env, approvalId, decision: input.decision, note: input.note });
          const planHash = priorityPlanHash(plan);
          const now = Date.now();
          for (const [token, record] of approvalDecisionPreviews) {
            if (record.expiresAt <= now) approvalDecisionPreviews.delete(token);
          }
          while (approvalDecisionPreviews.size >= MAX_FEEDBACK_PREVIEWS) {
            approvalDecisionPreviews.delete(approvalDecisionPreviews.keys().next().value);
          }
          const token = randomUUID();
          const expiresAt = new Date(now + APPROVAL_DECISION_PREVIEW_TTL_MS).toISOString();
          approvalDecisionPreviews.set(token, { approvalId, planHash, expiresAt: Date.parse(expiresAt), consumed: false, result: null });
          respond(response, 200, `${JSON.stringify({ plan, planHash, token, expiresAt })}\n`);
          return;
        }

        const token = typeof input.token === 'string' ? input.token : '';
        const approvedPreview = approvalDecisionPreviews.get(token);
        if (!approvedPreview || approvedPreview.expiresAt <= Date.now() || approvedPreview.approvalId !== approvalId) {
          respond(response, 409, JSON.stringify({ error: 'APPROVAL_DECISION_PREVIEW_EXPIRED', message: 'Preview the approval decision again before confirming.' }));
          return;
        }
        if (approvedPreview.consumed) {
          if (input.planHash === approvedPreview.planHash) {
            respond(response, 200, `${JSON.stringify({ ...approvedPreview.result, replayed: true })}\n`);
          } else {
            respond(response, 409, JSON.stringify({ error: 'APPROVAL_DECISION_PREVIEW_STALE', message: 'This preview was already used for a different decision.' }));
          }
          return;
        }
        const current = approvalDecisionPlan({ repositoryRoot, env, approvalId, decision: input.decision, note: input.note });
        const currentHash = priorityPlanHash(current);
        if (currentHash !== approvedPreview.planHash || currentHash !== input.planHash) {
          respond(response, 409, JSON.stringify({ error: 'APPROVAL_DECISION_PREVIEW_STALE', message: 'The request or decision changed since preview. Review a fresh decision.' }));
          return;
        }
        const controlPlane = openControlPlane({ repositoryRoot, env });
        let decided;
        try {
          decided = controlPlane.decideApproval({
            approvalId, decidedBy: 'owner', decision: current.decision,
            note: current.note, expectedRevision: current.revision,
          });
        } finally { controlPlane.close(); }
        const result = { approval: decided, plan: current, mutationPerformed: true };
        approvedPreview.consumed = true;
        approvedPreview.result = result;
        respond(response, 200, `${JSON.stringify(result)}\n`);
      } catch (error) {
        const status = error.code === 'APPROVAL_NOT_FOUND' ? 404
          : ['OWNER_AUTHORITY_REQUIRED', 'APPROVER_AUTHORITY_REQUIRED', 'SAME_ORIGIN_REQUIRED'].includes(error.code) ? 403
            : ['APPROVAL_NOT_PENDING', 'APPROVAL_REVISION_CONFLICT', 'APPROVAL_DECISION_PREVIEW_STALE', 'APPROVAL_DECISION_PREVIEW_EXPIRED'].includes(error.code) ? 409 : 400;
        respond(response, status, `${JSON.stringify({ error: error.code ?? 'APPROVAL_DECISION_FAILED', message: error.message })}\n`);
      }
      return;
    }
    const feedback = url.pathname.match(/^\/api\/artifacts\/([a-f0-9-]{36})\/feedback(\/preview)?$/i);
    if (feedback) {
      if (request.method !== 'POST') {
        respond(response, 405, JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }));
        return;
      }
      if (!sameOriginLoopback(request)) {
        respond(response, 403, JSON.stringify({ error: 'SAME_ORIGIN_REQUIRED' }));
        return;
      }
      let input;
      try { input = await readJsonRequest(request); } catch (error) {
        const status = error.code === 'REQUEST_TOO_LARGE' ? 413
          : error.code === 'REQUEST_CONTENT_TYPE_INVALID' ? 415 : 400;
        respond(response, status, JSON.stringify({ error: error.code, message: error.message }));
        return;
      }
      try {
        const artifactId = feedback[1];
        if (feedback[2]) {
          const preview = withArtifactService({ repositoryRoot, env }, (service) =>
            service.planComment({ artifactId, body: input.body, by: 'owner' }));
          const planHash = feedbackPlanHash(preview);
          const now = Date.now();
          for (const [token, record] of feedbackPreviews) {
            if (record.expiresAt <= now) feedbackPreviews.delete(token);
          }
          while (feedbackPreviews.size >= MAX_FEEDBACK_PREVIEWS) {
            feedbackPreviews.delete(feedbackPreviews.keys().next().value);
          }
          const token = randomUUID();
          const expiresAt = new Date(now + FEEDBACK_PREVIEW_TTL_MS).toISOString();
          feedbackPreviews.set(token, { artifactId, planHash, expiresAt: Date.parse(expiresAt) });
          respond(response, 200, `${JSON.stringify({ preview, planHash, token, expiresAt })}\n`);
          return;
        }

        const token = typeof input.token === 'string' ? input.token : '';
        const approvedPreview = feedbackPreviews.get(token);
        if (approvedPreview) feedbackPreviews.delete(token);
        if (!approvedPreview || approvedPreview.expiresAt <= Date.now()
          || approvedPreview.artifactId !== artifactId) {
          respond(response, 409, JSON.stringify({ error: 'FEEDBACK_PREVIEW_EXPIRED', message: 'Preview again before sending feedback.' }));
          return;
        }
        const result = withArtifactService({ repositoryRoot, env }, (service) => {
          const current = service.planComment({ artifactId, body: input.body, by: 'owner' });
          const planHash = feedbackPlanHash(current);
          if (planHash !== approvedPreview.planHash || planHash !== input.planHash) {
            return { stale: true };
          }
          return { feedback: service.comment({ artifactId, body: input.body, by: 'owner' }) };
        });
        if (result.stale) {
          respond(response, 409, JSON.stringify({ error: 'FEEDBACK_PREVIEW_STALE', message: 'Feedback or artifact details changed. Review a fresh preview before sending.' }));
          return;
        }
        respond(response, 200, `${JSON.stringify(result)}\n`);
      } catch (error) {
        const status = error.code === 'ARTIFACT_NOT_FOUND' ? 404
          : error.code === 'OWNER_AUTHORITY_REQUIRED' ? 403 : 400;
        respond(response, status, `${JSON.stringify({ error: error.code ?? 'FEEDBACK_FAILED', message: error.message })}\n`);
      }
      return;
    }
    if (request.method !== 'GET') {
      respond(response, 405, JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }));
      return;
    }
    if (url.pathname === '/api/digest') {
      if (request.method !== 'GET') { respond(response, 405, JSON.stringify({ error: 'METHOD_NOT_ALLOWED' })); return; }
      try { respond(response, 200, `${JSON.stringify(observeProject({ repositoryRoot, env }).ownerDigest)}\n`); }
      catch (error) { respond(response, 503, JSON.stringify({ error: error.code ?? 'OBSERVATION_FAILED' })); }
      return;
    }
    if (url.pathname === '/api/snapshot') {
      try {
        respond(response, 200, `${JSON.stringify(observeProject({ repositoryRoot, env }))}\n`);
      } catch (error) {
        respond(response, 503, `${JSON.stringify({ error: error.code ?? 'OBSERVATION_FAILED', message: error.message })}\n`);
      }
      return;
    }
    const artifact = url.pathname.match(/^\/api\/artifacts\/([a-f0-9-]{36})$/i);
    if (artifact) {
      try {
        const image = readPublishedArtifact({ repositoryRoot, env, id: artifact[1] });
        respond(response, 200, image.bytes, image.mediaType);
      } catch (error) {
        respond(response, error.code === 'ARTIFACT_NOT_FOUND' ? 404 : 410,
          JSON.stringify({ error: error.code ?? 'ARTIFACT_UNAVAILABLE', message: error.message }));
      }
      return;
    }
    const file = ROUTES.get(url.pathname);
    if (!file) {
      respond(response, 404, 'Not found\n', 'text/plain; charset=utf-8');
      return;
    }
    const path = join(SITE_ROOT, file);
    respond(response, 200, readFileSync(path), TYPES.get(extname(path)) ?? 'application/octet-stream');
  });
}

export function startConsole({ repositoryRoot = process.cwd(), env = process.env, host = '127.0.0.1', port = 4317 } = {}) {
  const server = createConsoleServer({ repositoryRoot, env });
  server.listen(port, host, () => {
    const address = server.address();
    process.stdout.write(`TORCH console: http://${host}:${address.port}/console\n`);
  });
  return server;
}
