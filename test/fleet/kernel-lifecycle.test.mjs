import assert from 'node:assert/strict';
import { execFileSync, fork } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { analyzeRepository } from '../../src/kernel/analyze.mjs';
import { diagnoseProject } from '../../src/kernel/doctor.mjs';
import { inspectRepository } from '../../src/kernel/git.mjs';
import {
  PROJECT_CONFIG_SCHEMA, planProjectConfigMigration, validateProjectConfig,
} from '../../src/kernel/config.mjs';
import {
  installProject, planInstall, planUninstall, uninstallProject,
} from '../../src/kernel/install.mjs';
import { proposeDomains, validateApprovedProposal } from '../../src/kernel/domains.mjs';
import { createLocalCanonical } from '../../src/canonical/local.mjs';
import { openControlPlane } from '../../src/control-plane/service.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'torch-kernel-'));
  execFileSync('git', ['init', '-b', 'main', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'torch-test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'TORCH Test']);
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    name: 'fixture-app', scripts: { test: 'node --test', build: 'node build.mjs' },
  }));
  writeFileSync(join(root, 'index.js'), 'export const ready = true;\n');
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'fixture']);
  const stateHome = join(root, '.xdg-data');
  return { root, env: { ...process.env, XDG_DATA_HOME: stateHome } };
}

function approvedProposal(repository) {
  const proposal = proposeDomains({ repository, analysis: analyzeRepository(repository) });
  proposal.review = {
    status: 'approved', reviewedAt: '2026-09-27T00:00:00Z', reviewedBy: 'fixture-owner', notes: [],
  };
  return proposal;
}

test('SCN-init-read-only: inspection and analysis do not mutate the project', () => {
  const { root, env } = fixture();
  const before = execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' });
  const repository = inspectRepository(root);
  const analysis = analyzeRepository(repository);
  const plan = planInstall({ repository, proposal: approvedProposal(repository), env });
  const after = execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' });

  assert.equal(analysis.mutationPerformed, false);
  assert.equal(plan.mutationPerformed, false);
  assert.equal(existsSync(join(root, '.torch')), false);
  assert.equal(after, before);
  assert.deepEqual(analysis.inventory.languages[0], { name: 'JavaScript', files: 1 });
  assert.equal(analysis.inventory.checks.some((check) => check.name === 'test'), true);
});

test('SCN-install-doctor-purge: a fresh install is healthy and exactly reversible', () => {
  const { root, env } = fixture();
  const repository = inspectRepository(root);
  const proposal = approvedProposal(repository);
  const installed = installProject({
    repository, proposal, env, projectId: 'fixture-project', now: () => new Date('2026-09-27T00:00:00Z'),
  });

  assert.equal(existsSync(join(root, '.torch', 'torch.yaml')), true);
  assert.equal(existsSync(installed.stateRoot), true);
  const config = JSON.parse(readFileSync(join(root, '.torch', 'torch.yaml'), 'utf8'));
  assert.equal(config.project.id, 'fixture-project');

  const diagnosis = diagnoseProject({ repository: inspectRepository(root), env });
  assert.equal(diagnosis.healthy, true);
  assert.equal(diagnosis.status, 'ok');

  const control = openControlPlane({ repositoryRoot: root, env });
  control.sendMessage({ sender: 'session-manager', recipient: proposal.domains[0].id, body: 'Historical state remains reversible.' });
  control.reportStatus({ areaId: proposal.domains[0].id, state: 'working', summary: 'Still active.' });
  control.close();
  const activePlan = planUninstall({ repository: inspectRepository(root), purge: true, env });
  assert.equal(activePlan.problems.some((problem) => problem.type === 'active-runtime-sessions'), true);
  const reopened = openControlPlane({ repositoryRoot: root, env });
  reopened.reportStatus({ areaId: proposal.domains[0].id, state: 'offline', summary: 'Stopped.' });
  reopened.close();
  const result = uninstallProject({ repository: inspectRepository(root), purge: true, env });
  assert.equal(result.mutationPerformed, true);
  assert.equal(existsSync(join(root, '.torch')), false);
  assert.equal(existsSync(installed.stateRoot), false);
  assert.equal(readFileSync(join(root, 'index.js'), 'utf8'), 'export const ready = true;\n');
});

