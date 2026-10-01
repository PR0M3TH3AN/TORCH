# Proposed Phase B: authenticated candidate context and receipt adapter

Status: broad Phase B remains proposed. Actual QA03e2 grants usable narrow B0
consent; actual arbitercc6c authorizes that named Kernel implementation contribution
only. No broader protocol or operational activation authority. Earlier no-code
reviews below are retained chronologically and superseded solely for exact B0.
This is a phase of existing TASK-6e4ff870-a386-4a11-a59c-444ebc23732e;
no new assignment, identity, queue or full-task closure is requested here.
Current authoritative brief is d7e6d69. Kernel's proposed sections18/20 and
ADR026 at 6fdb88ea supply design context, not normative gate changes.

## Current complete contract review: Kernel b681, 15:04 UTC

Manager read the complete durable message **b6818413-798a-450c-ad20-dfca25f45f77**
(14:54 UTC), including all six paths, CandidateStore/v1 table definitions,
issuer/reader/parent composition, lifecycle CAS and proof admission. The earlier
959 shape discussion below is historical; current technical decisions target b681.
Current task is Work verification7 at exact316/a178 landed; native QA and permitted
development-ref source synchronization are resolved, not whole-task completion.
No code, source/test edit, registered provisioning or activation is authorized.

The new contract specifies candidate_store_meta, candidate_attempts,
candidate_results, candidate_source_receipts and a reconciliation index; independent
E/S/A and attempt/guard/lease/fence digests; busy_timeout=0 and short BEGIN IMMEDIATE
mutations; issued -> executing -> sealed -> finalized one-row CAS; result plus
eligible receipt in one transaction; SELECT-only reconciliation. UNKNOWN retains
the open attempt and guards, never a terminal result or replay. Definition/input/
output and artifact bounds are named. Module-private fixture authority, pure
managed metadata reader and parent-only engine composition replace the previously
unnamed seams. These are concrete progress, subject to the exact issues below.

| Boundary | Manager review decision | Exact unresolved evidence/contract |
| --- | --- | --- |
| Executable DDL and digests | Not yet executable or uniquely canonical | Supply exact ordered CREATE TABLE/INDEX/PRAGMA statements, UTF-8/LF byte representation and a versioned length-framed or canonical envelope. Define which bytes/digests are inputs; exclude self-referential stored digest values. Pin schema_digest separately from ddl_digest, logical-state ordering and SQLite configuration. |
| SQL invariants and byte limits | Application assertions alone are insufficient evidence | SQL length(TEXT) measures characters, while stated limits are bytes. Pin enforced UTF-8 limits and null/hex/type pairing for optional schema/proof fields; cross-row result/attempt/PASS-only receipt linkage must reject forged combinations at the declared boundary. |
| Reachable private fixture issuer | Private WeakMap verification is useful, but issuance is undefined | An external harness cannot call a module-private issuer as stated. Specify a supported composition that creates its own fresh synthetic mkdtemp target, retains the private issuer, returns only bounded nonpromotable operations/attestation and rejects caller paths/registered selectors. No exported issue-from-path escape hatch. |
| Fixture positive CAS evidence | Current blanket fixture rejection leaves a positive test gap | Define a separate nonpromotable fixture-result transaction surface for valid issue/start/seal/finalize/crash scenarios, while the registered receipt adapter always refuses fixtures. No fixture native PASS or copied registered-looking fixture receipt. |
| Input read versus execution use | Wrapper hash attests byte receipt only | Pin a versioned consumer/dataflow that uses the bound immutable representation for the declared check, attempt/channel/direct-child identity binding and replay limits. An untrusted child statement, token echo or copied-byte digest cannot prove arbitrary executor use. |
| Descendant terminal coverage | Process-group emptiness is insufficient | A child can leave the group. Name an enforceable supervised execution boundary and its verifier/coverage limits; if escape prevention or complete terminal coverage is unavailable, retain UNKNOWN and refuse PASS. PID/group sampling alone cannot discharge this requirement. No same-user OS containment claim. |
| Trusted metadata composition | Initialized MCP seam cannot substitute pure reader | Actual server opens ControlPlane before assertIdentity; claimedIdentity uses that initialized instance. Pin pure launch binding validation, reader/verifier dependencies and refusal of unavailable/incompatible state without open/DDL. cwd/env are inputs to validate, not sufficient authority by themselves. |

