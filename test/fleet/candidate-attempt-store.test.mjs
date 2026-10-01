import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  CANDIDATE_ATTEMPT_STORE_PROTOCOL_VERSION,
  CANDIDATE_ATTEMPT_STORE_SCHEMA_VERSION,
  candidateAttemptStoreDdlBytesV1,
  candidateAttemptStoreDigestsV1,
  candidateAttemptStoreSchemaBytesV1,
} from '../../src/control-plane/candidate-attempt-store.mjs';
import {
  applyCandidateAttemptStoreFixtureTestCorruptionV1,
  closeCandidateAttemptStoreFixtureHarnessV1,
  closeCandidateAttemptStoreFixtureV1,
  createCandidateAttemptStoreFixtureHarnessV1,
  inspectCandidateAttemptStoreFixtureV1,
  provisionCandidateAttemptStoreFixtureV1,
} from '../../src/control-plane/candidate-attempt-store-provisioner.mjs';

const expectedStatements = [
  `CREATE TABLE candidate_attempt_store_meta (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  protocol_version INTEGER NOT NULL CHECK (protocol_version = 1),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  ddl_digest TEXT NOT NULL CHECK (length(ddl_digest) = 64 AND ddl_digest NOT GLOB '*[^0-9a-f]*'),
  schema_digest TEXT NOT NULL CHECK (length(schema_digest) = 64 AND schema_digest NOT GLOB '*[^0-9a-f]*'),
  fixture_identity TEXT NOT NULL UNIQUE CHECK (length(fixture_identity) BETWEEN 1 AND 128),
  store_identity TEXT NOT NULL UNIQUE CHECK (length(store_identity) BETWEEN 1 AND 128),
  promotion TEXT NOT NULL CHECK (promotion = 'nonpromotable'),
  created_at TEXT NOT NULL CHECK (length(created_at) BETWEEN 1 AND 40)
)`,
  'CREATE INDEX candidate_attempt_store_meta_fixture_identity_idx ON candidate_attempt_store_meta (fixture_identity)',
];

