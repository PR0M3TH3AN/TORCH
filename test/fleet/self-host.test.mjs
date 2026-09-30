import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { CANDIDATE_ACCEPTANCE_EVIDENCE, runCandidateAcceptance } from '../../src/cli.mjs';
import {
  CANDIDATE_ACCEPTANCE_SCENARIOS, createVersionService,
} from '../../src/self-host/service.mjs';

function candidate(parent, version, marker) {
  const root = join(parent, `candidate-${version}`);
  mkdirSync(join(root, 'bin'), { recursive: true });
  writeFileSync(join(root, 'package.json'), `${JSON.stringify({
    name: 'torch-agent-fleet', version, type: 'module', bin: { torch: 'bin/torch.mjs' },
  }, null, 2)}\n`);
  writeFileSync(join(root, 'torch-release.json'), `${JSON.stringify({
    schema: 'torch.dev/release/v1alpha1', version,
    state: { reads: ['torch.dev/state/v1alpha1'], writes: 'torch.dev/state/v1alpha1', rollback_safe: true },
  }, null, 2)}\n`);
  writeFileSync(join(root, 'bin', 'torch.mjs'), `#!/usr/bin/env node\nexport const marker = ${JSON.stringify(marker)};\nconsole.log(marker);\n`);
  chmodSync(join(root, 'bin', 'torch.mjs'), 0o755);
  return root;
}

function accepted(candidateRoot) {
  return {
    passed: true,
    scenarios: [...CANDIDATE_ACCEPTANCE_SCENARIOS],
    evidence: [{ type: 'fixture', candidateRoot }],
  };
}

test('SCN-candidate-acceptance-evidence: every required scenario needs explicit, present test-marker evidence', () => {
  assert.deepEqual(Object.keys(CANDIDATE_ACCEPTANCE_EVIDENCE).sort(), [...CANDIDATE_ACCEPTANCE_SCENARIOS].sort());
  for (const [scenario, markers] of Object.entries(CANDIDATE_ACCEPTANCE_EVIDENCE)) {
    assert.ok(markers.length > 0, `${scenario} must not pass through an empty marker list`);
  }
  const completeOutput = [...new Set(Object.values(CANDIDATE_ACCEPTANCE_EVIDENCE).flat())].join('\n');
  const run = (output) => runCandidateAcceptance('/tmp/candidate-fixture', (_command, args) => ({
    status: 0, signal: null, stdout: args[0] === 'test' ? output : 'check passed\n', stderr: '',
  }));
  assert.equal(run(completeOutput).passed, true);
  assert.equal(run(completeOutput.replace('SCN-backlog-self-claim\n', '')).passed, false,
    'longer self-claim scenario names cannot stand in for missing exact marker evidence');
  assert.equal(run(completeOutput.replace('SCN-hierarchy-activation-rollback', '')).passed, false,
    'missing newly added hierarchy-lifecycle evidence blocks self-host acceptance');
  for (const marker of ['SCN-manager-check-in-count-mode', 'SCN-manager-wake-reservation',
    'SCN-manager-wake-policy', 'SCN-manager-wake-recovery', 'SCN-cli-install-provider-default',
    'SCN-install-provider-inheritance', 'SCN-hierarchy-pilot-review', 'SCN-hierarchy-pilot-reversal',
    'SCN-console-hierarchy-conclusion', 'SCN-console-hierarchy-adoption',
    'SCN-frozen-check-inputs', 'SCN-frozen-check-rejection', 'SCN-frozen-resource-check',
    'SCN-frozen-check-mutating-executor', 'SCN-check-conditions-contract',
    'SCN-check-conditions-fail-closed', 'SCN-check-condition-drift', 'SCN-condition-receipts',
    'SCN-backlog-self-claim', 'SCN-backlog-self-claim-readiness', 'SCN-backlog-self-claim-race',
    'SCN-cli-backlog-self-claim', 'SCN-backlog-blocked-resume-serialization',
    'SCN-backlog-commit-activity', 'SCN-backlog-activity-coverage', 'SCN-commit-closure-intent',
    'SCN-landed-task-closure', 'SCN-landed-closure-recovery',
    'SCN-delivery-attempts', 'SCN-delivery-retry-boundaries', 'SCN-delivery-succeeded-recovery',
    'SCN-owner-digest', 'SCN-owner-digest-schedule', 'SCN-owner-digest-receipts',
    'SCN-console-owner-digest', 'SCN-demo-owner-digest', 'SCN-console-check-evidence', 'SCN-console-task-activity',
    'SCN-canonical-fetch', 'SCN-canonical-fetch-boundaries', 'SCN-console-operation-outcomes', 'SCN-console-live-refresh']) {
    assert.equal(run(completeOutput.replace(marker, '')).passed, false,
      `missing ${marker} must block self-host acceptance even when every command exits green`);
  }
});

