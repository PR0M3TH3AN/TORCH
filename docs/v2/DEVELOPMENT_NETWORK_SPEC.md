# TORCH Development Network

## Community-Funded Stewardship, Feature Development, and Open-Source Project Incubation

**Status:** Draft v0.1  
**Product:** TORCH — Task Orchestration via Relay-Coordinated Handoff  
**Relationship:** TORCH operates as a BitUnlock tenant  
**Purpose:** Expand TORCH from community-funded analysis and maintenance into a complete development network for improving existing software, delivering new features, and incubating new open-source projects.

---

## 1. Executive Summary

TORCH should not be limited to bug finding, security analysis, or maintenance work. Those activities are the safest and most objective place to begin, but the same funding, coordination, prompting, execution, and verification infrastructure can support much broader forms of open-source development.

The complete TORCH product should operate in three related modes:

1. **TORCH Stewardship** — maintain and strengthen existing projects.
2. **TORCH Build** — fund and deliver maintainer-approved features.
3. **TORCH Foundry** — incubate entirely new community-backed open-source projects.

These modes share a common infrastructure:

- Maintainer or steward consent.
- Community signaling and notifications.
- Funding through BitUnlock, direct provider credit, or sponsor-supplied inference.
- Model access through OpenRouter, NanoGPT, Routstr, or other compatible providers.
- TORCH task decomposition and relay-coordinated locking.
- Authoritative compute leases and budget enforcement.
- Sandboxed agent runtimes.
- Human and AI collaboration.
- Structured evidence and independent verification.
- Milestone-based delivery.
- GitHub or another forge as the canonical source-control surface.

The broader product vision is:

> **TORCH coordinates community-funded human and AI development for open-source software—from maintenance and security to new features and new projects.**

The product should not promise autonomous software creation without accountability. It should provide a disciplined process through which communities can convert ideas, funding, maintainer judgment, human participation, and AI inference into useful and sustainable software.

A second design objective is equally important:

> **TORCH should minimize custody by routing compute principal directly to providers or task-specific credentials whenever possible, while TORCH and BitUnlock earn transparent service fees.**

---

## 2. Why TORCH Should Expand Beyond Maintenance

Bug fixing and security analysis have relatively clear validation targets:

- Can the defect be reproduced?
- Does the patch remove the defect?
- Do regression tests pass?
- Can an independent verifier reproduce the result?

Feature development is less mechanically objective. It requires decisions about:

- Which user problem should be solved.
- What behavior users should experience.
- Which tradeoffs are acceptable.
- How the feature fits the project architecture.
- Whether the interface is understandable.
- Whether compatibility should be preserved.
- Whether the feature is worth its maintenance cost.

New-project development introduces still more ambiguity:

- Is the problem real?
- Who are the intended users?
- Who has authority to make product decisions?
- Who will maintain the project after launch?
- What license and governance model should apply?
- When should the project be stopped rather than continually funded?

TORCH can support these activities, but only by adding stronger product governance above its existing task and agent infrastructure.

The system must evolve from:

```text
Task → Agent → Result
```

into:

```text
Human need
    ↓
Approved product or project definition
    ↓
Funded milestones
    ↓
Dependency-aware tasks
    ↓
Human and AI implementation
    ↓
Integration and acceptance testing
    ↓
Maintainer or steward release decision
```

The task remains important, but it is no longer the highest-level unit of work.

---

## 3. The Three TORCH Modes

## 3.1 TORCH Stewardship

TORCH Stewardship covers bounded improvements to existing projects.

Examples:

- Bug reproduction and repair.
- Security analysis.
- Fuzzing.
- Dependency upgrades.
- Performance improvements.
- Documentation.
- Accessibility.
- Test coverage.
- Build-system maintenance.
- Compatibility updates.
- Code cleanup approved by maintainers.
- Release preparation.

This should remain TORCH’s initial operational mode because success can usually be evaluated against an existing codebase and known behavior.

### Stewardship contract

A Stewardship campaign requires:

- An opted-in project.
- An exact repository commit.
- A bounded scope.
- Maintainer-approved contribution categories.
- Validation commands.
- Evidence requirements.
- A disclosure policy.
- A spending ceiling.
- A defined completion condition.

---

## 3.2 TORCH Build

TORCH Build delivers new features for existing projects.

Examples:

- Add multisig support to a wallet.
- Build a mobile interface.
- Add a new payment adapter.
- Implement a plugin system.
- Create an import or export workflow.
- Add localization.
- Design a new onboarding experience.
- Build an API or SDK.
- Add a new storage backend.
- Port a feature to another platform.

Build campaigns fund an outcome rather than a collection of unrelated tasks.

A Build campaign should follow this hierarchy:

