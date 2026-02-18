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

  it('should cache ranked results and invalidate on outcome', () => {
    const manager = new RelayHealthManager();
    const config = {
      rollingWindowSize: 5,
      failureThreshold: 2,
      quarantineCooldownMs: 1000,
      maxQuarantineCooldownMs: 5000,
      minActiveRelayPool: 1,
    };
    const now = Date.now();

    manager.recordOutcome('wss://r1', true, null, 100, config, now);
    manager.recordOutcome('wss://r2', true, null, 200, config, now);

    const result1 = manager.rankRelays(['wss://r1', 'wss://r2'], config, now);
    // Internal cache should be populated
    assert.ok(manager._sortedCache);
    assert.strictEqual(manager._sortedCache.version, manager._metricsVersion);

    const result2 = manager.rankRelays(['wss://r1', 'wss://r2'], config, now);
    // Should be same objects (deep equality check on content, but references might differ due to map)
    // Actually rankRelays returns new objects always.
    assert.deepStrictEqual(result1, result2);

    // Modify outcome
    manager.recordOutcome('wss://r1', false, 'timeout', 1000, config, now);
    // Version should increase
    assert.ok(manager._sortedCache.version < manager._metricsVersion);

    const result3 = manager.rankRelays(['wss://r1', 'wss://r2'], config, now);
    // Cache should be updated
    assert.strictEqual(manager._sortedCache.version, manager._metricsVersion);
    assert.notDeepStrictEqual(result1, result3);
  });

  it('should invalidate cache when time passes quarantine expiry', () => {
    const manager = new RelayHealthManager();
    const config = {
      rollingWindowSize: 5,
      failureThreshold: 1, // fails immediately
      quarantineCooldownMs: 1000,
      maxQuarantineCooldownMs: 5000,
      minActiveRelayPool: 1,
    };
    let now = 10000;

    manager.recordOutcome('wss://r1', false, 'fail', 100, config, now);
    // r1 is quarantined until 11000

    const result1 = manager.rankRelays(['wss://r1'], config, now);
    assert.strictEqual(result1[0].summary.quarantined, true);
    assert.strictEqual(manager._sortedCache.validUntil, 11000);

    // Advance time but before expiry
    now = 10500;
    const result2 = manager.rankRelays(['wss://r1'], config, now);
    // Cache should still be valid (version same, now < validUntil)
    // Quarantine remaining should be less
    assert.strictEqual(result2[0].summary.quarantined, true);
    assert.strictEqual(result2[0].summary.quarantineRemainingMs, 500);

    // Advance time past expiry
    now = 11001;
    const result3 = manager.rankRelays(['wss://r1'], config, now);
    // Cache should be invalidated because now >= validUntil
    assert.strictEqual(result3[0].summary.quarantined, false);
    assert.strictEqual(result3[0].summary.quarantineRemainingMs, 0);
    // validUntil should be Infinity (no quarantined relays)
    assert.strictEqual(manager._sortedCache.validUntil, Infinity);
  });
});
