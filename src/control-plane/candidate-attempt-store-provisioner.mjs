import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { TorchError } from '../kernel/errors.mjs';
import {
  candidateAttemptStoreDigestsV1,
  initializeCandidateAttemptStoreV1,
  inspectCandidateAttemptStoreMetadataV1,
} from './candidate-attempt-store.mjs';

const harnesses = new WeakMap();
const fixtures = new WeakMap();
const TEST_CORRUPTIONS = new Set(['nonempty', 'registered-relationship', 'ddl-drift', 'malformed-meta']);

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
  if (kind === 'ddl-drift' || kind === 'malformed-meta') {
    if (!state.fixture) fail('Fixture corruption requires a provisioned fixture', 'CANDIDATE_STORE_FIXTURE_INPUT_INVALID', { kind });
    const database = new DatabaseSync(databasePath(state));
    try {
      if (kind === 'ddl-drift') database.exec('CREATE TABLE fixture_schema_drift (id TEXT PRIMARY KEY)');
      else database.prepare('UPDATE candidate_attempt_store_meta SET ddl_digest = ? WHERE singleton = 1').run('0'.repeat(64));
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
    metadata = initializeCandidateAttemptStoreV1(database, {
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
    const metadata = inspectCandidateAttemptStoreMetadataV1(database);
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