```text
Feature proposal
    ↓
Maintainer-approved feature contract
    ↓
Product and technical design
    ↓
Milestone plan
    ↓
Dependency graph
    ↓
Implementation tasks
    ↓
Integration
    ↓
Acceptance validation
    ↓
Release candidate
```

### Feature contract

Before implementation begins, every Build campaign must define:

- **User problem:** What specific difficulty or unmet need is being addressed?
- **Target users:** Who will use the feature?
- **Desired outcome:** What should become possible?
- **User experience:** What are the primary flows, states, and failure conditions?
- **In scope:** What the campaign will build.
- **Out of scope:** What it will explicitly not build.
- **Compatibility:** Which existing behavior must remain stable?
- **Architecture constraints:** Which interfaces or boundaries must be preserved?
- **Security considerations:** Which new trust boundaries or attack surfaces are introduced?
- **Acceptance scenarios:** Observable behavior required for completion.
- **Migration plan:** How existing users or data move to the new design.
- **Rollback plan:** How the feature can be disabled or reverted.
- **Maintenance consequences:** What new long-term obligations the project assumes.
- **Human authority:** Which maintainer has final decision-making authority.

Agents may propose the feature contract, but a human maintainer must approve it before funded implementation begins.

---

## 3.3 TORCH Foundry

TORCH Foundry incubates new open-source projects.

Examples:

- A new Bitcoin or Nostr application.
- A missing developer tool.
- An accessibility utility.
- A privacy-preserving public service.
- An open protocol implementation.
- A community-owned alternative to proprietary software.
- A reference implementation for a new standard.

Foundry campaigns should not begin with “generate an app.” They should begin with a project charter and a limited exploration phase.

The Foundry lifecycle is:

```text
Community identifies a problem
        ↓
Human steward creates a charter
        ↓
Community signals interest
        ↓
Exploration milestone is funded
        ↓
Competing concepts or prototypes are produced
        ↓
Steward and community choose a direction
        ↓
MVP milestones are funded
        ↓
TORCH coordinates implementation
        ↓
Users test the project
        ↓
Project graduates into normal stewardship
```

### Project charter

Every Foundry project must define:

```yaml
projectCharter:
  problem: "What concrete problem is being solved?"
  targetUsers: "Who experiences this problem?"
  evidenceOfNeed: "What indicates the need is real?"
  humanSteward: "Who is accountable for decisions and releases?"
  license: "How may the software be used and modified?"
  governance: "How are product and technical decisions made?"
  initialScope: "What belongs in the MVP?"
  excludedScope: "What is deliberately postponed?"
  successCriteria: "What proves the MVP is useful?"
  securityPosture: "What risks require special review?"
  maintenancePlan: "Who maintains the project after launch?"
  fundingCeiling: "How much may exploration and the MVP consume?"
  stopConditions: "When should the project be paused or ended?"
```

A Foundry campaign may use AI heavily, but it must always have an accountable human steward. AI can supply development capacity; it cannot supply durable legitimacy, legal responsibility, product ownership, or community trust.

---

## 4. Product Governance

As TORCH moves toward feature and project development, governance becomes more important than task scheduling.

The system should distinguish four forms of authority.

### 4.1 Demand signal

The community can indicate:

- Interest.
- Funding willingness.
- Desired features.
- Testing availability.
- Skills available.
- Preference between prototypes.

Demand signals help prioritize work but do not determine technical truth.

### 4.2 Maintainer or steward authority

The maintainer or project steward decides:

- Whether a feature belongs in the project.
- Which design direction is accepted.
- Which compatibility tradeoffs are permissible.
- When a milestone is approved.
- Whether a release candidate ships.

### 4.3 Technical verification

Independent reviewers determine:

- Whether implementation matches the approved contract.
- Whether acceptance scenarios pass.
- Whether security requirements are satisfied.
- Whether tests were weakened.
- Whether the integration is maintainable.

### 4.4 Funding signal

Sponsors determine what they are willing to support financially.

Funding does not buy authority over a maintainer’s project unless that governance arrangement was explicitly accepted in advance.

These signals interact but must not be conflated. A heavily funded feature may still be rejected by a maintainer. A popular prototype may still fail security review. A technically elegant project may still lack real users.

---

## 5. Milestones as the Primary Funding Unit

Individual tasks are too small to represent a feature or project outcome. TORCH should introduce **milestone contracts** above tasks.

A milestone contains:

- Objective.
- Required inputs.
- Deliverables.
- Dependencies.
- Acceptance scenarios.
- Security and review requirements.
- Funding allocation.
- Maximum provider spend.
- Human approval gate.
- Completion evidence.
- Stop or rollback conditions.

Example feature milestones:

