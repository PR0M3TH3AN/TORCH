# Daily Performance Report - 2026-02-23

**Summary:** Found 63 potential performance hits.

## P0 Findings (Worker/Critical)
- `src/prompts/daily/perf-agent.md`: `- `new Worker|Worker\(|postMessage\(|getDmDecryptWorkerQueueSize|decryptDmInWorker``
- `src/prompts/daily/perf-agent.md`: `- Add `MAX_DM_WORKER_PENDING` to `dmDecryptWorkerClient.js`. Throttle/reject when exceeded; log `getDmDecryptWorkerQueueSize()`.`
- `src/prompts/daily/perf-agent.md`: `- Log `getDmDecryptWorkerQueueSize()` and warn > 20.`

## P1 Findings (Loops/Async)
- `src/test_logs/TEST_LOG_2026-02-17T00-00-00Z.md`: `- Command: grep -rE "setInterval|setTimeout" src/`
- `src/test_logs/TEST_LOG_2026-02-17T19-43-26Z.md`: `async Promise.all (index 0)`
- `src/test_logs/TEST_LOG_2026-02-19T16-54-36Z.md`: `-   **Static Analysis**: Identified 4 suspicious files (1 fixture, 3 tests with `setTimeout`).`
- `src/context/CONTEXT_2026-02-16.md`: `- `setInterval` in `dashboard/index.html` runs even when tab is hidden, wasting CPU.`
- `src/context/test-audit-context.md`: `-   Check for "cheat vectors" like `setTimeout`.`
- `src/decisions/test-audit-decisions.md`: `-   **Decision:** Flagged tests with `setTimeout` for future refactoring to improve determinism.`
- `src/decisions/DECISIONS_2026-02-16.md`: `- Use `requestAnimationFrame`: Still runs (sometimes throttled) and more complex to manage with 30s intervals.`
- `src/lock-publisher.mjs`: `const settled = await Promise.allSettled(`
- `src/lock-publisher.mjs`: `sleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),`
- `src/lock-publisher.mjs`: `const [publishTimeoutMs, minSuccesses, fallbackRelays, minActiveRelayPool] = await Promise.all([`
- `src/lib.mjs`: `await new Promise((resolve) => setTimeout(resolve, raceCheckDelayMs));`
- `src/todo/test-audit-todo.md`: `- [ ] Investigate `test/memory-cache.test.mjs` for `setTimeout` removal.`
- `src/todo/test-audit-todo.md`: `- [ ] Investigate `test/memory.test.js` for `setTimeout` removal.`
- `src/todo/test-audit-todo.md`: `- [ ] Investigate `test/relay-fanout-quorum.integration.test.mjs` for `setTimeout` removal.`
- `src/lock-utils.mjs`: `timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);`
- `src/prompts/weekly/race-condition-agent.md`: `- Promise.all/race with insufficient error isolation`
- `src/prompts/daily/const-refactor-agent.md`: `- Timeout: look for `setTimeout`, `fetch(..., { timeout: ...})`, `pool.list` timeouts, `BACKGROUND_RELAY_TIMEOUT_MS`.`
- `src/prompts/daily/perf-agent.md`: `- `setInterval|setTimeout|requestAnimationFrame|requestIdleCallback``
- `src/cmd-list.mjs`: `const results = await Promise.all(`
- `src/dashboard.mjs`: `setTimeout(() => {`
- `src/services/memory/index.js`: `await new Promise((resolve) => setTimeout(resolve, MIN_SAVE_INTERVAL_MS - timeSinceLast));`
- `src/services/memory/pruner.js`: `const condensedGroups = await Promise.all(`
- `src/services/memory/pruner.js`: `const results = await Promise.all(plan.actions.map(async (decision) => {`
- `src/services/memory/retriever.js`: `await Promise.all(ids.map((id) => repository.updateMemoryUsage(id, lastSeen)));`
- `src/services/memory/formatter.js`: `await Promise.all((memories ?? []).map((memory) => memoryService.updateMemoryUsage(memory.id, now)));`
- `src/services/memory/scheduler.js`: `const handle = setInterval(() => {`
- `src/services/memory/scheduler.js`: `setTimeout(resolve, options.retryDelayMs);`
- `src/services/memory/scheduler.js`: `const intervalHandle = setInterval(run, definition.intervalMs);`
- `src/services/memory/scheduler.js`: `const timeout = setTimeout(async () => {`

## P2 Findings (Torrent)
- `src/test_logs/TEST_LOG_2026-02-23T18-18-24Z.md`: `**Command:** `grep -rE "setInterval|setTimeout|requestAnimationFrame|requestIdleCallback|Promise\.allSettled|Promise\.all|Promise\.any|Promise\.race|new Worker|Worker\(|postMessage\(|getDmDecryptWorkerQueueSize|decryptDmInWorker|new WebTorrent|WebTorrent|torrent|magnet|torrentHash|magnetValidators|integrationClient\.pool|publishEventToRelays|pool\.list|queueSignEvent|relayManager|authService|hydrateFromStorage|document\.hidden|visibilitychange" src/``
- `src/prompts/weekly/fuzz-agent.md`: `Mission: improve **input robustness** by fuzzing high-risk parsers/decoders (shared event schemas, DM unwrapping/decrypt paths, magnet normalization), capturing crashes/exceptions with minimized reproducers, and landing **small, safe** guard/validation fixes when appropriate. Every change must be traceable, reviewable, and compliant with repo security policy.`
- `src/prompts/weekly/fuzz-agent.md`: `- magnet normalization utilities`
- `src/prompts/weekly/fuzz-agent.md`: `- `magnet-utils``
- `src/prompts/daily/known-issues-agent.md`: `magnets/webtorrent safety, logging/PII policy) without explicit human review.`
- `src/prompts/daily/known-issues-agent.md`: `(e.g., shared signing/publishing, key handling, moderation, magnets/torrents,`
- `src/prompts/daily/known-issues-agent.md`: `- magnets/webtorrent behavior`
- `src/prompts/daily/perf-agent.md`: `- **P2**: User-initiated heavy features (WebTorrent playback) — lazy-init/deprioritize until P0/P1 resolved.`
- `src/prompts/daily/perf-agent.md`: `- **Lazy init**: WebTorrent and socket-heavy clients created only on explicit user action.`
- `src/prompts/daily/perf-agent.md`: `- `new WebTorrent|WebTorrent|torrent|magnet|torrentHash|magnetValidators``
- `src/prompts/daily/perf-agent.md`: `- Ripgrep: `rg -n --hidden --ignore-file .gitignore "requestAnimationFrame|new Worker|new WebTorrent|integrationClient.pool" js``
- `src/prompts/daily/perf-agent.md`: `- Active WebTorrent client count at page load.`

## Other Findings
- `src/test_logs/TEST_LOG_2026-02-16.md`: `2. **Static Analysis**: Verify `dashboard/index.html` contains `document.addEventListener('visibilitychange', ...)` handler.`
- `src/decisions/DECISIONS_2026-02-16.md`: `- UI might be slightly stale when tab becomes visible, so we add a `visibilitychange` listener to force an immediate update.`
- `src/decisions/DECISIONS_2026-02-16.md`: `- Monitor if users complain about stale data (should be mitigated by `visibilitychange`).`
- `src/lock-utils.mjs`: `return Promise.race([`
- `src/prompts/weekly/race-condition-agent.md`: `- Clients or torrents accessed after destroy`
- `src/prompts/daily/const-refactor-agent.md`: `{"file": "src/relayManager.js", "line": 24, "context":"FAST_RELAY_TIMEOUT_MS"},`
- `src/prompts/daily/const-refactor-agent.md`: `- Example: if `FAST_RELAY_TIMEOUT_MS` exists in `src/relayManager.js` or `relayConstants.js`, import it.`
- `src/prompts/daily/const-refactor-agent.md`: `- Reason: relayManager & integration-related code; existing relay constants live here.`
- `src/prompts/daily/const-refactor-agent.md`: `- Discover `5000` appears in `src/relayManager.js`, `js/integration/watchHistory.js`, `js/integration/relayClient.js`.`
- `src/prompts/daily/perf-agent.md`: `1. Finds expensive background patterns (main-thread loops, unbounded concurrency, eager socket/torrent creation).`
- `src/prompts/daily/perf-agent.md`: `- `reports/performance/INITIAL_BASELINE.md` — baseline metrics (login time, decrypt queue size, relay latencies, webtorrent count).`
- `src/prompts/daily/perf-agent.md`: `- `integrationClient\.pool|publishEventToRelays|pool\.list|queueSignEvent|relayManager|authService|hydrateFromStorage``
- `src/prompts/daily/perf-agent.md`: `- Open suspicious files for review: `sed -n '1,240p' src/relayManager.js``
- `src/prompts/daily/deps-security-agent.md`: `Also read `AGENTS.md` and `KNOWN_ISSUES.md` for project-specific caveats (e.g., the repo uses `integration-tools`, `webtorrent`, `Playwright`, `Tailwind`). Tag these libraries for special handling.`

## Metrics
- Total Hits: 63
- Workers/Critical: 3