function frame(label, value) {
  const bytes = Buffer.from(value, 'utf8');
  return `${label}:${bytes.length}\n${value}\n`;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function independentlyExpectedDigests() {
  const ddl = Buffer.from([
    frame('schema', 'torch.dev/candidate-attempt-store-ddl/v1alpha1'),
    frame('protocol-version', '1'),
    frame('schema-version', '1'),
    ...expectedStatements.map((statement, index) => frame(`statement-${index + 1}`, statement)),
  ].join(''), 'utf8');
  const ddlDigest = sha256(ddl);
  const schema = Buffer.from([
    frame('schema', 'torch.dev/candidate-attempt-store-schema/v1alpha1'),
    frame('protocol-version', '1'),
    frame('schema-version', '1'),
    frame('ddl-digest', ddlDigest),
  ].join(''), 'utf8');
  return { ddl, schema, ddlDigest, schemaDigest: sha256(schema) };
}

function expectCode(callback, code) {
  assert.throws(callback, (error) => error.code === code);
}

test('SCN-candidate-store-canonical-schema: ordered version-framed UTF-8/LF bytes have independently computed digests', () => {
  const expected = independentlyExpectedDigests();
  assert.equal(CANDIDATE_ATTEMPT_STORE_PROTOCOL_VERSION, 1);
  assert.equal(CANDIDATE_ATTEMPT_STORE_SCHEMA_VERSION, 1);
  assert.deepEqual(candidateAttemptStoreDdlBytesV1(), expected.ddl);
  assert.deepEqual(candidateAttemptStoreSchemaBytesV1(), expected.schema);
  assert.deepEqual(candidateAttemptStoreDigestsV1(), {
    ddlDigest: expected.ddlDigest,
    schemaDigest: expected.schemaDigest,
  });
  assert.equal(candidateAttemptStoreSchemaBytesV1().includes(Buffer.from(expected.schemaDigest, 'utf8')), false,
    'the schema preimage must not include its own digest');
});

test('SCN-candidate-store-fixture-provisioning: a private fresh fixture verifies v1 metadata with per-connection foreign keys and user_version', () => {
  const harness = createCandidateAttemptStoreFixtureHarnessV1();
  const fixture = provisionCandidateAttemptStoreFixtureV1({ harness });
  const inspected = inspectCandidateAttemptStoreFixtureV1({ fixture });
  const expected = independentlyExpectedDigests();
  assert.deepEqual({
    protocolVersion: fixture.protocolVersion,
    schemaVersion: fixture.schemaVersion,
    ddlDigest: fixture.ddlDigest,
    schemaDigest: fixture.schemaDigest,
    promotion: fixture.promotion,
  }, {
    protocolVersion: 1,
    schemaVersion: 1,
    ddlDigest: expected.ddlDigest,
    schemaDigest: expected.schemaDigest,
    promotion: 'nonpromotable',
  });
  assert.deepEqual(inspected.connection, { foreignKeys: 1, userVersion: 1 });
  for (const forbidden of ['root', 'path', 'database', 'manifest', 'handle']) {
    assert.equal(Object.hasOwn(fixture, forbidden), false, `fixture must not expose ${forbidden}`);
    assert.equal(Object.hasOwn(inspected, forbidden), false, `inspection must not expose ${forbidden}`);
  }
  closeCandidateAttemptStoreFixtureV1({ fixture });
  expectCode(() => inspectCandidateAttemptStoreFixtureV1({ fixture }), 'CANDIDATE_STORE_FIXTURE_AUTH_EXPIRED');
});

test('SCN-candidate-store-fixture-nonpromotion: fixture attestation cannot expose lifecycle, receipt, or native-PASS authority', async () => {
  const harness = createCandidateAttemptStoreFixtureHarnessV1();
  const fixture = provisionCandidateAttemptStoreFixtureV1({ harness });
  const provisioner = await import('../../src/control-plane/candidate-attempt-store-provisioner.mjs');
  const store = await import('../../src/control-plane/candidate-attempt-store.mjs');
  assert.equal(fixture.promotion, 'nonpromotable');
  assert.equal(inspectCandidateAttemptStoreFixtureV1({ fixture }).nonpromotable, true);
  for (const forbiddenExport of [
    'issueAttemptV1', 'startAttemptV1', 'sealAttemptV1', 'finalizeAttemptV1', 'createCandidateSourceReceiptV1',
    'initializeCandidateAttemptStoreV1', 'inspectCandidateAttemptStoreMetadataV1',
  ]) {
    assert.equal(Object.hasOwn(store, forbiddenExport), false, `${forbiddenExport} is outside B0`);
    assert.equal(Object.hasOwn(provisioner, forbiddenExport), false, `${forbiddenExport} is outside B0`);
  }
  closeCandidateAttemptStoreFixtureV1({ fixture });
});

test('SCN-candidate-store-fixture-authority: foreign, closed, reused, nonempty, and registered fixture targets refuse before usable metadata', () => {
  expectCode(() => createCandidateAttemptStoreFixtureHarnessV1({ root: '/tmp/not-allowed' }), 'CANDIDATE_STORE_FIXTURE_INPUT_INVALID');
  const foreign = { schema: 'torch.dev/candidate-attempt-fixture-authority/v1alpha1', fixtureIdentity: 'foreign' };
  expectCode(() => provisionCandidateAttemptStoreFixtureV1({ harness: foreign }), 'CANDIDATE_STORE_FIXTURE_AUTH_REQUIRED');

  const executionCalls = [];
  const arbitraryDatabase = Object.freeze({
    exec(sql) { executionCalls.push(['exec', sql]); },
    prepare(sql) { executionCalls.push(['prepare', sql]); return { get() {}, all() {}, run() {} }; },
  });
  const issuedForBypassAttempt = createCandidateAttemptStoreFixtureHarnessV1();
  expectCode(
    () => provisionCandidateAttemptStoreFixtureV1({ harness: issuedForBypassAttempt, database: arbitraryDatabase }),
    'CANDIDATE_STORE_FIXTURE_INPUT_INVALID',
  );
  expectCode(
    () => provisionCandidateAttemptStoreFixtureV1({ harness: { ...foreign, database: arbitraryDatabase } }),
    'CANDIDATE_STORE_FIXTURE_AUTH_REQUIRED',
  );
  assert.deepEqual(executionCalls, [], 'public fixture APIs must reject caller database or forged authority before any database execution');
  closeCandidateAttemptStoreFixtureHarnessV1({ harness: issuedForBypassAttempt });

  const closed = createCandidateAttemptStoreFixtureHarnessV1();
  closeCandidateAttemptStoreFixtureHarnessV1({ harness: closed });
  expectCode(() => provisionCandidateAttemptStoreFixtureV1({ harness: closed }), 'CANDIDATE_STORE_FIXTURE_AUTH_EXPIRED');

  const reused = createCandidateAttemptStoreFixtureHarnessV1();
  const fixture = provisionCandidateAttemptStoreFixtureV1({ harness: reused });
  expectCode(() => provisionCandidateAttemptStoreFixtureV1({ harness: reused }), 'CANDIDATE_STORE_FIXTURE_AUTH_REUSED');
  expectCode(() => provisionCandidateAttemptStoreFixtureV1({ harness: reused, root: '/tmp/not-allowed' }), 'CANDIDATE_STORE_FIXTURE_INPUT_INVALID');
  closeCandidateAttemptStoreFixtureV1({ fixture });

  for (const [kind, code] of [
    ['nonempty', 'CANDIDATE_STORE_FIXTURE_NONEMPTY'],
    ['registered-relationship', 'CANDIDATE_STORE_REGISTERED_TARGET_FORBIDDEN'],
  ]) {
    const harness = createCandidateAttemptStoreFixtureHarnessV1();
    applyCandidateAttemptStoreFixtureTestCorruptionV1({ harness, kind });
    expectCode(() => provisionCandidateAttemptStoreFixtureV1({ harness }), code);
    closeCandidateAttemptStoreFixtureHarnessV1({ harness });
  }
});

test('SCN-candidate-store-metadata-drift: only enumerated hermetic corruption can invalidate a provisioned fixture', () => {
  for (const [kind, code] of [
    ['ddl-drift', 'CANDIDATE_STORE_SCHEMA_DRIFT'],
    ['malformed-meta', 'CANDIDATE_STORE_METADATA_INVALID'],
  ]) {
    const harness = createCandidateAttemptStoreFixtureHarnessV1();
    const fixture = provisionCandidateAttemptStoreFixtureV1({ harness });
    applyCandidateAttemptStoreFixtureTestCorruptionV1({ harness, kind });
    expectCode(() => inspectCandidateAttemptStoreFixtureV1({ fixture }), code);
    closeCandidateAttemptStoreFixtureV1({ fixture });
  }
  const harness = createCandidateAttemptStoreFixtureHarnessV1();
  expectCode(() => applyCandidateAttemptStoreFixtureTestCorruptionV1({ harness, kind: 'arbitrary-sql' }), 'CANDIDATE_STORE_FIXTURE_INPUT_INVALID');
  closeCandidateAttemptStoreFixtureHarnessV1({ harness });
});
