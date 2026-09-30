import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { managedProvider, planProviderUpdates, providerStore, updateProviders } from '../../src/adapters/updates.mjs';
import { createRuntimeAdapterRegistry } from '../../src/adapters/registry.mjs';
import { execFileSync } from 'node:child_process';
import { inspectRepository } from '../../src/kernel/git.mjs';
import { analyzeRepository } from '../../src/kernel/analyze.mjs';
import { proposeDomains } from '../../src/kernel/domains.mjs';
import { installProject } from '../../src/kernel/install.mjs';
import { createWorktrees } from '../../src/kernel/worktrees.mjs';
import { runCli } from '../../src/cli.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'torch-provider-update-'));
  const env = { ...process.env, XDG_DATA_HOME: root };
  const calls = [];
  let version = '1.2.3';
  let failInstall = false;
  const runner = (command, args, options) => {
    calls.push({ command, args, options });
    if (args[0] === 'view') return { status: 0, stdout: JSON.stringify(version) };
    if (args[0] === 'install') {
      if (failInstall) return { status: 1, stderr: 'offline' };
      const pkg = args.at(-1);
      const name = pkg.startsWith('@openai/') ? 'codex' : pkg.startsWith('@anthropic-ai/') ? 'claude' : 'pi';
      const prefix = args[args.indexOf('--prefix') + 1];
      mkdirSync(join(prefix, 'node_modules', '.bin'), { recursive: true });
      const path = join(prefix, 'node_modules', '.bin', name);
      writeFileSync(path, `#!/bin/sh\n# ${version}\n`);
      chmodSync(path, 0o755);
      return { status: 0, stdout: 'installed' };
    }
    return { status: 0, stdout: args[0] === '--version' ? `provider ${version}`
      : args.includes('exec') ? '{"type":"thread.started","thread_id":"provider-update-fixture-session"}\n' : 'help' };
  };
  return { env, calls, runner, next: v => { version = v; }, breakInstall: () => { failInstall = true; } };
}

test('SCN-provider-updates: all built-ins resolve official latest, verify and launch the managed binary', () => {
  const f = fixture();
  const plan = planProviderUpdates(['codex', 'claude', 'pi'], f);
  assert.equal(f.calls.length, 0);
  assert.equal(plan.modifiesGlobalInstallations, false);
  assert.throws(() => updateProviders(['codex'], f), { code: 'APPROVAL_REQUIRED' });
  assert.equal(existsSync(providerStore(f.env)), false);
  const result = updateProviders(['codex', 'claude', 'pi'], { ...f, authorized: true });
  assert.deepEqual(result.results.map(r => r.outcome), ['updated', 'updated', 'updated']);
  const registry = createRuntimeAdapterRegistry({ env: f.env });
  for (const name of ['codex', 'claude', 'pi']) {
    const selected = managedProvider(name, f);
    assert.equal(registry.get(name).executable, selected.executable);
    assert.equal(selected.version, '1.2.3');
    assert.equal(f.calls.some(c => c.command === selected.executable && c.args[0] === '--version'), true);
    assert.equal(f.calls.some(c => c.command === selected.executable && c.args[0] === '--help'), true);
  }
  for (const call of f.calls.filter(c => c.command === 'npm')) {
    assert.equal(call.args.includes('-g'), false);
    assert.equal(call.args.includes('--registry'), true);
    assert.equal(call.options.timeout > 0, true);
  }
  assert.equal(f.calls.find(c => c.args.at(-1) === '@earendil-works/pi-coding-agent@1.2.3').args.includes('--ignore-scripts'), true);
  const count = f.calls.length;
  assert.equal(updateProviders(['codex'], { ...f, authorized: true }).results[0].outcome, 'fresh');
  assert.equal(f.calls.length, count, 'fresh startup performs no network/install calls');
});

