import { createHash } from 'node:crypto';
import {
  closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readSync, realpathSync, writeFileSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { TorchError } from '../kernel/errors.mjs';

export const ARTIFACT_MANIFEST_FILE = '.torch-artifact-manifest-v1.json';
export const ARTIFACT_MANIFEST_LIMITS = Object.freeze({
  maxFiles: 64,
  maxFileBytes: 1_048_576,
  maxTotalBytes: 8_388_608,
  maxPathBytes: 4_096,
  maxManifestBytes: 65_536,
});

function fail(message, code, details) {
  throw new TorchError(message, { code, details });
}

function canonicalJson(value) {
  return JSON.stringify(value);
}

function digest(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function limits(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Artifact limits must be an object', 'CANDIDATE_ARTIFACT_LIMIT_INVALID');
  const allowed = new Set(Object.keys(ARTIFACT_MANIFEST_LIMITS));
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) fail('Artifact limit is unsupported', 'CANDIDATE_ARTIFACT_LIMIT_INVALID', { key });
  }
  const result = {};
  for (const [key, maximum] of Object.entries(ARTIFACT_MANIFEST_LIMITS)) {
    const value = input[key] ?? maximum;
    if (!Number.isInteger(value) || value < 1 || value > maximum) fail('Artifact limit is invalid', 'CANDIDATE_ARTIFACT_LIMIT_INVALID', { key, value, maximum });
    result[key] = value;
  }
  return result;
}

function bytewisePathOrder(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

export function assertArtifactRelativePath(path, maxPathBytes = ARTIFACT_MANIFEST_LIMITS.maxPathBytes) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || path.includes('\\')
    || path.includes('\0') || Buffer.byteLength(path, 'utf8') > maxPathBytes
    || path.split('/').some((part) => !part || part === '.' || part === '..')) {
    fail('Artifact path is not canonical relative evidence', 'CANDIDATE_ARTIFACT_PATH_INVALID', { path });
  }
  return path;
}

export function artifactNodeKind(stat, path) {
  if (stat.isSymbolicLink()) fail('Artifact cannot be a link', 'CANDIDATE_ARTIFACT_LINK_REJECTED', { path });
  if (stat.isDirectory()) return 'directory';
  if (stat.isFile()) return 'file';
  fail('Artifact must be a regular file or directory', 'CANDIDATE_ARTIFACT_SPECIAL_REJECTED', { path });
}

