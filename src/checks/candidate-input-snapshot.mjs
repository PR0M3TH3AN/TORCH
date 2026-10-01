import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, writeSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { TorchError } from '../kernel/errors.mjs';

export const CANDIDATE_PRODUCT_INPUT_LIMITS_V2 = Object.freeze({ maxRecords: 8192, maxPathUtf8Bytes: 4096, maxFileBytes: 67_108_864, maxTotalBytes: 536_870_912, maxFrameBytes: 1_048_576, chunkBytes: 65_536 });
const fail = (message, code, details) => { throw new TorchError(message, { code, details }); };
const order = (a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
const bytes = (value) => Buffer.byteLength(value, 'utf8');
function pathOf(value, limits) {
  if (typeof value !== 'string' || !value || isAbsolute(value) || value.includes('\\') || value.includes('\0') || bytes(value) > limits.maxPathUtf8Bytes || value.split('/').some((part) => !part || part === '.' || part === '..' || part === '.git')) fail('Candidate snapshot path is invalid', 'CANDIDATE_SNAPSHOT_PATH_INVALID', { path: value });
  return value;
}
function normalizeLimits(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !Object.hasOwn(CANDIDATE_PRODUCT_INPUT_LIMITS_V2, key))) fail('Candidate snapshot limits are invalid', 'CANDIDATE_SNAPSHOT_LIMIT_INVALID');
  const result = {};
  for (const [key, maximum] of Object.entries(CANDIDATE_PRODUCT_INPUT_LIMITS_V2)) { const v = value[key] ?? maximum; if (!Number.isInteger(v) || v < 1 || v > maximum) fail('Candidate snapshot limit is invalid', 'CANDIDATE_SNAPSHOT_LIMIT_INVALID', { key, value: v }); result[key] = v; }
  return Object.freeze(result);
}
function regular(path) { const stat = lstatSync(path); if (stat.isSymbolicLink()) fail('Candidate snapshot rejects links', 'CANDIDATE_SNAPSHOT_LINK_REJECTED', { path }); if (!stat.isFile() && !stat.isDirectory()) fail('Candidate snapshot rejects special files', 'CANDIDATE_SNAPSHOT_SPECIAL_REJECTED', { path }); return stat; }
function files(root, paths, limits) {
  const result = [];
  const visit = (rel) => { const absolute = join(root, rel); const stat = regular(absolute); if (stat.isDirectory()) for (const name of readdirSync(absolute).sort(order)) visit(`${rel}/${name}`); else { if (stat.size > limits.maxFileBytes) fail('Candidate snapshot file cap exceeded', 'CANDIDATE_SNAPSHOT_LIMIT_EXCEEDED', { path: rel }); result.push({ path: rel, size: stat.size, executable: Boolean(stat.mode & 0o111) }); } };
  for (const path of [...new Set(paths.map((p) => pathOf(p, limits)))].sort(order)) visit(path);
  if (!result.length || result.length > limits.maxRecords) fail('Candidate snapshot record cap exceeded', 'CANDIDATE_SNAPSHOT_LIMIT_EXCEEDED');
  return result.sort((a, b) => order(a.path, b.path));
}
function copyAndHash(source, destination, expected, limits) {
  let inFd; let outFd;
  try {
    inFd = openSync(source, constants.O_RDONLY | constants.O_NOFOLLOW); const before = fstatSync(inFd);
    if (!before.isFile() || before.size !== expected.size || before.size > limits.maxFileBytes) fail('Candidate snapshot source drifted', 'CANDIDATE_SNAPSHOT_DRIFT', { path: expected.path });
    outFd = openSync(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, expected.executable ? 0o500 : 0o400);
    const hash = createHash('sha256'); const buffer = Buffer.alloc(limits.chunkBytes); let total = 0;
    for (;;) { const count = readSync(inFd, buffer, 0, buffer.length, null); if (!count) break; total += count; if (total > limits.maxFileBytes) fail('Candidate snapshot file cap exceeded', 'CANDIDATE_SNAPSHOT_LIMIT_EXCEEDED'); hash.update(buffer.subarray(0, count)); let offset = 0; while (offset < count) offset += writeSync(outFd, buffer, offset, count - offset); }
    const after = fstatSync(inFd); if (total !== before.size || after.size !== before.size) fail('Candidate snapshot source changed while read', 'CANDIDATE_SNAPSHOT_DRIFT', { path: expected.path });
    return { path: expected.path, bytes: total, sha256: hash.digest('hex'), executable: expected.executable };
  } finally { if (inFd !== undefined) closeSync(inFd); if (outFd !== undefined) closeSync(outFd); }
}
function hashRegularFile(path, expected, limits) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); const before = fstatSync(fd);
    if (!before.isFile() || before.size !== expected.bytes || before.size > limits.maxFileBytes) fail('Candidate snapshot drifted', 'CANDIDATE_SNAPSHOT_DRIFT', { path: expected.path });
    const hash = createHash('sha256'); const buffer = Buffer.alloc(limits.chunkBytes); let total = 0;
    for (;;) { const count = readSync(fd, buffer, 0, buffer.length, null); if (!count) break; total += count; if (total > limits.maxFileBytes) fail('Candidate snapshot cap exceeded', 'CANDIDATE_SNAPSHOT_LIMIT_EXCEEDED'); hash.update(buffer.subarray(0, count)); }
    const after = fstatSync(fd); if (total !== before.size || after.size !== before.size) fail('Candidate snapshot drifted while read', 'CANDIDATE_SNAPSHOT_DRIFT', { path: expected.path });
    return { path: expected.path, bytes: total, sha256: hash.digest('hex'), executable: expected.executable };
  } finally { if (fd !== undefined) closeSync(fd); }
}
/** Private caller seam: callers obtain inputRoot from the returned opaque snapshot, never from a policy selector. */
function captureCandidateInputSnapshotV2({ sourceRoot, destinationRoot, paths, limits: requestedLimits = {}, id = randomUUID() } = {}) {
  const limits = normalizeLimits(requestedLimits); if (typeof sourceRoot !== 'string' || typeof destinationRoot !== 'string' || !Array.isArray(paths)) fail('Candidate snapshot request is invalid', 'CANDIDATE_SNAPSHOT_INPUT_INVALID');
  const source = resolve(sourceRoot); const destination = resolve(destinationRoot); if (source === destination || !relative(source, destination).startsWith('..')) fail('Candidate snapshot destination must be outside source', 'CANDIDATE_SNAPSHOT_INPUT_INVALID');
  const listed = files(source, paths, limits); mkdirSync(destination, { recursive: false, mode: 0o700 }); let totalBytes = 0; const records = [];
  for (const item of listed) { const target = join(destination, item.path); mkdirSync(resolve(target, '..'), { recursive: true, mode: 0o700 }); const record = copyAndHash(join(source, item.path), target, item, limits); totalBytes += record.bytes; if (totalBytes > limits.maxTotalBytes) fail('Candidate snapshot total cap exceeded', 'CANDIDATE_SNAPSHOT_LIMIT_EXCEEDED'); records.push(record); }
  const manifest = Object.freeze({ schema: 'torch.dev/candidate-input-manifest/v2alpha1', id, files: Object.freeze(records), totalBytes, digest: createHash('sha256').update(JSON.stringify(records)).digest('hex') });
  return Object.freeze({ schema: 'torch.dev/candidate-input-snapshot/v2alpha1', inputRoot: destination, manifest, limits });
}
function verifyCandidateInputSnapshotV2(snapshot = {}) {
  if (snapshot?.schema !== 'torch.dev/candidate-input-snapshot/v2alpha1' || !snapshot.manifest?.files || typeof snapshot.inputRoot !== 'string') fail('Candidate snapshot is malformed', 'CANDIDATE_SNAPSHOT_INVALID');
  const listed = files(snapshot.inputRoot, snapshot.manifest.files.map((file) => file.path), snapshot.limits);
  const observed = listed.map((file) => hashRegularFile(join(snapshot.inputRoot, file.path), { ...file, bytes: file.size }, snapshot.limits));
  if (JSON.stringify(observed) !== JSON.stringify(snapshot.manifest.files)
    || createHash('sha256').update(JSON.stringify(observed)).digest('hex') !== snapshot.manifest.digest) {
    fail('Candidate snapshot content drifted', 'CANDIDATE_SNAPSHOT_DRIFT');
  }
  return Object.freeze({ verified: true, digest: snapshot.manifest.digest, files: observed.length, totalBytes: snapshot.manifest.totalBytes });
}

