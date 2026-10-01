import { createHash, randomBytes } from 'node:crypto';
import { TorchError } from '../kernel/errors.mjs';

const ADMISSION_SCHEMA = 'torch.dev/candidate-source-parent-admission/v2alpha1';
const ACK_SCHEMA = 'torch.dev/candidate-source-parent-binding/v2alpha1';
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_FRAME_BYTES = 64 * 1024;

function fail(message, code, details) {
  throw new TorchError(message, { code, details });
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function validString(value) {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Service-only closure factory. It has no public issuer that accepts caller
 * project/check/run tuples: CheckService supplies an opaque registered-plan
 * handle to stateForPlan and this module serializes only that captured state.
 */
export function createCandidateSourceBootstrapRuntimeV2({ stateForPlan, now = () => new Date() } = {}) {
  if (typeof stateForPlan !== 'function') throw new TypeError('stateForPlan is required');
  const attempts = new WeakMap();

  function create(plan) {
    const state = stateForPlan(plan);
    if (!state || typeof state !== 'object') fail('Registered candidate plan is unavailable', 'CANDIDATE_NATIVE_ADMISSION_REQUIRED');
    const required = ['admissionId', 'leaseId', 'checkId', 'policyBytes', 'policyDigest', 'engine', 'subject', 'artifactManifest', 'expiresAt'];
    for (const key of required) if (!Object.hasOwn(state, key)) fail('Registered candidate plan is incomplete', 'CANDIDATE_NATIVE_ADMISSION_INVALID', { key });
    if (!Buffer.isBuffer(state.policyBytes) || state.policyBytes.length === 0 || state.policyBytes.length > 1024 * 1024
      || !SHA256.test(state.policyDigest) || digest(state.policyBytes) !== state.policyDigest
      || !validString(state.admissionId) || !validString(state.leaseId) || !validString(state.checkId)
      || !Number.isSafeInteger(state.runGeneration) || !Number.isSafeInteger(state.guardGeneration)
      || Number.isNaN(Date.parse(state.expiresAt))) fail('Registered candidate plan is invalid', 'CANDIDATE_NATIVE_ADMISSION_INVALID');
    const handle = Object.freeze({});
    attempts.set(handle, { state, used: false, closed: false, nonce: randomBytes(32).toString('base64url') });
    return handle;
  }

  function open(handle) {
    const attempt = attempts.get(handle);
    if (!attempt || attempt.used || attempt.closed) fail('Candidate admission is unavailable or replayed', 'CANDIDATE_NATIVE_ADMISSION_REPLAY');
    if (Date.parse(attempt.state.expiresAt) <= now().getTime()) {
      attempt.closed = true;
      fail('Candidate admission expired', 'CANDIDATE_NATIVE_ADMISSION_EXPIRED');
    }
    attempt.used = true;
    const { state } = attempt;
    const frame = Buffer.from(JSON.stringify({
      schema: ADMISSION_SCHEMA, version: 2, admissionId: state.admissionId, leaseId: state.leaseId,
      checkId: state.checkId, runGeneration: state.runGeneration, guardGeneration: state.guardGeneration,
      policyBytesBase64: state.policyBytes.toString('base64'), policyDigest: state.policyDigest,
      engine: state.engine, subject: state.subject, artifactManifest: state.artifactManifest,
      receiptAdapterAdmission: null,
    }), 'utf8');
    if (frame.length > MAX_FRAME_BYTES) fail('Candidate parent admission frame exceeds its bound', 'CANDIDATE_NATIVE_ADMISSION_INVALID');
    return Object.freeze({ frame, acknowledgement: Buffer.from(`${ACK_SCHEMA}\n${state.admissionId}\n${state.policyDigest}\n`, 'utf8'), nonce: attempt.nonce });
  }

  function acknowledgeAndClose(handle, acknowledgement) {
    const attempt = attempts.get(handle);
    if (!attempt || !attempt.used || attempt.closed || !Buffer.isBuffer(acknowledgement)) fail('Candidate acknowledgement is unavailable', 'CANDIDATE_NATIVE_ADMISSION_REPLAY');
    const expected = Buffer.from(`${ACK_SCHEMA}\n${attempt.state.admissionId}\n${attempt.state.policyDigest}\n`, 'utf8');
    if (!acknowledgement.equals(expected)) fail('Candidate parent acknowledgement mismatches admission', 'CANDIDATE_PARENT_ACK_MISMATCH');
    attempt.closed = true;
    return Object.freeze({ admissionFdsClosed: true, receiptEligible: false });
  }

  function cancel(handle) {
    const attempt = attempts.get(handle);
    if (!attempt || attempt.used || attempt.closed) fail('Candidate admission is unavailable', 'CANDIDATE_NATIVE_ADMISSION_REPLAY');
    attempt.closed = true;
  }

  return Object.freeze({ create, open, acknowledgeAndClose, cancel });
}
