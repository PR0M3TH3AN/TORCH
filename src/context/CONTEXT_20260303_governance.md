---
agent: governance-agent
cadence: daily
run-start: 2026-03-03
prompt-path: src/prompts/daily/governance-agent.md
---
## Goal
Execute Governance Cycle.

## Scope
src/proposals/, scripts/governance/process-proposals.mjs.

## Constraints
Do not run lock:complete. Do not create completed.md logs.
