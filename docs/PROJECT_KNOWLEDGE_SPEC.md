# Project knowledge and domain institutional memory

Status: owner-approved development requirement, 2026-10-01. Not implemented.
The fleet remains manually paused; recording this requirement does not authorize
dispatch, new sessions, model calls, publication or automatic restart.

## Purpose

Give users and agents a shared, evolving project reference, while preserving
focused domain knowledge across session restarts, provider changes and agent
replacement. Documentation should explain how the project actually works, not
be a transcript archive, another backlog or a source of implicit authority.

## Three connected layers

1. **Project KB:** authoritative, Git-backed Markdown documenting architecture,
   setup, interfaces, workflows, pipelines, troubleshooting and decisions.
2. **Domain handbook:** a compact entry point owned by the domain, linking to
   relevant KB pages and recording domain conventions, procedures and pitfalls.
   Prefer links over duplicated shared contracts. Knowledge belongs to the
   durable domain identity, not a provider conversation or disposable session.
3. **Working memory:** current investigations, hypotheses, handoffs and unfinished
   work. It is explicitly provisional; promotion to reference documentation
   requires supporting evidence and the ordinary review/integration process.

The existing backlog remains the sole task queue. Handbooks may link to tasks
and domain coordination summaries but must not become competing task ledgers.

## Storage and adoption

The repository is the source of truth; Console indexes and search results are
rebuildable projections, never independent authoritative copies. Documentation
must remain usable offline and without TORCH. Do not require a hosted service,
particular AI provider or external documentation platform.

During init/analyze, discover existing documentation and propose a project-fit
navigation and ownership map. Reuse existing directories and conventions rather
than silently moving documents. For projects without conventions, a candidate
layout is `docs/knowledge/`, `docs/domains/<domain>/` and a clearly separated
working-memory area. Exact paths and metadata format need a reviewed implementation
contract; the layout is not a mandate for every project.

One accountable domain owns each reference page; collaborators and reviewers may
be named separately. Cross-domain interface documentation retains one owner and
review links to affected domains. Domain retirement, merge, split or reassignment
must preserve history and transfer responsibility, not delete institutional memory.

## Agent use and maintenance

Startup/resume briefs expose the compact domain index and essential references,
not the full KB. Agents retrieve relevant detail on demand and can discover
cross-domain references without loading unrelated documentation into every context.
Record which revision was supplied; warn about stale references where detectable.

Completion of a behavior, interface or workflow change requires documentation
impact to be considered: update affected pages or record why no update is needed.
Do not make clerical documentation edits a permission to change another domain's
implementation. Route cross-domain documentation changes through existing ownership
and review mechanisms and notify affected owners.

Reference pages expose owner, status (draft/experimental/reference/deprecated),
verification evidence and exact last-verified commit. A timestamp or successful
render does not prove accuracy. Branch/candidate documentation must not masquerade
as landed canonical behavior; represent divergence and unknown freshness honestly.
Flag broken links, missing owners and affected pages needing re-verification.
Do not automatically certify pages, mass-rewrite them or invent a freshness score.

## Console Knowledge view

Add a dedicated Knowledge screen, not another long Overview section. Provide
Read-the-Docs-style sidebar navigation, search, breadcrumbs, readable articles,
stable deep links, responsive/mobile navigation and keyboard accessibility.
Show owner, status, verified revision, related domains, tasks, pipeline definitions
and history. Keep handbook, reference and provisional memory visibly distinct.

Offer bounded actions to ask the responsible domain and report outdated content
through existing durable conversations/intake. Show queued/delivered outcomes;
these actions must not wake agents while paused or silently grant edit authority.
Use the same renderer for live project documentation and labelled demo fixtures.
Do not bundle private project documents into the public marketing demo.

## Safety and portability

Render repository text as untrusted content: sanitize Markdown, block script/raw
HTML execution, unsafe URL schemes, path traversal and escaping symlinks. Restrict
indexing/serving to approved documentation roots. Exclude credentials and private
working-memory content according to explicit project visibility policy, including
search snippets and cached indexes. External links/imported instructions do not
override TORCH policy. KB content does not expand operational authority.

## Required acceptance scenarios

- Existing project docs are discovered and linked without moves or overwrite;
  an empty project receives only a reviewed, project-fit plan.
- Restart or provider replacement inherits the same domain handbook; unrelated
  KB bodies are not injected into its startup context.
- A shared interface change updates its single authoritative page and routes
  affected-domain notification; unchanged pages are not falsely re-verified.
- A domain ownership change preserves document history and transfers maintenance
  responsibility without creating two authoritative copies.
- Provisional claims and candidate-branch behavior remain distinct from verified
  reference docs; missing evidence is visible rather than converted into confidence.
- Navigation, search, deep links, keyboard and mobile use work on a realistic
  multi-domain project; actual browser inspection is required before UI acceptance.
- Unsafe Markdown, traversal, symlink escape and private search leakage fail closed.
- Questions/corrections are durable while paused; no provider launch occurs.
- Markdown remains readable without TORCH, and the public demo has no private docs
  or live control-plane calls.

Implementation slices are recorded in the existing authoritative TORCH backlog.
They remain proposed and unassigned for Session Manager triage after owner resume.
