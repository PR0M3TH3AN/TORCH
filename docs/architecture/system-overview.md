# TORCH System Architecture

## High-Level Overview

```mermaid
graph TB
    subgraph Agents["AI Agent Platforms"]
        Jules["Jules"]
        Claude["Claude Code"]
        Codex["Codex"]
        Goose["Goose"]
    end

    subgraph TORCH["TORCH CLI / Scheduler"]
        CLI["bin/torch-lock.mjs"]
        Lib["src/lib.mjs<br/>Command Dispatch"]
        LockOps["src/lock-ops.mjs<br/>Lock Publisher / Query"]
        Health["src/relay-health.mjs<br/>Relay Health Monitor"]
        Scheduler["scripts/agent/<br/>run-scheduler-cycle.mjs"]
    end

    subgraph Nostr["Nostr Network"]
        R1["Relay 1<br/>relay.damus.io"]
        R2["Relay 2<br/>nos.lol"]
        R3["Relay 3<br/>relay.primal.net"]
    end

    subgraph Dashboard["Dashboard"]
        Server["src/dashboard.mjs<br/>HTTP Server"]
        UI["dashboard/index.html<br/>+ app.js"]
    end

    subgraph Memory["Memory Subsystem"]
        Ingestor["Ingestor"]
        Retriever["Retriever"]
        Pruner["Pruner"]
        Store["memory-store.json"]
    end

    Agents -->|"torch-lock lock/check/complete"| CLI
    CLI --> Lib
    Lib --> LockOps
    LockOps -->|"NIP-01 Events<br/>(kind 30078)"| R1 & R2 & R3
    Health -->|"Probe & Track"| R1 & R2 & R3
    Scheduler -->|"Orchestrate"| CLI

    Server -->|"Serve Static"| UI
    UI -->|"WebSocket SUB"| R1 & R2 & R3

    Lib --> Ingestor
    Lib --> Retriever
    Ingestor --> Store
    Retriever --> Store
    Pruner --> Store
```

## Lock Lifecycle

```mermaid
sequenceDiagram
    participant Agent
    participant TORCH as TORCH CLI
    participant Relays as Nostr Relays

    Agent->>TORCH: torch-lock check --cadence daily
    TORCH->>Relays: Query active locks (REQ filter)
    Relays-->>TORCH: Existing lock events
    TORCH-->>Agent: Status: available / locked

    Agent->>TORCH: torch-lock lock --agent my-agent
    TORCH->>TORCH: Generate NIP-01 event (kind 30078)
    TORCH->>Relays: Publish lock event (fanout)
    Relays-->>TORCH: ACK from N relays
    TORCH->>Relays: Race-check query (verify no conflicts)
    Relays-->>TORCH: Confirm lock acquired
    TORCH-->>Agent: Lock acquired (exit 0)

    Note over Agent: Agent performs work...

    Agent->>TORCH: torch-lock complete --agent my-agent
    TORCH->>Relays: Publish completion event
    TORCH-->>Agent: Completed (exit 0)
```

## Scheduler Flow

```mermaid
flowchart TD
    Start["Scheduler Cycle Start"] --> LoadRoster["Load Roster<br/>(roster.json)"]
    LoadRoster --> Filter["Filter by cadence<br/>(daily/weekly)"]
    Filter --> CheckPaused{"Agent<br/>paused?"}
    CheckPaused -->|Yes| Skip["Skip agent"]
    CheckPaused -->|No| CheckCompleted{"Already<br/>completed<br/>today?"}
    CheckCompleted -->|Yes| Skip
    CheckCompleted -->|No| CheckLock{"Lock<br/>available?"}
    CheckLock -->|No| Skip
    CheckLock -->|Yes| Acquire["Acquire Lock"]
    Acquire --> RunAgent["Execute Agent Prompt"]
    RunAgent --> Complete["Publish Completion"]
    Complete --> LogResult["Write Task Log"]
    Skip --> LogResult
    LogResult --> Next{"More<br/>agents?"}
    Next -->|Yes| CheckPaused
    Next -->|No| End["Cycle Complete"]
```

## Memory Subsystem

```mermaid
flowchart LR
    Events["Runtime Events"] --> Ingestor
    Ingestor --> |"Chunk + Summarize"| Store["Memory Store<br/>(JSON file)"]
    Store --> Retriever
    Retriever --> |"Rank: semantic +<br/>importance + recency"| Results["Ranked Memories"]

    Scheduler["Maintenance<br/>Scheduler"] --> Pruner
    Pruner --> |"TTL / merge /<br/>archive / delete"| Store

    subgraph Jobs["Scheduled Jobs"]
        J1["Ingest (1-5 min)"]
        J2["Consolidate (1 hr)"]
        J3["Prune (daily)"]
        J4["Deep Merge (weekly)"]
    end
    Scheduler --> Jobs
```

## Key Data Flows

| Flow | Protocol | Event Kind | Key Fields |
|------|----------|-----------|------------|
| Lock acquire | NIP-01 publish | 30078 | d-tag, expiration, agent, cadence, status |
| Lock query | NIP-01 REQ | 30078 | #t filter on hashtag |
| Lock complete | NIP-01 publish | 30078 | status: "completed" |
| Dashboard feed | NIP-01 WebSocket | 30078 | Real-time SUB with since filter |

## Directory Structure

```
TORCH/
├── bin/                    # CLI entry point
├── src/
│   ├── lib.mjs             # Command dispatch
│   ├── lock-ops.mjs        # Nostr relay operations
│   ├── relay-health.mjs    # Relay health monitoring
│   ├── dashboard.mjs       # Dashboard HTTP server
│   ├── ops.mjs             # Install/update operations
│   ├── services/
│   │   ├── memory/         # Memory subsystem
│   │   └── governance/     # Governance service
│   └── prompts/            # Agent prompt definitions
├── dashboard/              # Dashboard frontend
├── scripts/agent/          # Scheduler and agent scripts
├── test/                   # Test suite
├── docs/                   # Architecture documentation
└── migrations/             # Database schemas (future)
```
