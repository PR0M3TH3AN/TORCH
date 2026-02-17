import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeHistory } from '../src/relay-health.mjs';

function entry(timestamp, healthyRelays, totalRelays = 3) {
  return {
    timestamp,
    summary: {
      healthyRelays,
      totalRelays,
      allRelaysUnhealthy: healthyRelays === 0,
    },
  };
}

test('summarizeHistory', async (t) => {
  const now = Date.parse('2026-02-15T12:00:00Z');
  const minute = 60_000;

  await t.test('calculates correct success rate within window', () => {
    const history = [
      entry(new Date(now - 10 * minute).toISOString(), 3, 3), // 100%
      entry(new Date(now - 20 * minute).toISOString(), 0, 3), // 0%
    ];
    // Total probes: 6, Healthy: 3. Rate: 0.5

    const result = summarizeHistory(history, { nowMs: now, windowMinutes: 60 });
    assert.equal(result.sampleCount, 2);
    assert.equal(result.successRate, 0.5);
  });

  await t.test('filters out old entries for success rate', () => {
    const history = [
      entry(new Date(now - 10 * minute).toISOString(), 3, 3),
      entry(new Date(now - 90 * minute).toISOString(), 0, 3), // Outside 60m window
    ];

    const result = summarizeHistory(history, { nowMs: now, windowMinutes: 60 });
    assert.equal(result.sampleCount, 1);
    assert.equal(result.successRate, 1); // 3/3 = 1
  });

  await t.test('calculates allDownDurationMinutes correctly', () => {
    // Last healthy was 30 mins ago
    const history = [
      entry(new Date(now - 30 * minute).toISOString(), 3, 3),
      entry(new Date(now - 10 * minute).toISOString(), 0, 3),
    ];

    const result = summarizeHistory(history, { nowMs: now, windowMinutes: 60 });
    assert.equal(result.allDownDurationMinutes, 30);
  });

  await t.test('allDownDurationMinutes considers entries outside window', () => {
    // Last healthy was 90 mins ago (outside window)
    const history = [
      entry(new Date(now - 90 * minute).toISOString(), 3, 3),
      entry(new Date(now - 10 * minute).toISOString(), 0, 3),
    ];

    const result = summarizeHistory(history, { nowMs: now, windowMinutes: 60 });
    assert.equal(result.allDownDurationMinutes, 90);
  });

  await t.test('returns null allDownDurationMinutes if never healthy', () => {
    const history = [
      entry(new Date(now - 90 * minute).toISOString(), 0, 3),
      entry(new Date(now - 10 * minute).toISOString(), 0, 3),
    ];

    const result = summarizeHistory(history, { nowMs: now, windowMinutes: 60 });
    assert.equal(result.allDownDurationMinutes, null);
  });

  await t.test('returns 0 allDownDurationMinutes if currently healthy', () => {
    const history = [
      entry(new Date(now).toISOString(), 3, 3),
    ];

    const result = summarizeHistory(history, { nowMs: now, windowMinutes: 60 });
    assert.equal(result.allDownDurationMinutes, 0);
  });

  await t.test('handles empty history', () => {
    const result = summarizeHistory([], { nowMs: now, windowMinutes: 60 });
    assert.equal(result.sampleCount, 0);
    assert.equal(result.successRate, 1);
    assert.equal(result.allDownDurationMinutes, null);
  });

  await t.test('handles malformed entries gracefully', () => {
    const history = [
        {}, // No summary, no timestamp
        { timestamp: new Date(now - 10 * minute).toISOString() }, // No summary
        { summary: { totalRelays: 3 } } // No timestamp
    ];

    const result = summarizeHistory(history, { nowMs: now, windowMinutes: 60 });

    // Entry 1: timestamp is undefined -> NaN. NaN >= windowStartMs is false. Skipped.
    // Entry 2: timestamp valid (10 mins ago). No summary.
    //          summary?.totalRelays || 0 -> 0.
    //          summary?.healthyRelays || 0 -> 0.
    // Entry 3: timestamp undefined -> NaN. Skipped.

    // recent = [Entry 2]
    // relayProbeCount = 0 + 0 = 0.
    // successCount = 0 + 0 = 0.
    // successRate = 0 > 0 ? ... : 1 -> 1.

    assert.equal(result.sampleCount, 1);
    assert.equal(result.successRate, 1);

    // lastHealthyAtMs check:
    // Entry 3: healthyRelays undefined -> 0. Not > 0.
    // Entry 2: healthyRelays undefined -> 0. Not > 0.
    // Entry 1: healthyRelays undefined -> 0. Not > 0.
    // Loop finishes. lastHealthyAtMs = null.
    // allDownDurationMinutes = null.

    assert.equal(result.allDownDurationMinutes, null);
  });
});
