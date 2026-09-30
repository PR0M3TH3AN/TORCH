import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { observeCheckEvidence } from '../../src/observability/snapshot.mjs';
import '../../site/check-evidence.js';

test('SCN-console-check-evidence: read-only projection isolates projects and preserves legacy, invalid and interrupted evidence', () => {
  const database = new DatabaseSync(':memory:');
  try {
    assert.deepEqual(observeCheckEvidence(database, 'project'), { receipts: [], prepared: [] });
    database.exec(`CREATE TABLE check_receipts (id TEXT, project_id TEXT, check_id TEXT, area_id TEXT,
      commit_sha TEXT, result TEXT, finished_at TEXT, invalid_reason TEXT);
      CREATE TABLE prepared_checks (id TEXT, project_id TEXT, check_id TEXT, area_id TEXT,
      state TEXT, created_at TEXT, receipt_id TEXT, snapshot_json TEXT);`);
    database.prepare('INSERT INTO check_receipts VALUES (?,?,?,?,?,?,?,?)')
      .run('receipt', 'project', 'browser', 'interface', 'a'.repeat(40), 'invalid', '2026-09-30', 'condition-mismatch:clock');
    const insert = database.prepare('INSERT INTO prepared_checks VALUES (?,?,?,?,?,?,?,?)');
    insert.run('finished', 'project', 'browser', 'interface', 'finished', '2026-09-30', 'receipt',
      JSON.stringify({ commit: 'a'.repeat(40), digest: 'sha256:capture', copyStrategy: 'copy',
        inputRoot: '/private/build/path', files: [{ path: 'private-name' }] }));
    insert.run('interrupted', 'project', 'browser', 'interface', 'running', '2026-09-30', null, '{bad');
    insert.run('foreign', 'other', 'secret', 'other', 'running', '2026-09-30', null, '{}');
    const before = database.prepare('SELECT * FROM prepared_checks').all();
    const legacy = observeCheckEvidence(database, 'project');
    assert.equal(legacy.receipts[0].conditions, null);
    assert.equal(legacy.receipts[0].snapshot.digest, 'sha256:capture');
    assert.equal(legacy.receipts[0].snapshot.fileCount, 1);
    assert.doesNotMatch(JSON.stringify(legacy), /private-name|private\/build/);
    assert.equal(legacy.prepared.length, 2);
    assert.equal(legacy.prepared.find((item) => item.id === 'interrupted').snapshot.unavailable, true);
    database.exec('ALTER TABLE check_receipts ADD COLUMN conditions_json TEXT');
    database.prepare('UPDATE check_receipts SET conditions_json = ? WHERE id = ?').run(JSON.stringify({
      before: { valid: false, reason: 'condition-mismatch:clock', report: { conditions: { clock: false } } }, after: null,
    }), 'receipt');
    const evidence = observeCheckEvidence(database, 'project');
    const html = globalThis.TorchCheckEvidence.render(evidence);
    assert.match(html, /Running — completion unconfirmed/);
    assert.match(html, /Frozen-input evidence unreadable/);
    assert.match(html, /sha256:capture/);
    assert.match(html, /clock.*false/s);
    assert.match(html, /After measurement: not recorded/);
    assert.match(html, /not independent sensor truth/);
    assert.doesNotMatch(html, /foreign|secret/);
    assert.deepEqual(database.prepare('SELECT * FROM prepared_checks').all(), before);
  } finally { database.close(); }
});

test('SCN-console-check-evidence: untrusted project observations are escaped and absent conditions never imply verified runtime', () => {
  const input = { prepared: [{ id: 'waiting', checkId: '<img src=x>', areaId: 'world', state: 'prepared', snapshot: null }],
    receipts: [{ checkId: 'legacy', result: 'passed', commit: 'abc', conditions: null },
      { checkId: 'probe', conditions: { before: { valid: true, report: { conditions: { '<script>': '<img onerror=x>' } } } } }] };
  const before = JSON.stringify(input);
  const html = globalThis.TorchCheckEvidence.render(input);
  assert.match(html, /Prepared — awaiting execution/);
  assert.match(html, /not proof that runtime conditions were verified/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<img|<script>/);
  assert.equal(JSON.stringify(input), before);
});

test('SCN-console-abandoned-check-cleanup: read-only recovery projection keeps pending and unknown cleanup visible without private evidence or controls', () => {
  const database = new DatabaseSync(':memory:');
  try {
    database.exec(`CREATE TABLE prepared_checks (id TEXT, project_id TEXT, check_id TEXT, area_id TEXT,
      state TEXT, created_at TEXT, receipt_id TEXT, snapshot_json TEXT, recovery_json TEXT);`);
    const insert = database.prepare('INSERT INTO prepared_checks VALUES (?,?,?,?,?,?,?,?,?)');
    const recovery = { at: '2026-09-30T09:00:00Z', evidence: '/private/stopped-process-evidence',
      actorId: '<script>private-owner</script>', observedRunner: { pid: 777 }, executorsStopped: true,
      cleanupPending: true, cleanupReason: 'CHECK_SNAPSHOT_INVALID' };
    insert.run('pending', 'project', 'interrupted', 'qa', 'abandoned', '2026-09-30', null, '{}', JSON.stringify(recovery));
    insert.run('clean', 'project', 'completed-cleanup', 'qa', 'abandoned', '2026-09-30', null, '{}',
      JSON.stringify({ ...recovery, cleanupPending: false, cleanupReason: null }));
    insert.run('unknown', 'project', 'old-recovery', 'qa', 'abandoned', '2026-09-30', null, '{}', '{broken');
    insert.run('foreign', 'foreign', 'secret-check', 'secret', 'abandoned', '2026-09-30', null, '{}', '{}');
    const before = database.prepare('SELECT * FROM prepared_checks').all();
    const observation = observeCheckEvidence(database, 'project');
    assert.equal(observation.prepared.length, 3);
    assert.equal(observation.prepared.find((item) => item.id === 'pending').recovery.cleanupStatus, 'pending');
    assert.equal(observation.prepared.find((item) => item.id === 'clean').recovery.cleanupStatus, 'completed');
    assert.equal(observation.prepared.find((item) => item.id === 'unknown').recovery.cleanupStatus, 'unconfirmed');
    assert.doesNotMatch(JSON.stringify(observation), /private|777|foreign|secret/);
    const html = globalThis.TorchCheckEvidence.render(observation);
    assert.match(html, /Abandoned — not qualified/);
    assert.match(html, /cleanup pending/);
    assert.match(html, /cleanup completed \(recorded\)/);
    assert.match(html, /cleanup unconfirmed/);
    assert.match(html, /owner-attested, not independently verified descendant termination/);
    assert.doesNotMatch(html, /<button|private|secret/);
    assert.deepEqual(database.prepare('SELECT * FROM prepared_checks').all(), before);
    const unsafe = globalThis.TorchCheckEvidence.render({ prepared: [{ id: '<img src=x>', state: 'abandoned',
      recovery: { cleanupReason: '<script>alert(1)</script>', recordedAt: '<img onerror=x>' } }] });
    assert.doesNotMatch(unsafe, /<img|<script>/);
    assert.match(unsafe, /&lt;script&gt;/);
  } finally { database.close(); }
});
