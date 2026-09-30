// Shared, read-only briefing renderer. Never interpret project Markdown as HTML.
(() => {
  const text = (value) => String(value ?? '').slice(0, 1200).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
  const count = (value) => Number.isInteger(value) && value >= 0 ? value : null;
  function list(title, section, describe) {
    const items = Array.isArray(section?.items) ? section.items.slice(0, 100) : [];
    let body;
    if (section?.available !== true) body = '<p class="briefing-muted">Evidence unavailable.</p>';
    else if (!items.length) body = '<p class="briefing-muted">No matching recorded items.</p>';
    else body = `<ul>${items.map((item) => `<li>${describe(item)}</li>`).join('')}</ul>`;
    const total = count(section?.count);
    if (section?.truncated || (total !== null && total > items.length)) body += `<p class="briefing-muted">Showing ${items.length} of ${total ?? 'an unknown total'}.</p>`;
    return `<div class="briefing-block"><h3>${title}</h3>${body}</div>`;
  }
  function render(publication, { now = new Date() } = {}) {
    const report = publication?.report;
    if (report?.schema !== 'torch.dev/owner-digest/v1alpha1' || !Number.isFinite(Date.parse(report.generatedAt))) {
      return '<div class="briefing-empty"><h3>No published briefing</h3><p>Generate a local report with <code>torch digest build</code>. To save it for this view, the owner can review and run <code>torch digest publish --by owner --yes</code>.</p><p class="briefing-muted">Publication does not send a message, deploy work or install a timer.</p></div>';
    }
    const elapsed = now.getTime() - Date.parse(report.generatedAt);
    const hours = Number.isFinite(report.window?.hours) && report.window.hours > 0 ? report.window.hours : 24;
    const freshness = elapsed < -300_000 ? 'Check publication clock' : elapsed > hours * 2 * 3_600_000 ? 'Older publication' : 'Saved publication';
    const deployment = report.lastDeployment;
    const states = { unknown: 'Outcome unknown', running: 'Execution unresolved', failed: 'Failed',
      succeeded: 'Success reported; local reconciliation pending', applied: 'Receipt applied; live verification separate',
      'reviewed-not-applied': 'Owner confirmed no deployment' };
    return `<div class="briefing-publication"><p><strong>${freshness}</strong> <time datetime="${text(report.generatedAt)}">${text(report.generatedAt)}</time></p>
      <p class="briefing-muted">Window: ${text(report.window?.since)} to ${text(report.window?.until)} (UTC). Recorded evidence, not independent live verification.</p>
      <p class="briefing-muted">This briefing stays as published. Approvals and work may have changed since then.</p>
      ${report.activityCoverage?.complete === false ? '<p class="briefing-warning">Activity history is incomplete; inactivity is not proven.</p>' : ''}
      <div class="briefing-focus">${list('Needs you', report.needsOwner, (item) => `<strong>${text(item.title)}</strong><span>${text(item.requester)} · ${text(item.id)}</span>`)}
        ${list('Delivery needs review', report.deliveryReview, (item) => `<strong>${text(item.operation)}: ${text(states[item.state] ?? item.state)}</strong><code>${text(item.commit)}</code>`)}</div>
      <p><a href="#flow-watch">Review current approvals and session waits</a></p>
      <div class="briefing-deployment"><h3>Last deployment</h3>${deployment
        ? `<p><strong>${text(deployment.label)}</strong> — ${text(states[deployment.state] ?? deployment.state)}</p><code>${text(deployment.commit)}</code>${deployment.failureReason ? `<p>${text(deployment.failureReason)}</p>` : ''}`
        : '<p class="briefing-muted">No deployment operation recorded.</p>'}</div>
      <details class="briefing-detail"><summary>Shipping and integration</summary>
        ${list('Shipped — receipt reported', report.shipped, (item) => `<strong>${text(item.label ?? item.deliveryId)}</strong><span>${text(item.state)} · ${text(item.recordedAt)}</span><code>${text(item.commit)}</code>`)}
        ${list('Landed — not necessarily deployed', report.landed, (item) => `<strong>${text(item.sourceArea)}</strong><code>${text(item.commit)}</code>`)}
        ${list('Completed tasks', report.completed, (item) => `<strong>${text(item.title)}</strong><span>${text(item.taskId)}</span>`)}</details>
      <details class="briefing-detail"><summary>Decisions, blockers and neglected requests</summary>
        ${list('Recorded approval decisions', report.decisions, (item) => `<strong>${text(item.title)}</strong><span>${text(item.status)} · ${text(item.decidedBy)}</span>`)}
        ${list('Blocked work', report.blocked, (item) => `<strong>${text(item.taskId)}</strong><span>${text(item.reason)}</span>`)}
        ${list('Neglected owner requests', report.neglectedRequests, (item) => `<strong>${text(item.title)}</strong><span>${text(item.taskId)} · ${text(item.ageDays)} days${item.expectedWaiting ? ' · recorded blocked wait' : ''}</span>`)}</details>
      <details class="briefing-detail"><summary>Evidence coverage</summary><ul>${(Array.isArray(report.coverage) ? report.coverage : []).slice(0, 100).map((note) => `<li>${text(note)}</li>`).join('')}</ul></details></div>`;
  }
  globalThis.TorchOwnerDigest = Object.freeze({ render });
})();
