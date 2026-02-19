# Proposal: Node-Based Prompt Engineering Editor

## Context

TORCH orchestrates 44 agent prompts (23 daily, 21 weekly) via a round-robin scheduler backed by Nostr relay locks. The prompts follow a consistent Markdown convention — shared contract header, identity line, mission statement, authority hierarchy, scope, constraints, workflow — but have no machine-readable metadata beyond what the three validation scripts check (`validate-prompt-contract.mjs`, `validate-scheduler-roster.mjs`, `validate-scheduler-flow-parity.mjs`).

Today, understanding how agents relate to each other requires reading all 44 Markdown files. There is no way to answer questions like "which agents produce security reports?", "which agents are read-only?", or "what implicit dependencies exist between agents?" without manual inspection.

The scheduler itself is a flat round-robin over `roster.json`. The current daily/weekly cadence model is just one possible execution topology. If prompts were modularized with structured metadata, the same agents could be composed into arbitrary flows — for example, a security-focused DAG where `deps-security-agent` runs before `fuzz-agent`, which gates `smoke-agent`.

## Proposal

Build a **node-based prompt engineering editor** in three incremental phases:

1. **Metadata extraction** — Parse all prompts into a machine-readable graph model (JSON).
2. **Structured frontmatter** — Add YAML frontmatter to all prompts, creating a schema-validated metadata layer.
3. **Interactive visualization** — A new dashboard page that renders the agent fleet as a directed graph using Cytoscape.js.

Each phase delivers value independently. The visualization is read-only; a future Phase 3+ would add editing capabilities through the existing governance proposal system.

## Architecture Constraints

These constraints are derived from the current codebase and should be respected:

- **No new frontend framework.** TORCH is a CLI toolkit with a vanilla JS dashboard. The CSP already allows `cdn.jsdelivr.net`. Use Cytoscape.js via CDN, not React Flow + Vite.
- **No new runtime dependencies.** Extraction and validation scripts use only Node.js built-ins.
- **Existing validators must not break.** `validate-prompt-contract.mjs` uses `content.includes()` to find tokens. `src/services/governance/index.js` uses regex on file content for `Shared contract (required):` and `Required startup + artifacts + memory + issue capture`. YAML frontmatter prepended before the shared contract blockquote is transparent to both.
- **Governance model preserved.** Future editing features must route through `createProposal()` in `src/services/governance/index.js`, not write files directly.

---

## Phase 0: Metadata Extraction & Graph Model

**Goal:** Parse all 44 prompts into `artifacts/prompt-graph/graph.json` without modifying any existing files.

### New Files

```
scripts/prompt-graph/
├── extract-metadata.mjs       # Regex extraction from prompt Markdown
├── build-graph.mjs            # Combines metadata + roster.json + torch-config.json → graph.json
├── graph-model.schema.json    # JSON Schema for the graph output format
└── validate-graph.mjs         # Checks graph integrity (all roster agents have nodes, etc.)
```

### Extraction Patterns

The following regex patterns extract metadata from the current prompt format:

```javascript
// Identity — "You are: **governance-agent**, responsible for..."
/You are:\s*\*\*([^*]+)\*\*,?\s*(.+?)\.?\s*$/m

// Mission — "Mission: Ensure that all prompt changes..."
/(?:Your\s+(?:single-purpose\s+)?)?[Mm]ission:\s*\*?\*?(.+?)(?:\*\*)?$/m

// Report output directories — "reports/audit/", "reports/security/"
/reports\/([a-z-]+)\//g

// Scope directories — between "In scope:" and "Out of scope:" or next divider
// (Section-based extraction, not a single regex)
```

These patterns work against the current prompt format. They are heuristic — some prompts use slight variations ("Your single-purpose mission:", `===` vs `───` dividers). The extraction script should log warnings for prompts that don't match expected patterns, requiring manual review.

### Graph Model

**Node types:**

| Type | Represents | Example ID |
|------|-----------|------------|
| `scheduler` | Daily or weekly scheduler | `scheduler:daily` |
| `agent` | An agent prompt | `agent:governance-agent` |
| `artifact` | An output directory | `artifact:reports/audit/` |
| `policy` | A shared policy file | `policy:AGENTS.md` |

**Edge types:**