test('SCN-runtime-launch-reservation: durable attempts, provider identities, and unknown launches fail closed', () => {
  const { root, env } = fixture();
  const repository = inspectRepository(root);
  const proposal = approvedProposal(repository);
  installProject({ repository, proposal, env, projectId: 'reservation-project' });
  const areaId = proposal.domains[0].id;
  const trustedExecutorRecords = new WeakSet();
  const control = openControlPlane({
    repositoryRoot: root,
    env,
    verifyRuntimeLaunchEvidence: ({ evidence, reservation }) => trustedExecutorRecords.has(evidence)
      && evidence.reservationId === reservation.id && evidence.attemptId === reservation.attempt_id,
  });
  const executorEvidence = (reservation, outcome, extra = {}) => {
    const evidence = {
      source: 'runtime-executor', attemptId: reservation.attemptId, reservationId: reservation.id,
      observedAt: '2026-10-01T00:00:00.000Z', outcome, terminal: outcome !== 'unknown',
      status: null, signal: null, errorCode: null, ...extra,
    };
    trustedExecutorRecords.add(evidence);
    return evidence;
  };
  const stoppedProof = (reservation) => {
    const proof = {
      kind: 'process-proof', attemptId: reservation.attemptId, reservationId: reservation.id,
      observedAt: '2026-10-01T00:01:00.000Z', processId: 'fixture-process-1',
      processStart: '2026-10-01T00:00:00.000Z', verifier: 'fixture-executor',
    };
    trustedExecutorRecords.add(proof);
    return proof;
  };
  try {
    const fresh = control.reserveRuntimeLaunch({
      areaId, runtime: 'codex', attemptId: 'fresh-attempt', mode: 'fresh',
    });
    assert.equal(fresh.expectedRuntimeSessionId, null, 'fresh launches reserve before a provider ID exists');
    assert.equal(control.identity(areaId).state, 'starting');
    assert.equal(control.identity(areaId).runtimeSessionId, null);
    assert.throws(() => control.reserveRuntimeLaunch({
      areaId, runtime: 'codex', attemptId: 'competing-attempt', mode: 'fresh',
    }), (error) => error.code === 'RUNTIME_LAUNCH_ALREADY_RESERVED');

    const held = control.holdRuntimeLaunch({
      reservationId: fresh.id, attemptId: fresh.attemptId, outcome: 'unknown',
      evidence: executorEvidence(fresh, 'unknown', { reason: 'executor-interrupted' }),
    });
    assert.equal(held.state, 'held');
    assert.equal(held.capturedRuntimeSessionId, null, 'an unknown launch without an ID remains guarded without inventing one');
    assert.equal(control.identity(areaId).state, 'working', 'unknown fresh launch remains guarded rather than offline');
    assert.throws(() => control.reconcileRuntimeLaunch({
      reservationId: fresh.id,
      proof: {
        kind: 'process-proof', attemptId: fresh.attemptId, reservationId: fresh.id,
        observedAt: '2026-10-01T00:01:00.000Z', processId: 'forged-process',
        processStart: '2026-10-01T00:00:00.000Z', verifier: 'untrusted-caller',
      },
    }), (error) => error.code === 'RUNTIME_LAUNCH_RECONCILIATION_BLOCKED');
    assert.equal(control.reconcileRuntimeLaunch({
      reservationId: fresh.id, proof: stoppedProof(fresh),
    }).state, 'reconciled-stopped');
    assert.throws(() => control.reserveRuntimeLaunch({
      areaId, runtime: 'codex', attemptId: fresh.attemptId, mode: 'fresh',
    }), (error) => error.code === 'RUNTIME_LAUNCH_ATTEMPT_REPLAYED');

    const captured = control.reserveRuntimeLaunch({
      areaId, runtime: 'codex', attemptId: 'fresh-captured', mode: 'fresh',
    });
    assert.equal(control.holdRuntimeLaunch({
      reservationId: captured.id, attemptId: captured.attemptId, outcome: 'unknown',
      capturedRuntimeSessionId: 'captured-after-dispatch',
      evidence: executorEvidence(captured, 'unknown', { reason: 'executor-disconnected' }),
    }).capturedRuntimeSessionId, 'captured-after-dispatch');
    assert.equal(control.identity(areaId).runtimeSessionId, 'captured-after-dispatch');
    assert.equal(control.reconcileRuntimeLaunch({ reservationId: captured.id, proof: stoppedProof(captured) }).state, 'reconciled-stopped');

    control.reportStatus({
      areaId, state: 'idle', runtime: 'codex', runtimeSessionId: 'registered-provider-id', summary: 'Registered provider persists.',
    });
    const preservingFresh = control.reserveRuntimeLaunch({
      areaId, runtime: 'codex', attemptId: 'preserving-fresh', mode: 'fresh',
    });
    assert.equal(preservingFresh.expectedRuntimeSessionId, 'registered-provider-id');
    assert.equal(control.identity(areaId).runtimeSessionId, 'registered-provider-id');
    assert.equal(control.settleRuntimeLaunch({
      reservationId: preservingFresh.id, attemptId: preservingFresh.attemptId, outcome: 'succeeded',
      evidence: executorEvidence(preservingFresh, 'succeeded'),
    }).capturedRuntimeSessionId, 'registered-provider-id');
    assert.throws(() => control.reserveRuntimeLaunch({
      areaId, runtime: 'codex', attemptId: preservingFresh.attemptId, mode: 'fresh',
    }), (error) => error.code === 'RUNTIME_LAUNCH_ATTEMPT_REPLAYED');

    assert.throws(() => control.reserveRuntimeLaunch({
      areaId, runtime: 'codex', attemptId: 'wrong-resume', mode: 'resume', runtimeSessionId: 'wrong-provider-id',
    }), (error) => error.code === 'RUNTIME_LAUNCH_SESSION_MISMATCH');
    assert.equal(control.identity(areaId).runtimeSessionId, 'registered-provider-id', 'a rejected resume cannot rebind identity state');
    assert.equal(control.identity(areaId).state, 'idle', 'a rejected resume cannot mutate presence state');

    const resumed = control.reserveRuntimeLaunch({
      areaId, runtime: 'codex', attemptId: 'resume-attempt', mode: 'resume', runtimeSessionId: 'registered-provider-id',
    });
    assert.throws(() => control.settleRuntimeLaunch({
      reservationId: resumed.id, attemptId: resumed.attemptId, outcome: 'succeeded',
      runtimeSessionId: 'different-provider-id', evidence: executorEvidence(resumed, 'succeeded'),
    }), (error) => error.code === 'RUNTIME_LAUNCH_SESSION_MISMATCH');
    assert.throws(() => control.settleRuntimeLaunch({
      reservationId: resumed.id, attemptId: 'wrong-attempt', outcome: 'succeeded',
      runtimeSessionId: 'registered-provider-id', evidence: executorEvidence(resumed, 'succeeded'),
    }), (error) => error.code === 'RUNTIME_LAUNCH_ATTEMPT_MISMATCH');
    assert.equal(control.settleRuntimeLaunch({
      reservationId: resumed.id, attemptId: resumed.attemptId, outcome: 'failed',
      runtimeSessionId: 'registered-provider-id', evidence: executorEvidence(resumed, 'failed'),
    }).state, 'failed');
    assert.equal(control.identity(areaId).state, 'offline');
  } finally {
    control.close();
  }
});

