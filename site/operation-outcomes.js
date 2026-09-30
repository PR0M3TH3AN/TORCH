(() => {
  const text = (value) => String(value ?? '').slice(0, 1200).replace(/[&<>"']/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const status = (state, type) => state === 'running' ? 'Running — completion unconfirmed'
    : state === 'unknown' ? 'Outcome unknown — review required'
      : state === 'succeeded' && type === 'delivery' ? 'Adapter succeeded — verify lifecycle and live evidence'
        : state === 'succeeded' ? 'Object import succeeded — not deployment'
          : text(state ?? 'not recorded');
  function render(snapshot) {
    const fetches = (snapshot.canonicalFetches ?? []).slice(0, 20);
    const operations = (snapshot.deliveryOperations ?? []).slice(0, 40);
    const attempts = snapshot.deliveryAttempts ?? [];
    return `<h3>Canonical fetch outcomes</h3><p>Object imports do not move branches or deploy releases. Latest 20 recorded operations.</p>
      ${fetches.length ? fetches.map((item) => `<details class="check-evidence"><summary>${text(item.remote)} · ${status(item.state, 'fetch')}</summary>
        <p>Branch ${text(item.branch)} · commit <code>${text(item.commit)}</code></p><p>${text(item.updatedAt)}</p>
        <ul>${(item.attempts ?? []).slice(0, 5).map((attempt) => `<li>Attempt ${text(attempt.ordinal)}: ${status(attempt.state, 'fetch')} · ${text(attempt.classification ?? 'result not recorded')}</li>`).join('')}</ul>
        </details>`).join('') : '<p>No canonical fetch receipts recorded.</p>'}
      <h3>Delivery operation outcomes</h3><p>Uncertain or interrupted external actions need review. No automatic retry or recovery is offered here.</p>
      ${operations.length ? operations.map((item) => `<details class="check-evidence"><summary>${text(item.operation)} · ${text(item.provider)} · ${status(item.state, 'delivery')}</summary>
        <p>Delivery ${text(item.deliveryId)} · commit <code>${text(item.commit)}</code> · ${text(item.updatedAt)}</p>
        <ul>${attempts.filter((attempt) => attempt.operationId === item.id).slice(0, 5).map((attempt) => {
          const receipt = attempt.receiptSummary;
          return `<li>Attempt ${text(attempt.ordinal)}: ${status(attempt.state, 'delivery')}
            <p>${receipt ? `Receipt: ${text(receipt.status)}${receipt.classification ? ` · ${text(receipt.classification)} failure` : ''}${receipt.effects ? ` · effects ${text(receipt.effects)}` : ''}${receipt.reason ? ` · ${text(receipt.reason)}` : ''}. ${receipt.hasReference ? 'Adapter reference recorded; not exposed in this view.' : 'No adapter reference recorded.'}` : 'Receipt summary unavailable.'}</p></li>`;
        }).join('')}</ul></details>`).join('') : '<p>No delivery operation receipts recorded. Landing is not deployment.</p>'}
      <p>${text(snapshot.deliveryEvidenceCoverage ?? 'Receipt history may be incomplete. Inspect CLI evidence for details.')}</p>`;
  }
  globalThis.TorchOperationOutcomes = Object.freeze({ render });
})();
