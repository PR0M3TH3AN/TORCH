import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

test('SCN-package-distribution: the npm artifact installs offline and runs outside the source checkout', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'torch-package-distribution-'));
  try {
    execFileSync('npm', ['pack', '--pack-destination', temporary], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    const artifacts = readdirSync(temporary).filter((name) => name.endsWith('.tgz'));
    assert.equal(artifacts.length, 1);
    const artifact = join(temporary, artifacts[0]);
    const packagedPaths = execFileSync('tar', ['-tzf', artifact], { encoding: 'utf8' })
      .trim().split('\n').map((path) => path.replace(/^package\//, ''));
    assert.equal(packagedPaths.includes('bin/torch.mjs'), true);
    assert.equal(packagedPaths.includes('src/cli.mjs'), true);
    assert.equal(packagedPaths.includes('docs/PORTABLE_AGENT_FLEET_SPEC.md'), true);
    assert.equal(packagedPaths.some((path) => path.startsWith('test/')), false);
    assert.equal(packagedPaths.some((path) => path.startsWith('reports/')), false);

    const installRoot = join(temporary, 'consumer');
    mkdirSync(installRoot);
    writeFileSync(join(installRoot, 'package.json'), '{"name":"torch-package-consumer","private":true}\n');
    const installed = spawnSync('npm', [
      'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', artifact,
    ], { cwd: installRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.equal(installed.status, 0, installed.stderr || installed.stdout);

    const binary = join(installRoot, 'node_modules', '.bin', 'torch');
    const help = execFileSync(binary, ['--help'], { cwd: installRoot, encoding: 'utf8' });
    assert.match(help, /TORCH — portable agent fleet/);

    const project = join(temporary, 'project');
    mkdirSync(project);
    execFileSync('git', ['init', '-b', 'main', project]);
    writeFileSync(join(project, 'README.md'), '# Package fixture\n');
    execFileSync('git', ['-C', project, 'add', 'README.md']);
    execFileSync('git', ['-C', project, '-c', 'user.name=TORCH Test', '-c', 'user.email=torch@example.invalid', 'commit', '-m', 'fixture']);
    const initialized = JSON.parse(execFileSync(binary, ['init', '--repo', project, '--json'], {
      cwd: installRoot, encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' },
    }));
    assert.equal(initialized.repository.root, project);
    assert.equal(initialized.analysis.mutationPerformed, false);
    assert.equal(readFileSync(join(project, 'README.md'), 'utf8'), '# Package fixture\n');
    assert.equal(execFileSync('git', ['-C', project, 'status', '--porcelain'], { encoding: 'utf8' }), '');
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
