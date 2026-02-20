---
agent: load-test-agent
cadence: daily
status: failed
platform: codex
reason: Run artifact verification failed
---
- failing_command: `node scripts/agent/verify-run-artifacts.mjs --since 2026-02-20T04:25:38Z --check-failure-notes`
- detail: artifact verification exited 2
- verifier_error: Missing scheduler context: provide --agent and --prompt-path (or set SCHEDULER_AGENT/SCHEDULER_PROMPT_PATH).
- retry_guidance: Re-run scheduler verification with `SCHEDULER_AGENT=load-test-agent` and `SCHEDULER_PROMPT_PATH=src/prompts/daily/load-test-agent.md` (or pass `--agent` and `--prompt-path`) before repository validation.
- run_start_iso: 2026-02-20T04:25:38Z
