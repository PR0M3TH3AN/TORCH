# Dashboard App Overview

## What this module does
The `dashboard/app.js` module is the main entry point for the frontend UI logic of the TORCH web dashboard. It manages the configuration loading cascading from URL queries, `localStorage`, and `torch-config.json` default settings, and maintains live WebSocket connections to Nostr relays. Incoming `LOCK_EVENT_KIND` events are parsed, de-duplicated, and pushed to the UI where they render as lock cards with remaining TTL status via a periodic interval.

## Main Execution Flow
1. **Config Setup**: `bootstrap()` loads settings via `loadTorchConfigFile()`, resolves preferences using `parseDashboardConfig()`, and populates global constants like `RELAYS` and `HASHTAG`.
2. **Relay Setup**: `init()` loops over the configured `RELAYS` and calls `connectToRelay()` for each.
3. **Data Subscription**: `connectToRelay()` opens a WebSocket, emitting a NIP-01 `REQ` for lock events tagged with the namespace over the past 7 days.
4. **Data Intake**: Incoming `EVENT` messages are parsed via `parseLockEvent()`, de-duplicated based on `dTag`, stored in `lockStore`, and logged into the `rawLog` DOM container.
5. **UI Rendering**: The receipt of events triggers `scheduleRender()`, which delegates to `renderLocks()` to build DOM nodes using `createLockCard()` for all active/filtered locks.
6. **Background Loop**: A 30s interval re-renders the DOM to decrement remaining lock TTL and update the CSS widths of progress bars.

## Usage Snippet
```js
// Within dashboard/index.html
<script src="app.js" type="module"></script>
```
*(The module invokes `bootstrap()` as its final statement).*

## Public API / Exports
*(Note: As an entrypoint module assigned via a direct `<script>` import to `window`, it does not export standard ES modules to other files. However, internally these serve as the public API hooks for HTML interactive handlers).*

| Function | Purpose |
|----------|---------|
| `fetchDocs()` | Asynchronously fetches `TORCH.md` and renders parsed markdown using marked and DOMPurify. |
| `loadTorchConfigFile()` | Asynchronously fetches and parses the local `torch-config.json` repository config file. |
| `parseDashboardConfig()`| Consolidates configs spanning URL search query overrides, localstorage, and standard file fallback values. |
| `connectToRelay()` | Opens and manages a resilient WebSocket connection with auto-reconnect logic and event handling. |
| `init()` | Iterates configured relays initiating the primary loop connection handlers. |
| `bootstrap()` | Primary async entrypoint which fetches configuration before setting DOM default filters and calling `init()`. |

## Invariants and Edge Cases
- **Duplicate Locks**: Handled using `dTag`. The latest `created_at` timestamp is preferred when determining state.
- **Relay Instability**: Dropped connections (`ws.close`) fire an automatic reconnect timeout loop after 5000ms.
- **Security Check**: Text content mapping to HTML utilizes `DOMPurify.sanitize()` when `fetchDocs()` is rendered to prevent XSS.
- **Background Throttling**: The global scope validates visibility via `!document.hidden` and `isAlive()` before polling or rendering frames to conserve resources.

## Why it works this way
Configuration runs dynamically to ensure that static builds generated using `npm run dashboard:serve` do not hard-fix user settings but allow live overrides using URL hash routing or LocalStorage variables. Events are debounced behind a `requestAnimationFrame` wrapper in `scheduleRender()` to avoid locking the DOM when heavily queried relays blast historical events.

## When to change
- **Config format evolution:** Update `loadTorchConfigFile()` if the parent directory structure, or schema definition of `torch-config.json` (`nostrLock` keys) change significantly.
- **Adding new Event Kinds**: Modify the websocket subscription filter (`kinds: [LOCK_EVENT_KIND]`) in `connectToRelay` if the dashboard expands visualization beyond raw agent locks.
- **Adding layout themes:** Update standard DOM manipulation styles in `createLockCard` if UI library changes.
