import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TorchError } from '../kernel/errors.mjs';
import { loadProjectConfig } from '../kernel/config.mjs';
import { readInstallManifest, writeInstallManifest } from '../kernel/install.mjs';
import { fileHash } from '../kernel/files.mjs';
import { validateDeliveryAdapter } from '../adapters/delivery.mjs';

export const DELIVERY_STATES = Object.freeze([
  'implemented', 'verified', 'integrated', 'release-ready', 'released', 'deployed', 'live-verified',
]);

const HIGH_IMPACT_STATES = new Set(['released', 'deployed', 'live-verified']);

function text(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TorchError(`${name} must be a non-empty string`, {
      code: 'DELIVERY_INPUT_INVALID', details: { field: name },
    });
  }
  return value.trim();
}

function textList(value, name) {
  if (!Array.isArray(value) || value.length === 0
    || value.some((entry) => typeof entry !== 'string' || !entry.trim())) {
    throw new TorchError(`${name} must be a non-empty array of strings`, {
      code: 'DELIVERY_INPUT_INVALID', details: { field: name },
    });
  }
  return [...new Set(value.map((entry) => entry.trim()))];
}

function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new TorchError('Delivery Git inspection failed', {
    code: 'GIT_COMMAND_FAILED', details: result.stderr?.trim() || null,
  });
  return result.stdout.trim();
}

