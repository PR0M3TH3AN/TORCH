# npm test timeout reproduction

## Issue
`npm test` hangs/times out in full suite run. It takes over 400s and times out in sandbox environment.

## Reproduction
This directory contains a script `repro.sh` that attempts to run `npm test` and times out after 30s to demonstrate the issue without waiting the full duration.

## Run
```bash
bash artifacts/reproducers/npm-test-timeout/repro.sh
```

## Logs
Output is captured in `npm_test_output.log`.
