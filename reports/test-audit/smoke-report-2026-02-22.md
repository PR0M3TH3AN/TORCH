# Smoke Report — 2026-02-22

## Status
PASS

## Execution
- **Agent**: smoke-agent
- **Time**: 2026-02-22T05:02:48Z
- **Platform**: linux (sandbox)

## Results
| Check | Status | Notes |
|---|---|---|
| `validate:scheduler` | PASS | Verified roster/prompts/parity |
| `test:integration:e2e` | PASS | 3 tests passed |
| `test:ci-resilience` | PASS | 3 tests passed |
| `npm test` | PASS | 372 tests passed |

## Observations
- Environment required `npm install` for `nostr-tools`.
- `npm test` passed without hitting known sandbox issues.
