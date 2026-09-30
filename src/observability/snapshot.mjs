import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { analyzeRepository } from '../kernel/analyze.mjs';
import { diagnoseProject } from '../kernel/doctor.mjs';
import { inspectRepository } from '../kernel/git.mjs';
import { readInstallManifest } from '../kernel/install.mjs';
import { projectStatePath } from '../kernel/paths.mjs';
import { loadProjectConfig } from '../kernel/config.mjs';
import { organizationGraphFromConfig } from '../kernel/organization.mjs';
import { inspectManagedWorktree } from '../kernel/worktree-state.mjs';
import { createRuntimeAdapterRegistry } from '../adapters/registry.mjs';
import { classifyRecoverability } from '../canonical/local.mjs';
import { observeArtifacts } from '../artifacts/service.mjs';
import { assessBacklogHealth, backlogObservedCommitDistance } from '../backlog/service.mjs';
import { observeTaskActivity } from '../backlog/activity.mjs';
import { ScheduleLauncherService } from '../schedules/launcher.mjs';
import { hierarchyOrder } from '../runtime/hierarchy-order.mjs';

function json(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function hasTable(database, name) {
  return Boolean(database.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name));
}

function runtimeAdapterChoices(config, env) {
  const registry = createRuntimeAdapterRegistry({ env });
  const builtins = registry.names().map((name) => {
    const adapterDefaults = registry.configuration(name) ?? {};
    const settings = config.runtimes?.[name] ?? {};
    const labels = { claude: 'Claude Code', codex: 'Codex', pi: 'Pi' };
    return {
      name, title: labels[name] ?? name,
      kind: 'built-in', available: true,
      model: settings.model ?? adapterDefaults.model ?? null,
      reasoning: settings.reasoning ?? adapterDefaults.reasoning ?? null,
    };
  });
  const plugins = registry.trustedPlugins.map((plugin) => ({
    name: plugin.name, title: plugin.name, kind: 'local adapter',
    available: plugin.status === 'trusted', status: plugin.status,
    reason: plugin.status === 'trusted' ? null : `Local adapter is ${plugin.status}. Review it under Runtime settings before selecting it.`,
    model: config.runtimes?.[plugin.name]?.model ?? null,
    reasoning: config.runtimes?.[plugin.name]?.reasoning ?? null,
  }));
  return [...builtins, ...plugins];
}

function rows(database, table, statement) {
  return hasTable(database, table) ? database.prepare(statement).all() : [];
}

function storedJson(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return { unavailable: true, reason: 'Stored evidence is unreadable' }; }
}

function capturedInput(value) {
  const snapshot = storedJson(value);
  if (!snapshot || snapshot.unavailable) return snapshot;
  return { commit: snapshot.commit, digest: snapshot.digest, copyStrategy: snapshot.copyStrategy,
    provenance: snapshot.provenance, fileCount: Array.isArray(snapshot.files) ? snapshot.files.length : null };
}

