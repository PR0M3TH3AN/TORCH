# TORCH Community AI Contribution Network

## Product, Protocol, and Implementation Design Specification

**Status:** Draft v0.1  
**Product:** TORCH — Task Orchestration via Relay-Coordinated Handoff  
**Relationship:** TORCH operates as a BitUnlock tenant  
**Primary purpose:** Convert community funding, volunteer attention, and model inference into verified, maintainer-welcome contributions to open-source software.

---

## 1. Executive summary

TORCH should evolve from a repository-local multi-agent scheduler into a community-funded contribution network for open-source projects.

A participating project explicitly declares what kinds of AI-assisted work it welcomes. Community members discover that work through a public signal layer, contribute sats or provider credits, and subscribe to notifications. TORCH converts a maintainer-approved campaign into bounded work units, assigns those work units to agents through its relay-coordinated locking system, and runs the agents inside isolated workers using OpenAI-compatible providers such as OpenRouter, NanoGPT, Routstr, or future provider adapters.

Agents do not immediately publish pull requests. They first submit structured evidence. Separate verifier agents attempt to reproduce or refute the result. Only verified, policy-compliant work is delivered to maintainers or converted into a draft pull request.

TORCH should be a normal BitUnlock tenant. BitUnlock should remain the payment-verification, entitlement, and receipt layer. TORCH should own the campaign, community, provider, worker, prompt, task, evidence, and verification layers.

The product can be summarized as:

```text
Maintainer opts in
        ↓
Project publishes welcome-work policy
        ↓
TORCH announces a campaign to the community
        ↓
Sponsors contribute sats or provider credit
        ↓
TORCH creates bounded agent tasks
        ↓
Agents claim tasks through TORCH locks
        ↓
Sandboxed workers use approved AI providers
        ↓
Evidence is independently verified
        ↓
Maintainer receives a report or draft PR
```

The core promise is not “AI writes free pull requests.” It is:

> **TORCH converts donated inference into reproducible, maintainer-welcome evidence and code changes.**

---

## 2. Important corrections and boundaries

The overall concept is sound, but four boundaries must be explicit.

### 2.1 A model provider is not an agent runtime

OpenRouter, NanoGPT, Routstr, and similar services expose model inference APIs. They do not, by themselves, clone repositories, edit files, run tests, manage branches, enforce tool permissions, or produce safe pull requests.

TORCH therefore needs two separate abstractions:

1. **Model provider adapter** — sends prompts and tool-call messages to a model endpoint.
2. **Agent runtime** — manages the iterative loop, repository tools, file edits, shell commands, tests, budgets, and final evidence.

```text
TORCH worker
  ├── agent runtime
  │     ├── repository tools
  │     ├── shell/test tools
  │     ├── iteration loop
  │     └── evidence builder
  └── model provider adapter
        ├── OpenRouter
        ├── NanoGPT
        ├── Routstr
        └── other OpenAI-compatible providers
```

### 2.2 BitUnlock does not automatically convert sats into provider credit

BitUnlock can verify that a contribution was paid. It does not inherently convert the received sats into an OpenRouter balance, NanoGPT subscription, or other provider credit.

The initial TORCH operator must therefore either:

- Pre-fund provider accounts and account for campaign spending internally.
- Use a sats-native provider such as Routstr.
- Accept direct provider-credit sponsorship.
- Add a separate treasury process that periodically converts received sats into provider balances.

This financial conversion must never be implied or hidden from sponsors.

### 2.3 Community-funded campaigns introduce custody

BitUnlock is designed around noncustodial payment verification, but if sponsors pay TORCH and TORCH later spends those funds on inference, TORCH has custody of a pooled campaign budget.

For the first release, contributions should be described as **restricted donations to a TORCH campaign**, not trustless escrow. The campaign page must state:

- Who controls the receiving wallet.
- Whether unused funds are refundable.
- How provider costs are calculated.
- What happens if a campaign cannot complete.
- Whether funds may roll into a related campaign or general pool.

A future design may reduce custody with bearer compute credits, Cashu, direct provider top-ups, or BitUnlock-sponsored execution grants. That is not required for the first useful version.

### 2.4 Nostr locks are coordination signals, not final financial authorization

Relay-coordinated locks reduce duplicate work, but relay state is not a strongly consistent transaction database. Two workers may briefly believe they have won the same task.

TORCH must therefore use two levels of control:

1. **Nostr lock:** Public or private coordination signal.
2. **Compute lease:** Authoritative server-issued permission to consume campaign funds.

Only the worker holding the valid compute lease may use funded inference.

---

## 3. Product goals

TORCH should:

- Give maintainers an explicit way to welcome, constrain, or reject AI-assisted contributions.
- Give contributors a searchable list of useful work that projects actually want.
- Let sponsors fund specific projects, campaigns, skills, or the general contribution pool.
- Prevent multiple agents from unknowingly spending money on the same declared task.
- Run repository code in isolated, disposable environments.
- Support multiple model providers without binding TORCH to one company.
- Produce structured evidence before producing pull requests.
- Require independent verification for security-sensitive or high-risk findings.
- Protect maintainers from low-quality pull-request spam.
- Preserve a public record of funding and non-sensitive outcomes.
- Keep vulnerability details private until maintainers authorize disclosure.
- Measure accepted outcomes rather than tokens consumed.
- Remain useful to human contributors, not only autonomous agents.

---

## 4. Non-goals

The first production release should not:

- Autonomously merge code.
- Promise that AI output is correct.
- Allow any third party to target a repository without maintainer consent.
- Publicly disclose unpatched vulnerabilities.
- Run untrusted repository code directly on an operator host.
- Give workers unrestricted provider credentials.
- Treat a passing test suite as sufficient proof of correctness.
- Create a speculative token or tradable governance asset.
- Guarantee refunds before a refund mechanism and reserve policy exist.
- Replace GitHub, GitLab, Forgejo, or other canonical source-control systems.
- Store large reports or repository artifacts inside Nostr events.
- Turn BitUnlock into a Git host, agent runner, or vulnerability database.

---

## 5. Product principles

### 5.1 Maintainer consent is mandatory

A project becomes eligible only after a maintainer proves control and publishes an AI contribution policy on the repository’s default branch, or installs the TORCH GitHub App and creates an equivalent signed policy.

### 5.2 Friction belongs where risk exists

Documentation improvements may move quickly. Cryptographic changes, authentication changes, fund-handling changes, and security findings require stronger review and independent reproduction.

