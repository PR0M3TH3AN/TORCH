---
agent: onboarding-audit-agent
cadence: daily
run-start: 2026-02-15T01:03:31Z
prompt: src/prompts/daily/onboarding-audit-agent.md
---

# Incident: PROMPT-CONTRACT-FAILURES

**Date:** 2026-02-15T01:03:31Z
**Agent:** onboarding-audit-agent
**Incident ID:** PROMPT-CONTRACT-FAILURES

## Description
The `npm test` command fails during onboarding validation due to multiple prompt files violating the strict prompt contract enforced by `scripts/validate-prompt-contract.mjs`.

## Impact
New developers cannot run `npm test` cleanly after checking out the repository.

## Remediation
Update all agent prompts in `src/prompts/` to strictly follow the `Scheduler Flow` contract regarding completion commands and log file naming.
