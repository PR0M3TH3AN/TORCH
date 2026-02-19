# TORCH Evolution: The Node-Based Future

## 1. The Core Concept: From "Roster" to "Workflow"

Currently, TORCH is a **Round-Robin Scheduler**. It loops through a static list of agents (`daily`/`weekly`). This is great for maintenance but limits complex, multi-step tasks.

The "Bigger" vision is to evolve TORCH into a **Workflow Orchestrator** (similar to Airflow, Prefect, or ComfyUI, but for Autonomous Agents).

### The Shift
*   **Old**: `roster.json` (List) -> `Agent A`, `Agent B`, `Agent C`.
*   **New**: `workflows/refactor.json` (Graph) -> `Trigger` -> `Planner` -> `[Coder, Writer]` -> `Reviewer`.

## 2. The Node-Based UI

You mentioned a "concept for a node based evolution". This is the right move.
*   **Recommendation**: Build a web-based **Workflow Editor** using **React Flow** or **Svelte Flow**.
*   **How it works**:
    1.  **Drag & Drop Agents**: Drag a "Claude Node" or "Jules Node" onto the canvas.
    2.  **Connect Context**: Draw lines to show data flow. Output of "Planner" becomes context for "Coder".
    3.  **Visual Debugging**: Watch nodes light up Green/Red as the scheduler executes them in real-time.

## 3. Tool Integrations

Here is where the tools you mentioned fit in:

### A. OpenClaw (The Interface / Gateway)
*   **Role**: **The Conversational Trigger & Notification Layer**.
*   **Why**: OpenClaw excels at connecting to Discord/Slack/Telegram.
*   **Integration**:
    *   Don't make OpenClaw the *scheduler*. Make it the *interface*.
    *   You text OpenClaw: *"Run the 'Deep Refactor' workflow on `src/auth`."*
    *   OpenClaw triggers the TORCH backend and pipes updates back to your chat.

### B. ClaudeCode CLI & Codex CLI (The Workers)
*   **Role**: **Execution Nodes**.
*   **Why**: Your local machine (Jules) can't be the only brain forever.
*   **Integration**:
    *   Create specific "Nodes" in your graph for these tools.
    *   **"Claude Node"**: Wraps the `claude` CLI. Best for complex reasoning/architecture.
    *   **"Codex Node"**: Wraps the `codex` CLI. Best for pure code generation/completion.
    *   **"Local Node"**: Runs local models or scripts (what you do now).

## 4. The Roadmap (How to get there)

You don't need to do this alone. Here is a phased approach:

**Phase 1: The Graph Data Structure (Backend)**
*   Stop thinking in `roster.json`. Start thinking in `DAGs` (Directed Acyclic Graphs).
*   Create a schema for a "Workflow" (e.g., inputs, steps, outputs).
*   *Action*: I can help you draft this `workflow.schema.json`.

**Phase 2: The "Headless" Runner**
*   Modify `run-scheduler-cycle.mjs` to accept a `--workflow` argument instead of just looping a roster.
*   It executes the graph: runs Node A, passes output to Node B.

**Phase 3: The UI (The "Face")**
*   Build a simple React/Next.js app that reads these JSON workflow files and renders them with React Flow.
*   Allow editing and saving back to JSON.

**Phase 4: The Integrations**
*   Add "Nodes" for OpenClaw (notifications) and External CLIs (heavy lifting).

## 5. Summary Opinion
Taking TORCH "node-based" transforms it from a **Janitor** (cleaning up code daily) into a **Factory** (building features on demand).

*   **Tools**: Use **React Flow** for UI. Use **OpenClaw** for ChatOps.
*   **Strategy**: Keep the "Core" (locking/state) but replace the "Scheduler" (loop) with a "Runner" (graph).
