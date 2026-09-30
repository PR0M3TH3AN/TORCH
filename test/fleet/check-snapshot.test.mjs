import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { captureCheckSnapshot, disposeCheckSnapshot, verifyCheckSnapshot } from '../../src/checks/snapshot.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'torch-frozen-check-'));
  const worktree = join(root, 'worktree');
  const stateRoot = join(root, 'state');
  mkdirSync(worktree);
  mkdirSync(stateRoot);
  mkdirSync(join(worktree, 'dist'));
  const commit = 'a'.repeat(40);
  writeFileSync(join(worktree, 'dist', 'source-commit'), `${commit}\n`);
  writeFileSync(join(worktree, 'dist', 'index.html'), '<p>original build</p>');
  return {
    root, worktree, stateRoot, commit,
    definition: { snapshot: { paths: ['dist'], source_commit_file: 'dist/source-commit' } },
  };
}

test('SCN-frozen-check-inputs: queued inputs survive in-place rebuilds, prove identity and have owned cleanup', () => {
  const input = fixture();
  const snapshot = captureCheckSnapshot(input);
  const frozenPage = join(snapshot.inputRoot, 'dist', 'index.html');
  assert.equal(readFileSync(frozenPage, 'utf8'), '<p>original build</p>');
  assert.notEqual(statSync(frozenPage).ino, statSync(join(input.worktree, 'dist', 'index.html')).ino,
    'a snapshot must never be a hardlink to mutable build output');
  // Deliberately write in-place: even a non-atomic builder cannot mutate the copy.
  writeFileSync(join(input.worktree, 'dist', 'index.html'), '<p>new build</p>');
  writeFileSync(join(input.worktree, 'dist', 'source-commit'), 'b'.repeat(40));
  assert.deepEqual(verifyCheckSnapshot(snapshot, input), {
    verified: true, commit: input.commit, digest: snapshot.digest,
  });
  assert.equal(readFileSync(frozenPage, 'utf8'), '<p>original build</p>');
  assert.throws(() => disposeCheckSnapshot({ ...snapshot, root: input.worktree }, input),
    (error) => error.code === 'CHECK_SNAPSHOT_INVALID');
  assert.equal(existsSync(input.worktree), true);
  assert.equal(disposeCheckSnapshot(snapshot, input).removed, true);
  assert.equal(existsSync(snapshot.root), false);
  assert.equal(readFileSync(join(input.worktree, 'dist', 'index.html'), 'utf8'), '<p>new build</p>');
});

test('SCN-frozen-check-rejection: stale builds, traversal, symlinks and tampered copies cannot qualify', () => {
  const input = fixture();
  assert.throws(() => captureCheckSnapshot({ ...input, commit: 'b'.repeat(40) }),
    (error) => error.code === 'CHECK_SNAPSHOT_STALE_BUILD');
  for (const path of ['../state', '/tmp', '.', 'dist/../dist', '.git/config']) {
    assert.throws(() => captureCheckSnapshot({
      ...input, definition: { snapshot: { ...input.definition.snapshot, paths: [path] } },
    }), (error) => error.code === 'CHECK_SNAPSHOT_INVALID');
  }
  symlinkSync(input.stateRoot, join(input.worktree, 'external'));
  assert.throws(() => captureCheckSnapshot({
    ...input, definition: { snapshot: { ...input.definition.snapshot, paths: ['dist', 'external'] } },
  }), (error) => error.code === 'CHECK_SNAPSHOT_INVALID');
  const snapshot = captureCheckSnapshot(input);
  const frozenPage = join(snapshot.inputRoot, 'dist', 'index.html');
  chmodSync(frozenPage, 0o600);
  writeFileSync(frozenPage, 'tampered');
  assert.throws(() => verifyCheckSnapshot(snapshot, input),
    (error) => error.code === 'CHECK_SNAPSHOT_INVALID');
  // Cleanup requires ownership, not a passing content check.
  disposeCheckSnapshot(snapshot, input);
});