### 5.3 Evidence before patches

The default output is an evidence bundle. A pull request is a later presentation format, not the first product of the agent run.

### 5.4 Verification must be independent

The agent that discovers a finding must not be the only agent attesting to it. High-risk work should be verified by a different worker and preferably a different model family.

### 5.5 The repository commit is immutable during a task

Every campaign and task references an exact commit SHA. Workers may create branches from that commit, but the object of analysis never silently changes.

### 5.6 Provider portability is a requirement

TORCH should use capability-based provider selection and OpenAI-compatible adapters where practical. A task must not depend on one model slug unless the campaign explicitly requires it.

### 5.7 Public signals, private vulnerabilities

Campaign existence and funding may be public. Sensitive task instructions, findings, reproductions, and patches remain encrypted until disclosure is approved.

### 5.8 Maintainer attention is the scarce resource

The system must optimize for useful, deduplicated, reproducible submissions—not maximum agent activity.

---

## 6. Actors and roles

### Project maintainer

- Proves control of a repository.
- Publishes the project contribution policy.
- Creates or approves campaigns.
- Defines protected files and validation commands.
- Receives private findings.
- Accepts, rejects, or requests changes.

### Sponsor

- Contributes sats, provider credits, or a restricted provider key.
- Chooses a campaign or general funding pool.
- Receives a signed contribution receipt.
- Does not automatically own the result or gain access to private findings.

### Human contributor

- Browses welcome work.
- Claims human-review, reproduction, or implementation tasks.
- May use personal tools or TORCH-funded inference according to policy.

### Worker operator

- Provides an isolated execution environment.
- Runs the TORCH worker software.
- Receives short-lived compute leases and task bundles.
- Never receives unrestricted access to campaign funds or maintainer secrets.

### Agent

- Performs one bounded role such as triage, fuzzing, reproduction, patching, or verification.
- Operates under a compiled prompt bundle and tool policy.
- Produces structured evidence.

### Verifier

- Attempts to independently reproduce a finding or validate a patch.
- Is prevented from simply copying the discoverer’s conclusion when blind verification is required.

### Community curator

- Helps identify high-value projects and campaigns.
- Flags spam, duplicates, abandoned campaigns, and abusive requests.
- Has no authority to override a maintainer’s repository policy.

### TORCH operator

- Runs the campaign service, provider gateway, notification system, databases, and official Nostr identity.
- Maintains the campaign treasury and transparent accounting.
- Cannot bypass repository policy or verification requirements.

### BitUnlock operator

- Verifies Lightning payments and issues the corresponding buyer-bound receipt or fulfillment.
- Does not decide which TORCH task should run or whether a finding is valid.

---

## 7. System architecture

```text
┌─────────────────────────────────────────────────────────────┐
│ TORCH Web App / API                                         │
│                                                             │
│ Projects • Campaigns • Tasks • Funding • Community • Alerts │
└───────────────┬─────────────────────┬───────────────────────┘
                │                     │
        ┌───────▼────────┐    ┌──────▼──────────┐
        │ GitHub App     │    │ Nostr Signal    │
        │                │    │ Layer           │
        │ consent        │    │ announcements   │
        │ repo snapshots │    │ subscriptions   │
        │ issues / PRs   │    │ task locks      │
        └───────┬────────┘    └──────┬──────────┘
                │                     │
┌───────────────▼─────────────────────▼───────────────────────┐
│ TORCH Control Plane                                         │
│                                                             │
│ Campaign ledger • Task compiler • Scheduler • Lease issuer  │
│ Evidence registry • Verification • Reputation • Moderation  │
└───────────────┬─────────────────────┬───────────────────────┘
                │                     │
        ┌───────▼────────┐    ┌──────▼──────────┐
        │ BitUnlock      │    │ Provider Gateway│
        │ Tenant         │    │                 │
        │                │    │ OpenRouter      │
        │ contributions  │    │ NanoGPT         │
        │ receipts       │    │ Routstr         │
        │ entitlements   │    │ other adapters  │
        └────────────────┘    └──────┬──────────┘
                                     │
                         ┌───────────▼────────────┐
                         │ Sandboxed Workers      │
                         │                        │
                         │ Agent loop • repo tools│
                         │ tests • evidence bundle│
                         └───────────┬────────────┘
                                     │
                         ┌───────────▼────────────┐
                         │ Artifact Storage       │
                         │                        │
                         │ reports • logs • diffs │
                         │ reproducers • patches  │
                         └────────────────────────┘
```

### 7.1 Canonical state

TORCH’s transactional database is authoritative for:

- Projects and maintainers.
- Campaign budgets.
- Tasks and state transitions.
- Compute leases and provider spending.
- Evidence and verification status.
- Notification delivery state.
- Reputation and moderation actions.

Nostr is authoritative for signed identity statements and useful as a portable signal and lock layer, but it is not the sole financial ledger or transactional queue.

Git remains authoritative for repository content, commits, branches, issues, and pull requests.

BitUnlock remains authoritative for whether a contribution payment settled.

---

## 8. End-to-end product lifecycle

### 8.1 Project enrollment

1. Maintainer signs in with GitHub and optionally links a Nostr identity.
2. Maintainer installs the TORCH GitHub App for selected repositories.
3. TORCH checks repository permissions.
4. Maintainer creates or merges `.github/ai-contributions.yml`.
5. TORCH validates the file against the published schema.
6. TORCH pins the policy to its commit SHA and registers the project.
7. TORCH publishes a project-welcome signal.

### 8.2 Campaign creation

1. Maintainer selects a repository and exact commit.
2. Maintainer chooses a campaign template or writes a bounded objective.
3. TORCH checks the objective against the project policy.
4. Maintainer defines budget, disclosure, validation, and completion rules.
5. TORCH estimates the task plan and expected inference range.
6. Maintainer signs or confirms the campaign.
7. TORCH publishes the campaign and opens funding.

### 8.3 Funding

1. Sponsor selects a campaign or general fund.
2. TORCH creates a BitUnlock checkout for the campaign contribution product.
3. Sponsor pays all required Lightning legs.
4. BitUnlock records settlement and returns the signed fulfillment or receipt.
5. TORCH verifies the receipt and credits the campaign ledger.
6. TORCH publishes a non-sensitive funding update.

### 8.4 Work generation

