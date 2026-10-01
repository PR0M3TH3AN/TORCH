(function (global) {
  const shortCommit = (value) => value ? String(value).slice(0, 9) : '—';
function worktreeProblemLabel(problem) {
  if (problem === 'worktree-dirty') return 'Uncommitted changes are present';
  if (problem === 'worktree-missing') return 'The managed worktree is missing';
  if (problem.startsWith('unique-commits:')) return `${problem.split(':')[1]} unique commit(s) are ahead`;
  if (problem.startsWith('git-operation:')) return `Git operation needs resolution (${problem.slice('git-operation:'.length)})`;
  if (problem.startsWith('branch-mismatch:')) return `Branch differs from its manifest (${problem.slice('branch-mismatch:'.length)})`;
  return problem.replaceAll('-', ' ');
}

function attentionGroups(snapshot) {
  const groups = { owner: [], fleet: [], arbiter: [] };
  const agents = new Map((snapshot.agents ?? []).map((agent) => [agent.areaId, agent]));
  const tasks = new Map((snapshot.backlog ?? []).map((task) => [task.id, task]));
  const agentName = (id) => agents.get(id)?.title ?? id ?? 'Owner not recorded';
  const add = (group, item) => groups[group].push(item);
  const approvals = (snapshot.approvalRequests?.items ?? []).filter((approval) => approval.status === 'pending');

  const advisory = [];
  const recheckCodes = new Set(['BACKLOG_OBSERVED_COMMIT_STALE', 'BACKLOG_OBSERVED_COMMIT_MISSING']);
  const rechecks = new Map();
  const recheckValue = (finding, key, fallback) => Object.hasOwn(finding, key) && finding[key] !== undefined
    ? finding[key] : fallback;
  const addRecheck = (finding, source) => {
    if (finding.severity !== 'warning' || !recheckCodes.has(finding.code)) return;
    const taskId = recheckValue(finding, 'taskId', null);
    const task = tasks.get(taskId);
    const observation = {
      taskId,
      code: finding.code,
      owner: recheckValue(finding, 'owner', task?.owner ?? null),
      observedAt: recheckValue(finding, 'observedAt', task?.observedAt ?? null),
      currentObservedCommit: recheckValue(finding, 'currentObservedCommit',
        snapshot.repository?.head ?? snapshot.project?.head ?? null),
      reproductionStatus: finding.reproductionStatus ?? finding.reproductionState ?? 'UNKNOWN',
      sources: [],
    };
    const fingerprint = JSON.stringify([
      observation.taskId, observation.code, observation.owner, observation.observedAt,
      observation.currentObservedCommit, observation.reproductionStatus,
    ]);
    const retained = rechecks.get(fingerprint) ?? observation;
    if (!retained.sources.includes(source)) retained.sources.push(source);
    rechecks.set(fingerprint, retained);
  };

  for (const approval of approvals) {
    const isOwner = approval.approver === 'owner';
    add(isOwner ? 'owner' : 'fleet', {
      tone: isOwner ? 'decision' : 'review',
      title: approval.title || 'Approval request',
      owner: isOwner ? 'Project owner' : agentName(approval.approver),
      detail: `${agentName(approval.requester)} is waiting on ${isOwner ? 'your decision' : agentName(approval.approver)}. ${approval.summary || 'Request consequence and options are not recorded.'}`,
      evidence: [approval.task, approval.evidence].filter(Boolean).join(' · ') || 'Request evidence not recorded',
      waitSince: approval.createdAt ?? null,
      href: `#approval-${encodeURIComponent(approval.id)}`,
      action: isOwner ? 'Review request and evidence' : 'Open approval details',
      decisionApprovalId: isOwner ? approval.id : null,
    });
  }

  const pendingChanges = (snapshot.fleetChanges ?? []).filter((change) => change.state === 'proposed');
  const pendingHierarchy = (snapshot.hierarchyProposals ?? []).filter((proposal) => proposal.state === 'proposed');
  for (const proposal of [...pendingChanges, ...pendingHierarchy]) add('owner', {
    tone: 'decision', title: proposal.title ?? proposal.proposal?.title ?? 'Organization proposal',
    owner: 'Project owner', detail: `${proposal.rationale ?? proposal.proposal?.impact ?? 'The requested consequence is not recorded.'} This proposal does not change the active Fleet without a separate decision.`,
    evidence: proposal.id, href: '#organization-proposals', action: 'Review proposal',
  });

  const findings = snapshot.doctor?.findings ?? [];
  const messageFinding = findings.find((finding) => finding.code === 'MESSAGE_BACKLOG');
  const awaiting = Math.max(Number(snapshot.messages?.unacknowledged) || 0, Number(messageFinding?.unacknowledged) || 0);
  if (awaiting) add('fleet', {
    tone: 'review', title: `${awaiting} durable message${awaiting === 1 ? '' : 's'} awaiting acknowledgement`,
    owner: 'Named recipients', detail: 'This aggregate covers the Fleet. Each named recipient owns their acknowledgement; other identities should not acknowledge it.',
    evidence: 'Unread queues are summarized once; individual message ownership remains visible in Conversations.',
    href: '#communications', action: 'Open Conversations',
  });

  const worktreeFindings = findings.filter((finding) => finding.code === 'WORKTREE_PROBLEM');
  const groupedWorktrees = new Map();
  for (const finding of worktreeFindings) {
    const key = finding.area ?? finding.areaId ?? 'unknown-owner';
    const group = groupedWorktrees.get(key) ?? { area: key, path: finding.path, problems: [] };
    group.path ??= finding.path;
    group.problems.push(finding.problem ?? finding.message ?? 'Worktree condition is not recorded');
    groupedWorktrees.set(key, group);
  }
  for (const item of groupedWorktrees.values()) {
    const worktree = (snapshot.worktrees ?? []).find((entry) => entry.area === item.area);
    const hasAhead = item.problems.some((problem) => problem.startsWith('unique-commits:'));
    const hasUnsafeProblem = item.problems.some((problem) => !problem.startsWith('unique-commits:'));
    const labels = item.problems.map(worktreeProblemLabel);
    const identity = agentName(item.area);
    add('fleet', {
      tone: !hasUnsafeProblem ? 'info' : item.problems.some((problem) => problem.startsWith('git-operation:') || problem === 'worktree-missing') ? 'urgent' : 'review',
      title: !hasUnsafeProblem ? `${identity} has work ahead of main` : `${identity} worktree needs review`,
      owner: identity,
      detail: `${labels.join('; ')}.${hasAhead ? ' Ahead commits are retained work progress, not a broken repository.' : ''} ${hasUnsafeProblem ? 'Review the exact worktree before deciding on recovery.' : 'Ask the owning specialist or manager to review a safe convergence plan.'}`,
      evidence: [worktree?.branch, worktree?.path ?? item.path, worktree?.ahead != null ? `${worktree.ahead} ahead / ${worktree.behind ?? 0} behind` : null].filter(Boolean).join(' · ') || 'Branch and path not recorded',
      href: `#worktree-${encodeURIComponent(item.area)}`, action: 'Inspect this worktree',
      requestOwner: item.area !== 'unknown-owner' ? item.area : null,
    });
  }

  for (const finding of findings.filter((entry) => ['error', 'warning'].includes(entry.severity)
    && !['MESSAGE_BACKLOG', 'WORKTREE_PROBLEM'].includes(entry.code)
    && !(entry.severity === 'warning' && recheckCodes.has(entry.code)))) {
    const recoveryGap = finding.code === 'RECOVERABILITY' && !finding.offMachine;
    const humanTitle = recoveryGap
      ? 'Off-machine recovery copy is not verified'
      : finding.code.replaceAll('_', ' ').toLowerCase().replace(/^./, (letter) => letter.toUpperCase());
    add('fleet', {
      tone: finding.severity === 'error' ? 'urgent' : 'review', title: humanTitle,
      owner: finding.area ? agentName(finding.area) : 'Responsible domain not recorded',
      detail: recoveryGap
        ? `${finding.recommendation ?? 'Configure and synchronize an off-machine canonical Git boundary.'} A single disk failure could remove the only recorded recovery copy.`
        : finding.message ?? finding.recommendation ?? 'Review this condition with the responsible domain; its consequence is not recorded.',
      evidence: [finding.level, finding.commit ? shortCommit(finding.commit) : null, finding.path, finding.problem].filter(Boolean).join(' · ') || 'Doctor finding',
      href: finding.area ? `#worktree-${encodeURIComponent(finding.area)}` : '#evidence',
      action: recoveryGap ? 'Review recovery evidence' : finding.area ? 'Inspect owner evidence' : 'Review evidence',
    });
  }

  for (const task of (snapshot.backlog ?? []).filter((item) => item.state === 'blocked')) add('fleet', {
    tone: 'review', title: task.title ?? task.id, owner: agentName(task.owner),
    detail: task.blockedReason || 'This task is blocked; the reason is not recorded in the snapshot.',
    evidence: task.id, href: '#backlog-board', action: 'Inspect task status',
  });

  const waitingIntegration = (snapshot.integration ?? []).filter((item) => !['landed', 'rejected', 'superseded'].includes(item.state));
  for (const item of waitingIntegration) add('fleet', {
    tone: 'review', title: `Integration ${item.state}`, owner: item.authorizedBy ? agentName(item.authorizedBy) : 'Integration authority not recorded',
    detail: 'Review the exact candidate and required receipts under the current named landing authority. Queue state does not establish that a separate owner decision is required.',
    evidence: [item.sourceArea, shortCommit(item.sourceCommit), item.authorizedBy ? `authorized by ${agentName(item.authorizedBy)}` : null, item.reason ?? 'reason not recorded'].filter(Boolean).join(' · '),
    href: '#delivery', action: 'Inspect integration queue',
  });

  const unknownWakes = snapshot.managerWakes?.blockingCount ?? 0;
  if (unknownWakes) {
    const reservations = (snapshot.managerWakes?.reservations ?? []).filter((item) => item.blocksManagerWake);
    const wakeOwners = [...new Set(reservations.map((item) => agentName(item.managerId)))];
    add('fleet', {
      tone: 'urgent', title: `${unknownWakes} scheduled manager launch${unknownWakes === 1 ? '' : 'es'} ${unknownWakes === 1 ? 'needs' : 'need'} inspection`,
      owner: wakeOwners.join(', ') || 'Scheduled wake owner not recorded',
      detail: 'A recorded reservation blocks another wake. Inspect current runtime evidence before acting; this record does not prove a provider is still running or establish who may restart it.',
      evidence: reservations.map((item) => [item.scheduleId, item.reservedAt, item.outcome].filter(Boolean).join(' · ')).join('; ') || 'Reservation detail unavailable',
      href: '#manager-wakes', action: 'Inspect manager launches',
    });
  }

  const unresolvedDelivery = (snapshot.deliveryOperations ?? []).filter((operation) => ['running', 'unknown', 'succeeded'].includes(operation.state));
  if (unresolvedDelivery.length) add('fleet', {
    tone: 'urgent', title: `${unresolvedDelivery.length} delivery operation${unresolvedDelivery.length === 1 ? '' : 's'} need review`,
    owner: [...new Set(unresolvedDelivery.map((operation) => operation.actor ? agentName(operation.actor) : 'Operation owner not recorded'))].join(', '),
    detail: 'Inspect recorded attempts and external state before considering recovery. Do not repeat effects automatically.',
    evidence: unresolvedDelivery.map((operation) => `${operation.operation} · ${operation.state} · ${shortCommit(operation.commit)}`).join('; '),
    href: '#operation-outcomes', action: 'Inspect operation outcomes',
  });

  const neglected = (snapshot.backlogActivity?.tasks ?? []).filter((task) => task.status === 'stale' && task.ownerRequested);
  if (neglected.length) add('fleet', {
    tone: 'review', title: `${neglected.length} owner-requested task${neglected.length === 1 ? '' : 's'} need activity review`,
    owner: 'Task owner not recorded', detail: 'No named commit appears within the configured review window. Blocked work may be waiting as expected.',
    evidence: 'Review the recorded task activity before asking for a change.', href: '#activity-review', action: 'Open activity review',
  });

  for (const finding of findings) addRecheck(finding, 'doctor');
  for (const finding of snapshot.backlogHealth?.findings ?? []) addRecheck(finding, 'backlogHealth');
  const observations = [...rechecks.values()].sort((left, right) => {
    const leftKey = JSON.stringify([left.taskId, left.code, left.owner, left.observedAt,
      left.currentObservedCommit, left.reproductionStatus]);
    const rightKey = JSON.stringify([right.taskId, right.code, right.owner, right.observedAt,
      right.currentObservedCommit, right.reproductionStatus]);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  if (observations.length) {
    const taskReferences = [...new Set(observations.map((item) => item.taskId).filter((id) => id != null))];
    const countLabel = taskReferences.length === observations.length
      ? `${taskReferences.length} task evidence recheck${taskReferences.length === 1 ? '' : 's'}`
      : `${observations.length} observed evidence record${observations.length === 1 ? '' : 's'} to recheck`;
    advisory.push({
      tone: 'info', title: countLabel, owner: 'Advisory recheck',
      detail: 'Observed backlog evidence may refer to an old or unreachable commit. Recheck each observation before dispatch; reproduction remains UNKNOWN until independently verified.',
      evidence: `${observations.length} distinct observation${observations.length === 1 ? '' : 's'} · ${taskReferences.length} recorded task reference${taskReferences.length === 1 ? '' : 's'}`,
      href: '#backlog-board', action: 'Inspect backlog evidence',
      observations, taskReferences,
    });
    groups.advisory = advisory;
  }
  return groups;
}

function attentionSummary(groups) {
  const fleet = groups.fleet ?? [];
  const owner = groups.owner ?? [];
  const arbiter = groups.arbiter ?? [];
  const advisory = groups.advisory ?? [];
  const actionableFleet = fleet.filter((item) => item.tone !== 'info');
  const advisoryReferences = advisory.reduce((count, item) => count
    + (Array.isArray(item.taskReferences) ? item.taskReferences.length : item.observations?.length ?? 0), 0);
  return {
    ownerDecisions: owner.length,
    urgentHazards: fleet.filter((item) => item.tone === 'urgent').length,
    actionable: owner.length + actionableFleet.length + arbiter.filter((item) => item.tone !== 'info').length,
    fleetTotal: fleet.length,
    fleetInformational: fleet.length - actionableFleet.length,
    advisoryCohorts: advisory.length,
    advisoryReferences,
  };
}

function fleetPreview(groups, additionalLimit = 3) {
  const fleet = groups.fleet ?? [];
  const urgent = fleet.filter((item) => item.tone === 'urgent');
  const remaining = fleet.filter((item) => item.tone !== 'urgent')
    .sort((left, right) => {
      const rank = { decision: 0, review: 1, info: 2 };
      return (rank[left.tone] ?? 3) - (rank[right.tone] ?? 3);
    });
  return [...urgent, ...remaining.slice(0, Math.max(0, additionalLimit))];
}

  global.TorchAttentionProjection = Object.freeze({
    groups: attentionGroups,
    summary: attentionSummary,
    fleetPreview,
  });
})(globalThis);
