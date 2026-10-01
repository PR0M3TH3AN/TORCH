import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { TorchError } from '../kernel/errors.mjs';
import {
  CANDIDATE_ATTEMPT_STORE_PROTOCOL_VERSION,
  CANDIDATE_ATTEMPT_STORE_SCHEMA_VERSION,
  candidateAttemptStoreDdlStatementsV1,
  candidateAttemptStoreDigestsV1,
} from './candidate-attempt-store.mjs';

const harnesses = new WeakMap();
const fixtures = new WeakMap();
const TEST_CORRUPTIONS = new Set([
  'nonempty', 'registered-relationship', 'ddl-drift', 'digest-drift', 'malformed-meta-lexical',
]);
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const MAX_IDENTIFIER_BYTES = 128;

function fail(message, code, details) {
  throw new TorchError(message, { code, details });
}

function exactObject(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object`, 'CANDIDATE_STORE_FIXTURE_INPUT_INVALID');
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${label} contains an unsupported field`, 'CANDIDATE_STORE_FIXTURE_INPUT_INVALID', { field: key });
  }
}

function boundedIdentifier(value, field) {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value, 'utf8') > MAX_IDENTIFIER_BYTES) {
    fail(`${field} must be a bounded identifier`, 'CANDIDATE_STORE_METADATA_INVALID', { field });
  }
  return value;
}

function assertConnection(database) {
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
  const statements = candidateAttemptStoreDdlStatementsV1();
  const expected = [
    { type: 'table', name: 'candidate_attempt_store_meta', sql: statements[0] },
    { type: 'index', name: 'candidate_attempt_store_meta_fixture_identity_idx', sql: statements[1] },
  ];
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail('Candidate-store DDL does not match the canonical v1 schema', 'CANDIDATE_STORE_SCHEMA_DRIFT');
  }
}

/** Module-private: it is reachable only after a closure-owned harness has selected the synthetic target. */
function initializeFixtureStore(database, metadata) {
  const fixtureIdentity = boundedIdentifier(metadata.fixtureIdentity, 'fixtureIdentity');
  const storeIdentity = boundedIdentifier(metadata.storeIdentity, 'storeIdentity');
  if (typeof metadata.createdAt !== 'string' || !metadata.createdAt || Buffer.byteLength(metadata.createdAt, 'utf8') > 40) {
    fail('createdAt must be bounded ISO text', 'CANDIDATE_STORE_METADATA_INVALID', { field: 'createdAt' });
  }
  assertConnection(database);
  database.exec(`PRAGMA user_version = ${CANDIDATE_ATTEMPT_STORE_SCHEMA_VERSION}`);
  for (const statement of candidateAttemptStoreDdlStatementsV1()) database.exec(statement);
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
  return inspectFixtureMetadata(database);
}