```text
M1 — Product and UX specification
M2 — Architecture and threat model
M3 — Working prototype
M4 — Core implementation
M5 — Integration and migration
M6 — Acceptance testing
M7 — Release candidate
```

Funding can be committed milestone by milestone. This avoids consuming an entire campaign budget before the direction is proven.

BitUnlock contribution products may target:

- An entire campaign.
- A specific milestone.
- A skill pool.
- A general project fund.
- A matching pool.
- A TORCH coordination fee.
- A BitUnlock verification and entitlement fee.

The TORCH campaign ledger should distinguish funds that are:

- Pledged but not paid.
- Settled for an immediate task.
- Reserved under a compute lease.
- Consumed by a provider.
- Released after a task.
- Refunded.
- Rolled forward.
- Subsidized by the operator.

---

## 6. Dependency-Aware Orchestration

Feature and project development require a directed dependency graph rather than a flat queue.

Example:

```text
Feature contract approved
       ├──────────────┬───────────────┐
       ↓              ↓               ↓
UX specification  API design    Threat model
       └──────────────┴───────────────┘
                      ↓
                 Prototype
                      ↓
          Implementation workstream
          ├──────────┬────────────┐
          ↓          ↓            ↓
       Frontend    Backend      Tests
          └──────────┴────────────┘
                      ↓
                 Integration
                      ↓
             Acceptance testing
                      ↓
              Release candidate
```

TORCH must not issue downstream compute leases before required prerequisite milestones are approved.

Task locks still prevent duplicate work within a milestone. Compute leases still enforce spending. The orchestration layer determines whether a task is ready to exist at all.

---

## 7. Expanded Agent Role Library

The existing maintenance and verification roles remain necessary. Build and Foundry add product and integration roles.

### Product discovery agent

- Researches the user problem.
- Summarizes existing alternatives.
- Identifies assumptions requiring validation.
- Does not define final requirements without human approval.

### Requirements agent

- Converts the approved problem statement into observable requirements.
- Identifies edge cases and non-functional requirements.
- Produces acceptance-scenario candidates.

### UX workflow agent

- Defines user journeys, states, failure conditions, empty states, and recovery flows.
- Produces implementation-neutral interface requirements.

### Technical architect

- Proposes component boundaries, APIs, data models, and migration strategy.
- Documents alternatives and tradeoffs.
- Produces architecture decision records.

### Threat-model agent

- Identifies assets, trust boundaries, attacker capabilities, abuse cases, and required controls.
- Cannot approve its own security-sensitive design.

### Prototype agent

- Creates disposable proofs of concept.
- Optimizes for learning rather than production polish.
- Records what the prototype does not establish.

### Feature planner

- Converts the approved feature contract into milestones and dependency-aware tasks.
- Estimates budget and identifies parallel work.

### Implementation agent

- Completes one bounded component under the approved architecture.
- Cannot redefine product behavior to simplify implementation.

### Integration agent

- Reconciles independently produced components.
- Detects interface drift and contradictory assumptions.
- Produces an integrated candidate rather than a collection of patches.

### Adversarial product reviewer

- Challenges whether the feature solves the stated user problem.
- Looks for confusing UX, hidden maintenance cost, and unnecessary complexity.

### Independent technical verifier

- Validates behavior, security, performance, and compatibility.
- Uses blind or partially blind verification where appropriate.

### Release agent

- Prepares migrations, changelogs, packaging, documentation, and release artifacts.
- Cannot publish a release without human authorization.

### User-validation agent

- Evaluates implementation against approved user scenarios.
- May synthesize structured feedback from human testers.
- Cannot substitute model judgment for actual user testing when a campaign requires humans.

---

## 8. Prompt Authority for Build and Foundry

The final compiled prompt hierarchy should be:

1. TORCH platform safety constitution.
2. Project AI Contributions Policy.
3. Project charter, where applicable.
4. Repository policy files.
5. Approved feature contract or product brief.
6. Approved architecture decisions and threat model.
7. Milestone contract.
8. Task contract.
9. TORCH role prompt.
10. Approved project memory and prior evidence.
11. Model-specific formatting adapter.

Lower layers may not override higher layers.

The compiled prompt bundle must bind:

- Project identity.
- Repository and exact commit.
- Charter version.
- Feature-contract version.
- Architecture-decision versions.
- Milestone ID.
- Task ID.
- Role-prompt version.
- Scope restrictions.
- Tool permissions.
- Validation commands.
- Spending ceiling.
- Output schema.
- Publication policy.
- Expiration time.

Every result must record the bundle digest.

---

## 9. Community and Signal Layer Expansion

The TORCH community should be able to discover and follow more than audit tasks.

Signal categories should include:

