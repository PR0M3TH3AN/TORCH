import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { TorchError } from './errors.mjs';

export const CANDIDATE_SOURCE_PARENT_V2_ADMISSION_SCHEMA = 'torch.dev/candidate-source-parent-admission/v2alpha1';
export const CANDIDATE_SOURCE_PARENT_V2_BINDING_SCHEMA = 'torch.dev/candidate-source-parent-binding/v2alpha1';
export const CANDIDATE_SOURCE_PARENT_V2_MAX_ADMISSION_BYTES = 64 * 1024;

const FD3 = 3;
const FD4 = 4;
const bindings = new WeakMap();

const ADMISSION_KEYS = new Set([
  'schema', 'version', 'admissionId', 'leaseId', 'checkId', 'runGeneration', 'guardGeneration',
  'policyBytesBase64', 'policyDigest', 'engine', 'subject', 'artifactManifest', 'receiptAdapterAdmission',
]);
const ENGINE_KEYS = new Set(['pre', 'post']);
const ENGINE_OBSERVATION_KEYS = new Set([
  'interfaceId', 'moduleId', 'entryByteLength', 'entrySha256', 'dependencyManifestByteLength',
  'dependencyManifestSha256', 'node', 'npm', 'checkDefinitionSha256', 'argv',
]);
const TOOL_KEYS = new Set(['realpath', 'entryByteLength', 'entrySha256']);
const SUBJECT_KEYS = new Set([
  'projectId', 'productCommit', 'cleanTreeDigest', 'frozenInputManifestSha256', 'inputFileCount', 'inputTotalBytes',
]);
const ARTIFACT_MANIFEST_KEYS = new Set(['schema', 'manifestSha256']);
const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const ID = /^[a-z0-9][a-z0-9-]*$/;

function fail(message, code, details) {
  throw new TorchError(message, { code, details });
}

function exactObject(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object`, 'CANDIDATE_PARENT_ADMISSION_INVALID');
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${label} contains an unsupported field`, 'CANDIDATE_PARENT_ADMISSION_INVALID', { field: key });
  }
}

function requiredString(value, label, pattern = undefined) {
  if (typeof value !== 'string' || value.length === 0 || (pattern && !pattern.test(value))) {
    fail(`${label} is invalid`, 'CANDIDATE_PARENT_ADMISSION_INVALID');
  }
  return value;
}

function requiredCount(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    fail(`${label} is invalid`, 'CANDIDATE_PARENT_ADMISSION_INVALID');
  }
  return value;
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function deepFreeze(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return value;
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function parseToolObservation(value, label) {
  exactObject(value, TOOL_KEYS, label);
  return {
    realpath: requiredString(value.realpath, `${label}.realpath`),
    entryByteLength: requiredCount(value.entryByteLength, `${label}.entryByteLength`, 1024 * 1024 * 1024),
    entrySha256: requiredString(value.entrySha256, `${label}.entrySha256`, SHA256),
  };
}

function parseEngineObservation(value, label) {
  exactObject(value, ENGINE_OBSERVATION_KEYS, label);
  if (!Array.isArray(value.argv) || value.argv.length > 64 || value.argv.some((arg) => typeof arg !== 'string' || arg.length > 4096)) {
    fail(`${label}.argv is invalid`, 'CANDIDATE_PARENT_ADMISSION_INVALID');
  }
  return {
    interfaceId: requiredString(value.interfaceId, `${label}.interfaceId`),
    moduleId: requiredString(value.moduleId, `${label}.moduleId`),
    entryByteLength: requiredCount(value.entryByteLength, `${label}.entryByteLength`, 1024 * 1024 * 1024),
    entrySha256: requiredString(value.entrySha256, `${label}.entrySha256`, SHA256),
    dependencyManifestByteLength: requiredCount(value.dependencyManifestByteLength, `${label}.dependencyManifestByteLength`, 16 * 1024 * 1024),
    dependencyManifestSha256: requiredString(value.dependencyManifestSha256, `${label}.dependencyManifestSha256`, SHA256),
    node: parseToolObservation(value.node, `${label}.node`),
    npm: parseToolObservation(value.npm, `${label}.npm`),
    checkDefinitionSha256: requiredString(value.checkDefinitionSha256, `${label}.checkDefinitionSha256`, SHA256),
    argv: [...value.argv],
  };
}

function parseAdmission(bytes) {
  if (!bytes.length || bytes.length > CANDIDATE_SOURCE_PARENT_V2_MAX_ADMISSION_BYTES) {
    fail('Candidate parent admission is missing or exceeds its fixed bound', 'CANDIDATE_PARENT_ADMISSION_INVALID');
  }
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); } catch {
    fail('Candidate parent admission is not JSON', 'CANDIDATE_PARENT_ADMISSION_INVALID');
  }
  exactObject(value, ADMISSION_KEYS, 'Candidate parent admission');
  if (value.schema !== CANDIDATE_SOURCE_PARENT_V2_ADMISSION_SCHEMA || value.version !== 2) {
    fail('Candidate parent admission version is unsupported', 'CANDIDATE_PARENT_ADMISSION_UNSUPPORTED');
  }
  const policyBytes = Buffer.from(requiredString(value.policyBytesBase64, 'policyBytesBase64'), 'base64');
  if (!policyBytes.length || policyBytes.length > 1024 * 1024 || policyBytes.toString('base64') !== value.policyBytesBase64) {
    fail('Candidate policy transport is invalid', 'CANDIDATE_PARENT_ADMISSION_INVALID');
  }
  const policyDigest = requiredString(value.policyDigest, 'policyDigest', SHA256);
  if (sha256(policyBytes) !== policyDigest) {
    fail('Candidate policy transport digest mismatches', 'CANDIDATE_PARENT_ADMISSION_MISMATCH');
  }
  exactObject(value.engine, ENGINE_KEYS, 'engine observations');
  const engine = { pre: parseEngineObservation(value.engine.pre, 'engine.pre'), post: parseEngineObservation(value.engine.post, 'engine.post') };
  if (canonicalJson(engine.pre) !== canonicalJson(engine.post)) {
    fail('Candidate engine observations drifted', 'CANDIDATE_PARENT_ENGINE_DRIFT');
  }
  exactObject(value.subject, SUBJECT_KEYS, 'subject observations');
  const subject = {
    projectId: requiredString(value.subject.projectId, 'subject.projectId', ID),
    productCommit: requiredString(value.subject.productCommit, 'subject.productCommit', COMMIT),
    cleanTreeDigest: requiredString(value.subject.cleanTreeDigest, 'subject.cleanTreeDigest', SHA256),
    frozenInputManifestSha256: requiredString(value.subject.frozenInputManifestSha256, 'subject.frozenInputManifestSha256', SHA256),
    inputFileCount: requiredCount(value.subject.inputFileCount, 'subject.inputFileCount', 8192),
    inputTotalBytes: requiredCount(value.subject.inputTotalBytes, 'subject.inputTotalBytes', 512 * 1024 * 1024),
  };
  exactObject(value.artifactManifest, ARTIFACT_MANIFEST_KEYS, 'artifact manifest');
  const artifactManifest = {
    schema: requiredString(value.artifactManifest.schema, 'artifactManifest.schema'),
    manifestSha256: requiredString(value.artifactManifest.manifestSha256, 'artifactManifest.manifestSha256', SHA256),
  };
  if (value.receiptAdapterAdmission !== null) {
    fail('B2 parent cannot admit a receipt adapter', 'CANDIDATE_PARENT_ADAPTER_ADMISSION_FORBIDDEN');
  }
  return deepFreeze({
    admissionId: requiredString(value.admissionId, 'admissionId', ID),
    leaseId: requiredString(value.leaseId, 'leaseId', ID),
    checkId: requiredString(value.checkId, 'checkId', ID),
    runGeneration: requiredCount(value.runGeneration, 'runGeneration'),
    guardGeneration: requiredCount(value.guardGeneration, 'guardGeneration'),
    policyBytes,
    policyDigest,
    engine,
    subject,
    artifactManifest,
    receiptAdapterAdmission: null,
  });
}

