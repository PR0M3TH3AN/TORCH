import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
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
  writeFileSync(join(root, 'bin', 'torch.mjs'), `export const marker = ${JSON.stringify(marker)};\n`);
  return root;
}

function accepted(candidateRoot) {
  return {
    passed: true,
    scenarios: [...CANDIDATE_ACCEPTANCE_SCENARIOS],
    evidence: [{ type: 'fixture', candidateRoot }],
  };
}

test('SCN-candidate-isolation: staging requires complete acceptance and never changes the active version', () => {
  const root = mkdtempSync(join(tmpdir(), 'torch-self-host-'));
  const env = { ...process.env, XDG_DATA_HOME: join(root, 'xdg') };
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
  execFileSync('git', ['init', '-b', 'main', checkout]);
  execFileSync('git', ['-C', checkout, 'config', 'user.email', 'torch-test@example.invalid']);
  execFileSync('git', ['-C', checkout, 'config', 'user.name', 'TORCH Test']);
  execFileSync('git', ['-C', checkout, 'add', '.']);
  execFileSync('git', ['-C', checkout, 'commit', '-m', 'candidate source']);
  writeFileSync(join(checkout, 'local-secret.env'), 'DO_NOT_COPY=true\n');

  const boundedPlan = service.planCandidate({ source: checkout });
  assert.equal(boundedPlan.sourceMode, 'git-commit');
  assert.match(boundedPlan.sourceCommit, /^[0-9a-f]{40}$/);
  const bounded = service.installCandidate({ source: checkout, validate: accepted });
  assert.equal(existsSync(join(bounded.destination, 'local-secret.env')), false);
  assert.equal(existsSync(join(bounded.destination, 'node_modules', '.bin', 'fixture-dependency')), true);
  assert.deepEqual(JSON.parse(readFileSync(bounded.validation, 'utf8')).source, {
    mode: 'git-commit', commit: boundedPlan.sourceCommit,
  });

  writeFileSync(join(checkout, 'bin', 'torch.mjs'), 'export const marker = "dirty";\n');
  assert.throws(
    () => service.planCandidate({ source: checkout }),
    (error) => error.code === 'CANDIDATE_SOURCE_DIRTY',
  );
});

test('SCN-atomic-upgrade-rollback: a crash after pointer swap reconciles and rollback restores the exact prior version', () => {
  const root = mkdtempSync(join(tmpdir(), 'torch-self-host-'));
  const env = { ...process.env, XDG_DATA_HOME: join(root, 'xdg') };
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

  const rolledBack = recovered.rollback();
  assert.equal(rolledBack.activeVersion, '1.0.0');
  assert.equal(rolledBack.previousVersion, '1.1.0');
  assert.equal(readFileSync(join(rolledBack.root, 'active', 'bin', 'torch.mjs'), 'utf8').includes('stable'), true);
});