Manager routed exact decisions to current resumed QA **7fd57562**, Work **5638f592**
and Kernel **8446d2bb**. These are bounded decisions on b681, not a new generic
design loop or implementation assignment. QA contributor/scenario consent and Work
parent/engine protocol agreement are distinct required decisions. Until their
actual current replies, no bounded next implementation scope is recorded as agreed.
Legacy compatible schema2 receipts retain meaning and current required3/current2
native refusal stays intact. Host/provider/wake/installation/approval75, live DDL,
CLI and existing native consumers remain excluded. Full56 backlog remains open;
idempotencyc178 is proposed and both original/duplicate integration records remain.

Actual QA **78cdac6d-0546-472d-b8c6-de1619f9e27e** at15:04 grants conditional
scenario/path consent only for six Kernel paths, three tests and append-only TIN;
it is **not actionable consent or code authority** until byte-canonical DDL with
per-connection FK verification/no caller schema, reachable private fixture harness,
framed E/S/A, attempt/child/full-pipe proof, PGID-only UNKNOWN and closure-only
nonpromotable fixture finalization are pinned. QA excludes OS and semantic-use
claims and says current Phase A cannot PASS under the proposed protocol. Work's
current protocol agreement is separately pending. Manager requests confirmation
that QA's peer-addressed Kernel7992 copy is the same concrete b681 revision.
Byte receipt must stay visibly narrower than actual arbitrary-check input use;
the full task's frozen-input/native consumption criterion remains unproved, not
weakened by relabelling this bounded prototype. No next code scope is agreed yet.

## Entry conditions and scope decision

Current **arbitercc6c43ab** (15:10:28) authorizes B0 after actual usable QA03e2,
within SAME6e4 named Kernel contribution: only the two new store/provisioner
modules, new store test and append-only TIN under five strict scenarios. Arbiter
reports existing Kernel clean6fdb88ea/no prior active handle and controls resume;
Manager launches nothing and creates no second assignment. Work stays full-task
owner; current metadata-only verification8 preserves all criteria/history/exact316.
Manager50d/d1e routes actual scope and independent QA follow-up. There is no stale
conditional QA/owner wait for B0. Broader Work parent/engine protocol agreement,
real immutable-check input consumption and enforceable descendant coverage remain
separate future gates; B0 does not implement or claim them. No context/parent/
adapter/lifecycle/CAS/result/receipt/consumer/CLI/registeredDDL/schema/installation/
host/wake change. Actual clean task-named candidate and independent QA must precede
any source qualification; fixture provision is never a native receipt or full-task
completion. This records authorization, not observed implementation or acceptance.

Owner **08f9a5f0** supplies a narrower next review target: B0 only, same6e4 named
Kernel contribution, two new store/provisioner modules, one store test and
append-only TIN. It excludes context/parent/adapter/Work protocol implementation
and registered lifecycle/result/receipt activation. Manager **b0f9e319** requests
explicit actionable QA consent for exactly that slice, **478265ba** routes the
corrected byte-defined internal DDL/private fixture composition requirements to
Kernel, and **4ec215f9** requests Work's actual current protocol decision/source
references. Conditional QA78cd does not authorize it; the arbiter will decide
implementation only after actual consent. This is a review target, not an agreed
next implementation scope or code assignment. Owner's two existing snapshot tests
PASS are narrow reusable evidence, not new parent/input/descendant qualification.

Actual **QA03e2b4ed-0735-4de6-b599-5a5a5633bf9b** at15:08:48 grants usable B0
contributor/scenario consent, subject to the corrected narrow contract, for exactly
the two store/provisioner source modules, new store test and append-only TIN.
Manager **152ce665** relays that exact permission to Kernel without code authority.
The granted five observable scenarios are:

1. Only internally fixed ordered UTF-8/LF executable CREATE/INDEX bytes execute
   in the synthetic fixture; independently asserted version-framed DDL/schema
   digest preimages exclude metadata self-reference. Order/CRLF/version/digest/
   schema drift refuses; expected values are not generated by the implementation.
2. Every fixture connection enables and verifies foreign_keys=ON/user_version=1;
   disabled/unverifiable FK and malformed digest/metadata fields refuse.
3. The closure factory alone creates mkdtemp and synthetic identity/private
   WeakMap capability, exposes no raw root/DB and accepts no caller DDL/root/DB/
   path/manifest/registered selector. Corruption is enumerated, bounded test input.
4. Expired/closed/reused/foreign/nonempty/drifted/registered-related targets refuse
   with bounded reason before registered DDL.