- Project seeks maintenance help.
- Maintainer requests feature proposals.
- Feature proposal open for discussion.
- Feature contract approved.
- Design reviewer needed.
- Prototype funding open.
- Prototype ready for testing.
- Implementation milestone available.
- Human UX tester needed.
- Security reviewer needed.
- Integration milestone funded.
- Release candidate available.
- New Foundry project proposed.
- Foundry project seeking a steward.
- Foundry project graduated.

Users should be able to follow:

- Projects.
- Languages.
- Technical skills.
- Product categories.
- Feature types.
- Foundry proposals.
- Review roles.
- Funding thresholds.
- Risk levels.

The notification system should support:

- Web inbox.
- Web Push.
- Public Nostr events.
- Encrypted Nostr direct messages.
- Email compatibility.
- GitHub discussions or mentions where permitted.
- Immediate, hourly, daily, and weekly digests.

Sensitive product or security details must remain private even when milestone existence is public.

---

## 10. Human Participation

TORCH should coordinate humans and agents rather than treating humans only as final approvers.

Human contribution tasks may include:

- Product interviews.
- User testing.
- Design review.
- Accessibility testing.
- Threat-model review.
- Architecture review.
- Domain expertise.
- Legal or licensing review.
- Translation.
- Release testing.
- Maintainer mentorship.
- Community moderation.

A milestone may explicitly require a mixture of human and AI evidence.

Example:

```yaml
acceptance:
  automatedScenariosRequired: true
  independentAgentVerifiers: 2
  humanUxTesters: 5
  maintainerApproval: true
  securityReviewer: true
```

Human work should be eligible for reputation and, where campaign policy allows, direct compensation or reimbursement.

---

## 11. Verification for Features and New Projects

Verification must expand beyond “tests pass.”

### Feature verification

A feature is complete only when:

- Acceptance scenarios pass.
- Required regression tests pass.
- Protected tests were not weakened.
- Architecture constraints are satisfied.
- Security review is complete.
- Migration and rollback procedures are tested.
- Documentation is complete.
- Maintainer approval is recorded.
- Required human testing is complete.

### Project verification

A Foundry MVP should be evaluated against:

- Project charter.
- Evidence of user need.
- Core user journeys.
- Reliability and security requirements.
- Installation and deployment experience.
- Documentation.
- License and governance readiness.
- Maintenance ownership.
- Operational cost.
- Exit and handoff plan.

A technically working repository is not automatically a successful project.

---

## 12. Project Graduation

A Foundry project should not remain dependent on TORCH indefinitely.

Graduation requires:

- A named steward or maintainer group.
- A published license.
- Contribution and security policies.
- Release process.
- Operational documentation.
- Stable project identity.
- Independent repository or organization.
- Defined maintenance funding.
- Community communication channel.
- Backlog and roadmap ownership.
- A final TORCH incubation report.

After graduation, the project may enroll in TORCH Stewardship for ongoing maintenance and future feature campaigns.

Projects that fail graduation criteria may:

- Continue with a capped incubation extension.
- Transfer to a new steward.
- Merge into another project.
- Archive with preserved artifacts and lessons.
- Return unused funds according to campaign policy.

---

# Part II — Custody-Minimized Funding and Sustainable Revenue

## 13. Design Objective

TORCH should earn money for coordination, verification, and infrastructure without becoming a general-purpose holder or transmitter of community balances.

The preferred economic model is:

```text
Sponsors fund a specific service or task
        ↓
Compute principal goes directly to a provider,
worker, or spend-limited provider credential
        ↓
TORCH receives a transparent coordination fee
        ↓
BitUnlock receives its verification/service fee
        ↓
No persistent user balance exists inside TORCH
```

The system should avoid:

- Indefinite pooled balances.
- Transferable internal credits.
- User withdrawals from TORCH.
- Cross-campaign balance transfers.
- Yield or interest.
- Exchange between bitcoin and fiat on behalf of users.
- Holding contributor payouts while waiting for future work.
- An omnibus wallet containing funds owed to many parties.

Reducing custody lowers operational, security, accounting, and potentially regulatory burdens, but it does not by itself determine legal treatment. The final structure should be reviewed by qualified counsel before TORCH holds pooled funds or transmits value between participants.

---

## 14. Funding Hierarchy

TORCH should support several funding modes and prefer them in this order.

## 14.1 Mode A — Bring Your Own Compute

A contributor or sponsor supplies a provider credential or runs the agent with personal inference.

Examples:

- A contributor uses a personal OpenRouter key.
- A sponsor creates a limited OpenRouter key for one task.
- A sponsor funds a Routstr session and delivers the ephemeral key.
- A project supplies its own NanoGPT account.
- A company runs its own approved model endpoint.

TORCH never receives the compute principal.

TORCH may still charge:

- Campaign setup fee.
- Coordination fee.
- Verification fee.
- Private project subscription.
- Worker registration or premium reporting fee.

