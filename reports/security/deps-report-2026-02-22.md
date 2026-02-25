# Dependency Security Report — 2026-02-22

## Executive Summary
- **Date:** 2026-02-22
- **Agent:** deps-security-agent
- **Scope:** Daily dependency audit

## Vulnerabilities (NPM Audit)
### Summary
- **Total:** 2
- **High:** 1
- **Moderate:** 1
- **Low:** 0
- **Info:** 0

### Details
- **minimatch** (High): ReDoS vulnerability. Fixed in 10.2.1.
- **ajv** (Moderate): ReDoS via `$data`. Fixed in 6.14.0.

## Outdated Packages (NPM Outdated)
### Direct Dependencies
- **eslint**: 10.0.0 -> 10.0.1 (Patch upgrade available).

## Actions Taken / Planned
1. Attempting safe upgrade for `eslint` (patch version bump).
2. Documented vulnerabilities for follow-up.
