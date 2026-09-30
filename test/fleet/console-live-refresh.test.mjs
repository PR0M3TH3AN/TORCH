import assert from 'node:assert/strict';
import test from 'node:test';
import '../../site/live-refresh.js';

test('SCN-console-live-refresh: requests are single-flight, explicit newer requests supersede stale responses and background ticks do not starve progress', async () => {
  const pending = [];
  const applied = [];
  const errors = [];
  const scheduler = globalThis.TorchLiveRefresh.createScheduler({
    load: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
    apply: (snapshot) => applied.push(snapshot), onError: (error) => errors.push(error.message),
  });
  const first = scheduler.request();
  assert.equal(scheduler.request({ supersede: false }), first);
  assert.equal(pending.length, 1);
  assert.equal(scheduler.request(), first);
  pending[0].resolve('old');
  await Promise.resolve();
  assert.deepEqual(applied, []);
  assert.equal(pending.length, 2);
  scheduler.request({ supersede: false });
  pending[1].resolve('new');
  await first;
  assert.deepEqual(applied, ['new']);
  const failed = scheduler.request();
  pending[2].reject(new Error('offline'));
  await failed;
  assert.deepEqual(applied, ['new'], 'a failed read must retain displayed evidence');
  assert.deepEqual(errors, ['offline']);
  const recovered = scheduler.request();
  pending[3].resolve('recovered');
  await recovered;
  assert.deepEqual(applied, ['new', 'recovered']);
});
