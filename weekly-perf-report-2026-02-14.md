# Weekly Performance Report - 2026-02-14

## Scenario
Running `node bin/torch-lock.mjs list` to list active locks for both daily and weekly cadences.
This command executes two sequential queries to Nostr relays.

## Baseline (Before Optimization)
Measured using `scripts/perf-benchmark.mjs` (5 iterations).

- **Average Duration**: 15826.65ms
- **Min Duration**: 15770.65ms
- **Max Duration**: 16013.24ms

The command appears to be network-bound, likely due to sequential execution of relay queries for each cadence.

## After Optimization
Modified `src/lib.mjs` to execute relay queries in parallel using `Promise.all`.

- **Average Duration**: 15190.12ms
- **Min Duration**: 15184.86ms
- **Max Duration**: 15199.04ms

## Analysis
The speedup is approximately 4% (636ms).
While theoretically this should parallelize the latency, the observed improvement is small.
This suggests that either:
1. The relays are responding very quickly but one query dominates the time (e.g. hitting a 15s timeout).
2. The `SimplePool` instantiation overhead is significant.
3. Network bandwidth or local resource contention limits the concurrency gains.

Given the timeout in `src/lib.mjs` is 15000ms, and the duration is just over 15000ms, it is highly likely that at least one query is timing out.
If both queries were timing out sequentially, the duration would be ~30s.
Since sequential was ~16s, it implies one query timed out (15s) and the other was very fast (<1s), OR they overlapped in some way (unlikely in sequential).

If one query takes 15s (timeout) and the other takes 0.5s:
- Sequential: 15s + 0.5s = 15.5s.
- Parallel: max(15s, 0.5s) = 15s.
This matches the data perfectly.

Conclusion: One cadence query (likely 'daily' or 'weekly' specifically) is timing out or very slow, while the other is fast. Parallelization ensures we pay the "slowest" cost, not the sum.
