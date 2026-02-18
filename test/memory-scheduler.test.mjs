import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

import {
  createDbAdvisoryLockProvider,
  startMemoryMaintenanceScheduler,
} from '../src/services/memory/scheduler.js';

test('createDbAdvisoryLockProvider acquires and releases postgres advisory locks', async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('pg_try_advisory_lock')) {
        return { rows: [{ locked: true }] };
      }
      return { rows: [] };
    },
  };

  const lockProvider = createDbAdvisoryLockProvider(db, { namespace: 'tests' });
  const result = await lockProvider.withLock('job', async () => 42);

  assert.equal(result.acquired, true);
  assert.equal(result.result, 42);
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /pg_try_advisory_lock/);
  assert.match(calls[1].sql, /pg_advisory_unlock/);
  assert.deepEqual(calls[0].params, calls[1].params);
});

test('startMemoryMaintenanceScheduler runs all jobs and emits metrics including retries', async () => {
  mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'] });

  const metrics = [];
  let ingestAttempts = 0;

  const scheduler = startMemoryMaintenanceScheduler({
    runImmediately: true,
    maxRetries: 2,
    retryDelayMs: 1,
    random: () => 0,
    emitMetric(name, payload) {
      metrics.push({ name, payload });
    },
    lockProvider: {
      async withLock(key, task) {
        if (key.includes('consolidate-observations')) {
          return { acquired: false, result: null };
        }
        return { acquired: true, result: await task() };
      },
    },
    handlers: {
      async ingestRecentRuntimeEvents() {
        ingestAttempts += 1;
        if (ingestAttempts === 1) {
          throw new Error('transient');
        }
        return { itemCount: 3 };
      },
      async consolidateObservations() {
        return { itemCount: 11 };
      },
      async pruningCycle() {
        return { itemCount: 2 };
      },
      async deepMergeArchivalMaintenance() {
        return { itemCount: 1 };
      },
    },
  });

  // Advance time to allow async jobs and retries to complete.
  // We tick enough to cover the retryDelayMs (1ms).
  // We also need to allow the promise microtask queue to drain between ticks
  // if necessary, but tick() usually handles the timer callbacks.
  // Since the scheduler logic uses await, we need to ensure those promises resolve.

  // Tick time forward and yield to event loop to allow promise chains to progress.
  // The job involves multiple async steps (lock, handler, retry wait, lock, handler).
  // We tick multiple times to ensure the retry timer fires and subsequent microtasks run.
  for (let i = 0; i < 10; i++) {
    mock.timers.tick(5);
    await new Promise((resolve) => setImmediate(resolve));
  }

  scheduler.stop();
  mock.timers.reset();

  const byJob = metrics.reduce((acc, entry) => {
    const key = entry.payload.job;
    acc[key] = acc[key] || [];
    acc[key].push(entry);
    return acc;
  }, {});

  assert.equal(byJob.ingestRecentRuntimeEvents?.length, 1, 'Expected 1 ingest metric');
  assert.equal(byJob.ingestRecentRuntimeEvents[0].payload.status, 'success');
  assert.equal(byJob.ingestRecentRuntimeEvents[0].payload.itemCount, 3);
  assert.equal(byJob.ingestRecentRuntimeEvents[0].payload.retries, 1);

  assert.equal(byJob.consolidateObservations[0].payload.status, 'skipped_lock_unavailable');
  assert.equal(byJob.pruningCycle[0].payload.status, 'success');
  assert.equal(byJob.deepMergeArchivalMaintenance[0].payload.status, 'success');
});


test('startMemoryMaintenanceScheduler skips jobs when feature flags disable memory', async () => {
  mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'] });

  const metrics = [];
  const called = [];

  const scheduler = startMemoryMaintenanceScheduler({
    runImmediately: true,
    env: { TORCH_MEMORY_ENABLED: 'false' },
    emitMetric(name, payload) {
      metrics.push({ name, payload });
    },
    handlers: {
      async ingestRecentRuntimeEvents() {
        called.push('ingest');
      },
      async consolidateObservations() {
        called.push('consolidate');
      },
      async pruningCycle() {
        called.push('prune');
      },
      async deepMergeArchivalMaintenance() {
        called.push('merge');
      },
    },
  });

  mock.timers.tick(10);
  await new Promise(resolve => setImmediate(resolve));

  scheduler.stop();
  mock.timers.reset();

  assert.deepEqual(called, []);
  assert.ok(metrics.some((entry) => entry.payload.status === 'skipped_flag_disabled'));
});