test('SCN-candidate-acceptance-isolation: candidate gates use disposable HOME and XDG state, not the active install root', () => {
  const originalDataHome = process.env.XDG_DATA_HOME;
  const inheritedDataHome = '/tmp/active-torch-runtime-state';
  process.env.XDG_DATA_HOME = inheritedDataHome;
  const observed = [];
  const completeOutput = [...new Set(Object.values(CANDIDATE_ACCEPTANCE_EVIDENCE).flat())].join('\n');
  let result;
  try {
    result = runCandidateAcceptance('/tmp/candidate-fixture', (_command, args, options) => {
      observed.push({ args, env: options.env });
      return {
        status: 0, signal: null,
        stdout: args[0] === 'test' ? completeOutput : '', stderr: '',
      };
    });
  } finally {
    if (originalDataHome === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = originalDataHome;
  }
  assert.equal(result.passed, true);
  assert.equal(observed.length, 3);
  for (const { env } of observed) {
    const acceptanceRoot = dirname(env.HOME);
    assert.notEqual(env.XDG_DATA_HOME, inheritedDataHome);
    assert.match(acceptanceRoot, /^\/tmp\/torch-candidate-acceptance-/);
    assert.ok(env.TMPDIR.startsWith(acceptanceRoot));
    assert.ok(env.XDG_DATA_HOME.startsWith(env.HOME));
    assert.ok(env.XDG_CONFIG_HOME.startsWith(env.HOME));
    assert.ok(env.XDG_CACHE_HOME.startsWith(env.HOME));
    assert.ok(env.XDG_STATE_HOME.startsWith(env.HOME));
  }
  assert.equal(existsSync(dirname(observed[0].env.HOME)), false,
    'temporary acceptance home and XDG state are removed after all gates');
});

test('SCN-candidate-failure-diagnostics: failed acceptance reports bounded child output', () => {
  const result = runCandidateAcceptance('/tmp/candidate-fixture', (_command, args) => {
    if (args[0] === 'test') return {
      status: 1, signal: null,
      stdout: 'TAP version 13\nnot ok 1 - fixture regression\n',
      stderr: 'temporary git operation failed with EPERM\n',
    };
    return { status: 0, signal: null, stdout: `${args[0]} passed\n`, stderr: '' };
  });
  assert.equal(result.passed, false);
  const failure = result.evidence.find((entry) => entry.id === 'test');
  assert.equal(failure.status, 1);
  assert.match(failure.stdoutExcerpt, /not ok 1 - fixture regression/);
  assert.match(failure.stderrExcerpt, /EPERM/);
  assert.equal(result.evidence.find((entry) => entry.id === 'lint').stdoutExcerpt, undefined,
    'successful checks do not duplicate their output in the receipt');
});

test('SCN-candidate-isolation: staging requires complete acceptance and never changes the active version', () => {
  const root = mkdtempSync(join(tmpdir(), 'torch-self-host-'));
  const env = { ...process.env, XDG_DATA_HOME: join(root, 'xdg'), TORCH_BIN_HOME: join(root, 'bin-home') };
  const service = createVersionService({ env, now: () => new Date('2026-09-27T00:00:00Z') });
  const source = candidate(root, '1.0.0', 'stable');
  const plan = service.planCandidate({ source });
  assert.equal(plan.mutationPerformed, false);
  assert.equal(plan.files, 3);
  assert.equal(service.status().activeVersion, null);
  assert.equal(existsSync(join(root, 'xdg')), false, 'planning and empty status must remain read-only');

  assert.throws(
    () => service.installCandidate({
      source,
      validate: () => ({ passed: true, scenarios: CANDIDATE_ACCEPTANCE_SCENARIOS.slice(1) }),
    }),
    (error) => error.code === 'CANDIDATE_ACCEPTANCE_FAILED',
  );
  assert.equal(service.status().installed.length, 0);
  assert.equal(service.status().activeVersion, null);

  const installed = service.installCandidate({ source, validate: accepted });
  assert.equal(installed.mutationPerformed, true);
  assert.deepEqual(service.status().installed, ['1.0.0']);
  assert.equal(service.status().activeVersion, null);
  assert.equal(JSON.parse(readFileSync(installed.validation, 'utf8')).passed, true);
  writeFileSync(join(installed.destination, 'bin', 'torch.mjs'), 'export const marker = "tampered";\n');
  assert.throws(
    () => service.activate('1.0.0'),
    (error) => error.code === 'CANDIDATE_VALIDATION_STALE',
  );

  const checkout = candidate(root, '1.1.0', 'bounded');
  mkdirSync(join(checkout, 'node_modules', 'fixture-dependency'), { recursive: true });
  mkdirSync(join(checkout, 'node_modules', '.bin'), { recursive: true });
  writeFileSync(join(checkout, 'node_modules', 'fixture-dependency', 'index.js'), 'export const dependency = true;\n');
  symlinkSync('../fixture-dependency/index.js', join(checkout, 'node_modules', '.bin', 'fixture-dependency'));
  writeFileSync(join(checkout, '.gitignore'), 'node_modules/\nlocal-secret.env\n');
  mkdirSync(join(checkout, '.torch'));
  writeFileSync(join(checkout, '.torch', 'torch.yaml'), '{"machineSpecificProject":true}\n');
  execFileSync('git', ['init', '-b', 'main', checkout]);
  execFileSync('git', ['-C', checkout, 'config', 'user.email', 'torch-test@example.invalid']);
  execFileSync('git', ['-C', checkout, 'config', 'user.name', 'TORCH Test']);
  execFileSync('git', ['-C', checkout, 'add', '.']);
  execFileSync('git', ['-C', checkout, 'commit', '-m', 'candidate source']);
  writeFileSync(join(checkout, 'local-secret.env'), 'DO_NOT_COPY=true\n');
  writeFileSync(join(checkout, 'new-runtime-adapter.mjs'), 'export const notCommitted = true;\n');

  const boundedPlan = service.planCandidate({ source: checkout });
  assert.equal(boundedPlan.sourceMode, 'git-commit');
  assert.match(boundedPlan.sourceCommit, /^[0-9a-f]{40}$/);
  assert.deepEqual(boundedPlan.excludedUntracked, ['new-runtime-adapter.mjs'],
    'the reviewed candidate plan names untracked files that will not ship');
  const bounded = service.installCandidate({ source: checkout, validate: accepted });
  assert.equal(existsSync(join(bounded.destination, '.torch')), false,
    'tracked self-host project state must not ship inside the installed engine');
  assert.equal(existsSync(join(bounded.destination, 'local-secret.env')), false);
  assert.equal(existsSync(join(bounded.destination, 'new-runtime-adapter.mjs')), false);
  assert.equal(existsSync(join(bounded.destination, 'node_modules', '.bin', 'fixture-dependency')), true);
  assert.deepEqual(JSON.parse(readFileSync(bounded.validation, 'utf8')).source, {
    mode: 'git-commit', commit: boundedPlan.sourceCommit,
  });
  const activated = service.activate('1.1.0');
  assert.equal(activated.launcher.installed, true);
  assert.equal(execFileSync(activated.launcher.path, [], { encoding: 'utf8' }).trim(), 'bounded');

  writeFileSync(join(checkout, 'bin', 'torch.mjs'), 'export const marker = "dirty";\n');
  assert.throws(
    () => service.planCandidate({ source: checkout }),
    (error) => error.code === 'CANDIDATE_SOURCE_DIRTY',
  );

  const conflictRoot = mkdtempSync(join(tmpdir(), 'torch-self-host-conflict-'));
  const conflictEnv = {
    ...process.env,
    XDG_DATA_HOME: join(conflictRoot, 'xdg'),
    TORCH_BIN_HOME: join(conflictRoot, 'bin-home'),
  };
  const conflictService = createVersionService({ env: conflictEnv });
  const conflictCandidate = candidate(conflictRoot, '2.0.0', 'conflict');
  conflictService.installCandidate({ source: conflictCandidate, validate: accepted });
  mkdirSync(conflictEnv.TORCH_BIN_HOME, { recursive: true });
  writeFileSync(join(conflictEnv.TORCH_BIN_HOME, 'torch'), 'owner executable\n');
  assert.throws(
    () => conflictService.activate('2.0.0'),
    (error) => error.code === 'LAUNCHER_PATH_CONFLICT',
  );
  assert.equal(conflictService.status().activeVersion, null);
});

test('SCN-atomic-upgrade-rollback: a crash after pointer swap reconciles and rollback restores the exact prior version', () => {
  const root = mkdtempSync(join(tmpdir(), 'torch-self-host-'));
  const env = { ...process.env, XDG_DATA_HOME: join(root, 'xdg'), TORCH_BIN_HOME: join(root, 'bin-home') };
  const v1 = candidate(root, '1.0.0', 'stable');
  const v2 = candidate(root, '1.1.0', 'candidate');
  const service = createVersionService({ env, now: () => new Date('2026-09-27T01:00:00Z') });
  service.installCandidate({ source: v1, validate: accepted });
  service.installCandidate({ source: v2, validate: accepted });
  assert.equal(service.activate('1.0.0').activeVersion, '1.0.0');

  const crashing = createVersionService({
    env,
    now: () => new Date('2026-09-27T02:00:00Z'),
    afterPointerSwap: () => { throw new Error('simulated interruption'); },
  });
  assert.throws(() => crashing.activate('1.1.0'), /simulated interruption/);

  const recovered = createVersionService({ env, now: () => new Date('2026-09-27T03:00:00Z') });
  const status = recovered.status();
  assert.equal(status.consistent, true);
  assert.equal(status.activeVersion, '1.1.0');
  assert.equal(status.previousVersion, '1.0.0');
  assert.equal(existsSync(join(status.root, 'activation-journal.json')), false);
  assert.equal(status.launcher.installed, true);
  assert.equal(execFileSync(status.launcher.path, [], { encoding: 'utf8' }).trim(), 'candidate');

  const rolledBack = recovered.rollback();
  assert.equal(rolledBack.activeVersion, '1.0.0');
  assert.equal(rolledBack.previousVersion, '1.1.0');
  assert.equal(readFileSync(join(rolledBack.root, 'active', 'bin', 'torch.mjs'), 'utf8').includes('stable'), true);
});
