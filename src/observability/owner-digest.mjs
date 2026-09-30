import { randomUUID } from 'node:crypto';
import { TorchError } from '../kernel/errors.mjs';
import { loadProjectConfig } from '../kernel/config.mjs';
import { BacklogService } from '../backlog/service.mjs';

const hasTable = (database, name) => Boolean(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
const clip = (value) => String(value ?? '').slice(0, 600);
const safeMarkdown = (value) => [...clip(value)].map((character) => character.charCodeAt(0) < 32 ? ' ' : character).join('')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/[\\`*_[\]()#|]/g, '\\$&');

export class OwnerDigestService {
  constructor({ repositoryRoot, controlPlane, backlogService = null, clock = () => new Date(), idFactory = randomUUID } = {}) {
    this.repositoryRoot = repositoryRoot;
    this.controlPlane = controlPlane;
    this.database = controlPlane.database;
    this.backlog = backlogService ?? new BacklogService({ repositoryRoot, controlPlane });
    this.clock = clock;
    this.idFactory = idFactory;
  }

  build(options = {}) {
    this.database.exec('BEGIN');
    try {
      const report = this.#build(options);
      this.database.exec('COMMIT');
      return report;
    } catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }

  #build({ windowHours, maxItems, maxCommits, at = this.clock() } = {}) {
    const config = loadProjectConfig(this.repositoryRoot);
    const hours = windowHours ?? config.owner_digest?.window_hours ?? 24;
    const limit = maxItems ?? config.owner_digest?.max_items ?? 30;
    if (!Number.isInteger(hours) || hours < 1 || hours > 168 || !Number.isInteger(limit) || limit < 1 || limit > 100
      || !(at instanceof Date) || !Number.isFinite(at.getTime())) {
      throw new TorchError('Invalid digest window or bounds', { code: 'DIGEST_INPUT_INVALID' });
    }
    const until = at.toISOString();
    const since = new Date(at.getTime() - hours * 3_600_000).toISOString();
    const coverage = [];
    const query = (table, select, where, params, order) => {
      if (!hasTable(this.database, table)) {
        coverage.push(`${table}: records not initialized; absence is not live qualification`);
        return { available: false, count: null, items: [], truncated: false };
      }
      const count = this.database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`).get(...params).count;
      const items = this.database.prepare(`SELECT ${select} FROM ${table} WHERE ${where} ORDER BY ${order} LIMIT ?`).all(...params, limit);
      if (count > limit) coverage.push(`${table}: showing ${limit} of ${count} matching records`);
      return { available: true, count, items, truncated: count > limit };
    };
    const project = this.controlPlane.projectId;
    const needsOwner = query('approval_requests', 'id, title, requester_id AS requester, task_ref AS task, created_at AS createdAt',
      "project_id = ? AND status = 'pending' AND approver_id = 'owner'", [project], 'created_at, id');
    const decisions = query('approval_requests', 'id, title, status, decided_by AS decidedBy, decided_at AS decidedAt',
      'project_id = ? AND decided_at > ? AND decided_at <= ?', [project, since, until], 'decided_at DESC, id');
    const landed = query('integration_requests', 'id, source_area AS sourceArea, source_commit AS "commit", landed_at AS landedAt',
      "project_id = ? AND state = 'landed' AND landed_at > ? AND landed_at <= ?", [project, since, until], 'landed_at DESC, id');
    // Report lifecycle receipts, not a branch's presence on main, as shipping.
    const shipped = hasTable(this.database, 'deliveries') ? query('delivery_events',
      'id, delivery_id AS deliveryId, (SELECT label FROM deliveries d WHERE d.id = delivery_events.delivery_id) AS label, (SELECT commit_sha FROM deliveries d WHERE d.id = delivery_events.delivery_id) AS "commit", to_state AS state, created_at AS recordedAt',
      "delivery_id IN (SELECT id FROM deliveries WHERE project_id = ?) AND to_state IN ('deployed', 'live-verified') AND created_at > ? AND created_at <= ?",
      [project, since, until], 'created_at DESC, id') : { available: false, count: null, items: [], truncated: false };
    const deliveryReview = hasTable(this.database, 'deliveries') ? query('delivery_operations',
      'id, delivery_id AS deliveryId, commit_sha AS "commit", provider, operation, state, updated_at AS updatedAt',
      "delivery_id IN (SELECT id FROM deliveries WHERE project_id = ?) AND state IN ('unknown', 'running', 'succeeded')",
      [project], 'created_at, id') : { available: false, count: null, items: [], truncated: false };
    let lastDeployment = null;
    if (hasTable(this.database, 'delivery_operations') && hasTable(this.database, 'deliveries')) {
      lastDeployment = this.database.prepare(`SELECT o.id, o.delivery_id AS deliveryId, d.label, o.commit_sha AS "commit",
        o.provider, o.state, o.updated_at AS updatedAt FROM delivery_operations o JOIN deliveries d ON d.id = o.delivery_id
        WHERE d.project_id = ? AND o.operation = 'deploy' ORDER BY o.rowid DESC LIMIT 1`).get(project) ?? null;
      if (lastDeployment && hasTable(this.database, 'delivery_attempts')) {
        const attempt = this.database.prepare('SELECT state, receipt_json FROM delivery_attempts WHERE operation_id = ? ORDER BY ordinal DESC LIMIT 1').get(lastDeployment.id);
        lastDeployment.attemptResult = attempt?.state ?? null;
        try {
          const receipt = JSON.parse(attempt?.receipt_json ?? 'null');
          lastDeployment.failureReason = receipt?.status !== 'succeeded'
            ? clip(receipt?.failure?.code ?? receipt?.reason ?? receipt?.failure?.classification ?? 'No terminal receipt') : null;
        } catch { lastDeployment.failureReason = 'Malformed persisted receipt'; }
      }
    }
    const tasks = this.backlog.list();
    const bounded = (items) => ({ available: true, count: items.length, items: items.slice(0, limit), truncated: items.length > limit });
    const completed = bounded(tasks.filter((task) => task.state === 'completed' && task.history.some((entry) => entry.to === 'completed'
      && Date.parse(entry.at) > Date.parse(since) && Date.parse(entry.at) <= at.getTime()))
      .map((task) => ({ taskId: task.id, title: clip(task.title), commit: task.commit, integrationRequest: task.integrationRequest })));
    const blocked = bounded(tasks.filter((task) => task.state === 'blocked')
      .map((task) => ({ taskId: task.id, title: clip(task.title), owner: task.owner, reason: clip(task.blockedReason) })));
    let activityCoverage;
    let neglectedRequests = bounded([]);
    try {
      const activity = this.backlog.activity({ now: at, maxCommits });
      activityCoverage = { available: true, complete: activity.complete, truncated: activity.truncated,
        unavailableBranches: activity.unavailableBranches, scannedCommits: activity.scannedCommits };
      neglectedRequests = bounded(activity.stale.filter((task) => task.ownerRequested).map((task) => ({
        taskId: task.taskId, title: clip(task.title), state: task.state, ageDays: task.ageDays,
        expectedWaiting: task.expectedWaiting, lastActivityCommit: task.lastActivity?.commit ?? null,
      })));
      if (!activity.complete) coverage.push('Managed Git history incomplete; owner-request inactivity cannot be proven');
    } catch (error) {
      activityCoverage = { available: false, complete: false, reason: error.code ?? 'activity-unavailable' };
      neglectedRequests.available = false;
      neglectedRequests.count = null;
      coverage.push('Owner-request activity unavailable; no neglect conclusion');
    }
    coverage.push('Decisions are structured approval outcomes only; unstructured decision documents are not time-indexed');
    coverage.push('Database receipts, tracked tasks and Git activity are a bounded observation, not an atomic repository snapshot');
    for (const section of [needsOwner, decisions]) section.items = section.items.map((item) => ({ ...item, title: clip(item.title) }));
    shipped.items = shipped.items.map((item) => ({ ...item, label: clip(item.label) }));
    if (lastDeployment) lastDeployment.label = clip(lastDeployment.label);
    const report = { schema: 'torch.dev/owner-digest/v1alpha1', projectId: project, projectName: clip(config.project.name),
      generatedAt: until, window: { since, until, hours }, maxItems: limit,
      needsOwner, deliveryReview, lastDeployment, shipped, landed, completed, decisions, blocked, neglectedRequests,
      activityCoverage, coverage, provenance: 'recorded-local-evidence', mutationPerformed: false, externalDeliveryPerformed: false };
    const lines = [`# ${safeMarkdown(report.projectName)} — owner digest`, '', `Window: ${since} to ${until} (UTC).`,
      '', 'Recorded evidence; not independently live verified.', ''];
    const section = (title, data, describe) => {
      lines.push(`## ${title}`, '');
      if (!data.available) lines.push('Evidence unavailable.');
      else if (!data.count) lines.push('No matching recorded items.');
      else lines.push(...data.items.map((item) => `- ${describe(item)}`));
      if (data.truncated) lines.push(`Showing ${data.items.length} of ${data.count}.`);
      lines.push('');
    };
    section('Needs you', needsOwner, (item) => `${safeMarkdown(item.title)} — approval ${safeMarkdown(item.id)}`);
    section('Delivery needs review', deliveryReview, (item) => `${safeMarkdown(item.operation)} ${safeMarkdown(item.commit)}: ${safeMarkdown(item.state)}`);
    lines.push('## Last deployment', '', lastDeployment ? `${safeMarkdown(lastDeployment.label)} — ${safeMarkdown(lastDeployment.commit)}: ${safeMarkdown(lastDeployment.state)} (${safeMarkdown(lastDeployment.updatedAt)}).${lastDeployment.failureReason ? ` ${safeMarkdown(lastDeployment.failureReason)}.` : ''}`
      : 'No deployment operation recorded.', '');
    section('Shipped — receipt reported', shipped, (item) => `${safeMarkdown(item.label)} — ${safeMarkdown(item.commit)}: ${safeMarkdown(item.state)} at ${safeMarkdown(item.recordedAt)}`);
    section('Landed — not necessarily deployed', landed, (item) => `${safeMarkdown(item.sourceArea)}: ${safeMarkdown(item.commit)}`);
    section('Completed', completed, (item) => `${safeMarkdown(item.taskId)}: ${safeMarkdown(item.title)}`);
    section('Decisions recorded', decisions, (item) => `${safeMarkdown(item.title)}: ${safeMarkdown(item.status)} by ${safeMarkdown(item.decidedBy)}`);
    section('Blocked', blocked, (item) => `${safeMarkdown(item.taskId)}: ${safeMarkdown(item.reason)}`);
    section('Neglected owner requests', neglectedRequests, (item) => `${safeMarkdown(item.taskId)}: ${safeMarkdown(item.title)} (${item.ageDays} days)`);
    lines.push('## Coverage', '', ...coverage.map((note) => `- ${safeMarkdown(note)}`), '');
    report.markdown = lines.join('\n');
    return report;
  }

  publish({ actorId, approved = false } = {}) {
    const config = loadProjectConfig(this.repositoryRoot);
    if (!['owner', 'session-manager'].includes(actorId)) throw new TorchError('Only the owner or Fleet Operations may publish the local digest', { code: 'DIGEST_AUTHORITY_REQUIRED' });
    if (actorId === 'owner' && !approved) throw new TorchError('Local digest publication requires approval', { code: 'APPROVAL_REQUIRED' });
    if (actorId === 'session-manager' && config.owner_digest?.enabled !== true) throw new TorchError('Automatic local digest publication is disabled', { code: 'DIGEST_POLICY_DISABLED' });
    const report = this.build();
    const id = this.idFactory();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      if (actorId === 'session-manager' && loadProjectConfig(this.repositoryRoot).owner_digest?.enabled !== true) {
        throw new TorchError('Digest policy was revoked before publication', { code: 'DIGEST_POLICY_DISABLED' });
      }
      this.database.exec('CREATE TABLE IF NOT EXISTS owner_digests (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, generated_at TEXT NOT NULL, report_json TEXT NOT NULL)');
      this.database.prepare('INSERT INTO owner_digests (id, project_id, generated_at, report_json) VALUES (?, ?, ?, ?)')
        .run(id, this.controlPlane.projectId, report.generatedAt, JSON.stringify(report));
      this.controlPlane.audit({ actorId: 'session-manager', operation: 'owner-digest.publish', entityType: 'owner-digest', entityId: id,
        details: { publishedBy: actorId, generatedAt: report.generatedAt, externalDeliveryPerformed: false } });
      this.database.exec('COMMIT');
    } catch (error) { this.database.exec('ROLLBACK'); throw error; }
    return { id, report, mutationPerformed: true, externalDeliveryPerformed: false };
  }

  latest() {
    if (!hasTable(this.database, 'owner_digests')) return null;
    const row = this.database.prepare('SELECT id, report_json FROM owner_digests WHERE project_id = ? ORDER BY generated_at DESC, rowid DESC LIMIT 1').get(this.controlPlane.projectId);
    return row ? { id: row.id, report: JSON.parse(row.report_json) } : null;
  }
}
