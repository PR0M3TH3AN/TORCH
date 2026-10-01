import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdirSync, mkdtempSync, readFileSync, renameSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  ARTIFACT_MANIFEST_FILE, artifactNodeKind, assertArtifactRelativePath, sealArtifactManifest, verifyArtifactManifest,
} from '../../src/checks/artifact-manifest.mjs';

function fixture() {
  return mkdtempSync(join(tmpdir(), 'torch-candidate-manifest-'));
}

function write(root, path, content) {
  const target = join(root, path);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, content);
}

function manifestBytesFor(path, content) {
  const bytes = Buffer.from(content, 'utf8');
  const payload = {
    schema: 'torch.dev/artifact-manifest/v1alpha1',
    files: [{ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }],
    totalBytes: bytes.length,
  };
  const manifest = {
    ...payload,
    sealDigest: createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
  };
  return Buffer.byteLength(`${JSON.stringify(manifest)}\n`, 'utf8');
}

test('SCN-artifact-manifest-seal: regular fixture artifacts seal as canonical sorted hash and length evidence regardless of creation order', () => {
  const first = fixture();
  const second = fixture();
  write(first, 'z/proof.txt', 'zeta');
  write(first, 'a/proof.txt', 'alpha');
  write(second, 'a/proof.txt', 'alpha');
  write(second, 'z/proof.txt', 'zeta');
  const left = sealArtifactManifest({ directory: first });
  const right = sealArtifactManifest({ directory: second });
  assert.deepEqual(left.files, right.files);
  assert.equal(left.sealDigest, right.sealDigest);
  assert.deepEqual(left.files.map((file) => file.path), ['a/proof.txt', 'z/proof.txt']);
  assert.equal(left.totalBytes, 9);
  assert.equal(verifyArtifactManifest({ directory: first }).verified, true);
  assert.throws(() => sealArtifactManifest({ directory: first }), { code: 'CANDIDATE_ARTIFACT_ALREADY_SEALED' });
});

test('SCN-artifact-manifest-negative-paths: traversal, links, special files, caps and duplicate manifest paths refuse', () => {
  assert.throws(() => assertArtifactRelativePath('../escape'), { code: 'CANDIDATE_ARTIFACT_PATH_INVALID' });
  assert.throws(() => assertArtifactRelativePath('/absolute'), { code: 'CANDIDATE_ARTIFACT_PATH_INVALID' });

  const linked = fixture();
  write(linked, 'safe.txt', 'safe');
  symlinkSync('safe.txt', join(linked, 'linked.txt'));
  assert.throws(() => sealArtifactManifest({ directory: linked }), { code: 'CANDIDATE_ARTIFACT_LINK_REJECTED' });

  const limited = fixture();
  write(limited, 'large.txt', '12345');
  assert.throws(() => sealArtifactManifest({ directory: limited, limits: { maxFileBytes: 4 } }),
    { code: 'CANDIDATE_ARTIFACT_LIMIT_EXCEEDED' });

  assert.throws(() => artifactNodeKind({
    isSymbolicLink: () => false, isDirectory: () => false, isFile: () => false,
  }, 'pipe'), { code: 'CANDIDATE_ARTIFACT_SPECIAL_REJECTED' });

  const malformed = fixture();
  write(malformed, 'proof.txt', 'proof');
  sealArtifactManifest({ directory: malformed });
  const path = join(malformed, ARTIFACT_MANIFEST_FILE);
  const record = JSON.parse(readFileSync(path, 'utf8'));
  record.files.push({ ...record.files[0] });
  writeFileSync(path, JSON.stringify(record));
  assert.throws(() => verifyArtifactManifest({ directory: malformed }), { code: 'CANDIDATE_ARTIFACT_MANIFEST_INVALID' });
});

test('SCN-artifact-manifest-drift: post-seal mutation or overwrite is detected and cannot become retained evidence', () => {
  const root = fixture();
  write(root, 'proof.txt', 'before');
  sealArtifactManifest({ directory: root });
  write(root, 'proof.txt', 'after');
  assert.throws(() => verifyArtifactManifest({ directory: root }), { code: 'CANDIDATE_ARTIFACT_SEAL_DRIFT' });
});

