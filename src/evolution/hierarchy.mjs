import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { BacklogService } from '../backlog/service.mjs';
import { TorchError } from '../kernel/errors.mjs';
import { loadProjectConfig, validateProjectConfig } from '../kernel/config.mjs';
import {
  organizationGraphFromConfig, planManagerCheckInSchedules, validateOrganizationGraph,
} from '../kernel/organization.mjs';
import { readInstallManifest } from '../kernel/install.mjs';

const text = z.string().trim().min(1);
const id = text.regex(/^[a-z0-9][a-z0-9-]*$/);
const evidenceSignal = z.object({
  code: id,
  summary: text,
  occurrences: z.number().int().min(1),
  affected_identities: z.array(id).min(1),
  references: z.array(text).min(2),
}).strict();
const alternative = z.object({
  type: z.enum(['no-change', 'process-change', 'specialist-change', 'promote-existing', 'add-role', 'restructure']),
  description: text,
  expected_outcome: text,
}).strict();

export const hierarchyProposalSchema = z.object({
  schema: z.literal('torch.dev/hierarchy-proposal/v1alpha1'),
  title: text,
  rationale: text,
  observation_window: z.object({
    start_at: z.string().datetime({ offset: true }),
    end_at: z.string().datetime({ offset: true }),
    days: z.number().int().min(7).max(365),
    summary: text,
  }).strict(),
  signals: z.array(evidenceSignal).min(1),
  alternatives: z.array(alternative).min(2),
  impact: z.object({
    integrated_outcome: text,
    why_existing_roles_are_insufficient: text,
    expected_benefit: text,
    added_coordination_cost: text,
    affected_identities: z.array(id).min(1),
  }).strict(),
  graph: z.unknown(),
  pilot: z.object({
    duration_days: z.number().int().min(1).max(90),
    baseline_metrics: z.array(z.object({ name: text, value: text, unit: text }).strict()).min(1),
    success_criteria: z.array(text).min(1),
    stop_criteria: z.array(text).min(1),
    reversal_plan: text,
  }).strict(),
}).strict().superRefine((proposal, context) => {
  const start = Date.parse(proposal.observation_window.start_at);
  const end = Date.parse(proposal.observation_window.end_at);
  if (end <= start) {
    context.addIssue({
      code: 'custom', path: ['observation_window', 'end_at'],
      message: 'observation window must end after it starts',
    });
  }
  const measuredDays = Math.ceil((end - start) / 86_400_000);
  if (Math.abs(measuredDays - proposal.observation_window.days) > 1) {
    context.addIssue({
      code: 'custom', path: ['observation_window', 'days'],
      message: 'observation window day count must agree with its timestamps',
    });
  }
  const totalOccurrences = proposal.signals.reduce((sum, signal) => sum + signal.occurrences, 0);
  if (proposal.signals.length < 2 && totalOccurrences < 3) {
    context.addIssue({
      code: 'custom', path: ['signals'],
      message: 'hierarchy proposals require at least two independent signals or three recurring observations',
    });
  }
  const alternativeTypes = new Set(proposal.alternatives.map((entry) => entry.type));
  for (const required of ['no-change', 'process-change', 'promote-existing']) {
    if (!alternativeTypes.has(required)) {
      context.addIssue({
        code: 'custom', path: ['alternatives'],
        message: `must explicitly consider ${required}`,
      });
    }
  }
});

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(stable(value))).digest('hex');
}