5. Fixture attestation stays permanently nonpromotable; no registered store,
   lifecycle/CAS/result/receipt/native consumer/CLI or native PASS follows.

TIN is new_tests, five scenarios, hermetic controlled corruption/no retries,
no assertion relaxation and explicit B0 exclusions. Later CAS/input/fence scopes
are not silently included. **Work's current direct protocol agreement and Kernel's
exact corrected executable contract are still open handoffs.** Usable QA consent
alone does not approve next implementation; arbiter authorization is separate.
No code assignment, source/test edit or full-task acceptance is recorded here.

Work Phase A corrected candidate b1c4c26b is implemented and currently clean.
QA1b804 narrowly accepts 13 focused hermetic scenarios and classifies the separate
five-PNG incident without an archive/dirty-byte claim. Local full checks remain
development evidence. Guarded convergence to canonicale8c4c424 produced clean316d8b74.
Four fresh native PASS receipts and independent QAc841 exact source/native-gate
acceptance now exist; native originala178 landed that exact source at14:44:26.
Source entry evidence is resolved; full task and operational proof remain open.
Narrow acceptance excludes actual child input consumption, OS containment and a
concurrent-writer atomic directory snapshot; those are explicit future proof gaps. Preserve
9946 rejection, all current/old receipts, actual restoration command history and
old cce needs_convergence. No archive is claimed without actual evidence.

Recommendation: approve only a Kernel-owned hermetic implementation trial after
those entry conditions and the exact interfaces/tests below are accepted.
Review B0, B1 and B2 separately; decline or revise any unresolved contract before
code. Manager must reread current brief and next-task selection before an actual
assignment. Kernel's reservation125, inbox565 and inventory1e688 histories stay
blocked and intact. A later Kernel implementation needs explicit sequencing;
this proposal does not activate it or silently transfer the Work-led item.

## Historical 959 interface shape review

Kernel959d proposes protocolVersion1 APIs:

- `provisionFixtureCandidateAttemptStoreV1({fixtureAuthority,fixtureIdentity,canonicalSchemaDefinition})`
  resolves one fresh synthetic temporary store through trusted fixture authority,
  never a caller path. Immutable `FixtureStoreAttestation` includes fixtureIdentity,
  protocolVersion, schemaVersion, schemaDigest, ddlDigest, preStateDigest,
  postStateDigest and nonpromotable:true. Registered/preexisting/drift stores refuse.
- `deriveCheckSubjectContextV1({parentAuthority})` returns immutable E/S/A, with
  no caller area/check/root/commit/manifest/DB/adapter selector. Existing
  resolveInstalledProjectRoot/readInstallManifest are only read primitives.
- `FinalizeV1({finalizerAuthority,attemptRef,expectedTupleDigest,terminalProof,artifactManifest})`
  derives its compatible store internally and performs sealed-to-finalized CAS,
  ResultRecord and eligible receipt in one transaction; no caller writer/store.

These are proposed shapes, not implementation-ready authority contracts. The
RegisteredSubjectAuthorityV1 issuer/verifier and pure managed-worktree/clean-source
binding reader do not exist and must be concretely pinned in the proposed Kernel
check-subject-context module, or name an additional owned path before code.
Owner27 identifies current MCP server actorId/ControlPlane.assertIdentity and tools
claimedIdentity as the initialized-parent boundary; they depend on ControlPlane and
cannot substitute the new side-effect-free seam or prove same-user OS containment.
Kernel must pin full CandidateStorev1 DDL, lifecycle/CAS states, bounded envelopes,
single-use finalizer authority and issue/start/seal/finalize/read-only reconcile APIs.

QA c841 explicitly grants **no Phase B contributor/code/test consent**. Kernel,
Work, Release and QA resolve these routine interface/scenario details directly;
no additional owner product decision is required merely to name pure interfaces.
Admission must reject absent actual child immutable-input consumption, attributable
parent terminal/descendant fence or artifact seal proof. Fixture attestations never
produce native PASS. Exact contracts and named QA consent precede any later code
scope decision; this report grants none.

## Exact contributor map proposed for review

