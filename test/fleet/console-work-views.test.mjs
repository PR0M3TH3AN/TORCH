import assert from 'node:assert/strict';
import test from 'node:test';
import '../../site/work-views.js';

const views = globalThis.TorchWorkViews;

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    values,
  };
}

const tasks = [
  {
    id: 'NAV-4', title: 'Clear blocked doorway', description: 'Doorway occupancy fails in compounds.',
    owner: 'navigation', state: 'blocked', priority: 'urgent', affectedDomains: ['runtime', 'world'],
    feature: 'World pipeline', milestone: 'Alpha',
  },
  {
    id: 'WORLD-8', title: 'Review facade evidence', description: 'Screenshots are ready for review.',
    owner: 'world', state: 'verification', priority: 'normal', affectedDomains: ['world'],
  },
  {
    id: 'NAV-2', title: 'Document route cache', description: 'Explain cache invalidation.',
    owner: 'navigation', state: 'completed', priority: 'low', affectedDomains: ['runtime'],
  },
];

test('SCN-console-saved-views: dynamic project filters narrow the authoritative backlog without changing task records', () => {
  const filtered = views.filterTasks(tasks, {
    query: 'DOORWAY', owner: 'navigation', state: 'blocked', priority: 'urgent', domain: 'world',
    feature: 'World pipeline', milestone: 'Alpha',
  });
  assert.deepEqual(filtered.map((task) => task.id), ['NAV-4']);
  assert.deepEqual(views.filterTasks(tasks, { owner: 'navigation' }).map((task) => task.id), ['NAV-4']);
  assert.equal(views.hasFilters({ query: ' x ' }), true);
  assert.equal(views.hasFilters({}), false);
  assert.equal(views.normalizeFilters({ query: 'x'.repeat(500) }).query.length, 120);
  assert.equal(views.storageKey('project-a'), views.storageKey('project-a'));
  assert.notEqual(views.storageKey('project-a'), views.storageKey('project-b'));
  assert.deepEqual(tasks.map((task) => task.state), ['blocked', 'verification', 'completed']);
});

test('SCN-console-saved-views: save, update, reload, and delete are project-local browser preferences', () => {
  const store = storage();
  const key = views.storageKey('project-a');
  const now = () => new Date('2026-09-28T12:00:00.000Z');
  const created = views.saveView({
    storage: store, key, name: 'World at risk',
    filters: { domain: 'world', priority: 'urgent' }, now,
  });
  assert.equal(created.ok, true);
  assert.deepEqual(created.view.filters, {
    query: '', owner: '', state: '', priority: 'urgent', domain: 'world', feature: '', milestone: '',
  });
  assert.equal(created.view.updatedAt, '2026-09-28T12:00:00.000Z');
  assert.equal(views.saveView({
    storage: store, key, views: created.views, name: 'world at risk', filters: {}, now,
  }).code, 'VIEW_NAME_EXISTS');

  const updated = views.saveView({
    storage: store, key, views: created.views, id: created.view.id,
    name: 'World verification', filters: { state: 'verification' }, now,
  });
  assert.equal(updated.ok, true);
  const reloaded = views.readSavedViews(store, key);
  assert.equal(reloaded.warning, null);
  assert.equal(reloaded.views[0].name, 'World verification');
  assert.equal(reloaded.views[0].filters.state, 'verification');
  const deleted = views.deleteView({ storage: store, key, views: reloaded.views, id: created.view.id });
  assert.equal(deleted.ok, true);
  assert.deepEqual(views.readSavedViews(store, key).views, []);
});

test('SCN-console-saved-views: malformed storage and quota failures fail closed without touching project state', () => {
  const key = views.storageKey('project-safe');
  const malformed = storage({ [key]: '{not-json' });
  assert.equal(views.readSavedViews(malformed, key).views.length, 0);
  assert.match(views.readSavedViews(malformed, key).warning, /unavailable/);
  const partial = storage({ [key]: JSON.stringify({
    schema: views.schema,
    views: [
      { id: 'ok', name: 'Safe', filters: {} },
      { id: 'bad', name: 'Invalid', filters: { owner: ['not', 'text'] } },
    ],
  }) });
  const refused = views.readSavedViews(partial, key);
  assert.deepEqual(refused.views, [], 'one malformed entry refuses the entire preference set');
  assert.match(refused.warning, /invalid data/);
  const unavailable = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
  const failed = views.saveView({ storage: unavailable, key, name: 'My view', filters: {} });
  assert.equal(failed.ok, false);
  assert.equal(failed.code, 'VIEW_STORAGE_UNAVAILABLE');
  assert.match(failed.message, /backlog was not changed/);
  assert.equal(views.saveView({ storage: unavailable, key, name: ' ', filters: {} }).code, 'VIEW_NAME_REQUIRED');
});
