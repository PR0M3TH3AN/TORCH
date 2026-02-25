# Daily Performance Report - 2026-02-23

## Summary
Perf scan run on 2026-02-23T21:25:49Z. Found 42 potential issues.

## Findings

### P0 (Critical)
None identified automatically.

### Scan Hits
- src/test_logs/TEST_LOG_2026-02-17T00-00-00Z.md:9 (setInterval)
- src/test_logs/TEST_LOG_2026-02-17T19-43-26Z.md:153 (Promise.all)
- src/test_logs/TEST_LOG_2026-02-19T16-54-36Z.md:15 (setTimeout)
- src/test_logs/TEST_LOG_2026-02-16.md:5 (setInterval)
- src/test_logs/TEST_LOG_2026-02-16.md:6 (visibilitychange)
- src/context/CONTEXT_2026-02-16.md:19 (setInterval)
- src/context/test-audit-context.md:8 (setTimeout)
- src/decisions/test-audit-decisions.md:4 (setTimeout)
- src/decisions/DECISIONS_2026-02-16.md:5 (setInterval)
- src/decisions/DECISIONS_2026-02-16.md:9 (visibilitychange)
- src/decisions/DECISIONS_2026-02-16.md:13 (requestAnimationFrame)
- src/decisions/DECISIONS_2026-02-16.md:16 (visibilitychange)
- src/lock-publisher.mjs:116 (Promise.all)
- src/lock-publisher.mjs:196 (setTimeout)
- src/lock-publisher.mjs:423 (Promise.all)
- src/lib.mjs:204 (setTimeout)
- src/todo/test-audit-todo.md:3 (setTimeout)
- src/todo/test-audit-todo.md:4 (setTimeout)
- src/todo/test-audit-todo.md:5 (setTimeout)
- src/lock-utils.mjs:57 (setTimeout)
- src/lock-utils.mjs:59 (Promise.race)
- src/prompts/weekly/race-condition-agent.md:46 (postMessage)
- src/prompts/weekly/race-condition-agent.md:116 (Promise.all)
- src/prompts/daily/const-refactor-agent.md:84 (setTimeout)
- src/prompts/daily/perf-agent.md:91 (document.hidden)
- src/prompts/daily/perf-agent.md:100 (setInterval)
- src/prompts/daily/perf-agent.md:102 (new Worker)
- src/prompts/daily/perf-agent.md:103 (new WebTorrent)
- src/prompts/daily/perf-agent.md:105 (document.hidden)
- src/prompts/daily/perf-agent.md:110 (requestAnimationFrame)
- src/prompts/daily/perf-agent.md:121 (document.hidden)
- src/cmd-list.mjs:38 (Promise.all)
- src/dashboard.mjs:254 (setTimeout)
- src/services/memory/index.js:52 (setTimeout)
- src/services/memory/pruner.js:199 (Promise.all)
- src/services/memory/pruner.js:276 (Promise.all)
- src/services/memory/retriever.js:256 (Promise.all)
- src/services/memory/formatter.js:181 (Promise.all)
- src/services/memory/scheduler.js:33 (setInterval)
- src/services/memory/scheduler.js:167 (setTimeout)
- src/services/memory/scheduler.js:252 (setInterval)
- src/services/memory/scheduler.js:260 (setTimeout)

## Metrics
- Login Time: N/A (requires instrumentation)
- Decrypt Queue: N/A

## Blockers
- No /content directory found for docs audit.

## PRs
None.
