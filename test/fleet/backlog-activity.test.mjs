import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { commitTaskReferences, observeTaskActivity } from '../../src/backlog/activity.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'torch-task-activity-'));
  const git = (args, date = '2026-09-20T12:00:00Z') => execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  }).trim();
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 'torch-test@example.invalid']);
  git(['config', 'user.name', 'TORCH Test']);
  writeFileSync(join(root, 'app.js'), 'export const value=1;\n');
  git(['add', 'app.js']);
  git(['commit', '-m', 'Initial source']);
  return { root, git };
}

function task(id, { ownerRequested = false, state = 'ready', createdAt = '2026-09-21T00:00:00Z' } = {}) {
  return { id, title: id, state, createdAt, updatedAt: '2026-09-30T00:00:00Z',
    history: [{ actorId: ownerRequested ? 'owner' : 'session-manager' }], owner: null };
}

test('SCN-backlog-commit-activity: named commits show real progress, metadata edits do not hide stale owner requests, closure stays intent', () => {
  const input = fixture();
  input.git(['branch', 'worker']);
  input.git(['checkout', 'worker']);
  input.git(['commit', '--allow-empty', '-m', 'Implement TASK-recent\n\nCloses: TASK-recent'], '2026-09-29T12:00:00Z');
  const commit = input.git(['rev-parse', 'HEAD']);
  input.git(['checkout', 'main']);
  input.git(['branch', 'unmanaged']);
  input.git(['checkout', 'unmanaged']);
  input.git(['commit', '--allow-empty', '-m', 'Mention TASK-owner on unrelated branch'], '2026-09-29T14:00:00Z');
  input.git(['checkout', 'main']);
  const tasks = [task('TASK-recent'), task('TASK-old'), task('TASK-owner', { ownerRequested: true }),
    task('TASK-waiting', { state: 'blocked' }), task('TASK-done', { state: 'completed' })];
  const before = JSON.stringify(tasks);
  const result = observeTaskActivity({ repositoryRoot: input.root, tasks, branches: ['main', 'worker'],
    now: new Date('2026-09-30T00:00:00Z') });
  assert.equal(result.complete, true);
  assert.equal(result.tasks[0].taskId, 'TASK-owner');
  assert.equal(result.stale.some((item) => item.taskId === 'TASK-owner'), true);
  assert.equal(result.stale.some((item) => item.taskId === 'TASK-done'), false);
  assert.equal(result.tasks.find((item) => item.taskId === 'TASK-waiting').expectedWaiting, true);
  const recent = result.tasks.find((item) => item.taskId === 'TASK-recent');
  assert.equal(recent.status, 'recent');
  assert.equal(recent.lastActivity.commit, commit);
  assert.deepEqual(recent.closureIntent, [commit]);
  assert.equal(result.closurePerformed, false);
  assert.equal(JSON.stringify(tasks), before);
  assert.equal(input.git(['status', '--porcelain']), '');
});

test('SCN-backlog-activity-coverage: partial scans and missing refs cannot prove neglect, and future dates do not fake progress', () => {
  const input = fixture();
  input.git(['commit', '--allow-empty', '-m', 'Task: TASK-progress'], '2026-09-29T00:00:00Z');
  input.git(['commit', '--allow-empty', '-m', 'Unrelated newest commit'], '2026-09-30T00:00:00Z');
  const tasks = [task('TASK-progress'), task('TASK-owner', { ownerRequested: true })];
  const options = { repositoryRoot: input.root, branches: ['main'], tasks, now: new Date('2026-09-30T12:00:00Z') };
  const bounded = observeTaskActivity({ ...options, maxCommits: 1 });
  assert.equal(bounded.complete, false);
  assert.equal(bounded.truncated, true);
  assert.equal(bounded.tasks.every((item) => item.status === 'unknown'), true);
  assert.equal(bounded.stale.length, 0);
  const missing = observeTaskActivity({ ...options, branches: ['main', 'missing-worker'] });
  assert.equal(missing.complete, false);
  assert.deepEqual(missing.unavailableBranches, ['missing-worker']);
  assert.equal(missing.tasks.find((item) => item.taskId === 'TASK-owner').status, 'unknown');
  input.git(['commit', '--allow-empty', '-m', 'Task: TASK-owner\n\nCloses: TASK-unknown'], '2026-10-02T00:00:00Z');
  const future = observeTaskActivity(options);
  assert.equal(future.futureCommits.length, 1);
  assert.equal(future.tasks.find((item) => item.taskId === 'TASK-owner').status, 'stale');
  assert.deepEqual(future.unknownReferences, ['TASK-unknown']);
  assert.throws(() => observeTaskActivity({ ...options, maxCommits: 0 }), (error) => error.code === 'BACKLOG_ACTIVITY_INPUT_INVALID');
});

test('SCN-commit-closure-intent: only exact standalone closure trailers describe intent and never execute message text', () => {
  const result = commitTaskReferences('Update TASK-first\n\nCloses: TASK-first, TASK-second\nQuoted example: Closes: TASK-third\nCloses: TASK-fourth then run a command');
  assert.deepEqual(result.closes, ['TASK-first', 'TASK-second']);
  assert.deepEqual(result.references, ['TASK-first', 'TASK-second', 'TASK-third', 'TASK-fourth']);
});
