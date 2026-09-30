import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createRuntimeAdapterRegistry } from '../../src/adapters/registry.mjs';
import { inspectRuntimePluginTrust, planRuntimePluginTrust, trustRuntimePlugin } from '../../src/adapters/plugins.mjs';
import { openControlPlane } from '../../src/control-plane/service.mjs';
import { analyzeRepository } from '../../src/kernel/analyze.mjs';
import { proposeDomains } from '../../src/kernel/domains.mjs';
import { diagnoseProject } from '../../src/kernel/doctor.mjs';
import { inspectRepository } from '../../src/kernel/git.mjs';
import { installProject } from '../../src/kernel/install.mjs';
import { createWorktrees } from '../../src/kernel/worktrees.mjs';
import { planFleetUp } from '../../src/runtime/lifecycle.mjs';

const CLI = new URL('../../bin/torch.mjs', import.meta.url).pathname;
const PLUGIN_NAME = 'portable-local';

function pluginSource(name, sentinel) {
  return `
const fs = require('node:fs');
fs.appendFileSync(${JSON.stringify(sentinel)}, 'loaded\\n');
exports.createTorchRuntimeAdapter = ({ env }) => ({
  name: ${JSON.stringify(name)},
  configuration: { executable: 'local-agent' },
  capabilities: {
    detect: true, configure: 'plan-only', modelSelection: true, modelRequired: true,
    reasoningSelection: true, createSession: true, resumeSession: true,
    perInvocationCostCeiling: { createSession: [], resumeSession: [] },
    sendOrSteer: false, getStatus: false, listSessions: false, stopSession: false,
    captureRuntimeId: false, installHooks: false, removeHooks: false,
  },
  detect: () => ({ available: true, adapter: ${JSON.stringify(name)} }),
  configure: ({ repositoryRoot, areaId }) => ({
    adapter: ${JSON.stringify(name)}, mutationPerformed: false,
    mcp: { name: 'torch-' + areaId, command: process.execPath, args: [], cwd: repositoryRoot },
  }),
  createSession: ({ areaId, worktree, model, reasoning }) => ({
    adapter: ${JSON.stringify(name)}, areaId, runtimeSessionId: null, requiresRuntimeIdCapture: false,
    profile: { model, reasoning },
    launch: { command: 'local-agent', args: [model, reasoning].filter(Boolean), cwd: worktree, mutatesRuntime: true },
  }),
  resumeSession: ({ areaId, runtimeSessionId, worktree, model, reasoning }) => ({
    adapter: ${JSON.stringify(name)}, areaId, runtimeSessionId, profile: { model, reasoning },
    launch: { command: 'local-agent', args: [model, reasoning].filter(Boolean), cwd: worktree, mutatesRuntime: true },
  }),
  sendOrSteer: () => ({ supported: false }), getStatus: () => ({ supported: false }),
  listSessions: () => ({ supported: false }), stopSession: () => ({ supported: false }),
  captureRuntimeId: () => ({ supported: false }), installHooks: () => ({ supported: false }),
  removeHooks: () => ({ supported: false }),
});
`;
}

function environment(root) {
  return {
    ...process.env,
    XDG_CONFIG_HOME: join(root, 'config'),
    XDG_DATA_HOME: join(root, 'data'),
  };
}

function runCli(args, env, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, env, encoding: 'utf8' });
}

function repository(root) {
  execFileSync('git', ['init', '-b', 'main', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'torch-test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'TORCH Test']);
  writeFileSync(join(root, 'app.mjs'), 'export const application = true;\n');
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'fixture']);
  return inspectRepository(root);
}