Live ownership queries on 2026-10-01 confirm Kernel owns src/control-plane/**
and src/kernel/**, QA owns test/**. Proposed new paths are:

| Proposed responsibility | Primary implementer | Exact new path |
| --- | --- | --- |
| Fixture-only provisioner, schema compatibility inspection | Project Kernel | src/control-plane/candidate-attempt-store-provisioner.mjs |
| Attempt/result store and transaction boundary | Project Kernel | src/control-plane/candidate-attempt-store.mjs |
| Authenticated E/S/A context derivation and refusal | Project Kernel | src/kernel/check-subject-context.mjs |
| No-DDL result finalizer/receipt adapter | Project Kernel | src/control-plane/check-receipt-adapter.mjs |
| Pure managed-install/worktree metadata reader | Project Kernel | src/kernel/managed-subject-metadata.mjs |
| Parent authority and engine composition | Project Kernel | src/kernel/candidate-source-parent.mjs |
| Store/provisioner/transaction scenarios | Independent QA | test/fleet/candidate-attempt-store.test.mjs |
| Subject/engine/adapter binding scenarios | Independent QA | test/fleet/check-subject-context.test.mjs |
| Finalization/replay/artifact/outcome scenarios | Independent QA | test/fleet/check-receipt-adapter.test.mjs |

QA must name any contributor exception before Kernel touches tests and must
approve an append-only docs/TEST_INTEGRITY.md destination. Existing source files,
ControlPlane initializer/schema guard, CLI/bin, Work CheckService/conditions,
resources, Integration exactPasses, Backlog, Delivery, config and native receipt
consumers are excluded. Work reviews the actual Phase A engine/collector API;
Release reviews the future CLI/parent transport boundary without current wiring.
Any newly necessary path returns for named ownership/contributor review first.

## B0: qualify the provisioner in an isolated fixture

First pin CandidateAttemptStore/v1 DDL, protocol/schema version, lifecycle,
compatibility matrix and migration/refusal behavior in a reviewed contract.
Product schema metadata is independent of registered receipt schema authority.
The existing currentControlPlane2/required3 refusal remains unchanged; declaring
a compatible adapter cannot make be1ae951's initializing schema3 CLI compatible.
Valid legacy schema2 receipts retain their existing contract and meaning.

Proposed provisioner inputs are a trusted fixture authority, a fresh fixture
storage handle and reviewed immutable schema definition. It can create only a
unique synthetic fixture store in a test-owned temporary root. It refuses a
registered project/root, arbitrary caller DB path/selector, missing identity,
unsupported schema, drift or unexpected preexisting data. No candidate module
creates storage. Idempotent repeat provisioning compares exact schema/digests;
it never relabels, drops or silently migrates an incompatible store.

Output records fixture identity, schema version/digest, pre/post logical state
and DDL evidence; it is always a nonpromotable fixture attestation. There is no
current registered-store DDL, live migration or native receipt. A future actual
provisioner requires a separate owner decision with exact registered subject,
compatible schema/code, writer/process-fence evidence, pre/post state and risk
qualification. This proposal cannot satisfy that decision or approval75.

## B1: derive context without initializing live state

Proposed Context/v1 is derived by a trusted parent from authenticated registered
project/area binding and its clean managed candidate; caller arguments can only
verify a binding, never select foreign area, commit, root, manifest, database,
engine, adapter, schema or expected subject. Pin the existing authenticator seam
and a side-effect-free reader before code; do not construct ControlPlane as a
shortcut if its constructor initializes schema. If current APIs cannot derive
this safely, return the precise missing seam for review rather than bypass it.

The derived immutable tuple binds independently:

- E: exact engine commit/module bytes, dependency/tree/runtime digests and versioned interface.
- S: tagged candidate-source or operational-runtime, authenticated identity/root,
  exact clean product commit and product-schema digest or explicit null.
- A: registered adapter bytes/identity/interface, receipt schema and observed
  compatible control-plane schema under the reviewed compatibility matrix.
- Frozen check definition, verified immutable input digest, attempt ID/generation,
  exact guards and lease IDs/fence generations, and sealed artifact manifest.

A candidate-source subject never becomes operational-runtime through landing or
caller labels. Fixture identities are permanently nonpromotable. Missing or
incompatible store/context refuses before worker, lease acquisition or writes;
no fallback checker, root redirect, DB copy, schema relabel or new identity.

## B2: hermetic attempt store and atomic result finalizer

Pin issue/start/seal/finalize/read-only reconciliation APIs and exact bounded
serialized envelopes before implementation. Trusted parent owns attempt authority,
terminal observation and result transport. Candidate code receives no writer
handle/token/socket/DB/root/manifest; withholding these is an API authority
boundary, not proven same-user OS filesystem containment.

AttemptRecord progresses issued -> executing -> sealed -> finalized; binds the
full tuple, immutable inputs/definitions, guard and lease generations, process
identity/group observation, manifest seal and timestamps. FinalizeV1 performs one
BEGIN IMMEDIATE compare-and-swap for the exact sealed open attempt: finalize plus
ResultRecord PASS/FAIL/INCOMPLETE; eligible PASS additionally creates one receipt
in the same transaction. No consumed PASS without its receipt or consumed non-PASS
without its result. Preserve existing check_receipts/exactPasses semantics; initial
prototype rows are fixture-only and never gate native Integration/Backlog/Delivery.

Before any native receipt eligibility, independently prove actual child consumption
of the bound immutable input and attributable parent terminal/fence evidence;
Phase A copied-byte attestation alone cannot supply that proof. Verify/seal does
not claim an atomic snapshot against concurrent writers or OS containment.

Validate manifest path/length/hash/canonical order and actual bounded regular-file
bytes with link/special/traversal/overwrite/replacement/post-seal drift rejection.
Error/signal/timeout/overflow and zero-exit mutation never become PASS. Live or
unobservable descendants, cancellation-only proof and ambiguous commit are UNKNOWN:
retain durable AttemptRecord, seals/guards/leases, no final ResultRecord or replay.
Reconcile only the exact attempt/tuple read-only; never rerun a writer to repair
uncertainty. Proven FAIL/INCOMPLETE may use only existing-policy attempt scratch
cleanup; no new lease-release authority or receipt eligibility is implied.

## Proposed independent scenarios and integrity gates

QA decides exact additions and expected behavior before contributor permission.
Use synthetic fixture identity/temp root, fixed clock/IDs, deterministic terminal
and filesystem boundary inputs. Control transaction interruptions at declared
persistence boundaries; no sleeps/retries, weakened assertions or mutable goldens.

| Scenario | Given / When | Required observable outcome |
| --- | --- | --- |
| SCN-store-fixture-isolation | Fixture provisioner receives a registered/foreign root or incompatible existing schema | Refuse before DDL; schema and logical rows unchanged; no native receipt |
| SCN-context-authenticated-tuple | Caller supplies foreign selector, dirty source, digest/schema/adapter mismatch | Refuse before execution; registered state/guards/messages unchanged |
| SCN-atomic-result | Exact sealed attempt finalizes PASS or proven non-PASS; interrupt each persistence boundary | One atomic result/eligible receipt or retained UNKNOWN, never partial consumption |
| SCN-finalize-replay-fence | Duplicate/wrong tuple, stale guard/lease generation or nonsealed attempt | No extra result/receipt or release; exact prior evidence preserved |
| SCN-artifact-seal | Root/manifest/file link, special file, traversal, cap overflow, replacement or seal drift | Explicit refusal, bounded retained evidence, zero qualifying receipt |
| SCN-terminal-unknown | Cancellation, descendant uncertainty, timeout/error/overflow, ambiguous commit | No false PASS; attributable proven result or guarded UNKNOWN with read-only reconciliation |
| SCN-fixture-nonpromotion | Attempt fixture result is presented to any current native receipt consumer | Reject; no integration/closure/delivery/operational acceptance |
| SCN-schema-legacy-boundary | Legacy schema2 tuple remains valid while schema3 initializing candidate targets current2 | Legacy behavior retained; original native downgrade refusal preserved |

Required evidence: equally strict additive Test Integrity Note, original valid
scenario passes and deliberately corrupting/replay/partial-write variants fail for
the intended reason, independently reviewed exact candidate and hashes. Focused
fixture success remains a fixture result. After approved code and clean guarded
convergence, native exact required checks on the resulting commit, independent QA
and serialized authority-gated integration still apply. Tool/schema refusals remain
blockers; prose does not qualify native receipts or waive existing landing gates.

## Arbiter decision and later boundaries

For review: accept/revise/defer the exact hermetic B0-B2 trial after entry evidence,
Kernel/Work/Release interface review and named QA path/scenario consent. Recommended
choice is the isolated trial, with no native/live store provisioning. Record any
accepted scope on one existing continuity-preserving assignment only; provider
start remains a separate arbiter act. Store/context native activation, live DDL,
CLI Phase C wiring, source-requirement allowlist Phase D, resource policy changes,
installed alpha3 switch and operational/browser qualification each retain their
separate approval/verification requirements. No automatic wakes, extra identity,
installation/host change, release/deployment or full55-roadmap completion.
