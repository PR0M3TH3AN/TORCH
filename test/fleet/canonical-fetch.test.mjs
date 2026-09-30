import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fetchCanonicalObjects, classifyFetchFailure } from '../../src/canonical/fetch.mjs';
import { createLocalCanonical } from '../../src/canonical/local.mjs';
import { openControlPlane } from '../../src/control-plane/service.mjs';
import { analyzeRepository } from '../../src/kernel/analyze.mjs';
import { proposeDomains } from '../../src/kernel/domains.mjs';
import { inspectRepository } from '../../src/kernel/git.mjs';
import { installProject } from '../../src/kernel/install.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'torch-canonical-fetch-'));
  const env = { ...process.env, XDG_DATA_HOME: mkdtempSync(join(tmpdir(), 'torch-fetch-state-')) };
  const git = (path, args) => execFileSync('git', ['-C', path, ...args], { encoding: 'utf8' }).trim();
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@example.invalid']);
  git(root, ['config', 'user.name', 'Test']);
  writeFileSync(join(root, 'app.js'), 'export const value=1;');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'source']);
  const repository = inspectRepository(root);
  const proposal = proposeDomains({ repository, analysis: analyzeRepository(repository) });
  proposal.review = { status: 'approved', reviewedAt: '2026-09-30', reviewedBy: 'owner', notes: [] };
  installProject({ repository, proposal, env, projectId: 'fetch-fixture' });
  git(root, ['add', '.torch']);
  git(root, ['commit', '-m', 'Install fixture']);
  const canonical = createLocalCanonical({ repositoryRoot: root });
  git(root, ['push', 'torch-canonical', 'main']);
  const producer = mkdtempSync(join(tmpdir(), 'torch-fetch-producer-'));
  git(producer, ['clone', '--branch', 'main', canonical.path, '.']);
  git(producer, ['config', 'user.email', 'test@example.invalid']);
  git(producer, ['config', 'user.name', 'Test']);
  writeFileSync(join(producer, 'remote.js'), 'export const remote=2;');
  git(producer, ['add', '.']);
  git(producer, ['commit', '-m', 'remote source']);
  git(producer, ['push', 'origin', 'main']);
  const commit = git(producer, ['rev-parse', 'HEAD']);
  const control = openControlPlane({ repositoryRoot: root, env });
  return { root, env, git, commit, control };
}

test('SCN-canonical-fetch: transient object import retries are bounded, recorded, private and never move branches or publish', () => {
  const f = fixture();
  try {
    const refs = f.git(f.root, ['show-ref']);
    const status = f.git(f.root, ['status', '--porcelain']);
    let calls = 0;
    const result = fetchCanonicalObjects({ repositoryRoot: f.root, controlPlane: f.control,
      executor: (root, args, timeout) => {
        calls += 1;
        assert.equal(args[0], 'fetch');
        assert.ok(args.includes('--refmap='));
        assert.ok(args.includes('--no-write-fetch-head'));
        assert.equal(args.at(-1), f.commit);
        if (calls === 1) return { status: 128, stderr: 'connection reset https://secret:password@example.invalid' };
        return spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout });
      } });
    assert.equal(result.succeeded, true);
    assert.equal(calls, 2);
    assert.equal(result.attempts[0].classification, 'transient-network');
    assert.equal(result.attempts[1].state, 'succeeded');
    assert.equal(f.git(f.root, ['show-ref']), refs);
    assert.equal(f.git(f.root, ['status', '--porcelain']), status);
    f.git(f.root, ['cat-file', '-e', `${f.commit}^{commit}`]);
    assert.doesNotMatch(JSON.stringify(result), /password|secret/);
    assert.equal(f.control.database.prepare('SELECT state FROM canonical_fetches WHERE id = ?').get(result.id).state, 'succeeded');
    assert.equal(f.control.database.prepare('SELECT COUNT(*) AS n FROM canonical_fetch_attempts').get().n, 2);
  } finally { f.control.close(); }
});

test('SCN-canonical-fetch-boundaries: authentication, unknown outcomes, bad limits and non-owner actors cannot create unsafe retries', () => {
  const f = fixture();
  try {
    for (const attempts of [0, 6, 1.5]) assert.throws(() => fetchCanonicalObjects({ repositoryRoot: f.root,
      controlPlane: f.control, attempts }), (error) => error.code === 'CANONICAL_FETCH_INPUT_INVALID');
    assert.throws(() => fetchCanonicalObjects({ repositoryRoot: f.root, controlPlane: f.control, actorId: 'session-manager' }));
    for (const stderr of ['Permission denied', 'Unrecognized failure']) {
      let calls = 0;
      const result = fetchCanonicalObjects({ repositoryRoot: f.root, controlPlane: f.control,
        executor: () => { calls += 1; return { status: 128, stderr }; } });
      assert.equal(result.succeeded, false);
      assert.equal(calls, 1);
    }
    let calls = 0;
    const exhausted = fetchCanonicalObjects({ repositoryRoot: f.root, controlPlane: f.control, attempts: 3,
      executor: () => { calls += 1; return { status: 128, stderr: 'connection reset' }; } });
    assert.equal(calls, 3);
    assert.equal(exhausted.state, 'failed');
    assert.equal(classifyFetchFailure({ status: 128, stderr: 'Permission denied; connection reset' }), 'permanent');
    assert.equal(classifyFetchFailure({ status: null, error: { code: 'ETIMEDOUT' } }), 'transient-network');
    const cli = spawnSync(process.execPath, [new URL('../../bin/torch.mjs', import.meta.url).pathname,
      'forge', 'fetch', '--json'], { cwd: f.root, env: f.env, encoding: 'utf8' });
    assert.notEqual(cli.status, 0);
    assert.equal(JSON.parse(cli.stdout).error, 'APPROVAL_REQUIRED');
    const confirmed = spawnSync(process.execPath, [new URL('../../bin/torch.mjs', import.meta.url).pathname,
      'forge', 'fetch', '--yes', '--attempts', '1', '--json'], { cwd: f.root, env: f.env, encoding: 'utf8' });
    assert.equal(confirmed.status, 0, confirmed.stdout || confirmed.stderr);
    assert.equal(JSON.parse(confirmed.stdout).succeeded, true);
    const status = spawnSync(process.execPath, [new URL('../../bin/torch.mjs', import.meta.url).pathname,
      'forge', 'fetch', 'status', '--json'], { cwd: f.root, env: f.env, encoding: 'utf8' });
    assert.equal(status.status, 0, status.stdout || status.stderr);
    assert.equal(JSON.parse(status.stdout).fetches[0].state, 'succeeded');
    let policyCalls = 0;
    const changed = fetchCanonicalObjects({ repositoryRoot: f.root, controlPlane: f.control,
      executor: () => {
        policyCalls += 1;
        f.git(f.root, ['remote', 'set-url', 'torch-canonical', '/unavailable/changed-remote']);
        return { status: 128, stderr: 'connection reset' };
      } });
    assert.equal(changed.state, 'policy-changed');
    assert.equal(policyCalls, 1, 'a changed destination must stop another attempt');
  } finally { f.control.close(); }
});
