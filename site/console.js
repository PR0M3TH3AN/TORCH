const consoleViewDefinitions = Object.freeze({
  overview: { title: 'Overview' },
  'owner-briefing': { title: 'Briefing' },
  'flow-watch': { title: 'Flow watch' },
  work: { title: 'Work' },
  'initiative-progress': { title: 'Progress' },
  fleet: { title: 'Fleet' },
  communications: { title: 'Conversations' },
  organization: { title: 'Organization' },
  evidence: { title: 'Evidence' },
  delivery: { title: 'Release gates' },
});

function installConsoleViewRouting() {
  const nav = document.querySelector('.console-rail');
  const sections = [...document.querySelectorAll('.console-workspace > [data-console-view]')];
  const links = [...(nav?.querySelectorAll('a[href^="#"]') ?? [])];
  if (!nav || !sections.length || !links.length) return { sync: () => 'overview' };

  let lastHash = null;
  const initialHash = globalThis.location.hash;
  const decodeHash = (hash) => {
    try { return decodeURIComponent(String(hash ?? '').replace(/^#/, '')); } catch { return ''; }
  };

  function resolveView(hash) {
    const fragment = decodeHash(hash);
    if (consoleViewDefinitions[fragment]) return fragment;
    const target = document.getElementById(fragment);
    const containingView = target?.closest('[data-console-view]')?.dataset.consoleView;
    return consoleViewDefinitions[containingView] ? containingView : 'overview';
  }

  function accountForStickyNavigation(target) {
    const workspace = document.querySelector('.console-workspace');
    if (!workspace || !target) return;
    const railBounds = nav.getBoundingClientRect();
    const workspaceBounds = workspace.getBoundingClientRect();
    const overlapsWorkspace = railBounds.right > workspaceBounds.left + 1
      && workspaceBounds.right > railBounds.left + 1;
    if (overlapsWorkspace) {
      target.style.scrollMarginTop = `${Math.ceil(railBounds.height + 8)}px`;
    } else {
      target.style.removeProperty('scroll-margin-top');
    }
  }

  function positionNestedTarget(target, targetId, view) {
    const targetView = target?.closest('[data-console-view]')?.dataset.consoleView;
    if (!target || targetId === view || targetView !== view) return;
    for (let ancestor = target; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
    }
    accountForStickyNavigation(target);
    if (!target.hasAttribute('tabindex') && !target.matches('a[href], button, input, select, textarea, summary')) {
      target.tabIndex = -1;
    }
    target.scrollIntoView?.({ block: 'start', behavior: 'instant' });
    target.focus?.({ preventScroll: true });
  }

  const initialFragment = decodeHash(initialHash);
  let initialPositionPending = Boolean(initialFragment && !consoleViewDefinitions[initialFragment]
    && document.getElementById(initialFragment));
  const abandonInitialPosition = () => { initialPositionPending = false; };
  const onNavigation = () => {
    abandonInitialPosition();
    sync({ focus: true });
  };

  function sync({ focus = false, force = false } = {}) {
    const hash = globalThis.location.hash || '#overview';
    if (!force && hash === lastHash) return resolveView(hash);
    lastHash = hash;
    const view = resolveView(hash);
    const definition = consoleViewDefinitions[view];
    const visible = sections.filter((section) => section.dataset.consoleView === view);
    sections.forEach((section) => { section.hidden = section.dataset.consoleView !== view; });
    links.forEach((link) => {
      const route = resolveView(link.getAttribute('href'));
      if (route === view) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    const workspace = document.querySelector('.console-workspace');
    if (workspace) workspace.dataset.currentView = view;
    document.title = view === 'overview' ? 'TORCH Dashboard' : `${definition.title} | TORCH Local Fleet Console`;
    const announcement = document.querySelector('#console-view-status');
    if (announcement) announcement.textContent = `Viewing ${definition.title}.`;

    if (focus) {
      const targetId = decodeHash(hash);
      const target = document.getElementById(targetId);
      const targetView = target?.closest('[data-console-view]')?.dataset.consoleView;
      if (target && targetId !== view && targetView === view) {
        positionNestedTarget(target, targetId, view);
      } else {
        const labelledBy = visible[0]?.getAttribute('aria-labelledby');
        const heading = (labelledBy && document.getElementById(labelledBy))
          ?? visible[0]?.querySelector('h1, h2');
        if (heading) {
          heading.tabIndex = -1;
          heading.focus({ preventScroll: true });
        }
        if (target && targetId === view && targetView === view) {
          accountForStickyNavigation(target);
          target.scrollIntoView?.({ block: 'start', behavior: 'instant' });
        } else {
          globalThis.scrollTo?.({ top: 0, behavior: 'instant' });
        }
      }
    }
    return view;
  }

  globalThis.addEventListener('hashchange', onNavigation);
  globalThis.addEventListener('popstate', onNavigation);
  globalThis.addEventListener('wheel', abandonInitialPosition, { passive: true });
  globalThis.addEventListener('touchstart', abandonInitialPosition, { passive: true });
  globalThis.addEventListener('pointerdown', abandonInitialPosition, { passive: true });
  globalThis.addEventListener('keydown', (event) => {
    if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) {
      abandonInitialPosition();
    }
  });
  sync({ focus: Boolean(initialFragment && !consoleViewDefinitions[initialFragment]) });
  return {
    sync,
    afterInitialLayout() {
      if (!initialPositionPending) return;
      initialPositionPending = false;
      if (globalThis.location.hash !== initialHash) return;
      const targetId = decodeHash(initialHash);
      const view = resolveView(initialHash);
      positionNestedTarget(document.getElementById(targetId), targetId, view);
    },
  };
}

const $ = (selector) => document.querySelector(selector);
const consoleViewRouter = installConsoleViewRouting();
const demoWorkspace = globalThis.TorchConsoleDemo;
const workViews = globalThis.TorchWorkViews;
const workProgress = globalThis.TorchWorkProgress;
const emptyWorkFilters = workViews?.emptyFilters() ?? { query: '', owner: '', state: '', priority: '', domain: '' };
const workViewState = { initialized: false, key: null, storage: null, views: [], selectedId: '', warning: null };
let runtimeProfileAgents = [];
let runtimeProfileAdapters = [];
let currentBacklog = [];
let currentBacklogHealth = [];
const refreshProtection = globalThis.TorchLiveRefresh.createProtection(document);
refreshProtection.remember();
let renderingSnapshot = false;
let heldPanels = 0;

function invalidateStalePriorityPreviews(tasks = []) {
  const currentById = new Map(tasks.map((task) => [task.id, task]));
  for (const form of document.querySelectorAll('.priority-change-form[data-preview-token]')) {
    const task = currentById.get(form.dataset.taskId);
    const currentRevision = Number(task?.revision);
    const previewRevision = Number(form.dataset.revision);
    if (!task || !Number.isSafeInteger(currentRevision) || currentRevision === previewRevision) continue;

    const ticket = form.closest('.task-ticket');
    if (!ticket) continue;
    const priority = task.priority ?? 'normal';
    const priorityBadge = ticket.querySelector('.ticket-topline .priority');
    if (priorityBadge) {
      priorityBadge.className = `priority priority-${escapeHtml(priority)}`;
      priorityBadge.textContent = priority;
    }
    form.dataset.revision = String(currentRevision);
    delete form.dataset.previewToken;
    delete form.dataset.planHash;
    const priorityField = form.querySelector('[name="priority"]');
    const reasonField = form.querySelector('[name="reason"]');
    if (priorityField) priorityField.disabled = false;
    if (reasonField) reasonField.disabled = false;
    const preview = form.querySelector('[data-priority-preview]');
    if (preview) {
      preview.replaceChildren();
      preview.hidden = true;
    }
    priorityStatus(form, `Task evidence advanced to revision ${currentRevision}. The older preview was cleared; review the current task before previewing again.`);
  }
}

const escapeHtml = (value) => {
  const element = document.createElement('span');
  element.textContent = value ?? '';
  return element.innerHTML;
};

function localPath(value) {
  const path = String(value ?? '');
  return path.startsWith('/') && !path.startsWith('//') ? escapeHtml(path) : '';
}

function empty(message) {
  return `<p class="empty-state">${escapeHtml(message)}</p>`;
}

function setHtml(selector, content) {
  const element = $(selector);
  if (renderingSnapshot && refreshProtection.protects(element)) { heldPanels += 1; return; }
  if (element) {
    const open = new Set([...element.querySelectorAll('details[open]')].map((details) => details.querySelector(':scope > summary')?.textContent));
    element.innerHTML = content;
    element.querySelectorAll('details').forEach((details) => {
      if (open.has(details.querySelector(':scope > summary')?.textContent)) details.open = true;
    });
  }
}

function setText(selector, value) {
  const element = $(selector);
  if (element) element.textContent = value ?? '';
}

function compactOwnerBriefingProvenance() {
  const publication = $('#owner-briefing-content')?.querySelector('.briefing-publication');
  if (!publication) return;

  const timestamp = publication.querySelector('p time');
  const window = [...publication.querySelectorAll('.briefing-muted')]
    .find((paragraph) => paragraph.textContent.trim().startsWith('Window:'));
  if (timestamp || window) {
    const disclosure = document.createElement('details');
    disclosure.className = 'briefing-provenance';
    const summary = document.createElement('summary');
    summary.textContent = 'Publication time and reporting window';
    disclosure.append(summary);
    if (timestamp) {
      const exactTime = timestamp.cloneNode(true);
      exactTime.textContent = timestamp.getAttribute('datetime') || timestamp.textContent;
      const published = document.createElement('p');
      published.append('Published ', exactTime);
      disclosure.append(published);
      timestamp.textContent = ageLabel(timestamp.getAttribute('datetime'));
      timestamp.title = exactTime.textContent;
    }
    if (window) {
      const limitation = 'Recorded evidence, not independent live verification.';
      if (window.textContent.includes(limitation)) {
        const visibleLimitation = window.cloneNode(false);
        visibleLimitation.textContent = limitation;
        window.textContent = window.textContent.replace(limitation, '').trim();
        window.after(visibleLimitation);
      }
      disclosure.append(window);
    }
    publication.append(disclosure);
  }

  for (const code of publication.querySelectorAll('code')) {
    const commit = code.textContent.trim();
    if (!/^[a-f0-9]{40}$/i.test(commit)) continue;
    const disclosure = document.createElement('details');
    disclosure.className = 'briefing-provenance';
    const summary = document.createElement('summary');
    summary.textContent = `Commit ${shortCommit(commit)}`;
    const exact = document.createElement('code');
    exact.textContent = commit;
    disclosure.append(summary, exact);
    code.replaceWith(disclosure);
  }
}

function shortCommit(value) {
  return value ? String(value).slice(0, 9) : '—';
}

function ageLabel(value) {
  if (!value) return 'time not recorded';
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return 'time unavailable';
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function taskCard(task, healthFindings = []) {
  const affected = (task.affectedDomains ?? []).join(', ');
  const dependencies = (task.dependencies ?? []).join(', ');
  const acceptance = (task.acceptanceCriteria ?? []).map((criterion) => `<li>${escapeHtml(criterion)}</li>`).join('');
  const detail = task.description || acceptance || task.observedAt;
  const staleEvidence = healthFindings.find((finding) => finding.taskId === task.id
    && ['BACKLOG_OBSERVED_COMMIT_STALE', 'BACKLOG_OBSERVED_COMMIT_MISSING'].includes(finding.code));
  return `<article class="task-ticket">
    <div class="ticket-topline"><span class="priority priority-${escapeHtml(task.priority ?? 'normal')}">${escapeHtml(task.priority ?? 'normal')}</span></div>
    <h4>${escapeHtml(task.title ?? 'Untitled task')}</h4>
    <p>${escapeHtml(detail || 'No task description recorded.')}</p>
    <details class="task-reference"><summary>Task reference</summary><code>${escapeHtml(task.id)}</code></details>
    ${staleEvidence ? `<div class="evidence-warning" role="status"><strong>Evidence needs refresh</strong><p>${escapeHtml(staleEvidence.recommendation)}</p></div>` : ''}
    <dl class="ticket-meta">
      <div><dt>Owner</dt><dd>${escapeHtml(task.owner ?? 'Unassigned')}</dd></div>
    ${affected ? `<div><dt>Domain</dt><dd>${escapeHtml(affected)}</dd></div>` : ''}
    ${task.feature ? `<div><dt>Feature</dt><dd>${escapeHtml(task.feature)}</dd></div>` : ''}
    ${task.milestone ? `<div><dt>Milestone</dt><dd>${escapeHtml(task.milestone)}</dd></div>` : ''}
      ${dependencies ? `<div><dt>Depends on</dt><dd>${escapeHtml(dependencies)}</dd></div>` : ''}
      ${task.observedAt ? `<div><dt>Observed at</dt><dd><code>${escapeHtml(shortCommit(task.observedAt))}</code></dd></div>` : ''}
    </dl>
    ${acceptance ? `<details><summary>Acceptance criteria</summary><ul>${acceptance}</ul></details>` : ''}
    <details class="priority-change">
      <summary>Owner: change priority</summary>
      <form class="priority-change-form" data-task-id="${escapeHtml(task.id)}" data-revision="${Number(task.revision) || 0}">
        <label>New priority<select name="priority">${['urgent', 'high', 'normal', 'low'].map((value) =>
    `<option value="${value}"${(task.priority ?? 'normal') === value ? ' selected' : ''}>${value}</option>`).join('')}</select></label>
        <label>Why change it?<input name="reason" maxlength="240" required placeholder="Project-level reason"></label>
        <button type="submit">Review change</button>
        <p class="priority-change-status" role="status" aria-live="polite"></p>
        <div class="priority-change-preview" data-priority-preview hidden></div>
      </form>
    </details>
  </article>`;
}

function organizationProposalCard({ type, proposal, title, state, id }) {
  const pending = state === 'proposed';
  const pilotReady = type === 'hierarchy' && state === 'pilot-approved';
  const concluding = type === 'hierarchy' && state === 'piloting';
  const formType = concluding ? 'hierarchy-conclusion' : type;
  const details = type === 'fleet'
    ? {
      changeType: proposal.changeType,
      proposer: proposal.proposer,
      targetDomain: proposal.domainId,
      rationale: proposal.rationale,
      expectedBenefit: proposal.expectedBenefit,
      baseCommit: proposal.baseCommit,
      evidence: proposal.evidence,
    }
    : {
      proposer: proposal.proposer,
      proposalRevision: proposal.revision,
      rationale: proposal.proposal?.rationale,
      observationWindow: proposal.proposal?.observation_window,
      signals: proposal.proposal?.signals,
      alternatives: proposal.proposal?.alternatives,
      impact: proposal.proposal?.impact,
      pilot: proposal.proposal?.pilot,
      proposedOrganization: proposal.proposal?.graph,
      baseCommit: proposal.baseCommit,
    };
  const actions = concluding ? [['adopt', 'Adopt the pilot organization'], ['reverse', 'Restore prior relationships']] : type === 'fleet'
    ? [['approve', 'Approve for activation review'], ['reject', 'Reject']]
    : [['approve-pilot', 'Approve bounded pilot plan'], ['defer', 'Defer'], ['reject', 'Reject']];
  const review = pending || concluding ? `
    <details class="organization-review">
      <summary>${concluding ? 'Review pilot conclusion' : 'Review owner decision'}</summary>
      <form class="organization-review-form" data-organization-review data-type="${formType}" data-id="${escapeHtml(id)}">
        <label>Decision<select name="action" required>
          <option value="">Choose a decision</option>
          ${actions.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}
        </select></label>
        <label>Reason <span>${concluding ? '(required)' : '(required for defer or reject)'}</span><textarea name="reason" maxlength="2000" rows="2" placeholder="${concluding ? 'Explain why the pilot should be adopted or reversed.' : 'Optional for approval; required when deferring or rejecting.'}"></textarea></label>
        <div class="organization-review-actions">
          <button type="button" data-review-preview>Preview decision</button>
          <p class="organization-review-status" role="status" aria-live="polite"></p>
        </div>
        <section class="organization-review-preview" data-review-preview-panel aria-live="polite" hidden>
          <h4 data-review-title></h4>
          <p data-review-effect></p>
          <details><summary>Exact proposal and evidence in this decision</summary><pre data-review-scope></pre></details>
          <div class="organization-review-actions">
            <button type="button" data-review-confirm hidden>Confirm decision</button>
            <button type="button" class="quiet-action" data-review-edit hidden>Edit decision</button>
          </div>
        </section>
      </form>
    </details>` : '';
  const activation = pilotReady ? `
    <details class="hierarchy-activation">
      <summary>Review and activate bounded pilot</summary>
      <div class="organization-review-actions">
        <button type="button" data-hierarchy-activation-preview data-id="${escapeHtml(id)}">Preview activation</button>
        <p class="organization-review-status" data-hierarchy-activation-status role="status" aria-live="polite"></p>
      </div>
      <section class="organization-review-preview hierarchy-activation-preview" data-hierarchy-activation-panel aria-live="polite" hidden>
        <h4 data-hierarchy-activation-title></h4>
        <p data-hierarchy-activation-effect></p>
        <details><summary>Exact graph, work, schedule, and blocker impact</summary><pre data-hierarchy-activation-scope></pre></details>
        <div class="organization-review-actions">
          <button type="button" class="commit-activation" data-hierarchy-activation-confirm hidden>Commit pilot activation</button>
        </div>
      </section>
    </details>` : '';
  const pilotReviews = type === 'hierarchy' ? `
    <details class="pilot-review-history">
      <summary>Inspect pilot comparisons (${(proposal.pilotReviews ?? []).length})</summary>
      ${(proposal.pilotReviews ?? []).length ? proposal.pilotReviews.map((report) => `
        <article class="pilot-review-record" data-pilot-review="${escapeHtml(report.id)}">
          <h4>Recommendation: ${escapeHtml(report.recommendation)}</h4>
          <p>${escapeHtml(report.summary)}</p>
          <p class="pilot-review-provenance">${escapeHtml(report.reviewedAt)} · ${report.window?.complete ? 'Full review window' : 'Interim review'} · Evidence is reviewer-reported, not independently verified.</p>
          <div class="pilot-comparison-scroll"><table class="pilot-comparison-table">
            <caption>Baseline compared with pilot observations</caption>
            <thead><tr><th scope="col">Metric</th><th scope="col">Baseline</th><th scope="col">Observed</th><th scope="col">Evidence quality</th></tr></thead>
            <tbody>${(report.comparisons ?? []).map((metric) => `<tr>
              <th scope="row">${escapeHtml(metric.name)}<small>${escapeHtml(metric.unit)}</small></th>
              <td>${escapeHtml(metric.baseline)}</td><td>${escapeHtml(metric.observed)}</td>
              <td>${escapeHtml(metric.classification)}</td></tr>`).join('')}</tbody>
          </table></div>
          <details><summary>Criterion outcomes and evidence references</summary>
            <ul>${['success', 'stop'].flatMap((group) => (report[group] ?? []).map((criterion) => `
              <li>${group === 'success' ? 'Success' : 'Stop'}: ${escapeHtml(criterion.criterion)} — ${escapeHtml(criterion.outcome)}
                <small>${(criterion.evidence ?? []).map(escapeHtml).join(', ')}</small></li>`)).join('')}</ul>
            <ul>${(report.comparisons ?? []).map((metric) => `<li>${escapeHtml(metric.name)}:
              ${(metric.evidence ?? []).map(escapeHtml).join(', ')}</li>`).join('')}</ul>
            <small>Review ${escapeHtml(report.id)} · Activation ${escapeHtml(shortCommit(report.activationCommit))}</small>
          </details>
          <p>No organization change is made by this recommendation. Adoption or reversal requires a separate owner-confirmed conclusion plan.</p>
        </article>`).join('') : empty('No pilot comparisons have been recorded.')}
    </details>` : '';
  return `<article class="organization-proposal ${pending ? 'is-pending' : ''} ${pilotReady ? 'is-activation-ready' : ''}">
    <div class="organization-proposal-heading"><div><span>${type === 'fleet' ? 'Fleet change' : 'Hierarchy proposal'}</span><h3>${escapeHtml(title ?? id)}</h3><code>${escapeHtml(id)}</code></div><strong>${escapeHtml(state)}</strong></div>
    <p>${escapeHtml(type === 'fleet' ? (proposal.expectedBenefit ?? proposal.rationale ?? 'No summary provided.') : (proposal.proposal?.rationale ?? 'No rationale provided.'))}</p>
    <details class="organization-proposal-details"><summary>Inspect proposal scope and evidence</summary><pre>${escapeHtml(JSON.stringify(details, null, 2))}</pre></details>
    ${review}
    ${activation}
    ${pilotReviews}
  </article>`;
}

function viewFiltersFromControls() {
  return workViews?.normalizeFilters({
    query: $('#work-view-search')?.value,
    owner: $('#work-view-owner')?.value,
    state: $('#work-view-state')?.value,
    priority: $('#work-view-priority')?.value,
    domain: $('#work-view-domain')?.value,
    feature: $('#work-view-feature')?.value,
    milestone: $('#work-view-milestone')?.value,
  }) ?? emptyWorkFilters;
}

function setViewFilterOptions(selector, emptyLabel, values, selectedValue) {
  const select = $(selector);
  if (!select) return;
  const options = [...new Set(values.filter((value) => typeof value === 'string' && value))].sort((a, b) => a.localeCompare(b));
  if (selectedValue && !options.includes(selectedValue)) options.push(selectedValue);
  select.innerHTML = `<option value="">${escapeHtml(emptyLabel)}</option>${options.map((value) => {
    const label = value.includes('_') ? value.replaceAll('_', ' ') : value;
    return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
  }).join('')}`;
  select.value = selectedValue ?? '';
}

function selectedSavedView() {
  return workViewState.views.find((view) => view.id === workViewState.selectedId) ?? null;
}

function renderSavedViewPicker() {
  const select = $('#work-view-select');
  if (!select) return;
  select.innerHTML = `<option value="">All active work</option>${workViewState.views.map((view) =>
    `<option value="${escapeHtml(view.id)}">${escapeHtml(view.name)}</option>`).join('')}`;
  select.value = workViewState.selectedId;
  const selected = selectedSavedView();
  const update = $('#work-view-update');
  const remove = $('#work-view-delete');
  const name = $('#work-view-name');
  if (update) update.hidden = !selected;
  if (remove) remove.hidden = !selected;
  if (name && selected && !name.dataset.edited) name.value = selected.name;
  if (name && !selected && !name.dataset.edited) name.value = '';
  if (workViewState.warning) setText('#work-view-status', workViewState.warning);
}

function initializeSavedViews(snapshot) {
  const identity = snapshot.project?.id ?? snapshot.project?.root
    ?? snapshot.repository?.root ?? snapshot.project?.name ?? snapshot.repository?.name;
  let key;
  try { key = workViews?.storageKey(identity) ?? null; } catch { key = null; }
  if (workViewState.initialized && key === workViewState.key) return;
  workViewState.initialized = true;
  workViewState.key = key;
  workViewState.selectedId = '';
  workViewState.storage = null;
  workViewState.views = [];
  workViewState.warning = null;
  try { workViewState.storage = demoWorkspace?.storage ?? globalThis.localStorage; } catch {
    workViewState.warning = 'Saved views are unavailable in this browser; the backlog remains unchanged.';
  }
  if (workViewState.storage && key && workViews) {
    const result = workViews.readSavedViews(workViewState.storage, key);
    workViewState.views = result.views;
    workViewState.warning = result.warning;
  }
  const name = $('#work-view-name');
  if (name) delete name.dataset.edited;
  renderSavedViewPicker();
}

function renderWorkViewFilters(tasks = [], filters = viewFiltersFromControls()) {
  setViewFilterOptions('#work-view-owner', 'Anyone', tasks.map((task) => task.owner ?? 'Unassigned'), filters.owner);
  setViewFilterOptions('#work-view-state', 'Any state', tasks.map((task) => task.state), filters.state);
  setViewFilterOptions('#work-view-priority', 'Any priority', tasks.map((task) => task.priority ?? 'normal'), filters.priority);
  setViewFilterOptions('#work-view-domain', 'Any domain', tasks.flatMap((task) => task.affectedDomains ?? []), filters.domain);
  setViewFilterOptions('#work-view-feature', 'Any feature', tasks.map((task) => task.feature).filter(Boolean), filters.feature);
  setViewFilterOptions('#work-view-milestone', 'Any milestone', tasks.map((task) => task.milestone).filter(Boolean), filters.milestone);
}

function renderBacklog(tasks = [], healthFindings = []) {
  currentBacklog = tasks;
  currentBacklogHealth = healthFindings;
  const active = tasks.filter((task) => !['completed', 'cancelled'].includes(task.state));
  renderWorkViewFilters(active);
  const filters = viewFiltersFromControls();
  const visible = workViews?.filterTasks(active, filters) ?? active;
  const selected = selectedSavedView();
  setText('#task-count', `${visible.length} of ${active.length} active`);
  setText('#work-view-summary', `Showing ${visible.length} of ${active.length} active tasks${selected ? ` · ${selected.name}` : ''}.`);
  const lanes = [
    { title: 'Queue', states: ['proposed', 'ready'] },
    { title: 'Assigned', states: ['assigned'] },
    { title: 'In progress', states: ['in_progress'] },
    { title: 'Blocked', states: ['blocked'] },
    { title: 'Verification', states: ['verification', 'ready_to_integrate'] },
  ];
  const known = new Set(lanes.flatMap((lane) => lane.states));
  const unknownStates = [...new Set(visible.map((task) => task.state).filter((state) => !known.has(state)))];
  if (unknownStates.length) lanes.push({ title: 'Other', states: unknownStates });
  setHtml('#backlog-board', lanes.map((lane) => {
    const items = visible.filter((task) => lane.states.includes(task.state));
    return `<section class="board-lane" aria-label="${escapeHtml(lane.title)}">
      <header><h3>${escapeHtml(lane.title)}</h3><span>${items.length}</span></header>
      <div class="lane-items">${items.length ? items.map((task) => taskCard(task, healthFindings)).join('') : empty(visible.length ? `No ${lane.title.toLowerCase()} work.` : 'No active tasks match these filters.')}</div>
    </section>`;
  }).join(''));
}

function renderTaskCreateOptions(agents, tasks, installed) {
  const form = $('#task-create-form');
  if (renderingSnapshot && refreshProtection.protects(form)) { heldPanels += 1; return; }
  const fields = form?.querySelector('[data-task-create-fields]');
  const domainSelect = form?.querySelector('[name="affectedDomains"]');
  const dependencySelect = form?.querySelector('[name="dependencies"]');
  if (!form || !fields || !domainSelect || !dependencySelect) return;
  const selectedDomains = new Set([...domainSelect.selectedOptions].map((option) => option.value));
  const selectedDependencies = new Set([...dependencySelect.selectedOptions].map((option) => option.value));
  const domains = agents.filter((agent) => agent.areaId && agent.areaId !== 'session-manager')
    .sort((left, right) => left.areaId.localeCompare(right.areaId));
  domainSelect.innerHTML = domains.length ? domains.map((agent) =>
    `<option value="${escapeHtml(agent.areaId)}"${selectedDomains.has(agent.areaId) ? ' selected' : ''}>${escapeHtml(agent.title ?? agent.areaId)} · ${escapeHtml(agent.areaId)}</option>`).join('')
    : '<option value="" disabled>No installed domains available</option>';
  const active = tasks.filter((task) => !['completed', 'cancelled'].includes(task.state));
  dependencySelect.innerHTML = active.length ? active.map((task) =>
    `<option value="${escapeHtml(task.id)}"${selectedDependencies.has(task.id) ? ' selected' : ''}>${escapeHtml(task.id)} · ${escapeHtml(task.title)}</option>`).join('')
    : '<option value="" disabled>No existing tasks</option>';
  fields.disabled = !installed;
  if (!installed) {
    taskCreateStatus(form, 'Task proposals are available after this repository is installed as a Fleet. No project state was changed.');
  }
}

function renderOwnerRequestOptions(agents, tasks, installed) {
  const form = $('#owner-request-form');
  if (renderingSnapshot && refreshProtection.protects(form)) { heldPanels += 1; return; }
  const recipientSelect = $('#owner-request-recipient');
  const taskSelect = $('#owner-request-task');
  const body = $('#owner-request-body');
  const preview = form?.querySelector('[data-owner-request-preview]');
  if (!form || !recipientSelect || !taskSelect || !body || !preview) return;
  const selectedRecipient = recipientSelect.value;
  const selectedTask = taskSelect.value;
  const recipients = [...agents].filter((agent) => agent.areaId)
    .sort((left, right) => (left.areaId === 'session-manager' ? -1 : right.areaId === 'session-manager' ? 1 : left.areaId.localeCompare(right.areaId)));
  recipientSelect.innerHTML = recipients.length
    ? `<option value="">Choose an identity</option>${recipients.map((agent) => `<option value="${escapeHtml(agent.areaId)}"${selectedRecipient === agent.areaId ? ' selected' : ''}>${escapeHtml(agent.title ?? agent.areaId)} · ${escapeHtml(agent.areaId)}</option>`).join('')}`
    : '<option value="">No installed identities</option>';
  const activeTasks = tasks.filter((task) => !['completed', 'cancelled'].includes(task.state));
  taskSelect.innerHTML = `<option value="">No task reference</option>${activeTasks.map((task) => `<option value="${escapeHtml(task.id)}"${selectedTask === task.id ? ' selected' : ''}>${escapeHtml(task.id)} · ${escapeHtml(task.title)}</option>`).join('')}`;
  const enabled = installed && recipients.length > 0;
  recipientSelect.disabled = !enabled;
  taskSelect.disabled = !enabled;
  body.disabled = !enabled;
  preview.disabled = !enabled;
  const status = form.querySelector('.owner-request-status');
  if (!enabled && status) {
    status.textContent = installed ? 'No persistent identities are available in this Fleet.' : 'Install a reviewed Fleet before sending owner requests.';
  } else if (status && !status.textContent) {
    status.textContent = 'A request waits in the selected inbox; it does not start the agent.';
  }
}

function profileDescription(profile) {
  return [profile?.runtime, profile?.model, profile?.reasoning].filter(Boolean).join(' / ') || 'Adapter defaults';
}

function runtimeProfileStatus(form, message, error = false) {
  const status = form.querySelector('.runtime-profile-status');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('is-error', error);
}

function runtimeProfileInputs(form, agent, runtime) {
  const adapter = runtimeProfileAdapters.find((entry) => entry.name === runtime);
  const selectedRuntime = runtime || agent?.runtime || '';
  form.querySelector('[name="runtime"]').value = selectedRuntime;
  form.querySelector('[name="model"]').value = runtime === agent?.runtime
    ? (agent?.model ?? adapter?.model ?? '') : (adapter?.model ?? '');
  form.querySelector('[name="reasoning"]').value = runtime === agent?.runtime
    ? (agent?.reasoning ?? adapter?.reasoning ?? '') : (adapter?.reasoning ?? '');
  form.dataset.profileArea = agent?.areaId ?? '';
  form.dataset.profileRuntime = selectedRuntime;
}

function renderRuntimeProfileEditor(agents, adapters, installed) {
  const form = $('#runtime-profile-form');
  if (renderingSnapshot && refreshProtection.protects(form)) { heldPanels += 1; return; }
  const areaSelect = form?.querySelector('[name="areaId"]');
  const runtimeSelect = form?.querySelector('[name="runtime"]');
  const previewButton = form?.querySelector('[data-runtime-profile-preview]');
  if (!form || !areaSelect || !runtimeSelect || !previewButton) return;
  if (form.dataset.previewToken) return;
  form.dataset.installed = String(installed);
  runtimeProfileAgents = [...agents].filter((agent) => agent.areaId)
    .sort((left, right) => (left.areaId === 'session-manager' ? -1 : right.areaId === 'session-manager' ? 1 : left.areaId.localeCompare(right.areaId)));
  runtimeProfileAdapters = [...adapters];
  const priorArea = areaSelect.value;
  areaSelect.innerHTML = runtimeProfileAgents.length
    ? runtimeProfileAgents.map((agent) => `<option value="${escapeHtml(agent.areaId)}">${escapeHtml(agent.title ?? agent.areaId)} · ${escapeHtml(agent.areaId)}</option>`).join('')
    : '<option value="">No installed identities</option>';
  const selectedAgent = runtimeProfileAgents.find((agent) => agent.areaId === priorArea) ?? runtimeProfileAgents[0];
  areaSelect.value = selectedAgent?.areaId ?? '';
  const currentRuntime = selectedAgent?.runtime ?? '';
  const runtimeIsListed = runtimeProfileAdapters.some((adapter) => adapter.name === currentRuntime);
  const options = runtimeProfileAdapters.map((adapter) => `<option value="${escapeHtml(adapter.name)}"${adapter.available ? '' : ' disabled'}>${escapeHtml(adapter.title ?? adapter.name)}${adapter.available ? '' : ` · unavailable (${escapeHtml(adapter.status ?? 'not trusted')})`}</option>`);
  if (currentRuntime && !runtimeIsListed) options.unshift(`<option value="${escapeHtml(currentRuntime)}" disabled>Current adapter ${escapeHtml(currentRuntime)} · unavailable</option>`);
  runtimeSelect.innerHTML = options.length ? options.join('') : '<option value="">No adapters available</option>';
  const selectedRuntime = currentRuntime;
  runtimeSelect.value = selectedRuntime;
  const enabled = Boolean(installed && selectedAgent && runtimeProfileAdapters.some((adapter) => adapter.available));
  for (const field of form.querySelectorAll('select, input')) field.disabled = !enabled;
  previewButton.disabled = !enabled;
  runtimeProfileInputs(form, selectedAgent, selectedRuntime);
  runtimeProfileStatus(form, enabled
    ? 'Changes apply to future launch plans. Review the exact profile before saving.'
    : (installed ? 'No selectable runtime adapter is available for this Fleet.' : 'Install a reviewed Fleet before changing profiles.'));
}

function clearRuntimeProfilePreview(form) {
  delete form.dataset.previewToken;
  delete form.dataset.planHash;
  delete form.dataset.profilePayload;
  for (const field of form.querySelectorAll('select, input')) field.disabled = false;
  form.querySelector('[data-runtime-profile-preview]').hidden = false;
  form.querySelector('[data-runtime-profile-confirm]').hidden = true;
  form.querySelector('[data-runtime-profile-edit]').hidden = true;
  form.querySelector('[data-runtime-profile-review]').hidden = true;
  const enabled = form.dataset.installed === 'true' && runtimeProfileAgents.length > 0;
  for (const field of form.querySelectorAll('select, input')) field.disabled = !enabled;
  form.querySelector('[data-runtime-profile-preview]').disabled = !enabled;
}

function initiativeColumn(title, groups) {
  return `<section class="initiative-column" aria-label="${escapeHtml(title)}">
    <header><h3>${escapeHtml(title)}</h3><span>${groups.length} ${groups.length === 1 ? 'group' : 'groups'}</span></header>
    ${groups.length ? `<div class="initiative-list">${groups.map((group) => {
      const counts = group.counts;
      const countCopy = `${counts.completed}/${group.active} active complete · ${counts.blocked} blocked · ${counts.review} in review`;
      return `<details class="initiative-row">
        <summary><strong>${escapeHtml(group.name)}</strong><span class="initiative-state${group.status === 'At risk' ? ' is-risk' : ''}">${escapeHtml(group.status)}</span><progress max="100" value="${group.progress}" aria-label="${escapeHtml(group.name)} completion"></progress><span class="initiative-count">${escapeHtml(countCopy)}</span></summary>
        <div class="initiative-details"><p>${group.tasks.length} linked ${group.tasks.length === 1 ? 'task' : 'tasks'} · canceled tasks are excluded from the completion denominator.</p><ul>${group.tasks.map((task) => `<li><span><code>${escapeHtml(task.id)}</code> ${escapeHtml(task.title)}</span><span>${escapeHtml(task.state)}</span><span>${escapeHtml(task.owner ?? 'Unassigned')}</span></li>`).join('')}</ul></div>
      </details>`;
    }).join('')}</div>` : empty(`No backlog work is linked to a ${title.toLowerCase().replace(/s$/, '')} yet.`)}
  </section>`;
}

function renderInitiativeProgress(tasks = []) {
  const rollup = workProgress?.summarizeInitiatives(tasks) ?? { features: [], milestones: [] };
  const hasGroups = rollup.features.length + rollup.milestones.length > 0;
  const explanation = hasGroups ? ''
    : empty('No feature or milestone labels are recorded on backlog items. The Session Manager can classify work; this view will derive progress from those same tasks.');
  setHtml('#initiative-rollup', `${explanation}<div class="initiative-rollup-columns">${initiativeColumn('Features', rollup.features)}${initiativeColumn('Milestones', rollup.milestones)}</div>`);
}

function roleLinks(roleIds, rolesById) {
  if (!roleIds?.length) return 'None recorded';
  return roleIds.map((id) => {
    const target = rolesById.get(id);
    const title = target?.title ?? id;
    return `<a href="#organization-role-${escapeHtml(id)}">${escapeHtml(title)}</a>`;
  }).join('');
}

function lifecycleIdentityTitle(identityId, agentsById) {
  return agentsById.get(identityId)?.title ?? identityId;
}

function lifecycleOrderList(order = [], agentsById, managersByIdentity = {}) {
  if (!order.length) return empty('No session identities are available in this roster.');
  return `<ol class="lifecycle-order">${order.map((identityId, index) => {
    const managerIds = managersByIdentity[identityId] ?? [];
    const managerText = managerIds.length
      ? `Reports to ${managerIds.map((managerId) => escapeHtml(lifecycleIdentityTitle(managerId, agentsById))).join(', ')}`
      : 'No fleet manager dependency';
    return `<li><span class="lifecycle-order-index" aria-hidden="true">${index + 1}</span><div><strong>${escapeHtml(lifecycleIdentityTitle(identityId, agentsById))}</strong><small>${managerText}</small></div></li>`;
  }).join('')}</ol>`;
}

function lifecycleBlockerText(blocker, agentsById) {
  const area = lifecycleIdentityTitle(blocker.areaId, agentsById);
  if (blocker.code === 'FLEET_STARTUP_ROLE_MISSING') return `${area} has no approved organization role.`;
  if (blocker.code === 'FLEET_STARTUP_MANAGER_MISSING') {
    return `${area} reports to ${lifecycleIdentityTitle(blocker.managerId, agentsById)}, which is not in the Fleet roster.`;
  }
  if (blocker.code === 'FLEET_STARTUP_IDENTITY_CYCLE') {
    const identities = (blocker.areaIds ?? []).map((id) => lifecycleIdentityTitle(id, agentsById));
    return `Reporting cycle prevents a safe order: ${identities.join(', ')}.`;
  }
  return `Lifecycle order is blocked: ${blocker.code}.`;
}

function renderLifecycleOrder(lifecycle, agentsById) {
  if (!lifecycle) {
    setHtml('#organization-lifecycle', empty('Lifecycle order is available after a Fleet is installed.'));
    return;
  }
  const blockers = lifecycle.blockers ?? [];
  const startup = lifecycleOrderList(lifecycle.startupOrder, agentsById, lifecycle.managerIdsByIdentity);
  const shutdown = lifecycleOrderList(lifecycle.shutdownOrder, agentsById, lifecycle.managerIdsByIdentity);
  const blockerMarkup = blockers.length
    ? `<ul class="lifecycle-blockers" aria-label="Lifecycle blockers">${blockers.map((blocker) => `<li>${escapeHtml(lifecycleBlockerText(blocker, agentsById))}</li>`).join('')}</ul>`
    : '<p class="lifecycle-clear">No hierarchy blockers. These are planned orders only; no sessions were started or stopped.</p>';
  setHtml('#organization-lifecycle', `<div class="lifecycle-heading"><div><h3>Session lifecycle order</h3><p>Derived from approved reporting lines. Independent sessions keep their configured roster order.</p></div><span class="lifecycle-readonly">Preview only</span></div>
    <div class="lifecycle-orders">
      <section aria-labelledby="lifecycle-start-title"><h4 id="lifecycle-start-title">Start · managers first</h4>${startup}</section>
      <section aria-labelledby="lifecycle-stop-title"><h4 id="lifecycle-stop-title">Wind down · reports before managers</h4>${shutdown}</section>
    </div>${blockerMarkup}`);
}

function renderOrganization(organization, agents) {
  const graph = organization?.graph;
  if (!graph?.roles?.length) {
    setText('#organization-revision', 'No active graph');
    setHtml('#organization-map', empty(organization?.status === 'not-installed'
      ? 'This repository is still in intake. Design and approve a Fleet to establish its organization.'
      : 'No approved organization graph is available in this snapshot.'));
    renderLifecycleOrder(organization?.lifecycle ?? null, new Map(agents.map((agent) => [agent.areaId, agent])));
    return;
  }

  setText('#organization-revision', `Revision ${graph.revision} · ${graph.roles.length} ${graph.roles.length === 1 ? 'role' : 'roles'}`);
  const rolesById = new Map(graph.roles.map((role) => [role.id, role]));
  const agentsById = new Map(agents.map((agent) => [agent.areaId, agent]));
  renderLifecycleOrder(organization.lifecycle, agentsById);
  const ownersByIdentity = new Map();
  for (const owner of graph.implementation_owners ?? []) {
    if (!ownersByIdentity.has(owner.identity_id)) ownersByIdentity.set(owner.identity_id, []);
    ownersByIdentity.get(owner.identity_id).push(owner.surface);
  }
  setHtml('#organization-map', `<p class="organization-note">Reporting, coordination, and implementation are separate relationships. A role does not create an identity or grant owner-only approval.</p>
    <div class="organization-roles" role="list" aria-label="Approved organization roles">${graph.roles.map((role) => {
      const agent = role.identity_id === 'owner' ? null : agentsById.get(role.identity_id);
      const identityStatus = role.identity_id === 'owner'
        ? 'Human owner'
        : (agent ? (agent.state ?? 'offline') : 'Identity missing');
      const responsibilities = (role.responsibilities ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
      const surfaces = ownersByIdentity.get(role.identity_id) ?? [];
      return `<article id="organization-role-${escapeHtml(role.id)}" class="organization-role kind-${escapeHtml(role.kind)}" role="listitem">
        <header class="organization-role-heading"><div><h3>${escapeHtml(role.title)}</h3><p>${escapeHtml(role.kind)} · <code>${escapeHtml(role.identity_id)}</code></p></div><span class="organization-state">${escapeHtml(identityStatus)}</span></header>
        ${responsibilities ? `<ul class="organization-responsibilities">${responsibilities}</ul>` : ''}
        <dl class="organization-relations">
          <div><dt>Reports to</dt><dd>${roleLinks(role.reports_to, rolesById)}</dd></div>
          <div><dt>Coordinates</dt><dd>${roleLinks(role.coordinates, rolesById)}</dd></div>
          <div><dt>Works directly with</dt><dd>${roleLinks(role.consults_with, rolesById)}</dd></div>
          <div><dt>Authority</dt><dd>${escapeHtml((role.authority ?? []).join(', ') || 'None recorded')}</dd></div>
          ${surfaces.length ? `<div><dt>Implementation</dt><dd>${surfaces.map(escapeHtml).join(', ')}</dd></div>` : ''}
        </dl>
      </article>`;
    }).join('')}</div>`);
}

function cadenceCopy(trigger) {
  if (trigger?.type === 'interval') {
    const seconds = trigger.seconds;
    if (seconds % 3600 === 0) return `Configured every ${seconds / 3600} ${seconds === 3600 ? 'hour' : 'hours'}`;
    if (seconds % 60 === 0) return `Configured every ${seconds / 60} minutes`;
    return `Configured every ${seconds} seconds`;
  }
  if (trigger?.type === 'cron') return 'Configured cron cadence';
  return 'No check-in cadence configured';
}

function renderScheduleLauncher(snapshot) {
  const details = $('[data-schedule-launcher]');
  if (renderingSnapshot && refreshProtection.protects(details)) { heldPanels += 1; return; }
  const button = details?.querySelector('[data-schedule-launcher-preview]');
  const systemSchedules = (snapshot.schedules ?? []).filter((schedule) => schedule.lifetime === 'system');
  const state = snapshot.scheduleLauncher;
  const status = $('#schedule-launcher-state');
  if (!details || !button || !status) return;
  details.dataset.action = state?.installed ? 'reconcile' : 'install';
  button.textContent = state?.installed
    ? (state.stale ? 'Review timer refresh' : 'Timer files match configuration')
    : 'Review timer setup';
  button.disabled = snapshot.mode !== 'installed' || systemSchedules.length === 0
    || Boolean(state?.installed && !state.stale);
  if (snapshot.mode !== 'installed') status.textContent = 'Install and review a Fleet before configuring a persistent timer.';
  else if (!systemSchedules.length) status.textContent = 'No persistent system schedules are configured.';
  else if (!state?.installed) status.textContent = 'Timer not installed. Preview lists the schedules and unit files that setup would enable.';
  else if (state.stale) status.textContent = `Installed files or their configuration digest need review. Systemd running state is not queried. Current digest: ${state.currentConfigDigest}.`;
  else status.textContent = `TORCH-owned unit files match the current configuration (${state.currentConfigDigest}). Systemd running state is not queried.`;
  const launcher = state ?? {};
  const wakes = snapshot.managerWakes;
  setText('#manager-wake-count', wakes?.available ? `${wakes.blockingCount} awaiting inspection` : 'Not available');
  setHtml('#manager-wake-list', !wakes?.available
    ? empty(wakes?.reason ?? 'Manager launch records are unavailable.')
    : wakes.reservations.length ? wakes.reservations.map((record) => `
      <div class="list-row"><div><strong>${escapeHtml(record.managerId)}: ${record.blocksManagerWake ? 'Launch outcome unknown' : escapeHtml(record.outcome)}</strong>
        <small>Schedule ${escapeHtml(record.scheduleId)} · Reserved ${escapeHtml(record.reservedAt)} · Presence ${escapeHtml(record.managerState ?? 'unavailable')}</small>
        <small>Reservation ${escapeHtml(record.id)} · Message ${escapeHtml(record.messageId)}</small>
        ${record.blocksManagerWake ? '<p>Inspect the runtime before owner-approved CLI recovery. No automatic retry or budget refund.</p>' : ''}
      </div><span>${record.blocksManagerWake ? 'Wake blocked' : 'Recorded'}</span></div>
    `).join('') : empty('No manager launches have been reserved.'));
  setHtml('#schedule-list', (snapshot.schedules ?? []).length ? snapshot.schedules.map((schedule) => `
    <div class="list-row"><div><strong>${escapeHtml(schedule.id)}</strong><small>${escapeHtml(schedule.owner)} · ${escapeHtml(schedule.lifetime)} · ${escapeHtml(cadenceCopy(schedule.trigger))}</small></div><span>${escapeHtml(schedule.behavior)}</span></div>
  `).join('') : empty('No schedules configured.'));
  button.dataset.launcherReady = String(snapshot.mode === 'installed' && systemSchedules.length > 0
    && (!launcher.installed || launcher.stale));
}

function clearScheduleLauncherPreview(message = 'Review cleared. Check the current timer plan before confirming.') {
  const details = $('[data-schedule-launcher]');
  if (!details) return;
  delete details.dataset.previewToken;
  delete details.dataset.planHash;
  const button = details.querySelector('[data-schedule-launcher-preview]');
  const panel = details.querySelector('[data-schedule-launcher-review]');
  if (button) button.hidden = false;
  if (panel) panel.hidden = true;
  const confirm = details.querySelector('[data-schedule-launcher-confirm]');
  const edit = details.querySelector('[data-schedule-launcher-edit]');
  if (confirm) { confirm.hidden = true; confirm.disabled = false; }
  if (edit) edit.hidden = true;
  const status = details.querySelector('[data-schedule-launcher-status]');
  if (status) { status.textContent = message; status.classList.remove('is-error'); }
}

function scheduleLauncherStatus(message, error = false) {
  const status = $('[data-schedule-launcher-status]');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('is-error', error);
}

function showScheduleLauncherPlan(details, result) {
  const { plan } = result;
  const panel = details.querySelector('[data-schedule-launcher-review]');
  details.dataset.previewToken = result.token;
  details.dataset.planHash = result.planHash;
  details.dataset.action = plan.action;
  details.querySelector('[data-schedule-launcher-preview]').hidden = true;
  panel.querySelector('[data-schedule-launcher-title]').textContent = plan.action === 'install'
    ? 'Install the persistent TORCH schedule timer'
    : 'Refresh the existing TORCH schedule timer';
  const dailyBudget = plan.runtimeWakeBudget?.max_invocations_per_day;
  panel.querySelector('[data-schedule-launcher-effect]').textContent = plan.effect
    + (dailyBudget ? ` All managers share a limit of ${dailyBudget} wake invocations per UTC day.` : '');
  setHtml('[data-schedule-launcher-schedules]', plan.systemSchedules.length
    ? `<ul class="schedule-launcher-items">${plan.systemSchedules.map((schedule) => `
      <li><strong>${escapeHtml(schedule.title)} · ${escapeHtml(schedule.id)}</strong><small>${escapeHtml(schedule.owner)} · ${escapeHtml(cadenceCopy(schedule.trigger))} · ${escapeHtml(schedule.behavior)}</small>${schedule.action.type === 'manager-check-in' ? `<small>${escapeHtml(!schedule.action.wake?.enabled ? 'Inbox delivery only' : schedule.action.wake.budget_mode === 'invocation-count' ? 'Count-limited wake · No USD spending ceiling' : `Hard spending ceiling: $${schedule.action.wake.max_usd_per_invocation} per invocation`)}</small>` : ''}<small>Action: ${escapeHtml(JSON.stringify(schedule.action))}</small></li>
    `).join('')}</ul>` : empty('No system schedules are configured.'));
  setHtml('[data-schedule-launcher-files]', plan.files.length
    ? `<div class="schedule-launcher-files"><strong>Files and current review</strong>${plan.files.map((file) => `<div>${escapeHtml(file.name)} · ${escapeHtml(file.path)} · SHA-256 ${escapeHtml(file.sha256)}</div>`).join('')}<div>Configuration digest ${escapeHtml(plan.digest)}</div>${plan.updates?.length ? `<div>${plan.updates.filter((entry) => entry.changed).length} owned unit file(s) will change.</div>` : ''}</div>`
    : empty('No unit files are available in this plan.'));
  const confirm = panel.querySelector('[data-schedule-launcher-confirm]');
  confirm.textContent = plan.action === 'install' ? 'Install and start timer' : 'Refresh and start timer';
  confirm.disabled = !plan.canProceed;
  confirm.hidden = !plan.canProceed;
  const edit = panel.querySelector('[data-schedule-launcher-edit]');
  edit.hidden = false;
  panel.hidden = false;
  if (plan.blockers?.length) scheduleLauncherStatus(`Cannot proceed: ${plan.blockers.map((blocker) => blocker.code).join(', ')}.`, true);
  else scheduleLauncherStatus('Review each schedule and path. Nothing has changed yet.');
}

function stateClass(state) {
  return ['waiting', 'stale', 'missing', 'offline'].includes(state) ? `is-${state}` : '';
}

function renderFlowWatch(snapshot) {
  const agents = new Map((snapshot.agents ?? []).map((agent) => [agent.areaId, agent]));
  const checkIns = snapshot.managerCheckIns;
  const managers = checkIns?.managers ?? [];
  const attentionCount = managers.filter((manager) => manager.attentionRequired).length;
  setText('#manager-checkin-count', checkIns?.available
    ? `${attentionCount} of ${managers.length} need attention` : 'Not available');
  setHtml('#manager-checkin-list', checkIns?.available
    ? (managers.length ? managers.map((manager) => {
      const reports = manager.directReports ?? [];
      const reportsWithApprovals = new Map((manager.approvalWaits ?? []).map((approval) => [approval.requester, approval]));
      const findings = manager.findings ?? [];
      return `<article class="manager-watch">
        <header class="manager-watch-heading"><div><strong>${escapeHtml(manager.title ?? manager.managerId)}</strong><small> · ${escapeHtml(manager.managerId)} · ${escapeHtml(manager.state ?? 'unknown')}</small></div><span>${findings.length + reportsWithApprovals.size} ${findings.length + reportsWithApprovals.size === 1 ? 'signal' : 'signals'}</span></header>
        <p class="manager-cadence">${escapeHtml(cadenceCopy(manager.cadence))} · timer installation not verified</p>
        ${reports.length ? reports.map((report) => {
          const approval = reportsWithApprovals.get(report.areaId);
          const label = approval ? `waiting on ${approval.approver === 'owner' ? 'owner' : (agents.get(approval.approver)?.title ?? approval.approver)}`
            : report.state === 'waiting' ? 'wait reason not recorded'
              : report.state === 'offline' ? 'offline' : report.state === 'stale' ? 'stale'
                : report.state === 'missing' ? 'identity missing' : report.state;
          const task = report.task ? ` · ${report.task}` : '';
          const cls = approval || report.state === 'waiting' ? 'is-waiting' : stateClass(report.state);
          return `<div class="flow-report"><span>${escapeHtml(report.title)}<small>${escapeHtml(task)}</small></span><span class="flow-state ${cls}">${escapeHtml(label)}</span></div>`;
        }).join('') : empty('No direct reports in the active organization graph.')}
        ${findings.some((finding) => finding.type === 'unacknowledged-message')
          ? `<p class="manager-cadence">${findings.filter((finding) => finding.type === 'unacknowledged-message').reduce((sum, finding) => sum + finding.count, 0)} direct-report message(s) still need acknowledgement.</p>` : ''}
      </article>`;
    }).join('') : empty('No manager roles with direct reports are configured.'))
    : empty(checkIns?.reason ?? 'Manager check-in observations are not available.'));

  const approvalState = snapshot.approvalRequests;
  const pending = (approvalState?.items ?? []).filter((approval) => approval.status === 'pending');
  setText('#approval-request-count', approvalState?.available
    ? `${approvalState.pendingCount ?? pending.length} open` : 'Not available');
  setHtml('#approval-request-list', approvalState?.available
    ? (pending.length ? pending.map((approval) => {
      const requester = agents.get(approval.requester);
      const approver = approval.approver === 'owner' ? 'Project owner'
        : (agents.get(approval.approver)?.title ?? approval.approver);
      const waitClass = approval.approver === 'owner' ? 'wait-owner'
        : approval.approver === 'session-manager' ? 'wait-manager' : '';
      const refs = [approval.task, approval.evidence].filter(Boolean).map((reference) => escapeHtml(reference)).join(' · ');
      return `<article class="approval-item ${waitClass}" id="approval-${escapeHtml(encodeURIComponent(approval.id))}">
        <h4>${escapeHtml(approval.title)}</h4>
        <p>${escapeHtml(requester?.title ?? approval.requester)} is waiting on <strong class="approval-target">${escapeHtml(approver)}</strong>${refs ? ` · ${refs}` : ''}</p>
        <details><summary>Request details · ${escapeHtml(ageLabel(approval.createdAt))}</summary><p>${escapeHtml(approval.summary)}</p></details>
        ${approval.approver === 'owner' ? `<form class="approval-decision-form" data-approval-id="${escapeHtml(approval.id)}" data-revision="${Number(approval.revision) || 0}">
          <label>Owner decision<select name="decision" required><option value="">Choose…</option><option value="approved">Approve</option><option value="rejected">Reject</option></select></label>
          <label>Note <span>(optional)</span><textarea name="note" maxlength="2000" rows="2" placeholder="Context the requester should receive"></textarea></label>
          <div class="approval-decision-actions"><button type="button" data-approval-preview>Review decision</button><p class="approval-decision-status" role="status" aria-live="polite"></p></div>
          <section class="approval-decision-preview" data-approval-preview-panel aria-live="polite" hidden>
            <h4 data-approval-preview-title></h4><p data-approval-preview-effect></p>
            <details><summary>Exact request and evidence</summary><pre data-approval-preview-scope></pre></details>
            <div class="approval-decision-actions"><button type="button" data-approval-confirm hidden>Confirm decision</button><button type="button" class="quiet-action" data-approval-edit hidden>Change decision</button></div>
          </section>
        </form>` : `<p class="approval-owner-boundary">Decision belongs to ${escapeHtml(approver)}. The owner Console will not transfer that authority.</p>`}
      </article>`;
    }).join('') : empty('No open approval requests.'))
    : empty(approvalState?.reason ?? 'Structured approval requests are not available.'));
}

function attentionGroups(snapshot) {
  return globalThis.TorchAttentionProjection.groups(snapshot);
}
function renderAttention(groups) {
  const definitions = [
    ['owner', 'Waiting on you', 'Only requests that name the project owner as decision-maker.'],
    ['fleet', 'Fleet handling', 'A named domain owns the next step; unknown ownership stays explicit.'],
    ['arbiter', 'Arbiter handling', 'No observed item has structured evidence assigning its next step exclusively to an arbiter.'],
  ];
  const total = Object.values(groups).reduce((sum, items) => sum + items.length, 0);
  setText('#attention-count', `${total} ${total === 1 ? 'item' : 'items'}`);
  setHtml('#attention-list', definitions.map(([key, title, description]) => {
    const items = groups[key];
    return `<section class="attention-group attention-group-${key}" aria-labelledby="attention-${key}-title">
      <div class="attention-group-heading"><h3 id="attention-${key}-title">${title}</h3><span>${items.length}</span></div>
      ${items.length ? items.map((item) => `<article class="attention-item tone-${escapeHtml(item.tone)}">
        <span class="attention-mark" aria-hidden="true"></span><div class="attention-copy">
          <strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.detail)}</p>
          <small>Severity: ${escapeHtml(({ urgent: 'Urgent', review: 'Review', decision: 'Decision required', info: 'Progress' })[item.tone] ?? 'Unknown')} · Owner: ${escapeHtml(item.owner)}${item.waitSince ? ` · Waiting ${escapeHtml(ageLabel(item.waitSince))}` : ''}</small>
          ${item.evidence.length > 120
            ? `<details class="attention-evidence"><summary>Evidence and references</summary><p>${escapeHtml(item.evidence)}</p></details>`
            : `<small class="attention-evidence-short">Evidence: ${escapeHtml(item.evidence)}</small>`}
          <a href="${escapeHtml(item.href)}">${escapeHtml(item.action)}</a>
          ${item.decisionApprovalId ? `<div class="attention-quick-actions" role="group" aria-label="Owner decision shortcuts for ${escapeHtml(item.title)}">
            <button type="button" data-attention-decision="approved" data-attention-approval="${escapeHtml(item.decisionApprovalId)}">Approve</button>
            <button type="button" class="quiet-action" data-attention-decision="rejected" data-attention-approval="${escapeHtml(item.decisionApprovalId)}">Reject</button>
            <p class="attention-action-status" role="status" aria-live="polite" hidden></p>
          </div>` : ''}
          ${item.requestOwner ? `<a href="#owner-request-form" data-attention-recipient="${escapeHtml(item.requestOwner)}">Request review from ${escapeHtml(item.owner)}</a>` : ''}
        </div></article>`).join('') : `<p class="attention-empty">${escapeHtml(description)}</p>`}
    </section>`;
  }).join(''));
}

function render(snapshot) {
  const project = snapshot.project ?? snapshot.repository;
  const agents = snapshot.agents ?? [];
  const tasks = snapshot.backlog ?? [];
  initializeSavedViews(snapshot);
  const active = tasks.filter((task) => !['completed', 'cancelled'].includes(task.state));
  const working = active.filter((task) => task.state === 'in_progress').length;
  const blocked = active.filter((task) => task.state === 'blocked').length;
  const attention = attentionGroups(snapshot);
  const branch = snapshot.repository?.branch ?? 'branch not recorded';

  setText('#project-name', project?.name ?? project?.id ?? 'Not installed');
  setText('#project-branch', branch);
  setText('#project-branch-detail', branch);
  setText('#project-commit', shortCommit(snapshot.repository?.head));
  setText('#fleet-health', snapshot.mode === 'installed'
    ? (snapshot.doctor?.healthy ? 'Healthy' : 'Review findings') : 'Not installed');
  setText('#project-dirty', snapshot.repository?.dirty ? 'Uncommitted changes' : 'Clean at snapshot');
  setText('#context-state', snapshot.contextLocality?.measured ? 'Measured' : 'Not measured');
  setText('#recoverability-state', snapshot.mode === 'installed'
    ? (snapshot.recoverability?.level ?? 'Unknown') : 'Not installed');
  setText('#agent-count', `${agents.length} ${agents.length === 1 ? 'identity' : 'identities'}`);
  setText('#snapshot-time', `Updated ${ageLabel(snapshot.generatedAt)}`);
  setText('#snapshot-provenance', demoWorkspace ? 'Sample project · Changes stay in this tab' : `Read-only snapshot · ${snapshot.schema ?? 'schema unavailable'}`);
  const parts = [`${agents.length} persistent ${agents.length === 1 ? 'identity' : 'identities'}`,
    `${working} ${working === 1 ? 'task' : 'tasks'} in progress`];
  if (blocked) parts.push(`${blocked} blocked`);
  const attentionCount = Object.values(attention).reduce((sum, items) => sum + items.length, 0);
  setText('#project-summary', snapshot.mode === 'installed'
    ? `${parts.join(' · ')}. ${attentionCount ? `${attentionCount} item${attentionCount === 1 ? '' : 's'} need a named next step.` : 'No owner decision is currently waiting in the observed queues.'}`
    : 'This repository has not been installed as a TORCH Fleet. The view is showing repository intake only.');
  renderTaskCreateOptions(agents, tasks, snapshot.mode === 'installed');
  renderOwnerRequestOptions(agents, tasks, snapshot.mode === 'installed');
  renderRuntimeProfileEditor(agents, snapshot.runtimeAdapters ?? [], snapshot.mode === 'installed');
  renderFlowWatch(snapshot);
  setHtml('#owner-briefing-content', globalThis.TorchOwnerDigest.render(snapshot.ownerDigest));
  compactOwnerBriefingProvenance();

  renderAttention(attention);

  renderBacklog(tasks, snapshot.backlogHealth?.findings ?? []);
  setHtml('#activity-review-content', globalThis.TorchTaskActivity.render(snapshot.backlogActivity));
  renderInitiativeProgress(tasks);
  setHtml('#agent-list', agents.length ? agents.map((agent) => {
    const profile = [agent.runtime, agent.model, agent.reasoning].filter(Boolean).join(' / ') || 'Profile not recorded';
    const live = agent.state !== 'offline';
    return `<article class="agent-row">
      <span class="presence ${escapeHtml(agent.state)}" aria-label="${live ? 'Active' : 'Offline'}"></span>
      <div class="agent-copy"><strong>${escapeHtml(agent.title ?? agent.areaId)}</strong><span>${escapeHtml(agent.summary ?? profile)}</span><small>${escapeHtml(agent.areaId)} · ${escapeHtml(profile)}</small></div>
      <div class="agent-state"><strong>${escapeHtml(agent.state ?? 'unknown')}</strong><small>${escapeHtml(ageLabel(agent.heartbeatAt))}</small></div>
    </article>`;
  }).join('') : empty('Install an approved Fleet to see persistent identities.'));

  const domains = snapshot.organization?.domains ?? [];
  setHtml('#ownership-list', domains.length ? domains.map((domain) => `
    <div class="list-row"><div><strong>${escapeHtml(domain.title ?? domain.id)}</strong><small>${escapeHtml((domain.owned_paths ?? []).join(', ') || 'No implementation paths assigned')}</small></div><span>${escapeHtml((domain.neighbours ?? []).join(', ') || 'No peer links')}</span></div>
  `).join('') : empty('No approved domain ownership graph.'));
  renderOrganization(snapshot.organization, agents);

  const messages = snapshot.messages?.recent ?? [];
  setText('#message-count', `${snapshot.messages?.unacknowledged ?? 0} unacknowledged`);
  setHtml('#message-list', messages.length ? messages.map((message) => {
    const refs = [message.task, message.path, message.commit].filter(Boolean);
    const ack = (message.acknowledgedBy ?? []).length
      ? `Acknowledged by ${message.acknowledgedBy.join(', ')}` : 'Awaiting acknowledgement';
    return `<article class="conversation-item" id="message-${escapeHtml(message.id)}"><div class="conversation-meta"><strong>${escapeHtml(message.sender)} to ${escapeHtml(message.recipient)}</strong><span>${escapeHtml(ageLabel(message.createdAt))}</span></div><p>${escapeHtml(message.body)}</p><small>${escapeHtml(ack)}${refs.length ? ` · ${escapeHtml(refs.join(' · '))}` : ''}</small></article>`;
  }).join('') : empty('No durable messages yet. Runtime-native private reasoning is not shown here.'));

  setHtml('#check-list', globalThis.TorchCheckEvidence.render(snapshot.checks));

  const artifacts = snapshot.artifacts?.items ?? [];
  setHtml('#artifact-list', artifacts.length ? artifacts.map((artifact) => `
    <article class="artifact-item">
      ${localPath(artifact.thumbnailUrl ?? artifact.url) ? `<img src="${localPath(artifact.thumbnailUrl ?? artifact.url)}" alt="${escapeHtml(artifact.alt ?? 'Project review artifact')}">` : '<div class="artifact-unavailable">Image unavailable or failed its integrity check</div>'}
      <div class="artifact-caption">
        <strong>${escapeHtml(artifact.title ?? artifact.name)}</strong>
        <dl class="artifact-provenance">
          <div><dt>Task</dt><dd>${escapeHtml(artifact.taskId ?? 'Not recorded')}</dd></div>
          <div><dt>Identity</dt><dd>${escapeHtml(artifact.identityId ?? 'Not recorded')}</dd></div>
          ${artifact.sessionId ? `<div><dt>Runtime session</dt><dd>${escapeHtml(artifact.sessionId)}</dd></div>` : ''}
          <div><dt>Commit</dt><dd><code>${escapeHtml(shortCommit(artifact.commit))}</code></dd></div>
        </dl>
        <small>${escapeHtml(artifact.integrity === 'available' ? 'Catalogued image' : 'Unavailable evidence')} · ${escapeHtml(ageLabel(artifact.createdAt))}</small>
      </div>
      <section class="artifact-feedback" aria-label="Owner feedback">
        <h4>Review notes <span>${(artifact.feedback ?? []).length}</span></h4>
        ${(artifact.feedback ?? []).length ? artifact.feedback.map((comment) => `<blockquote><p>${escapeHtml(comment.body)}</p><footer>Owner · ${escapeHtml(ageLabel(comment.createdAt))} · sent to ${escapeHtml(comment.recipient)}</footer></blockquote>`).join('') : '<p class="no-feedback">No owner feedback on this image.</p>'}
        <form class="artifact-feedback-form" data-artifact-id="${escapeHtml(artifact.id)}">
          <label for="feedback-body-${escapeHtml(artifact.id)}">Send a note to <code>${escapeHtml(artifact.identityId ?? 'the responsible identity')}</code></label>
          <textarea id="feedback-body-${escapeHtml(artifact.id)}" name="body" rows="3" maxlength="4000" required placeholder="Describe what should change or what looks right."></textarea>
          <div class="feedback-form-actions"><button type="submit">Review feedback</button><span>Nothing is sent until you confirm the preview.</span></div>
          <p class="feedback-form-status" role="status" aria-live="polite"></p>
          <div class="feedback-preview" data-feedback-preview hidden></div>
        </form>
      </section>
    </article>
  `).join('') : empty(snapshot.artifacts?.available === false
    ? (snapshot.artifacts?.reason ?? 'Artifact review is not connected to this snapshot yet. Images need task, session, and commit provenance.')
    : 'No linked screenshots or review artifacts are recorded.'));

  const integrations = snapshot.integration ?? [];
  setHtml('#integration-list', integrations.length ? integrations.map((item) => `
    <div class="list-row"><div><strong>#${Number(item.queueOrder) || '—'} · ${escapeHtml(item.sourceArea)} · ${escapeHtml(shortCommit(item.sourceCommit))}</strong><small>${item.authorizedBy ? `Authorized by ${escapeHtml(item.authorizedBy)} · ` : ''}${escapeHtml(item.reason ?? 'Awaiting checks or landing review')}</small></div><span>${escapeHtml(item.state)}</span></div>
  `).join('') : empty('No pending integration requests.'));
  const deliveries = snapshot.deliveries ?? [];
  setHtml('#delivery-list', deliveries.length ? deliveries.map((item) => `
    <div class="list-row"><div><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.sourceArea)} · ${escapeHtml(shortCommit(item.commit))}</small></div><span>${escapeHtml(item.state)}</span></div>
  `).join('') : empty('No delivery records. Integration does not imply deployment.'));
  setHtml('#operation-outcomes', globalThis.TorchOperationOutcomes.render(snapshot));

  const changes = snapshot.fleetChanges ?? [];
  const proposals = snapshot.hierarchyProposals ?? [];
  const allChanges = [
    ...changes.map((change) => organizationProposalCard({ type: 'fleet', proposal: change, title: change.title, state: change.state, id: change.id })),
    ...proposals.map((proposal) => organizationProposalCard({ type: 'hierarchy', proposal, title: proposal.proposal?.title, state: proposal.state, id: proposal.id })),
  ];
  const pending = [...changes, ...proposals].filter((change) => change.state === 'proposed');
  setText('#change-count', `${pending.length} pending`);
  setHtml('#change-list', allChanges.length ? allChanges.join('') : empty('No Fleet or hierarchy proposals. The active organization remains in force.'));

  const worktrees = snapshot.worktrees ?? [];
  setHtml('#worktree-list', worktrees.length ? worktrees.map((worktree) => `
    <div class="list-row" id="worktree-${escapeHtml(encodeURIComponent(worktree.area))}"><div><strong>${escapeHtml(worktree.area)}</strong><small>${escapeHtml(worktree.branch)} · ${escapeHtml(worktree.path)}</small></div><span>${escapeHtml(`${worktree.ahead ?? 0} ahead / ${worktree.behind ?? 0} behind`)}</span></div>
  `).join('') : empty('No managed worktrees have been created.'));

  const holders = snapshot.resources?.holders ?? [];
  const waiters = snapshot.resources?.waiters ?? [];
  setHtml('#resource-list', holders.length || waiters.length
    ? [...holders.map((item) => `<div class="list-row"><strong>${escapeHtml(item.resourceId)}</strong><span>${escapeHtml(item.areaId)} holds</span></div>`),
      ...waiters.map((item) => `<div class="list-row"><strong>${escapeHtml(item.resourceId)}</strong><span>${escapeHtml(item.areaId)} waits</span></div>`)].join('')
    : empty('All configured resources are available.'));
  renderScheduleLauncher(snapshot);
  const providers = snapshot.providers ?? {};
  setHtml('#provider-list', [
    `<div class="list-row"><strong>Forge</strong><span>${escapeHtml(snapshot.mode === 'installed' ? `${providers.forge?.provider ?? 'none'} · ${providers.forge?.status ?? 'unknown'}` : 'not configured')}</span></div>`,
    ...(providers.runtimes ?? []).map((runtime) => `<div class="list-row"><strong>${escapeHtml(runtime.name)}</strong><span>${escapeHtml(runtime.configured ? 'configured' : 'unavailable')}</span></div>`),
    `<div class="list-row"><strong>Release</strong><span>${escapeHtml(providers.delivery?.release?.provider ?? 'not configured')}</span></div>`,
    `<div class="list-row"><strong>Deployment</strong><span>${escapeHtml(providers.delivery?.deployment?.provider ?? 'not configured')}</span></div>`,
  ].join(''));

  const decisions = snapshot.decisions?.content ?? '';
  setHtml('#decision-list', decisions.trim()
    ? `<p class="decision-copy">${escapeHtml(decisions)}</p>` : empty('No tracked decisions.'));
  const locality = snapshot.contextLocality;
  setHtml('#context-detail', locality?.measured
    ? (locality.samples ?? []).map((sample) => `<div class="list-row"><strong>${escapeHtml(sample.areaId)}</strong><span>${escapeHtml(String(sample.cacheRead ?? 0))} cached tokens</span></div>`).join('')
    : `<p>${escapeHtml(locality?.reason ?? 'Runtime usage reporting is not available.')}</p><small>TORCH compares cache activity with verified outcomes, not token count alone.</small>`);
}

let liveUpdatesPaused = false;
let appliedRefreshes = 0;
const refreshScheduler = globalThis.TorchLiveRefresh.createScheduler({
  load: async () => {
    if (demoWorkspace) return demoWorkspace.snapshot();
    const response = await fetch('/api/snapshot', { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    const snapshot = await response.json();
    if (!response.ok) throw new Error(snapshot.message ?? snapshot.error);
    if (snapshot.schema !== 'torch.dev/observation/v1alpha1') throw new Error('Snapshot schema is unavailable or unsupported');
    return snapshot;
  },
  apply: (snapshot) => {
    const viewportBeforeRender = appliedRefreshes > 0
      ? { left: globalThis.scrollX, top: globalThis.scrollY } : null;
    const editedBeforeRender = refreshProtection.dirty();
    heldPanels = 0;
    renderingSnapshot = true;
    try { render(snapshot); } finally { renderingSnapshot = false; }
    if (viewportBeforeRender) globalThis.scrollTo?.({ ...viewportBeforeRender, behavior: 'instant' });
    invalidateStalePriorityPreviews(snapshot.backlog ?? []);
    refreshProtection.remember({ preserve: editedBeforeRender });
    $('#console-error').hidden = true;
    const status = $('#live-refresh-status');
    status.dataset.generation = String(++appliedRefreshes);
    status.textContent = `${liveUpdatesPaused ? 'Automatic updates paused.' : 'Updates every 15 seconds while visible.'}${heldPanels ? ' Edited forms and active previews retained; their panels may show older state.' : ''}`;
    if (appliedRefreshes === 1) consoleViewRouter.afterInitialLayout();
  },
  onError: (caught) => {
    const error = $('#console-error');
    error.textContent = `Snapshot unavailable: ${caught.message}. Last displayed evidence retained.`;
    error.hidden = false;
  },
});
function refresh({ completed = null, background = false } = {}) {
  if (completed) refreshProtection.complete(completed);
  return refreshScheduler.request({ supersede: !background });
}

async function feedbackRequest(path, payload) {
  if (demoWorkspace) return demoWorkspace.request(path, payload);
  const response = await fetch(path, {
    method: 'POST', cache: 'no-store', credentials: 'same-origin',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message ?? result.error ?? `Request failed (${response.status})`);
  return result;
}

async function consoleActionRequest(path, payload) {
  if (demoWorkspace) return demoWorkspace.request(path, payload);
  const response = await fetch(path, {
    method: 'POST', cache: 'no-store', credentials: 'same-origin',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message ?? result.error ?? `Request failed (${response.status})`);
  return result;
}

function approvalDecisionStatus(form, message, error = false) {
  const status = form.querySelector('.approval-decision-status');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('is-error', error);
}

function clearApprovalDecision(form, message = 'Preview cleared. Review the current request before deciding.') {
  delete form.dataset.previewToken;
  delete form.dataset.planHash;
  form.querySelector('[name="decision"]').disabled = false;
  form.querySelector('[name="note"]').disabled = false;
  form.querySelector('[data-approval-preview]').disabled = false;
  form.querySelector('[data-approval-preview-panel]').hidden = true;
  form.querySelector('[data-approval-confirm]').hidden = true;
  form.querySelector('[data-approval-edit]').hidden = true;
  approvalDecisionStatus(form, message);
}

$('#approval-request-list')?.addEventListener('click', async (event) => {
  const edit = event.target.closest('[data-approval-edit]');
  if (edit) {
    const form = edit.closest('.approval-decision-form');
    if (form) clearApprovalDecision(form);
    return;
  }
  const previewButton = event.target.closest('[data-approval-preview]');
  const confirmButton = event.target.closest('[data-approval-confirm]');
  const form = event.target.closest('.approval-decision-form');
  if (!form) return;
  if (previewButton) {
    const decision = form.querySelector('[name="decision"]').value;
    const note = form.querySelector('[name="note"]').value.trim();
    if (!decision) {
      approvalDecisionStatus(form, 'Choose approve or reject first.', true);
      form.querySelector('[name="decision"]').focus();
      return;
    }
    previewButton.disabled = true;
    approvalDecisionStatus(form, 'Rechecking the named approver and current request revision…');
    try {
      const id = form.dataset.approvalId;
      const result = await consoleActionRequest(`/api/approvals/${encodeURIComponent(id)}/decision/preview`, { decision, note });
      const { plan } = result;
      form.dataset.previewToken = result.token ?? '';
      form.dataset.planHash = result.planHash;
      form.querySelector('[name="decision"]').disabled = true;
      form.querySelector('[name="note"]').disabled = true;
      form.querySelector('[data-approval-preview-panel]').hidden = false;
      form.querySelector('[data-approval-preview-title]').textContent = `Confirm ${plan.decision} · ${plan.title}`;
      form.querySelector('[data-approval-preview-effect]').textContent = plan.effect;
      form.querySelector('[data-approval-preview-scope]').textContent = JSON.stringify({
        approvalId: plan.approvalId, requester: plan.requester, approver: plan.approver,
        revision: plan.revision, task: plan.task, evidence: plan.evidence, note: plan.note,
      }, null, 2);
      form.querySelector('[data-approval-confirm]').textContent = `Confirm ${plan.decision}`;
      form.querySelector('[data-approval-confirm]').hidden = false;
      form.querySelector('[data-approval-edit]').hidden = false;
      approvalDecisionStatus(form, 'Preview is bound to this request revision for five minutes.');
    } catch (error) {
      approvalDecisionStatus(form, error.message, true);
    } finally { previewButton.disabled = false; }
    return;
  }
  if (!confirmButton) return;
  confirmButton.disabled = true;
  approvalDecisionStatus(form, 'Recording the owner decision and notifying the requester…');
  try {
    const id = form.dataset.approvalId;
    const result = await consoleActionRequest(`/api/approvals/${encodeURIComponent(id)}/decision`, {
      decision: form.querySelector('[name="decision"]').value,
      note: form.querySelector('[name="note"]').value.trim(),
      token: form.dataset.previewToken, planHash: form.dataset.planHash,
    });
    approvalDecisionStatus(form, `${result.approval.status} and requester notified.`);
    await refresh({ completed: form });
  } catch (error) {
    approvalDecisionStatus(form, error.message, true);
    confirmButton.disabled = false;
  }
});

function priorityStatus(form, message, error = false) {
  const status = form.querySelector('.priority-change-status');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('is-error', error);
}

function taskCreateStatus(form, message, error = false) {
  const status = form?.querySelector('.task-create-status');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('is-error', error);
}

function taskCreatePayload(form) {
  const data = new FormData(form);
  return {
    title: String(data.get('title') ?? '').trim(),
    description: String(data.get('description') ?? '').trim(),
    priority: String(data.get('priority') ?? 'normal'),
    affectedDomains: [...form.querySelector('[name="affectedDomains"]').selectedOptions].map((option) => option.value),
    dependencies: [...form.querySelector('[name="dependencies"]').selectedOptions].map((option) => option.value),
    acceptanceCriteria: String(data.get('acceptanceCriteria') ?? '').split('\n').map((item) => item.trim()).filter(Boolean),
    feature: String(data.get('feature') ?? '').trim(),
    milestone: String(data.get('milestone') ?? '').trim(),
  };
}

function taskCreatePreviewMarkup(plan) {
  const task = plan.task;
  const criteria = task.acceptanceCriteria.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  return `<div><strong>Review this proposal</strong><p>This is the exact task TORCH will add.</p></div>
    <h4>${escapeHtml(task.title)}</h4><p>${escapeHtml(task.description)}</p>
    <dl><div><dt>Initial state</dt><dd>Proposed · unassigned</dd></div><div><dt>Priority</dt><dd>${escapeHtml(task.priority)}</dd></div>
    <div><dt>Suggested domains</dt><dd>${task.affectedDomains.length ? escapeHtml(task.affectedDomains.join(', ')) : 'Session Manager triage'}</dd></div>
    <div><dt>Dependencies</dt><dd>${task.dependencies.length ? escapeHtml(task.dependencies.join(', ')) : 'None'}</dd></div>
    <div><dt>Feature / milestone</dt><dd>${escapeHtml([task.feature, task.milestone].filter(Boolean).join(' / ') || 'Not labeled')}</dd></div>
    <div><dt>Observed commit</dt><dd><code>${escapeHtml(shortCommit(task.observedAt))}</code></dd></div></dl>
    <div><strong>Acceptance criteria</strong><ul>${criteria}</ul></div>
    <p>${escapeHtml(plan.authority)} ${escapeHtml(plan.effect)}</p>
    <div class="feedback-form-actions"><button type="button" data-task-create-confirm>Create proposed task</button><button type="button" class="quiet-action" data-task-create-edit>Edit proposal</button></div>`;
}

$('#task-create-form')?.addEventListener('submit', async (event) => {
  const form = event.target.closest('#task-create-form');
  if (!form) return;
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  if (!button) return;
  button.disabled = true;
  taskCreateStatus(form, 'Preparing the exact task proposal…');
  try {
    const payload = taskCreatePayload(form);
    const result = await consoleActionRequest('/api/backlog/tasks/preview', payload);
    form.dataset.createPayload = JSON.stringify(payload);
    form.dataset.previewToken = result.token;
    form.dataset.planHash = result.planHash;
    form.querySelector('[data-task-create-fields]').disabled = true;
    const preview = form.querySelector('[data-task-create-preview]');
    preview.innerHTML = taskCreatePreviewMarkup(result.plan);
    preview.hidden = false;
    taskCreateStatus(form, 'Review routing hints and the proposed, unassigned effect before confirming.');
  } catch (error) {
    taskCreateStatus(form, error.message, true);
  } finally { button.disabled = false; }
});

$('#task-create-form')?.addEventListener('click', async (event) => {
  const form = event.currentTarget;
  const edit = event.target.closest('[data-task-create-edit]');
  if (edit) {
    delete form.dataset.createPayload;
    delete form.dataset.previewToken;
    delete form.dataset.planHash;
    form.querySelector('[data-task-create-fields]').disabled = false;
    form.querySelector('[data-task-create-preview]').hidden = true;
    taskCreateStatus(form, 'Preview cleared. Review the edited proposal before creating it.');
    return;
  }
  const confirm = event.target.closest('[data-task-create-confirm]');
  if (!confirm) return;
  const token = form.dataset.previewToken;
  const planHash = form.dataset.planHash;
  if (!token || !planHash || !form.dataset.createPayload) return;
  confirm.disabled = true;
  taskCreateStatus(form, 'Creating the reviewed task proposal…');
  try {
    const payload = JSON.parse(form.dataset.createPayload);
    const result = await consoleActionRequest('/api/backlog/tasks', { ...payload, token, planHash });
    setText('#task-create-action-status', `${result.task.id} added as proposed and unassigned. The Session Manager retains triage; no agent was started.`);
    $('#task-create-action-status').hidden = false;
    form.reset();
    form.querySelector('[data-task-create-fields]').disabled = false;
    form.querySelector('[data-task-create-preview]').hidden = true;
    delete form.dataset.createPayload;
    delete form.dataset.previewToken;
    delete form.dataset.planHash;
    form.closest('details').open = false;
    taskCreateStatus(form, 'Task proposal created.');
    await refresh({ completed: form });
  } catch (error) {
    delete form.dataset.createPayload;
    delete form.dataset.previewToken;
    delete form.dataset.planHash;
    form.querySelector('[data-task-create-fields]').disabled = false;
    form.querySelector('[data-task-create-preview]').hidden = true;
    taskCreateStatus(form, `${error.message} Review the task list before trying again.`, true);
  } finally { confirm.disabled = false; }
});

$('#backlog-board')?.addEventListener('submit', async (event) => {
  const form = event.target.closest('.priority-change-form');
  if (!form) return;
  event.preventDefault();
  const priority = form.querySelector('[name="priority"]')?.value;
  const reason = form.querySelector('[name="reason"]')?.value.trim();
  const expectedRevision = Number(form.dataset.revision);
  const button = form.querySelector('button[type="submit"]');
  if (!priority || !reason || !button) return;
  button.disabled = true;
  priorityStatus(form, 'Preparing the exact priority-change preview…');
  try {
    const result = await consoleActionRequest(`/api/backlog/tasks/${encodeURIComponent(form.dataset.taskId)}/priority/preview`, {
      priority, reason, expectedRevision,
    });
    const plan = result.plan;
    form.dataset.previewToken = result.token;
    form.dataset.planHash = result.planHash;
    form.querySelector('[name="priority"]').disabled = true;
    form.querySelector('[name="reason"]').disabled = true;
    const preview = form.querySelector('[data-priority-preview]');
    preview.innerHTML = `<div class="feedback-preview-heading"><strong>Review before applying</strong><span>One-time preview · 5 minute limit</span></div>
      <dl class="feedback-preview-target"><div><dt>Task</dt><dd><code>${escapeHtml(plan.taskId)}</code> · ${escapeHtml(plan.title)}</dd></div><div><dt>Priority</dt><dd>${escapeHtml(plan.from)} → <strong>${escapeHtml(plan.to)}</strong></dd></div><div><dt>Revision</dt><dd>${plan.revision}</dd></div></dl>
      <blockquote><p>${escapeHtml(plan.reason)}</p></blockquote><p>${escapeHtml(plan.effect)}</p>
      <div class="feedback-form-actions"><button type="button" data-priority-confirm>Apply reviewed priority</button><button type="button" class="quiet-action" data-priority-edit>Edit</button></div>`;
    preview.hidden = false;
    priorityStatus(form, 'Review the task, revision, priority, reason, and effect before applying.');
  } catch (error) { priorityStatus(form, error.message, true); }
  finally { button.disabled = false; }
});

$('#backlog-board')?.addEventListener('click', async (event) => {
  const edit = event.target.closest('[data-priority-edit]');
  if (edit) {
    const form = edit.closest('.priority-change-form');
    if (!form) return;
    delete form.dataset.previewToken;
    delete form.dataset.planHash;
    form.querySelector('[name="priority"]').disabled = false;
    form.querySelector('[name="reason"]').disabled = false;
    form.querySelector('[data-priority-preview]').hidden = true;
    priorityStatus(form, 'Preview cleared. Review the edited priority again before applying.');
    return;
  }
  const confirm = event.target.closest('[data-priority-confirm]');
  if (!confirm) return;
  const form = confirm.closest('.priority-change-form');
  const token = form?.dataset.previewToken;
  const planHash = form?.dataset.planHash;
  if (!form || !token || !planHash) return;
  confirm.disabled = true;
  priorityStatus(form, 'Applying the reviewed priority change…');
  try {
    const result = await consoleActionRequest(`/api/backlog/tasks/${encodeURIComponent(form.dataset.taskId)}/priority`, {
      priority: form.querySelector('[name="priority"]').value,
      reason: form.querySelector('[name="reason"]').value.trim(),
      expectedRevision: Number(form.dataset.revision), token, planHash,
    });
    const actionStatus = $('#priority-action-status');
    if (actionStatus) {
      actionStatus.textContent = `${result.task.id} priority is now ${result.task.priority}; task state and owner were unchanged.`;
      actionStatus.hidden = false;
    }
    await refresh({ completed: form });
  } catch (error) {
    priorityStatus(form, error.message, true);
    confirm.disabled = false;
  }
});

function workViewStatus(message) {
  setText('#work-view-status', message);
}

function applyWorkViewFilters(filters) {
  const normalized = workViews.normalizeFilters(filters);
  const active = currentBacklog.filter((task) => !['completed', 'cancelled'].includes(task.state));
  renderWorkViewFilters(active, normalized);
  const values = {
    '#work-view-search': normalized.query,
    '#work-view-owner': normalized.owner,
    '#work-view-state': normalized.state,
    '#work-view-priority': normalized.priority,
    '#work-view-domain': normalized.domain,
    '#work-view-feature': normalized.feature,
    '#work-view-milestone': normalized.milestone,
  };
  for (const [selector, value] of Object.entries(values)) {
    const control = $(selector);
    if (control) control.value = value;
  }
  renderBacklog(currentBacklog, currentBacklogHealth);
}

function persistCurrentView({ id = null } = {}) {
  if (!workViewState.storage || !workViewState.key || !workViews) {
    workViewStatus('This browser cannot save views. The project backlog was not changed.');
    return;
  }
  const name = $('#work-view-name')?.value ?? '';
  const result = workViews.saveView({
    storage: workViewState.storage, key: workViewState.key, views: workViewState.views,
    id, name, filters: viewFiltersFromControls(),
  });
  if (!result.ok) {
    workViewStatus(result.message);
    return;
  }
  workViewState.views = result.views;
  workViewState.selectedId = result.view.id;
  workViewState.warning = null;
  const nameInput = $('#work-view-name');
  if (nameInput) {
    nameInput.value = result.view.name;
    delete nameInput.dataset.edited;
  }
  renderSavedViewPicker();
  workViewStatus(`Saved “${result.view.name}” in this browser for this project.`);
  renderBacklog(currentBacklog, currentBacklogHealth);
}

function removeSelectedView() {
  if (!workViewState.storage || !workViewState.key || !workViewState.selectedId || !workViews) {
    workViewStatus('Choose a saved view before deleting it.');
    return;
  }
  const selected = selectedSavedView();
  const result = workViews.deleteView({
    storage: workViewState.storage, key: workViewState.key,
    views: workViewState.views, id: workViewState.selectedId,
  });
  if (!result.ok) {
    workViewStatus(result.message);
    return;
  }
  workViewState.views = result.views;
  workViewState.selectedId = '';
  const nameInput = $('#work-view-name');
  if (nameInput) {
    nameInput.value = '';
    delete nameInput.dataset.edited;
  }
  renderSavedViewPicker();
  applyWorkViewFilters(emptyWorkFilters);
  workViewStatus(`Deleted “${selected?.name ?? 'saved view'}”. Project tasks were not changed.`);
}

const workViewTools = $('.work-view-tools');
workViewTools?.addEventListener('input', (event) => {
  if (event.target.matches('#work-view-name')) {
    event.target.dataset.edited = 'true';
    return;
  }
  if (!event.target.matches('#work-view-search')) return;
  renderBacklog(currentBacklog, currentBacklogHealth);
  workViewStatus('Filter edits are temporary until you save or update a view.');
});
workViewTools?.addEventListener('change', (event) => {
  if (event.target.matches('#work-view-select')) {
    const selected = workViewState.views.find((view) => view.id === event.target.value) ?? null;
    workViewState.selectedId = selected?.id ?? '';
    const nameInput = $('#work-view-name');
    if (nameInput) {
      nameInput.value = selected?.name ?? '';
      delete nameInput.dataset.edited;
    }
    renderSavedViewPicker();
    applyWorkViewFilters(selected?.filters ?? emptyWorkFilters);
    workViewStatus(selected ? `Loaded “${selected.name}”. Edit its filters, then update it or save a copy.` : 'Showing all active work.');
    return;
  }
  if (!event.target.matches('#work-view-owner, #work-view-state, #work-view-priority, #work-view-domain, #work-view-feature, #work-view-milestone')) return;
  renderBacklog(currentBacklog, currentBacklogHealth);
  workViewStatus('Filter edits are temporary until you save or update a view.');
});
$('#work-view-save')?.addEventListener('click', () => persistCurrentView());
$('#work-view-update')?.addEventListener('click', () => persistCurrentView({ id: workViewState.selectedId }));
$('#work-view-delete')?.addEventListener('click', removeSelectedView);
$('#work-view-clear')?.addEventListener('click', () => {
  workViewState.selectedId = '';
  const nameInput = $('#work-view-name');
  if (nameInput) {
    nameInput.value = '';
    delete nameInput.dataset.edited;
  }
  renderSavedViewPicker();
  applyWorkViewFilters(emptyWorkFilters);
  workViewStatus('Filters cleared. All active work is shown.');
});

function ownerRequestStatus(form, message, error = false) {
  const status = form.querySelector('.owner-request-status');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('is-error', error);
}

function clearOwnerRequestPreview(form, message = 'Preview cleared. Review the exact request before sending.') {
  delete form.dataset.previewToken;
  delete form.dataset.planHash;
  form.querySelector('[name="recipient"]').disabled = false;
  form.querySelector('[name="taskId"]').disabled = false;
  form.querySelector('[name="body"]').disabled = false;
  form.querySelector('[data-owner-request-preview]').disabled = false;
  form.querySelector('[data-owner-request-preview]').hidden = false;
  form.querySelector('[data-owner-request-review]').hidden = true;
  form.querySelector('[data-owner-request-confirm]').disabled = false;
  form.querySelector('[data-owner-request-confirm]').hidden = true;
  form.querySelector('[data-owner-request-edit]').hidden = true;
  ownerRequestStatus(form, message);
}

$('#owner-request-form')?.addEventListener('click', async (event) => {
  const edit = event.target.closest('[data-owner-request-edit]');
  if (edit) {
    clearOwnerRequestPreview(edit.closest('[data-owner-request]'));
    return;
  }

  const previewButton = event.target.closest('[data-owner-request-preview]');
  if (previewButton) {
    const form = previewButton.closest('[data-owner-request]');
    if (!form) return;
    const recipient = form.querySelector('[name="recipient"]').value;
    const body = form.querySelector('[name="body"]').value.trim();
    if (!recipient || !body) {
      ownerRequestStatus(form, 'Choose an identity and write the request before previewing.', true);
      return;
    }
    previewButton.disabled = true;
    ownerRequestStatus(form, 'Checking the selected identity, task, and repository…');
    try {
      const taskId = form.querySelector('[name="taskId"]').value;
      const result = await consoleActionRequest('/api/owner-requests/preview', { recipient, body, taskId });
      const plan = result.plan;
      form.dataset.previewToken = result.token;
      form.dataset.planHash = result.planHash;
      form.querySelector('[name="recipient"]').disabled = true;
      form.querySelector('[name="taskId"]').disabled = true;
      form.querySelector('[name="body"]').disabled = true;
      previewButton.hidden = true;
      const panel = form.querySelector('[data-owner-request-review]');
      panel.querySelector('[data-owner-request-title]').textContent = `Request to ${plan.recipientTitle} · ${plan.recipient}`;
      panel.querySelector('[data-owner-request-effect]').textContent = `${plan.effect} Repository: ${shortCommit(plan.currentHead)}${plan.task ? ` · Linked task: ${plan.task.id} (${plan.task.state}, owner ${plan.task.owner ?? 'unassigned'})` : ''}.`;
      panel.querySelector('[data-owner-request-exact]').textContent = plan.body;
      panel.querySelector('[data-owner-request-confirm]').hidden = false;
      panel.querySelector('[data-owner-request-edit]').hidden = false;
      panel.hidden = false;
      ownerRequestStatus(form, 'Preview ready. Check the recipient, task link, and exact request.');
    } catch (error) {
      ownerRequestStatus(form, error.message, true);
    } finally { previewButton.disabled = false; }
    return;
  }

  const confirm = event.target.closest('[data-owner-request-confirm]');
  if (!confirm) return;
  const form = confirm.closest('[data-owner-request]');
  const token = form?.dataset.previewToken;
  const planHash = form?.dataset.planHash;
  if (!form || !token || !planHash) return;
  confirm.disabled = true;
  ownerRequestStatus(form, 'Sending the reviewed durable request…');
  try {
    const result = await consoleActionRequest('/api/owner-requests', {
      recipient: form.querySelector('[name="recipient"]').value,
      taskId: form.querySelector('[name="taskId"]').value,
      body: form.querySelector('[name="body"]').value.trim(), token, planHash,
    });
    const status = $('#owner-request-action-status');
    if (status) {
      status.textContent = `Sent durable request ${result.message.id} to ${result.message.recipient}. It does not start or wake the agent.`;
      status.hidden = false;
    }
    form.querySelector('[name="body"]').value = '';
    clearOwnerRequestPreview(form, 'Request sent. You can send another request when ready.');
    await refresh({ completed: form });
  } catch (error) {
    ownerRequestStatus(form, error.message, true);
    confirm.disabled = false;
  }
});

const runtimeProfileForm = $('#runtime-profile-form');
runtimeProfileForm?.querySelector('[name="areaId"]')?.addEventListener('change', () => {
  const agent = runtimeProfileAgents.find((entry) => entry.areaId === runtimeProfileForm.querySelector('[name="areaId"]').value);
  runtimeProfileInputs(runtimeProfileForm, agent, agent?.runtime);
});
runtimeProfileForm?.querySelector('[name="runtime"]')?.addEventListener('change', () => {
  const agent = runtimeProfileAgents.find((entry) => entry.areaId === runtimeProfileForm.querySelector('[name="areaId"]').value);
  runtimeProfileInputs(runtimeProfileForm, agent, runtimeProfileForm.querySelector('[name="runtime"]').value);
});
runtimeProfileForm?.addEventListener('click', async (event) => {
  const edit = event.target.closest('[data-runtime-profile-edit]');
  if (edit) {
    clearRuntimeProfilePreview(runtimeProfileForm);
    runtimeProfileStatus(runtimeProfileForm, 'Preview cleared. Review the exact profile before saving.');
    return;
  }

  const previewButton = event.target.closest('[data-runtime-profile-preview]');
  if (previewButton) {
    const payload = {
      areaId: runtimeProfileForm.querySelector('[name="areaId"]').value,
      runtime: runtimeProfileForm.querySelector('[name="runtime"]').value,
      model: runtimeProfileForm.querySelector('[name="model"]').value.trim(),
      reasoning: runtimeProfileForm.querySelector('[name="reasoning"]').value.trim(),
    };
    if (!payload.areaId || !payload.runtime) {
      runtimeProfileStatus(runtimeProfileForm, 'Choose an identity and an available agent.', true);
      return;
    }
    previewButton.disabled = true;
    runtimeProfileStatus(runtimeProfileForm, 'Validating this profile with its selected local adapter…');
    try {
      const result = await consoleActionRequest('/api/runtime-profiles/preview', payload);
      const plan = result.plan;
      runtimeProfileForm.dataset.profilePayload = JSON.stringify(payload);
      runtimeProfileForm.dataset.previewToken = result.token;
      runtimeProfileForm.dataset.planHash = result.planHash;
      for (const field of runtimeProfileForm.querySelectorAll('select, input')) field.disabled = true;
      previewButton.hidden = true;
      const panel = runtimeProfileForm.querySelector('[data-runtime-profile-review]');
      panel.querySelector('[data-profile-before]').textContent = profileDescription(plan.beforeProfile);
      panel.querySelector('[data-profile-after]').textContent = profileDescription(plan.profile);
      panel.querySelector('[data-profile-effect]').textContent = `${plan.effect} Reviewed at ${shortCommit(plan.currentHead)}.${plan.resetLaunchPolicy ? ' Switching adapters also clears the prior adapter-specific launch-policy override; the new adapter default applies.' : ''}`;
      panel.querySelector('[data-runtime-profile-confirm]').hidden = false;
      panel.querySelector('[data-runtime-profile-edit]').hidden = false;
      panel.hidden = false;
      runtimeProfileStatus(runtimeProfileForm, 'Review the current and next-launch profiles. Nothing has changed yet.');
    } catch (error) {
      runtimeProfileStatus(runtimeProfileForm, error.message, true);
    } finally { previewButton.disabled = false; }
    return;
  }

  const confirm = event.target.closest('[data-runtime-profile-confirm]');
  if (!confirm) return;
  const token = runtimeProfileForm.dataset.previewToken;
  const planHash = runtimeProfileForm.dataset.planHash;
  let payload;
  try { payload = JSON.parse(runtimeProfileForm.dataset.profilePayload ?? ''); } catch { return; }
  if (!token || !planHash) return;
  confirm.disabled = true;
  runtimeProfileStatus(runtimeProfileForm, 'Saving the reviewed profile for future launches…');
  try {
    const result = await consoleActionRequest('/api/runtime-profiles', { ...payload, token, planHash });
    const status = $('#runtime-profile-action-status');
    if (status) {
      status.textContent = `Updated ${result.profile.areaId} for future launches. Any running session remains unchanged.`;
      status.hidden = false;
    }
    clearRuntimeProfilePreview(runtimeProfileForm);
    await refresh({ completed: runtimeProfileForm });
  } catch (error) {
    runtimeProfileStatus(runtimeProfileForm, error.message, true);
    confirm.disabled = false;
  }
});

const scheduleLauncherDetails = $('[data-schedule-launcher]');
scheduleLauncherDetails?.addEventListener('click', async (event) => {
  const edit = event.target.closest('[data-schedule-launcher-edit]');
  if (edit) {
    clearScheduleLauncherPreview();
    return;
  }

  const previewButton = event.target.closest('[data-schedule-launcher-preview]');
  if (previewButton) {
    const action = scheduleLauncherDetails.dataset.action;
    if (!['install', 'reconcile'].includes(action) || previewButton.dataset.launcherReady !== 'true') return;
    previewButton.disabled = true;
    scheduleLauncherStatus('Checking current ownership, unit files, and schedule configuration…');
    try {
      const result = await consoleActionRequest('/api/schedule-launcher/preview', { action });
      showScheduleLauncherPlan(scheduleLauncherDetails, result);
    } catch (error) {
      scheduleLauncherStatus(error.message, true);
    } finally { previewButton.disabled = false; }
    return;
  }

  const confirm = event.target.closest('[data-schedule-launcher-confirm]');
  if (!confirm) return;
  const token = scheduleLauncherDetails.dataset.previewToken;
  const planHash = scheduleLauncherDetails.dataset.planHash;
  const action = scheduleLauncherDetails.dataset.action;
  if (!token || !planHash || !['install', 'reconcile'].includes(action)) return;
  confirm.disabled = true;
  scheduleLauncherStatus('Applying the reviewed timer setup…');
  try {
    const result = await consoleActionRequest('/api/schedule-launcher', { action, token, planHash });
    const status = $('#schedule-launcher-action-status');
    if (status) {
      const verb = result.action === 'install' ? 'Installed' : 'Refreshed';
      status.textContent = `${verb} the TORCH schedule timer for ${result.systemSchedules.length} system schedule(s). User systemd accepted the enable/start request; active state is not re-queried here. Audit ${result.auditEventId}.`;
      status.hidden = false;
    }
    clearScheduleLauncherPreview('Timer action completed. The refreshed snapshot below reports owned files and configuration digest.');
    await refresh({ completed: scheduleLauncherDetails });
  } catch (error) {
    scheduleLauncherStatus(error.message, true);
    confirm.disabled = false;
  }
});

function feedbackStatus(form, message, error = false) {
  const status = form.querySelector('.feedback-form-status');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('is-error', error);
}

function showFeedbackPreview(form, result) {
  const preview = form.querySelector('[data-feedback-preview]');
  const textarea = form.querySelector('textarea[name="body"]');
  if (!preview || !textarea) return;
  const plan = result.preview;
  form.dataset.previewToken = result.token;
  form.dataset.planHash = result.planHash;
  textarea.disabled = true;
  preview.innerHTML = `<div class="feedback-preview-heading"><strong>Review before sending</strong><span>One-time preview · 5 minute limit</span></div>
    <dl class="feedback-preview-target"><div><dt>To</dt><dd>${escapeHtml(plan.recipient)}</dd></div><div><dt>Task</dt><dd>${escapeHtml(plan.taskId)}</dd></div><div><dt>Commit</dt><dd><code>${escapeHtml(shortCommit(plan.commit))}</code></dd></div></dl>
    <blockquote><p>${escapeHtml(plan.body)}</p></blockquote>
    <p>This creates one durable message linked to this artifact. It does not change task status, priority, or ownership.</p>
    <div class="feedback-form-actions"><button type="button" data-feedback-confirm>Send to ${escapeHtml(plan.recipient)}</button><button type="button" class="quiet-action" data-feedback-edit>Change message</button></div>`;
  preview.hidden = false;
  feedbackStatus(form, 'Preview ready. Check the recipient and references before sending.');
}

$('#artifact-list')?.addEventListener('submit', async (event) => {
  const form = event.target.closest('.artifact-feedback-form');
  if (!form) return;
  event.preventDefault();
  const textarea = form.querySelector('textarea[name="body"]');
  const button = form.querySelector('button[type="submit"]');
  if (!textarea || !button || !textarea.value.trim()) return;
  button.disabled = true;
  feedbackStatus(form, 'Preparing a review preview…');
  try {
    const artifactId = form.dataset.artifactId;
    const result = await feedbackRequest(`/api/artifacts/${encodeURIComponent(artifactId)}/feedback/preview`, {
      body: textarea.value,
    });
    showFeedbackPreview(form, result);
  } catch (error) {
    feedbackStatus(form, error.message, true);
  } finally { button.disabled = false; }
});

$('#artifact-list')?.addEventListener('click', async (event) => {
  const edit = event.target.closest('[data-feedback-edit]');
  if (edit) {
    const form = edit.closest('.artifact-feedback-form');
    const textarea = form?.querySelector('textarea[name="body"]');
    const preview = form?.querySelector('[data-feedback-preview]');
    if (form && textarea && preview) {
      delete form.dataset.previewToken;
      delete form.dataset.planHash;
      textarea.disabled = false;
      preview.hidden = true;
      feedbackStatus(form, 'Preview cleared. Review the edited message again before sending.');
      textarea.focus();
    }
    return;
  }

  const confirm = event.target.closest('[data-feedback-confirm]');
  if (!confirm) return;
  const form = confirm.closest('.artifact-feedback-form');
  const textarea = form?.querySelector('textarea[name="body"]');
  const token = form?.dataset.previewToken;
  const planHash = form?.dataset.planHash;
  if (!form || !textarea || !token || !planHash) return;
  confirm.disabled = true;
  feedbackStatus(form, 'Sending the reviewed message…');
  try {
    const artifactId = form.dataset.artifactId;
    const result = await feedbackRequest(`/api/artifacts/${encodeURIComponent(artifactId)}/feedback`, {
      body: textarea.value, token, planHash,
    });
    const actionStatus = $('#feedback-action-status');
    if (actionStatus) {
      actionStatus.textContent = `Feedback sent to ${result.feedback.recipient} for ${result.feedback.taskId} at ${shortCommit(result.feedback.commit)}.`;
      actionStatus.hidden = false;
    }
    await refresh({ completed: form });
  } catch (error) {
    feedbackStatus(form, error.message, true);
    confirm.disabled = false;
  }
});

function organizationReviewStatus(form, message, error = false) {
  const status = form.querySelector('.organization-review-status');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('is-error', error);
}

function clearOrganizationReview(form, message = 'Preview cleared. Review the current proposal before deciding.') {
  delete form.dataset.previewToken;
  delete form.dataset.planHash;
  form.querySelector('[name="action"]').disabled = false;
  form.querySelector('[name="reason"]').disabled = false;
  form.querySelector('[data-review-preview]').disabled = false;
  form.querySelector('[data-review-preview-panel]').hidden = true;
  form.querySelector('[data-review-confirm]').hidden = true;
  form.querySelector('[data-review-edit]').hidden = true;
  organizationReviewStatus(form, message);
}

$('#change-list')?.addEventListener('click', async (event) => {
  const activationPreviewButton = event.target.closest('[data-hierarchy-activation-preview]');
  if (activationPreviewButton) {
    const card = activationPreviewButton.closest('.hierarchy-activation');
    const id = activationPreviewButton.dataset.id;
    const status = card?.querySelector('[data-hierarchy-activation-status]');
    const setStatus = (message, error = false) => {
      if (!status) return;
      status.textContent = message;
      status.classList.toggle('is-error', error);
    };
    activationPreviewButton.disabled = true;
    setStatus('Rechecking owner approval, repository state, and pilot blockers…');
    try {
      const result = await consoleActionRequest(`/api/organization-proposals/hierarchy/${encodeURIComponent(id)}/activate/preview`, {});
      const { plan } = result;
      const panel = card.querySelector('[data-hierarchy-activation-panel]');
      card.dataset.previewToken = result.token ?? '';
      card.dataset.planHash = result.planHash;
      panel.querySelector('[data-hierarchy-activation-title]').textContent = `${plan.confirmationLabel} · ${plan.title}`;
      panel.querySelector('[data-hierarchy-activation-effect]').textContent = plan.effect;
      panel.querySelector('[data-hierarchy-activation-scope]').textContent = JSON.stringify({
        ownerIdentity: plan.ownerIdentity,
        currentHead: plan.currentHead,
        pilotPlan: plan.pilotPlan,
      }, null, 2);
      const confirm = panel.querySelector('[data-hierarchy-activation-confirm]');
      confirm.textContent = plan.confirmationLabel;
      confirm.hidden = !result.token || !plan.pilotPlan.canProceed;
      panel.hidden = false;
      setStatus(plan.pilotPlan.canProceed
        ? 'Ready. Review the exact files and commit effect, then explicitly confirm.'
        : `Blocked by ${plan.pilotPlan.blockers.length} current condition${plan.pilotPlan.blockers.length === 1 ? '' : 's'}. Resolve them, then preview again.`,
      !plan.pilotPlan.canProceed);
    } catch (error) {
      setStatus(error.message, true);
    } finally { activationPreviewButton.disabled = false; }
    return;
  }

  const activationConfirm = event.target.closest('[data-hierarchy-activation-confirm]');
  if (activationConfirm) {
    const card = activationConfirm.closest('.hierarchy-activation');
    const proposalCard = activationConfirm.closest('.organization-proposal');
    const id = proposalCard?.querySelector('[data-hierarchy-activation-preview]')?.dataset.id;
    const token = card?.dataset.previewToken;
    const planHash = card?.dataset.planHash;
    const status = card?.querySelector('[data-hierarchy-activation-status]');
    if (!id || !token || !planHash) return;
    activationConfirm.disabled = true;
    if (status) {
      status.textContent = 'Committing the reviewed hierarchy pilot…';
      status.classList.remove('is-error');
    }
    try {
      const result = await consoleActionRequest(`/api/organization-proposals/hierarchy/${encodeURIComponent(id)}/activate`, { token, planHash });
      const state = $('#organization-action-status');
      if (state) {
        const timerNote = result.proposal.timerReconciliationRequired
          ? ' Reconcile the installed timer separately before trusting the new cadence.'
          : ' No timer was installed or changed.';
        state.textContent = `${id} is piloting at ${shortCommit(result.proposal.activationCommit)}. No agent or runtime was started.${timerNote}`;
        state.hidden = false;
      }
      await refresh({ completed: card });
    } catch (error) {
      if (status) {
        status.textContent = error.message;
        status.classList.add('is-error');
      }
      activationConfirm.disabled = false;
    }
    return;
  }

  const edit = event.target.closest('[data-review-edit]');
  if (edit) {
    const form = edit.closest('[data-organization-review]');
    if (form) clearOrganizationReview(form);
    return;
  }

  const previewButton = event.target.closest('[data-review-preview]');
  if (previewButton) {
    const form = previewButton.closest('[data-organization-review]');
    const action = form?.querySelector('[name="action"]')?.value;
    if (!form || !action) {
      if (form) organizationReviewStatus(form, 'Choose a decision first.', true);
      return;
    }
    previewButton.disabled = true;
    organizationReviewStatus(form, 'Checking current proposal and owner authority…');
    try {
      const type = form.dataset.type;
      const id = form.dataset.id;
      const reason = form.querySelector('[name="reason"]').value.trim();
      const result = await consoleActionRequest(`/api/organization-proposals/${encodeURIComponent(type)}/${encodeURIComponent(id)}/preview`, {
        action, reason,
      });
      const plan = result.plan;
      form.dataset.previewToken = result.token;
      form.dataset.planHash = result.planHash;
      form.querySelector('[name="action"]').disabled = true;
      form.querySelector('[name="reason"]').disabled = true;
      const panel = form.querySelector('[data-review-preview-panel]');
      panel.querySelector('[data-review-title]').textContent = `${plan.confirmationLabel} · ${plan.title}`;
      panel.querySelector('[data-review-effect]').textContent = `${plan.effect} Current state: ${plan.currentState}. Repository: ${shortCommit(plan.currentHead)}.`;
      panel.querySelector('[data-review-scope]').textContent = JSON.stringify({
        type: plan.type, id: plan.id, action: plan.action, reason: plan.reason,
        proposalRevision: plan.proposalRevision,
        baseCommit: plan.baseCommit, currentHead: plan.currentHead,
        ownerIdentity: plan.ownerIdentity,
        activeGraphRevision: plan.activeGraphRevision,
        activeGraphDigest: plan.activeGraphDigest,
        scope: plan.scope ?? {
          impact: plan.impact, observationWindow: plan.observationWindow,
          signals: plan.signals, alternatives: plan.alternatives,
          pilot: plan.pilot, roleChanges: plan.roleChanges,
          managerCheckInSchedules: plan.managerCheckInSchedules,
          timerReconciliation: plan.timerReconciliation,
        },
        expectedBenefit: plan.expectedBenefit, evidence: plan.evidence, effect: plan.effect,
      }, null, 2);
      panel.querySelector('[data-review-confirm]').textContent = plan.confirmationLabel;
      panel.querySelector('[data-review-confirm]').hidden = !result.token || plan.canProceed === false;
      panel.querySelector('[data-review-edit]').hidden = false;
      panel.hidden = false;
      organizationReviewStatus(form, plan.canProceed === false
        ? 'Blocked. Inspect the current conditions in the plan; no confirmation is available.'
        : 'Preview ready. Read the effect and exact proposal scope before confirming.', plan.canProceed === false);
    } catch (error) {
      organizationReviewStatus(form, error.message, true);
    } finally { previewButton.disabled = false; }
    return;
  }

  const confirm = event.target.closest('[data-review-confirm]');
  if (!confirm) return;
  const form = confirm.closest('[data-organization-review]');
  const token = form?.dataset.previewToken;
  const planHash = form?.dataset.planHash;
  if (!form || !token || !planHash) return;
  confirm.disabled = true;
  organizationReviewStatus(form, 'Recording the reviewed owner decision…');
  try {
    const result = await consoleActionRequest(`/api/organization-proposals/${encodeURIComponent(form.dataset.type)}/${encodeURIComponent(form.dataset.id)}`, {
      action: form.querySelector('[name="action"]').value,
      reason: form.querySelector('[name="reason"]').value.trim(), token, planHash,
    });
    const status = $('#organization-action-status');
    if (status) {
      const note = result.type === 'hierarchy-conclusion'
        ? demoWorkspace
          ? ' Demo decision only. No Git commit, agent or timer was changed.'
          : ' One scoped local conclusion commit was recorded. No agent or timer was started or stopped; review obsolete schedules separately.'
        : result.type === 'fleet'
        ? ' This does not provision or start the proposed identity.'
        : result.decision === 'approve-pilot'
          ? ' This approves planning only; after reviewing a fresh hierarchy-plan, the owner separately runs hierarchy-activate --by owner --yes. Activation does not start identities or timers.'
          : ' The active organization remains unchanged.';
      status.textContent = `${result.proposal.id} recorded as ${result.proposal.state}.${note}`;
      status.hidden = false;
    }
    await refresh({ completed: form });
  } catch (error) {
    organizationReviewStatus(form, error.message, true);
    confirm.disabled = false;
  }
});

$('#attention-list')?.addEventListener('click', (event) => {
  const decisionButton = event.target.closest('[data-attention-decision]');
  if (decisionButton) {
    const card = decisionButton.closest('.attention-item');
    const status = card?.querySelector('.attention-action-status');
    const approvalId = decisionButton.dataset.attentionApproval;
    const decision = decisionButton.dataset.attentionDecision;
    const form = [...document.querySelectorAll('#approval-request-list .approval-decision-form')]
      .find((candidate) => candidate.dataset.approvalId === approvalId);
    const previewButton = form?.querySelector('[data-approval-preview]');
    const shortcut = globalThis.TorchAttentionActions.prepareOwnerDecisionShortcut(form, decision, previewButton ? (approvalForm) => {
      approvalForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
      previewButton.click();
    } : null);
    if (!shortcut.started) {
      if (status) {
        status.textContent = shortcut.reason;
        status.hidden = false;
      }
      return;
    }
    if (status) {
      status.textContent = `Opening the guarded ${decision} preview for this owner-addressed request. Confirm only after reviewing its current evidence.`;
      status.hidden = false;
    }
    return;
  }
  const link = event.target.closest('a[href^="#"]');
  const target = link && document.getElementById(link.getAttribute('href').slice(1));
  const recipient = link?.dataset.attentionRecipient;
  if (recipient) {
    const form = $('#owner-request-form');
    const recipientSelect = form?.elements.namedItem('recipient');
    const body = form?.elements.namedItem('body');
    const status = form?.querySelector('.owner-request-status');
    const hasRecipient = [...(recipientSelect?.options ?? [])].some((option) => option.value === recipient);
    if (form && recipientSelect && body && hasRecipient && !recipientSelect.value && !body.value.trim()) {
      recipientSelect.value = recipient;
      if (status) status.textContent = `Selected ${recipient}. Add context and review the preview before sending anything.`;
    }
  }
  for (let parent = target?.parentElement; parent; parent = parent.parentElement) {
    if (parent.tagName === 'DETAILS') parent.open = true;
  }
});

$('#refresh-console')?.addEventListener('click', () => refresh());
$('#toggle-live-refresh')?.addEventListener('click', () => {
  liveUpdatesPaused = !liveUpdatesPaused;
  $('#toggle-live-refresh').textContent = liveUpdatesPaused ? 'Resume updates' : 'Pause updates';
  $('#toggle-live-refresh').setAttribute('aria-pressed', String(liveUpdatesPaused));
  $('#live-refresh-status').textContent = liveUpdatesPaused ? 'Automatic updates paused. Manual refresh preserves edits.' : 'Updates every 15 seconds while visible.';
  if (!liveUpdatesPaused && document.visibilityState === 'visible') refresh();
});
let liveRefreshTimer = null;
function startLiveRefreshTimer() {
  if (liveRefreshTimer !== null) return;
  liveRefreshTimer = setInterval(() => {
    if (!liveUpdatesPaused && document.visibilityState === 'visible') refresh({ background: true });
  }, 15_000);
}
startLiveRefreshTimer();
document.addEventListener('visibilitychange', () => {
  if (!liveUpdatesPaused && document.visibilityState === 'visible') refresh();
});
globalThis.addEventListener('pagehide', () => {
  clearInterval(liveRefreshTimer);
  liveRefreshTimer = null;
});
globalThis.addEventListener('pageshow', (event) => {
  startLiveRefreshTimer();
  if (event.persisted && !liveUpdatesPaused && document.visibilityState === 'visible') refresh();
});
if (demoWorkspace) {
  $('#demo-banner').hidden = false;
  $('#reset-demo')?.addEventListener('click', () => {
    demoWorkspace.reset();
    globalThis.location.reload();
  });
}
consoleViewRouter.sync({ force: true });
refresh();
