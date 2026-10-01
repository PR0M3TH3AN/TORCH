import { createHash, randomUUID } from 'node:crypto';
import { TorchError } from './errors.mjs';
import {
  canonicalManagedSubjectMetadataBytesV1,
  parseManagedSubjectMetadataV1,
} from './managed-subject-metadata.mjs';

export const CHECK_SUBJECT_CONTEXT_PROTOCOL_VERSION = 1;

const harnesses = new WeakMap();
const contexts = new WeakMap();
const MUTATIONS = new Set([
  'engine-observation-drift', 'adapter-observation-drift', 'stale-subject-observation',
  'dirty-subject-claim', 'unknown-field', 'mixed-field', 'head-relabel',
]);

function fail(message, code, details) {
  throw new TorchError(message, { code, details });
}

function exactObject(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object`, 'CHECK_SUBJECT_CONTEXT_INPUT_INVALID');
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${label} contains an unsupported field`, 'CHECK_SUBJECT_CONTEXT_INPUT_INVALID', { field: key });
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function frame(label, value) {
  const bytes = Buffer.from(value, 'utf8');
  return Buffer.concat([Buffer.from(`${label}:${bytes.length}\n`, 'ascii'), bytes, Buffer.from('\n', 'ascii')]);
}

function fixtureObservations() {
  return {
    schema: 'torch.dev/managed-subject-metadata/v1alpha1',
    protocolVersion: 1,
    engine: { moduleId: 'candidate-engine', interfaceVersion: 1, byteLength: 4096, sha256: '1'.repeat(64) },
    subject: {
      projectId: 'fixture-project', productCommit: '2'.repeat(40), cleanTreeDigest: '3'.repeat(64),
      storageSchemaVersion: 2, storageSchemaDigest: '4'.repeat(64),
    },
    adapter: {
      moduleId: 'fixture-adapter', interfaceVersion: 1, byteLength: 2048, sha256: '5'.repeat(64),
      controlPlaneSchemaVersion: 2, compatibleStorageSchemaVersion: 2, compatibleStorageSchemaDigest: '4'.repeat(64),
    },
  };
}

function assertHarness(harness) {
  const state = harnesses.get(harness);
  if (!state) fail('Fixture authority is not issued by this module', 'CHECK_SUBJECT_CONTEXT_FIXTURE_AUTH_REQUIRED');
  if (state.closed) fail('Fixture authority has expired', 'CHECK_SUBJECT_CONTEXT_FIXTURE_AUTH_EXPIRED');
  return state;
}

function assertContext(context) {
  const state = contexts.get(context);
  if (!state) fail('Fixture context is not issued by this module', 'CHECK_SUBJECT_CONTEXT_FIXTURE_AUTH_REQUIRED');
  if (state.closed) fail('Fixture context has expired', 'CHECK_SUBJECT_CONTEXT_FIXTURE_AUTH_EXPIRED');
  return state;
}

function mutate(state, kind) {
  const metadata = parseManagedSubjectMetadataV1(state.bytes);
  if (kind === 'engine-observation-drift') return canonicalManagedSubjectMetadataBytesV1({
    ...metadata, engine: { ...metadata.engine, sha256: '6'.repeat(64) },
  });
  if (kind === 'adapter-observation-drift') return canonicalManagedSubjectMetadataBytesV1({
    ...metadata, adapter: { ...metadata.adapter, sha256: '7'.repeat(64) },
  });
  if (kind === 'stale-subject-observation') return canonicalManagedSubjectMetadataBytesV1({
    ...metadata, subject: { ...metadata.subject, productCommit: '8'.repeat(40) },
  });
  if (kind === 'dirty-subject-claim') return Buffer.concat([state.bytes, frame('S-subject-state', 'dirty')]);
  if (kind === 'unknown-field') return Buffer.concat([state.bytes, frame('unexpected-field', 'value')]);
  if (kind === 'mixed-field') return Buffer.concat([state.bytes, frame('S-snapshot-policy-digest', '9'.repeat(64))]);
  if (kind === 'head-relabel') return Buffer.concat([state.bytes, frame('repository-head', 'a'.repeat(40))]);
  return canonicalManagedSubjectMetadataBytesV1(metadata);
}

/** Same E/S/A bytes as the data-only metadata module; the digest never implies a loaded or native engine. */
export function canonicalCheckSubjectEsaBytesV1(value) {
  return canonicalManagedSubjectMetadataBytesV1(value);
}

