# Memory Update — weekly-synthesis-agent — 2026-02-27

## Key findings
- Git log analysis is effective for tracking code changes, but misses PR/Issue metadata (links, labels) without API access.
- Task logs provide a reliable history of agent execution status (success/failure).
- High agent activity volume suggests the scheduler is functioning correctly.

## Patterns / reusable knowledge
- Always cross-reference git commits with task logs to differentiate between code changes and operational tasks.
- Use `git log --pretty=format` to extract structured data for reports.

## Warnings / gotchas
- Without GitHub API access, PR status (Open/Closed) is an inference, not a fact.
- "Issues Created" section relies solely on failed task logs, which may not correspond 1:1 with actual GitHub issues.