function fileDigest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function git(repositoryRoot, args) {
  return execFileSync('git', ['-C', repositoryRoot, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function rowToProposal(row) {
  if (!row) return null;
  return {
    id: row.id,
    state: row.state,
    proposer: row.proposer,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    baseCommit: row.base_commit,
    baseGraphDigest: row.base_graph_digest,
    fingerprint: row.fingerprint,
    revision: row.proposal_revision ?? 1,
    proposal: JSON.parse(row.proposal_json),
    decidedBy: row.decided_by ?? null,
    decidedAt: row.decided_at ?? null,
    decisionReason: row.decision_reason ?? null,
    activationCommit: row.activation_commit ?? null,
  };
}

function sameOwners(left, right) {
  const normalize = (owners) => owners.map((owner) => `${owner.surface}\0${owner.identity_id}`).sort();
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function normalizeProposal(input) {
  const parsed = hierarchyProposalSchema.safeParse(input);
  if (!parsed.success) {
    throw new TorchError('Hierarchy proposal is invalid', {
      code: 'HIERARCHY_PROPOSAL_INVALID',
      details: parsed.error.issues.map((issue) => ({
        path: issue.path.length ? issue.path.join('.') : '<root>',
        message: issue.message,
        code: issue.code,
      })),
    });
  }
  const proposal = parsed.data;
  try {
    proposal.graph = validateOrganizationGraph(proposal.graph);
  } catch (error) {
    throw new TorchError('Hierarchy proposal graph is invalid', {
      code: 'HIERARCHY_PROPOSAL_GRAPH_INVALID', details: error.details ?? error.message,
    });
  }
  return proposal;
}

function initialize(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS hierarchy_proposals (
      id TEXT PRIMARY KEY,
      state TEXT NOT NULL,
      proposer TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      base_commit TEXT NOT NULL,
      base_graph_digest TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      proposal_json TEXT NOT NULL,
      proposal_revision INTEGER NOT NULL DEFAULT 1,
      decided_by TEXT,
      decided_at TEXT,
      decision_reason TEXT
    );
    CREATE INDEX IF NOT EXISTS hierarchy_proposals_state_created
      ON hierarchy_proposals(state, created_at, id);
    CREATE INDEX IF NOT EXISTS hierarchy_proposals_fingerprint
      ON hierarchy_proposals(fingerprint, state);
  `);
  const columns = new Set(database.prepare('PRAGMA table_info(hierarchy_proposals)').all().map((column) => column.name));
  if (!columns.has('activation_commit')) database.exec('ALTER TABLE hierarchy_proposals ADD COLUMN activation_commit TEXT');
  if (!columns.has('proposal_revision')) database.exec('ALTER TABLE hierarchy_proposals ADD COLUMN proposal_revision INTEGER NOT NULL DEFAULT 1');
  database.exec(`
    CREATE TABLE IF NOT EXISTS hierarchy_proposal_revisions (
      proposal_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      proposal_json TEXT NOT NULL,
      proposal_digest TEXT NOT NULL,
      PRIMARY KEY (proposal_id, revision)
    );
    CREATE TABLE IF NOT EXISTS hierarchy_pilot_reviews (
      id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL,
      report_digest TEXT NOT NULL,
      report_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(proposal_id, report_digest)
    );
  `);
  for (const row of database.prepare('SELECT * FROM hierarchy_proposals').all()) {
    const proposal = JSON.parse(row.proposal_json);
    const fingerprint = digest({ baseGraphDigest: row.base_graph_digest, graph: proposal.graph });
    if (row.fingerprint !== fingerprint) {
      database.prepare('UPDATE hierarchy_proposals SET fingerprint = ? WHERE id = ?').run(fingerprint, row.id);
    }
    database.prepare(`
      INSERT OR IGNORE INTO hierarchy_proposal_revisions (
        proposal_id, revision, updated_at, updated_by, proposal_json, proposal_digest
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(row.id, row.proposal_revision ?? 1, row.updated_at, row.proposer,
      row.proposal_json, digest(proposal));
  }
}

function writeFilesAtomically(repositoryRoot, files) {
  const originals = new Map();
  for (const [relativePath] of files) {
    const path = join(repositoryRoot, relativePath);
    originals.set(path, existsSync(path) ? readFileSync(path, 'utf8') : null);
  }
  try {
    for (const [relativePath, content] of files) {
      const path = join(repositoryRoot, relativePath);
      mkdirSync(dirname(path), { recursive: true });
      const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
      writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      renameSync(temporary, path);
    }
  } catch (error) {
    for (const [path, content] of originals) {
      try {
        if (content === null) {
          if (existsSync(path)) unlinkSync(path);
          continue;
        }
        const temporary = `${path}.rollback-${process.pid}-${randomUUID()}`;
        writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        renameSync(temporary, path);
      } catch { /* preserve the original write failure */ }
    }
    throw error;
  }
  return originals;
}

export class HierarchyEvolutionService {
  constructor({ repositoryRoot, controlPlane, clock = () => new Date(), idFactory = randomUUID } = {}) {
    if (!controlPlane) throw new TorchError('Hierarchy evolution requires the TORCH control plane', { code: 'CONTROL_PLANE_REQUIRED' });
    this.repositoryRoot = resolve(repositoryRoot ?? controlPlane.repositoryRoot);
    this.controlPlane = controlPlane;
    this.database = controlPlane.database;
    this.clock = clock;
    this.idFactory = idFactory;
    initialize(this.database);
  }

  get(proposalId) {
    const idValue = text.parse(proposalId);
    const result = rowToProposal(this.database.prepare('SELECT * FROM hierarchy_proposals WHERE id = ?').get(idValue));
    if (!result) throw new TorchError(`Unknown hierarchy proposal: ${idValue}`, { code: 'HIERARCHY_PROPOSAL_NOT_FOUND' });
    return result;
  }

  list({ state } = {}) {
    const states = ['proposed', 'pilot-approved', 'deferred', 'rejected', 'piloting', 'adopted', 'reversed'];
    if (state && !states.includes(state)) {
      throw new TorchError(`Invalid hierarchy proposal state: ${state}`, { code: 'HIERARCHY_PROPOSAL_STATE_INVALID' });
    }
    const rows = state
      ? this.database.prepare('SELECT * FROM hierarchy_proposals WHERE state = ? ORDER BY created_at, id').all(state)
      : this.database.prepare('SELECT * FROM hierarchy_proposals ORDER BY created_at, id').all();
    return rows.map(rowToProposal);
  }

  proposalHistory(proposalId) {
    const record = this.get(proposalId);
    return this.database.prepare(`
      SELECT revision, updated_at, updated_by, proposal_json, proposal_digest
      FROM hierarchy_proposal_revisions WHERE proposal_id = ? ORDER BY revision
    `).all(record.id).map((row) => ({
      revision: row.revision, updatedAt: row.updated_at, updatedBy: row.updated_by,
      proposal: JSON.parse(row.proposal_json), digest: row.proposal_digest,
    }));
  }

  pilotReviews(proposalId) {
    const record = this.get(proposalId);
    return this.database.prepare(`SELECT report_json FROM hierarchy_pilot_reviews
      WHERE proposal_id = ? ORDER BY created_at, id`).all(record.id)
      .map((row) => JSON.parse(row.report_json));
  }

  recordPilotReview({ proposalId, reviewer = 'session-manager', review } = {}) {
    const actor = this.controlPlane.assertIdentity(reviewer);
    if (actor !== 'session-manager') throw new TorchError('Only the Session Manager may submit pilot review evidence.', {
      code: 'HIERARCHY_REVIEW_AUTHORITY_REQUIRED',
    });
    const record = this.get(proposalId);
    if (record.state !== 'piloting') throw new TorchError('Pilot review requires an activated pilot.', {
      code: 'HIERARCHY_PILOT_REVIEW_BLOCKED',
    });
    const schema = z.object({
      summary: text,
      recommendation: z.enum(['adopt', 'adjust', 'reverse', 'inconclusive']),
      metrics: z.array(z.object({
        name: text, value: text, unit: text,
        classification: z.enum(['measured', 'qualitative', 'unavailable']),
        evidence: z.array(text).min(1),
      }).strict()),
      success: z.array(z.object({ criterion: text, outcome: z.enum(['met', 'not-met', 'unknown']), evidence: z.array(text).min(1) }).strict()),
      stop: z.array(z.object({ criterion: text, outcome: z.enum(['met', 'not-met', 'unknown']), evidence: z.array(text).min(1) }).strict()),
    }).strict();
    const parsed = schema.safeParse(review);
    if (!parsed.success) throw new TorchError('Pilot review evidence is invalid.', {
      code: 'HIERARCHY_REVIEW_INVALID', details: parsed.error.issues,
    });
    const evidence = parsed.data;
    const pilotPath = `.torch/hierarchy-pilots/${record.id}.json`;
    const bytes = readFileSync(join(this.repositoryRoot, pilotPath), 'utf8');
    const manifest = readInstallManifest(this.repositoryRoot);
    const owned = manifest.created.find((entry) => entry.path === pilotPath);
    if (!owned || owned.sha256 !== createHash('sha256').update(bytes).digest('hex')) {
      throw new TorchError('Pilot record has changed outside its owned manifest.', { code: 'HIERARCHY_PILOT_RECORD_CHANGED' });
    }
    const pilot = JSON.parse(bytes);
    const currentGraph = organizationGraphFromConfig(loadProjectConfig(this.repositoryRoot));
    if (digest(currentGraph) !== digest(pilot.graph)) throw new TorchError('Pilot graph is no longer active.', {
      code: 'HIERARCHY_PILOT_REVIEW_BLOCKED',
    });
    const exactCoverage = (expected, actual, key) => expected.length === actual.length
      && new Set(actual.map((item) => item[key])).size === actual.length
      && expected.every((name) => actual.some((item) => item[key] === name));
    if (!exactCoverage(record.proposal.pilot.baseline_metrics.map((metric) => metric.name), evidence.metrics, 'name')
      || !exactCoverage(record.proposal.pilot.success_criteria, evidence.success, 'criterion')
      || !exactCoverage(record.proposal.pilot.stop_criteria, evidence.stop, 'criterion')) {
      throw new TorchError('Review must cover each baseline metric and success/stop criterion exactly once.', {
        code: 'HIERARCHY_REVIEW_INCOMPLETE',
      });
    }
    const comparisons = record.proposal.pilot.baseline_metrics.map((baseline) => {
      const observed = evidence.metrics.find((metric) => metric.name === baseline.name);
      if (observed.unit !== baseline.unit) throw new TorchError('Observed metric units must match the baseline.', {
        code: 'HIERARCHY_REVIEW_UNIT_MISMATCH', details: { metric: baseline.name },
      });
      return { name: baseline.name, unit: baseline.unit, baseline: baseline.value,
        observed: observed.value, classification: observed.classification, evidence: observed.evidence };
    });
    const reviewedAt = this.clock().toISOString();
    const dueAt = new Date(Date.parse(pilot.activatedAt) + pilot.pilot.duration_days * 86_400_000).toISOString();
    if (Date.parse(reviewedAt) < Date.parse(pilot.activatedAt)) throw new TorchError('Review predates pilot activation.', {
      code: 'HIERARCHY_REVIEW_TIME_INVALID',
    });
    const windowComplete = Date.parse(reviewedAt) >= Date.parse(dueAt);
    if (evidence.recommendation === 'adopt' && (!windowComplete
      || comparisons.some((metric) => metric.classification !== 'measured')
      || evidence.success.some((entry) => entry.outcome !== 'met')
      || evidence.stop.some((entry) => entry.outcome !== 'not-met'))) {
      throw new TorchError('Adoption recommendation requires a complete window, measured comparisons and passing criteria.', {
        code: 'HIERARCHY_REVIEW_ADOPTION_UNPROVEN',
      });
    }
    const content = { proposalId: record.id, activationCommit: record.activationCommit,
      graphDigest: digest(currentGraph), window: { startedAt: pilot.activatedAt, dueAt, complete: windowComplete },
      reviewer: actor, summary: evidence.summary, recommendation: evidence.recommendation,
      comparisons, success: evidence.success, stop: evidence.stop,
      evidenceVerification: 'reviewer-reported', ownerDecisionRequired: true,
      mutationPerformed: true, organizationChanged: false, runtimeStarted: false };
    const fingerprint = digest(content);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.database.prepare(`SELECT report_json FROM hierarchy_pilot_reviews
        WHERE proposal_id = ? AND report_digest = ?`).get(record.id, fingerprint);
      if (existing) {
        this.database.exec('COMMIT');
        return { ...JSON.parse(existing.report_json), deduplicated: true };
      }
      const report = { id: this.idFactory(), reviewedAt, ...content };
      this.database.prepare(`INSERT INTO hierarchy_pilot_reviews
        (id, proposal_id, report_digest, report_json, created_at) VALUES (?, ?, ?, ?, ?)`)
        .run(report.id, record.id, fingerprint, JSON.stringify(report), reviewedAt);
      this.controlPlane.audit({ actorId: actor, operation: 'hierarchy.review-pilot',
        entityType: 'hierarchy-proposal', entityId: record.id,
        details: { reviewId: report.id, recommendation: report.recommendation, ownerDecisionRequired: true },
      });
      this.database.exec('COMMIT');
      return { ...report, deduplicated: false };
    } catch (error) {
      try { this.database.exec('ROLLBACK'); } catch { /* preserve original error */ }
      throw error;
    }
  }

  assess({ assessor = 'session-manager', at = this.clock() } = {}) {
    const actor = this.controlPlane.assertIdentity(assessor);
    if (actor !== 'session-manager') {
      throw new TorchError('Only the Session Manager may assess hierarchy coordination pressure', {
        code: 'HIERARCHY_ASSESSMENT_AUTHORITY_REQUIRED', details: { actor },
      });
    }
    const assessedAt = at instanceof Date ? new Date(at) : new Date(at);
    if (!Number.isFinite(assessedAt.getTime())) {
      throw new TorchError('Hierarchy assessment requires a valid timestamp', {
        code: 'HIERARCHY_ASSESSMENT_TIME_INVALID',
      });
    }
    const config = loadProjectConfig(this.repositoryRoot);
    const observationWindowDays = config.organization_assessment?.observation_window_days ?? 30;
    const minimumRecurrences = config.organization_assessment?.minimum_recurrences ?? 3;
    const windowStart = new Date(assessedAt.getTime() - observationWindowDays * 86_400_000);
    const withinWindow = (value) => {
      const timestamp = Date.parse(value);
      return Number.isFinite(timestamp) && timestamp >= windowStart.getTime()
        && timestamp <= assessedAt.getTime();
    };
    const signals = [];
    const unique = (values) => [...new Set(values.filter(Boolean))].sort();
    const activeIdentities = new Set(this.controlPlane.listAgents().map((agent) => agent.areaId));
    const addRecurringSignal = (code, summary, events, identities, reference) => {
      if (events.length < 2) return;
      const references = unique(events.map(reference));
      if (references.length < 2) return;
      signals.push({
        code, summary, occurrences: events.length,
        affected_identities: unique(identities).filter((identity) => activeIdentities.has(identity)), references,
      });
    };

    const tasks = new BacklogService({
      repositoryRoot: this.repositoryRoot, controlPlane: this.controlPlane,
    }).list();
    const recurringTasks = new Map();
    for (const task of tasks) {
      const occurredAt = (task.history ?? []).some((event) => withinWindow(event.at))
        || withinWindow(task.createdAt);
      const domains = unique(task.affectedDomains ?? []);
      if (!occurredAt || domains.length < 2) continue;
      const key = domains.join(',');
      const entries = recurringTasks.get(key) ?? [];
      entries.push(task);
      recurringTasks.set(key, entries);
    }
    for (const [domainSet, entries] of recurringTasks) {
      const domainIds = domainSet.split(',');
      addRecurringSignal(
        'recurring-multi-domain-work',
        `Distinct backlog tasks repeatedly span ${domainIds.join(', ')} during the observation window.`,
        entries, ['session-manager', ...domainIds], (task) => `backlog:${task.id}`,
      );
    }

    const coordinationRequests = this.database.prepare(`
      SELECT m.id, m.sender_id AS sender, m.created_at AS createdAt,
        m.task_ref AS task, a.acknowledged_at AS acknowledgedAt
      FROM messages m
      LEFT JOIN message_acks a ON a.message_id = m.id AND a.area_id = m.recipient_id
      WHERE m.project_id = ? AND m.recipient_id = 'session-manager'
        AND m.kind = 'coordination-request'
      ORDER BY m.created_at, m.id
    `).all(this.controlPlane.projectId).filter((event) => withinWindow(event.createdAt));
    addRecurringSignal(
      'recurring-manager-coordination-requests',
      `Repeated direct coordination requests reached the Session Manager; ${coordinationRequests.filter((event) => !event.acknowledgedAt).length} remain unacknowledged.`,
      coordinationRequests, ['session-manager', ...coordinationRequests.map((event) => event.sender)],
      (event) => `message:${event.id}`,
    );

    const approvals = this.database.prepare(`
      SELECT id, requester_id AS requester, created_at AS createdAt,
        decided_at AS decidedAt, status
      FROM approval_requests
      WHERE project_id = ? AND approver_id = 'session-manager'
      ORDER BY created_at, id
    `).all(this.controlPlane.projectId).filter((event) => withinWindow(event.createdAt));
    addRecurringSignal(
      'recurring-manager-approval-waits',
      `Named owner-facing approval requests recurred; ${approvals.filter((event) => event.status === 'pending').length} are still pending.`,
      approvals, ['session-manager', ...approvals.map((event) => event.requester)],
      (event) => `approval:${event.id}`,
    );

    const handoffs = this.database.prepare(`
      SELECT id, sender_id AS sender, created_at AS createdAt, path_ref AS path, task_ref AS task
      FROM handoffs WHERE project_id = ? AND recipient_id = 'session-manager'
      ORDER BY created_at, id
    `).all(this.controlPlane.projectId).filter((event) => withinWindow(event.createdAt));
    addRecurringSignal(
      'recurring-manager-handoffs',
      'Handoff requests repeatedly routed to the Session Manager during the observation window.',
      handoffs, ['session-manager', ...handoffs.map((event) => event.sender)],
      (event) => `handoff:${event.id}`,
    );

    const repeatedOccurrences = signals.reduce((sum, signal) => sum + signal.occurrences, 0);
    const qualifies = signals.length >= 2
      || signals.some((signal) => signal.occurrences >= minimumRecurrences);
    const graph = organizationGraphFromConfig(config);
    return {
      schema: 'torch.dev/hierarchy-assessment/v1alpha1',
      assessedAt: assessedAt.toISOString(), assessor: actor,
      observationWindow: {
        startAt: windowStart.toISOString(), endAt: assessedAt.toISOString(),
        days: observationWindowDays,
        summary: `Read-only scan of durable Fleet events from ${windowStart.toISOString()} through ${assessedAt.toISOString()}.`,
      },
      organizationRevision: graph.revision,
      signals,
      recommendation: qualifies ? {
        action: 'consider-coordination-role',
        reason: 'Recurring measured coordination signals justify Session Manager review, not automatic role creation.',
        requiresManagerJudgment: true, requiresOwnerApproval: true,
        nextTool: 'torch_propose_hierarchy_change',
      } : {
        action: 'retain-current-organization',
        reason: 'The configured window contains no repeated structural signal above the conservative threshold.',
        requiresManagerJudgment: true, requiresOwnerApproval: true, nextTool: null,
      },
      threshold: { independentSignalsRequired: 2, minimumRecurrences, observedRecurrences: repeatedOccurrences },
      sourceCounts: {
        backlogTasksInWindow: tasks.filter((task) => withinWindow(task.createdAt)
          || (task.history ?? []).some((event) => withinWindow(event.at))).length,
        coordinationRequests: coordinationRequests.length,
        approvalRequestsToSessionManager: approvals.length,
        handoffsToSessionManager: handoffs.length,
      },
      mutationPerformed: false,
    };
  }

  propose({ proposer, proposal: input } = {}) {
    const actor = this.controlPlane.assertIdentity(proposer);
    if (actor !== 'session-manager') {
      throw new TorchError('Only the owner-facing Session Manager may propose an organization change', {
        code: 'HIERARCHY_PROPOSAL_AUTHORITY_REQUIRED', details: { actor },
      });
    }
    const proposal = normalizeProposal(input);
    if (Date.parse(proposal.observation_window.end_at) > this.clock().getTime()) {
      throw new TorchError('Hierarchy proposal evidence window cannot end in the future', {
        code: 'HIERARCHY_OBSERVATION_WINDOW_FUTURE',
      });
    }
    const config = loadProjectConfig(this.repositoryRoot);
    const currentGraph = organizationGraphFromConfig(config);
    const activeIdentities = new Set(['owner', ...this.controlPlane.listAgents().map((agent) => agent.areaId)]);
    const proposedIdentities = new Set(proposal.graph.roles.map((role) => role.identity_id));
    const referencedIdentities = [
      ...proposedIdentities,
      ...proposal.signals.flatMap((signal) => signal.affected_identities),
      ...proposal.impact.affected_identities,
    ];
    const unknownIdentities = [...new Set(referencedIdentities)].filter((identity) => !activeIdentities.has(identity));
    if (unknownIdentities.length) {
      throw new TorchError('Hierarchy proposals must reference active Fleet identities; propose new sessions through Fleet evolution first', {
        code: 'HIERARCHY_IDENTITY_UNKNOWN', details: { identities: unknownIdentities },
      });
    }
    if (proposal.graph.revision !== currentGraph.revision + 1) {
      throw new TorchError('Proposed organization graph must increment the active revision exactly once', {
        code: 'HIERARCHY_REVISION_CONFLICT',
        details: { currentRevision: currentGraph.revision, proposedRevision: proposal.graph.revision },
      });
    }
    if (!sameOwners(currentGraph.implementation_owners, proposal.graph.implementation_owners)) {
      throw new TorchError('Hierarchy proposals cannot change implementation ownership; propose a separate domain-boundary change', {
        code: 'HIERARCHY_IMPLEMENTATION_OWNERSHIP_CHANGED',
      });
    }
    const baseGraphDigest = digest(currentGraph);
    // Group one open review by structural intent. Materially newer evidence
    // revises that review; once it is decided, a later observation window can
    // create a new proposal for the same graph without being suppressed.
    const fingerprint = digest({ baseGraphDigest, graph: proposal.graph });
    const duplicate = this.database.prepare(`
      SELECT * FROM hierarchy_proposals WHERE fingerprint = ? AND state = 'proposed'
      ORDER BY created_at DESC LIMIT 1
    `).get(fingerprint);
    if (duplicate) {
      const existingProposal = JSON.parse(duplicate.proposal_json);
      const existingDigest = digest(existingProposal);
      const proposedDigest = digest(proposal);
      if (existingDigest === proposedDigest) return { ...rowToProposal(duplicate), deduplicated: true };
      if (Date.parse(proposal.observation_window.end_at)
        <= Date.parse(existingProposal.observation_window.end_at)) {
        throw new TorchError('A material update to an open hierarchy proposal requires a later evidence window', {
          code: 'HIERARCHY_EVIDENCE_WINDOW_NOT_ADVANCED',
          details: {
            existingEndAt: existingProposal.observation_window.end_at,
            proposedEndAt: proposal.observation_window.end_at,
          },
        });
      }
      const now = this.clock().toISOString();
      const revision = (duplicate.proposal_revision ?? 1) + 1;
      const baseCommit = git(this.repositoryRoot, ['rev-parse', 'HEAD']);
      const database = this.database;
      database.exec('BEGIN IMMEDIATE');
      try {
        const update = database.prepare(`
          UPDATE hierarchy_proposals SET proposal_json = ?, proposal_revision = ?,
            base_commit = ?, updated_at = ?
          WHERE id = ? AND state = 'proposed' AND proposal_revision = ?
        `).run(JSON.stringify(proposal), revision, baseCommit, now, duplicate.id,
          duplicate.proposal_revision ?? 1);
        if (update.changes !== 1) {
          throw new TorchError('Hierarchy proposal changed during evidence refresh', {
            code: 'HIERARCHY_PROPOSAL_REVISION_CONFLICT', details: { proposalId: duplicate.id },
          });
        }
        database.prepare(`
          INSERT INTO hierarchy_proposal_revisions (
            proposal_id, revision, updated_at, updated_by, proposal_json, proposal_digest
          ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(duplicate.id, revision, now, actor, JSON.stringify(proposal), proposedDigest);
        this.controlPlane.audit({
          actorId: actor, operation: 'hierarchy.update-evidence',
          entityType: 'hierarchy-proposal', entityId: duplicate.id,
          details: {
            revision, previousDigest: existingDigest, proposalDigest: proposedDigest,
            previousWindowEndAt: existingProposal.observation_window.end_at,
            observationWindowEndAt: proposal.observation_window.end_at, baseCommit,
          },
        });
        database.exec('COMMIT');
      } catch (error) {
        try { database.exec('ROLLBACK'); } catch { /* preserve the original failure */ }
        throw error;
      }
      return {
        ...rowToProposal(database.prepare('SELECT * FROM hierarchy_proposals WHERE id = ?').get(duplicate.id)),
        updatedEvidence: true,
      };
    }

    const priorDecision = this.database.prepare(`
      SELECT proposal_json FROM hierarchy_proposals
      WHERE fingerprint = ? AND state IN ('deferred', 'rejected', 'pilot-approved', 'piloting', 'adopted', 'reversed')
      ORDER BY updated_at DESC, created_at DESC LIMIT 1
    `).get(fingerprint);
    if (priorDecision) {
      const priorProposal = JSON.parse(priorDecision.proposal_json);
      if (Date.parse(proposal.observation_window.end_at)
        <= Date.parse(priorProposal.observation_window.end_at)) {
        throw new TorchError('Reconsidering a decided hierarchy proposal requires a later evidence window', {
          code: 'HIERARCHY_EVIDENCE_WINDOW_NOT_ADVANCED',
          details: {
            previousEndAt: priorProposal.observation_window.end_at,
            proposedEndAt: proposal.observation_window.end_at,
          },
        });
      }
    }

    const now = this.clock().toISOString();
    const record = {
      id: this.idFactory(), state: 'proposed', proposer: actor, createdAt: now, updatedAt: now,
      baseCommit: git(this.repositoryRoot, ['rev-parse', 'HEAD']), baseGraphDigest, fingerprint,
      revision: 1, proposal, decidedBy: null, decidedAt: null, decisionReason: null,
    };
    this.database.prepare(`
      INSERT INTO hierarchy_proposals (
        id, state, proposer, created_at, updated_at, base_commit, base_graph_digest,
        fingerprint, proposal_json, proposal_revision, decided_by, decided_at, decision_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, NULL, NULL)
    `).run(
      record.id, record.state, record.proposer, record.createdAt, record.updatedAt,
      record.baseCommit, record.baseGraphDigest, record.fingerprint, JSON.stringify(record.proposal),
    );
    this.database.prepare(`
      INSERT INTO hierarchy_proposal_revisions (
        proposal_id, revision, updated_at, updated_by, proposal_json, proposal_digest
      ) VALUES (?, 1, ?, ?, ?, ?)
    `).run(record.id, record.updatedAt, actor, JSON.stringify(record.proposal), digest(record.proposal));
    this.controlPlane.audit({
      actorId: actor, operation: 'hierarchy.propose', entityType: 'hierarchy-proposal', entityId: record.id,
      details: { baseCommit: record.baseCommit, graphRevision: proposal.graph.revision },
    });
    return record;
  }

  decide({ proposalId, decision, decidedBy, reason } = {}) {
    const record = this.get(proposalId);
    if (record.state !== 'proposed') {
      throw new TorchError(`Hierarchy proposal ${record.id} is ${record.state}, not proposed`, {
        code: 'HIERARCHY_PROPOSAL_STATE_CONFLICT',
      });
    }
    if (!['approve-pilot', 'defer', 'reject'].includes(decision)) {
      throw new TorchError(`Unsupported hierarchy decision: ${decision}`, { code: 'HIERARCHY_DECISION_INVALID' });
    }
    const actor = text.parse(decidedBy);
    const activeGraph = organizationGraphFromConfig(loadProjectConfig(this.repositoryRoot));
    const ownerIdentity = activeGraph.roles.find((role) => role.kind === 'owner')?.identity_id;
    if (actor !== ownerIdentity) {
      throw new TorchError('Only the project owner may decide a hierarchy proposal', {
        code: 'HIERARCHY_OWNER_AUTHORITY_REQUIRED', details: { actor },
      });
    }
    const explanation = decision === 'approve-pilot' ? (reason ? text.parse(reason) : null) : text.parse(reason);
    const state = { 'approve-pilot': 'pilot-approved', defer: 'deferred', reject: 'rejected' }[decision];
    const now = this.clock().toISOString();
    this.database.prepare(`
      UPDATE hierarchy_proposals SET state = ?, updated_at = ?, decided_by = ?, decided_at = ?, decision_reason = ?
      WHERE id = ? AND state = 'proposed'
    `).run(state, now, actor, now, explanation, record.id);
    this.controlPlane.audit({
      actorId: 'session-manager', operation: `hierarchy.${decision}`,
      entityType: 'hierarchy-proposal', entityId: record.id,
      details: { decidedBy: actor, reason: explanation, authorityVerifiedAgainst: ownerIdentity },
    });
    return this.get(record.id);
  }

  planConclusion({ proposalId, decision, reason } = {}) {
    if (!['adopt', 'reverse'].includes(decision)) throw new TorchError('Unsupported pilot conclusion.', { code: 'HIERARCHY_DECISION_INVALID' });
    const explanation = text.parse(reason);
    const record = this.get(proposalId);
    const config = loadProjectConfig(this.repositoryRoot);
    const currentGraph = organizationGraphFromConfig(config);
    const currentHead = git(this.repositoryRoot, ['rev-parse', 'HEAD']);
    const dirtyEntries = git(this.repositoryRoot, ['status', '--porcelain']).split('\n').filter(Boolean);
    const manifest = readInstallManifest(this.repositoryRoot);
    const pilotPath = `.torch/hierarchy-pilots/${record.id}.json`;
    const blockers = [];
    if (record.state !== 'piloting') blockers.push({ type: 'pilot-not-active', state: record.state });
    if (dirtyEntries.length) blockers.push({ type: 'repository-dirty', paths: dirtyEntries });
    let pilot = null;
    let pilotDigest = null;
    if (existsSync(join(this.repositoryRoot, pilotPath))) {
      const bytes = readFileSync(join(this.repositoryRoot, pilotPath), 'utf8');
      pilotDigest = createHash('sha256').update(bytes).digest('hex');
      if (manifest.created.find((entry) => entry.path === pilotPath)?.sha256 !== pilotDigest) {
        blockers.push({ type: 'pilot-record-changed' });
      }
      pilot = JSON.parse(bytes);
    } else blockers.push({ type: 'pilot-record-missing' });
    if (!pilot || digest(currentGraph) !== digest(pilot.graph)) blockers.push({ type: 'pilot-graph-no-longer-active' });
    const latestReview = this.pilotReviews(record.id).at(-1) ?? null;
    const now = this.clock().getTime();
    const pilotDueAt = pilot ? Date.parse(pilot.activatedAt) + pilot.pilot.duration_days * 86_400_000 : NaN;
    if (decision === 'adopt' && (!latestReview || latestReview.recommendation !== 'adopt'
      || latestReview.window.complete !== true || latestReview.graphDigest !== digest(currentGraph)
      || !Number.isFinite(pilotDueAt) || now < pilotDueAt
      || !Number.isFinite(Date.parse(latestReview.reviewedAt)) || Date.parse(latestReview.reviewedAt) > now)) {
      blockers.push({ type: 'adoption-review-required' });
    }
    const nextConfig = structuredClone(config);
    if (decision === 'reverse' && pilot) {
      const priorConfig = JSON.parse(git(this.repositoryRoot, ['show', `${record.baseCommit}:.torch/torch.yaml`]));
      const priorGraph = organizationGraphFromConfig(priorConfig);
      if (!sameOwners(priorGraph.implementation_owners, currentGraph.implementation_owners)) {
        blockers.push({ type: 'implementation-ownership-changed' });
      }
      const identities = new Set(['owner', ...this.controlPlane.listAgents().map((agent) => agent.areaId)]);
      const missing = priorGraph.roles.filter((role) => !identities.has(role.identity_id)).map((role) => role.identity_id);
      if (missing.length) blockers.push({ type: 'prior-identities-missing', identities: missing });
      nextConfig.organization = validateOrganizationGraph({ ...priorGraph, revision: currentGraph.revision + 1 });
      // Retain existing schedules, including pilot additions, for explicit owner review.
      // Removing them here could discard an owner-adjusted cadence or running timer contract.
    }
    const validated = validateProjectConfig(nextConfig);
    const activeWork = new BacklogService({ repositoryRoot: this.repositoryRoot, controlPlane: this.controlPlane })
      .list().filter((task) => !['completed', 'cancelled'].includes(task.state))
      .map((task) => ({ id: task.id, owner: task.owner, state: task.state, revision: task.revision }));
    const schedulePlan = planManagerCheckInSchedules({ graph: organizationGraphFromConfig(validated), schedules: validated.schedules ?? [] });
    const plan = { action: `${decision}-hierarchy-pilot`, proposalId: record.id,
      decision, reason: explanation, currentHead, currentGraphDigest: digest(currentGraph),
      pilotDigest, manifestDigest: digest(manifest), state: record.state,
      latestReviewId: latestReview?.id ?? null,
      evidenceVerification: latestReview?.evidenceVerification ?? 'unavailable',
      nextGraph: organizationGraphFromConfig(validated), activeWork,
      preservedIdentities: this.controlPlane.listAgents().map((agent) => agent.areaId).sort(),
      obsoleteScheduleCandidates: schedulePlan.obsolete.map((schedule) => schedule.id),
      schedulesRetained: true,
      timerReconciliationRequired: decision === 'reverse'
        && (manifest.external ?? []).some((entry) => entry.type === 'systemd-user-unit'),
      blockers, canProceed: blockers.length === 0,
      mutationPerformed: false, runtimeStarted: false };
    return { ...plan, planHash: digest(plan) };
  }

  concludePilot({ proposalId, decision, reason, decidedBy, approved = false, planHash } = {}) {
    this.controlPlane.assertOwnerActor(decidedBy);
    if (!approved) throw new TorchError('Pilot conclusion requires explicit owner confirmation.', { code: 'APPROVAL_REQUIRED' });
    const previous = this.get(proposalId);
    const receiptPath = `.torch/hierarchy-pilots/${previous.id}.json`;
    const receiptBytes = existsSync(join(this.repositoryRoot, receiptPath))
      ? readFileSync(join(this.repositoryRoot, receiptPath), 'utf8') : null;
    const receipt = receiptBytes ? JSON.parse(receiptBytes) : null;
    if (['adopted', 'reversed'].includes(receipt?.state)) {
      const manifest = readInstallManifest(this.repositoryRoot);
      if (manifest.created.find((entry) => entry.path === receiptPath)?.sha256
          !== createHash('sha256').update(receiptBytes).digest('hex')
        || receipt.conclusion?.planHash !== planHash || receipt.conclusion?.decidedBy !== decidedBy
        || receipt.conclusion?.reason !== reason?.trim()
        || receipt.state !== ({ adopt: 'adopted', reverse: 'reversed' })[decision]) {
        throw new TorchError('Confirmation does not match the recorded conclusion.', { code: 'HIERARCHY_CONCLUSION_PLAN_STALE' });
      }
      if (previous.state === receipt.state) return { ...previous, replay: true, mutationPerformed: false, runtimeStarted: false };
      // Recover a completed tracked commit whose local SQLite update was interrupted.
      if (previous.state !== 'piloting'
        || digest(organizationGraphFromConfig(loadProjectConfig(this.repositoryRoot))) !== digest(receipt.conclusion.resultingGraph)
        || git(this.repositoryRoot, ['status', '--porcelain']).trim()) {
        throw new TorchError('Committed conclusion needs manual inspection before reconciliation.', { code: 'HIERARCHY_CONCLUSION_BLOCKED' });
      }
      const committed = git(this.repositoryRoot, ['show', `HEAD:${receiptPath}`]);
      if (digest(JSON.parse(committed)) !== digest(receipt)) throw new TorchError('Conclusion receipt is not committed.', { code: 'HIERARCHY_CONCLUSION_BLOCKED' });
      this.#recordConclusion({ record: previous, state: receipt.state, concludedAt: receipt.conclusion.concludedAt,
        decidedBy, decision, reason: receipt.conclusion.reason, reviewId: receipt.conclusion.reviewId,
        conclusionCommit: git(this.repositoryRoot, ['log', '-1', '--format=%H', '--', receiptPath]),
        graphRevision: receipt.conclusion.resultingGraph.revision,
        timerReconciliationRequired: receipt.conclusion.timerReconciliationRequired,
      });
      return { ...this.get(previous.id), reconciled: true, mutationPerformed: true, runtimeStarted: false };
    }
    const plan = this.planConclusion({ proposalId, decision, reason });
    if (!plan.canProceed) throw new TorchError('Pilot conclusion is blocked.', { code: 'HIERARCHY_CONCLUSION_BLOCKED', details: plan.blockers });
    if (!planHash || planHash !== plan.planHash) throw new TorchError('Review the fresh pilot conclusion plan before confirming.', {
      code: 'HIERARCHY_CONCLUSION_PLAN_STALE',
    });
    const config = loadProjectConfig(this.repositoryRoot);
    if (decision === 'reverse') config.organization = plan.nextGraph;
    validateProjectConfig(config);
    const record = this.get(proposalId);
    const pilotPath = `.torch/hierarchy-pilots/${record.id}.json`;
    const pilot = JSON.parse(readFileSync(join(this.repositoryRoot, pilotPath), 'utf8'));
    const state = decision === 'adopt' ? 'adopted' : 'reversed';
    const concludedAt = this.clock().toISOString();
    pilot.state = state;
    pilot.conclusion = { decidedBy, reason: plan.reason, concludedAt,
      reviewId: plan.latestReviewId, previousGraph: pilot.graph, resultingGraph: plan.nextGraph,
      planHash: plan.planHash, timerReconciliationRequired: plan.timerReconciliationRequired,
      schedulesRetained: true, obsoleteScheduleCandidates: plan.obsoleteScheduleCandidates };
    const manifest = readInstallManifest(this.repositoryRoot);
    const files = new Map([[pilotPath, `${JSON.stringify(pilot, null, 2)}\n`]]);
    if (decision === 'reverse') files.set('.torch/torch.yaml', `${JSON.stringify(config, null, 2)}\n`);
    for (const [path, content] of files) {
      const entry = manifest.created.find((item) => item.path === path);
      if (!entry) throw new TorchError('Manifest does not own conclusion files.', { code: 'HIERARCHY_INSTALL_MANIFEST_INVALID' });
      entry.sha256 = createHash('sha256').update(content).digest('hex');
    }
    files.set('.torch/install-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
    const originals = writeFilesAtomically(this.repositoryRoot, files);
    let conclusionCommit;
    const message = `chore(torch): ${decision} hierarchy pilot ${record.id}`;
    try {
      git(this.repositoryRoot, ['add', ...files.keys()]);
      git(this.repositoryRoot, ['commit', '-m', message]);
      conclusionCommit = git(this.repositoryRoot, ['rev-parse', 'HEAD']);
    } catch (error) {
      const head = git(this.repositoryRoot, ['rev-parse', 'HEAD']);
      if (head !== plan.currentHead && git(this.repositoryRoot, ['show', '-s', '--format=%s', 'HEAD']) === message) {
        conclusionCommit = head;
      } else {
        try { git(this.repositoryRoot, ['restore', '--staged', '--', ...files.keys()]); } catch { /* best effort */ }
        for (const [path, content] of originals) {
          const temporary = `${path}.rollback-${process.pid}-${randomUUID()}`;
          writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
          renameSync(temporary, path);
        }
        throw new TorchError('Conclusion files restored after commit failure.', { code: 'HIERARCHY_CONCLUSION_COMMIT_FAILED', details: error.message });
      }
    }
    this.#recordConclusion({ record, state, concludedAt, decidedBy, decision,
      reason: plan.reason, reviewId: plan.latestReviewId, conclusionCommit,
      graphRevision: plan.nextGraph.revision, timerReconciliationRequired: plan.timerReconciliationRequired });
    return { ...this.get(record.id), conclusionCommit, concludedAt,
      obsoleteScheduleCandidates: plan.obsoleteScheduleCandidates,
      timerReconciliationRequired: plan.timerReconciliationRequired,
      runtimeStarted: false, mutationPerformed: true };
  }

  #recordConclusion({ record, state, concludedAt, decidedBy, decision, reason, reviewId,
    conclusionCommit, graphRevision, timerReconciliationRequired }) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const update = this.database.prepare(`UPDATE hierarchy_proposals SET state = ?, updated_at = ?, decision_reason = ?
        WHERE id = ? AND state = 'piloting'`).run(state, concludedAt, reason, record.id);
      if (update.changes !== 1) throw new TorchError('Pilot state changed before conclusion was recorded.', {
        code: 'HIERARCHY_CONCLUSION_BLOCKED',
      });
      this.controlPlane.auditOwnerAction({ actorId: decidedBy, operation: 'hierarchy.conclude-pilot',
        entityType: 'hierarchy-proposal', entityId: record.id,
        details: { decision, reason, reviewId, conclusionCommit, graphRevision, timerReconciliationRequired },
      });
      this.database.exec('COMMIT');
    } catch (error) {
      try { this.database.exec('ROLLBACK'); } catch { /* preserve original failure */ }
      throw error;
    }
  }

  planPilot(proposalId) {
    const record = this.get(proposalId);
    const config = loadProjectConfig(this.repositoryRoot);
    const currentGraph = organizationGraphFromConfig(config);
    const currentHead = git(this.repositoryRoot, ['rev-parse', 'HEAD']);
    const dirtyEntries = git(this.repositoryRoot, ['status', '--porcelain']).split('\n').filter(Boolean);
    const currentGraphDigest = digest(currentGraph);
    const manifest = readInstallManifest(this.repositoryRoot);
    const activeIdentities = new Set(['owner', ...this.controlPlane.listAgents().map((agent) => agent.areaId)]);
    const activeTasks = new BacklogService({
      repositoryRoot: this.repositoryRoot, controlPlane: this.controlPlane,
    }).list().filter((task) => [
      'assigned', 'in_progress', 'blocked', 'verification', 'ready_to_integrate',
    ].includes(task.state));
    const worktrees = (manifest.external ?? [])
      .filter((entry) => entry.type === 'worktree')
      .map(({ area, path }) => ({ area, path }));
    const installedLaunchers = (manifest.external ?? []).filter((entry) => entry.type === 'systemd-user-unit');
    const blockers = [];
    blockers.push(...installedLaunchers
      .filter((entry) => !existsSync(entry.path) || fileDigest(entry.path) !== entry.sha256)
      .map((entry) => ({ type: 'schedule-launcher-integrity', path: entry.path })));
    if (record.state !== 'pilot-approved') blockers.push({ type: 'owner-pilot-approval-required', state: record.state });
    if (currentHead !== record.baseCommit) blockers.push({ type: 'stale-base-commit', expected: record.baseCommit, actual: currentHead });
    if (currentGraphDigest !== record.baseGraphDigest) blockers.push({ type: 'organization-changed', expected: record.baseGraphDigest, actual: currentGraphDigest });
    if (dirtyEntries.length) blockers.push({ type: 'repository-dirty', entries: dirtyEntries });
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,100}$/.test(record.id)) {
      blockers.push({ type: 'unsafe-proposal-id', proposalId: record.id });
    }
    const pilotRecordPath = `.torch/hierarchy-pilots/${record.id}.json`;
    if (existsSync(join(this.repositoryRoot, pilotRecordPath))
      || (manifest.created ?? []).some((entry) => entry.path === pilotRecordPath)) {
      blockers.push({ type: 'pilot-record-already-exists', path: pilotRecordPath });
    }
    const trackedPaths = git(this.repositoryRoot, ['ls-files', '.torch/torch.yaml', '.torch/install-manifest.json'])
      .split('\n').filter(Boolean);
    if (!trackedPaths.includes('.torch/torch.yaml') || !trackedPaths.includes('.torch/install-manifest.json')) {
      blockers.push({ type: 'configuration-not-committed' });
    }
    const missingIdentities = [...new Set(record.proposal.graph.roles.map((role) => role.identity_id))]
      .filter((identity) => !activeIdentities.has(identity));
    if (missingIdentities.length) blockers.push({ type: 'inactive-identities', identities: missingIdentities });
    const before = new Map(currentGraph.roles.map((entry) => [entry.id, entry]));
    const after = new Map(record.proposal.graph.roles.map((entry) => [entry.id, entry]));
    let checkInSchedulePlan;
    try {
      checkInSchedulePlan = planManagerCheckInSchedules({
        graph: record.proposal.graph, schedules: config.schedules,
      });
    } catch (error) {
      blockers.push({ type: 'manager-check-in-schedule-plan-invalid', code: error.code, details: error.details ?? error.message });
      checkInSchedulePlan = { additions: [], obsolete: [], schedules: config.schedules };
    }
    const nextConfig = {
      ...config, organization: record.proposal.graph, schedules: checkInSchedulePlan.schedules,
    };
    try {
      validateProjectConfig(nextConfig);
    } catch (error) {
      blockers.push({ type: 'resulting-configuration-invalid', details: error.details ?? error.message });
    }
    const configEntry = (manifest.created ?? []).find((entry) => entry.path === '.torch/torch.yaml');
    if (!configEntry) {
      blockers.push({ type: 'install-manifest-missing-config-ownership' });
    } else if (fileDigest(join(this.repositoryRoot, '.torch', 'torch.yaml')) !== configEntry.sha256) {
      blockers.push({ type: 'install-manifest-config-hash-mismatch' });
    }
    return {
      action: 'activate-hierarchy-pilot', proposalId: record.id, state: record.state,
      baseCommit: record.baseCommit, currentHead, baseGraphDigest: record.baseGraphDigest,
      graphDelta: {
        addedRoles: [...after.keys()].filter((roleId) => !before.has(roleId)),
        removedRoles: [...before.keys()].filter((roleId) => !after.has(roleId)),
        changedRoles: [...after.keys()].filter((roleId) => before.has(roleId)
          && digest(after.get(roleId)) !== digest(before.get(roleId))),
      },
      managerCheckInSchedules: {
        additions: checkInSchedulePlan.additions,
        obsoleteCandidates: checkInSchedulePlan.obsolete.map((schedule) => schedule.id),
        resultingSchedules: checkInSchedulePlan.schedules,
        note: 'Activation writes the resulting schedules to canonical config; obsolete definitions remain for owner review.',
      },
      timerReconciliation: {
        installed: installedLaunchers.length > 0,
        requiredAfterActivation: installedLaunchers.length > 0,
        commands: installedLaunchers.length
          ? ['torch schedules launcher plan-reconcile', 'torch schedules launcher reconcile --yes'] : [],
        note: 'Hierarchy activation never mutates user systemd state or starts an AI runtime.',
      },
      affectedIdentityIds: record.proposal.impact.affected_identities,
      activeBacklog: activeTasks.map((task) => ({ id: task.id, state: task.state, owner: task.owner })),
      worktrees,
      pilot: record.proposal.pilot,
      preservation: ['active backlog assignments', 'implementation ownership', 'existing session identities', 'direct peer communication', 'single authoritative backlog'],
      blockers,
      canProceed: blockers.length === 0,
      mutationPerformed: false,
    };
  }

  activatePilot({ proposalId, activatedBy } = {}) {
    const record = this.get(proposalId);
    if (record.state !== 'pilot-approved') {
      throw new TorchError(`Hierarchy proposal ${record.id} is ${record.state}, not pilot-approved`, {
        code: 'HIERARCHY_PROPOSAL_STATE_CONFLICT',
      });
    }
    const actor = text.parse(activatedBy);
    if (actor !== record.decidedBy || actor !== 'owner') {
      throw new TorchError('Hierarchy pilot activation must be confirmed by the owner who approved it', {
        code: 'HIERARCHY_OWNER_AUTHORITY_REQUIRED', details: { decidedBy: record.decidedBy, activatedBy: actor },
      });
    }
    const plan = this.planPilot(record.id);
    if (!plan.canProceed) throw new TorchError('Hierarchy pilot activation is blocked', {
      code: 'HIERARCHY_PILOT_BLOCKED', details: plan.blockers,
    });
    const config = loadProjectConfig(this.repositoryRoot);
    const schedulePlan = planManagerCheckInSchedules({ graph: record.proposal.graph, schedules: config.schedules });
    const nextConfig = validateProjectConfig({
      ...config, organization: record.proposal.graph, schedules: schedulePlan.schedules,
    });
    const manifest = readInstallManifest(this.repositoryRoot);
    const activatedAt = this.clock().toISOString();
    const relativeRecordPath = `.torch/hierarchy-pilots/${record.id}.json`;
    const pilotRecord = {
      schema: 'torch.dev/hierarchy-pilot/v1alpha1', proposalId: record.id,
      state: 'piloting', title: record.proposal.title, rationale: record.proposal.rationale,
      baseCommit: record.baseCommit, graph: record.proposal.graph,
      pilot: record.proposal.pilot, activatedBy: actor, activatedAt,
      managerCheckInSchedules: {
        additions: schedulePlan.additions,
        obsoleteCandidates: schedulePlan.obsolete.map((schedule) => schedule.id),
      },
      timerReconciliationRequired: (manifest.external ?? []).some((entry) => entry.type === 'systemd-user-unit'),
    };
    const serializedConfig = `${JSON.stringify(nextConfig, null, 2)}\n`;
    const serializedPilot = `${JSON.stringify(pilotRecord, null, 2)}\n`;
    const configEntry = manifest.created.find((entry) => entry.path === '.torch/torch.yaml');
    if (!configEntry) throw new TorchError('Install manifest does not own the tracked project configuration', {
      code: 'HIERARCHY_INSTALL_MANIFEST_INVALID', details: { path: '.torch/torch.yaml' },
    });
    configEntry.sha256 = createHash('sha256').update(serializedConfig).digest('hex');
    manifest.created.push({
      path: relativeRecordPath,
      sha256: createHash('sha256').update(serializedPilot).digest('hex'),
    });
    const files = new Map([
      ['.torch/torch.yaml', serializedConfig],
      [relativeRecordPath, serializedPilot],
      ['.torch/install-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`],
    ]);
    const originals = writeFilesAtomically(this.repositoryRoot, files);
    const commitMessage = `chore(torch): activate hierarchy pilot ${record.id}`;
    let activationCommit;
    try {
      git(this.repositoryRoot, ['add', ...files.keys()]);
      git(this.repositoryRoot, ['commit', '-m', commitMessage]);
      activationCommit = git(this.repositoryRoot, ['rev-parse', 'HEAD']);
    } catch (error) {
      const currentHead = git(this.repositoryRoot, ['rev-parse', 'HEAD']);
      const currentSubject = git(this.repositoryRoot, ['show', '-s', '--format=%s', 'HEAD']);
      if (currentHead !== plan.currentHead && currentSubject === commitMessage) {
        activationCommit = currentHead;
      } else {
        try { git(this.repositoryRoot, ['restore', '--staged', '--', ...files.keys()]); } catch { /* best effort */ }
      for (const [path, content] of originals) {
          if (content === null) {
            if (existsSync(path)) unlinkSync(path);
          } else {
            const temporary = `${path}.rollback-${process.pid}-${randomUUID()}`;
            writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
            renameSync(temporary, path);
          }
        }
        throw new TorchError('Hierarchy files were restored because the activation commit failed', {
          code: 'HIERARCHY_ACTIVATION_COMMIT_FAILED', details: error.stderr?.toString().trim() || error.message,
        });
      }
    }
    const now = this.clock().toISOString();
    this.database.prepare(`
      UPDATE hierarchy_proposals SET state = 'piloting', activation_commit = ?, updated_at = ?
      WHERE id = ? AND state = 'pilot-approved'
    `).run(activationCommit, now, record.id);
    this.controlPlane.audit({
      actorId: 'session-manager', operation: 'hierarchy.activate-pilot',
      entityType: 'hierarchy-proposal', entityId: record.id,
      details: { activatedBy: actor, activationCommit, graphRevision: record.proposal.graph.revision,
        managerScheduleAdditions: schedulePlan.additions.map((schedule) => schedule.id),
        timerReconciliationRequired: pilotRecord.timerReconciliationRequired },
    });
    return {
      ...this.get(record.id), activationCommit, activatedAt,
      managerCheckInSchedules: pilotRecord.managerCheckInSchedules,
      timerReconciliationRequired: pilotRecord.timerReconciliationRequired,
      runtimeStarted: false, mutationPerformed: true,
    };
  }
}