function lstatOrNull(path) {
  try { return lstatSync(path); }
  catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function readRegularFileCapped(path, limit, label) {
  const beforePath = lstatOrNull(path);
  if (!beforePath) fail(`${label} is missing`, 'CANDIDATE_ARTIFACT_MANIFEST_MISSING', { path });
  artifactNodeKind(beforePath, path);
  if (!beforePath.isFile()) fail(`${label} must be a regular file`, 'CANDIDATE_ARTIFACT_SPECIAL_REJECTED', { path });
  if (beforePath.size > limit) fail(`${label} exceeds its byte limit`, 'CANDIDATE_ARTIFACT_LIMIT_EXCEEDED', { path, limit });

  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = fstatSync(descriptor);
    if (!before.isFile()) fail(`${label} must be a regular file`, 'CANDIDATE_ARTIFACT_SPECIAL_REJECTED', { path });
    if (before.size > limit) fail(`${label} exceeds its byte limit`, 'CANDIDATE_ARTIFACT_LIMIT_EXCEEDED', { path, limit });
    const buffer = Buffer.alloc(before.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const read = readSync(descriptor, buffer, offset, buffer.length - offset, offset);
      if (read === 0) break;
      offset += read;
    }
    const after = fstatSync(descriptor);
    if (after.size !== before.size || offset !== before.size) {
      fail(`${label} changed while being read`, 'CANDIDATE_ARTIFACT_SEAL_DRIFT', { path });
    }
    return buffer.subarray(0, before.size);
  } catch (error) {
    if (error instanceof TorchError) throw error;
    fail(`${label} cannot be read as a regular file`, 'CANDIDATE_ARTIFACT_LINK_REJECTED', { path });
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function inventory(root, configuredLimits) {
  const files = [];
  let totalBytes = 0;
  function visit(current, parent = '') {
    for (const name of readdirSync(current).sort(bytewisePathOrder)) {
      if (!parent && name === ARTIFACT_MANIFEST_FILE) continue;
      const path = parent ? `${parent}/${name}` : name;
      assertArtifactRelativePath(path, configuredLimits.maxPathBytes);
      const absolute = join(current, name);
      const stat = lstatSync(absolute);
      const kind = artifactNodeKind(stat, path);
      if (kind === 'directory') visit(absolute, path);
      else {
        if (stat.size > configuredLimits.maxFileBytes) fail('Artifact exceeds per-file limit', 'CANDIDATE_ARTIFACT_LIMIT_EXCEEDED', { path });
        totalBytes += stat.size;
        if (files.length + 1 > configuredLimits.maxFiles || totalBytes > configuredLimits.maxTotalBytes) {
          fail('Artifact manifest exceeds aggregate limits', 'CANDIDATE_ARTIFACT_LIMIT_EXCEEDED');
        }
        const bytes = readRegularFileCapped(absolute, configuredLimits.maxFileBytes, 'Artifact');
        if (bytes.length !== stat.size || bytes.length > configuredLimits.maxFileBytes) {
          fail('Artifact changed while being read', 'CANDIDATE_ARTIFACT_SEAL_DRIFT', { path });
        }
        files.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
      }
    }
  }
  visit(root);
  return { files: files.sort((left, right) => bytewisePathOrder(left.path, right.path)), totalBytes };
}

function validateManifest(manifest, configuredLimits) {
  if (!manifest || manifest.schema !== 'torch.dev/artifact-manifest/v1alpha1' || !Array.isArray(manifest.files)
    || !Number.isInteger(manifest.totalBytes) || typeof manifest.sealDigest !== 'string') {
    fail('Artifact manifest is malformed', 'CANDIDATE_ARTIFACT_MANIFEST_INVALID');
  }
  const manifestKeys = new Set(['schema', 'files', 'totalBytes', 'sealDigest']);
  for (const key of Object.keys(manifest)) {
    if (!manifestKeys.has(key)) fail('Artifact manifest contains unsupported fields', 'CANDIDATE_ARTIFACT_MANIFEST_INVALID', { key });
  }
  const seen = new Set();
  let totalBytes = 0;
  for (const record of manifest.files) {
    if (!record || typeof record !== 'object' || Array.isArray(record)
      || Object.keys(record).some((key) => !new Set(['path', 'bytes', 'sha256']).has(key))) {
      fail('Artifact manifest record is invalid', 'CANDIDATE_ARTIFACT_MANIFEST_INVALID');
    }
    assertArtifactRelativePath(record.path, configuredLimits.maxPathBytes);
    if (seen.has(record.path)) fail('Artifact manifest contains duplicate paths', 'CANDIDATE_ARTIFACT_MANIFEST_INVALID');
    seen.add(record.path);
    if (!Number.isInteger(record.bytes) || record.bytes < 0 || record.bytes > configuredLimits.maxFileBytes
      || !/^[0-9a-f]{64}$/.test(record.sha256 ?? '')) fail('Artifact manifest record is invalid', 'CANDIDATE_ARTIFACT_MANIFEST_INVALID');
    totalBytes += record.bytes;
  }
  if (manifest.files.length > configuredLimits.maxFiles || totalBytes !== manifest.totalBytes || totalBytes > configuredLimits.maxTotalBytes) {
    fail('Artifact manifest limits do not match', 'CANDIDATE_ARTIFACT_MANIFEST_INVALID');
  }
  const sorted = [...manifest.files].sort((left, right) => bytewisePathOrder(left.path, right.path));
  if (canonicalJson(sorted) !== canonicalJson(manifest.files)) fail('Artifact manifest paths are not canonical', 'CANDIDATE_ARTIFACT_MANIFEST_INVALID');
  const payload = { schema: manifest.schema, files: manifest.files, totalBytes: manifest.totalBytes };
  if (digest(payload) !== manifest.sealDigest) fail('Artifact manifest seal digest is invalid', 'CANDIDATE_ARTIFACT_SEAL_INVALID');
  return payload;
}

function ownedRoot(directory) {
  if (typeof directory !== 'string' || !directory) fail('Artifact directory is missing', 'CANDIDATE_ARTIFACT_DIRECTORY_INVALID');
  const initial = lstatOrNull(directory);
  if (!initial) fail('Artifact directory is missing', 'CANDIDATE_ARTIFACT_DIRECTORY_INVALID');
  if (initial.isSymbolicLink()) fail('Artifact directory cannot be a link', 'CANDIDATE_ARTIFACT_LINK_REJECTED', { directory });
  if (!initial.isDirectory()) fail('Artifact directory is not a directory', 'CANDIDATE_ARTIFACT_DIRECTORY_INVALID');
  const root = realpathSync(directory);
  if (!lstatSync(root).isDirectory()) fail('Artifact directory is not a directory', 'CANDIDATE_ARTIFACT_DIRECTORY_INVALID');
  return root;
}

export function sealArtifactManifest({ directory, limits: requestedLimits } = {}) {
  const root = ownedRoot(directory);
  const configuredLimits = limits(requestedLimits);
  const path = join(root, ARTIFACT_MANIFEST_FILE);
  if (lstatOrNull(path)) fail('Artifact manifest is already sealed', 'CANDIDATE_ARTIFACT_ALREADY_SEALED');
  const records = inventory(root, configuredLimits);
  const payload = { schema: 'torch.dev/artifact-manifest/v1alpha1', ...records };
  const manifest = { ...payload, sealDigest: digest(payload) };
  const serialized = Buffer.from(`${canonicalJson(manifest)}\n`, 'utf8');
  if (serialized.length > configuredLimits.maxManifestBytes) {
    fail('Artifact manifest exceeds its byte limit', 'CANDIDATE_ARTIFACT_LIMIT_EXCEEDED');
  }
  writeFileSync(path, serialized, { mode: 0o600, flag: 'wx' });
  return Object.freeze({ ...manifest, manifestPath: path });
}

export function verifyArtifactManifest({ directory, limits: requestedLimits } = {}) {
  const root = ownedRoot(directory);
  const configuredLimits = limits(requestedLimits);
  const path = join(root, ARTIFACT_MANIFEST_FILE);
  const manifestStat = lstatOrNull(path);
  if (!manifestStat) fail('Artifact manifest is missing', 'CANDIDATE_ARTIFACT_MANIFEST_MISSING');
  artifactNodeKind(manifestStat, ARTIFACT_MANIFEST_FILE);
  if (!manifestStat.isFile()) fail('Artifact manifest must be a regular file', 'CANDIDATE_ARTIFACT_SPECIAL_REJECTED');
  if (manifestStat.size > configuredLimits.maxManifestBytes) {
    fail('Artifact manifest exceeds its byte limit', 'CANDIDATE_ARTIFACT_LIMIT_EXCEEDED');
  }
  let manifest;
  try { manifest = JSON.parse(readRegularFileCapped(path, configuredLimits.maxManifestBytes, 'Artifact manifest').toString('utf8')); }
  catch { fail('Artifact manifest cannot be parsed', 'CANDIDATE_ARTIFACT_MANIFEST_INVALID'); }
  const payload = validateManifest(manifest, configuredLimits);
  const current = inventory(root, configuredLimits);
  if (canonicalJson(current) !== canonicalJson({ files: payload.files, totalBytes: payload.totalBytes })) {
    fail('Artifact contents changed after sealing', 'CANDIDATE_ARTIFACT_SEAL_DRIFT');
  }
  if (resolve(path) !== join(root, ARTIFACT_MANIFEST_FILE) || relative(root, path).startsWith('..')) {
    fail('Artifact manifest escaped its directory', 'CANDIDATE_ARTIFACT_DIRECTORY_INVALID');
  }
  return Object.freeze({ ...manifest, manifestPath: path, verified: true });
}