1. TORCH’s task planner reads the campaign, repository metadata, and project policy.
2. It proposes work units.
3. The maintainer approves the plan for sensitive campaigns; low-risk templates may be pre-approved.
4. TORCH records immutable task contracts.
5. Available tasks are announced to matching contributors and workers.

### 8.5 Claim and execution

1. Worker publishes or requests a TORCH task lock.
2. TORCH resolves the winning lock.
3. TORCH checks remaining budget and worker eligibility.
4. TORCH issues one short-lived compute lease.
5. Worker creates an isolated repository environment from the pinned commit.
6. TORCH compiles the final prompt bundle.
7. Agent performs the bounded task through the selected model provider.
8. Worker records commands, tool calls, spend, outputs, and artifacts.
9. Worker submits an evidence bundle.
10. Compute lease closes and unused allowance returns to the campaign budget.

### 8.6 Verification

1. TORCH classifies the evidence by risk.
2. A separate verification task is created.
3. A different worker claims that task.
4. The verifier receives only the information allowed by the verification mode.
5. The verifier reproduces, refutes, or marks the result inconclusive.
6. TORCH calculates the evidence status and confidence.

### 8.7 Maintainer delivery

Depending on project policy, TORCH produces one of:

- Private vulnerability report.
- Draft GitHub issue.
- Draft pull request.
- Reproducer package.
- Test-coverage report.
- Documentation patch.
- Dependency-upgrade proposal.
- Campaign synthesis report.

Nothing is published publicly until the project’s disclosure and contribution policy allows it.

---

## 9. Project opt-in and AI contribution policy

TORCH should define a small open specification called **AI Contributions Policy**.

Two files serve different purposes:

- `.github/ai-contributions.yml` — canonical machine-readable policy.
- `AI_CONTRIBUTIONS.md` — optional human-readable explanation and onboarding guide.

The YAML file is the enforcement source. The Markdown file must not override it.

### 9.1 Example `.github/ai-contributions.yml`

```yaml
schemaVersion: "1.0"

project:
  id: "github:example/example-wallet"
  defaultBranch: "main"
  maintainers:
    - github: "alice"
      nostr: "npub1..."

status: "welcome"

acceptedWork:
  - bug-reproduction
  - test-generation
  - fuzzing
  - documentation
  - dependency-upgrades
  - security-analysis
  - verified-bug-fixes

contributionModes:
  reports: true
  issues: "draft-only"
  pullRequests: "after-verification"
  automaticMerge: false

scope:
  include:
    - "src/**"
    - "tests/**"
    - "docs/**"
  exclude:
    - "vendor/**"
    - "generated/**"
    - "fixtures/private/**"
  protected:
    - "src/crypto/**"
    - "src/wallet/**"
    - ".github/workflows/release.yml"

riskPolicy:
  protectedPathsRequireHumanReview: true
  securityFindings: "private"
  minimumIndependentVerifiers: 2
  differentModelFamilyForVerification: true

runtime:
  network: "deny-by-default"
  allowedHosts:
    - "registry.npmjs.org"
  maxWallClockMinutes: 45
  maxDiskMb: 4096
  maxMemoryMb: 4096
  secrets: "none"

validation:
  install:
    - "npm ci"
  required:
    - "npm run lint"
    - "npm test"
  optional:
    - "npm run build"
  immutableTestPaths:
    - "tests/security/**"
  holdoutScenarios: true

repositoryPolicyFiles:
  - "AGENTS.md"
  - "CONTRIBUTING.md"
  - "SECURITY.md"

promptPolicy:
  allowedRoles:
    - "bug-reproducer"
    - "fuzz"
    - "test-integrity"
    - "documentation"
    - "patch-author"
    - "independent-verifier"
  customInstructions: ".torch/project-instructions.md"

providerPolicy:
  dataRetention: "deny-training"
  zeroDataRetentionPreferred: true
  allowedProviders:
    - "openrouter"
    - "nanogpt"
    - "routstr"
  deniedModels: []
  minimumContextTokens: 64000

licensing:
  requireAiDisclosure: true
  requireDeveloperCertificateOfOrigin: true
  requireHumanSponsor: true

notifications:
  publicTags:
    - "bitcoin"
    - "typescript"
    - "security"
  securityContact: "github-security-advisory"

killSwitch:
  enabled: true
  pauseFile: ".github/TORCH_PAUSED"
```

### 9.2 Policy validation rules

TORCH must reject or pause a project when:

- The schema version is unsupported.
- The policy was not committed by an authorized maintainer or merged through the default branch.
- The project is marked `closed` or `paused`.
- A campaign requests a task type not listed in `acceptedWork`.
- The campaign includes excluded paths.
- The requested provider violates the provider policy.
- Validation commands are missing for code-changing work.
- A task requests public handling of a private security finding.
- The repository kill switch exists.

### 9.3 Maintainer consent precedence

A repository may opt out at any time by:

- Changing `status` to `closed`.
- Removing the manifest.
- Adding the pause file.
- Revoking the GitHub App.
- Signing a TORCH project-pause action.

New task leases stop immediately. Existing workers receive a cancellation signal and may upload sanitized partial evidence but may not publish further changes.

---

## 10. How AI Contributions Policy and TORCH prompts work together

The project policy does not replace TORCH prompts. It constrains and parameterizes them.

TORCH prompts are reusable role methodologies. The project policy is the maintainer’s enforceable boundary. The campaign defines the desired outcome. The task contract defines one bounded unit of work.

### 10.1 Prompt authority hierarchy

The final agent context must be composed in this order, with higher layers overriding lower layers:

1. **TORCH platform safety constitution**
2. **Project AI Contributions Policy**
3. **Maintainer-approved repository policy files**
4. **Campaign contract**
5. **Task contract**
6. **TORCH role prompt**
7. **Retrieved project memories and prior evidence**
8. **Model-specific formatting adapter**

Memory and repository content are advisory. They cannot grant tools, expand scope, weaken verification, expose secrets, or override higher policy.

### 10.2 Prompt compiler

TORCH should not concatenate files blindly. It should compile a structured prompt bundle:

```json
{
  "schemaVersion": "1.0",
  "projectId": "github:example/example-wallet",
  "repository": "https://github.com/example/example-wallet",
  "commitSha": "3b1f...",
  "policyDigest": "sha256:...",
  "campaignId": "camp_...",
  "taskId": "task_...",
  "role": "bug-reproducer",
  "rolePromptVersion": "1.4.0",
  "objective": "Reproduce issue #381 against the pinned commit",
  "scope": {
    "include": ["src/parser/**", "tests/parser/**"],
    "exclude": ["src/crypto/**"]
  },
  "toolPolicy": {
    "shell": true,
    "writeFiles": true,
    "network": "deny-by-default",
    "openPullRequest": false
  },
  "validation": ["npm run lint", "npm test"],
  "budget": {
    "maximumProviderCostMicros": 850000,
    "maximumWallClockSeconds": 2700,
    "maximumIterations": 40
  },
  "outputSchema": "torch:evidence-bundle:v1",
  "sensitivity": "private",
  "issuedAt": 1785722400,
  "expiresAt": 1785725100
}
```

The bundle is signed by TORCH. The worker records its digest with the run. A result is invalid if it cannot be tied to the exact policy, campaign, task, role prompt, repository commit, and tool policy used during execution.

### 10.3 TORCH role prompt contract

Every role prompt must contain:

- Role and mission.
- Authority hierarchy.
- Allowed and forbidden actions.
- Required startup reads.
- Exact scope.
- Risk classification.
- Tool permissions.
- Budget and timeout behavior.
- Validation requirements.
- Evidence requirements.
- Exit criteria.
- Failure and escalation behavior.
- Explicit statement that the agent may not weaken tests to pass.

### 10.4 Initial role library

#### Campaign triage agent

- Reads project policy and open issues.
- Suggests campaign scopes.
- Does not edit code.

#### Task planner

- Breaks a campaign into non-overlapping work units.
- Estimates dependencies, risk, and budget.
- Flags semantic overlap.

#### Bug reproducer

- Creates minimal deterministic reproduction.
- Does not patch until reproduction exists.

#### Fuzz agent

- Executes bounded deterministic fuzz campaigns.
- Produces minimized reproducers.
- Never targets public infrastructure.

#### Test-integrity agent

- Protects scenario truth and holdout evaluations.
- Prevents test weakening and snapshot rubber-stamping.

#### Security audit agent

- Performs static and dynamic analysis within approved scope.
- Sends all findings privately.

#### Patch-author agent

- Receives only verified findings.
- Produces the smallest safe patch and regression tests.

#### Independent verifier

- Reproduces or refutes evidence.
- Cannot modify the original evidence bundle.

#### Maintainer-synthesis agent

- Consolidates verified work into one concise report.
- Deduplicates findings before maintainer delivery.

### 10.5 Blind verification modes

TORCH should support:

- **Full blind:** Verifier receives task objective and repository commit but not discoverer output.
- **Reproducer blind:** Verifier receives the claimed observable behavior but not root-cause analysis or patch.
- **Patch review:** Verifier receives evidence and patch, then tests the proposed correction.
- **Open review:** Appropriate for low-risk documentation and formatting work.

The campaign risk policy chooses the minimum mode.

---

## 11. Provider and agent runtime design

### 11.1 Provider adapter interface

```ts
interface ModelProviderAdapter {
  id: string;
  listModels(): Promise<ModelDescriptor[]>;
  getCapabilities(modelId: string): Promise<ModelCapabilities>;
  estimateCost(request: ModelRequest): Promise<CostEstimate>;
  execute(request: ModelRequest, lease: ProviderLease): Promise<ModelResponse>;
  getUsage(requestId: string): Promise<UsageRecord | null>;
  cancel?(requestId: string): Promise<void>;
}
```

### 11.2 Initial provider adapters

#### OpenRouter

Use its OpenAI-compatible API, model catalog, provider routing, tool support, structured outputs, usage reporting, and optional provider privacy controls.

#### NanoGPT

Use its generally OpenAI-compatible text endpoints and model-discovery API. Capability discovery must be performed dynamically because model availability and billing modes change.

#### Routstr

Use its OpenAI-compatible endpoint with Lightning/Cashu-funded sessions. Routstr is strategically useful because its funding model is closer to TORCH’s sats-native community model.

#### Generic OpenAI-compatible adapter

Allow an operator to configure:

- Base URL.
- API key reference.
- Models endpoint.
- Chat or Responses endpoint.
- Usage-field mapping.
- Capability overrides.
- Pricing source.

### 11.3 Capability-based model selection

Tasks should declare capabilities rather than model brands:

```yaml
requirements:
  contextTokens: 200000
  toolCalling: true
  structuredOutputs: true
  reasoning: true
  images: false
  dataPolicy: deny-training
  preferredModelFamilies:
    - glm
    - qwen-coder
    - claude
```

TORCH then selects from allowed providers and models according to:

1. Project provider policy.
2. Campaign budget.
3. Required capabilities.
4. Context size.
5. Reliability.
6. Privacy requirements.
7. Historical task performance.
8. Maintainer or sponsor preference.

### 11.4 Agent runtime interface

```ts
interface AgentRuntime {
  prepare(input: RunPreparation): Promise<PreparedRun>;
  execute(input: PreparedRun, lease: ComputeLease): Promise<RunResult>;
  cancel(runId: string): Promise<void>;
  collectEvidence(runId: string): Promise<EvidenceBundle>;
  destroy(runId: string): Promise<void>;
}
```

The first runtime may be a TORCH-owned loop using an OpenAI-compatible SDK and a small, audited tool set. Later adapters may support Codex CLI, Claude Code, OpenHands, or other agent systems.

### 11.5 Worker sandbox requirements

Each run must use an ephemeral environment with:

- Read-only base repository snapshot.
- Writable worktree or branch overlay.
- No host filesystem access.
- No cloud metadata access.
- No inherited operator secrets.
- Network denied by default.
- Explicit host allowlist.
- CPU, memory, disk, process, and time limits.
- Per-run GitHub token with minimum permissions.
- Command and file-change audit log.
- Automatic destruction after evidence upload.

Firecracker, gVisor, Kata Containers, isolated CI runners, or another hardened sandbox may satisfy this boundary. Plain unsandboxed Docker should not be treated as sufficient for hostile repositories without additional hardening.

### 11.6 Prompt injection resistance

Repository files are untrusted data. A README or source comment may instruct the model to leak secrets, alter scope, or disable tests.

The runtime must:

- Clearly separate platform instructions from repository content.
- Never place provider keys in model context.
- Enforce tool permissions outside the model.
- Validate every file write against scope.
- Validate every network request against policy.
- Reject requests to expose system prompts or credentials.
- Record attempted policy violations.

