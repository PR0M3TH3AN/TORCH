---
agent: perf-deepdive-agent
status: completed
date: 2026-02-14
---

# Weekly Performance Deep Dive

## Summary
- **Scenario**: Listing active locks (`torch-lock list`), which involves querying relays for both daily and weekly cadences.
- **Optimization**: Parallelized the relay queries in `src/lib.mjs`.
- **Baseline Duration**: ~15.8s
- **Post-Optimization Duration**: ~15.2s
- **Improvement**: ~4%

## Analysis
The performance is dominated by a 15s timeout on one of the queries. Parallelization ensures that the total duration is determined by the slowest query, rather than the sum of sequential query times (which would be ~30s if both timed out).

## Artifacts
- `weekly-perf-report-2026-02-14.md`: Detailed report with benchmark data.