export function checkSubjectEsaDigestV1(value) {
  const bytes = Buffer.isBuffer(value) || value instanceof Uint8Array
    ? Buffer.from(value)
    : canonicalCheckSubjectEsaBytesV1(value);
  parseManagedSubjectMetadataV1(bytes);
  return sha256(bytes);
}

/** Issues an opaque, fixture-only authority. Callers may supply captured bytes, never roots, readers, or verifiers. */
export function createCheckSubjectFixtureHarnessV1(input = {}) {
  exactObject(input, new Set(['metadataBytes']), 'Fixture harness input');
  const candidateBytes = input.metadataBytes === undefined
    ? canonicalManagedSubjectMetadataBytesV1(fixtureObservations())
    : input.metadataBytes;
  parseManagedSubjectMetadataV1(candidateBytes);
  const bytes = Buffer.from(candidateBytes);
  const harness = Object.freeze({
    schema: 'torch.dev/check-subject-fixture-authority/v1alpha1', fixtureId: `fixture-${randomUUID()}`,
  });
  harnesses.set(harness, { bytes, digest: sha256(bytes), used: false, closed: false });
  return harness;
}

/** Enumerated test-only mutation hook; it cannot target registered metadata or expose a handle. */
export function applyCheckSubjectFixtureMutationV1(input = {}) {
  exactObject(input, new Set(['harness', 'kind']), 'Fixture mutation input');
  const state = assertHarness(input.harness);
  if (state.used || !MUTATIONS.has(input.kind)) {
    fail('Fixture mutation is unsupported', 'CHECK_SUBJECT_CONTEXT_INPUT_INVALID', { kind: input.kind });
  }
  state.bytes = mutate(state, input.kind);
  return Object.freeze({ applied: input.kind });
}

/** Admits only an issued single-use fixture and always marks its result untrusted and nonpromotable. */
export function admitFixtureCheckSubjectContextV1(input = {}) {
  exactObject(input, new Set(['harness']), 'Fixture admission input');
  const state = assertHarness(input.harness);
  if (state.used) fail('Fixture authority is single-use', 'CHECK_SUBJECT_CONTEXT_FIXTURE_AUTH_REUSED');
  const metadata = parseManagedSubjectMetadataV1(state.bytes);
  if (sha256(state.bytes) !== state.digest) {
    fail('Fixture observations drifted after issue', 'CHECK_SUBJECT_CONTEXT_FIXTURE_DRIFT');
  }
  state.used = true;
  const context = Object.freeze({
    schema: 'torch.dev/check-subject-context/v1alpha1',
    classification: 'fixture-untrusted',
    promotion: 'nonpromotable',
    nativeEligible: false,
    receiptEligible: false,
    esaDigest: state.digest,
    metadata,
  });
  contexts.set(context, state);
  return context;
}

export function inspectFixtureCheckSubjectContextV1(input = {}) {
  exactObject(input, new Set(['context']), 'Fixture inspection input');
  const state = assertContext(input.context);
  return Object.freeze({
    schema: input.context.schema,
    classification: 'fixture-untrusted',
    promotion: 'nonpromotable',
    nativeEligible: false,
    receiptEligible: false,
    esaDigest: state.digest,
    metadata: input.context.metadata,
  });
}

export function closeCheckSubjectFixtureHarnessV1(input = {}) {
  exactObject(input, new Set(['harness']), 'Fixture close input');
  const state = assertHarness(input.harness);
  state.closed = true;
  return Object.freeze({ closed: true });
}

/**
 * B1 deliberately has no reachable registered parent issuer. It may parse untrusted bytes for a
 * compatibility refusal, but it never opens a control plane, reads a database, or returns authority.
 */
export function admitRegisteredCheckSubjectContextV1(input = {}) {
  exactObject(input, new Set(['metadataBytes', 'requiredStorageSchemaVersion', 'currentStorageSchemaVersion']), 'Registered admission input');
  if (input.metadataBytes !== undefined) parseManagedSubjectMetadataV1(input.metadataBytes);
  const required = input.requiredStorageSchemaVersion;
  const current = input.currentStorageSchemaVersion;
  if (required !== undefined || current !== undefined) {
    if (!Number.isSafeInteger(required) || required < 1 || !Number.isSafeInteger(current) || current < 1) {
      fail('Registered schema observations are invalid', 'CHECK_SUBJECT_CONTEXT_INPUT_INVALID');
    }
    if (required !== current) {
      fail('Registered schema is incompatible with the required schema', 'CHECK_SUBJECT_CONTEXT_SCHEMA_INCOMPATIBLE', { required, current });
    }
  }
  fail('No registered parent composition is available in B1', 'CHECK_SUBJECT_CONTEXT_MISSING_COMPOSITION');
}