| Type | Meaning | Example |
|------|---------|---------|
| `schedules` | Scheduler runs this agent (from roster order) | `scheduler:daily` → `agent:audit-agent` |
| `produces` | Agent writes to this directory | `agent:audit-agent` → `artifact:reports/audit/` |
| `reads` | Agent reads this policy file | `agent:audit-agent` → `policy:AGENTS.md` |
| `depends_on` | Agent B consumes Agent A's output | `agent:prompt-fixer-agent` → `agent:prompt-safety-agent` |

**Example node in `graph.json`:**

```json
{
  "id": "agent:governance-agent",
  "type": "agent",
  "label": "governance-agent",
  "properties": {
    "cadence": "daily",
    "category": "governance",
    "mode": "read-write",
    "role": "responsible for reviewing and applying prompt change proposals",
    "mission_summary": "Ensure that all prompt changes follow the established governance rules",
    "prompt_file": "src/prompts/daily/governance-agent.md",
    "outputs": ["src/decisions/"],
    "scope_dirs": ["src/proposals/", "src/prompts/daily/", "src/prompts/weekly/"]
  }
}
```

### npm Script

```json
"graph:build": "node scripts/prompt-graph/build-graph.mjs"
```

---

## Phase 1: YAML Frontmatter Schema & Migration

**Goal:** Add structured YAML frontmatter to all 44 prompt files, creating a schema-validated metadata layer that the graph builder, validators, and future editor can consume.

### Frontmatter Schema

```yaml
---
agent: governance-agent          # required, must match roster.json entry
cadence: daily                   # required, enum: daily | weekly
category: governance             # required, see enum below
mode: read-write                 # required, enum: read-only | read-write
role: "prompt change reviewer"   # optional, extracted from "You are:" line
mission_summary: "Review and apply prompt change proposals"  # optional, ≤200 chars
outputs:                         # optional, directories this agent produces
  - src/decisions/
scope_dirs:                      # optional, directories in scope
  - src/proposals/
depends_on: []                   # optional, other agent IDs whose output this agent reads
---
```

**Category enum:** `audit`, `security`, `docs`, `performance`, `governance`, `maintenance`, `testing`, `refactor`, `synthesis`, `infrastructure`, `debug`, `research`, `proposal`

### What belongs in frontmatter vs. the prompt body

Frontmatter captures **machine-queryable classification metadata**: category, mode, cadence, outputs, dependencies. The prompt body retains the **behavioral specification**: the actual instructions, constraints, workflow steps, and failure modes that the agent executes. Frontmatter should not duplicate prose from the body. The `mission_summary` field is the one overlap — it should be a short (≤200 char) summary, not a copy of the Mission section.

### Compatibility

The frontmatter is prepended *before* the existing shared contract blockquote. This is safe because:

- `validate-prompt-contract.mjs` uses `content.includes()` — the `## Required startup` heading and all 11 contract tokens remain in the file body unchanged.
- `src/services/governance/index.js` `validateProposal()` uses `regex.test(newContent)` — both required patterns (`Shared contract (required):`, `Required startup + artifacts + memory + issue capture`) still match.
- `validate-scheduler-roster.mjs` checks file existence by name, not content.

### New Files

```
scripts/prompt-graph/
├── frontmatter.schema.json        # JSON Schema for validation
├── migrate-add-frontmatter.mjs    # One-time migration: extract metadata, prepend YAML
└── validate-frontmatter.mjs       # Validate frontmatter against schema, cross-check roster
```

### Safety Gate

The migration script must run all existing validators after modifying files:

```bash
node scripts/prompt-graph/migrate-add-frontmatter.mjs
npm run validate:scheduler  # must still pass
```

### Drift Prevention

The `validate-frontmatter.mjs` script should cross-check the `agent` field against the `You are: **<name>**` line in the body. For other fields (like `mission_summary`), drift is expected since the frontmatter is a summary. The `prompt-maintenance-agent` (weekly) could be extended to detect frontmatter staleness.

---

## Phase 2: Interactive Graph Visualization

**Goal:** A new dashboard page that renders the agent DAG as an interactive, read-only graph.

### New Files

```
dashboard/
├── graph.html      # Graph visualization page
└── graphUtils.js   # Graph data loading, Cytoscape config, styling, interaction handlers
```

### CDN Dependencies

All already permitted by the CSP (`script-src ... https://cdn.jsdelivr.net`):

```html
<script src="https://cdn.jsdelivr.net/npm/cytoscape@3.30.4/dist/cytoscape.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/dagre@0.8.5/dist/dagre.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/cytoscape-dagre@2.5.0/cytoscape-dagre.js"></script>
```

### Dashboard Server Change

