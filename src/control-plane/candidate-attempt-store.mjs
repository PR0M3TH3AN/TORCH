import { createHash } from 'node:crypto';

export const CANDIDATE_ATTEMPT_STORE_PROTOCOL_VERSION = 1;
export const CANDIDATE_ATTEMPT_STORE_SCHEMA_VERSION = 1;

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

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function frame(label, value) {
  const bytes = Buffer.from(value, 'utf8');
  return `${label}:${bytes.length}\n${value}\n`;
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

/** Immutable executable statements for the provisioner's private, fixture-only initializer. */
export function candidateAttemptStoreDdlStatementsV1() {
  return Object.freeze([...DDL_STATEMENTS]);
}
