# Dependency Security Report - 2026-02-27

## Summary
- **High Severity Vulnerabilities**: 1 (minimatch)
- **Outdated Packages**: 1 (nostr-tools)

## Vulnerabilities

### High
- **minimatch**: ReDoS vulnerabilities.
  - Fix available: Yes (Update to >=10.2.3)
  - Affected versions: 10.0.0 - 10.2.2

## Outdated Packages

### Minor/Patch
- **nostr-tools**: 2.23.1 -> 2.23.2 (Patch)

## Decisions
- **minimatch**: Update recommended via `npm audit fix` or direct upgrade.
- **nostr-tools**: Patch update is safe to attempt.

## Actions
- Attempt `npm audit fix` for minimatch.
- Attempt upgrade of `nostr-tools` to 2.23.2.
