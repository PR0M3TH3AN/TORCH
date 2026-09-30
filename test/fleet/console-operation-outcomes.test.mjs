import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { observeDeliveryEvidence } from '../../src/observability/snapshot.mjs';
import '../../site/operation-outcomes.js';

test('SCN-console-operation-outcomes: project-scoped read-only receipt projection omits raw secrets and distinguishes uncertain outcomes', () => {
  const database = new DatabaseSync(':memory:');
  try {
    assert.deepEqual(observeDeliveryEvidence(database, 'project').deliveryOperations, []);
    database.exec(`CREATE TABLE deliveries (id TEXT, project_id TEXT);
      CREATE TABLE delivery_operations (id TEXT, delivery_id TEXT, commit_sha TEXT, actor TEXT,
        provider TEXT, operation TEXT, state TEXT, created_at TEXT, updated_at TEXT);
      CREATE TABLE delivery_attempts (id TEXT, operation_id TEXT, ordinal INTEGER, state TEXT,
        started_at TEXT, finished_at TEXT, receipt_json TEXT);`);
    database.prepare('INSERT INTO deliveries VALUES (?,?)').run('delivery', 'project');
    database.prepare('INSERT INTO deliveries VALUES (?,?)').run('foreign', 'other');
    const operation = database.prepare('INSERT INTO delivery_operations VALUES (?,?,?,?,?,?,?,?,?)');
    operation.run('op', 'delivery', 'abc', 'owner', 'custom', 'deploy', 'unknown', '2026-09-30', '2026-09-30');
    operation.run('foreign-op', 'foreign', 'secret-commit', 'owner', 'private', 'deploy', 'succeeded', '2026-09-30', '2026-09-30');
    database.prepare('INSERT INTO delivery_attempts VALUES (?,?,?,?,?,?,?)').run('attempt', 'op', 1, 'unknown',
      '2026-09-30', '2026-09-30', JSON.stringify({ status: 'failed', reference: 'https://secret:password@example.invalid',
        failure: { classification: 'transient', effects: 'unknown', code: '<script>secret-error</script>' } }));
    const before = database.prepare('SELECT * FROM delivery_attempts').all();
    const projection = observeDeliveryEvidence(database, 'project');
    assert.equal(projection.deliveryOperations.length, 1);
    assert.equal(projection.deliveryAttempts[0].receiptSummary.effects, 'unknown');
    assert.doesNotMatch(JSON.stringify(projection), /password|secret|foreign-op/);
    const html = globalThis.TorchOperationOutcomes.render(projection);
    assert.match(html, /Outcome unknown — review required/);
    assert.match(html, /transient failure.*effects unknown/s);
    assert.match(html, /not independent live verification/);
    assert.doesNotMatch(html, /<button|password|secret/);
    assert.deepEqual(database.prepare('SELECT * FROM delivery_attempts').all(), before);
    database.prepare('UPDATE delivery_attempts SET receipt_json = ?').run('{bad');
    assert.equal(observeDeliveryEvidence(database, 'project').deliveryAttempts[0].receiptSummary.status, 'unavailable');
  } finally { database.close(); }
});

test('SCN-console-operation-outcomes: import and adapter success are never live release proof, and text remains escaped', () => {
  const input = { canonicalFetches: [{ remote: '<img src=x>', state: 'succeeded', attempts: [{ ordinal: 1, state: 'succeeded' }] }],
    deliveryOperations: [{ id: 'running', state: 'running', operation: 'deploy' }, { id: 'ok', state: 'succeeded', operation: 'deploy' }],
    deliveryAttempts: [] };
  const before = JSON.stringify(input);
  const html = globalThis.TorchOperationOutcomes.render(input);
  assert.match(html, /Object import succeeded — not deployment/);
  assert.match(html, /Running — completion unconfirmed/);
  assert.match(html, /Adapter succeeded — verify lifecycle and live evidence/);
  assert.match(html, /&lt;img src=x&gt;/);
  assert.doesNotMatch(html, /<img|<button/);
  assert.equal(JSON.stringify(input), before);
});
