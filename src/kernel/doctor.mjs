import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileHash } from './files.mjs';
import { projectStatePath } from './paths.mjs';
import { inspectManagedWorktree } from './worktree-state.mjs';

function parseJsonYaml(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function diagnoseProject({ repository, env = process.env }) {
  const trackedRoot = join(repository.root, '.torch');
  const configPath = join(trackedRoot, 'torch.yaml');
  const manifestPath = join(trackedRoot, 'install-manifest.json');
  const findings = [];

  if (!existsSync(configPath)) {
    return { status: 'not-installed', healthy: false, findings: [{ severity: 'error', code: 'CONFIG_MISSING', path: configPath }] };
  }
  if (!existsSync(manifestPath)) {
    return { status: 'broken', healthy: false, findings: [{ severity: 'error', code: 'MANIFEST_MISSING', path: manifestPath }] };
  }

  let config;
  let manifest;
  try { config = parseJsonYaml(configPath); } catch (error) {
    findings.push({ severity: 'error', code: 'CONFIG_INVALID', message: error.message });
  }
  try { manifest = parseJsonYaml(manifestPath); } catch (error) {
    findings.push({ severity: 'error', code: 'MANIFEST_INVALID', message: error.message });
  }

  if (manifest) {
    for (const record of manifest.created ?? []) {
      const path = join(repository.root, record.path);
      if (!existsSync(path)) findings.push({ severity: 'error', code: 'OWNED_FILE_MISSING', path: record.path });
      else if (fileHash(path) !== record.sha256) findings.push({ severity: 'info', code: 'OWNED_FILE_MODIFIED', path: record.path });
    }
    const expectedStateRoot = projectStatePath(manifest.projectId, env);
    const recordedStateRoot = (manifest.external ?? []).find((entry) => entry.type === 'local-state')?.path;
    if (recordedStateRoot && recordedStateRoot !== expectedStateRoot) {
      findings.push({
        severity: 'error', code: 'LOCAL_STATE_PATH_MISMATCH',
        recorded: recordedStateRoot, expected: expectedStateRoot,
      });
    }
    const stateRoot = expectedStateRoot;
    if (!existsSync(stateRoot)) findings.push({ severity: 'error', code: 'LOCAL_STATE_MISSING', path: stateRoot });
    const databasePath = join(stateRoot, 'state.db');
    if (existsSync(databasePath)) {
      try {
        const database = new DatabaseSync(databasePath, { readOnly: true });
        const hasTable = (name) => Boolean(database.prepare(`
          SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?
        `).get(name));
        const unacknowledged = database.prepare(`
          SELECT COUNT(*) AS count
          FROM messages m
          JOIN identities i ON m.recipient_id = i.area_id OR m.recipient_id = 'all'
          LEFT JOIN message_acks a ON a.message_id = m.id AND a.area_id = i.area_id
          WHERE a.message_id IS NULL
        `).get().count;
        const present = database.prepare(`
          SELECT area_id, state, runtime, runtime_session_id, heartbeat_at
          FROM identities WHERE state != 'offline' ORDER BY area_id
        `).all();
        if (unacknowledged > 0) {
          findings.push({ severity: 'warning', code: 'MESSAGE_BACKLOG', unacknowledged });
        }
        if (present.length > 0) findings.push({ severity: 'info', code: 'FLEET_PRESENCE', agents: present });
        if (hasTable('resource_leases')) {
          const leases = database.prepare(`
            SELECT resource_id, area_id, acquired_at, expires_at
            FROM resource_leases WHERE released_at IS NULL ORDER BY resource_id, acquired_at
          `).all();
          const queue = database.prepare(`
            SELECT resource_id, area_id, requested_at
            FROM resource_requests WHERE state = 'waiting' ORDER BY resource_id, requested_at
          `).all();
          if (leases.length || queue.length) {
            findings.push({
              severity: leases.some((lease) => Date.parse(lease.expires_at) <= Date.now()) ? 'warning' : 'info',
              code: 'RESOURCE_ACTIVITY', leases, queue,
            });
          }
        }
        if (hasTable('check_receipts')) {
          const receipts = database.prepare(`
            SELECT check_id, area_id, result, finished_at
            FROM check_receipts WHERE commit_sha = ? ORDER BY check_id, finished_at DESC
          `).all(repository.head);
          if (receipts.length) findings.push({ severity: 'info', code: 'HEAD_CHECK_RECEIPTS', commit: repository.head, receipts });
        }
        if (hasTable('integration_requests')) {
          const requests = database.prepare(`
            SELECT id, source_area, source_commit, state, reason
            FROM integration_requests WHERE state NOT IN ('landed', 'superseded') ORDER BY created_at, id
          `).all();
          if (requests.length) findings.push({ severity: 'info', code: 'INTEGRATION_QUEUE', requests });
        }
        database.close();
      } catch (error) {
        findings.push({ severity: 'error', code: 'CONTROL_PLANE_INVALID', path: databasePath, message: error.message });
      }
    }
    for (const entry of (manifest.external ?? []).filter((item) => item.type === 'worktree')) {
      const state = inspectManagedWorktree(repository.root, entry, config?.project?.main_branch ?? 'main');
      for (const problem of state.problems) {
        findings.push({
          severity: problem === 'worktree-dirty' || problem.startsWith('unique-commits:') ? 'warning' : 'error',
          code: 'WORKTREE_PROBLEM', area: entry.area, path: entry.path, problem,
        });
      }
    }
    const managerWorktree = (manifest.external ?? []).find((entry) =>
      entry.type === 'worktree' && entry.area === 'session-manager');
    if (managerWorktree) {
      const backlogRoot = join(managerWorktree.path, '.torch', 'backlog');
      if (!existsSync(backlogRoot)) {
        findings.push({ severity: 'error', code: 'BACKLOG_DIRECTORY_MISSING', path: backlogRoot });
      } else {
        const tasks = [];
        for (const name of readdirSync(backlogRoot).filter((entry) => entry.endsWith('.json'))) {
          try {
            const task = parseJsonYaml(join(backlogRoot, name));
            if (task.schema !== 'torch.dev/backlog-item/v1alpha1' || !task.id || !task.state) throw new Error('invalid task schema');
            if (!['completed', 'cancelled'].includes(task.state)) {
              tasks.push({ id: task.id, state: task.state, owner: task.owner, revision: task.revision });
            }
          } catch (error) {
            findings.push({
              severity: 'error', code: 'BACKLOG_TASK_INVALID', path: join(backlogRoot, name), message: error.message,
            });
          }
        }
        if (tasks.length) findings.push({
          severity: tasks.some((task) => task.state === 'blocked') ? 'warning' : 'info',
          code: 'BACKLOG_ACTIVITY', tasks,
        });
      }
    }
  }

  if (config?.project?.id && manifest?.projectId && config.project.id !== manifest.projectId) {
    findings.push({ severity: 'error', code: 'PROJECT_ID_MISMATCH' });
  }
  if (repository.dirtyEntries.length) {
    findings.push({ severity: 'info', code: 'WORKTREE_DIRTY', count: repository.dirtyEntries.length });
  }

  return {
    status: findings.some((finding) => finding.severity === 'error') ? 'broken' : 'ok',
    healthy: !findings.some((finding) => finding.severity === 'error'),
    projectId: config?.project?.id ?? null,
    findings,
  };
}
