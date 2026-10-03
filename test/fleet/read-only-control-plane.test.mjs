import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openControlPlane, openControlPlaneReadOnly } from '../../src/control-plane/service.mjs';
import { analyzeRepository } from '../../src/kernel/analyze.mjs';
import { proposeDomains } from '../../src/kernel/domains.mjs';
import { inspectRepository } from '../../src/kernel/git.mjs';
import { installProject } from '../../src/kernel/install.mjs';
import { projectStatePath } from '../../src/kernel/paths.mjs';
import { setupProject } from '../../src/kernel/setup.mjs';

const now = () => new Date('2026-10-03T10:00:00Z');

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'torch-read-only-control-plane-'));
  const git = (args) => execFileSync('git', ['-C', root, ...args], {
    env: { ...process.env, GIT_AUTHOR_DATE: '2026-10-03T10:00:00Z', GIT_COMMITTER_DATE: '2026-10-03T10:00:00Z' },
  });
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 'torch-test@example.invalid']);
  git(['config', 'user.name', 'TORCH Test']);
  writeFileSync(join(root, 'app.js'), 'export const value = 1;\n');
  git(['add', '.']);
  git(['commit', '-m', 'fixture']);
  const repository = inspectRepository(root);
  const proposal = proposeDomains({ repository, analysis: analyzeRepository(repository) });
  proposal.review = { status: 'approved', reviewedAt: now().toISOString(), reviewedBy: 'owner', notes: [] };
  const env = { ...process.env, XDG_DATA_HOME: mkdtempSync(join(tmpdir(), 'torch-read-only-state-')) };
  const projectId = 'read-only-fixture';
  installProject({ repository, proposal, env, projectId });
  setupProject({ repository: inspectRepository(root), env, parentOverride: join(tmpdir(), `${basename(root)}-trees`), authorized: true });
  const writer = openControlPlane({ repositoryRoot: root, env, clock: now });
  const worker = proposal.domains[0].id;
  writer.reportStatus({ areaId: worker, state: 'idle', summary: 'registered v2 snapshot' });
  writer.close();
  const stateRoot = projectStatePath(projectId, env);
  const stable = new DatabaseSync(join(stateRoot, 'state.db'));
  stable.exec('PRAGMA journal_mode = DELETE');
  stable.close();
  return { root, env, worker, stateRoot };
}

function sidecars(stateRoot) {
  return readdirSync(stateRoot).filter((name) => name === 'state.db-wal' || name === 'state.db-shm').sort();
}

test('SCN-read-only-v2-control-plane: a write-refusing state directory yields a stable v2 snapshot and rejects mutation', (t) => {
  const context = fixture();
  const statePath = join(context.stateRoot, 'state.db');
  const before = readFileSync(statePath);
  const beforeSidecars = sidecars(context.stateRoot);
  assert.deepEqual(beforeSidecars, [], 'fixture must prove sidecar-free reader behavior');
  chmodSync(statePath, 0o444);
  chmodSync(context.stateRoot, 0o555);
  t.after(() => {
    chmodSync(context.stateRoot, 0o755);
    chmodSync(statePath, 0o644);
  });
  const reader = openControlPlaneReadOnly({ repositoryRoot: context.root, env: context.env, clock: now });
  assert.equal(reader.identity(context.worker).summary, 'registered v2 snapshot');
  assert.deepEqual(reader.observeMessages({ recipient: context.worker, selection: 'unread', limit: 1 }), {
    recipient: context.worker,
    messages: [],
    observation: { selection: 'unread', requestedLimit: 1, returnedCount: 0, complete: true, truncated: false, pendingUnreadCount: 0 },
  });
  assert.throws(
    () => reader.reportStatus({ areaId: context.worker, state: 'working', summary: 'must not persist' }),
    (error) => error.code === 'CONTROL_PLANE_READ_ONLY',
  );
  reader.close();
  assert.deepEqual(readFileSync(statePath), before, 'the database bytes remain unchanged');
  assert.deepEqual(sidecars(context.stateRoot), beforeSidecars, 'the reader creates no WAL or SHM sidecar');
});