test('SCN-runtime-launch-contention: independent contender processes reserve one durable launch token', async () => {
  const { root, env } = fixture();
  const repository = inspectRepository(root);
  const proposal = approvedProposal(repository);
  installProject({ repository, proposal, env, projectId: 'reservation-contention-project' });
  const areaId = 'session-manager';
  const initializer = openControlPlane({ repositoryRoot: root, env });
  initializer.close();
  const workerPath = join(root, 'reservation-contender.mjs');
  const serviceUrl = new URL('../../src/control-plane/service.mjs', import.meta.url).href;
  writeFileSync(workerPath, `
    import { openControlPlane } from ${JSON.stringify(serviceUrl)};
    process.on('message', (input) => {
      const control = openControlPlane({ repositoryRoot: input.root, env: input.env });
      let result;
      try {
        result = { ok: true, reservation: control.reserveRuntimeLaunch({
          areaId: input.areaId, runtime: 'codex', attemptId: input.attemptId, mode: 'fresh',
        }).id };
      } catch (error) {
        result = { ok: false, code: error.code };
      } finally {
        control.close();
      }
      process.send(result, () => process.disconnect());
    });
    process.send({ ready: true });
  `);

  const contender = (attemptId) => {
    const child = fork(workerPath, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    let resolveReady;
    let resolveResult;
    const ready = new Promise((resolve) => { resolveReady = resolve; });
    const result = new Promise((resolve, reject) => {
      resolveResult = resolve;
      child.once('error', reject);
      child.on('exit', (code) => {
        if (code !== 0) reject(new Error(`reservation contender exited ${code}`));
      });
    });
    child.on('message', (message) => {
      if (message.ready) resolveReady();
      else resolveResult(message);
    });
    return { child, ready, result, input: { root, env, areaId, attemptId } };
  };

  const first = contender('manual-dispatch-attempt');
  const second = contender('scheduled-dispatch-attempt');
  await Promise.all([first.ready, second.ready]);
  first.child.send(first.input);
  second.child.send(second.input);
  const outcomes = await Promise.all([first.result, second.result]);
  assert.equal(outcomes.filter((outcome) => outcome.ok).length, 1, 'exactly one process may reserve the identity');
  assert.deepEqual(outcomes.filter((outcome) => !outcome.ok).map((outcome) => outcome.code), ['RUNTIME_LAUNCH_ALREADY_RESERVED']);
  const control = openControlPlane({ repositoryRoot: root, env });
  try {
    const reservations = control.runtimeLaunchReservations({ areaId });
    assert.equal(reservations.length, 1);
    assert.equal(reservations[0].state, 'starting');
  } finally {
    control.close();
  }
});

test('SCN-runtime-launch-schema-compatibility: reservation state migrates forward and rejects engine downgrades', () => {
  const { root, env } = fixture();
  const repository = inspectRepository(root);
  const installed = installProject({ repository, proposal: approvedProposal(repository), env, projectId: 'reservation-schema-project' });
  const databasePath = join(installed.stateRoot, 'state.db');
  const initial = openControlPlane({ repositoryRoot: root, env });
  initial.close();
  const database = new DatabaseSync(databasePath);
  try {
    assert.equal(database.prepare('PRAGMA user_version').get().user_version, 3);
    database.exec('DROP TABLE runtime_launch_reservations; PRAGMA user_version = 2;');
  } finally {
    database.close();
  }
  const migrated = openControlPlane({ repositoryRoot: root, env });
  migrated.close();
  const downgraded = new DatabaseSync(databasePath);
  try {
    downgraded.exec('PRAGMA user_version = 2;');
  } finally {
    downgraded.close();
  }
  assert.throws(
    () => openControlPlane({ repositoryRoot: root, env }),
    (error) => error.code === 'CONTROL_PLANE_SCHEMA_DOWNGRADE_DETECTED',
  );
  const newer = new DatabaseSync(databasePath);
  try {
    newer.exec('PRAGMA user_version = 4;');
  } finally {
    newer.close();
  }
  assert.throws(
    () => openControlPlane({ repositoryRoot: root, env }),
    (error) => error.code === 'CONTROL_PLANE_SCHEMA_NEWER_THAN_ENGINE',
  );
});

test('SCN-existing-repository-preservation: install and purge preserve history, branches, config, and untracked files', () => {
  const { root, env } = fixture();
  const externalEnv = { ...env, XDG_DATA_HOME: mkdtempSync(join(tmpdir(), 'torch-existing-repo-state-')) };
  writeFileSync(join(root, '.projectrc'), 'owner-setting=true\n');
  execFileSync('git', ['-C', root, 'add', '.projectrc']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'owner configuration']);
  execFileSync('git', ['-C', root, 'branch', 'owner/long-lived']);
  writeFileSync(join(root, 'owner-notes.txt'), 'untracked owner data\n');
  const historyBefore = execFileSync('git', ['-C', root, 'rev-list', '--all', '--format=%H'], { encoding: 'utf8' });
  const branchesBefore = execFileSync('git', ['-C', root, 'for-each-ref', '--format=%(refname)', 'refs/heads'], { encoding: 'utf8' });
  const repository = inspectRepository(root);
  installProject({
    repository, proposal: approvedProposal(repository), env: externalEnv, projectId: 'existing-repository',
  });
  const purged = uninstallProject({ repository: inspectRepository(root), purge: true, env: externalEnv });
  assert.equal(purged.mutationPerformed, true);
  assert.equal(readFileSync(join(root, '.projectrc'), 'utf8'), 'owner-setting=true\n');
  assert.equal(readFileSync(join(root, 'owner-notes.txt'), 'utf8'), 'untracked owner data\n');
  assert.equal(execFileSync('git', ['-C', root, 'rev-list', '--all', '--format=%H'], { encoding: 'utf8' }), historyBefore);
  assert.equal(execFileSync('git', ['-C', root, 'for-each-ref', '--format=%(refname)', 'refs/heads'], { encoding: 'utf8' }), branchesBefore);
});