This is the lowest-custody mode and should be the default for early pilots.

### Required controls

- Provider key has a hard spending limit.
- Key expires shortly after the task.
- Key is encrypted to the TORCH provider gateway.
- Workers never receive a management credential.
- Provider usage is reconciled against the compute lease.
- Credential is revoked or deleted when the run closes.

OpenRouter currently supports programmatically created API keys with optional spending limits and expiration. That makes task-scoped sponsor credentials practical.

---

## 14.2 Mode B — Sponsor-Funded Ephemeral Session

The sponsor funds a disposable provider session for a specific task or milestone.

Routstr is especially compatible with this model because a Lightning-funded or Cashu-funded session can become an ephemeral API key. The remaining value can be refunded after the task.

Suggested flow:

```text
TORCH estimates task ceiling
        ↓
Sponsor funds exact Routstr session
        ↓
Session key is encrypted to TORCH gateway
        ↓
TORCH issues matching compute lease
        ↓
Worker consumes only through gateway
        ↓
Task closes
        ↓
Unused value is returned to sponsor
```

TORCH does not hold a general campaign balance. It temporarily controls access to a task-specific service credential.

Although this still creates responsibility for a bearer credential, the exposure is narrowly bounded by:

- One task.
- One provider.
- One spending ceiling.
- One expiration.
- No withdrawal to TORCH.
- Refund to the sponsor or original funding destination.

---

## 14.3 Mode C — Pledge First, Pay When Work Is Ready

Campaign pages should distinguish **support signals** from paid balances.

A sponsor may publish or sign a pledge:

```json
{
  "campaignId": "camp_123",
  "maximumSats": 25000,
  "expiresAt": 1788307200,
  "conditions": {
    "milestone": "prototype",
    "maintainerApproved": true,
    "minimumOtherFundingSats": 50000
  }
}
```

The pledge is not money held by TORCH.

When a milestone is approved and ready to execute:

1. TORCH notifies pledged sponsors.
2. Sponsors choose a task or funding package.
3. Payment or provider credential is supplied just in time.
4. The task begins only after funding is verifiable.
5. Unfulfilled pledges simply expire.

This reduces idle balances and avoids collecting money for work that may never become ready.

Optional NWC auto-payment may be offered only as an explicit sponsor-controlled convenience with strict limits. It should not require BitUnlock to gain outgoing-payment permissions.

---

## 14.4 Mode D — Direct Multi-Party Settlement

The ideal long-term checkout routes each economic component directly to its recipient:

```text
Sponsor
  ├── compute principal → provider or worker
  ├── coordination fee → TORCH
  └── verification fee → BitUnlock
```

No recipient holds another recipient’s funds.

This may require a future BitUnlock payment-plan extension supporting more than the current seller-and-service arrangement, or a coordinated set of linked invoices with one idempotency key.

A settlement contract should define:

- Total sponsor cost.
- Recipient roles.
- Amount per recipient.
- Completion rule.
- Expiration.
- Refundability.
- Task or milestone binding.
- Whether execution begins only after every required leg settles.

For a sats-native provider, the compute leg can go directly to the provider. For fiat-credit providers, the recipient may be a separate compute liquidity provider that sells bounded inference capacity.

---

## 14.5 Mode E — Compute Liquidity Provider

OpenRouter and similar services use prepaid account credits. If sponsors cannot fund a task-specific key directly, a separate compute liquidity provider may front those credits.

The liquidity provider:

- Maintains provider balances.
- Sells bounded compute leases.
- Accepts sats.
- Bears exchange-rate and provider-credit risk.
- Receives the compute principal directly.
- May charge a disclosed spread.

TORCH remains the coordinator rather than the custodian.

The liquidity provider may be:

- An independent business.
- A Routstr node operator.
- A nonprofit sponsor.
- A project foundation.
- A legally separated TORCH affiliate.

Separating this role is cleaner than allowing TORCH’s campaign service to become an omnibus treasury by accident.

---

## 14.6 Mode F — Minimal-Custody Campaign Reserve

Some campaigns may still need pooled funds, especially when many small sponsors support a long milestone.

This should be a fallback, not the default.

Required controls:

- One wallet or account per campaign or tightly scoped funding class.
- Hard maximum balance.
- No user-to-user transfers.
- No internal transferable credits.
- No withdrawals except refund to original sponsor where supported.
- Automatic sweep of earned TORCH fees to a separate operating wallet.
- Automatic conversion of approved budget into task-specific provider credentials.
- Short maximum holding period.
- Public aggregate ledger.
- Daily reconciliation.
- Multisignature or policy-controlled treasury for material balances.
- Explicit donation, refund, and rollover terms.
- Campaign pause when reconciliation fails.

