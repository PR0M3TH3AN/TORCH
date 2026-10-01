import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { TorchError } from '../kernel/errors.mjs';

export const ARTIFACT_MANIFEST_FILE = '.torch-artifact-manifest-v1.json';
export const ARTIFACT_MANIFEST_LIMITS = Object.freeze({ maxFiles: 64, maxFileBytes: 1_048_576, maxTotalBytes: 8_388_608 });

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
  const result = {};
  for (const [key, maximum] of Object.entries(ARTIFACT_MANIFEST_LIMITS)) {
    const value = input[key] ?? maximum;
    if (!Number.isInteger(value) || value < 1 || value > maximum) fail('Artifact limit is invalid', 'CANDIDATE_ARTIFACT_LIMIT_INVALID', { key, value, maximum });
    result[key] = value;
  }
  return result;
}

export function assertArtifactRelativePath(path) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || path.includes('\\')
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

function inventory(root, configuredLimits) {
  const files = [];
  let totalBytes = 0;
  function visit(current, parent = '') {
    for (const name of readdirSync(current).sort()) {
      if (!parent && name === ARTIFACT_MANIFEST_FILE) continue;
      const path = parent ? `${parent}/${name}` : name;
      assertArtifactRelativePath(path);
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
        const bytes = readFileSync(absolute);
        files.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
      }
    }
  }
  visit(root);
  return { files: files.sort((left, right) => left.path.localeCompare(right.path)), totalBytes };
}

function validateManifest(manifest, configuredLimits) {
  if (!manifest || manifest.schema !== 'torch.dev/artifact-manifest/v1alpha1' || !Array.isArray(manifest.files)
    || !Number.isInteger(manifest.totalBytes) || typeof manifest.sealDigest !== 'string') {
    fail('Artifact manifest is malformed', 'CANDIDATE_ARTIFACT_MANIFEST_INVALID');
  }
  const seen = new Set();
  let totalBytes = 0;
  for (const record of manifest.files) {
    assertArtifactRelativePath(record?.path);
    if (seen.has(record.path)) fail('Artifact manifest contains duplicate paths', 'CANDIDATE_ARTIFACT_MANIFEST_INVALID');
    seen.add(record.path);
    if (!Number.isInteger(record.bytes) || record.bytes < 0 || record.bytes > configuredLimits.maxFileBytes
      || !/^[0-9a-f]{64}$/.test(record.sha256 ?? '')) fail('Artifact manifest record is invalid', 'CANDIDATE_ARTIFACT_MANIFEST_INVALID');
    totalBytes += record.bytes;
  }
  if (manifest.files.length > configuredLimits.maxFiles || totalBytes !== manifest.totalBytes || totalBytes > configuredLimits.maxTotalBytes) {
    fail('Artifact manifest limits do not match', 'CANDIDATE_ARTIFACT_MANIFEST_INVALID');
  }
  const sorted = [...manifest.files].sort((left, right) => left.path.localeCompare(right.path));
  if (canonicalJson(sorted) !== canonicalJson(manifest.files)) fail('Artifact manifest paths are not canonical', 'CANDIDATE_ARTIFACT_MANIFEST_INVALID');
  const payload = { schema: manifest.schema, files: manifest.files, totalBytes: manifest.totalBytes };
  if (digest(payload) !== manifest.sealDigest) fail('Artifact manifest seal digest is invalid', 'CANDIDATE_ARTIFACT_SEAL_INVALID');
  return payload;
}

function ownedRoot(directory) {
  if (typeof directory !== 'string' || !directory || !existsSync(directory)) fail('Artifact directory is missing', 'CANDIDATE_ARTIFACT_DIRECTORY_INVALID');
  const root = realpathSync(directory);
  if (!lstatSync(root).isDirectory()) fail('Artifact directory is not a directory', 'CANDIDATE_ARTIFACT_DIRECTORY_INVALID');
  return root;
}

export function sealArtifactManifest({ directory, limits: requestedLimits } = {}) {
  const root = ownedRoot(directory);
  const configuredLimits = limits(requestedLimits);
  const path = join(root, ARTIFACT_MANIFEST_FILE);
  if (existsSync(path)) fail('Artifact manifest is already sealed', 'CANDIDATE_ARTIFACT_ALREADY_SEALED');
  const records = inventory(root, configuredLimits);
  const payload = { schema: 'torch.dev/artifact-manifest/v1alpha1', ...records };
  const manifest = { ...payload, sealDigest: digest(payload) };
  writeFileSync(path, `${canonicalJson(manifest)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  return Object.freeze({ ...manifest, manifestPath: path });
}

export function verifyArtifactManifest({ directory, limits: requestedLimits } = {}) {
  const root = ownedRoot(directory);
  const configuredLimits = limits(requestedLimits);
  const path = join(root, ARTIFACT_MANIFEST_FILE);
  if (!existsSync(path)) fail('Artifact manifest is missing', 'CANDIDATE_ARTIFACT_MANIFEST_MISSING');
  let manifest;
  try { manifest = JSON.parse(readFileSync(path, 'utf8')); }
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