test('SCN-install-trackability: ignored tracked state is refused and pre-existing .torch content survives reversal', () => {
  const ignored = fixture();
  writeFileSync(join(ignored.root, '.gitignore'), '.torch/\n');
  execFileSync('git', ['-C', ignored.root, 'add', '.gitignore']);
  execFileSync('git', ['-C', ignored.root, 'commit', '-m', 'ignore torch']);
  const ignoredRepository = inspectRepository(ignored.root);
  const ignoredProposal = approvedProposal(ignoredRepository);
  const ignoredPlan = planInstall({ repository: ignoredRepository, proposal: ignoredProposal, env: ignored.env });
  assert.equal(ignoredPlan.canProceed, false);
  assert.equal(ignoredPlan.blockers[0].code, 'TRACKED_STATE_IGNORED');
  assert.throws(
    () => installProject({ repository: ignoredRepository, proposal: ignoredProposal, env: ignored.env }),
    (error) => error.code === 'TRACKED_STATE_IGNORED',
  );
  assert.equal(existsSync(join(ignored.root, '.torch')), false);

  const overlay = fixture();
  const history = join(overlay.root, '.torch', 'prompt-history');
  mkdirSync(history, { recursive: true });
  writeFileSync(join(history, 'owner-note.md'), 'preserve this history\n');
  const overlayRepository = inspectRepository(overlay.root);
  installProject({
    repository: overlayRepository,
    proposal: approvedProposal(overlayRepository),
    env: overlay.env,
    projectId: 'overlay-project',
  });
  assert.equal(existsSync(join(overlay.root, '.torch', 'torch.yaml')), true);
  uninstallProject({ repository: inspectRepository(overlay.root), purge: true, env: overlay.env });
  assert.equal(readFileSync(join(history, 'owner-note.md'), 'utf8'), 'preserve this history\n');
  assert.equal(existsSync(join(overlay.root, '.torch', 'torch.yaml')), false);
});