/** Module-private read-only verifier; public callers can reach it only through fixture attestation. */
function inspectFixtureMetadata(database) {
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
  const digests = candidateAttemptStoreDigestsV1();
  if (row.protocol_version !== CANDIDATE_ATTEMPT_STORE_PROTOCOL_VERSION || row.schema_version !== CANDIDATE_ATTEMPT_STORE_SCHEMA_VERSION
    || row.ddl_digest !== digests.ddlDigest || row.schema_digest !== digests.schemaDigest
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

function assertHarness(harness) {
  const state = harnesses.get(harness);
  if (!state) fail('Fixture authority is not issued by this harness', 'CANDIDATE_STORE_FIXTURE_AUTH_REQUIRED');
  if (state.closed) fail('Fixture authority has expired', 'CANDIDATE_STORE_FIXTURE_AUTH_EXPIRED');
  return state;
}

function assertFixture(fixture) {
  const state = fixtures.get(fixture);
  if (!state) fail('Fixture attestation is not issued by this harness', 'CANDIDATE_STORE_FIXTURE_AUTH_REQUIRED');
  if (state.closed) fail('Fixture attestation has expired', 'CANDIDATE_STORE_FIXTURE_AUTH_EXPIRED');
  return state;
}

function databasePath(state) {
  return join(state.root, 'candidate-attempt-store.sqlite');
}

function assertFreshTarget(state) {
  const marker = join(state.root, '.torch', 'install-manifest.json');
  if (existsSync(marker)) fail('Fixture target has a registered-install relationship', 'CANDIDATE_STORE_REGISTERED_TARGET_FORBIDDEN');
  const entries = readdirSync(state.root);
  if (entries.length !== 0) fail('Fixture target is not empty', 'CANDIDATE_STORE_FIXTURE_NONEMPTY');
}

function closeState(state) {
  if (state.closed) return;
  state.closed = true;
  rmSync(state.root, { recursive: true, force: true });
}

/** Creates its own synthetic target and opaque capability; callers cannot supply roots or SQLite handles. */
export function createCandidateAttemptStoreFixtureHarnessV1(input = {}) {
  exactObject(input, new Set(), 'Fixture harness input');
  const root = mkdtempSync(join(tmpdir(), 'torch-candidate-attempt-store-'));
  const fixtureIdentity = `fixture-${randomUUID()}`;
  const harness = Object.freeze({ schema: 'torch.dev/candidate-attempt-fixture-authority/v1alpha1', fixtureIdentity });
  harnesses.set(harness, { root, fixtureIdentity, used: false, closed: false });
  return harness;
}

/** Enumerated hermetic corruption hook for strict tests; it never reveals a filesystem or database handle. */
export function applyCandidateAttemptStoreFixtureTestCorruptionV1(input = {}) {
  exactObject(input, new Set(['harness', 'kind']), 'Fixture corruption input');
  const { harness, kind } = input;
  const state = assertHarness(harness);
  if (!TEST_CORRUPTIONS.has(kind)) {
    fail('Fixture corruption kind is unsupported', 'CANDIDATE_STORE_FIXTURE_INPUT_INVALID', { kind });
  }
  if (kind === 'nonempty') writeFileSync(join(state.root, 'preexisting-fixture-byte'), 'fixture only\n', { flag: 'wx' });
  if (kind === 'registered-relationship') {
    const markerRoot = join(state.root, '.torch');
    mkdirSync(markerRoot);
    writeFileSync(join(markerRoot, 'install-manifest.json'), '{"fixture":"registered-relationship"}\n', { flag: 'wx' });
  }
  if (kind === 'ddl-drift' || kind === 'digest-drift' || kind === 'malformed-meta-lexical') {
    if (!state.fixture) fail('Fixture corruption requires a provisioned fixture', 'CANDIDATE_STORE_FIXTURE_INPUT_INVALID', { kind });
    const database = new DatabaseSync(databasePath(state));
    try {
      if (kind === 'ddl-drift') database.exec('CREATE TABLE fixture_schema_drift (id TEXT PRIMARY KEY)');
      if (kind === 'digest-drift') {
        database.prepare('UPDATE candidate_attempt_store_meta SET ddl_digest = ? WHERE singleton = 1').run('0'.repeat(64));
      }
      if (kind === 'malformed-meta-lexical') {
        database.exec('PRAGMA ignore_check_constraints = ON');
        try {
          database.prepare('UPDATE candidate_attempt_store_meta SET ddl_digest = ? WHERE singleton = 1').run('A'.repeat(64));
        } finally {
          database.exec('PRAGMA ignore_check_constraints = OFF');
        }
      }
    } finally {
      database.close();
    }
  }
  return Object.freeze({ applied: kind });
}

export function provisionCandidateAttemptStoreFixtureV1(input = {}) {
  exactObject(input, new Set(['harness']), 'Fixture provision input');
  const state = assertHarness(input.harness);
  if (state.used) fail('Fixture authority is single-use', 'CANDIDATE_STORE_FIXTURE_AUTH_REUSED');
  state.used = true;
  assertFreshTarget(state);
  const database = new DatabaseSync(databasePath(state));
  let metadata;
  try {
    metadata = initializeFixtureStore(database, {
      fixtureIdentity: state.fixtureIdentity,
      storeIdentity: `store-${randomUUID()}`,
      createdAt: '2026-10-01T00:00:00.000Z',
    });
  } finally {
    database.close();
  }
  const fixture = Object.freeze({
    schema: 'torch.dev/candidate-attempt-fixture-attestation/v1alpha1',
    fixtureIdentity: metadata.fixtureIdentity,
    storeIdentity: metadata.storeIdentity,
    protocolVersion: metadata.protocolVersion,
    schemaVersion: metadata.schemaVersion,
    ddlDigest: metadata.ddlDigest,
    schemaDigest: metadata.schemaDigest,
    promotion: 'nonpromotable',
  });
  state.fixture = fixture;
  fixtures.set(fixture, state);
  return fixture;
}

/** Opens only a closure-owned fixture DB for read-only metadata inspection. */
export function inspectCandidateAttemptStoreFixtureV1(input = {}) {
  exactObject(input, new Set(['fixture']), 'Fixture inspection input');
  const fixture = input.fixture;
  const state = assertFixture(fixture);
  const database = new DatabaseSync(databasePath(state), { readOnly: true });
  try {
    const metadata = inspectFixtureMetadata(database);
    const digests = candidateAttemptStoreDigestsV1();
    if (metadata.fixtureIdentity !== fixture.fixtureIdentity || metadata.storeIdentity !== fixture.storeIdentity
      || metadata.ddlDigest !== digests.ddlDigest || metadata.schemaDigest !== digests.schemaDigest
      || fixture.promotion !== 'nonpromotable') {
      fail('Fixture attestation does not match its metadata', 'CANDIDATE_STORE_FIXTURE_DRIFT');
    }
    return Object.freeze({ ...metadata, nonpromotable: true });
  } finally {
    database.close();
  }
}

export function closeCandidateAttemptStoreFixtureV1(input = {}) {
  exactObject(input, new Set(['fixture']), 'Fixture close input');
  const fixture = input.fixture;
  const state = assertFixture(fixture);
  closeState(state);
  return Object.freeze({ closed: true, fixtureIdentity: fixture.fixtureIdentity });
}

export function closeCandidateAttemptStoreFixtureHarnessV1(input = {}) {
  exactObject(input, new Set(['harness']), 'Fixture harness close input');
  const state = assertHarness(input.harness);
  closeState(state);
  return Object.freeze({ closed: true, fixtureIdentity: state.fixtureIdentity });
}
