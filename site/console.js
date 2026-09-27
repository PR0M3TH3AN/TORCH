const $ = (selector) => document.querySelector(selector);

function empty(message) {
  return `<p class="empty-state">${message}</p>`;
}

function safe(value) {
  const element = document.createElement('span');
  element.textContent = value ?? '';
  return element.innerHTML;
}

function render(snapshot) {
  const project = snapshot.project ?? snapshot.repository;
  $('#project-name').textContent = project?.name ?? project?.id ?? 'Not installed';
  $('#project-commit').textContent = snapshot.repository?.head?.slice(0, 9) ?? '—';
  $('#fleet-health').textContent = snapshot.mode === 'installed'
    ? (snapshot.doctor?.healthy ? 'Healthy' : 'Needs attention') : 'Not installed';
  $('#context-state').textContent = snapshot.contextLocality?.measured ? 'Measured' : 'Unmeasured';

  const agents = snapshot.agents ?? [];
  $('#agent-count').textContent = `${agents.length} ${agents.length === 1 ? 'identity' : 'identities'}`;
  $('#agent-list').innerHTML = agents.length ? agents.map((agent) => `
    <div class="agent-row"><span class="presence ${safe(agent.state)}"></span><div><strong>${safe(agent.title ?? agent.areaId)}</strong><small>${safe(agent.summary ?? `${agent.runtime ?? 'runtime'} · ${agent.state}`)}</small></div><code>${safe(agent.areaId)}</code></div>
  `).join('') : empty('Install an approved fleet to see persistent identities.');

  const domains = snapshot.organization?.domains ?? [];
  $('#ownership-list').innerHTML = domains.length ? domains.map((domain) => `
    <div class="list-row"><div><strong>${safe(domain.title ?? domain.id)}</strong><small>${safe((domain.owned_paths ?? []).join(', ') || 'No paths assigned')}</small></div><span>${safe((domain.neighbours ?? []).join(', ') || 'isolated')}</span></div>
  `).join('') : empty('No approved domain ownership graph.');

  const worktrees = snapshot.worktrees ?? [];
  $('#recoverability-state').textContent = snapshot.mode === 'installed'
    ? (snapshot.recoverability?.level ?? 'Unknown') : 'Not installed';
  $('#worktree-list').innerHTML = worktrees.length ? worktrees.map((worktree) => `
    <div class="list-row"><div><strong>${safe(worktree.area)}</strong><small>${safe(worktree.branch)} · ${safe(worktree.path)}</small></div><span>${safe(`${worktree.ahead ?? 0} ahead / ${worktree.behind ?? 0} behind`)}</span></div>
  `).join('') : empty('No managed worktrees have been created.');

  const tasks = (snapshot.backlog ?? []).filter((task) => !['completed', 'cancelled'].includes(task.state));
  $('#task-count').textContent = `${tasks.length} active`;
  $('#task-list').innerHTML = tasks.length ? tasks.slice(0, 12).map((task) => `
    <div class="list-row"><div><strong>${safe(task.title ?? task.id)}</strong><small>${safe(task.owner ?? 'unassigned')}</small></div><span>${safe(task.state)}</span></div>
  `).join('') : empty('No active tracked work.');

  const changes = snapshot.fleetChanges ?? [];
  const pendingChanges = changes.filter((change) => !['active', 'rejected'].includes(change.state));
  $('#change-count').textContent = `${pendingChanges.length} pending`;
  $('#change-list').innerHTML = changes.length ? changes.map((change) => `
    <div class="list-row"><div><strong>${safe(change.title ?? change.domainId)}</strong><small>${safe(change.expectedBenefit ?? 'No expected benefit recorded')}</small></div><span>${safe(change.state)}</span></div>
  `).join('') : empty('No Fleet changes proposed. The current roster remains in force.');

  const integrations = snapshot.integration ?? [];
  $('#integration-list').innerHTML = integrations.length ? integrations.map((item) => `
    <div class="list-row"><div><strong>${safe(item.sourceArea)}</strong><small>${safe(item.sourceCommit?.slice(0, 9))}</small></div><span>${safe(item.state)}</span></div>
  `).join('') : empty('No commits waiting to land.');

  const deliveries = snapshot.deliveries ?? [];
  $('#delivery-list').innerHTML = deliveries.length ? deliveries.map((item) => `
    <div class="list-row"><div><strong>${safe(item.label)}</strong><small>${safe(item.sourceArea)} · ${safe(item.commit?.slice(0, 9))}</small></div><span>${safe(item.state)}</span></div>
  `).join('') : empty('No delivery records. Integration does not imply deployment.');

  const receipts = snapshot.checks?.receipts ?? [];
  $('#check-list').innerHTML = receipts.length ? receipts.map((receipt) => `
    <div class="list-row"><div><strong>${safe(receipt.checkId)}</strong><small>${safe(receipt.areaId)} · ${safe(receipt.commit?.slice(0, 9))}</small></div><span>${safe(receipt.result)}</span></div>
  `).join('') : empty('No exact-commit check receipts.');

  const holders = snapshot.resources?.holders ?? [];
  const waiters = snapshot.resources?.waiters ?? [];
  $('#resource-list').innerHTML = holders.length || waiters.length
    ? [...holders.map((item) => `<div class="list-row"><strong>${safe(item.resourceId)}</strong><span>${safe(item.areaId)} holds</span></div>`),
      ...waiters.map((item) => `<div class="list-row"><strong>${safe(item.resourceId)}</strong><span>${safe(item.areaId)} waits</span></div>`)].join('')
    : empty('All configured resources are available.');

  const schedules = snapshot.schedules ?? [];
  $('#schedule-list').innerHTML = schedules.length ? schedules.map((schedule) => `
    <div class="list-row"><div><strong>${safe(schedule.id)}</strong><small>${safe(schedule.owner)} · ${safe(schedule.lifetime)}</small></div><span>${safe(schedule.behavior)}</span></div>
  `).join('') : empty('No schedules configured.');

  const providers = snapshot.providers ?? {};
  const runtimeProviders = providers.runtimes ?? [];
  const deliveryProviders = providers.delivery ?? {};
  const configured = snapshot.mode === 'installed';
  $('#provider-list').innerHTML = [
    `<div class="list-row"><strong>Forge</strong><span>${safe(configured ? `${providers.forge?.provider ?? 'none'} · ${providers.forge?.status ?? 'unknown'}` : 'not configured')}</span></div>`,
    ...runtimeProviders.map((runtime) => `<div class="list-row"><strong>${safe(runtime.name)}</strong><span>runtime configured</span></div>`),
    `<div class="list-row"><strong>Release</strong><span>${safe(configured ? (deliveryProviders.release?.provider ?? 'none') : 'not configured')}</span></div>`,
    `<div class="list-row"><strong>Deployment</strong><span>${safe(configured ? (deliveryProviders.deployment?.provider ?? 'none') : 'not configured')}</span></div>`,
  ].join('');

  const messages = snapshot.messages?.recent ?? [];
  $('#message-count').textContent = `${snapshot.messages?.unacknowledged ?? 0} unacknowledged`;
  $('#message-list').innerHTML = messages.length ? messages.map((message) => `
    <div class="message-row"><p><strong>${safe(message.sender)}</strong> to ${safe(message.recipient)}<small>${safe((message.acknowledgedBy ?? []).length ? `Acknowledged by ${(message.acknowledgedBy ?? []).join(', ')}` : 'Unacknowledged')}</small></p><span>${safe(message.body)}</span></div>
  `).join('') : empty('No durable messages yet.');

  const decisions = snapshot.decisions?.content ?? '';
  $('#decision-list').innerHTML = decisions.trim()
    ? `<p class="decision-copy">${safe(decisions)}</p>` : empty('No tracked decisions.');

  const locality = snapshot.contextLocality;
  $('#context-detail').innerHTML = locality?.measured
    ? locality.samples.map((sample) => `<div class="locality-row"><strong>${safe(sample.areaId)}</strong><span>${safe(String(sample.cacheRead ?? 0))} cached tokens</span></div>`).join('')
    : `<p>${safe(locality?.reason ?? 'Runtime usage reporting is not available.')}</p><small>TORCH will compare cache activity with verified outcomes, not token count alone.</small>`;
}

async function refresh() {
  $('#console-error').hidden = true;
  try {
    const response = await fetch('/api/snapshot', { cache: 'no-store' });
    const snapshot = await response.json();
    if (!response.ok) throw new Error(snapshot.message ?? snapshot.error);
    render(snapshot);
  } catch (error) {
    $('#console-error').textContent = `Snapshot unavailable: ${error.message}`;
    $('#console-error').hidden = false;
  }
}

$('#refresh-console')?.addEventListener('click', refresh);
refresh();