test('SCN-artifact-manifest-bytewise-and-caps: UTF-8 bytewise path ordering and every declared cap are deterministic', () => {
  const first = fixture();
  const second = fixture();
  write(first, 'ä.txt', 'umlaut');
  write(first, 'z.txt', 'zed');
  write(second, 'z.txt', 'zed');
  write(second, 'ä.txt', 'umlaut');
  const left = sealArtifactManifest({ directory: first });
  const right = sealArtifactManifest({ directory: second });
  assert.deepEqual(left.files.map((file) => file.path), ['z.txt', 'ä.txt']);
  assert.deepEqual(left.files, right.files);
  assert.equal(left.sealDigest, right.sealDigest);

  const count = fixture();
  write(count, 'one.txt', '1');
  write(count, 'two.txt', '2');
  assert.throws(() => sealArtifactManifest({ directory: count, limits: { maxFiles: 1 } }), { code: 'CANDIDATE_ARTIFACT_LIMIT_EXCEEDED' });
  const countPass = fixture();
  write(countPass, 'one.txt', '1');
  assert.equal(sealArtifactManifest({ directory: countPass, limits: { maxFiles: 1 } }).files.length, 1);

  const perFile = fixture();
  write(perFile, 'proof.txt', '1234');
  assert.equal(sealArtifactManifest({ directory: perFile, limits: { maxFileBytes: 4 } }).files[0].bytes, 4);
  const perFileFail = fixture();
  write(perFileFail, 'proof.txt', '12345');
  assert.throws(() => sealArtifactManifest({ directory: perFileFail, limits: { maxFileBytes: 4 } }), { code: 'CANDIDATE_ARTIFACT_LIMIT_EXCEEDED' });

  const aggregate = fixture();
  write(aggregate, 'one.txt', '12');
  write(aggregate, 'two.txt', '34');
  assert.throws(() => sealArtifactManifest({ directory: aggregate, limits: { maxTotalBytes: 3 } }), { code: 'CANDIDATE_ARTIFACT_LIMIT_EXCEEDED' });
  const aggregatePass = fixture();
  write(aggregatePass, 'one.txt', '12');
  write(aggregatePass, 'two.txt', '34');
  assert.equal(sealArtifactManifest({ directory: aggregatePass, limits: { maxTotalBytes: 4 } }).totalBytes, 4);

  const paths = fixture();
  write(paths, 'abcd.txt', 'x');
  assert.throws(() => sealArtifactManifest({ directory: paths, limits: { maxPathBytes: 7 } }), { code: 'CANDIDATE_ARTIFACT_PATH_INVALID' });
  const pathsPass = fixture();
  write(pathsPass, 'abc.txt', 'x');
  assert.equal(sealArtifactManifest({ directory: pathsPass, limits: { maxPathBytes: 7 } }).files.length, 1);

  const manifestCap = fixture();
  write(manifestCap, 'proof.txt', 'proof');
  assert.throws(() => sealArtifactManifest({ directory: manifestCap, limits: { maxManifestBytes: 16 } }), { code: 'CANDIDATE_ARTIFACT_LIMIT_EXCEEDED' });
  const exactManifestBytes = manifestBytesFor('proof.txt', 'proof');
  const manifestAtCap = fixture();
  write(manifestAtCap, 'proof.txt', 'proof');
  assert.equal(sealArtifactManifest({ directory: manifestAtCap, limits: { maxManifestBytes: exactManifestBytes } }).files.length, 1);
  const manifestOverCap = fixture();
  write(manifestOverCap, 'proof.txt', 'proof');
  assert.throws(() => sealArtifactManifest({ directory: manifestOverCap, limits: { maxManifestBytes: exactManifestBytes - 1 } }),
    { code: 'CANDIDATE_ARTIFACT_LIMIT_EXCEEDED' });
  assert.throws(() => sealArtifactManifest({ directory: fixture(), limits: { unknownCap: 1 } }), { code: 'CANDIDATE_ARTIFACT_LIMIT_INVALID' });
});

test('SCN-artifact-manifest-root-and-manifest-boundaries: root or manifest links, special nodes and oversized manifests never become evidence', () => {
  const actual = fixture();
  write(actual, 'proof.txt', 'proof');
  const linkedRoot = `${actual}-link`;
  symlinkSync(actual, linkedRoot);
  assert.throws(() => sealArtifactManifest({ directory: linkedRoot }), { code: 'CANDIDATE_ARTIFACT_LINK_REJECTED' });

  const sealed = fixture();
  write(sealed, 'proof.txt', 'proof');
  sealArtifactManifest({ directory: sealed });
  const manifest = join(sealed, ARTIFACT_MANIFEST_FILE);
  const replacement = `${manifest}.replacement`;
  renameSync(manifest, replacement);
  symlinkSync(replacement, manifest);
  assert.throws(() => verifyArtifactManifest({ directory: sealed }), { code: 'CANDIDATE_ARTIFACT_LINK_REJECTED' });
  assert.throws(() => sealArtifactManifest({ directory: sealed }), { code: 'CANDIDATE_ARTIFACT_ALREADY_SEALED' });

  const oversized = fixture();
  write(oversized, 'proof.txt', 'proof');
  sealArtifactManifest({ directory: oversized });
  writeFileSync(join(oversized, ARTIFACT_MANIFEST_FILE), 'x'.repeat(80));
  assert.throws(() => verifyArtifactManifest({ directory: oversized, limits: { maxManifestBytes: 64 } }),
    { code: 'CANDIDATE_ARTIFACT_LIMIT_EXCEEDED' });

  const special = fixture();
  write(special, 'proof.txt', 'proof');
  sealArtifactManifest({ directory: special });
  const specialManifest = join(special, ARTIFACT_MANIFEST_FILE);
  unlinkSync(specialManifest);
  mkdirSync(specialManifest);
  assert.throws(() => verifyArtifactManifest({ directory: special }), { code: 'CANDIDATE_ARTIFACT_SPECIAL_REJECTED' });
});

test('SCN-artifact-manifest-complete-drift: adding artifacts or replacing the manifest cannot preserve a sealed record', () => {
  const root = fixture();
  write(root, 'proof.txt', 'before');
  sealArtifactManifest({ directory: root });
  write(root, 'added.txt', 'after');
  assert.throws(() => verifyArtifactManifest({ directory: root }), { code: 'CANDIDATE_ARTIFACT_SEAL_DRIFT' });

  const replaced = fixture();
  write(replaced, 'proof.txt', 'before');
  sealArtifactManifest({ directory: replaced });
  writeFileSync(join(replaced, ARTIFACT_MANIFEST_FILE), JSON.stringify({ schema: 'torch.dev/artifact-manifest/v1alpha1', files: [], totalBytes: 0, sealDigest: '0'.repeat(64) }));
  assert.throws(() => verifyArtifactManifest({ directory: replaced }), { code: 'CANDIDATE_ARTIFACT_SEAL_INVALID' });
});