test('SCN-purge-protects-user-change: uninstall refuses to delete modified managed files', () => {
  const { root, env } = fixture();
  const repository = inspectRepository(root);
  installProject({ repository, proposal: approvedProposal(repository), env, projectId: 'modified-project' });
  const configPath = join(root, '.torch', 'torch.yaml');
  writeFileSync(configPath, `${readFileSync(configPath, 'utf8')}\n# owner change\n`);

  assert.throws(
    () => uninstallProject({ repository: inspectRepository(root), purge: true, env }),
    (error) => error.code === 'UNSAFE_TO_PURGE'
      && error.details.some((problem) => problem.type === 'modified' && problem.path === '.torch/torch.yaml'),
  );
  assert.equal(existsSync(configPath), true);
});

test('SCN-purge-protects-local-identity: uninstall refuses mismatched machine-local metadata', () => {
  const { root, env } = fixture();
  const repository = inspectRepository(root);
  const installed = installProject({
    repository, proposal: approvedProposal(repository), env, projectId: 'expected-project',
  });
  const metadataPath = join(installed.stateRoot, 'project.json');
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
  writeFileSync(metadataPath, `${JSON.stringify({ ...metadata, projectId: 'different-project' }, null, 2)}\n`);

  const plan = planUninstall({ repository: inspectRepository(root), purge: true, env });
  assert.equal(plan.canProceed, false);
  assert.equal(plan.problems.some((problem) => problem.type === 'local-state-project-mismatch'), true);
  assert.throws(
    () => uninstallProject({ repository: inspectRepository(root), purge: true, env }),
    (error) => error.code === 'UNSAFE_TO_PURGE',
  );
  assert.equal(existsSync(installed.stateRoot), true);
});

