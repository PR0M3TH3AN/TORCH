import { TorchError } from '../kernel/errors.mjs';
import { fileHash } from '../kernel/files.mjs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export function deliveryAdapterConfigHash(value) {
  const ordered = (item) => Array.isArray(item) ? item.map(ordered)
    : item && typeof item === 'object' ? Object.fromEntries(Object.entries(item)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, nested]) => [key, ordered(nested)])) : item;
  return createHash('sha256').update(JSON.stringify(ordered(value))).digest('hex');
}

export function initializeDeliveryAttempts(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS delivery_operations (
      id TEXT PRIMARY KEY, delivery_id TEXT NOT NULL REFERENCES deliveries(id),
      commit_sha TEXT NOT NULL, from_state TEXT NOT NULL, target_state TEXT NOT NULL,
      actor TEXT NOT NULL, provider TEXT NOT NULL, operation TEXT NOT NULL,
      policy_hash TEXT NOT NULL, adapter_config_hash TEXT, state TEXT NOT NULL, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, evidence_json TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS delivery_unresolved_operation
      ON delivery_operations(delivery_id) WHERE state IN ('running', 'unknown', 'succeeded');
    CREATE TABLE IF NOT EXISTS delivery_attempts (
      id TEXT PRIMARY KEY, operation_id TEXT NOT NULL REFERENCES delivery_operations(id),
      ordinal INTEGER NOT NULL, state TEXT NOT NULL, started_at TEXT NOT NULL,
      finished_at TEXT, receipt_json TEXT, UNIQUE(operation_id, ordinal)
    );
  `);
  const columns = database.prepare('PRAGMA table_info(delivery_operations)').all();
  if (!columns.some((column) => column.name === 'adapter_config_hash')) database.exec('ALTER TABLE delivery_operations ADD COLUMN adapter_config_hash TEXT');
}

export function unresolvedDeliveryOperation(database, deliveryId) {
  return database.prepare("SELECT id, state FROM delivery_operations WHERE delivery_id = ? AND state IN ('running', 'unknown', 'succeeded')").get(deliveryId);
}

export function deliveryOperations(database, deliveryId) {
  return database.prepare(`SELECT id, delivery_id AS deliveryId, commit_sha AS "commit", from_state AS fromState,
    target_state AS targetState, actor, provider, operation, policy_hash AS policyHash, state,
    created_at AS createdAt, updated_at AS updatedAt FROM delivery_operations
    ${deliveryId ? 'WHERE delivery_id = ?' : ''} ORDER BY rowid`).all(...(deliveryId ? [deliveryId] : []));
}

export function deliveryAttempts(database, deliveryId) {
  return database.prepare(`SELECT a.id, a.operation_id AS operationId, o.delivery_id AS deliveryId,
    o.commit_sha AS "commit", o.provider, o.operation, a.ordinal, a.state,
    a.started_at AS startedAt, a.finished_at AS finishedAt, a.receipt_json AS receiptJson
    FROM delivery_attempts a JOIN delivery_operations o ON o.id = a.operation_id
    ${deliveryId ? 'WHERE o.delivery_id = ?' : ''} ORDER BY a.rowid`).all(...(deliveryId ? [deliveryId] : []))
    .map(({ receiptJson, ...row }) => ({ ...row, receipt: receiptJson ? JSON.parse(receiptJson) : null }));
}

// Persist the reservation and each attempt before external execution. A crash
// leaves an unresolved row, preventing another caller from repeating effects.
export function executeDeliveryOperation({ database, repositoryRoot, plan, delivery, adapter,
  evidence, clock, idFactory, maxAttempts = 1 }) {
  const path = join(repositoryRoot, '.torch', 'torch.yaml');
  const policyHash = plan.policyHash;
  if (fileHash(path) !== policyHash) throw new TorchError('Delivery policy changed since approval planning', { code: 'DELIVERY_POLICY_CHANGED' });
  const operationId = idFactory();
  const now = clock().toISOString();
  database.exec('BEGIN IMMEDIATE');
  try {
    const current = database.prepare('SELECT state FROM deliveries WHERE id = ?').get(delivery.id);
    if (current?.state !== delivery.state || unresolvedDeliveryOperation(database, delivery.id)) {
      throw new TorchError('Another delivery operation or changed state blocks execution', { code: 'DELIVERY_OPERATION_UNRESOLVED' });
    }
    database.prepare(`INSERT INTO delivery_operations
      (id, delivery_id, commit_sha, from_state, target_state, actor, provider, operation,
       policy_hash, adapter_config_hash, state, created_at, updated_at, evidence_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?)`).run(operationId, delivery.id,
      delivery.commit, delivery.state, plan.to, plan.actor, plan.adapter.provider,
      plan.adapter.operation, policyHash, plan.adapterConfigHash, now, now, JSON.stringify(evidence));
    database.exec('COMMIT');
  } catch (error) { database.exec('ROLLBACK'); throw error; }
  const finish = (state) => database.prepare('UPDATE delivery_operations SET state = ?, updated_at = ? WHERE id = ?')
    .run(state, clock().toISOString(), operationId);
  const safety = adapter.retrySafety?.[plan.adapter.operation] ?? 'never';
  for (let ordinal = 1; ordinal <= maxAttempts; ordinal += 1) {
    if (fileHash(path) !== policyHash) {
      finish('failed');
      throw new TorchError('Approved delivery policy changed before another attempt', { code: 'DELIVERY_POLICY_CHANGED', details: { operationId } });
    }
    const attemptId = idFactory();
    database.prepare(`INSERT INTO delivery_attempts (id, operation_id, ordinal, state, started_at)
      VALUES (?, ?, ?, 'running', ?)`).run(attemptId, operationId, ordinal, clock().toISOString());
    let receipt;
    let state = 'unknown';
    try {
      receipt = adapter[plan.adapter.operation]({ delivery, evidence, idempotencyKey: operationId, attempt: ordinal });
      // Async adapters are not supported by this synchronous boundary. Never
      // infer success from a Promise or unbounded/malformed response.
      if (typeof receipt?.then === 'function') {
        Promise.resolve(receipt).catch(() => {});
        throw new Error('Async receipt unsupported');
      }
      const serialized = JSON.stringify(receipt);
      if (!serialized || serialized.length > 65_536 || typeof receipt?.then === 'function') throw new Error('Invalid receipt');
      if (receipt.status === 'succeeded' && typeof receipt.reference === 'string' && receipt.reference.trim()) state = 'succeeded';
      else if (receipt.status === 'failed' && ['transient', 'permanent'].includes(receipt.failure?.classification)
        && ['not-applied', 'unknown'].includes(receipt.failure?.effects)) {
        state = receipt.failure.effects === 'unknown' ? 'unknown' : 'failed';
      } else receipt = { status: 'unknown', reason: 'invalid-adapter-receipt' };
    } catch { receipt = { status: 'unknown', reason: 'adapter-threw-or-invalid-receipt' }; }
    database.prepare('UPDATE delivery_attempts SET state = ?, finished_at = ?, receipt_json = ? WHERE id = ?')
      .run(state, clock().toISOString(), JSON.stringify(receipt), attemptId);
    if (state === 'succeeded') { finish('succeeded'); return { operationId, receipt }; }
    const retry = state === 'failed' && receipt.failure.classification === 'transient'
      && ['idempotent', 'read-only'].includes(safety) && ordinal < maxAttempts;
    if (retry) continue;
    finish(state);
    throw new TorchError('Delivery adapter failed; inspect durable attempts before retrying', {
      code: 'DELIVERY_ADAPTER_FAILED', details: { operationId, attemptId, state, retryable: false },
    });
  }
}