function initialize(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS deliveries (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      label TEXT NOT NULL,
      source_area TEXT NOT NULL,
      commit_sha TEXT NOT NULL,
      state TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      adapter_receipts_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS delivery_events (
      id TEXT PRIMARY KEY,
      delivery_id TEXT NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
      from_state TEXT,
      to_state TEXT NOT NULL,
      actor TEXT NOT NULL,
      created_at TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      adapter_receipt_json TEXT
    );
    CREATE INDEX IF NOT EXISTS deliveries_state_updated ON deliveries(state, updated_at, id);
  `);
}

function hasTable(database, name) {
  return Boolean(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function rowToDelivery(row) {
  if (!row) return null;
  return {
    id: row.id, projectId: row.project_id, label: row.label, sourceArea: row.source_area,
    commit: row.commit_sha, state: row.state, createdAt: row.created_at, updatedAt: row.updated_at,
    evidence: JSON.parse(row.evidence_json), adapterReceipts: JSON.parse(row.adapter_receipts_json),
  };
}

function adapterRequirement(config, targetState) {
  if (targetState === 'released') {
    return { slot: 'release', operation: 'release', provider: config.delivery.adapters.release.provider };
  }
  if (targetState === 'deployed') {
    return { slot: 'deployment', operation: 'deploy', provider: config.delivery.adapters.deployment.provider };
  }
  if (targetState === 'live-verified') {
    return { slot: 'deployment', operation: 'verifyLive', provider: config.delivery.adapters.deployment.provider };
  }
  return null;
}

function configurationPaths(repositoryRoot) {
  return { config: join(repositoryRoot, '.torch', 'torch.yaml') };
}

function ownedConfiguration(repositoryRoot, manifest) {
  const record = manifest.created.find((entry) => entry.path === '.torch/torch.yaml');
  return Boolean(record && fileHash(configurationPaths(repositoryRoot).config) === record.sha256);
}

export function planDeliveryConfiguration({
  repositoryRoot, releaseProvider = 'none', deploymentProvider = 'none',
} = {}) {
  const release = text(releaseProvider, 'releaseProvider');
  const deployment = text(deploymentProvider, 'deploymentProvider');
  const config = loadProjectConfig(repositoryRoot);
  const manifest = readInstallManifest(repositoryRoot);
  const blockers = [];
  if (!ownedConfiguration(repositoryRoot, manifest)) blockers.push({ code: 'DELIVERY_CONFIGURATION_MODIFIED' });
  return {
    action: 'configure-delivery-adapters',
    current: {
      release: config.delivery.adapters.release.provider,
      deployment: config.delivery.adapters.deployment.provider,
    },
    requested: { release, deployment },
    blockers, canProceed: blockers.length === 0, mutationPerformed: false,
  };
}

export function configureDelivery(input = {}) {
  const plan = planDeliveryConfiguration(input);
  if (!plan.canProceed) throw new TorchError('Delivery adapter configuration is blocked', {
    code: 'DELIVERY_CONFIGURATION_BLOCKED', details: plan.blockers,
  });
  const config = loadProjectConfig(input.repositoryRoot);
  const manifest = readInstallManifest(input.repositoryRoot);
  config.delivery.adapters.release.provider = plan.requested.release;
  config.delivery.adapters.deployment.provider = plan.requested.deployment;
  const path = configurationPaths(input.repositoryRoot).config;
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: 'utf8', mode: 0o600, flag: 'wx',
  });
  renameSync(temporary, path);
  const record = manifest.created.find((entry) => entry.path === '.torch/torch.yaml');
  record.sha256 = fileHash(path);
  writeInstallManifest(input.repositoryRoot, manifest);
  return { ...plan, configuredAt: new Date().toISOString(), mutationPerformed: true };
}

export class DeliveryService {
  constructor({
    repositoryRoot, controlPlane, checkService = null, adapters = new Map(),
    clock = () => new Date(), idFactory = randomUUID,
  } = {}) {
    if (!controlPlane) throw new TorchError('Delivery lifecycle requires the TORCH control plane', { code: 'CONTROL_PLANE_REQUIRED' });
    this.repositoryRoot = repositoryRoot;
    this.controlPlane = controlPlane;
    this.checkService = checkService;
    this.adapters = adapters instanceof Map ? adapters : new Map(Object.entries(adapters));
    this.clock = clock;
    this.idFactory = idFactory;
    this.database = controlPlane.database;
    this.config = loadProjectConfig(repositoryRoot);
    this.manifest = readInstallManifest(repositoryRoot);
    this.worktrees = new Map((this.manifest.external ?? [])
      .filter((entry) => entry.type === 'worktree').map((entry) => [entry.area, entry]));
    initialize(this.database);
  }

  list({ state } = {}) {
    if (state && !DELIVERY_STATES.includes(state)) {
      throw new TorchError(`Unknown delivery state: ${state}`, { code: 'DELIVERY_STATE_INVALID' });
    }
    const rows = state
      ? this.database.prepare('SELECT * FROM deliveries WHERE state = ? ORDER BY updated_at, id').all(state)
      : this.database.prepare('SELECT * FROM deliveries ORDER BY updated_at, id').all();
    return rows.map(rowToDelivery);
  }

  get(deliveryId) {
    const id = text(deliveryId, 'deliveryId');
    const delivery = rowToDelivery(this.database.prepare('SELECT * FROM deliveries WHERE id = ?').get(id));
    if (!delivery) throw new TorchError(`Unknown delivery: ${id}`, { code: 'DELIVERY_NOT_FOUND' });
    return delivery;
  }

  create({ sourceArea, commit = 'HEAD', label, evidence } = {}) {
    const area = this.controlPlane.assertIdentity(sourceArea);
    if (area === 'session-manager') {
      throw new TorchError('A delivery source must be a development domain', { code: 'DELIVERY_SOURCE_INVALID' });
    }
    const worktree = this.worktrees.get(area);
    if (!worktree) throw new TorchError(`No managed worktree for ${area}`, { code: 'WORKTREE_MISSING' });
    const resolvedCommit = git(worktree.path, ['rev-parse', text(commit, 'commit')]);
    const head = git(worktree.path, ['rev-parse', 'HEAD']);
    const dirty = git(worktree.path, ['status', '--porcelain']).split('\n').filter(Boolean);
    if (resolvedCommit !== head || dirty.length) {
      throw new TorchError('Delivery implementation must name the clean source worktree HEAD', {
        code: 'DELIVERY_SOURCE_UNSAFE', details: { resolvedCommit, head, dirty },
      });
    }
    const now = this.clock().toISOString();
    const record = {
      id: this.idFactory(), projectId: this.controlPlane.projectId, label: text(label, 'label'),
      sourceArea: area, commit: resolvedCommit, state: 'implemented', createdAt: now, updatedAt: now,
      evidence: textList(evidence, 'evidence'), adapterReceipts: [],
    };
    this.database.prepare(`INSERT INTO deliveries (
      id, project_id, label, source_area, commit_sha, state, created_at, updated_at,
      evidence_json, adapter_receipts_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(record.id, record.projectId, record.label, record.sourceArea, record.commit,
        record.state, now, now, JSON.stringify(record.evidence), '[]');
    this.database.prepare(`INSERT INTO delivery_events (
      id, delivery_id, from_state, to_state, actor, created_at, evidence_json, adapter_receipt_json
    ) VALUES (?, ?, NULL, 'implemented', ?, ?, ?, NULL)`)
      .run(this.idFactory(), record.id, area, now, JSON.stringify(record.evidence));
    this.controlPlane.audit({
      actorId: area, operation: 'delivery.create', entityType: 'delivery', entityId: record.id,
      details: { commit: record.commit, state: record.state },
    });
    return record;
  }

  planTransition({ deliveryId, targetState, actor } = {}) {
    const delivery = this.get(deliveryId);
    const target = text(targetState, 'targetState');
    const currentIndex = DELIVERY_STATES.indexOf(delivery.state);
    if (DELIVERY_STATES[currentIndex + 1] !== target) {
      throw new TorchError(`Delivery must advance from ${delivery.state} to ${DELIVERY_STATES[currentIndex + 1] ?? '<terminal>'}`, {
        code: 'DELIVERY_TRANSITION_INVALID', details: { current: delivery.state, target },
      });
    }
    const principal = text(actor, 'actor');
    if (principal !== 'owner') this.controlPlane.assertIdentity(principal);
    const authorityKey = target.replaceAll('-', '_');
    const configuredAuthority = this.config.delivery.authority[authorityKey] ?? [];
    const authorizedActors = configuredAuthority.map((entry) => entry === '$source' ? delivery.sourceArea : entry);
    const blockers = [];
    if (!authorizedActors.includes(principal)) blockers.push({ code: 'DELIVERY_AUTHORITY_REQUIRED', actor: principal, allowed: authorizedActors });
    if (target === 'verified') {
      const requiredChecks = this.config.integration.required_checks;
      if (requiredChecks.length && !this.checkService?.exactPasses({ commit: delivery.commit, requiredChecks })) {
        blockers.push({ code: 'DELIVERY_CHECKS_REQUIRED', commit: delivery.commit, checks: requiredChecks });
      }
    }
    if (target === 'integrated') {
      const landed = hasTable(this.database, 'integration_requests')
        ? this.database.prepare(`SELECT id FROM integration_requests
          WHERE source_commit = ? AND state = 'landed' LIMIT 1`).get(delivery.commit)
        : null;
      if (!landed) blockers.push({ code: 'DELIVERY_INTEGRATION_REQUIRED', commit: delivery.commit });
    }
    const requirement = adapterRequirement(this.config, target);
    if (requirement) {
      if (requirement.provider === 'none') blockers.push({
        code: 'DELIVERY_ADAPTER_NOT_CONFIGURED', slot: requirement.slot, operation: requirement.operation,
      });
      else {
        const adapter = this.adapters.get(requirement.provider) ?? null;
        if (!adapter) blockers.push({ code: 'DELIVERY_ADAPTER_MISSING', provider: requirement.provider });
        else {
          validateDeliveryAdapter(adapter);
          if (adapter.capabilities[requirement.operation] !== true) blockers.push({
            code: 'DELIVERY_CAPABILITY_UNSUPPORTED', provider: requirement.provider, operation: requirement.operation,
          });
        }
      }
    }
    return {
      action: 'delivery-transition', deliveryId: delivery.id, from: delivery.state, to: target,
      actor: principal, authority: authorizedActors, adapter: requirement ? {
        slot: requirement.slot, provider: requirement.provider, operation: requirement.operation,
      } : null,
      requiresApproval: HIGH_IMPACT_STATES.has(target), blockers,
      canProceed: blockers.length === 0, mutationPerformed: false,
    };
  }

  transition({ deliveryId, targetState, actor, evidence, approved = false } = {}) {
    const plan = this.planTransition({ deliveryId, targetState, actor });
    if (!plan.canProceed) throw new TorchError('Delivery transition is blocked', {
      code: 'DELIVERY_TRANSITION_BLOCKED', details: plan.blockers,
    });
    if (plan.requiresApproval && !approved) throw new TorchError('High-impact delivery transition requires explicit owner approval', {
      code: 'APPROVAL_REQUIRED', details: { state: plan.to },
    });
    const evidenceList = textList(evidence, 'evidence');
    const delivery = this.get(deliveryId);
    let receipt = null;
    if (plan.adapter) {
      const adapter = this.adapters.get(plan.adapter.provider);
      receipt = adapter[plan.adapter.operation]({ delivery, evidence: evidenceList });
      if (!receipt || receipt.status !== 'succeeded') throw new TorchError('Delivery adapter did not return a successful receipt', {
        code: 'DELIVERY_ADAPTER_FAILED', details: { adapter: plan.adapter, receipt },
      });
    }
    const now = this.clock().toISOString();
    const receipts = [...delivery.adapterReceipts, ...(receipt ? [{ ...receipt, operation: plan.adapter.operation }] : [])];
    const allEvidence = [...new Set([...delivery.evidence, ...evidenceList])];
    const update = this.database.prepare(`UPDATE deliveries SET state = ?, updated_at = ?, evidence_json = ?,
      adapter_receipts_json = ? WHERE id = ? AND state = ?`)
      .run(plan.to, now, JSON.stringify(allEvidence), JSON.stringify(receipts), delivery.id, delivery.state);
    if (update.changes !== 1) throw new TorchError('Delivery state changed concurrently', {
      code: 'DELIVERY_STATE_CONFLICT', details: { deliveryId: delivery.id, expected: delivery.state },
    });
    this.database.prepare(`INSERT INTO delivery_events (
      id, delivery_id, from_state, to_state, actor, created_at, evidence_json, adapter_receipt_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(this.idFactory(), delivery.id, delivery.state, plan.to, plan.actor, now,
        JSON.stringify(evidenceList), receipt ? JSON.stringify(receipt) : null);
    this.controlPlane.audit({
      actorId: plan.actor === 'owner' ? 'session-manager' : plan.actor,
      operation: `delivery.${plan.to}`, entityType: 'delivery', entityId: delivery.id,
      details: { commit: delivery.commit, approved, adapter: plan.adapter },
    });
    return this.get(delivery.id);
  }
}