The reserve should represent prepaid services or restricted donations, not a general customer account.

---

## 15. Recommended First Economic Architecture

The first practical release should combine Modes A, B, and C.

### Campaign discovery

- Maintainer publishes approved work.
- Community follows, discusses, and pledges support.
- No funds are required merely to show demand.

### Task preparation

- TORCH defines one bounded task.
- TORCH estimates a maximum inference and worker cost.
- TORCH identifies acceptable providers.

### Funding selection

The sponsor chooses:

1. Supply a limited OpenRouter or NanoGPT key.
2. Fund an ephemeral Routstr session.
3. Use personal inference.
4. Purchase a TORCH-operated task ticket as a fallback.

### Execution

- TORCH issues a compute lease equal to or below the provider credential limit.
- Worker runs through the TORCH gateway.
- Provider usage is measured.
- Unused provider value remains with or returns to the sponsor where supported.

### Revenue settlement

- TORCH coordination fee is paid through a separate BitUnlock product or linked invoice.
- BitUnlock earns its normal successful-payment fee.
- The compute principal never enters TORCH’s general wallet in the preferred paths.

This model is not as frictionless as a pooled account, but it is much safer for an early community system.

---

## 16. TORCH Revenue Model

TORCH should charge for coordination and trust, not hide margin inside donated compute.

## 16.1 Coordination fee

TORCH may charge a disclosed percentage or fixed minimum for:

- Campaign setup.
- Task compilation.
- Prompt-policy enforcement.
- Compute lease issuance.
- Provider gateway.
- Evidence storage.
- Notification delivery.
- Campaign accounting.
- Maintainer reporting.

Illustrative launch structure:

- Fixed minimum for very small tasks.
- Percentage fee for larger milestones.
- Lower rate for public open-source campaigns.
- Higher rate for private or commercial campaigns.

## 16.2 Verification fee

Independent verification consumes inference and human attention.

A campaign may reserve a separate verification budget and TORCH may charge for:

- Blind verifier assignment.
- Evidence normalization.
- Reproduction environments.
- Duplicate detection.
- Maintainer-ready synthesis.
- Security disclosure handling.

Verification should appear as a separate economic line rather than being silently taken from the implementation budget.

## 16.3 Maintainer subscriptions

Recurring plans may include:

- Private repositories.
- Private campaigns.
- Organization policy management.
- Team roles.
- SSO.
- Priority worker availability.
- Extended artifact retention.
- Custom provider routing.
- Audit exports.
- Advanced dashboards.
- Service-level support.

Subscriptions provide predictable revenue without taking custody of campaign principal.

## 16.4 Foundry incubation fee

New projects require more coordination than a bug campaign.

A Foundry campaign may pay TORCH for:

- Charter facilitation.
- Milestone design.
- Governance templates.
- Product discovery.
- Prototype comparisons.
- Graduation planning.
- Community moderation.
- Steward recruitment.

## 16.5 Enterprise and foundation sponsorship

Organizations may pay for:

- Ecosystem-wide maintenance.
- A language or dependency security pool.
- Priority review of critical infrastructure.
- Dedicated private worker capacity.
- Public matching campaigns.
- Compliance and reporting.

## 16.6 Provider referral or routing revenue

TORCH may earn disclosed referral revenue, negotiated provider rebates, or routing fees without holding customer principal.

Provider incentives must never override:

- Project privacy policy.
- Model capability requirements.
- Cost ceilings.
- Verification independence.

## 16.7 Optional Routstr provider operation

A separate TORCH-affiliated Routstr node could resell upstream inference with a transparent margin.

This can be profitable because the node operator may set a markup over upstream cost. However, it introduces:

- Hot-wallet exposure.
- Client session balances.
- Provider-credit exposure.
- Additional accounting.
- Greater custody and operational responsibility.

It should be treated as a separate provider business, not hidden inside the TORCH campaign ledger.

---

## 17. BitUnlock Revenue Model

BitUnlock remains valuable even when the compute principal bypasses TORCH.

BitUnlock can earn from:

- Successful TORCH coordination-fee payments.
- Campaign contribution receipts.
- Milestone entitlement issuance.
- Private report access.
- Sponsored execution grants.
- Human-contributor access or claim tickets.
- Subscription payments.
- Premium recovery and reporting.
- Future multi-recipient settlement plans.

BitUnlock’s value is not merely holding or routing money. It provides:

- Verified Lightning settlement.
- Signed policy.
- Nostr-authenticated actors.
- Immutable order state.
- Idempotency.
- Encrypted fulfillment.
- Receipts and entitlements.
- Recovery.
- Revocation.
- Auditability.

The cleaner positioning is:

> **BitUnlock verifies and proves who paid for which TORCH service, while TORCH coordinates the work.**

---

