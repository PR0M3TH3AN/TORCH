# Memory Update — deps-security-agent — 2026-02-27

## Key findings
- minimatch 10.0.0-10.2.2 has ReDoS vulnerabilities; fixed in 10.2.3.
- nostr-tools 2.23.1 -> 2.23.2 is a safe patch.

## Patterns / reusable knowledge
- `npm audit fix` is effective for minor semver-compatible vulnerability fixes.
- Always check `npm outdated` even if audit passes to catch stale deps.

## Warnings / gotchas
- Ensure `npm update` respects `save-exact` if project policy requires it.
