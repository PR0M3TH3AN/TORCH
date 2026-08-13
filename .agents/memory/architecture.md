# Architecture

Durable architectural decisions and constraints for TORCH.

## v2 is a development-network expansion, not a protocol rewrite

The v2 "Development Network" rework expands TORCH from community-funded
maintenance and analysis into three modes — Stewardship (maintain existing
projects), Build (maintainer-approved features), Foundry (incubate new
projects) — sharing one funding/locking/scheduling/verification
infrastructure. A stated co-equal design objective is custody minimization:
route compute principal directly to providers or task-specific credentials
while TORCH/BitUnlock earn transparent service fees.

Authoritative source:
- docs/v2/DEVELOPMENT_NETWORK_SPEC.md (§1–2)
- docs/v2/INCREMENTAL_DEV_PLAN.md

## v2 builds on verified 1.x seams (bridge wins on facts, spec on intent)

The architecture bridge maps spec intent onto code reality and pins the seams
v2 must reuse: the kind-30078 lock protocol already carries provenance
(gitCommit, promptPath, promptHash) and can gain campaign/milestone/lease IDs
without changing the event kind; the scheduler is the sole completion
authority (durable task-log written only after completion publishes); and
`scripts/agent/run-selected-prompt.mjs` is the single execution seam where
sandboxing, gateway routing, metering, and credential injection attach. The
earlier TORCH_EVOLUTION_CONCEPT roster→DAG idea is not a competing direction —
it survives as the orchestration layer inside v2 milestones.

Authoritative source:
- docs/v2/V2_ARCHITECTURE_BRIDGE.md (§1–2)
- docs/TORCH_EVOLUTION_CONCEPT.md
