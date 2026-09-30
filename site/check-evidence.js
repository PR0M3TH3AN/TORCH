(function () {
  const text = (value) => String(value ?? '').slice(0, 4000).replace(/[&<>"']/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const value = (input) => text(typeof input === 'object' ? JSON.stringify(input) : input);
  function frozen(snapshot) {
    if (!snapshot) return '<p>Frozen-input evidence not recorded.</p>';
    if (snapshot.unavailable) return '<p>Frozen-input evidence unreadable.</p>';
    return `<p>Frozen input commit <code>${text(snapshot.commit)}</code></p>
      <p>Input digest <code>${text(snapshot.digest ?? snapshot.inputDigest)}</code></p>
      <p>Copy strategy: ${text(snapshot.copyStrategy ?? 'not recorded')}. Recorded capture, not a new integrity check.</p>`;
  }
  function phase(label, observation) {
    if (!observation) return `<p>${label}: not recorded.</p>`;
    const entries = Object.entries(observation.report?.conditions ?? {}).slice(0, 100);
    return `<h4>${label}: ${observation.valid === true ? 'contract valid' : 'invalid or unknown'}</h4>
      ${observation.reason ? `<p>${text(observation.reason)}</p>` : ''}
      <dl>${entries.map(([key, observed]) => `<div><dt>${text(key)}</dt><dd>${value(observed)}</dd></div>`).join('')}</dl>`;
  }
  function render(checks = {}) {
    const pending = (checks.prepared ?? []).filter((item) => ['prepared', 'running', 'abandoned'].includes(item.state)).slice(0, 40);
    const receipts = (checks.receipts ?? []).slice(0, 40);
    return `<p>Recorded check evidence. Running records do not prove a live executor; interrupted runs need review, not automatic rerun.</p>
      ${pending.map((item) => `<details class="check-evidence"><summary>${text(item.checkId)} · ${text(item.areaId)} · ${item.state === 'running' ? 'Running — completion unconfirmed' : item.state === 'abandoned' ? 'Abandoned — not qualified' : 'Prepared — awaiting execution'}</summary>
        <p>Preparation ${text(item.id)} · ${text(item.createdAt)}</p>${frozen(item.snapshot)}
        ${item.state === 'abandoned' ? `<p>${item.recovery?.cleanupStatus === 'completed' ? 'Captured-input cleanup completed (recorded).' : item.recovery?.cleanupStatus === 'pending' ? 'Captured-input cleanup pending. Owner review is required.' : 'Captured-input cleanup unconfirmed. Inspect the recovery record before acting.'}</p>
          ${item.recovery?.recordedAt ? `<p>Recovery recorded ${text(item.recovery.recordedAt)}</p>` : ''}
          ${item.recovery?.cleanupReason ? `<p>Cleanup reason: ${text(item.recovery.cleanupReason)}</p>` : ''}
          <p>Stopped executors: ${item.recovery?.stoppedExecutors === 'owner-attested' ? 'owner-attested, not independently verified descendant termination' : 'unconfirmed'}.
          Recovery does not release resource leases or create a check pass. Use the owner-confirmed CLI recovery workflow; this view does not recover or rerun work.</p>` : ''}</details>`).join('')}
      ${receipts.length ? receipts.map((receipt) => `<details class="check-evidence"><summary>${text(receipt.checkId)} · ${text(receipt.areaId)} · ${text(receipt.result)}</summary>
        <p>Commit <code>${text(receipt.commit)}</code> · ${text(receipt.finishedAt)}</p>
        ${receipt.invalidReason ? `<p>Qualification invalid: ${text(receipt.invalidReason)}</p>` : ''}${frozen(receipt.snapshot)}
        ${receipt.conditions ? (receipt.conditions.unavailable ? '<p>Condition evidence unreadable.</p>' : `<p>Conditions are project-reported pre/post observations, not independent sensor truth or continuous monitoring.</p>
          ${phase('Before measurement', receipt.conditions.before)}${phase('After measurement', receipt.conditions.after)}`)
          : '<p>No condition observations recorded; this is not proof that runtime conditions were verified.</p>'}</details>`).join('')
        : '<p>No exact-commit check receipts.</p>'}
      ${checks.coverage ? `<p>${text(checks.coverage)}</p>` : ''}`;
  }
  globalThis.TorchCheckEvidence = Object.freeze({ render });
})();
