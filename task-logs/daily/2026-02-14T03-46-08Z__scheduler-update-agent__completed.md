---
agent: scheduler-update-agent
status: completed
cadence: daily
date: 2026-02-14
---

# Scheduler Update Agent Report

## Summary
The scheduler rosters have been synchronized with the prompt files on disk.

## Changes
- Updated `src/prompts/roster.json`:
  - Reordered `repo-fit-agent` in weekly roster to correct alphabetical order.
  - (Note: `torch-garbage-collection-agent` was already present in daily roster).
- Updated `src/prompts/daily-scheduler.md`:
  - Added `torch-garbage-collection-agent` to the roster table (it was missing).
- Updated `src/prompts/weekly-scheduler.md`:
  - Reordered the roster table to match `roster.json`.

## Verification
- Verified that all 22 daily agents are present in `roster.json` and `daily-scheduler.md`.
- Verified that all 17 weekly agents are present in `roster.json` and `weekly-scheduler.md`.
- Confirmed alphabetical sorting in all files.
