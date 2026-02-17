import { describe, it } from 'node:test';
import assert from 'node:assert';
import { RelayHealthManager } from '../src/lock-ops.mjs';

describe('RelayHealthManager', () => {
  it('should isolate state between instances', () => {
    const manager1 = new RelayHealthManager();
    const manager2 = new RelayHealthManager();

    const config = {
      rollingWindowSize: 5,
      failureThreshold: 3,
      quarantineCooldownMs: 1000,
      maxQuarantineCooldownMs: 5000,
    };

    manager1.recordOutcome('wss://relay1', true, null, 100, config);

    // Manager 1 should have metrics
    const metrics1 = manager1.ensureMetrics('wss://relay1', config);
    assert.strictEqual(metrics1.recentOutcomes.length, 1);

    // Manager 2 should have empty metrics for relay1
    const metrics2 = manager2.ensureMetrics('wss://relay1', config);
    assert.strictEqual(metrics2.recentOutcomes.length, 0);
  });

  it('should prioritize relays based on health', () => {
    const manager = new RelayHealthManager();
    const config = {
      rollingWindowSize: 5,
      failureThreshold: 2,
      quarantineCooldownMs: 1000,
      maxQuarantineCooldownMs: 5000,
      minActiveRelayPool: 1,
    };

    // Relay 1: Healthy
    manager.recordOutcome('wss://healthy', true, null, 100, config);

    // Relay 2: Failing
    manager.recordOutcome('wss://failing', false, 'error', 100, config);
    manager.recordOutcome('wss://failing', false, 'error', 100, config); // Quarantined

    const result = manager.prioritizeRelays(['wss://healthy', 'wss://failing'], config);

    assert.deepStrictEqual(result.prioritized, ['wss://healthy']);

    // Check ranking
    const healthyRank = result.ranked.find(r => r.relay === 'wss://healthy');
    const failingRank = result.ranked.find(r => r.relay === 'wss://failing');

    assert.ok(healthyRank.score > failingRank.score);
    assert.strictEqual(failingRank.summary.quarantined, true);
  });

  it('should reset state correctly', () => {
    const manager = new RelayHealthManager();
    const config = {
        rollingWindowSize: 5,
        failureThreshold: 3,
        quarantineCooldownMs: 1000,
        maxQuarantineCooldownMs: 5000,
    };

    manager.recordOutcome('wss://relay1', true, null, 100, config);
    assert.strictEqual(manager.metricsByRelay.size, 1);

    manager.reset();
    assert.strictEqual(manager.metricsByRelay.size, 0);
  });
});
