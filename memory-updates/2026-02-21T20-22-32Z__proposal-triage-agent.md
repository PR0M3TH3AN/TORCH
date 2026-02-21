# Memory Update — proposal-triage-agent — 2026-02-21

## Key findings
- The highest-value unblockers remain local and deterministic: missing `npm run format`, missing `src/lib/eventSchemas.js`, and scheduler preflight platform assertion drift.
- Coverage-gap ideas should be split by urgency; low-priority agent additions dilute execution if treated as near-term work.

## Patterns / reusable knowledge
- Keep backlog focused on `ready-to-plan` items that remove recurring scheduler/test friction before adding net-new agent surface area.
- Retire upstream-only defects from implementation backlog, but retain them in known-issues/incidents for operator visibility.

## Warnings / gotchas
- `../scheduler-flow.md` links in weekly prompt files resolve to `src/prompts/scheduler-flow.md`; direct parent-relative lookups from repo root can appear missing during manual checks.
- Artifact-verifier failures often stem from metadata/frontmatter omissions rather than code defects; triage should classify these separately.