## 18. Illustrative Campaign Economics

The following percentages are a design example, not a fixed policy.

For a 100,000-sat milestone:

```text
82,000 sats — compute and worker principal
 7,000 sats — independent verification reserve
 8,000 sats — TORCH coordination fee
 1,000 sats — BitUnlock service fee
 2,000 sats — payment, provider, or variance reserve
```

A lower-custody implementation would not collect these amounts into one wallet.

Instead:

```text
82,000 → provider or task-specific credential
 7,000 → verifier provider/worker
 8,000 → TORCH
 1,000 → BitUnlock
 2,000 → sponsor-controlled reserve or explicit broker
```

At campaign completion:

- Unused provider balance returns to the sponsor where possible.
- TORCH’s earned fee is final once the contracted coordination work occurs.
- BitUnlock’s fee follows its signed service policy.
- Verification funds are released only for completed verification work.
- Any nonrefundable component is disclosed before payment.

---

## 19. Human Contributor Payments

Human payments create a separate payout problem.

The lowest-custody options are:

### Direct sponsor payment

After acceptance, the contributor presents a Lightning invoice and the sponsor pays it directly.

### Project treasury payment

The participating project or foundation pays the contributor directly.

### Preselected bounty sponsor

One organization commits to paying accepted human work.

### Separate payout service

A specialized service handles contractor identity, tax documentation, and payment.

TORCH records proof of acceptance and payment status but does not hold the contributor’s balance.

A future multi-party BitUnlock plan could coordinate:

- Contributor payment.
- TORCH fee.
- BitUnlock fee.

Until then, contributor payouts should remain separate from TORCH’s incoming service-payment wallet.

---

## 20. Accounting and Transparency

Every campaign should expose a comprehensible economic record.

Public fields:

- Total pledged.
- Total settled.
- Compute funded directly.
- TORCH fees paid.
- BitUnlock fees paid.
- Provider or worker spending.
- Verification spending.
- Unused amount.
- Refund or rollover state.
- Operator subsidy.

Private fields:

- Sponsor identity unless opted in.
- Payment hashes and sensitive wallet metadata.
- Provider credentials.
- Private repository information.
- Vulnerability details.
- Human contractor tax or identity records.

The ledger should be append-only. Corrections are new entries referencing the prior entry, never silent edits.

---

## 21. Legal and Operational Caution

Custody is not only a technical property.

A system may reduce technical custody while still creating legal obligations through:

- Accepting and transmitting bitcoin on behalf of others.
- Selling redeemable internal credits.
- Exchanging bitcoin for fiat-denominated provider balances.
- Holding refundable customer funds.
- Paying contributors from pooled balances.
- Operating a marketplace.
- Serving users in multiple jurisdictions.

The recommended design reduces these facts by:

- Treating most payments as direct purchases of specific services.
- Avoiding transferable TORCH balances.
- Avoiding user-to-user value transfer.
- Avoiding indefinite pooled funds.
- Avoiding exchange services.
- Routing compute principal directly.
- Separating any compute-broker business.
- Making TORCH and BitUnlock fees explicit.

This is a product-design strategy, not a legal conclusion. Qualified legal and tax advice is required before launching pooled campaign funding, contributor payouts, refunds, or a compute-resale business.

---

## 22. Risks Unique to Feature and Project Development

### Product drift

Agents may implement what is easiest rather than what was approved.

**Control:** Signed feature contracts, acceptance scenarios, and external scope enforcement.

### Architecture fragmentation

Parallel agents may make incompatible assumptions.

**Control:** Approved architecture decisions, interface contracts, and an integration agent.

### Endless incubation

Communities may continually fund attractive prototypes that never become maintainable products.

**Control:** Milestone ceilings, stop conditions, graduation deadlines, and accountable stewards.

### Artificial demand

Agent-generated discussion or Sybil accounts may create the appearance of community interest.

**Control:** Distinguish verified human endorsements, funding, usage evidence, and anonymous signals.

### Maintainer capture by sponsors

Large sponsors may attempt to direct projects against maintainer judgment.

**Control:** Funding never implies authority unless governance explicitly grants it.

### Repository proliferation

TORCH may create many abandoned projects.

**Control:** Require charters, stewards, maintenance plans, and staged exploration before full implementation.

### Synthetic user validation

Models may claim users will like a design without real testing.

**Control:** Require human testing for user-facing milestones when specified.

### Hidden maintenance cost

A feature may pass tests while imposing long-term complexity.

**Control:** Maintenance-impact review and explicit maintainer approval.

### Treasury creep

A convenient pooled wallet may gradually become a general user-balance system.

**Control:** Enforce custody limits at the product-schema and wallet-policy level, not merely through operator promises.

---

## 23. Phased Expansion

