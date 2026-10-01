(function (global) {
  const shortCommit = (value) => value ? String(value).slice(0, 9) : '—';
const ownerDomainNames = {
  'release-self-host': 'Release and Self-host',
  'work-integration': 'Work and Integration',
  'project-kernel': 'Project Kernel',
  'session-manager': 'Session Manager',
};

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
  const agentName = (id) => ownerDomainNames[id] ?? agents.get(id)?.title ?? id ?? 'Owner not recorded';
  const add = (group, item) => groups[group].push(item);
  const approvals = (snapshot.approvalRequests?.items ?? []).filter((approval) => approval.status === 'pending');

  for (const approval of approvals) {
    const isOwner = approval.approver === 'owner';
    add(isOwner ? 'owner' : 'fleet', {
      tone: isOwner ? 'decision' : 'review',
      title: approval.title || 'Approval request',
      owner: isOwner ? 'Project owner' : agentName(approval.approver),
      detail: `${agentName(approval.requester)} is waiting on ${isOwner ? 'your decision' : agentName(approval.approver)}. ${approval.summary || 'Request consequence and options are not recorded.'}`,
      evidence: [approval.task, approval.evidence].filter(Boolean).join(' · ') || 'Request evidence not recorded',
      href: `#approval-${encodeURIComponent(approval.id)}`,
      action: isOwner ? 'Review request and evidence' : 'Open approval details',
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
      detail: `${labels.join('; ')}.${hasAhead ? ' Ahead commits are retained work progress, not a broken repository.' : ''} ${hasUnsafeProblem ? 'Review the exact worktree before deciding on recovery.' : 'Ask the owner to review a safe convergence plan.'}`,
      evidence: [worktree?.branch, worktree?.path ?? item.path, worktree?.ahead != null ? `${worktree.ahead} ahead / ${worktree.behind ?? 0} behind` : null].filter(Boolean).join(' · ') || 'Branch and path not recorded',
      href: `#worktree-${encodeURIComponent(item.area)}`, action: 'Inspect this worktree',
      requestOwner: item.area !== 'unknown-owner' ? item.area : null,
    });
  }

  for (const finding of findings.filter((entry) => ['error', 'warning'].includes(entry.severity)
    && !['MESSAGE_BACKLOG', 'WORKTREE_PROBLEM'].includes(entry.code))) {
    const recoveryGap = finding.code === 'RECOVERABILITY' && !finding.offMachine;
    const humanTitle = recoveryGap
      ? 'Off-machine recovery copy is not verified'
      : finding.code.replaceAll('_', ' ').toLowerCase().replace(/^./, (letter) => letter.toUpperCase());
    add('fleet', {
      tone: finding.severity === 'error' ? 'urgent' : 'review', title: humanTitle,
      owner: recoveryGap ? 'Release and Self-host' : finding.area ? agentName(finding.area) : 'Responsible domain not recorded',
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
  for (const item of waitingIntegration) add('arbiter', {
    tone: 'review', title: `Integration ${item.state}`, owner: 'Session Manager / integration authority',
    detail: 'Landing is serialized. The arbiter must check the exact candidate and required receipts before proceeding.',
    evidence: `${item.sourceArea} · ${shortCommit(item.sourceCommit)} · ${item.reason ?? 'reason not recorded'}`,
    href: '#delivery', action: 'Inspect integration queue',
  });

  const unknownWakes = snapshot.managerWakes?.blockingCount ?? 0;
  if (unknownWakes) add('arbiter', {
    tone: 'urgent', title: `${unknownWakes} manager launch${unknownWakes === 1 ? '' : 'es'} need inspection`,
    owner: 'Session Manager', detail: 'An unknown launch blocks another scheduled wake. Inspect recorded runtime evidence; no automatic restart is available.',
    evidence: 'A reserved launch does not prove the provider is still running.',
    href: '#manager-wakes', action: 'Inspect manager launches',
  });

  const unresolvedDelivery = (snapshot.deliveryOperations ?? []).filter((operation) => ['running', 'unknown', 'succeeded'].includes(operation.state));
  if (unresolvedDelivery.length) add('arbiter', {
    tone: 'urgent', title: `${unresolvedDelivery.length} delivery operation${unresolvedDelivery.length === 1 ? '' : 's'} need review`,
    owner: 'Release and Self-host', detail: 'Inspect recorded attempts and external state before considering recovery. Do not repeat effects automatically.',
    evidence: unresolvedDelivery.map((operation) => `${operation.operation} · ${operation.state} · ${shortCommit(operation.commit)}`).join('; '),
    href: '#operation-outcomes', action: 'Inspect operation outcomes',
  });

  const neglected = (snapshot.backlogActivity?.tasks ?? []).filter((task) => task.status === 'stale' && task.ownerRequested);
  if (neglected.length) add('fleet', {
    tone: 'review', title: `${neglected.length} owner-requested task${neglected.length === 1 ? '' : 's'} need activity review`,
    owner: 'Task owner not recorded', detail: 'No named commit appears within the configured review window. Blocked work may be waiting as expected.',
    evidence: 'Review the recorded task activity before asking for a change.', href: '#activity-review', action: 'Open activity review',
  });

  const staleEvidence = (snapshot.backlogHealth?.findings ?? []).filter((finding) =>
    ['BACKLOG_OBSERVED_COMMIT_STALE', 'BACKLOG_OBSERVED_COMMIT_MISSING'].includes(finding.code));
  if (staleEvidence.length) add('fleet', {
    tone: 'review', title: `${staleEvidence.length} task evidence record${staleEvidence.length === 1 ? '' : 's'} need refresh`,
    owner: 'Task owner not recorded', detail: 'Some backlog evidence refers to an old or unreachable commit. Re-check it before dispatch.',
    evidence: staleEvidence.map((finding) => `${finding.taskId ?? 'task not recorded'} · ${finding.code}`).join('; '),
    href: '#backlog-board', action: 'Inspect backlog evidence',
  });
  return groups;
}

  global.TorchAttentionProjection = Object.freeze({ groups: attentionGroups });
})(globalThis);