export function observeDeliveryEvidence(database, projectId) {
  if (!hasTable(database, 'delivery_operations') || !hasTable(database, 'deliveries')) {
    return { deliveryOperations: [], deliveryAttempts: [], deliveryEvidenceCoverage: 'Delivery operations not initialized; absence is not deployment verification' };
  }
  const deliveryOperations = database.prepare(`SELECT o.id, o.delivery_id AS deliveryId,
    o.commit_sha AS "commit", o.actor, o.provider, o.operation, o.state,
    o.created_at AS createdAt, o.updated_at AS updatedAt
    FROM delivery_operations o JOIN deliveries d ON d.id = o.delivery_id
    WHERE d.project_id = ? ORDER BY o.rowid DESC LIMIT 40`).all(projectId);
  const deliveryAttempts = hasTable(database, 'delivery_attempts') ? database.prepare(`SELECT a.id,
    a.operation_id AS operationId, a.ordinal, a.state, a.started_at AS startedAt,
    a.finished_at AS finishedAt, a.receipt_json
    FROM delivery_attempts a JOIN delivery_operations o ON o.id = a.operation_id
    JOIN deliveries d ON d.id = o.delivery_id WHERE d.project_id = ? ORDER BY a.rowid DESC LIMIT 80`)
    .all(projectId).map(({ receipt_json, ...attempt }) => {
      const receipt = receipt_json?.length <= 65_536 ? storedJson(receipt_json) : null;
      return { ...attempt, receiptSummary: {
        status: ['succeeded', 'failed', 'unknown'].includes(receipt?.status) ? receipt.status : 'unavailable',
        classification: ['transient', 'permanent'].includes(receipt?.failure?.classification) ? receipt.failure.classification : null,
        effects: ['not-applied', 'unknown'].includes(receipt?.failure?.effects) ? receipt.failure.effects : null,
        reason: ['invalid-adapter-receipt', 'adapter-threw-or-invalid-receipt'].includes(receipt?.reason) ? receipt.reason : null,
        hasReference: typeof receipt?.reference === 'string' && Boolean(receipt.reference.trim()),
      } };
    }) : [];
  return { deliveryOperations, deliveryAttempts,
    deliveryEvidenceCoverage: 'Latest 40 operations and 80 attempts; adapter-reported receipts, not independent live verification. Raw references and error text omitted.' };
}

// Read-only projection: never follow artifact paths or infer that a recorded
// running check still has a live executor. Older databases need no migration.
export function observeCheckEvidence(database, projectId) {
  const preparedColumns = hasTable(database, 'prepared_checks')
    ? database.prepare('PRAGMA table_info(prepared_checks)').all().map((column) => column.name) : [];
  const prepared = hasTable(database, 'prepared_checks')
    ? database.prepare(`SELECT id, check_id AS checkId, area_id AS areaId, state,
      created_at AS createdAt, receipt_id AS receiptId, snapshot_json,
      ${preparedColumns.includes('recovery_json') ? 'recovery_json' : 'NULL AS recovery_json'}
      FROM prepared_checks WHERE project_id = ? ORDER BY created_at DESC, id LIMIT 40`)
      .all(projectId).map(({ snapshot_json, recovery_json, ...record }) => {
        const recovery = recovery_json?.length <= 65_536 ? storedJson(recovery_json) : null;
        const reasons = ['CHECK_SNAPSHOT_INVALID', 'CHECK_SNAPSHOT_CLEANUP_FAILED'];
        return { ...record, snapshot: capturedInput(snapshot_json),
          recovery: record.state === 'abandoned' ? {
            recordedAt: typeof recovery?.at === 'string' && Number.isFinite(Date.parse(recovery.at)) ? recovery.at : null,
            cleanupStatus: recovery?.cleanupPending === true ? 'pending'
              : recovery?.cleanupPending === false ? 'completed' : 'unconfirmed',
            cleanupReason: reasons.includes(recovery?.cleanupReason) ? recovery.cleanupReason : null,
            stoppedExecutors: recovery?.executorsStopped === true ? 'owner-attested' : 'unconfirmed',
          } : null };
      }) : [];
  if (!hasTable(database, 'check_receipts')) return { receipts: [], prepared };
  const columns = database.prepare('PRAGMA table_info(check_receipts)').all().map((column) => column.name);
  const receipts = database.prepare(`SELECT id, check_id AS checkId, area_id AS areaId,
    commit_sha AS "commit", result, finished_at AS finishedAt, invalid_reason AS invalidReason,
    ${columns.includes('conditions_json') ? 'conditions_json' : 'NULL AS conditions_json'}
    FROM check_receipts WHERE project_id = ? ORDER BY finished_at DESC, id LIMIT 40`)
    .all(projectId).map(({ conditions_json, ...record }) => ({
      ...record, conditions: storedJson(conditions_json),
      snapshot: hasTable(database, 'prepared_checks') ? capturedInput(database.prepare(`SELECT snapshot_json
        FROM prepared_checks WHERE project_id = ? AND receipt_id = ? LIMIT 1`).get(projectId, record.id)?.snapshot_json) : null,
    }));
  return { receipts, prepared, limit: 40, coverage: 'Latest 40 receipts and preparations; running records are not process-liveness evidence' };
}