/**
 * The public boundary accepts only a service-issued attempt. Source roots,
 * paths, destinations, and S limits live in the service's private state.
 */
export function createCandidateInputSnapshotRuntimeV2({ stateForAttempt } = {}) {
  if (typeof stateForAttempt !== 'function') throw new TypeError('stateForAttempt is required');
  const snapshots = new WeakMap();
  function capture(attempt) {
    const state = stateForAttempt(attempt);
    if (!state?.input) fail('Candidate attempt has no frozen input authority', 'CANDIDATE_SNAPSHOT_ADMISSION_REQUIRED');
    const snapshot = captureCandidateInputSnapshotV2(state.input);
    snapshots.set(attempt, snapshot);
    return Object.freeze({ digest: snapshot.manifest.digest, files: snapshot.manifest.files.length, totalBytes: snapshot.manifest.totalBytes });
  }
  function verify(attempt) {
    const snapshot = snapshots.get(attempt);
    if (!snapshot) fail('Candidate snapshot is unavailable', 'CANDIDATE_SNAPSHOT_ADMISSION_REQUIRED');
    return verifyCandidateInputSnapshotV2(snapshot);
  }
  function cwd(attempt) {
    const snapshot = snapshots.get(attempt);
    if (!snapshot) fail('Candidate snapshot is unavailable', 'CANDIDATE_SNAPSHOT_ADMISSION_REQUIRED');
    return snapshot.inputRoot;
  }
  return Object.freeze({ capture, verify, cwd });
}
