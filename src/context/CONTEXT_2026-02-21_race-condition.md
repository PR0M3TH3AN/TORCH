# Race Condition Context - 2026-02-21

## Overview
This run focused on identifying and fixing race conditions in background services, specifically related to `nostr-tools` interactions and WebSocket resource management.

## Goals
- Identify resource leaks in long-running processes (scheduler/relays).
- Prevent unhandled promise rejections that could destabilize the application.

## Constraints
- Must not introduce new dependencies.
- Must preserve existing retry logic and health check behavior.

## Assumptions
- `nostr-tools` implementation of `pool.publish` does not support `AbortSignal` for cancellation.
- WebSocket connections in `relay-health.mjs` are the primary source of file descriptor leaks if not closed on timeout.

## Changes
- `src/relay-health.mjs`: Added explicit `ws.close()` in `catch` blocks for timeout scenarios.
- `src/lock-publisher.mjs`: Added `.catch(() => {})` to publish promises to suppress unhandled rejections.