In `src/dashboard.mjs`, add to the `allowedPaths` array (line 154):

```javascript
path.join(packageRoot, 'artifacts', 'prompt-graph'),
```

This allows the graph page to fetch `graph.json` from same-origin.

### Layout

- **DAG layout** (dagre): Schedulers at top → Agents in middle → Artifacts at bottom
- **Left-right flow** for readability with 44+ nodes

### Visual Encoding

Node colors by category, using existing CSS custom properties from `dashboard/styles.css`:

| Category | Color token | Hex |
|----------|------------|-----|
| audit | `--color-accent` | blue |
| security | `--color-danger` | red |
| docs | `--color-info` | cyan |
| performance | `--color-warning` | yellow |
| governance | `--color-success` | green |
| testing | `--color-info` | light blue |
| maintenance | `--color-text-muted` | gray |

Edge styles by type: `schedules` = solid, `produces` = dashed, `reads` = dotted, `depends_on` = bold.

### Interaction

- **Click node** → Side panel shows: agent name, role, mission summary, category/cadence/mode badges, output dirs, scope dirs, dependencies. Prompt Markdown rendered via the already-loaded `marked.min.js`.
- **Cadence filter** → Show daily / weekly / all.
- **Category filter** → Multiselect checkboxes.
- **Toggle layers** → Show/hide artifact nodes, policy nodes.
- **Search** → Filter nodes by name substring.

### Navigation

Add a link from the main dashboard (`dashboard/index.html`) to the graph page.

---

## Phase 3+ (Future): Interactive Editing & Custom Flows

This phase is out of scope for the initial implementation but documented here for roadmap context.

### Prompt Editing via Governance

- Side-panel form editing of frontmatter fields.
- Drag-to-connect `depends_on` edges.
- Every edit creates a governance proposal via `createProposal()` (`src/services/governance/index.js`) rather than writing files directly.
- The governance-agent reviews and applies proposals during its normal run cycle.

This requires new API endpoints in `src/dashboard.mjs`:

```
GET  /api/graph         → returns graph.json
GET  /api/prompt/:agent → returns prompt file content
POST /api/proposals     → creates a governance proposal
GET  /api/proposals     → lists pending proposals
```

### Custom Flow Configurations

The current scheduler runs flat round-robin over `roster.json`. Custom flows would evolve the roster format:

```json
{
  "flows": {
    "daily-standard": {
      "type": "round-robin",
      "agents": ["audit-agent", "ci-health-agent", "..."],
      "trigger": { "schedule": "daily" }
    },
    "security-scan": {
      "type": "dag",
      "nodes": [
        { "agent": "deps-security-agent" },
        { "agent": "fuzz-agent", "depends_on": ["deps-security-agent"] }
      ],
      "trigger": { "schedule": "weekly" }
    }
  }
}
```

This requires significant changes to `scripts/agent/run-scheduler-cycle.mjs` (currently assumes flat round-robin), the lock model (currently one lock per agent per cadence per day), and the task-log format. The graph model and frontmatter from Phases 0-2 lay the groundwork but don't enable this directly.

### Simulation / Dry-Run

A "simulate" button that walks the DAG, checks preflight files exist, validates `graph.json` integrity, and reports expected outputs without executing any agents. Useful for validating flow configurations before deploying them.

---

## Risks and Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Frontmatter breaks existing validators | High | Migration script runs all validators as post-check. Verified that `content.includes()` and regex patterns are unaffected by prepended YAML. |
| Frontmatter drifts from prompt body | Medium | `validate-frontmatter.mjs` cross-checks `agent` field against `You are: **<name>**` line. Weekly `prompt-maintenance-agent` can detect staleness. |
| Extraction regex misses edge cases | Medium | 44 prompts use slight variations. Script logs warnings for non-matching prompts; manual review required. |
| `graph.json` becomes stale after prompt edits | Medium | Add `graph:build` to CI or the `validate:scheduler` script chain. |
| Cytoscape.js CDN unavailable | Low | Same pattern as existing `marked.min.js` CDN usage. Pin exact versions. |
| 44-file frontmatter migration is a large diff | Medium | Migration script is idempotent. Review via `git diff` before committing. |

## Relationship to Other Proposals

This proposal complements [Prompt Packages](./prompt-packages.md). Prompt packages define *which* agents are installed for a given project type. The node-based editor would visualize the installed package as a graph and allow users to see and eventually customize the flow for their specific project. The frontmatter schema should be designed to be compatible with the package metadata format once that proposal is implemented.
