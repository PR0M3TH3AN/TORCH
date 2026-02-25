# Load Test Report - 2026-02-22

## Safety
- Does not target public relays.
- Requires explicit `RELAY_URL`.
- Relay target: ws://127.0.0.1:42049
- Mode: live publish test

## Configuration
- Clients: 10
- Duration: 10s
- Rate: 20 events/sec
- Metadata mix: 0.2
- Max connections: 10
- Max in-flight publishes: 300
- Seed: (random)

## Summary
- Attempted: 200
- Succeeded: 200
- Failed: 0
- Throughput: 19.93 events/sec
- Success rate: 100.00%

## Latency
- p50: 0.806 ms
- p90: 1.073 ms
- p95: 1.252 ms
- p99: 3.879 ms

## Event Loop Lag
- Avg: 0.388 ms
- p95: 1 ms

## Error Taxonomy
- none

## Hot Functions
- not measured

## Prioritized Remediation
1. No significant bottlenecks observed in this run; increase load gradually and repeat to find saturation point.