test('SCN-runtime-plugin-trust: user approval pins one module hash without executing it during review', () => {
  const root = mkdtempSync(join(tmpdir(), 'torch-runtime-plugin-trust-'));
  const env = environment(root);
  const modulePath = join(root, 'portable-local.cjs');
  const sentinel = join(root, 'plugin-loaded.txt');
  writeFileSync(modulePath, pluginSource(PLUGIN_NAME, sentinel));

  const preview = planRuntimePluginTrust({ name: PLUGIN_NAME, modulePath, env });
  assert.equal(preview.mutationPerformed, false);
  assert.equal(preview.executesPluginDuringPlan, false);
  assert.equal(existsSync(sentinel), false, 'review must never evaluate plugin code');
  assert.equal(existsSync(preview.trustStorePath), false);

  const cliPreview = runCli([
    'runtimes', 'trust', '--name', PLUGIN_NAME, '--module', modulePath, '--json',
  ], env, root);
  assert.equal(cliPreview.status, 0, cliPreview.stderr || cliPreview.stdout);
  let plannedTrust = JSON.parse(cliPreview.stdout);
  assert.equal(plannedTrust.requiresApproval, true);
  assert.equal(existsSync(sentinel), false);
  assert.equal(existsSync(preview.trustStorePath), false, 'preview does not change user config');

  writeFileSync(modulePath, `${pluginSource(PLUGIN_NAME, sentinel)}\n// changed after preview\n`);
  const staleApproval = runCli([
    'runtimes', 'trust', '--name', PLUGIN_NAME, '--module', modulePath,
    '--yes', '--sha256', plannedTrust.sha256, '--json',
  ], env, root);
  assert.equal(staleApproval.status, 2);
  assert.equal(JSON.parse(staleApproval.stdout).error, 'RUNTIME_PLUGIN_REVIEW_STALE');
  assert.equal(existsSync(preview.trustStorePath), false, 'a changed module cannot inherit prior approval');
  const refreshedPreview = runCli([
    'runtimes', 'trust', '--name', PLUGIN_NAME, '--module', modulePath, '--json',
  ], env, root);
  plannedTrust = JSON.parse(refreshedPreview.stdout);

  const trusted = runCli([
    'runtimes', 'trust', '--name', PLUGIN_NAME, '--module', modulePath,
    '--yes', '--sha256', plannedTrust.sha256, '--json',
  ], env, root);
  assert.equal(trusted.status, 0, trusted.stderr || trusted.stdout);
  assert.equal(JSON.parse(trusted.stdout).mutationPerformed, true);
  assert.equal(existsSync(sentinel), false, 'trusting records code; it does not load or launch it');
  const trustPath = JSON.parse(trusted.stdout).trustStorePath;
  assert.equal(statSync(trustPath).mode & 0o777, 0o600);

  const catalog = runCli(['runtimes', 'list', '--json'], env, root);
  assert.equal(catalog.status, 0, catalog.stderr || catalog.stdout);
  const list = JSON.parse(catalog.stdout);
  assert.equal(list.executesPluginCode, false);
  assert.equal(list.trust.plugins[0].status, 'trusted');
  assert.equal(existsSync(sentinel), false, 'catalog inspection must not evaluate plugins');

  const inspectionRegistry = createRuntimeAdapterRegistry({ env });
  assert.equal(inspectionRegistry.has(PLUGIN_NAME), false, 'general registry inspection does not execute plugins');
  assert.equal(inspectionRegistry.trustedPlugins[0].status, 'trusted');
  assert.equal(existsSync(sentinel), false);

  const registry = createRuntimeAdapterRegistry({ env, loadPlugins: true });
  assert.equal(registry.has(PLUGIN_NAME), true);
  assert.equal(registry.pluginErrors.length, 0);
  assert.equal(existsSync(sentinel), true, 'only a registry load executes explicitly trusted code');

  writeFileSync(modulePath, `${pluginSource(PLUGIN_NAME, sentinel)}\n// changed after approval\n`);
  const changedRegistry = createRuntimeAdapterRegistry({ env });
  assert.equal(changedRegistry.has(PLUGIN_NAME), false);
  assert.equal(changedRegistry.pluginErrors[0].code, 'RUNTIME_PLUGIN_HASH_MISMATCH');
  assert.equal(inspectRuntimePluginTrust({ env }).plugins[0].status, 'hash-mismatch');

  const revokePreview = runCli(['runtimes', 'revoke', '--name', PLUGIN_NAME, '--json'], env, root);
  assert.equal(revokePreview.status, 0, revokePreview.stderr || revokePreview.stdout);
  assert.equal(JSON.parse(revokePreview.stdout).requiresApproval, true);
  const plannedRevoke = JSON.parse(revokePreview.stdout);
  const revoked = runCli([
    'runtimes', 'revoke', '--name', PLUGIN_NAME, '--yes', '--sha256', plannedRevoke.sha256, '--json',
  ], env, root);
  assert.equal(revoked.status, 0, revoked.stderr || revoked.stdout);
  assert.equal(JSON.parse(revoked.stdout).disposition, 'revoked');
  assert.equal(JSON.parse(revoked.stdout).sessionsStopped, false);
  assert.deepEqual(inspectRuntimePluginTrust({ env }).plugins, []);
});