test('SCN-domain-approval: installation rejects stale or unapproved organizational proposals', () => {
  const { root, env } = fixture();
  const repository = inspectRepository(root);
  const pending = proposeDomains({ repository, analysis: analyzeRepository(repository) });
  assert.throws(
    () => installProject({ repository, proposal: pending, env }),
    (error) => error.code === 'PROPOSAL_NOT_APPROVED'
      && error.details.includes('proposal review status is not approved'),
  );
  pending.review.status = 'approved';
  pending.repository.head = '0000000000000000000000000000000000000000';
  assert.throws(
    () => validateApprovedProposal({ proposal: pending, repository }),
    (error) => error.details.includes('proposal is stale because HEAD changed'),
  );
  assert.equal(existsSync(join(root, '.torch')), false);
});

test('SCN-install-runtime-selection: approved runtime choices are explicit and cover every identity', () => {
  const { root, env } = fixture();
  const repository = inspectRepository(root);
  const proposal = approvedProposal(repository);
  assert.deepEqual(planInstall({ repository, proposal, env, runtimes: ['claude'] }).runtimes, ['claude']);
  proposal.domains[0].runtime = 'codex';
  assert.throws(
    () => planInstall({ repository, proposal, env, runtimes: ['claude'] }),
    (error) => error.code === 'INSTALL_RUNTIME_MISSING' && error.details.missing.includes('codex'),
  );
  assert.throws(
    () => planInstall({ repository, proposal, env, runtimes: ['unknown'] }),
    (error) => error.code === 'INSTALL_RUNTIME_INVALID',
  );
  const installed = installProject({
    repository, proposal, env, projectId: 'runtime-selection', runtimes: ['claude', 'codex'],
  });
  assert.equal(installed.mutationPerformed, true);
  const config = JSON.parse(readFileSync(join(root, '.torch', 'torch.yaml'), 'utf8'));
  assert.deepEqual(Object.keys(config.runtimes).sort(), ['claude', 'codex', 'default']);
});

test('SCN-install-provider-inheritance: generated roles inherit the selected provider and explicit mixed assignments survive', () => {
  const { root, env } = fixture();
  const repository = inspectRepository(root);
  const proposal = approvedProposal(repository);
  assert.ok(proposal.domains.every((domain) => domain.runtime === 'default'));
  const plan = planInstall({ repository, proposal, env, runtimes: ['codex'] });
  assert.equal(plan.defaultRuntime, 'codex');
  assert.deepEqual(plan.runtimes, ['codex']);
  assert.equal(plan.mutationPerformed, false);
  assert.equal(existsSync(join(root, '.torch')), false);
  installProject({ repository, proposal, env, runtimes: ['codex'], projectId: 'codex-only' });
  const config = JSON.parse(readFileSync(join(root, '.torch', 'torch.yaml'), 'utf8'));
  assert.equal(config.runtimes.default, 'codex');
  assert.equal(config.session_manager.runtime, 'codex');
  assert.ok(config.domains.every((domain) => domain.runtime === 'codex'));
  assert.equal(config.runtimes.codex.model, 'gpt-6-luna');
  assert.equal(config.runtimes.codex.reasoning, 'high');

  const mixed = fixture();
  const mixedRepo = inspectRepository(mixed.root);
  const mixedProposal = approvedProposal(mixedRepo);
  mixedProposal.domains[0].runtime = 'claude';
  installProject({ repository: mixedRepo, proposal: mixedProposal, env: mixed.env,
    runtimes: ['claude', 'codex'], defaultRuntime: 'codex', projectId: 'mixed-selection' });
  const mixedConfig = JSON.parse(readFileSync(join(mixed.root, '.torch', 'torch.yaml'), 'utf8'));
  assert.equal(mixedConfig.runtimes.default, 'codex');
  assert.equal(mixedConfig.session_manager.runtime, 'codex');
  assert.equal(mixedConfig.domains[0].runtime, 'claude');
  assert.equal(mixedConfig.runtimes.claude.model, 'sonnet');
});

