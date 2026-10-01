import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { createDashboardArtifactDirectory, describeDashboardArtifacts, prepareDashboardArtifactTargets } from '../../scripts/dashboard-artifacts.mjs';

function repositoryFixture() {
  const root = mkdtempSync(join(tmpdir(), 'torch-dashboard-artifact-fixture-'));
  execFileSync('git', ['init', '-b', 'main', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'torch-test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'TORCH Test']);
  mkdirSync(join(root, 'reports', 'design-system'), { recursive: true });
  writeFileSync(join(root, 'reports', 'design-system', 'baseline.png'), 'tracked baseline bytes');
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'dashboard baseline']);
  return root;
}

test('SCN-dashboard-artifacts: standalone execution retains fresh external screenshot evidence with provenance', () => {
  const repositoryRoot = repositoryFixture();
  const artifacts = createDashboardArtifactDirectory({ environment: {}, repositoryRoot });
  assert.equal(artifacts.provenance, 'standalone-temporary');
  assert.equal(artifacts.requestedDirectory, null);
  assert.equal(artifacts.directory.startsWith(resolve(repositoryRoot)), false);
  const targets = prepareDashboardArtifactTargets(artifacts, ['captured.png']);
  writeFileSync(targets['captured.png'], 'standalone screenshot');
  assert.deepEqual(describeDashboardArtifacts(artifacts).files, [{
    path: 'captured.png', bytes: 21,
    sha256: '6921ad2c105108a005db4282443624252c392392d85bcb4ca2625c6af488f57c',
  }]);
});

test('SCN-dashboard-artifacts: an explicit external runner directory receives hashable captured evidence', () => {
  const repositoryRoot = repositoryFixture();
  const output = mkdtempSync(join(tmpdir(), 'torch-dashboard-artifact-output-'));
  const artifacts = createDashboardArtifactDirectory({
    environment: { TORCH_CHECK_ARTIFACT_DIR: output }, repositoryRoot,
  });
  assert.equal(artifacts.provenance, 'TORCH_CHECK_ARTIFACT_DIR');
  assert.equal(artifacts.directory, resolve(output));
  const targets = prepareDashboardArtifactTargets(artifacts, ['captured.png']);
  writeFileSync(targets['captured.png'], 'runner screenshot');
  assert.deepEqual(describeDashboardArtifacts(artifacts).files, [{
    path: 'captured.png', bytes: 17,
    sha256: '382d6e41938a7a8cc7767e9b519ddbef25e5048fc6fa9fe02faf31bab4148e2b',
  }]);
});

test('SCN-dashboard-artifacts: repository, temporary-root, pre-existing and symlink targets fail before changing preserved bytes', () => {
  const repositoryRoot = repositoryFixture();
  const baseline = join(repositoryRoot, 'reports', 'design-system', 'baseline.png');
  const before = readFileSync(baseline);
  for (const direct of [join(repositoryRoot, 'reports', 'design-system'), join(repositoryRoot, '..captures')]) {
    assert.throws(() => createDashboardArtifactDirectory({
      environment: { TORCH_CHECK_ARTIFACT_DIR: direct }, repositoryRoot,
    }), (error) => error.code === 'DASHBOARD_ARTIFACT_DIRECTORY_FORBIDDEN');
  }
  assert.throws(() => createDashboardArtifactDirectory({
    environment: {}, repositoryRoot, temporaryRoot: join(repositoryRoot, 'unsafe-tmp'),
  }), (error) => error.code === 'DASHBOARD_ARTIFACT_DIRECTORY_FORBIDDEN');
  assert.deepEqual(readFileSync(baseline), before);

  const linkedWorktree = mkdtempSync(join(tmpdir(), 'torch-dashboard-linked-worktree-'));
  execFileSync('git', ['-C', repositoryRoot, 'worktree', 'add', '-b', 'linked-dashboard-fixture', linkedWorktree]);
  const link = join(tmpdir(), `torch-dashboard-worktree-link-${process.pid}-${Date.now()}`);
  symlinkSync(join(linkedWorktree, 'reports', 'design-system'), link);
  assert.throws(() => createDashboardArtifactDirectory({
    environment: { TORCH_CHECK_ARTIFACT_DIR: link }, repositoryRoot,
  }), (error) => error.code === 'DASHBOARD_ARTIFACT_DIRECTORY_FORBIDDEN');
  assert.deepEqual(readFileSync(baseline), before);
  assert.equal(existsSync(join(linkedWorktree, 'reports', 'design-system', 'torch-dashboard-demo-desktop.png')), false);

  const output = mkdtempSync(join(tmpdir(), 'torch-dashboard-existing-output-'));
  const expected = join(output, 'torch-dashboard-demo-desktop.png');
  writeFileSync(expected, 'existing user evidence');
  const external = createDashboardArtifactDirectory({ environment: { TORCH_CHECK_ARTIFACT_DIR: output }, repositoryRoot });
  assert.throws(() => prepareDashboardArtifactTargets(external, ['torch-dashboard-demo-desktop.png']),
    (error) => error.code === 'DASHBOARD_ARTIFACT_TARGET_EXISTS');
  assert.equal(readFileSync(expected, 'utf8'), 'existing user evidence');

  const linkedOutput = mkdtempSync(join(tmpdir(), 'torch-dashboard-linked-output-'));
  const linkedExpected = join(linkedOutput, 'torch-dashboard-demo-desktop.png');
  symlinkSync(baseline, linkedExpected);
  const linkedExternal = createDashboardArtifactDirectory({
    environment: { TORCH_CHECK_ARTIFACT_DIR: linkedOutput }, repositoryRoot,
  });
  assert.throws(() => prepareDashboardArtifactTargets(linkedExternal, ['torch-dashboard-demo-desktop.png']),
    (error) => error.code === 'DASHBOARD_ARTIFACT_TARGET_EXISTS');
  assert.deepEqual(readFileSync(baseline), before);
});
