
import { RelayHealthManager } from '../src/lock-ops.mjs';

const healthManager = new RelayHealthManager();

// Setup mock relays
const relays = [];
for (let i = 0; i < 100; i++) {
  relays.push(`wss://relay-${i}.example.com`);
}

const config = {
  rollingWindowSize: 10,
  failureThreshold: 3,
  quarantineCooldownMs: 1000,
  maxQuarantineCooldownMs: 60000,
  snapshotIntervalMs: 10000,
  minActiveRelayPool: 5,
};

// Populate some metrics
for (const relay of relays) {
  // Simulate some outcomes
  for (let i = 0; i < 5; i++) {
    healthManager.recordOutcome(relay, Math.random() > 0.1, null, Math.random() * 200, config);
  }
}

// Benchmark rankRelays
const start = performance.now();
const iterations = 10000;

for (let i = 0; i < iterations; i++) {
  healthManager.rankRelays(relays, config);
}

const end = performance.now();
const duration = end - start;

console.log(`RankRelays x ${iterations}: ${duration.toFixed(2)}ms`);
console.log(`Average per call: ${(duration / iterations).toFixed(4)}ms`);
