import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAlertThresholds } from '../src/relay-health.mjs';

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

test('raises all-relays-down duration alert after threshold', () => {
  const now = Date.parse('2026-02-15T12:00:00Z');
  const history = [
    entry('2026-02-15T11:30:00Z', 1),
    entry('2026-02-15T11:45:00Z', 0),
    entry('2026-02-15T11:55:00Z', 0),
    entry('2026-02-15T12:00:00Z', 0),
  ];

  const current = history[history.length - 1];
  const result = evaluateAlertThresholds(current, history, {
    allRelaysDownMinutes: 10,
    minSuccessRate: 0.1,
    windowMinutes: 60,
  }, { nowMs: now });

  assert.ok(result.alerts.some((alert) => alert.type === 'all_relays_down_duration'));
});

test('raises success-rate alert when rolling health falls below threshold', () => {
  const history = [
    entry('2026-02-15T11:50:00Z', 3),
    entry('2026-02-15T11:55:00Z', 0),
    entry('2026-02-15T12:00:00Z', 0),
  ];
  const current = history[history.length - 1];

  const result = evaluateAlertThresholds(current, history, {
    allRelaysDownMinutes: 999,
    minSuccessRate: 0.5,
    windowMinutes: 30,
  }, { nowMs: Date.parse('2026-02-15T12:00:00Z') });

  assert.ok(result.alerts.some((alert) => alert.type === 'relay_success_rate_below_threshold'));
});
