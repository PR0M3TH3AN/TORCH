import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    env: { ...process.env, XDG_DATA_HOME: join(root, '.data') },
    encoding: 'utf8',
  });
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