test('SCN-canonical-reversal: owned local canonical state reverses only after unique commits are safe', () => {
  const { root, env } = fixture();
  const externalEnv = { ...env, XDG_DATA_HOME: mkdtempSync(join(tmpdir(), 'torch-canonical-reversal-state-')) };
  let repository = inspectRepository(root);
  const installed = installProject({
    repository, proposal: approvedProposal(repository), env: externalEnv, projectId: 'canonical-reversal',
  });
  execFileSync('git', ['-C', root, 'add', '.torch']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'install torch']);
  const canonical = createLocalCanonical({ repositoryRoot: root });
  const manifest = JSON.parse(readFileSync(join(root, '.torch', 'install-manifest.json'), 'utf8'));
  assert.equal(manifest.external.some((entry) =>
    entry.type === 'canonical-remote' && entry.remote === 'torch-canonical' && entry.path === canonical.path), true);

  const tree = execFileSync('git', ['--git-dir', canonical.path, 'mktree'], {
    input: '', encoding: 'utf8',
  }).trim();
  const uniqueCommit = execFileSync('git', [
    '--git-dir', canonical.path,
    '-c', 'user.name=TORCH Test', '-c', 'user.email=torch@example.invalid',
    'commit-tree', tree, '-m', 'remote-only',
  ], { encoding: 'utf8' }).trim();
  execFileSync('git', ['--git-dir', canonical.path, 'update-ref', 'refs/heads/remote-only', uniqueCommit]);
  repository = inspectRepository(root);
  assert.equal(planUninstall({ repository, purge: true, env: externalEnv }).problems.some((problem) =>
    problem.type === 'canonical-unique-commit' && problem.commit === uniqueCommit), true);
  assert.throws(
    () => uninstallProject({ repository, purge: true, env: externalEnv }),
    (error) => error.code === 'UNSAFE_TO_PURGE',
  );

  execFileSync('git', ['--git-dir', canonical.path, 'update-ref', '-d', 'refs/heads/remote-only']);
  const purged = uninstallProject({ repository: inspectRepository(root), purge: true, env: externalEnv });
  assert.equal(purged.mutationPerformed, true);
  assert.equal(existsSync(installed.stateRoot), false);
  assert.equal(execFileSync('git', ['-C', root, 'remote'], { encoding: 'utf8' }).includes('torch-canonical'), false);
});

test('SCN-config-schema: installed configuration is strict, versioned, and migration-aware', () => {
  const { root, env } = fixture();
  const repository = inspectRepository(root);
  installProject({ repository, proposal: approvedProposal(repository), env, projectId: 'schema-project' });
  const config = JSON.parse(readFileSync(join(root, '.torch', 'torch.yaml'), 'utf8'));

  assert.equal(validateProjectConfig(config), config);
  assert.deepEqual(planProjectConfigMigration(config), {
    from: PROJECT_CONFIG_SCHEMA, to: PROJECT_CONFIG_SCHEMA,
    steps: [], canProceed: true, changed: false, mutationPerformed: false,
  });

  assert.throws(
    () => validateProjectConfig({ ...config, schema: 'torch.dev/v2' }),
    (error) => error.code === 'CONFIG_SCHEMA_UNSUPPORTED'
      && error.details.supported.includes(PROJECT_CONFIG_SCHEMA),
  );
  assert.throws(
    () => validateProjectConfig({ ...config, future_required_policy: true }),
    (error) => error.code === 'CONFIG_SCHEMA_INVALID'
      && error.details.some((issue) => issue.path === '<root>' && issue.code === 'unrecognized_keys'),
  );
  assert.throws(
    () => validateProjectConfig({ ...config, git: { ...config.git, allow_rebase: true } }),
    (error) => error.code === 'CONFIG_SCHEMA_INVALID'
      && error.details.some((issue) => issue.path === 'git.allow_rebase'),
  );
  assert.equal(planProjectConfigMigration({ schema: 'torch.dev/v2' }).canProceed, false);
});
