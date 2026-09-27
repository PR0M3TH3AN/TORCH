import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';

const CLI = new URL('../../bin/torch.mjs', import.meta.url).pathname;

function repo() {
  const root = mkdtempSync(join(tmpdir(), 'torch-cli-'));
  execFileSync('git', ['init', '-b', 'main', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'torch-test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'TORCH Test']);
  writeFileSync(join(root, 'README.md'), '# Fixture\n');
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'fixture']);
  return root;
}

function run(root, args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: root,
    env: { ...process.env, XDG_DATA_HOME: join(tmpdir(), `${basename(root)}-data`) },
    encoding: 'utf8',
  });
}

function releaseCandidate(root, version) {
  const candidateRoot = join(root, `release-${version}`);
  mkdirSync(join(candidateRoot, 'bin'), { recursive: true });
  writeFileSync(join(candidateRoot, 'bin', 'torch.mjs'), '#!/usr/bin/env node\n');
  writeFileSync(join(candidateRoot, 'acceptance.mjs'), `console.log(${JSON.stringify([
    'SCN-init-read-only', 'SCN-cli-domain-review', 'SCN-worktree-bootstrap', 'SCN-mixed-runtime',
    'SCN-durable-message', 'SCN-ownership-handoff', 'SCN-worktree-purge-safety',
    'SCN-backlog-lifecycle', 'SCN-native-integration', 'SCN-resource-fifo',
    'SCN-fleet-fresh-resume', 'SCN-install-doctor-purge',
    'SCN-combatrig-import', 'SCN-cli-combatrig-import',
  ].join('\n'))});\n`);
  writeFileSync(join(candidateRoot, 'package.json'), `${JSON.stringify({
    name: 'torch-agent-fleet', version, bin: { torch: 'bin/torch.mjs' },
    scripts: {
      test: 'node acceptance.mjs',
      lint: 'node -e "process.exit(0)"',
      check: 'node -e "process.exit(0)"',
    },
  }, null, 2)}\n`);
  writeFileSync(join(candidateRoot, 'torch-release.json'), `${JSON.stringify({
    schema: 'torch.dev/release/v1alpha1', version,
    state: { reads: ['torch.dev/state/v1alpha1'], writes: 'torch.dev/state/v1alpha1', rollback_safe: true },
  }, null, 2)}\n`);
  return candidateRoot;
}

test('SCN-cli-init: init reports analysis without creating project state', () => {
  const root = repo();
  const result = run(root, ['init', '--json']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.command, 'init');
  assert.equal(output.analysis.mutationPerformed, false);
  assert.equal(existsSync(join(root, '.torch')), false);
});

test('SCN-cli-install-approval: install requires an explicit reviewed approval flag', () => {
  const root = repo();
  const result = run(root, ['install', '--json']);
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).error, 'APPROVAL_REQUIRED');
  assert.equal(existsSync(join(root, '.torch')), false);
});

test('SCN-cli-domain-review: a generated proposal must be approved before install', () => {
  const root = repo();
  const proposalPath = join(root, 'fleet-proposal.json');
  const generated = run(root, ['domains', '--output', proposalPath, '--json']);
  assert.equal(generated.status, 0, generated.stderr || generated.stdout);
  const proposal = JSON.parse(readFileSync(proposalPath, 'utf8'));
  assert.equal(proposal.review.status, 'pending');
  assert.equal(proposal.domains.length > 0, true);

  const rejected = run(root, ['install', '--proposal', proposalPath, '--yes', '--json']);
  assert.equal(rejected.status, 2);
  assert.equal(JSON.parse(rejected.stdout).error, 'PROPOSAL_NOT_APPROVED');
  assert.equal(existsSync(join(root, '.torch')), false);

  proposal.review = {
    status: 'approved', reviewedAt: '2026-09-27T00:00:00Z', reviewedBy: 'fixture-owner', notes: [],
  };
  writeFileSync(proposalPath, `${JSON.stringify(proposal, null, 2)}\n`);
  const installed = run(root, ['install', '--proposal', proposalPath, '--yes', '--json']);
  assert.equal(installed.status, 0, installed.stderr || installed.stdout);
  assert.equal(existsSync(join(root, '.torch', 'domain-proposal.approved.json')), true);
});

test('SCN-cli-control-plane: CLI messages, acknowledgements, ownership, and status share durable state', () => {
  const root = repo();
  const proposalPath = join(root, 'fleet-proposal.json');
  run(root, ['domains', '--output', proposalPath, '--json']);
  const proposal = JSON.parse(readFileSync(proposalPath, 'utf8'));
  proposal.review = {
    status: 'approved', reviewedAt: '2026-09-27T00:00:00Z', reviewedBy: 'fixture-owner', notes: [],
  };
  writeFileSync(proposalPath, `${JSON.stringify(proposal, null, 2)}\n`);
  assert.equal(run(root, ['install', '--proposal', proposalPath, '--yes', '--json']).status, 0);
  const worker = proposal.domains[0].id;

  const sent = run(root, [
    'message', '--from', 'session-manager', '--to', worker, '--body', 'Use the CLI fallback.',
    '--task', 'TASK-CLI', '--json',
  ]);
  assert.equal(sent.status, 0, sent.stderr || sent.stdout);
  const message = JSON.parse(sent.stdout);
  const inbox = JSON.parse(run(root, ['inbox', '--area', worker, '--unacknowledged', '--json']).stdout);
  assert.equal(inbox.messages[0].id, message.id);
  assert.equal(inbox.messages[0].references.task, 'TASK-CLI');
  const acknowledged = run(root, ['ack', '--area', worker, '--message', message.id, '--json']);
  assert.equal(acknowledged.status, 0, acknowledged.stderr || acknowledged.stdout);
  assert.equal(JSON.parse(run(root, ['inbox', '--area', worker, '--unacknowledged', '--json']).stdout).messages.length, 0);
  const status = JSON.parse(run(root, [
    'status', '--area', worker, '--state', 'working', '--summary', 'Running TASK-CLI',
    '--runtime', 'claude', '--session', 'runtime-cli', '--json',
  ]).stdout);
  assert.equal(status.runtimeSessionId, 'runtime-cli');
  const ownership = JSON.parse(run(root, ['who-owns', '--path', 'README.md', '--json']).stdout);
  assert.equal(ownership.owners.length > 0, true);
});