function backlog(repositoryRoot, manifest) {
  const manager = (manifest.external ?? []).find((entry) => entry.type === 'worktree' && entry.area === 'session-manager');
  const root = join(manager?.path && existsSync(manager.path) ? manager.path : repositoryRoot, '.torch', 'backlog');
  if (!existsSync(root)) return [];
  const tasks = [];
  for (const name of readdirSync(root).filter((entry) => entry.endsWith('.json')).sort()) {
    try {
      const task = json(join(root, name));
      tasks.push({
        id: task.id, title: task.title, description: task.description ?? '',
        state: task.state, owner: task.owner ?? null, priority: task.priority ?? null,
        affectedDomains: task.affectedDomains ?? [], dependencies: task.dependencies ?? [],
        feature: task.feature ?? null, milestone: task.milestone ?? null,
        acceptanceCriteria: task.acceptanceCriteria ?? [], evidence: task.evidence ?? [],
        commit: task.commit ?? null, observedAt: task.observedAt ?? null,
        updatedAt: task.updatedAt ?? null, revision: task.revision ?? null,
        createdAt: task.createdAt ?? null, history: task.history?.length ? [{ actorId: task.history[0].actorId }] : [],
      });
    } catch {
      tasks.push({ id: name.slice(0, -5), title: 'Unreadable task', state: 'invalid', owner: null });
    }
  }
  return tasks;
}

function backlogHealth(repositoryRoot, tasks, agents, now) {
  return assessBacklogHealth({
    tasks, agents, now: now(), staleObservedCommits: 50,
    commitDistance: (observedAt) => backlogObservedCommitDistance(repositoryRoot, observedAt),
  });
}

export function observeBacklogActivity({ repositoryRoot, tasks, config, manifest, now }) {
  try {
    return { available: true, ...observeTaskActivity({ repositoryRoot, tasks, now,
      staleDays: config.backlog?.activity?.stale_days ?? 3,
      maxCommits: config.backlog?.activity?.max_commits ?? 1000,
      branches: [config.project.main_branch, ...(manifest.external ?? [])
        .filter((entry) => entry.type === 'worktree').map((entry) => entry.branch)],
    }) };
  } catch (error) {
    return { available: false, complete: false, reason: error.code ?? 'BACKLOG_ACTIVITY_UNAVAILABLE',
      tasks: [], stale: [], mutationPerformed: false, closurePerformed: false };
  }
}

function approvalRecord(row) {
  return {
    id: row.id, requester: row.requester_id, approver: row.approver_id,
    task: row.task_ref ?? null, title: row.title, summary: row.summary,
    evidence: row.evidence ?? null, status: row.status, revision: row.revision,
    createdAt: row.created_at, decidedAt: row.decided_at ?? null,
    decidedBy: row.decided_by ?? null, decisionNote: row.decision_note ?? null,
  };
}