function readPrivateAdmission() {
  try {
    return readFileSync(FD3);
  } catch (error) {
    fail('Candidate parent private admission channel is unavailable', 'CANDIDATE_PARENT_NATIVE_BOOTSTRAP_UNAVAILABLE', { cause: error.code ?? 'UNKNOWN' });
  }
}

function acknowledge(admission) {
  const body = Buffer.from(`${CANDIDATE_SOURCE_PARENT_V2_BINDING_SCHEMA}\n${admission.admissionId}\n${admission.policyDigest}\n`, 'utf8');
  try { writeFileSync(FD4, body); } catch (error) {
    fail('Candidate parent private acknowledgement channel is unavailable', 'CANDIDATE_PARENT_NATIVE_BOOTSTRAP_UNAVAILABLE', { cause: error.code ?? 'UNKNOWN' });
  }
}

/**
 * Reads only Work's inherited FD3 admission and returns an opaque, one-shot
 * binding. Registered identity/lease authorization happens in CheckService before
 * this module starts; this module neither opens a ControlPlane nor accepts caller
 * project, root, DB, environment, adapter, or writer selectors.
 */
export function openCandidateSourceParentV2() {
  const admission = parseAdmission(readPrivateAdmission());
  acknowledge(admission);
  const binding = Object.freeze({ schema: CANDIDATE_SOURCE_PARENT_V2_BINDING_SCHEMA });
  bindings.set(binding, { admission, consumed: false });
  return binding;
}

/** Resolves an issued parent binding once, exposing only safe execution metadata. */
export function resolveCandidateSourceParentV2(input = {}) {
  exactObject(input, new Set(['parentBinding']), 'Candidate parent resolution input');
  const state = bindings.get(input.parentBinding);
  if (!state) fail('Candidate parent binding is not issued by this module', 'CANDIDATE_PARENT_BINDING_REQUIRED');
  if (state.consumed) fail('Candidate parent binding is single-use', 'CANDIDATE_PARENT_BINDING_REUSED');
  state.consumed = true;
  const { admission } = state;
  return deepFreeze({
    schema: CANDIDATE_SOURCE_PARENT_V2_BINDING_SCHEMA,
    checkId: admission.checkId,
    leaseId: admission.leaseId,
    runGeneration: admission.runGeneration,
    guardGeneration: admission.guardGeneration,
    policyBytes: Buffer.from(admission.policyBytes),
    policyDigest: admission.policyDigest,
    engine: structuredClone(admission.engine),
    subject: structuredClone(admission.subject),
    artifactManifest: structuredClone(admission.artifactManifest),
    receiptAdapterAdmission: null,
    receiptEligible: false,
  });
}
