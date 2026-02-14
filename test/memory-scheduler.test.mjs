import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createDbAdvisoryLockProvider,
  startMemoryMaintenanceScheduler,
} from '../src/services/memory/scheduler.js';

const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

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

  await wait(25);
  scheduler.stop();

  const byJob = metrics.reduce((acc, entry) => {
    const key = entry.payload.job;
    acc[key] = acc[key] || [];
    acc[key].push(entry);
    return acc;
  }, {});

  assert.equal(byJob.ingestRecentRuntimeEvents.length, 1);
  assert.equal(byJob.ingestRecentRuntimeEvents[0].payload.status, 'success');
  assert.equal(byJob.ingestRecentRuntimeEvents[0].payload.itemCount, 3);
  assert.equal(byJob.ingestRecentRuntimeEvents[0].payload.retries, 1);

  assert.equal(byJob.consolidateObservations[0].payload.status, 'skipped_lock_unavailable');
  assert.equal(byJob.pruningCycle[0].payload.status, 'success');
  assert.equal(byJob.deepMergeArchivalMaintenance[0].payload.status, 'success');
});


test('startMemoryMaintenanceScheduler skips jobs when feature flags disable memory', async () => {
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

  await wait(10);
  scheduler.stop();

  assert.deepEqual(called, []);
  assert.ok(metrics.some((entry) => entry.payload.status === 'skipped_flag_disabled'));
});
