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

  const tasks = (snapshot.backlog ?? []).filter((task) => !['completed', 'cancelled'].includes(task.state));
  $('#task-count').textContent = `${tasks.length} active`;
  $('#task-list').innerHTML = tasks.length ? tasks.slice(0, 12).map((task) => `
    <div class="list-row"><div><strong>${safe(task.title ?? task.id)}</strong><small>${safe(task.owner ?? 'unassigned')}</small></div><span>${safe(task.state)}</span></div>
  `).join('') : empty('No active tracked work.');

  const integrations = snapshot.integration ?? [];
  $('#integration-list').innerHTML = integrations.length ? integrations.map((item) => `
    <div class="list-row"><div><strong>${safe(item.sourceArea)}</strong><small>${safe(item.sourceCommit?.slice(0, 9))}</small></div><span>${safe(item.state)}</span></div>
  `).join('') : empty('No commits waiting to land.');

  const holders = snapshot.resources?.holders ?? [];
  const waiters = snapshot.resources?.waiters ?? [];
  $('#resource-list').innerHTML = holders.length || waiters.length
    ? [...holders.map((item) => `<div class="list-row"><strong>${safe(item.resourceId)}</strong><span>${safe(item.areaId)} holds</span></div>`),
      ...waiters.map((item) => `<div class="list-row"><strong>${safe(item.resourceId)}</strong><span>${safe(item.areaId)} waits</span></div>`)].join('')
    : empty('All configured resources are available.');

  const messages = snapshot.messages?.recent ?? [];
  $('#message-count').textContent = `${snapshot.messages?.unacknowledged ?? 0} unacknowledged`;
  $('#message-list').innerHTML = messages.length ? messages.map((message) => `
    <div class="message-row"><p><strong>${safe(message.sender)}</strong> to ${safe(message.recipient)}</p><span>${safe(message.body)}</span></div>
  `).join('') : empty('No durable messages yet.');

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
