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

test('evaluateAlertThresholds', async (t) => {
  const now = Date.parse('2026-02-15T12:00:00Z');
  const minute = 60_000;

  await t.test('Happy Path: No alerts when thresholds are not met', () => {
    const history = [
      entry(new Date(now - 10 * minute).toISOString(), 3),
      entry(new Date(now).toISOString(), 3),
    ];
    const current = history[history.length - 1];

    const result = evaluateAlertThresholds(current, history, {
      allRelaysDownMinutes: 10,
      minSuccessRate: 0.5,
      windowMinutes: 60,
    }, { nowMs: now });

    assert.equal(result.alerts.length, 0);
  });

  await t.test('All Relays Down: Triggers alert when duration equals threshold', () => {
    // 10 minutes down exactly
    const history = [
      entry(new Date(now - 10 * minute).toISOString(), 3), // healthy 10 mins ago
      entry(new Date(now - 5 * minute).toISOString(), 0),
      entry(new Date(now).toISOString(), 0),
    ];
    const current = history[history.length - 1];

    const result = evaluateAlertThresholds(current, history, {
      allRelaysDownMinutes: 10,
      minSuccessRate: 0.1,
      windowMinutes: 60,
    }, { nowMs: now });

    const alert = result.alerts.find(a => a.type === 'all_relays_down_duration');
    assert.ok(alert);
    assert.equal(alert.actualMinutes, 10);
  });

  await t.test('All Relays Down: Does NOT trigger alert just below threshold', () => {
    // 9 minutes down
    const history = [
      entry(new Date(now - 9 * minute).toISOString(), 3), // healthy 9 mins ago
      entry(new Date(now).toISOString(), 0),
    ];
    const current = history[history.length - 1];

    const result = evaluateAlertThresholds(current, history, {
      allRelaysDownMinutes: 10,
      minSuccessRate: 0.1,
      windowMinutes: 60,
    }, { nowMs: now });

    const alert = result.alerts.find(a => a.type === 'all_relays_down_duration');
    assert.equal(alert, undefined);
  });

  await t.test('Success Rate: Triggers alert when rate is strictly below threshold', () => {
    const history = [
      entry(new Date(now).toISOString(), 1, 4), // 25% healthy
    ];
    const current = history[history.length - 1];
    // Threshold 0.3 > 0.25 -> Alert

    const result = evaluateAlertThresholds(current, history, {
      allRelaysDownMinutes: 999,
      minSuccessRate: 0.3,
      windowMinutes: 60,
    }, { nowMs: now });

    const alert = result.alerts.find(a => a.type === 'relay_success_rate_below_threshold');
    assert.ok(alert);
    assert.equal(alert.actual, 0.25);
  });

  await t.test('Success Rate: Does NOT trigger alert when rate equals threshold', () => {
    const history = [
      entry(new Date(now).toISOString(), 1, 4), // 25% healthy
    ];
    const current = history[history.length - 1];
    // Threshold 0.25 == 0.25 -> No Alert

    const result = evaluateAlertThresholds(current, history, {
      allRelaysDownMinutes: 999,
      minSuccessRate: 0.25,
      windowMinutes: 60,
    }, { nowMs: now });

    const alert = result.alerts.find(a => a.type === 'relay_success_rate_below_threshold');
    assert.equal(alert, undefined);
  });

  await t.test('Success Rate: Does NOT trigger alert when rate is above threshold', () => {
    const history = [
      entry(new Date(now).toISOString(), 3, 4), // 75% healthy
    ];
    const current = history[history.length - 1];
    // Threshold 0.5 < 0.75 -> No Alert

    const result = evaluateAlertThresholds(current, history, {
      allRelaysDownMinutes: 999,
      minSuccessRate: 0.5,
      windowMinutes: 60,
    }, { nowMs: now });

    const alert = result.alerts.find(a => a.type === 'relay_success_rate_below_threshold');
    assert.equal(alert, undefined);
  });

  await t.test('Multiple Alerts: Both conditions met', () => {
    // Down for 20 mins (threshold 10) AND rate 0 (threshold 0.5)
    const history = [
      entry(new Date(now - 20 * minute).toISOString(), 3), // Healthy 20m ago
      entry(new Date(now - 10 * minute).toISOString(), 0),
      entry(new Date(now).toISOString(), 0),
    ];
    const current = history[history.length - 1];

    const result = evaluateAlertThresholds(current, history, {
      allRelaysDownMinutes: 10,
      minSuccessRate: 0.5,
      windowMinutes: 60,
    }, { nowMs: now });

    assert.equal(result.alerts.length, 2);
    assert.ok(result.alerts.some(a => a.type === 'all_relays_down_duration'));
    assert.ok(result.alerts.some(a => a.type === 'relay_success_rate_below_threshold'));
  });

  await t.test('Edge Case: Empty history (should not crash)', () => {
    const history = [];
    const current = entry(new Date(now).toISOString(), 3); // current result is healthy

    const result = evaluateAlertThresholds(current, history, {
      allRelaysDownMinutes: 10,
      minSuccessRate: 0.5,
      windowMinutes: 60,
    }, { nowMs: now });

    assert.equal(result.alerts.length, 0);
  });

  await t.test('Edge Case: Empty history but current result is unhealthy', () => {
    const history = [];
    const current = entry(new Date(now).toISOString(), 0); // current result is unhealthy

    const result = evaluateAlertThresholds(current, history, {
      allRelaysDownMinutes: 10,
      minSuccessRate: 0.5,
      windowMinutes: 60,
    }, { nowMs: now });

    assert.equal(result.alerts.length, 0);
  });
});
