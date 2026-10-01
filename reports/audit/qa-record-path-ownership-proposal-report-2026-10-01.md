# QA integrity-record ownership amendment for owner review

Status: approved, not applied. Approval `b1033688-7462-49b6-82f2-156a52e16af9`
is actual approved revision2 at08:56:16.649 UTC, decided by the arbiter under the
owner's in-scope delegation. This is not a fresh human alpha3 activation answer.
Only Project Kernel may apply the exact two-file amendment after safely
checkpointing/completing its current reservation task, with a narrow subsequent
assignment, fresh exact checks, independent QA and guarded integration. Live
ownership remains unchanged until landing/readback. Original proposed JSON and
its hash are preserved as approved evidence, not rewritten retrospectively.
Same task `TASK-a65500ed-a505-4664-badc-a1483d6f6f11` remains blocked on later
owned-path application and schema/scenario/implementation-phase review.
Owner requests `a9c521a3` and `10ed0773` require a concrete repair of the ownership
gap reported by QA `b405f09a`. Live query finds no primary/shared owner for
`docs/test-integrity/records/example.yaml`. Independent QA cannot grant consent
to an unowned production record path; relocating records into test fixtures or
granting blanket authority would not resolve this defect.

Propose adding **only `docs/test-integrity/records/**` to existing Independent QA's
primary `owned_paths`**, in both current configuration and active roster. No
migration metadata path is yet specified/reviewed, so none is proposed. Records
and any later provenance metadata inside this exact prefix remain subject to
immutable schema, lossless history mapping and named QA consent. This ownership
proposal creates no records and grants no implementation authority by itself.

Exact baseline: clean canonical `28c941d1ecbc3da8908a84f96c06ac0b929d4b19`.
Neither config nor roster has an explicit numeric revision field; use exact Git
commit, schema and SHA-256 preconditions. Effective organization revision is1.

| File | Schema | Baseline SHA-256 | Last path commit | Proposed operation |
| --- | --- | --- | --- | --- |
| `.torch/torch.yaml` | torch.dev/v1alpha1 | 4e21d6bf76dbcb983d984af2bf44a199ffb56d65e88a5c5f03cd678f196b329f | 94062020c767ab7ef12647860e8afed00055b7fd | Test domains[5].id=qa and entire owned_paths; append exact prefix |
| `.torch/roster.yaml` | torch.dev/roster/v1alpha1 | fb17fd5ad48893c22a6383a20aff06c31a2db6cdd1762ea2ec4d2902009dc3a1 | 2a8ec35dac1c4b603297176fd1a8dcce36300d2b | Test areas[6].id=qa and entire owned_paths; append exact prefix |

The machine-readable proposal at
`artifacts/TASK-a65500ed-a505-4664-badc-a1483d6f6f11/qa-record-path-ownership-proposal-2026-10-01.json`
contains exact guarded JSON Patch operations and projected complete values for
review. These are review artifacts, not live configuration. Pure validation of
projected configuration passes existing project schema and primary-overlap
validation; config/roster QA paths agree, existing six domain IDs/seven roster
identities remain, and derived organization revision remains1.

Existing `effectiveRoster` preserves roster ownership and overlays runtime/model
settings from configuration. Therefore both files must agree; config-only edits
would leave live `who_owns` unchanged. `refreshRoster` reads both canonical files
and inserts only missing existing roster identities. The proposed operation adds
no identity, hierarchy role, runtime/model/budget/timer change or provider start.
Historical approved domain proposal and install manifest are retained, not
rewritten as though prior consent covered this new path.

Manager has no authority to silently apply a material ownership change. Both
configuration files are themselves unowned by a current specialist path query;
request an explicit narrow owner decision naming the responsible applier and
these exact files. Recommend approving this two-file existing-QA amendment over
creating a new identity or a second primary owner. Deferring keeps the full
integrity-records task blocked on ownership plus reviewed schema/scenario and
implementation-phase authority; the activation decision is independent.

After owner decision, responsible applier must verify fresh base hashes/current
canonical, preserve all dirty peer files and unique commits, record actual actor
separately from target identity, and use task-named commit, strict exact checks,
independent QA and guarded serialized integration. No cross-area CLI operation
may misattribute Manager as QA/Kernel. Only after actual configuration landing
and current live `who_owns` resolves QA may QA consent to exact record/scenario
paths. Same Work Integration task remains blocked, with one implementation owner;
no migration, test rewrite or rollout follows automatically from path approval.