function managerCheckInProjection({ graph, agents, schedules, approvals, database, generatedAt }) {
  const rolesById = new Map(graph.roles.map((role) => [role.id, role]));
  const agentById = new Map(agents.map((agent) => [agent.areaId, agent]));
  const reportsByManager = new Map();
  for (const reportRole of graph.roles) {
    for (const parentRoleId of reportRole.reports_to ?? []) {
      const managerRole = rolesById.get(parentRoleId);
      if (!managerRole || managerRole.kind === 'owner' || managerRole.identity_id === reportRole.identity_id) continue;
      const managerId = managerRole.identity_id;
      if (!reportsByManager.has(managerId)) reportsByManager.set(managerId, new Map());
      reportsByManager.get(managerId).set(reportRole.identity_id, reportRole);
    }
  }

  const pending = approvals.filter((approval) => approval.status === 'pending');
  const managers = [...reportsByManager.entries()].map(([managerId, reportRoles]) => {
    const reportIds = new Set(reportRoles.keys());
    const approvalWaits = pending.filter((approval) => reportIds.has(approval.requester)).map((approval) => {
      const requesterRoles = graph.roles.filter((role) => role.identity_id === approval.requester);
      const directManagerIds = new Set(requesterRoles.flatMap((role) => (role.reports_to ?? [])
        .map((roleId) => rolesById.get(roleId)?.identity_id).filter(Boolean)));
      return {
        ...approval,
        approverKind: approval.approver === 'owner' ? 'owner'
          : directManagerIds.has(approval.approver) ? 'manager' : 'peer-ai',
      };
    });
    const approvalsByRequester = new Set(approvalWaits.map((approval) => approval.requester));
    const directReports = [...reportRoles.keys()].map((areaId) => {
      const identity = agentById.get(areaId);
      return {
        areaId, title: identity?.title ?? reportRoles.get(areaId)?.title ?? areaId,
        state: identity?.state ?? 'missing', task: identity?.task ?? null,
        summary: identity?.summary ?? null, heartbeatAt: identity?.heartbeatAt ?? null,
      };
    });
    const findings = [];
    for (const report of directReports) {
      if (report.state === 'waiting' && !approvalsByRequester.has(report.areaId)) {
        findings.push({ type: 'waiting-unclassified', areaId: report.areaId, task: report.task });
      } else if (['offline', 'missing', 'stale'].includes(report.state)) {
        findings.push({ type: `direct-report-${report.state}`, areaId: report.areaId, task: report.task });
      }
    }
    for (const approval of approvalWaits) {
      findings.push({
        type: 'approval-wait', areaId: approval.requester, approvalId: approval.id,
        approver: approval.approver, approverKind: approval.approverKind, task: approval.task,
      });
    }
    if (hasTable(database, 'messages')) {
      for (const reportId of reportIds) {
        const row = hasTable(database, 'message_acks')
          ? database.prepare(`
            SELECT COUNT(*) AS count FROM messages m
            LEFT JOIN message_acks a ON a.message_id = m.id AND a.area_id = ?
            WHERE m.recipient_id = ? AND m.sender_id = ? AND a.message_id IS NULL
          `).get(managerId, managerId, reportId)
          : { count: 0 };
        if (row.count > 0) findings.push({ type: 'unacknowledged-message', areaId: reportId, count: row.count });
      }
    }
    const schedule = schedules.find((entry) => entry.action?.type === 'manager-check-in'
      && entry.action.manager_id === managerId) ?? null;
    return {
      managerId, title: agentById.get(managerId)?.title
        ?? graph.roles.find((role) => role.identity_id === managerId)?.title ?? managerId,
      state: agentById.get(managerId)?.state ?? 'missing', generatedAt,
      cadence: schedule?.trigger ?? null, scheduleId: schedule?.id ?? null,
      timerStatus: schedule ? 'installation-not-verified' : 'not-configured',
      directReports, findings, approvalWaits,
      attentionRequired: findings.length > 0 || approvalWaits.length > 0,
    };
  });
  return managers.sort((a, b) => a.managerId.localeCompare(b.managerId));
}

