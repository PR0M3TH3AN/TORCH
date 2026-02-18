import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeHistory } from '../src/relay-health.mjs';

function createEntry(timestamp, healthyRelays, totalRelays = 3) {
  return {
    timestamp,
    summary: {
      healthyRelays,
      totalRelays,
    },
  };
}

test('summarizeHistory - basic statistics calculation', () => {
  const now = Date.parse('2024-01-01T12:00:00Z');
  const history = [
    // Chronological order (oldest to newest)
    createEntry('2024-01-01T11:45:00Z', 0, 3), // 0% healthy
    createEntry('2024-01-01T11:50:00Z', 1, 3), // 33% healthy
    createEntry('2024-01-01T11:55:00Z', 3, 3), // 100% healthy
  ];

  const result = summarizeHistory(history, { nowMs: now, windowMinutes: 60 });

  assert.equal(result.sampleCount, 3);
  // Total probes: 9, Total healthy: 4. Rate: 4/9
  assert.equal(result.successRate, 4 / 9);

  // Last healthy was at 11:55 (5 minutes ago)
  assert.equal(result.allDownDurationMinutes, 5);
});

test('summarizeHistory - handles empty history', () => {
  const result = summarizeHistory([], { nowMs: Date.now() });
  assert.equal(result.sampleCount, 0);
  assert.equal(result.successRate, 1); // Default when sampleCount is 0
  assert.equal(result.allDownDurationMinutes, null);
});

test('summarizeHistory - respects time window for stats', () => {
  const now = Date.parse('2024-01-01T12:00:00Z');
  const history = [
    // Chronological order
    createEntry('2024-01-01T10:00:00Z', 0, 3), // Outside 60m window (120m ago)
    createEntry('2024-01-01T11:55:00Z', 3, 3), // Inside 60m window (5m ago)
  ];

  const result = summarizeHistory(history, { nowMs: now, windowMinutes: 60 });

  assert.equal(result.sampleCount, 1);
  assert.equal(result.successRate, 1); // Only the recent healthy entry counts
});

test('summarizeHistory - allDownDurationMinutes considers outside window entries', () => {
  const now = Date.parse('2024-01-01T12:00:00Z');
  const history = [
    // Chronological order
    createEntry('2024-01-01T10:00:00Z', 3, 3), // Outside window, healthy
    createEntry('2024-01-01T11:55:00Z', 0, 3), // Inside window, unhealthy
  ];

  const result = summarizeHistory(history, { nowMs: now, windowMinutes: 60 });

  assert.equal(result.sampleCount, 1); // Only recent one counted
  assert.equal(result.successRate, 0); // 0/3 = 0

  // Last healthy was at 10:00 (120 minutes ago)
  assert.equal(result.allDownDurationMinutes, 120);
});

test('summarizeHistory - allDownDurationMinutes is null if never healthy', () => {
  const now = Date.parse('2024-01-01T12:00:00Z');
  const history = [
    createEntry('2024-01-01T11:55:00Z', 0, 3),
    createEntry('2024-01-01T10:00:00Z', 0, 3),
  ];

  const result = summarizeHistory(history, { nowMs: now, windowMinutes: 60 });
  assert.equal(result.allDownDurationMinutes, null);
});

test('summarizeHistory - allDownDurationMinutes is 0 if currently healthy', () => {
  const now = Date.parse('2024-01-01T12:00:00Z');
  const history = [
    createEntry('2024-01-01T12:00:00Z', 3, 3),
  ];

  const result = summarizeHistory(history, { nowMs: now, windowMinutes: 60 });
  assert.equal(result.allDownDurationMinutes, 0);
});

test('summarizeHistory - handles malformed entries gracefully', () => {
  const now = Date.now();
  const history = [
    {}, // Missing everything
    { timestamp: 'invalid-date' },
    { timestamp: new Date(now).toISOString(), summary: null },
  ];

  const result = summarizeHistory(history, { nowMs: now, windowMinutes: 60 });

  // Should calculate stats safely (ignoring malformed or treating as 0)
  assert.equal(typeof result.successRate, 'number');
  assert.equal(result.sampleCount, 1); // Only the valid timestamp one is counted in 'recent'
  // That one has summary: null, so totalRelays=0, healthyRelays=0.
  // relayProbeCount = 0. So successRate = 1.
  assert.equal(result.successRate, 1);
});

test('summarizeHistory - handles valid timestamp but missing summary', () => {
  const now = Date.parse('2024-01-01T12:00:00Z');
  const history = [
    { timestamp: '2024-01-01T11:55:00Z' } // Missing summary
  ];

  const result = summarizeHistory(history, { nowMs: now, windowMinutes: 60 });

  assert.equal(result.sampleCount, 1);
  assert.equal(result.successRate, 1); // totalRelays defaults to 0 -> relayProbeCount=0 -> rate=1
  assert.equal(result.allDownDurationMinutes, null); // healthyRelays defaults to 0 -> never healthy
});

test('summarizeHistory - healthy entry with invalid timestamp results in NaN duration', () => {
  const now = Date.now();
  const history = [
    { timestamp: 'invalid-date', summary: { healthyRelays: 1 } }
  ];

  const result = summarizeHistory(history, { nowMs: now });

  assert.equal(Number.isNaN(result.allDownDurationMinutes), true);
});
