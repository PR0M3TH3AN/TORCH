import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  MANAGED_SUBJECT_METADATA_MAX_FRAME_BYTES,
  MANAGED_SUBJECT_METADATA_PROTOCOL_VERSION,
  canonicalManagedSubjectMetadataBytesV1,
  parseManagedSubjectMetadataV1,
  validateManagedSubjectMetadataV1,
} from '../../src/kernel/managed-subject-metadata.mjs';
import {
  CHECK_SUBJECT_CONTEXT_PROTOCOL_VERSION,
  admitFixtureCheckSubjectContextV1,
  admitRegisteredCheckSubjectContextV1,
  applyCheckSubjectFixtureMutationV1,
  canonicalCheckSubjectEsaBytesV1,
  checkSubjectEsaDigestV1,
  closeCheckSubjectFixtureHarnessV1,
  createCheckSubjectFixtureHarnessV1,
  inspectFixtureCheckSubjectContextV1,
} from '../../src/kernel/check-subject-context.mjs';

const observations = Object.freeze({
  schema: 'torch.dev/managed-subject-metadata/v1alpha1',
  protocolVersion: 1,
  engine: Object.freeze({ moduleId: 'candidate-engine', interfaceVersion: 1, byteLength: 4096, sha256: '1'.repeat(64) }),
  subject: Object.freeze({
    projectId: 'fixture-project', productCommit: '2'.repeat(40), cleanTreeDigest: '3'.repeat(64),
    storageSchemaVersion: 2, storageSchemaDigest: '4'.repeat(64),
  }),
  adapter: Object.freeze({
    moduleId: 'fixture-adapter', interfaceVersion: 1, byteLength: 2048, sha256: '5'.repeat(64),
    controlPlaneSchemaVersion: 2, compatibleStorageSchemaVersion: 2, compatibleStorageSchemaDigest: '4'.repeat(64),
  }),
});

function frame(label, value) {
  const bytes = Buffer.from(value, 'utf8');
  return Buffer.from(`${label}:${bytes.length}\n${value}\n`, 'utf8');
}

function independentlyFramedBytes(value = observations) {
  return Buffer.concat([
    frame('schema', value.schema), frame('protocol-version', String(value.protocolVersion)),
    frame('E-module-id', value.engine.moduleId), frame('E-interface-version', String(value.engine.interfaceVersion)),
    frame('E-byte-length', String(value.engine.byteLength)), frame('E-sha256', value.engine.sha256),
    frame('S-project-id', value.subject.projectId), frame('S-product-commit', value.subject.productCommit),
    frame('S-clean-tree-digest', value.subject.cleanTreeDigest), frame('S-storage-schema-version', String(value.subject.storageSchemaVersion)),
    frame('S-storage-schema-digest', value.subject.storageSchemaDigest),
    frame('A-module-id', value.adapter.moduleId), frame('A-interface-version', String(value.adapter.interfaceVersion)),
    frame('A-byte-length', String(value.adapter.byteLength)), frame('A-sha256', value.adapter.sha256),
    frame('A-control-plane-schema-version', String(value.adapter.controlPlaneSchemaVersion)),
    frame('A-compatible-storage-schema-version', String(value.adapter.compatibleStorageSchemaVersion)),
    frame('A-compatible-storage-schema-digest', value.adapter.compatibleStorageSchemaDigest),
  ]);
}

function expectCode(callback, code) {
  assert.throws(callback, (error) => error.code === code);
}