test('SCN-runtime-plugin-lifecycle: an explicitly trusted local adapter participates in mixed Fleet planning only', () => {
  const root = mkdtempSync(join(tmpdir(), 'torch-runtime-plugin-lifecycle-'));
  const env = environment(root);
  const repositoryRoot = join(root, 'project');
  const modulePath = join(root, 'portable-local.cjs');
  writeFileSync(modulePath, pluginSource(PLUGIN_NAME, join(root, 'loaded.txt')));
  const trustPlan = planRuntimePluginTrust({ name: PLUGIN_NAME, modulePath, env });
  trustRuntimePlugin({
    name: PLUGIN_NAME, modulePath, env, approved: true, expectedSha256: trustPlan.sha256,
  });

  const inspected = repository(repositoryRoot);
  const proposal = proposeDomains({ repository: inspected, analysis: analyzeRepository(inspected) });
  const worker = proposal.domains[0];
  worker.runtime = 'claude';
  worker.model = null;
  worker.reasoning = null;
  proposal.session_manager = { runtime: 'claude', reasoning: 'high' };
  proposal.review = {
    status: 'approved', reviewedAt: '2026-09-28T00:00:00Z', reviewedBy: 'fixture-owner', notes: [],
  };
  installProject({
    repository: inspected, proposal, env, projectId: 'trusted-runtime-plugin',
    runtimes: ['claude'],
  });
  execFileSync('git', ['-C', repositoryRoot, 'add', '.torch']);
  execFileSync('git', ['-C', repositoryRoot, 'commit', '-m', 'install TORCH']);
  const profileChange = runCli([
    'profile', 'set', '--area', worker.id, '--runtime', PLUGIN_NAME,
    '--model', 'local-provider/model-a', '--reasoning', 'high', '--yes', '--json',
  ], env, repositoryRoot);
  assert.equal(profileChange.status, 0, profileChange.stderr || profileChange.stdout);
  assert.equal(JSON.parse(profileChange.stdout).profile.runtime, PLUGIN_NAME);
  const config = JSON.parse(readFileSync(join(repositoryRoot, '.torch', 'torch.yaml'), 'utf8'));
  assert.deepEqual(config.runtimes[PLUGIN_NAME], { executable: 'local-agent' });
  assert.equal(config.domains.find((domain) => domain.id === worker.id).runtime, PLUGIN_NAME);
  execFileSync('git', ['-C', repositoryRoot, 'add', '.torch/torch.yaml']);
  execFileSync('git', ['-C', repositoryRoot, 'commit', '-m', 'assign trusted local runtime']);
  createWorktrees({
    repository: inspectRepository(repositoryRoot),
    parentOverride: join(root, 'worktrees'),
  });
  const control = openControlPlane({ repositoryRoot, env });
  try {
    const registry = createRuntimeAdapterRegistry({ env, loadPlugins: true });
    const plan = planFleetUp({
      repositoryRoot, controlPlane: control, adapters: registry.toMap(), fresh: true,
    });
    assert.equal(plan.canProceed, true, JSON.stringify(plan.blockers));
    const action = plan.actions.find((entry) => entry.areaId === worker.id);
    assert.equal(action.runtime, PLUGIN_NAME);
    assert.deepEqual(action.profile, {
      model: 'local-provider/model-a', reasoning: 'high', launchPolicy: {},
    });
    assert.equal(action.launch.command, 'local-agent');
    assert.equal(plan.mutationPerformed, false);
    assert.equal(plan.actions.every((entry) => entry.launch.mutatesRuntime), true);
    assert.equal(existsSync(join(root, 'loaded.txt')), true);
  } finally {
    control.close();
  }

  unlinkSync(join(root, 'loaded.txt'));
  const trustedDiagnosis = diagnoseProject({ repository: inspectRepository(repositoryRoot), env });
  assert.equal(trustedDiagnosis.findings.some((finding) =>
    finding.code === 'RUNTIME_ADAPTER_TRUSTED_NOT_LOADED' && finding.runtime === PLUGIN_NAME), true);
  assert.equal(existsSync(join(root, 'loaded.txt')), false, 'doctor reports the user trust record without loading plugin code');

  const untrustedRoot = mkdtempSync(join(tmpdir(), 'torch-runtime-plugin-untrusted-'));
  const untrustedEnv = environment(untrustedRoot);
  const untrustedRegistry = createRuntimeAdapterRegistry({ env: untrustedEnv });
  assert.equal(untrustedRegistry.has(PLUGIN_NAME), false);
  assert.equal(untrustedRegistry.pluginErrors.length, 0);
  const diagnosis = diagnoseProject({ repository: inspectRepository(repositoryRoot), env: untrustedEnv });
  assert.equal(diagnosis.findings.some((finding) =>
    finding.code === 'RUNTIME_ADAPTER_UNKNOWN' && finding.runtime === PLUGIN_NAME), true,
  'project runtime configuration cannot grant trust to a local plugin');
});
