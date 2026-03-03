---
agent: dead-code-agent
cadence: weekly
run-start: 2026-03-02T16-00-00Z
prompt-path: src/prompts/weekly/dead-code-agent.md
---

# Context
goal: Identify and remove dead code.
scope: Searched for orphaned JS files and unused code. Found `create_simulated_artifacts.js` which is an unused script.
constraints: Must verify tests and format/lint pass after removal.
