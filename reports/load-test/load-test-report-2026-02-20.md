# Load Test Report - 2026-02-20

## Safety
- Does not target public relays.
- Requires explicit `RELAY_URL`.
- Relay target: ws://127.0.0.1:7777
- Mode: dry-run (no network sends)

## Configuration
- Clients: 50
- Duration: 2s
- Rate: 20 events/sec
- Metadata mix: 0.3
- Max connections: 50
- Max in-flight publishes: 300
- Seed: load-test-smoke

## Summary
- Attempted: 40
- Succeeded: 40
- Failed: 0
- Throughput: 19.99 events/sec
- Success rate: 100.00%

## Latency
- p50: 13.787 ms
- p90: 21.282 ms
- p95: 21.878 ms
- p99: 24.229 ms

## Event Loop Lag
- Avg: 0.875 ms
- p95: 5 ms

## Error Taxonomy
- none

## Hot Functions
- not measured

## Prioritized Remediation
1. No significant bottlenecks observed in this run; increase load gradually and repeat to find saturation point.