test('SCN-check-subject-context-canonical-E-S-A: independently framed captured observations bind separate engine, subject, and adapter bytes', async () => {
  const metadata = await import('../../src/kernel/managed-subject-metadata.mjs');
  const context = await import('../../src/kernel/check-subject-context.mjs');
  const bytes = independentlyFramedBytes();
  assert.equal(MANAGED_SUBJECT_METADATA_PROTOCOL_VERSION, 1);
  assert.equal(CHECK_SUBJECT_CONTEXT_PROTOCOL_VERSION, 1);
  assert.deepEqual(Object.keys(metadata), [
    'MANAGED_SUBJECT_METADATA_MAX_FRAME_BYTES', 'MANAGED_SUBJECT_METADATA_PROTOCOL_VERSION',
    'canonicalManagedSubjectMetadataBytesV1', 'parseManagedSubjectMetadataV1', 'validateManagedSubjectMetadataV1',
  ]);
  assert.deepEqual(Object.keys(context), [
    'CHECK_SUBJECT_CONTEXT_PROTOCOL_VERSION', 'admitFixtureCheckSubjectContextV1', 'admitRegisteredCheckSubjectContextV1',
    'applyCheckSubjectFixtureMutationV1', 'canonicalCheckSubjectEsaBytesV1', 'checkSubjectEsaDigestV1',
    'closeCheckSubjectFixtureHarnessV1', 'createCheckSubjectFixtureHarnessV1', 'inspectFixtureCheckSubjectContextV1',
  ]);
  assert.deepEqual(canonicalManagedSubjectMetadataBytesV1(observations), bytes);
  assert.deepEqual(canonicalCheckSubjectEsaBytesV1(observations), bytes);
  assert.equal(checkSubjectEsaDigestV1(bytes), createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(parseManagedSubjectMetadataV1(bytes), validateManagedSubjectMetadataV1(observations));
});

test('SCN-check-subject-context-v1-refusal: parent, native, loaded-engine, V2, selectors, and oversized bytes cannot reinterpret fixture observations', () => {
  const bytes = independentlyFramedBytes();
  expectCode(() => canonicalManagedSubjectMetadataBytesV1({ ...observations, parentBinding: 'forged' }), 'MANAGED_SUBJECT_METADATA_INVALID');
  expectCode(() => canonicalManagedSubjectMetadataBytesV1({ ...observations, engine: { ...observations.engine, loadedEngine: true } }), 'MANAGED_SUBJECT_METADATA_INVALID');
  expectCode(() => parseManagedSubjectMetadataV1(Buffer.concat([bytes, frame('S-snapshot-policy-digest', '9'.repeat(64))])), 'MANAGED_SUBJECT_METADATA_INVALID');
  expectCode(() => parseManagedSubjectMetadataV1(Buffer.concat([bytes, frame('native-eligible', 'true')])), 'MANAGED_SUBJECT_METADATA_INVALID');
  expectCode(() => parseManagedSubjectMetadataV1(Buffer.alloc(MANAGED_SUBJECT_METADATA_MAX_FRAME_BYTES + 1)), 'MANAGED_SUBJECT_METADATA_FRAME_TOO_LARGE');

  const oversized = Buffer.alloc(MANAGED_SUBJECT_METADATA_MAX_FRAME_BYTES + 1);
  const originalBufferFrom = Buffer.from;
  let copiedBytes = 0;
  Buffer.from = (...args) => {
    copiedBytes += 1;
    return originalBufferFrom(...args);
  };
  try {
    expectCode(() => parseManagedSubjectMetadataV1(oversized), 'MANAGED_SUBJECT_METADATA_FRAME_TOO_LARGE');
    expectCode(() => checkSubjectEsaDigestV1(oversized), 'MANAGED_SUBJECT_METADATA_FRAME_TOO_LARGE');
  } finally {
    Buffer.from = originalBufferFrom;
  }
  assert.equal(copiedBytes, 0, 'oversized captured bytes must refuse before a copy, hash, or frame parse');

  let bytesRead = false;
  const selectorBeforeParse = { root: '/tmp/not-authority', get metadataBytes() { bytesRead = true; return bytes; } };
  expectCode(() => createCheckSubjectFixtureHarnessV1(selectorBeforeParse), 'CHECK_SUBJECT_CONTEXT_INPUT_INVALID');
  assert.equal(bytesRead, false, 'public selectors must fail before metadata parsing');
  for (const selector of ['root', 'database', 'ddl', 'manifest', 'metadataReader', 'engineVerifier', 'adapterSelector', 'path']) {
    let selectorBytesRead = false;
    const input = { [selector]: 'forged', get metadataBytes() { selectorBytesRead = true; return bytes; } };
    expectCode(() => admitRegisteredCheckSubjectContextV1(input), 'CHECK_SUBJECT_CONTEXT_INPUT_INVALID');
    assert.equal(selectorBytesRead, false, `${selector} must fail before parsing`);
  }
});

test('SCN-check-subject-context-fixture-authority: issued-only, single-use fixture admission is clone-, expiry-, and promotion-resistant', () => {
  const harness = createCheckSubjectFixtureHarnessV1({ metadataBytes: independentlyFramedBytes() });
  const copiedHarness = Object.freeze({ ...harness });
  expectCode(() => admitFixtureCheckSubjectContextV1({ harness: copiedHarness }), 'CHECK_SUBJECT_CONTEXT_FIXTURE_AUTH_REQUIRED');
  const context = admitFixtureCheckSubjectContextV1({ harness });
  assert.deepEqual({
    classification: context.classification, promotion: context.promotion,
    nativeEligible: context.nativeEligible, receiptEligible: context.receiptEligible,
  }, { classification: 'fixture-untrusted', promotion: 'nonpromotable', nativeEligible: false, receiptEligible: false });
  assert.equal(Object.hasOwn(context, 'receipt'), false);
  expectCode(() => admitFixtureCheckSubjectContextV1({ harness }), 'CHECK_SUBJECT_CONTEXT_FIXTURE_AUTH_REUSED');
  expectCode(() => inspectFixtureCheckSubjectContextV1({ context: Object.freeze({ ...context }) }), 'CHECK_SUBJECT_CONTEXT_FIXTURE_AUTH_REQUIRED');
  expectCode(() => inspectFixtureCheckSubjectContextV1({ context: { schema: context.schema } }), 'CHECK_SUBJECT_CONTEXT_FIXTURE_AUTH_REQUIRED');
  assert.deepEqual(inspectFixtureCheckSubjectContextV1({ context }), context);
  closeCheckSubjectFixtureHarnessV1({ harness });
  expectCode(() => inspectFixtureCheckSubjectContextV1({ context }), 'CHECK_SUBJECT_CONTEXT_FIXTURE_AUTH_EXPIRED');
});

test('SCN-check-subject-context-mutation-resistance: independently observed E/S/A drift and noncanonical claims fail closed', () => {
  for (const [kind, code] of [
    ['engine-observation-drift', 'CHECK_SUBJECT_CONTEXT_FIXTURE_DRIFT'],
    ['adapter-observation-drift', 'CHECK_SUBJECT_CONTEXT_FIXTURE_DRIFT'],
    ['stale-subject-observation', 'CHECK_SUBJECT_CONTEXT_FIXTURE_DRIFT'],
    ['dirty-subject-claim', 'MANAGED_SUBJECT_METADATA_INVALID'],
    ['unknown-field', 'MANAGED_SUBJECT_METADATA_INVALID'],
    ['mixed-field', 'MANAGED_SUBJECT_METADATA_INVALID'],
    ['head-relabel', 'MANAGED_SUBJECT_METADATA_INVALID'],
  ]) {
    const harness = createCheckSubjectFixtureHarnessV1({ metadataBytes: independentlyFramedBytes() });
    applyCheckSubjectFixtureMutationV1({ harness, kind });
    expectCode(() => admitFixtureCheckSubjectContextV1({ harness }), code);
    closeCheckSubjectFixtureHarnessV1({ harness });
  }
});

test('SCN-check-subject-context-schema-and-native-refusal: schema2 is readable legacy evidence, current2-required3 and all registered v1 admission refuse without state access', () => {
  const bytes = independentlyFramedBytes();
  assert.equal(parseManagedSubjectMetadataV1(bytes).subject.storageSchemaVersion, 2);
  expectCode(() => admitRegisteredCheckSubjectContextV1({
    metadataBytes: bytes, requiredStorageSchemaVersion: 3, currentStorageSchemaVersion: 2,
  }), 'CHECK_SUBJECT_CONTEXT_SCHEMA_INCOMPATIBLE');
  expectCode(() => admitRegisteredCheckSubjectContextV1({
    metadataBytes: bytes, requiredStorageSchemaVersion: 2, currentStorageSchemaVersion: 2,
  }), 'CHECK_SUBJECT_CONTEXT_MISSING_COMPOSITION');
  expectCode(() => admitRegisteredCheckSubjectContextV1(), 'CHECK_SUBJECT_CONTEXT_MISSING_COMPOSITION');
  const source = `${readFileSync(new URL('../../src/kernel/managed-subject-metadata.mjs', import.meta.url), 'utf8')}\n${readFileSync(new URL('../../src/kernel/check-subject-context.mjs', import.meta.url), 'utf8')}`;
  for (const forbidden of ['ControlPlane', 'openControlPlane', 'DatabaseSync', "node:sqlite", '.prepare(']) {
    assert.equal(source.includes(forbidden), false, `B1 data-only modules must not invoke ${forbidden}`);
  }
});
