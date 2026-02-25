# Load Test Report - 2026-02-23

## Safety
- Does not target public relays.
- Requires explicit `RELAY_URL`.
- Relay target: ws://localhost:9999
- Mode: dry-run (no network sends)

## Configuration
- Clients: 1000
- Duration: 10s
- Rate: 20 events/sec
- Metadata mix: 0.2
- Max connections: 250
- Max in-flight publishes: 300
- Seed: (random)

## Summary
- Attempted: 200
- Succeeded: 200
- Failed: 0
- Throughput: 19.998 events/sec
- Success rate: 100.00%

## Latency
- p50: 14.242 ms
- p90: 22.238 ms
- p95: 23.286 ms
- p99: 24.489 ms

## Event Loop Lag
- Avg: 0.396 ms
- p95: 2 ms

## Error Taxonomy
- none

## Hot Functions
- not measured

## Prioritized Remediation
1. No significant bottlenecks observed in this run; increase load gradually and repeat to find saturation point.
