import { createHash } from 'node:crypto';
import { TorchError } from '../kernel/errors.mjs';

export const CANDIDATE_ATTEMPT_STORE_PROTOCOL_VERSION = 1;
export const CANDIDATE_ATTEMPT_STORE_SCHEMA_VERSION = 1;

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const MAX_IDENTIFIER_BYTES = 128;

const DDL_STATEMENTS = Object.freeze([
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
]);

function fail(message, code, details) {
  throw new TorchError(message, { code, details });
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function frame(label, value) {
  const bytes = Buffer.from(value, 'utf8');
  return `${label}:${bytes.length}\n${value}\n`;
}

function exactObject(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object`, 'CANDIDATE_STORE_METADATA_INVALID');
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${label} contains an unsupported field`, 'CANDIDATE_STORE_METADATA_INVALID', { field: key });
  }
}

function boundedIdentifier(value, field) {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value, 'utf8') > MAX_IDENTIFIER_BYTES) {
    fail(`${field} must be a bounded identifier`, 'CANDIDATE_STORE_METADATA_INVALID', { field });
  }
  return value;
}

function expectedMetaRow() {
  const digests = candidateAttemptStoreDigestsV1();
  return {
    protocolVersion: CANDIDATE_ATTEMPT_STORE_PROTOCOL_VERSION,
    schemaVersion: CANDIDATE_ATTEMPT_STORE_SCHEMA_VERSION,
    ddlDigest: digests.ddlDigest,
    schemaDigest: digests.schemaDigest,
  };
}

function assertConnection(database) {
  if (!database || typeof database.exec !== 'function' || typeof database.prepare !== 'function') {
    fail('Candidate-store metadata verifier requires an internal SQLite connection', 'CANDIDATE_STORE_METADATA_INVALID');
  }
  database.exec('PRAGMA foreign_keys = ON');
  const foreignKeys = database.prepare('PRAGMA foreign_keys').get()?.foreign_keys;
  if (foreignKeys !== 1) fail('Candidate-store connection did not enable foreign keys', 'CANDIDATE_STORE_FOREIGN_KEYS_REQUIRED');
  return foreignKeys;
}

function assertSchemaStatements(database) {
  const actual = database.prepare(`
    SELECT type, name, sql
    FROM sqlite_master
    WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE name
      WHEN 'candidate_attempt_store_meta' THEN 0
      WHEN 'candidate_attempt_store_meta_fixture_identity_idx' THEN 1
      ELSE 2
    END ASC
  `).all();
  const expected = [
    { type: 'table', name: 'candidate_attempt_store_meta', sql: DDL_STATEMENTS[0] },
    { type: 'index', name: 'candidate_attempt_store_meta_fixture_identity_idx', sql: DDL_STATEMENTS[1] },
  ];
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail('Candidate-store DDL does not match the canonical v1 schema', 'CANDIDATE_STORE_SCHEMA_DRIFT');
  }
}

/** Internal, version-framed UTF-8/LF preimage; it contains no stored metadata values. */
export function candidateAttemptStoreDdlBytesV1() {
  const payload = [
    frame('schema', 'torch.dev/candidate-attempt-store-ddl/v1alpha1'),
    frame('protocol-version', String(CANDIDATE_ATTEMPT_STORE_PROTOCOL_VERSION)),
    frame('schema-version', String(CANDIDATE_ATTEMPT_STORE_SCHEMA_VERSION)),
    ...DDL_STATEMENTS.map((statement, index) => frame(`statement-${index + 1}`, statement)),
  ].join('');
  return Buffer.from(payload, 'utf8');
}

/** Internal schema preimage intentionally excludes schema_digest itself. */
export function candidateAttemptStoreSchemaBytesV1() {
  const ddlDigest = digest(candidateAttemptStoreDdlBytesV1());
  const payload = [
    frame('schema', 'torch.dev/candidate-attempt-store-schema/v1alpha1'),
    frame('protocol-version', String(CANDIDATE_ATTEMPT_STORE_PROTOCOL_VERSION)),
    frame('schema-version', String(CANDIDATE_ATTEMPT_STORE_SCHEMA_VERSION)),
    frame('ddl-digest', ddlDigest),
  ].join('');
  return Buffer.from(payload, 'utf8');
}

export function candidateAttemptStoreDigestsV1() {
  const ddlBytes = candidateAttemptStoreDdlBytesV1();
  const schemaBytes = candidateAttemptStoreSchemaBytesV1();
  return Object.freeze({ ddlDigest: digest(ddlBytes), schemaDigest: digest(schemaBytes) });
}

