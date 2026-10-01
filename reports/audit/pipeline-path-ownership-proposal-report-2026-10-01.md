# Pipeline source ownership draft for peer review

Status: draft; no owner approval, assignment or configuration application.
Work Integration peer `e4ecfb88-4f89-4db0-867b-79975920fc11` agrees the precise
prefix/owner proposal after independent artifact hash and live ownership checks.
QA peer `935ff690-3662-4f62-ba46-d1c3160f5871` also agrees the owner/interface
choice. Kernel review remains open; peer agreement is not owner approval.
Existing `TASK-conversation-pipeline-definitions` remains proposed revision1.
Owner request `94010b22` asks for a reviewed amendment before implementation.
Live `src/pipelines/definitions.mjs` has no primary or shared owner.

Recommend appending only **`src/pipelines/**` to Work and Integration's primary
owned paths** in both `.torch/torch.yaml` domains[2] and `.torch/roster.yaml`
areas[3]. Work already owns backlog, checks, resources, delivery and serialized
integration. Optional versioned pipeline DAGs and pinned stage artifacts/checks
fit that execution context. Project Kernel reviews portable project/spec and
organization contracts; Runtime owns execution/session boundaries; QA owns
independent scenarios. Existing specialists suffice; no new identity or
coordinator activation is proposed. A pipeline definition's single flow
coordinator is not a new Fleet role or a competing task queue.

Alternative: Kernel primary ownership would keep definition schema near portable
project configuration but move execution provenance/contracts away from their
existing owner. A later measured split may separate schema from engine; this
draft does not invent two overlapping primary owners or shared blanket consent.
Ask Kernel and Work to agree this exact prefix and interface contract before
submitting a material ownership decision to the owner.

Baseline is clean canonical `cb145e56cb7d530f9563b98d4f9920ff0372a67a`.
Neither file has a numeric revision; derived organization revision remains1.

| File | Schema | Baseline SHA-256 | Proposed guard/operation |
| --- | --- | --- | --- |
| `.torch/torch.yaml` | torch.dev/v1alpha1 | 4e21d6bf76dbcb983d984af2bf44a199ffb56d65e88a5c5f03cd678f196b329f | Test domains[2].id and full old owned_paths; append src/pipelines/** |
| `.torch/roster.yaml` | torch.dev/roster/v1alpha1 | fb17fd5ad48893c22a6383a20aff06c31a2db6cdd1762ea2ec4d2902009dc3a1 | Test areas[3].id and full old owned_paths; append src/pipelines/** |

Review artifact:
`artifacts/TASK-conversation-pipeline-definitions/pipeline-path-ownership-proposal-2026-10-01.json`,
SHA-256 `2f9e6adf88b7628244a47907256115b5cb8a2cc9e7a1e2e5b71a5464cbfb10e8`.
It includes exact JSON Patch preconditions and complete projected values.
Pure validation passes canonical project schema, primary ownership overlap,
config/roster agreement and full-value equality with exactly one append per
file. Six domains/seven roster identities and all other fields remain unchanged.
An initial subprocess comparison hit sandbox EPERM; validation was rerun using
read-only canonical file bytes with exact hash preconditions, without escalation,
installation or live configuration mutation.

This projection is independent of approved QA-record amendment b1033688. Both
have the same currently unchanged file hashes: applying either invalidates the
other's whole-file precondition. Rebase the later reviewed amendment against the
actual landed configuration, preserving the earlier approved prefix and all
other values; never overwrite one proposal with the other's full projected file.
Historical approved proposals/install manifests remain intact.

The source task remains queued while reliability dependencies finish. Future
implementation requires actual reviewed ownership landing/readback, exact scope,
assignment continuity, interface/path consent and independent QA. Required
scenario truth includes cycles/unknown owners/ambiguous contracts/duplicate
authority rejection, reviewed definition changes, and unchanged ordinary task
flow when no pipeline exists. No COMBATRIG-specific stages, provider start,
automatic wake, release, configuration application or test expectation change
follows from this draft. Both configuration files themselves need an explicit
narrow owner decision naming the applier after peer review.