test('SCN-read-only-v2-control-plane-race: a concurrent v2 writer produces one coherent snapshot or a typed refusal', () => {
  const context = fixture();
  const statePath = join(context.stateRoot, 'state.db');
  const wal = new DatabaseSync(statePath);
  wal.exec('PRAGMA journal_mode = WAL');
  wal.close();
  const writer = new DatabaseSync(statePath);
  writer.exec('BEGIN IMMEDIATE');
  writer.prepare('UPDATE identities SET summary = ?, updated_at = ? WHERE area_id = ?')
    .run('writer committed after reader snapshot', '2026-10-03T10:01:00Z', context.worker);
  let reader;
  let refusal = null;
  try { reader = openControlPlaneReadOnly({ repositoryRoot: context.root, env: context.env, clock: now }); } catch (error) { refusal = error; }
  writer.exec('COMMIT');
  writer.close();
  if (refusal) {
    assert.equal(refusal.code, 'CONTROL_PLANE_READ_ONLY_UNAVAILABLE');
    return;
  }
  const observed = reader.identity(context.worker).summary;
  assert.ok(observed === 'registered v2 snapshot' || observed === 'writer committed after reader snapshot', `reader must expose one whole SQLite snapshot, received ${observed}`);
  reader.close();
});

test('SCN-read-only-pinned-correlated-snapshot: one reader cannot combine generations across an atomic writer commit', () => {
  const context = fixture();
  const statePath = join(context.stateRoot, 'state.db');
  const generationA = '2026-10-03T10:00:00.000Z';
  const generationB = '2026-10-03T10:01:00.000Z';
  const correlated = [context.worker, 'session-manager'];
  const seed = new DatabaseSync(statePath);
  seed.exec('PRAGMA journal_mode = WAL');
  const setGeneration = seed.prepare('UPDATE identities SET summary = ?, updated_at = ? WHERE area_id = ?');
  for (const areaId of correlated) setGeneration.run('generation A', generationA, areaId);
  seed.close();

  const reader = openControlPlaneReadOnly({ repositoryRoot: context.root, env: context.env, clock: now });
  const first = reader.identity(context.worker);
  assert.deepEqual({ summary: first.summary, updatedAt: first.updatedAt }, { summary: 'generation A', updatedAt: generationA });
  const writer = new DatabaseSync(statePath);
  writer.exec('BEGIN IMMEDIATE');
  const update = writer.prepare('UPDATE identities SET summary = ?, updated_at = ? WHERE area_id = ?');
  for (const areaId of correlated) update.run('generation B', generationB, areaId);
  writer.exec('COMMIT');
  writer.close();
  let second;
  try { second = reader.identity('session-manager'); } catch (error) { assert.equal(error.code, 'CONTROL_PLANE_READ_ONLY_UNAVAILABLE'); }
  if (second) {
    assert.deepEqual({ summary: second.summary, updatedAt: second.updatedAt }, { summary: 'generation A', updatedAt: generationA }, 'the same reader must not combine generations');
  }
  reader.close();
  const fresh = openControlPlaneReadOnly({ repositoryRoot: context.root, env: context.env, clock: now });
  assert.deepEqual(
    Object.fromEntries(correlated.map((areaId) => {
      const identity = fresh.identity(areaId);
      return [areaId, { summary: identity.summary, updatedAt: identity.updatedAt }];
    })),
    Object.fromEntries(correlated.map((areaId) => [areaId, { summary: 'generation B', updatedAt: generationB }])),
  );
  fresh.close();
});

test('SCN-read-only-v2-control-plane-schema: unknown schema revisions are refused instead of guessed', () => {
  const context = fixture();
  const statePath = join(context.stateRoot, 'state.db');
  const writer = new DatabaseSync(statePath);
  writer.exec('PRAGMA user_version = 3');
  writer.close();
  assert.ok(existsSync(statePath));
  assert.throws(
    () => openControlPlaneReadOnly({ repositoryRoot: context.root, env: context.env }),
    (error) => error.code === 'CONTROL_PLANE_READ_ONLY_UNAVAILABLE',
  );
});

test('SCN-read-only-v2-control-plane-input-drift: tracked identity inputs changing after snapshot make reads unavailable', () => {
  const context = fixture();
  const rosterPath = join(context.root, '.torch', 'roster.yaml');
  const original = readFileSync(rosterPath, 'utf8');
  const reader = openControlPlaneReadOnly({ repositoryRoot: context.root, env: context.env });
  writeFileSync(rosterPath, `${original}\n`);
  assert.throws(() => reader.identity(context.worker), (error) => error.code === 'CONTROL_PLANE_READ_ONLY_UNAVAILABLE');
  writeFileSync(rosterPath, original);
  reader.close();
});