/** Internal provisioner seam; never accepts a caller path, root, manifest, or DDL. */
export function initializeCandidateAttemptStoreV1(database, metadata) {
  exactObject(metadata, new Set(['fixtureIdentity', 'storeIdentity', 'createdAt']), 'Candidate-store metadata');
  const fixtureIdentity = boundedIdentifier(metadata.fixtureIdentity, 'fixtureIdentity');
  const storeIdentity = boundedIdentifier(metadata.storeIdentity, 'storeIdentity');
  if (typeof metadata.createdAt !== 'string' || !metadata.createdAt || Buffer.byteLength(metadata.createdAt, 'utf8') > 40) {
    fail('createdAt must be bounded ISO text', 'CANDIDATE_STORE_METADATA_INVALID', { field: 'createdAt' });
  }
  assertConnection(database);
  database.exec(`PRAGMA user_version = ${CANDIDATE_ATTEMPT_STORE_SCHEMA_VERSION}`);
  for (const statement of DDL_STATEMENTS) database.exec(statement);
  const digests = candidateAttemptStoreDigestsV1();
  database.prepare(`
    INSERT INTO candidate_attempt_store_meta (
      singleton, protocol_version, schema_version, ddl_digest, schema_digest,
      fixture_identity, store_identity, promotion, created_at
    ) VALUES (1, ?, ?, ?, ?, ?, ?, 'nonpromotable', ?)
  `).run(
    CANDIDATE_ATTEMPT_STORE_PROTOCOL_VERSION,
    CANDIDATE_ATTEMPT_STORE_SCHEMA_VERSION,
    digests.ddlDigest,
    digests.schemaDigest,
    fixtureIdentity,
    storeIdentity,
    metadata.createdAt,
  );
  return inspectCandidateAttemptStoreMetadataV1(database);
}

/** Internal read-only metadata verifier. Its connection is owned by the fixture provisioner. */
export function inspectCandidateAttemptStoreMetadataV1(database) {
  const foreignKeys = assertConnection(database);
  const userVersion = database.prepare('PRAGMA user_version').get()?.user_version;
  if (userVersion !== CANDIDATE_ATTEMPT_STORE_SCHEMA_VERSION) {
    fail('Candidate-store user_version is incompatible', 'CANDIDATE_STORE_SCHEMA_MISMATCH', {
      expected: CANDIDATE_ATTEMPT_STORE_SCHEMA_VERSION, observed: userVersion,
    });
  }
  assertSchemaStatements(database);
  const rows = database.prepare(`
    SELECT protocol_version, schema_version, ddl_digest, schema_digest,
      fixture_identity, store_identity, promotion, created_at
    FROM candidate_attempt_store_meta
    ORDER BY singleton ASC
  `).all();
  if (rows.length !== 1) fail('Candidate-store metadata must contain exactly one row', 'CANDIDATE_STORE_METADATA_INVALID');
  const row = rows[0];
  const expected = expectedMetaRow();
  if (row.protocol_version !== expected.protocolVersion || row.schema_version !== expected.schemaVersion
    || row.ddl_digest !== expected.ddlDigest || row.schema_digest !== expected.schemaDigest
    || row.promotion !== 'nonpromotable' || !DIGEST_PATTERN.test(row.ddl_digest) || !DIGEST_PATTERN.test(row.schema_digest)) {
    fail('Candidate-store metadata is malformed or drifted', 'CANDIDATE_STORE_METADATA_INVALID');
  }
  boundedIdentifier(row.fixture_identity, 'fixtureIdentity');
  boundedIdentifier(row.store_identity, 'storeIdentity');
  if (typeof row.created_at !== 'string' || !row.created_at || Buffer.byteLength(row.created_at, 'utf8') > 40) {
    fail('Candidate-store created_at is malformed', 'CANDIDATE_STORE_METADATA_INVALID');
  }
  return Object.freeze({
    protocolVersion: row.protocol_version,
    schemaVersion: row.schema_version,
    ddlDigest: row.ddl_digest,
    schemaDigest: row.schema_digest,
    fixtureIdentity: row.fixture_identity,
    storeIdentity: row.store_identity,
    promotion: row.promotion,
    createdAt: row.created_at,
    connection: Object.freeze({ foreignKeys, userVersion }),
  });
}