test('SCN-cli-self-host: candidate acceptance, atomic upgrade, and rollback require explicit approval', () => {
  const root = repo();
  const v1 = releaseCandidate(root, '1.0.0');
  const v2 = releaseCandidate(root, '1.1.0');
  const plan = run(root, ['candidate', 'plan', '--source', v1, '--json']);
  assert.equal(plan.status, 0, plan.stderr || plan.stdout);
  assert.equal(JSON.parse(plan.stdout).version, '1.0.0');
  const refused = run(root, ['candidate', 'build', '--source', v1, '--json']);
  assert.equal(JSON.parse(refused.stdout).error, 'APPROVAL_REQUIRED');

  for (const source of [v1, v2]) {
    const built = run(root, ['candidate', 'build', '--source', source, '--yes', '--json']);
    assert.equal(built.status, 0, built.stderr || built.stdout);
    assert.equal(JSON.parse(built.stdout).mutationPerformed, true);
  }
  const before = JSON.parse(run(root, ['candidate', 'status', '--json']).stdout);
  assert.equal(before.activeVersion, null);
  assert.deepEqual(before.installed, ['1.0.0', '1.1.0']);

  assert.equal(run(root, ['upgrade', '--version', '1.0.0', '--dry-run', '--json']).status, 0);
  assert.equal(JSON.parse(run(root, ['upgrade', '--version', '1.0.0', '--json']).stdout).error, 'APPROVAL_REQUIRED');
  assert.equal(run(root, ['upgrade', '--version', '1.0.0', '--yes', '--json']).status, 0);
  assert.equal(run(root, ['upgrade', '--version', '1.1.0', '--yes', '--json']).status, 0);

  const rollbackPlan = JSON.parse(run(root, ['rollback', '--dry-run', '--json']).stdout);
  assert.deepEqual({ from: rollbackPlan.from, to: rollbackPlan.to }, { from: '1.1.0', to: '1.0.0' });
  assert.equal(JSON.parse(run(root, ['rollback', '--json']).stdout).error, 'APPROVAL_REQUIRED');
  const rolledBack = run(root, ['rollback', '--yes', '--json']);
  assert.equal(rolledBack.status, 0, rolledBack.stderr || rolledBack.stdout);
  assert.equal(JSON.parse(rolledBack.stdout).activeVersion, '1.0.0');
});

test('SCN-cli-backlog: public commands create, transition, assign, and list tracked work', () => {
  const root = repo();
  const proposalPath = join(root, 'fleet-proposal.json');
  run(root, ['domains', '--output', proposalPath, '--json']);
  const proposal = JSON.parse(readFileSync(proposalPath, 'utf8'));
  proposal.review = {
    status: 'approved', reviewedAt: '2026-09-27T00:00:00Z', reviewedBy: 'fixture-owner', notes: [],
  };
  writeFileSync(proposalPath, `${JSON.stringify(proposal, null, 2)}\n`);
  assert.equal(run(root, ['install', '--proposal', proposalPath, '--yes', '--json']).status, 0);
  execFileSync('git', ['-C', root, 'add', '.torch', 'fleet-proposal.json']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'install torch']);
  const worktreeParent = join(tmpdir(), `${basename(root)}-worktrees`);
  const worktrees = run(root, ['worktrees', '--parent', worktreeParent, '--yes', '--json']);
  assert.equal(worktrees.status, 0, worktrees.stderr || worktrees.stdout);

  const created = run(root, [
    'backlog', 'create', '--area', 'session-manager', '--title', 'CLI task',
    '--description', 'Exercise public lifecycle.', '--accept', 'Assigned to owner',
    '--domains', proposal.domains[0].id, '--json',
  ]);
  assert.equal(created.status, 0, created.stderr || created.stdout);
  let task = JSON.parse(created.stdout);
  for (const transition of [
    ['ready'],
    ['assigned', '--owner', proposal.domains[0].id],
  ]) {
    const result = run(root, [
      'backlog', 'transition', '--task', task.id, '--area', 'session-manager',
      '--state', ...transition, '--revision', String(task.revision), '--json',
    ]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    task = JSON.parse(result.stdout);
  }
  assert.equal(task.state, 'assigned');
  assert.equal(task.owner, proposal.domains[0].id);
  const listed = JSON.parse(run(root, ['backlog', 'list', '--state', 'assigned', '--json']).stdout);
  assert.equal(listed.tasks[0].id, task.id);
});
