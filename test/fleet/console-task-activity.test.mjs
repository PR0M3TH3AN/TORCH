import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { observeBacklogActivity } from '../../src/observability/snapshot.mjs';
import '../../site/task-activity.js';

test('SCN-console-task-activity: managed Git observations distinguish stale owner requests from incomplete history without mutations', () => {
  const root = mkdtempSync(join(tmpdir(), 'torch-console-activity-'));
  const git = (args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_DATE: '2026-09-20T00:00:00Z', GIT_COMMITTER_DATE: '2026-09-20T00:00:00Z' } }).trim();
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 'test@example.invalid']);
  git(['config', 'user.name', 'Test']);
  writeFileSync(join(root, 'source.js'), 'export const value=1;');
  git(['add', '.']);
  git(['commit', '-m', 'Initial source']);
  const head = git(['rev-parse', 'HEAD']);
  const tasks = [{ id: 'TASK-other', title: 'Implementation', state: 'ready', createdAt: '2026-09-21', history: [{ actorId: 'session-manager' }] },
    { id: 'TASK-owner', title: '<img src=x>', state: 'blocked', createdAt: '2026-09-21', updatedAt: '2026-09-30', history: [{ actorId: 'owner' }] }];
  const input = { repositoryRoot: root, tasks, config: { project: { main_branch: 'main' } },
    manifest: { external: [] }, now: new Date('2026-09-30T00:00:00Z') };
  const before = JSON.stringify(tasks);
  const full = observeBacklogActivity(input);
  assert.equal(full.available, true);
  assert.equal(full.complete, true);
  assert.equal(full.tasks[0].taskId, 'TASK-owner');
  assert.equal(full.tasks[0].status, 'stale');
  assert.equal(full.tasks[0].ageDays, 9, 'metadata edits must not hide neglected work');
  const html = globalThis.TorchTaskActivity.render(full);
  assert.ok(html.indexOf('TASK-owner') < html.indexOf('TASK-other'));
  assert.match(html, /waiting may be expected/);
  assert.match(html, /&lt;img src=x&gt;/);
  assert.doesNotMatch(html, /<img/);
  const partial = observeBacklogActivity({ ...input, manifest: { external: [{ type: 'worktree', branch: 'missing' }] } });
  assert.equal(partial.complete, false);
  assert.equal(partial.stale.length, 0);
  assert.equal(partial.tasks[0].status, 'unknown');
  assert.match(globalThis.TorchTaskActivity.render(partial), /absence of recent progress is unknown/i);
  const absent = observeBacklogActivity({ ...input, config: { project: { main_branch: 'missing' } } });
  assert.equal(absent.available, false);
  assert.match(globalThis.TorchTaskActivity.render(absent), /No inactivity conclusion/);
  assert.equal(JSON.stringify(tasks), before);
  assert.equal(git(['rev-parse', 'HEAD']), head);
  assert.equal(git(['status', '--porcelain']), '');
});

test('SCN-console-task-activity: bounded display and commit closure intent never mutate work or imply completion', () => {
  const input = { available: true, complete: false, truncated: true, unavailableBranches: ['<script>'], futureCommits: ['future'],
    tasks: Array.from({ length: 41 }, (_, index) => ({ taskId: `TASK-${index}`, title: 'Review', status: 'unknown',
      ageDays: null, ownerRequested: false, closureIntent: ['abc'] })) };
  const before = JSON.stringify(input);
  const html = globalThis.TorchTaskActivity.render(input);
  assert.match(html, /Showing 40 of 41/);
  assert.match(html, /only verified landing can close/);
  assert.match(html, /Future-dated commits excluded/);
  assert.doesNotMatch(html, /<script>/);
  assert.equal(JSON.stringify(input), before);
});
