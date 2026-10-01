import { randomBytes } from 'node:crypto';
import { TorchError } from '../kernel/errors.mjs';

const live = new WeakSet(); const used = new Set();
const fail = (message, code, details) => { throw new TorchError(message, { code, details }); };
/** CheckService-only issuer. The returned object is intentionally not serializable and carries no DB/adapter/writer capability. */
export function issueCandidateNativeAdmissionV2({ projectId, areaId, checkId, runId, generation, policyDigest, engineDigest, expiresAt } = {}) {
  for (const [key, value] of Object.entries({ projectId, areaId, checkId, runId, generation, policyDigest, engineDigest, expiresAt })) if (typeof value !== 'string' || !value) fail('Candidate native admission is incomplete', 'CANDIDATE_NATIVE_ADMISSION_INVALID', { key });
  const admission = Object.freeze({ schema: 'torch.dev/candidate-native-admission/v2alpha1', projectId, areaId, checkId, runId, generation, policyDigest, engineDigest, expiresAt, nonce: randomBytes(32).toString('base64url') }); live.add(admission); return admission;
}
export function openCandidateSourceBootstrapV2(admission, { now = () => new Date() } = {}) {
  if (!live.has(admission) || used.has(admission.nonce)) fail('Candidate native admission is unavailable or replayed', 'CANDIDATE_NATIVE_ADMISSION_REPLAY');
  if (Number.isNaN(Date.parse(admission.expiresAt)) || Date.parse(admission.expiresAt) <= now().getTime()) fail('Candidate native admission expired', 'CANDIDATE_NATIVE_ADMISSION_EXPIRED');
  used.add(admission.nonce); live.delete(admission);
  return Object.freeze({ schema: 'torch.dev/candidate-bootstrap/v2alpha1', nonce: admission.nonce, runId: admission.runId, generation: admission.generation, policyDigest: admission.policyDigest, engineDigest: admission.engineDigest, expiresAt: admission.expiresAt, transport: Object.freeze({ inputFd: 3, acknowledgementFd: 4, closesBeforeCandidateSpawn: true }) });
}