---

## 12. BitUnlock integration

### 12.1 TORCH as a tenant

TORCH registers one tenant identity with BitUnlock and manages campaign contribution products under that tenant.

BitUnlock provides:

- Lightning invoice creation and settlement verification.
- Nostr-authenticated tenant operations.
- Immutable order and payment records.
- Signed contribution receipts or buyer-bound fulfillments.
- TORCH tenant reporting.
- Optional provider credential custody for bounded BitUnlock execution products.

TORCH provides:

- Campaign attribution.
- Sponsor-facing funding UI.
- Campaign budget ledger.
- Provider-cost accounting.
- Worker leases.
- Task execution.
- Evidence delivery.
- Refund or rollover policy.

### 12.2 Contribution product model

The first release may use fixed contribution tiers:

```text
1,000 sats
5,000 sats
10,000 sats
25,000 sats
100,000 sats
```

Each BitUnlock product coordinate maps to:

- Campaign ID.
- Contribution amount.
- Funding policy version.
- Receipt payload.

A later BitUnlock extension may support variable-price contributions without creating separate products.

### 12.3 Receipt payload

The fulfillment should contain a signed, non-secret receipt:

```json
{
  "type": "torch-campaign-contribution",
  "version": 1,
  "campaignId": "camp_...",
  "orderId": "ord_...",
  "sponsorPubkey": "...",
  "paidSats": 10000,
  "creditedComputeUnits": 8420,
  "fundingPolicy": "2026-08-v1",
  "refundable": false,
  "issuedAt": 1785722400
}
```

`creditedComputeUnits` must not pretend to equal sats when a conversion or platform reserve is involved. The campaign page must explain the conversion policy.

### 12.4 Funding modes

TORCH should support three funding modes.

#### Campaign sats

Sponsor pays sats through BitUnlock. TORCH controls the campaign wallet and buys provider credit.

#### Provider-credit donation

Sponsor grants an OpenRouter, NanoGPT, Routstr, or other provider balance or restricted key to the campaign. The provider secret remains encrypted and must be spend-limited where the provider supports it.

#### Bring-your-own inference

A contributor claims a task and uses personal provider credit. TORCH verifies the result but does not reimburse automatically.

### 12.5 Campaign ledger

The ledger must be append-only and record:

- Contributions received.
- BitUnlock fees.
- Lightning or conversion costs.
- Provider credit purchased.
- Provider cost reserved by leases.
- Actual provider cost consumed.
- Credits released from expired leases.
- Refunds or rollovers.
- Operator subsidy.
- Manual adjustments with signed reason.

Public campaign pages may show aggregates. Exact sponsor identity and sensitive financial metadata remain private unless the sponsor opts in.

### 12.6 Future BitUnlock primitive: sponsored execution grant

A general-purpose BitUnlock extension may later define:

```ts
interface SponsoredExecutionGrant {
  sponsorPubkey: string;
  beneficiaryPubkey: string;
  executorPubkey: string;
  campaignId: string;
  maximumSpendSats: number;
  purposeDigest: string;
  expiresAt: number;
}
```

This would be useful beyond TORCH, but TORCH should not block its first release on this extension.

---

## 13. Task model, locks, and compute leases

### 13.1 Task contract

Every task contains:

- Project and repository.
- Exact commit SHA.
- Campaign ID.
- Task type and role.
- Objective.
- Included and excluded paths.
- Dependencies.
- Sensitivity.
- Required capabilities.
- Validation commands.
- Evidence schema.
- Maximum budget.
- Maximum duration.
- Verification requirements.
- Publication permissions.

### 13.2 Task states

```text
draft
  → awaiting-approval
  → awaiting-funding
  → available
  → locked
  → lease-issued
  → preparing
  → running
  → evidence-submitted
  → verification-queued
  → verifying
  → verified | rejected | inconclusive | disputed
  → maintainer-review
  → issue-drafted | pr-drafted | report-delivered
  → accepted | declined | superseded
  → archived
```

### 13.3 Nostr task lock

The existing TORCH relay lock remains useful for public, portable coordination.

A task lock includes:

- Task ID.
- Campaign ID.
- Worker or contributor pubkey.
- Lock nonce.
- Issued timestamp.
- Expiration timestamp.
- Requested role.
- Optional worker capability digest.

Sensitive campaigns publish opaque task IDs only.

### 13.4 Deterministic lock conflict rule

When multiple valid locks race, TORCH chooses:

1. Earliest server-observed valid event that reached the required relay threshold.
2. If equal, lexicographically lowest event ID.

The database records the winner. Losing workers receive no compute lease.

### 13.5 Compute lease

```json
{
  "leaseId": "lease_...",
  "taskId": "task_...",
  "workerPubkey": "...",
  "providerPolicy": {
    "allowed": ["openrouter", "nanogpt", "routstr"],
    "models": ["capability-selected"]
  },
  "maximumProviderCostMicros": 750000,
  "maximumRequests": 50,
  "expiresAt": 1785725100,
  "promptBundleDigest": "sha256:...",
  "repositoryCommit": "3b1f...",
  "nonce": "...",
  "signature": "..."
}
```

The provider gateway rejects calls that:

- Exceed the lease budget.
- Use a disallowed provider or model.
- Arrive after expiration.
- Use the wrong worker identity.
- Reference a different prompt bundle.
- Exceed concurrency limits.

### 13.6 Heartbeats and recovery

Workers send bounded heartbeats. If the worker disappears:

- Provider spend remains recorded.
- Lease expires.
- Partial evidence may be retained.
- Task returns to available or enters manual triage.
- A new worker receives a fresh lease.

The new worker should not automatically receive the previous model transcript. It receives only sanitized reusable evidence approved by the task policy.

---

## 14. Evidence, verification, and contribution delivery

### 14.1 Evidence bundle

Every completed run submits:

```yaml
evidenceBundle:
  version: 1
  runId: "run_..."
  taskId: "task_..."
  repositoryCommit: "3b1f..."
  promptBundleDigest: "sha256:..."
  workerIdentity: "npub1..."
  provider:
    id: "openrouter"
    model: "..."
    requestIds: []
  claim:
    summary: "..."
    category: "bug | vulnerability | improvement | no-finding"
    confidence: 0.78
  codePointers: []
  reproduction:
    commands: []
    expected: "..."
    observed: "..."
    deterministicSeed: null
  artifacts: []
  proposedPatch:
    present: false
    digest: null
  validation:
    commands: []
    results: []
  limitations: []
  policyViolationsAttempted: []
  providerCostMicros: 0
```

