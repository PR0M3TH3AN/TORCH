import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { analyzeRepository } from '../kernel/analyze.mjs';
import { diagnoseProject } from '../kernel/doctor.mjs';
import { inspectRepository } from '../kernel/git.mjs';
import { readInstallManifest } from '../kernel/install.mjs';
import { projectStatePath } from '../kernel/paths.mjs';

function json(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function hasTable(database, name) {
  return Boolean(database.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name));
}

function rows(database, table, statement) {
  return hasTable(database, table) ? database.prepare(statement).all() : [];
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
        id: task.id, title: task.title, state: task.state, owner: task.owner ?? null,
        priority: task.priority ?? null, revision: task.revision ?? null,
      });
    } catch {
      tasks.push({ id: name.slice(0, -5), title: 'Unreadable task', state: 'invalid', owner: null });
    }
  }
  return tasks;
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
      contextLocality: {
        measured: false, status: 'unavailable',
        reason: 'Install a Fleet and connect runtime usage reporting before comparing context locality.',
      },
    };
  }

  const config = json(join(repository.root, '.torch', 'torch.yaml'));
  const roster = json(join(repository.root, '.torch', 'roster.yaml'));
  const manifest = readInstallManifest(repository.root);
  const stateRoot = projectStatePath(manifest.projectId, env);
  const databasePath = join(stateRoot, 'state.db');
  const result = {
    schema: 'torch.dev/observation/v1alpha1', generatedAt: now().toISOString(),
    mode: 'installed', mutationPerformed: false,
    project: config.project,
    repository: {
      root: repository.root, branch: repository.branch, head: repository.head,
      dirty: repository.dirtyEntries.length > 0,
    },
    doctor: diagnoseProject({ repository, env }),
    agents: (roster.areas ?? []).map((area) => ({
      areaId: area.id, title: area.title, state: 'offline', runtime: area.runtime ?? null,
      runtimeSessionId: null, summary: null, task: null, heartbeatAt: null,
    })),
    messages: { total: 0, unacknowledged: 0, recent: [] },
    backlog: backlog(repository.root, manifest),
    checks: { definitions: config.checks ?? [], receipts: [] },
    resources: { definitions: config.resources ?? [], holders: [], waiters: [] },
    integration: [],
    schedules: config.schedules ?? [],
    audit: [],
    contextLocality: {
      measured: false, status: 'unavailable',
      reason: 'No runtime usage samples have been reported for this Fleet.',
      metrics: ['cachedInput', 'uncachedInput', 'cacheCreation', 'cacheRead', 'compactions', 'resumedPromptBytes', 'costPerVerifiedItem'],
    },
  };
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
    if (hasTable(database, 'messages')) {
      result.messages.total = database.prepare('SELECT COUNT(*) AS count FROM messages').get().count;
      result.messages.recent = database.prepare(`
        SELECT id, sender_id AS sender, recipient_id AS recipient, kind, body, created_at AS createdAt
        FROM messages ORDER BY created_at DESC LIMIT 20
      `).all();
      if (hasTable(database, 'message_acks') && hasTable(database, 'identities')) {
        result.messages.unacknowledged = database.prepare(`
          SELECT COUNT(*) AS count FROM messages m
          JOIN identities i ON m.recipient_id = i.area_id OR m.recipient_id = 'all'
          LEFT JOIN message_acks a ON a.message_id = m.id AND a.area_id = i.area_id
          WHERE a.message_id IS NULL
        `).get().count;
      }
    }
    result.checks.receipts = rows(database, 'check_receipts', `
      SELECT id, check_id AS checkId, area_id AS areaId, commit_sha AS commit, result, finished_at AS finishedAt
      FROM check_receipts ORDER BY finished_at DESC LIMIT 40
    `);
    result.resources.holders = rows(database, 'resource_leases', `
      SELECT resource_id AS resourceId, area_id AS areaId, acquired_at AS acquiredAt, expires_at AS expiresAt
      FROM resource_leases WHERE released_at IS NULL ORDER BY acquired_at
    `);
    result.resources.waiters = rows(database, 'resource_requests', `
      SELECT resource_id AS resourceId, area_id AS areaId, requested_at AS requestedAt
      FROM resource_requests WHERE state = 'waiting' ORDER BY requested_at
    `);
    result.integration = rows(database, 'integration_requests', `
      SELECT id, source_area AS sourceArea, source_commit AS sourceCommit, target_branch AS targetBranch, state, reason, updated_at AS updatedAt
      FROM integration_requests ORDER BY updated_at DESC LIMIT 40
    `);
    result.audit = rows(database, 'audit_events', `
      SELECT id, actor_id AS actorId, operation, entity_type AS entityType, entity_id AS entityId, created_at AS createdAt
      FROM audit_events ORDER BY created_at DESC LIMIT 30
    `);
    if (hasTable(database, 'context_usage')) {
      const samples = database.prepare(`
        SELECT area_id AS areaId, SUM(cached_input) AS cachedInput, SUM(uncached_input) AS uncachedInput,
          SUM(cache_creation) AS cacheCreation, SUM(cache_read) AS cacheRead,
          SUM(compactions) AS compactions, SUM(resumed_prompt_bytes) AS resumedPromptBytes,
          SUM(cost_microusd) AS costMicrousd, SUM(verified_items) AS verifiedItems
        FROM context_usage GROUP BY area_id ORDER BY area_id
      `).all();
      result.contextLocality = { measured: true, status: 'measured', samples };
    }
  } finally {
    database.close();
  }
  return result;
}
