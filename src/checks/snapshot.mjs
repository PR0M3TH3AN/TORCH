import { createHash, randomUUID } from 'node:crypto';
import {
  constants, copyFileSync, chmodSync, existsSync, lstatSync, mkdirSync,
  readFileSync, readdirSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { TorchError } from '../kernel/errors.mjs';

function fail(message, details) {
  throw new TorchError(message, { code: 'CHECK_SNAPSHOT_INVALID', details });
}

function safeRelative(value) {
  if (typeof value !== 'string' || !value || isAbsolute(value)
    || value.includes('\\') || value.split('/').some((part) => !part || part === '.' || part === '..')
    || value.split('/').includes('.git')) fail('Snapshot paths must be explicit repository-relative paths', { path: value });
  return value;
}

function inspectPath(root, path) {
  let current = root;
  for (const part of safeRelative(path).split('/')) {
    current = join(current, part);
    if (!existsSync(current) || lstatSync(current).isSymbolicLink()) {
      fail('Snapshot inputs cannot be missing or symlinked', { path });
    }
  }
  return current;
}

function inventory(root, paths) {
  const records = new Map();
  function visit(path) {
    const absolute = inspectPath(root, path);
    const stat = lstatSync(absolute);
    if (stat.isDirectory()) {
      for (const name of readdirSync(absolute).sort()) visit(`${path}/${name}`);
    } else if (stat.isFile()) {
      const bytes = readFileSync(absolute);
      records.set(path, {
        path, bytes: bytes.length, executable: Boolean(stat.mode & 0o111),
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    } else fail('Snapshot inputs must be regular files or directories', { path });
  }
  for (const path of paths) visit(path);
  return [...records.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function hash(records) {
  return createHash('sha256').update(JSON.stringify(records)).digest('hex');
}

function snapshotParent(stateRoot) {
  const root = realpathSync(stateRoot);
  const parent = join(root, 'check-inputs');
  if (existsSync(parent) && (lstatSync(parent).isSymbolicLink() || !lstatSync(parent).isDirectory())) {
    fail('Snapshot state directory is not an owned regular directory');
  }
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  return parent;
}

function ownedSnapshot(snapshot, stateRoot) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(snapshot?.id ?? '')) fail('Invalid snapshot identity');
  const parent = join(realpathSync(stateRoot), 'check-inputs');
  const root = join(parent, snapshot.id);
  if (resolve(snapshot.root ?? '') !== root || !existsSync(root)
    || lstatSync(parent).isSymbolicLink() || lstatSync(root).isSymbolicLink()) fail('Snapshot ownership does not match');
  const marker = JSON.parse(readFileSync(join(root, 'snapshot.json'), 'utf8'));
  if (JSON.stringify(marker) !== JSON.stringify(snapshot)) {
    fail('Snapshot ownership receipt was changed');
  }
  return root;
}

/** Capture only explicitly approved inputs; ignored build output is supported.
 * The project marker is provenance evidence, not independent build attestation.
 * COPYFILE_FICLONE never hardlinks; unsupported filesystems fall back to copies.
 */
export function captureCheckSnapshot({ worktree, stateRoot, definition, commit, id = randomUUID() } = {}) {
  const policy = definition?.snapshot;
  if (!policy || !Array.isArray(policy.paths) || !policy.paths.length
    || !/^[0-9a-f]{40,64}$/.test(commit ?? '') || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
    fail('Snapshot capture requires an approved input policy, commit and identity');
  }
  const source = realpathSync(worktree);
  const parent = snapshotParent(stateRoot);
  if (!relative(source, parent).startsWith('..') || source === parent) {
    fail('Snapshot state must be outside the source worktree');
  }
  const paths = [...new Set(policy.paths.map(safeRelative))].sort();
  const markerPath = safeRelative(policy.source_commit_file);
  const marker = readFileSync(inspectPath(source, markerPath), 'utf8').trim();
  if (marker !== commit) throw new TorchError('Build marker does not match the queued source commit', {
    code: 'CHECK_SNAPSHOT_STALE_BUILD', details: { expected: commit, observed: marker },
  });
  const before = inventory(source, paths);
  if (!before.some((record) => record.path === markerPath)) fail('The build commit marker must be captured with the inputs');
  if (!before.length) fail('Snapshot has no input files');
  const root = join(parent, id);
  mkdirSync(root, { mode: 0o700 });
  const inputRoot = join(root, 'inputs');
  try {
    mkdirSync(inputRoot, { mode: 0o700 });
    for (const record of before) {
      const target = join(inputRoot, record.path);
      mkdirSync(resolve(target, '..'), { recursive: true, mode: 0o700 });
      copyFileSync(inspectPath(source, record.path), target, constants.COPYFILE_FICLONE | constants.COPYFILE_EXCL);
      chmodSync(target, record.executable ? 0o500 : 0o400);
    }
    const frozen = inventory(inputRoot, paths);
    const after = inventory(source, paths);
    if (hash(before) !== hash(after) || hash(before) !== hash(frozen)) {
      fail('Inputs changed during snapshot capture');
    }
    const snapshot = {
      id, nonce: randomUUID(), root, inputRoot, sourceWorktree: source, commit,
      paths, sourceCommitFile: markerPath, digest: hash(frozen), files: frozen,
      copyStrategy: 'reflink-or-independent-copy', provenance: 'project-declared-commit-marker',
    };
    writeFileSync(join(root, 'snapshot.json'), `${JSON.stringify(snapshot, null, 2)}\n`, {
      flag: 'wx', mode: 0o600,
    });
    return snapshot;
  } catch (error) {
    // Only the exact directory successfully created by this invocation is removed.
    rmSync(root, { recursive: true });
    throw error;
  }
}

export function verifyCheckSnapshot(snapshot, { stateRoot } = {}) {
  const root = ownedSnapshot(snapshot, stateRoot);
  const records = inventory(join(root, 'inputs'), snapshot.paths);
  if (hash(records) !== snapshot.digest) fail('Frozen check inputs were modified');
  return { verified: true, commit: snapshot.commit, digest: snapshot.digest };
}

export function disposeCheckSnapshot(snapshot, { stateRoot } = {}) {
  const root = ownedSnapshot(snapshot, stateRoot);
  rmSync(root, { recursive: true });
  return { removed: true, id: snapshot.id };
}