### Phase A — Stewardship

- Opted-in projects.
- Bug reproduction.
- Fuzzing.
- Documentation.
- Dependency maintenance.
- Security analysis.
- Evidence and verification.
- BitUnlock coordination-fee payments.
- Bring-your-own compute.
- TORCH-operated workers.

### Phase B — Small Build campaigns

- Feature contracts.
- Milestones.
- Dependency graphs.
- UX and architecture roles.
- Integration agents.
- Maintainer acceptance gates.
- Sponsor-supplied limited provider keys.
- Routstr ephemeral sessions.

### Phase C — Community Build network

- Public feature proposals.
- Pledges rather than upfront deposits.
- Human testing.
- Direct worker/provider settlement.
- Advanced notifications.
- Organization subscriptions.

### Phase D — Foundry

- Project charters.
- Exploration campaigns.
- Competing prototypes.
- Stewards and governance.
- MVP milestones.
- Graduation.

### Phase E — Low-custody economic protocol

- Multi-recipient BitUnlock settlement.
- Sponsored execution grants.
- Direct provider invoices.
- Compute liquidity providers.
- Campaign multisig where pooling remains necessary.
- Multi-forge support.

---

## 24. Recommended Initial Pilot

The first Build pilot should be an existing opted-in project with a small, clearly specified feature.

Example:

> Add a bounded export feature to an existing TypeScript application, including UX states, schema validation, tests, documentation, and a rollback path.

Pilot requirements:

- One verified maintainer.
- One exact repository commit.
- One approved feature contract.
- Three to five milestones.
- TORCH-operated workers.
- Sponsor-supplied limited OpenRouter key or Routstr session.
- Separate BitUnlock payment for TORCH coordination.
- One independent verifier.
- No pooled campaign wallet.
- Draft PR only after maintainer review.
- Public cost and outcome summary.

The pilot is successful when:

- The feature solves the approved user problem.
- The maintainer accepts the result.
- Compute remained within the sponsor-defined limit.
- TORCH did not hold the compute principal.
- BitUnlock verified TORCH’s paid service.
- Reviewing the result required less maintainer attention than coordinating the work manually.

---

## 25. Final Product Definition

TORCH is not merely:

- A bug scanner.
- A bounty board.
- An autonomous coding bot.
- A wrapper around OpenRouter.
- A Nostr task-lock protocol.
- A pooled donation wallet.

TORCH is a development coordination network connecting:

- Maintainers who define welcome work.
- Human stewards who own product decisions.
- Communities that signal demand.
- Sponsors who fund specific outcomes.
- Human and AI contributors who perform bounded work.
- Verifiers who establish reproducibility and quality.
- Model providers that supply interchangeable inference.
- BitUnlock, which verifies service payments and issues durable receipts or entitlements.
- Nostr, which supplies portable identity, discovery, signaling, and relay-coordinated handoffs.
- Git for canonical source history and review.

The final positioning should be:

> **TORCH coordinates community-funded human and AI development for open-source software.**

Supporting product families:

```text
TORCH Stewardship
Maintain and strengthen existing projects.

TORCH Build
Fund and deliver maintainer-approved features.

TORCH Foundry
Incubate community-backed open-source projects.
```

Supporting line:

> **Fund useful work. Coordinate intelligence. Build open source.**

Economic principle:

> **Route principal directly, charge transparently for coordination, and hold pooled value only when no safer mechanism can accomplish the work.**

---

## 26. Reference Notes

- OpenRouter supports programmatic API-key management, including optional USD spending limits and expiration, which can support task-scoped sponsor credentials.
- OpenRouter uses prepaid credits and reports usage and cost information through its APIs.
- NanoGPT provides generally OpenAI-compatible generation endpoints, account balance reporting, pay-as-you-go modes, and X-402 support on documented endpoints.
- Routstr supports Lightning- or Cashu-funded ephemeral sessions, OpenAI-compatible requests, and refunding unused session value.
- Routstr provider nodes may set a disclosed markup over upstream model costs.
- FinCEN guidance distinguishes users purchasing goods or services from businesses engaged in accepting and transmitting convertible virtual currency, but the application to any particular TORCH structure is fact-specific.

Official documentation reviewed:

- https://openrouter.ai/docs/guides/overview/auth/management-api-keys
- https://openrouter.ai/docs/faq
- https://openrouter.ai/docs/cookbook/administration/usage-accounting
- https://docs.nano-gpt.com/
- https://docs.nano-gpt.com/api-reference/endpoint/responses
- https://docs.routstr.com/client/introduction/
- https://docs.routstr.com/client/payments/
- https://docs.routstr.com/provider/quickstart/
- https://www.fincen.gov/resources/statutes-regulations/guidance/application-fincens-regulations-persons-administering