export function observeProject({ repositoryRoot, env = process.env, now = () => new Date() } = {}) {
  const repository = inspectRepository(repositoryRoot);
  const installed = existsSync(join(repository.root, '.torch', 'torch.yaml'));
  if (!installed) {
    const analysis = analyzeRepository(repository);
    return {
      schema: 'torch.dev/observation/v1alpha1', generatedAt: now().toISOString(),
      mode: 'not-installed', mutationPerformed: false,
      repository: analysis.repository,
      inventory: analysis.inventory,
      organization: { status: 'not-installed', graph: null, domains: [], edges: [], lifecycle: null },
      contextLocality: {
        measured: false, status: 'unavailable',
        reason: 'Install a Fleet and connect runtime usage reporting before comparing context locality.',
      },
    };
  }

  const config = loadProjectConfig(repository.root);
  const roster = json(join(repository.root, '.torch', 'roster.yaml'));
  const hierarchy = hierarchyOrder(roster, config);
  const manifest = readInstallManifest(repository.root);
  const doctor = diagnoseProject({ repository, env });
  const stateRoot = projectStatePath(manifest.projectId, env);
  const databasePath = join(stateRoot, 'state.db');
  const areas = roster.areas ?? [];
  const edges = [];
  const seenEdges = new Set();
  for (const area of areas) {
    for (const neighbour of area.neighbours ?? []) {
      if (neighbour === 'all') continue;
      const key = [area.id, neighbour].sort().join('\0');
      if (!seenEdges.has(key)) {
        seenEdges.add(key);
        edges.push({ from: area.id, to: neighbour });
      }
    }
  }
  const forgeFinding = doctor.findings.find((finding) => [
    'FORGE_UNAVAILABLE', 'FORGE_SYNCHRONIZATION_PENDING', 'FORGE_STATUS_INVALID',
  ].includes(finding.code));
  const result = {
    schema: 'torch.dev/observation/v1alpha1', generatedAt: now().toISOString(),
    mode: 'installed', mutationPerformed: false,
    project: config.project,
    repository: {
      root: repository.root, branch: repository.branch, head: repository.head,
      dirty: repository.dirtyEntries.length > 0,
    },
    doctor,
    organization: {
      status: 'active',
      graph: organizationGraphFromConfig(config),
      sessionManager: areas.find((area) => area.id === 'session-manager') ?? null,
      domains: areas.filter((area) => area.id !== 'session-manager'),
      edges,
      lifecycle: {
        startupOrder: hierarchy.startupOrder,
        shutdownOrder: hierarchy.shutdownOrder,
        startupWaves: hierarchy.startupWaves,
        managerIdsByIdentity: Object.fromEntries([...hierarchy.managersByIdentity]
          .map(([identityId, managerIds]) => [identityId, [...managerIds]])),
        blockers: hierarchy.blockers,
        mutationPerformed: false,
      },
    },
    agents: areas.map((area) => {
      const configured = area.id === 'session-manager'
        ? config.session_manager : config.domains?.find((domain) => domain.id === area.id);
      const runtime = configured?.runtime ?? area.runtime
        ?? config.runtimes?.default;
      const runtimeConfig = config.runtimes?.[runtime] ?? {};
      return {
        areaId: area.id, title: area.title, state: 'offline', runtime: runtime ?? null,
        model: configured?.model ?? area.model
          ?? runtimeConfig.model ?? null,
        reasoning: configured?.reasoning ?? area.reasoning
          ?? runtimeConfig.reasoning ?? null,
        runtimeSessionId: null, summary: null, task: null, heartbeatAt: null,
      };
    }),
      messages: { total: 0, unacknowledged: 0, recent: [] },
      approvalRequests: {
        available: false, pendingCount: 0, items: [],
        reason: 'Structured approval state is not available in the local project database yet.',
      },
      managerCheckIns: {
        available: false, managers: [],
        reason: 'Manager check-in state requires an initialized local project database.',
      },
      managerWakes: {
        available: false, blockingCount: 0, reservations: [],
        reason: 'Manager launch records are not initialized in this project database.',
      },
    backlog: backlog(repository.root, manifest),
    checks: { definitions: config.checks ?? [], receipts: [] },
    resources: { definitions: config.resources ?? [], holders: [], waiters: [] },
    integration: [],
    deliveries: [],
    deliveryOperations: [],
    deliveryAttempts: [],
    ownerDigest: null,
    fleetChanges: [],
    hierarchyProposals: [],
    artifacts: {
      available: false, items: [],
      reason: 'No project-local artifact catalog with task, session, and commit provenance is connected yet.',
    },
    schedules: config.schedules ?? [],
    scheduleLauncher: new ScheduleLauncherService({ repositoryRoot: repository.root, env }).status(),
    worktrees: (manifest.external ?? [])
      .filter((entry) => entry.type === 'worktree')
      .map((entry) => inspectManagedWorktree(repository.root, entry, config.project.main_branch)),
    recoverability: classifyRecoverability({ repositoryRoot: repository.root }),
    decisions: {
      path: '.torch/decisions.md',
      content: readFileSync(join(repository.root, '.torch', 'decisions.md'), 'utf8'),
    },
    providers: {
      runtimes: Object.entries(config.runtimes)
        .filter(([name]) => name !== 'default')
        .map(([name, policy]) => ({ name, configured: true, policy })),
      forge: config.forge.provider === 'none'
        ? { provider: 'none', status: 'local-only', remote: null }
        : {
          provider: config.forge.provider, remote: config.forge.remote,
          status: forgeFinding?.code === 'FORGE_UNAVAILABLE' ? 'degraded'
            : (forgeFinding?.code === 'FORGE_SYNCHRONIZATION_PENDING' ? 'pending-sync'
              : (forgeFinding ? 'invalid' : 'available')),
          finding: forgeFinding ?? null,
        },
      delivery: config.delivery.adapters,
    },
    runtimeAdapters: runtimeAdapterChoices(config, env),
    audit: [],
    contextLocality: {
      measured: false, status: 'unavailable',
      reason: 'No runtime usage samples have been reported for this Fleet.',
      metrics: ['cachedInput', 'uncachedInput', 'cacheCreation', 'cacheRead', 'compactions', 'resumedPromptBytes', 'costPerVerifiedItem'],
    },
  };
  result.backlogHealth = backlogHealth(repository.root, result.backlog, result.agents, now);
  result.backlogActivity = observeBacklogActivity({ repositoryRoot: repository.root,
    tasks: result.backlog, config, manifest, now: now() });
  if (!existsSync(databasePath)) return result;

  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    if (hasTable(database, 'identities')) {
      const live = new Map(database.prepare(`
        SELECT area_id, state, runtime, runtime_session_id, summary, current_task AS task, heartbeat_at
        FROM identities ORDER BY area_id
      `).all().map((row) => [row.area_id, row]));
      result.agents = result.agents.map((agent) => {
        const row = live.get(agent.areaId);
        return row ? {
          ...agent, state: row.state, runtime: row.runtime ?? agent.runtime,
          runtimeSessionId: row.runtime_session_id, summary: row.summary,
          task: row.task, heartbeatAt: row.heartbeat_at,
        } : agent;
      });
    }
    if (hasTable(database, 'schedule_wake_reservations')) {
      const rows = database.prepare(`
        SELECT * FROM schedule_wake_reservations WHERE project_id = ?
        ORDER BY (outcome = 'reserved') DESC, reserved_at DESC, id DESC LIMIT 100
      `).all(config.project.id);
      result.managerWakes = {
        available: true,
        blockingCount: database.prepare(`SELECT COUNT(*) AS count FROM schedule_wake_reservations
          WHERE project_id = ? AND outcome = 'reserved'`).get(config.project.id).count,
        reservations: rows.map((row) => ({
          id: row.id, managerId: row.manager_id, scheduleId: row.schedule_id,
          messageId: row.message_id, budgetDay: row.budget_day,
          reservedAt: row.reserved_at, outcome: row.outcome,
          blocksManagerWake: row.outcome === 'reserved',
          managerState: result.agents.find((agent) => agent.areaId === row.manager_id)?.state ?? null,
          runtimeStoppedVerified: false,
        })),
        limit: 100,
        reason: null,
      };
    }
    if (hasTable(database, 'messages')) {
      result.messages.total = database.prepare('SELECT COUNT(*) AS count FROM messages').get().count;
      result.messages.recent = database.prepare(`
        SELECT id, sender_id AS sender, recipient_id AS recipient, kind, body, created_at AS createdAt
        FROM messages ORDER BY created_at DESC LIMIT 20
      `).all().map((message) => ({
        ...message,
        acknowledgedBy: hasTable(database, 'message_acks')
          ? database.prepare('SELECT area_id FROM message_acks WHERE message_id = ? ORDER BY area_id')
            .all(message.id).map((row) => row.area_id)
          : [],
      }));
      if (hasTable(database, 'message_acks') && hasTable(database, 'identities')) {
        result.messages.unacknowledged = database.prepare(`
          SELECT COUNT(*) AS count FROM messages m
          JOIN identities i ON m.recipient_id = i.area_id OR m.recipient_id = 'all'
          LEFT JOIN message_acks a ON a.message_id = m.id AND a.area_id = i.area_id
          WHERE a.message_id IS NULL
        `).get().count;
      }
    }
    if (hasTable(database, 'approval_requests')) {
      result.approvalRequests = {
        available: true,
        items: database.prepare(`
          SELECT * FROM approval_requests WHERE project_id = ?
          ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC, id DESC LIMIT 200
        `).all(manifest.projectId).map(approvalRecord),
        pendingCount: database.prepare(`
          SELECT COUNT(*) AS count FROM approval_requests WHERE project_id = ? AND status = 'pending'
        `).get(manifest.projectId).count,
        reason: null,
      };
    }
    Object.assign(result.checks, observeCheckEvidence(database, manifest.projectId));
    result.canonicalFetches = (hasTable(database, 'canonical_fetches') ? database.prepare(`SELECT id, remote, branch,
      commit_sha AS "commit", state, updated_at AS updatedAt, attempt_limit AS attemptLimit
      FROM canonical_fetches WHERE project_id = ? ORDER BY rowid DESC LIMIT 20`).all(manifest.projectId) : [])
      .map((record) => ({ ...record, attempts: database.prepare(`SELECT ordinal, state, classification,
        finished_at AS finishedAt FROM canonical_fetch_attempts WHERE fetch_id = ? ORDER BY ordinal`).all(record.id) }));
    result.resources.holders = rows(database, 'resource_leases', `
      SELECT resource_id AS resourceId, area_id AS areaId, acquired_at AS acquiredAt, expires_at AS expiresAt
      FROM resource_leases WHERE released_at IS NULL ORDER BY acquired_at
    `);
    result.resources.waiters = rows(database, 'resource_requests', `
      SELECT resource_id AS resourceId, area_id AS areaId, requested_at AS requestedAt
      FROM resource_requests WHERE state = 'waiting' ORDER BY requested_at
    `);
    result.integration = rows(database, 'integration_requests', `
      SELECT id, source_area AS sourceArea, source_commit AS sourceCommit, target_branch AS targetBranch,
        authorized_by AS authorizedBy, created_at AS createdAt, state, reason, updated_at AS updatedAt,
        row_number() OVER (ORDER BY rowid) AS queueOrder
      FROM integration_requests WHERE state NOT IN ('landed', 'superseded') ORDER BY rowid LIMIT 40
    `);
    result.deliveries = rows(database, 'deliveries', `
      SELECT id, label, source_area AS sourceArea, commit_sha AS "commit", state, updated_at AS updatedAt
      FROM deliveries ORDER BY updated_at DESC, id LIMIT 40
    `);
    Object.assign(result, observeDeliveryEvidence(database, manifest.projectId));
    if (hasTable(database, 'owner_digests')) {
      const digest = database.prepare('SELECT id, report_json FROM owner_digests WHERE project_id = ? ORDER BY generated_at DESC, rowid DESC LIMIT 1')
        .get(manifest.projectId);
      result.ownerDigest = digest ? { id: digest.id, report: JSON.parse(digest.report_json) } : null;
    }
    result.fleetChanges = rows(database, 'fleet_changes', `
      SELECT id, change_type AS changeType, state, proposer,
        COALESCE(json_extract(domain_json, '$.id'), json_extract(proposal_json, '$.resultDomains[0].id')) AS domainId,
        COALESCE(json_extract(domain_json, '$.title'), json_extract(proposal_json, '$.resultDomains[0].title')) AS title,
        json_extract(expected_benefit_json, '$.summary') AS expectedBenefit,
        approved_by AS approvedBy, updated_at AS updatedAt, base_commit AS baseCommit,
        rationale, evidence_json AS evidenceJson, domain_json AS domainJson
      FROM fleet_changes ORDER BY updated_at DESC, id LIMIT 40
    `).map((change) => ({
      ...change,
      evidence: JSON.parse(change.evidenceJson ?? '[]'),
      domain: JSON.parse(change.domainJson ?? 'null'),
      evidenceJson: undefined,
      domainJson: undefined,
    }));
    if (hasTable(database, 'hierarchy_proposals')) {
      result.hierarchyProposals = database.prepare(`
        SELECT id, state, proposer, created_at AS createdAt, updated_at AS updatedAt,
          decided_by AS decidedBy, decided_at AS decidedAt, decision_reason AS decisionReason, proposal_json AS proposalJson
        FROM hierarchy_proposals ORDER BY updated_at DESC, id LIMIT 40
      `).all().map((proposal) => ({
        ...proposal, proposal: JSON.parse(proposal.proposalJson), proposalJson: undefined,
        pilotReviews: hasTable(database, 'hierarchy_pilot_reviews')
          ? database.prepare(`SELECT report_json FROM hierarchy_pilot_reviews WHERE proposal_id = ?
              ORDER BY created_at DESC, id DESC LIMIT 5`).all(proposal.id)
            .map((review) => JSON.parse(review.report_json)) : [],
      }));
    }
    result.artifacts = observeArtifacts({ database, stateRoot });
    result.audit = rows(database, 'audit_events', `
      SELECT id, actor_id AS actorId, operation, entity_type AS entityType, entity_id AS entityId, created_at AS createdAt
      FROM audit_events ORDER BY created_at DESC LIMIT 30
    `);
    if (hasTable(database, 'context_usage')) {
      const samples = database.prepare(`
        SELECT area_id AS areaId, measurement, SUM(cached_input) AS cachedInput, SUM(uncached_input) AS uncachedInput,
          SUM(cache_creation) AS cacheCreation, SUM(cache_read) AS cacheRead,
          SUM(compactions) AS compactions, SUM(resumed_prompt_bytes) AS resumedPromptBytes,
          SUM(cost_microusd) AS costMicrousd, SUM(verified_items) AS verifiedItems
        FROM context_usage GROUP BY area_id, measurement ORDER BY area_id, measurement
      `).all();
      const measured = samples.some((sample) => sample.measurement === 'measured');
      result.contextLocality = {
        measured, status: measured ? 'measured' : 'estimated-only', samples,
        warning: samples.some((sample) => sample.verifiedItems === 0)
          ? 'Usage without verified outcomes cannot establish efficiency.' : null,
      };
    }
    if (hasTable(database, 'identities')) {
      const approvals = result.approvalRequests.items;
      result.managerCheckIns = {
        available: true,
        managers: managerCheckInProjection({
          graph: result.organization.graph, agents: result.agents, schedules: result.schedules,
          approvals, database, generatedAt: result.generatedAt,
        }),
        reason: result.approvalRequests.available ? null
          : 'Presence and message state are available; structured approval records are not initialized.',
      };
    }
  } finally {
    database.close();
  }
  result.backlogHealth = backlogHealth(repository.root, result.backlog, result.agents, now);
  return result;
}