### 14.2 Verification thresholds

Suggested defaults:

- Documentation-only: one validation pass.
- Test generation: one independent verifier.
- Ordinary bug fix: reproduction plus one independent patch verification.
- Authentication, payments, cryptography, key management: two independent verifiers and human maintainer approval.
- Critical vulnerability: two independent technical verifiers, private disclosure, and explicit maintainer-controlled publication.

### 14.3 Finding deduplication

TORCH clusters findings by:

- Repository and commit.
- Affected files and symbols.
- Normalized observable behavior.
- Stack-trace signature.
- Reproducer digest.
- Patch overlap.
- Embedding similarity as an advisory signal.

A model similarity score alone must never close a finding as duplicate.

### 14.4 Pull-request policy

A draft PR may be created only when:

- The project allows AI-assisted PRs.
- The finding or objective is verified.
- Required validation passed.
- The diff is within approved scope.
- The PR contains AI disclosure.
- The PR links to the TORCH evidence summary.
- No private vulnerability detail is exposed.
- A human sponsor or maintainer is attached when required.

Every PR should include:

- Purpose and scope.
- Exact pinned commit.
- Files changed.
- Reproduction.
- Validation commands and results.
- AI model/provider disclosure.
- Human and agent contributors.
- Test-integrity note when tests change.
- Remaining uncertainty.

### 14.5 No-finding results

A bounded analysis that finds nothing may still be valuable when it records:

- Exact scope.
- Models and tools used.
- Commands executed.
- Coverage achieved.
- Limits and blind spots.

No-finding reports should not claim that a repository is secure.

---

## 15. Community layer

TORCH needs a community surface, not merely a task queue.

### 15.1 Community functions

- Discover projects welcoming AI contributions.
- Follow projects, skills, languages, and campaign categories.
- Fund campaigns.
- Volunteer for human review.
- Operate workers.
- Curate important projects.
- Discuss public campaign goals.
- Celebrate accepted contributions.
- Flag spam and misuse.
- Build reputation around verified outcomes.

### 15.2 Community profiles

A profile may link:

- Nostr pubkey.
- GitHub account.
- Worker identity.
- Skills and languages.
- Project follows.
- Contribution receipts.
- Verified findings.
- Accepted pull requests.
- Human reviews.
- Moderation history.

Private sponsorship and anonymous contribution must remain possible.

### 15.3 Reputation

Reputation is earned from outcomes, not spending or raw activity.

Positive signals:

- Finding independently reproduced.
- Patch accepted by maintainer.
- High-quality review confirmed.
- Low duplicate rate.
- Accurate cost estimate.
- Responsible private disclosure.
- Reliable worker completion.

Negative signals:

- Fabricated test result.
- Unreproducible finding.
- Repeated duplicate submissions.
- Public disclosure violation.
- Budget abuse.
- Prompt or credential exfiltration attempt.
- Repository spam.

Reputation must remain contextual. A strong documentation contributor is not automatically a trusted cryptographic verifier.

### 15.4 General funding pools

Sponsors may fund:

- One campaign.
- One project.
- A skill pool such as fuzzing.
- A language ecosystem.
- Security-critical Bitcoin software.
- The general TORCH community pool.

Curators may propose allocation, but campaign activation still requires project consent.

---

## 16. Nostr signal layer

The signal layer makes welcome work portable and discoverable outside the TORCH website.

### 16.1 Signal types

TORCH should publish signed events for:

- Project registration or pause.
- Campaign announcement.
- Funding milestone.
- Task availability.
- Task claim and expiration.
- Request for human review.
- Public verification outcome.
- Campaign completion.
- Accepted contribution.

### 16.2 Event strategy

Use NIP-78 application-specific data events for mutable machine-readable TORCH records. Use ordinary public notes or long-form posts for human-readable announcements when appropriate.

Suggested `d` tag namespaces:

```text
torch/project/<project-id>
torch/campaign/<campaign-id>
torch/task/<task-id>
torch/lock/<task-id>/<worker-pubkey>
torch/outcome/<finding-id>
torch/subscription/<subscriber-pubkey>
```

Suggested common tags:

```text
["t", "torch"]
["t", "ai-contributions"]
["project", "github:owner/repo"]
["campaign", "camp_..."]
["status", "available"]
["skill", "fuzzing"]
["language", "typescript"]
["sensitivity", "public"]
["budget", "25000", "sat"]
```

### 16.3 Public and private events

#### Public campaign

May reveal:

- Project.
- Campaign objective.
- Task categories.
- Budget.
- Progress.
- Public outcomes.

#### Private campaign

Public event reveals only:

- Opaque campaign ID.
- Broad category.
- Funding state.
- Required worker trust level.

Task details and evidence are delivered through encrypted channels to approved participants.

### 16.4 Signal trust

Clients should distinguish:

- Official TORCH service signals.
- Maintainer-signed project signals.
- Community curator recommendations.
- Unverified third-party reposts.

A campaign is valid only when the TORCH service and an authorized project maintainer agree on its identity and policy digest.

---

## 17. Notifications

### 17.1 Notification triggers

Users may subscribe to:

- A project begins accepting AI contributions.
- A new campaign opens.
- A campaign reaches its funding threshold.
- A task matching selected skills becomes available.
- A human verifier is needed.
- A campaign is nearly out of funds.
- A finding is verified.
- A draft PR is ready for maintainer review.
- A contribution is accepted.
- A campaign is paused or cancelled.

### 17.2 Notification channels

- TORCH web inbox.
- Nostr public feed.
- Encrypted Nostr direct message.
- Web Push.
- Email as an optional compatibility channel.
- GitHub issue or discussion mention when project policy allows it.

Nostr is the portable signal layer, but the product should not require every maintainer to use a Nostr client.

### 17.3 Subscription filters

```json
{
  "projects": ["github:example/example-wallet"],
  "skills": ["rust", "fuzzing", "cryptography"],
  "taskTypes": ["verification", "bug-reproduction"],
  "minimumBudgetSats": 10000,
  "maximumRisk": "high",
  "channels": ["nostr-dm", "web-push"],
  "delivery": "immediate"
}
```

Delivery modes:

- Immediate.
- Hourly digest.
- Daily digest.
- Weekly community report.

### 17.4 Anti-spam controls

