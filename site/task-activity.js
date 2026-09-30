(() => {
  const text = (value) => String(value ?? '').slice(0, 1200).replace(/[&<>"']/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  function render(activity) {
    if (!activity?.available) return '<p>Commit activity unavailable. No inactivity conclusion can be drawn. Use task history and current session state to review work.</p>';
    const tasks = (activity.tasks ?? []).filter((task) => ['stale', 'unknown'].includes(task.status))
      .sort((a, b) => Number(Boolean(b.ownerRequested)) - Number(Boolean(a.ownerRequested))
        || (b.ageDays ?? -1) - (a.ageDays ?? -1) || String(a.taskId).localeCompare(String(b.taskId)));
    const stale = tasks.filter((task) => task.status === 'stale');
    const unknown = tasks.filter((task) => task.status === 'unknown');
    const group = (title, items) => `<h4>${title} (${items.length})</h4>${items.length ? `<ul>${items.slice(0, 40).map((task) =>
      `<li><strong>${text(task.title)}</strong> <code>${text(task.taskId)}</code>
        <p>${task.ownerRequested ? 'Owner request. ' : ''}${task.status === 'stale' ? `${text(task.ageDays)} days without a named commit.` : 'Absence of recent progress is unknown.'}
        ${task.expectedWaiting ? 'Blocked: waiting may be expected; review the dependency.' : ''}</p>
        ${task.lastActivity ? `<p>Last named commit <code>${text(task.lastActivity.commit)}</code> at ${text(task.lastActivity.committedAt)}.</p>` : ''}
        ${(task.closureIntent ?? []).length ? '<p>Closure mentioned in a commit; only verified landing can close the task.</p>' : ''}</li>`).join('')}</ul>` : '<p>None in this observation.</p>'}
        ${items.length > 40 ? `<p>Showing 40 of ${items.length}; inspect CLI activity for the remainder.</p>` : ''}`;
    return `<p>Named-commit activity as of ${text(activity.generatedAt)}. Metadata edits do not reset inactivity. This is not a measure of uncommitted work.</p>
      <p>${activity.complete ? 'Managed history scan complete within configured bounds.' : 'History coverage incomplete: unknown work must not be classified as neglected.'}
      Scanned ${text(activity.scannedCommits)} commits; review threshold ${text(activity.staleDays)} days.</p>
      ${(activity.unavailableBranches ?? []).length ? `<p>Unavailable branches: ${activity.unavailableBranches.map(text).join(', ')}.</p>` : ''}
      ${activity.truncated ? '<p>Commit scan truncated.</p>' : ''}
      ${(activity.futureCommits ?? []).length ? '<p>Future-dated commits excluded from activity; review repository clocks.</p>' : ''}
      ${group('Stale work — owner requests first', stale)}${group('Unknown activity — owner requests first', unknown)}
      <p>Review against the authoritative work board. Observation never changes task state or closes work.</p>`;
  }
  globalThis.TorchTaskActivity = Object.freeze({ render });
})();
