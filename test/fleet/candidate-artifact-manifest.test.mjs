import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
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