- Idempotency key per trigger and subscriber.
- Per-campaign notification ceilings.
- Digest by default for high-volume categories.
- Verified project requirement.
- Subscriber-controlled mute and block lists.
- Community moderation for fraudulent campaigns.

---

## 18. Core data model

### Project

- `project_id`
- forge and repository coordinate
- default branch
- maintainer identities
- Nostr identities
- current policy commit
- policy digest
- status
- risk tier
- created and updated timestamps

### Campaign

- `campaign_id`
- project ID
- pinned commit SHA
- objective
- campaign type
- sensitivity
- funding policy
- target and available compute units
- start and expiration
- maintainer approvals
- state

### Contribution

- `contribution_id`
- BitUnlock order ID
- sponsor identity or anonymous marker
- campaign ID
- paid sats
- credited compute units
- receipt digest
- funding policy version
- settlement timestamp

### Budget ledger entry

- `entry_id`
- campaign ID
- type
- amount and unit
- related order, lease, or provider request
- signed reason
- timestamp

### Task

- `task_id`
- campaign ID
- role
- objective
- scope
- dependencies
- risk and sensitivity
- required capabilities
- validation contract
- evidence schema
- maximum budget
- state

### Lock

- `lock_event_id`
- task ID
- worker identity
- acquired and expiration timestamps
- relay observations
- state

### Compute lease

- `lease_id`
- task ID
- worker identity
- prompt digest
- provider policy
- spend ceiling
- reserved amount
- actual amount
- issued and expiration timestamps
- state

### Run

- `run_id`
- lease ID
- worker runtime version
- provider and model
- repository snapshot digest
- start and end
- command log digest
- provider request IDs
- status

### Evidence bundle

- `evidence_id`
- run ID
- finding category
- summary
- artifact references
- reproducer digest
- patch digest
- validation results
- sensitivity
- status

### Verification

- `verification_id`
- evidence ID
- verifier identity
- verification mode
- result
- reproduction digest
- confidence
- provider cost

### Notification subscription

- `subscription_id`
- identity
- filters
- channels
- delivery cadence
- status

### Reputation record

- identity
- scope or skill
- event type
- weight
- supporting evidence
- timestamp

---

## 19. API surface

Suggested initial endpoints:

```text
GET    /v1/projects
POST   /v1/projects
GET    /v1/projects/{id}
POST   /v1/projects/{id}/verify-policy
POST   /v1/projects/{id}/pause

GET    /v1/campaigns
POST   /v1/campaigns
GET    /v1/campaigns/{id}
POST   /v1/campaigns/{id}/approve
POST   /v1/campaigns/{id}/cancel
GET    /v1/campaigns/{id}/ledger

GET    /v1/tasks
GET    /v1/tasks/{id}
POST   /v1/tasks/{id}/claim
POST   /v1/tasks/{id}/heartbeat
POST   /v1/tasks/{id}/release

POST   /v1/leases/{id}/provider-request
POST   /v1/leases/{id}/close

POST   /v1/runs
POST   /v1/runs/{id}/evidence
GET    /v1/evidence/{id}
POST   /v1/evidence/{id}/verify
POST   /v1/evidence/{id}/deliver

POST   /v1/contributions/verify
GET    /v1/contributions/{id}/receipt

GET    /v1/community/feed
POST   /v1/subscriptions
PUT    /v1/subscriptions/{id}
DELETE /v1/subscriptions/{id}

POST   /v1/github/webhook
POST   /v1/nostr/events
```

All protected API actions should use Nostr or forge identity authentication with explicit actor authorization. High-risk actions should require fresh signatures and replay protection.

---

## 20. Security and trust model

### 20.1 Assets

- Campaign funds.
- Provider credentials and balances.
- Maintainer GitHub installation tokens.
- Private vulnerability findings.
- Unreleased patches.
- Repository code and proprietary private repositories.
- Worker and contributor reputation.
- BitUnlock receipts.
- Prompt and policy integrity.

### 20.2 Major threats

- Malicious repository code escaping the sandbox.
- Prompt injection through source files.
- Worker theft of provider credentials.
- Sponsor chargeback or accounting dispute.
- Duplicate workers consuming the same budget.
- Fake evidence and fabricated test logs.
- Test weakening or reward hacking.
- Public disclosure of a vulnerability.
- Malicious maintainer targeting contributors with unsafe code.
- Sybil workers farming reputation.
- Compromised GitHub App installation.
- Provider logging sensitive source code.
- Nostr relay censorship or inconsistent lock state.
- Campaign spam and maintainer harassment.

### 20.3 Required controls

- Ephemeral hardened sandboxes.
- Short-lived minimum-scope GitHub tokens.
- Provider proxy instead of distributing provider keys.
- Signed prompt bundles and compute leases.
- Exact commit pinning.
- Immutable append-only budget ledger.
- External enforcement of file and network policy.
- Independent verification.
- Holdout scenarios for critical validation.
- Sensitive artifact encryption.
- Redacted logs.
- Maintainer kill switch.
- Rate limiting and campaign moderation.
- Separate operator roles for treasury, moderation, and security where practical.
- Regular external audit of TORCH and BitUnlock integration.

### 20.4 Security disclosure

Security findings should be delivered using the project’s declared method:

1. GitHub private security advisory.
2. Encrypted TORCH maintainer inbox.
3. NIP-17 encrypted direct message.
4. Other project-approved private channel.

Public Nostr events must never include exploit details, affected lines, reproduction commands, or patches before authorization.

---

## 21. User experience

### 21.1 Maintainer onboarding

The maintainer sees:

1. Connect GitHub.
2. Select repository.
3. Choose welcome-work categories.
4. Review generated policy.
5. Open policy PR.
6. Merge policy.
7. Create first campaign.

The generated policy should be conservative by default:

- Reports before PRs.
- No automatic merge.
- Network denied.
- No secrets.
- Private security disclosure.
- Human approval for protected paths.

### 21.2 Sponsor flow

The sponsor sees:

- Campaign purpose.
- Maintainer verification.
- Exact repository and commit.
- Funding target and current balance.
- Expected work units.
- Conversion and fee policy.
- Refund or rollover policy.
- Public versus private output.

After payment, the sponsor receives a signed receipt and may optionally publish a contribution badge.

### 21.3 Contributor flow

The contributor filters tasks by:

- Language.
- Skill.
- Risk.
- Human versus agent work.
- Provider funding availability.
- Project.