test('SCN-provider-update-cli: opted-in startup updates selected provider, dry runs stay offline, failed refresh cannot launch', async () => {
  const f = fixture();
  const root = join(f.env.XDG_DATA_HOME, 'repo');
  mkdirSync(root);
  const git = args => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
  git(['init', '-b', 'main']); git(['config', 'user.email', 'fixture@example.invalid']); git(['config', 'user.name', 'Fixture']);
  writeFileSync(join(root, 'README.md'), '# Test project\n');
  git(['add', '.']); git(['commit', '-m', 'fixture']);
  const repository = inspectRepository(root);
  const proposal = proposeDomains({ repository, analysis: analyzeRepository(repository) });
  proposal.review = { status: 'approved', reviewedAt: '2026-09-30T00:00:00Z', reviewedBy: 'fixture-owner', notes: [] };
  installProject({ repository, proposal, env: f.env, runtimes: ['codex'] });
  const stdout = process.stdout.write;
  const outputs = [];
  process.stdout.write = chunk => { outputs.push(String(chunk)); return true; };
  try {
    const run = args => runCli(args, { cwd: root, env: f.env, spawn: f.runner });
    assert.equal(await run(['runtimes', 'update-policy', '--mode', 'auto', '--yes', '--json']), 0);
    const config = JSON.parse(readFileSync(join(root, '.torch', 'torch.yaml')));
    assert.deepEqual(config.runtimes.codex.updatePolicy, { mode: 'auto', max_age_hours: 24 });
    git(['add', '.torch']); git(['commit', '-m', 'config']);
    createWorktrees({ repository: inspectRepository(root), parentOverride: join(f.env.XDG_DATA_HOME, 'worktrees') });
    assert.equal(await run(['up', '--fresh', '--only', 'session-manager', '--dry-run', '--json']), 0);
    assert.equal(f.calls.length, 0, 'dry-run never downloads or launches');
    assert.equal(await run(['up', '--fresh', '--only', 'session-manager', '--yes', '--json']), 0);
    const selected = managedProvider('codex', f);
    const launches = f.calls.filter(c => c.args.includes('exec'));
    assert.equal(launches.length, 1);
    assert.equal(launches[0].command, selected.executable);
    assert.equal(f.calls.some(c => c.args.at(-1)?.startsWith('@anthropic-ai/')), false);
    const pointer = join(providerStore(f.env), 'codex.json');
    const stale = JSON.parse(readFileSync(pointer)); stale.checkedAt = '2000-01-01T00:00:00Z';
    writeFileSync(pointer, JSON.stringify(stale)); f.next('1.3.0'); f.breakInstall();
    assert.equal(await run(['up', '--only', 'session-manager', '--yes', '--json']), 2);
    assert.equal(f.calls.filter(c => c.args.includes('exec')).length, 1, 'failed refresh must not launch the old provider silently');
    assert.equal(outputs.some(s => s.includes('RUNTIME_UPDATE_FAILED')), true);
  } finally { process.stdout.write = stdout; }
});

test('SCN-provider-updates-recovery: failed updates retain last activation; tampering and concurrent updates stop', () => {
  const f = fixture();
  updateProviders(['codex'], { ...f, authorized: true });
  const active = managedProvider('codex', f);
  f.next('1.3.0'); f.breakInstall();
  assert.throws(() => updateProviders(['codex'], { ...f, authorized: true, force: true }), { code: 'RUNTIME_UPDATE_FAILED' });
  assert.equal(managedProvider('codex', f).executable, active.executable);
  assert.equal(managedProvider('codex', f).version, '1.2.3');
  mkdirSync(join(providerStore(f.env), 'update.lock'));
  assert.throws(() => updateProviders(['codex'], { ...f, authorized: true }), { code: 'RUNTIME_UPDATE_BUSY' });
  writeFileSync(active.executable, 'tampered');
  assert.throws(() => managedProvider('codex', f), { code: 'RUNTIME_UPDATE_FAILED' });
});

test('SCN-provider-update-safety: arbitrary packages, unsafe registry versions, path escape and symlink stores fail closed', () => {
  const f = fixture();
  assert.throws(() => planProviderUpdates(['untrusted-command'], f), { code: 'RUNTIME_UPDATE_FAILED' });
  f.next('1.2.3;touch /tmp/evil');
  assert.throws(() => updateProviders(['codex'], { ...f, authorized: true }), { code: 'RUNTIME_UPDATE_FAILED' });
  assert.equal(f.calls.some(c => c.args[0] === 'install'), false);
  f.next('1.2.3'); updateProviders(['codex'], { ...f, authorized: true });
  const path = join(providerStore(f.env), 'codex.json');
  const record = JSON.parse(readFileSync(path));
  record.prefix = tmpdir(); writeFileSync(path, JSON.stringify(record));
  assert.throws(() => managedProvider('codex', f), { code: 'RUNTIME_UPDATE_FAILED' });
  const other = fixture();
  mkdirSync(join(other.env.XDG_DATA_HOME, 'torch'));
  symlinkSync(tmpdir(), providerStore(other.env));
  assert.throws(() => planProviderUpdates(['pi'], other), { code: 'RUNTIME_UPDATE_FAILED' });
});
