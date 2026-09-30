import assert from 'node:assert/strict';
import test from 'node:test';
import '../../site/work-progress.js';

const { summarizeInitiatives } = globalThis.TorchWorkProgress;

test('SCN-console-initiative-rollups: feature and milestone progress derives from the same task states', () => {
  const tasks = [
    { id: 'TASK-1', title: 'Define terrain', feature: 'World pipeline', milestone: 'Alpha', state: 'completed' },
    { id: 'TASK-2', title: 'Build traversal', feature: 'World pipeline', milestone: 'Alpha', state: 'blocked' },
    { id: 'TASK-3', title: 'Drop old prototype', feature: 'World pipeline', milestone: 'Beta', state: 'cancelled' },
    { id: 'TASK-4', title: 'Verify replacement', feature: 'World pipeline', milestone: 'Beta', state: 'completed' },
    { id: 'TASK-5', title: 'Unlinked work', state: 'in_progress' },
  ];
  const rollup = summarizeInitiatives(tasks);
  assert.equal(rollup.features.length, 1);
  assert.deepEqual(rollup.features[0], {
    name: 'World pipeline',
    tasks: tasks.slice(0, 4).map(({ id, title, state }) => ({ id, title, state, owner: null })),
    counts: { completed: 2, cancelled: 1, blocked: 1, working: 0, review: 0, queued: 0, other: 0 },
    active: 3, progress: 67, status: 'At risk',
  });
  assert.deepEqual(rollup.milestones.map((group) => [group.name, group.progress, group.status]), [
    ['Alpha', 50, 'At risk'], ['Beta', 100, 'Complete'],
  ]);
  assert.deepEqual(tasks.map((task) => task.state), ['completed', 'blocked', 'cancelled', 'completed', 'in_progress']);
});

test('SCN-console-initiative-rollups: an unlabeled backlog does not receive inferred feature or milestone names', () => {
  assert.deepEqual(summarizeInitiatives([{ id: 'TASK-1', state: 'ready' }]), { features: [], milestones: [] });
});