Before claiming, the contributor sees:

- Scope.
- Expected evidence.
- Budget.
- Required validation.
- Disclosure obligations.
- Whether a different verifier will review the work.

### 21.4 Maintainer review flow

The maintainer receives a small, prioritized queue:

- Verified findings only by default.
- Duplicate findings grouped together.
- Reproducer and patch shown separately.
- Exact cost and verification history.
- Accept, reject, request further verification, or pause campaign.

---

## 22. Implementation phases

### Phase 0 — specification and policy standard

- Publish AI Contributions Policy JSON Schema.
- Add policy validator CLI.
- Define campaign, task, evidence, and lease schemas.
- Adapt existing TORCH prompts to the compiled prompt hierarchy.
- Document private disclosure rules.

### Phase 1 — project registry and community signal

- GitHub App onboarding.
- Project policy verification.
- Campaign creation.
- Public web directory.
- Nostr project and campaign signals.
- Notification subscriptions.
- Manual campaign task planning.

### Phase 2 — BitUnlock funding

- Register TORCH tenant.
- Create campaign contribution products.
- Verify BitUnlock receipts.
- Implement campaign ledger.
- Publish transparent aggregate funding state.
- Keep provider balances operator-funded and reconciled manually.

### Phase 3 — bounded worker execution

- Hardened worker sandbox.
- Generic OpenAI-compatible provider adapter.
- OpenRouter, NanoGPT, and Routstr adapters.
- Prompt compiler.
- Nostr locks plus server compute leases.
- Structured evidence upload.

### Phase 4 — independent verification

- Blind verification tasks.
- Finding deduplication.
- Risk-tier verification thresholds.
- Private maintainer inbox.
- Draft issue and PR generation.

### Phase 5 — distributed community workers

- Worker registration and capability attestations.
- Worker reputation.
- Remote compute leases.
- Stronger sandbox attestation.
- Community curator tools.

### Phase 6 — generalized sponsored execution

- Evaluate BitUnlock sponsored execution grants.
- Direct Routstr/Cashu compute allocation.
- Provider-credit sponsorship.
- Optional refunds and campaign rollover automation.
- Multi-forge support beyond GitHub.

---

## 23. Success metrics

Primary metrics:

- Maintainer acceptance rate.
- Verified findings per 100,000 sats or equivalent provider cost.
- Cost per accepted contribution.
- False-positive rate.
- Duplicate-work rate.
- Time from campaign publication to first verified result.
- Maintainer review time per accepted result.
- Percentage of findings independently reproduced.
- Security disclosure compliance rate.
- Worker completion reliability.

Secondary metrics:

- Active opted-in projects.
- Repeat sponsors.
- Human reviewers participating.
- Provider diversity.
- Percentage of campaigns completed within budget.
- Number of projects that pause or opt out.

Token volume, number of agent runs, and number of opened pull requests are not success metrics by themselves.

---

## 24. Decisions still required

### Financial policy

- Are campaign contributions refundable?
- Who absorbs exchange-rate changes between sats and provider USD pricing?
- What reserve percentage covers fees and failed runs?
- May unused funds roll into a general project pool?
- Will TORCH publish proof-of-reserves or wallet attestations?

### Campaign authority

- Can only maintainers create campaigns?
- May community members propose campaigns for maintainer approval?
- What happens when maintainers disagree?

### Worker trust

- Are first-release workers operated only by TORCH?
- When may community workers execute private security tasks?
- Is sandbox attestation required before distributed workers launch?

### Provider privacy

- Which provider data-retention claims are acceptable?
- May private repositories use third-party model APIs?
- Should sensitive campaigns require local or TEE-backed inference?

### Licensing and authorship

- What AI disclosure language is required?
- How are DCO and CLA requirements satisfied?
- How does TORCH handle provider terms that may affect generated code?

### Governance

- Who moderates campaigns and community signals?
- How are reputation disputes appealed?
- Which parts of TORCH are protocol versus hosted service policy?

---

## 25. Recommended first production experiment

The first live campaign should be narrow and low-risk enough to validate the complete system without endangering a project.

Recommended example:

> **Create deterministic fuzz harnesses and minimized reproducers for one parser in an opted-in TypeScript project. Do not modify cryptography, authentication, payments, release workflows, or public network behavior.**

The experiment should include:

- One verified project.
- One exact commit.
- One 50,000–150,000 sat campaign.
- Three bounded discovery tasks.
- One independent verifier task.
- OpenRouter, NanoGPT, or Routstr through the same provider interface.
- TORCH-operated workers only.
- Evidence report before any draft PR.
- Public campaign progress with private raw logs.

The campaign is successful when the maintainer can say:

> “The community funded useful analysis, TORCH prevented duplicate spending, the result was reproducible, and reviewing it cost less attention than an unsolicited AI pull request.”

---

## 26. Final product definition

TORCH is not merely a scheduler, a bounty board, or a wrapper around an LLM API.

It is a public coordination system connecting:

- Maintainers who can define welcome work.
- Sponsors who can fund useful analysis.
- Human and AI contributors who can perform bounded tasks.
- Verifiers who can establish reproducibility.
- Model providers that supply interchangeable inference.
- BitUnlock, which verifies sats-based contributions and issues durable receipts.
- Nostr, which provides portable identity, discovery, signals, and relay-coordinated handoffs.

The final product should be positioned as:

> **TORCH coordinates community-funded AI contributions to open-source software.**

Supporting line:

> **Donate sats. Fund analysis. Strengthen open source.**

---

## 27. Reference implementations and external interfaces

- TORCH repository-local task locks, scheduler, memory, validation, and prompt governance remain the foundation for agent coordination.
- BitUnlock provides payment-verified delivery, signed entitlements, Nostr authentication, and optional bounded model execution.
- OpenRouter exposes a unified OpenAI-compatible API and model/provider routing.
- NanoGPT exposes generally OpenAI-compatible text-generation and model-discovery APIs.
- Routstr exposes an OpenAI-compatible API funded through Bitcoin Lightning and Cashu sessions.
- NIP-78 kind `30078` application-specific data events are suitable for TORCH’s portable machine-readable signal records.

Official references:

- https://openrouter.ai/docs/quickstart
- https://docs.nano-gpt.com/
- https://docs.routstr.com/client/integration/
- https://github.com/nostr-protocol/nips/blob/master/78.md
- https://github.com/PR0M3TH3AN/bitunlock
