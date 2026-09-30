import { loadFleetDefinition } from '../kernel/worktrees.mjs';
import { organizationGraphFromConfig } from '../kernel/organization.mjs';
import { TorchError } from '../kernel/errors.mjs';
import { BacklogService } from '../backlog/service.mjs';

/** Read-only, organization-aware summary for one manager's direct reports. */
export function planManagerCheckIn({ repositoryRoot, controlPlane, managerId, at = new Date(), staleWork = null } = {}) {
  const manager = controlPlane.assertIdentity(managerId);
  const { config } = loadFleetDefinition(repositoryRoot);
  const graph = organizationGraphFromConfig(config);
  const managerRoles = graph.roles.filter((role) => role.identity_id === manager);
  if (!managerRoles.length) {
    throw new TorchError(`Fleet identity ${manager} has no organization role`, {
      code: 'MANAGER_ROLE_NOT_FOUND', details: { managerId: manager },
    });
  }
  const roleIds = new Set(managerRoles.map((role) => role.id));
  const reports = graph.roles.filter((role) => role.reports_to.some((parent) => roleIds.has(parent)))
    .filter((role) => role.identity_id !== manager)
    .reduce((result, role) => {
      if (!result.has(role.identity_id)) result.set(role.identity_id, role);
      return result;
    }, new Map());
  const directReports = [...reports.keys()].map((areaId) => controlPlane.identity(areaId));
  const reportIds = new Set(directReports.map((report) => report.areaId));
  const messages = controlPlane.readMessages({ recipient: manager, unacknowledgedOnly: true })
    .filter((message) => reportIds.has(message.sender));
  const approvalWaits = controlPlane.pendingApprovalsFor([...reportIds]).map((approval) => ({
    id: approval.id, requester: approval.requester, approver: approval.approver,
    approverKind: approval.approver === 'owner' ? 'owner'
      : approval.approver === manager ? 'manager' : 'peer-ai',
    task: approval.task, title: approval.title, summary: approval.summary,
    evidence: approval.evidence, createdAt: approval.createdAt, revision: approval.revision,
  }));
  const approvalsByRequester = new Set(approvalWaits.map((approval) => approval.requester));
  const findings = [];

  for (const report of directReports) {
    if (report.state === 'waiting' && !approvalsByRequester.has(report.areaId)) {
      findings.push({
        type: 'waiting-unclassified', areaId: report.areaId, task: report.currentTask,
        summary: report.summary, observedAt: report.updatedAt,
        note: 'The wait reason is not structured; inspect the session before inferring an approval request.',
      });
    } else if (report.state === 'offline') {
      findings.push({ type: 'direct-report-offline', areaId: report.areaId, task: report.currentTask });
    } else if (report.state === 'stale') {
      findings.push({ type: 'direct-report-stale', areaId: report.areaId, task: report.currentTask });
    }
  }
  for (const approval of approvalWaits) {
    findings.push({
      type: 'approval-wait', areaId: approval.requester, approvalId: approval.id,
      approver: approval.approver, approverKind: approval.approverKind, task: approval.task,
      title: approval.title, createdAt: approval.createdAt,
    });
  }
  for (const message of messages) {
    findings.push({
      type: message.kind === 'blocker' ? 'unacknowledged-blocker' : 'unacknowledged-message',
      areaId: message.sender, messageId: message.id, kind: message.kind,
      task: message.references.task, createdAt: message.createdAt,
    });
  }

  let staleWorkReview = null;
  if (staleWork !== null) {
    const staleDays = staleWork.stale_days ?? config.backlog?.activity?.stale_days ?? 3;
    const maxCommits = staleWork.max_commits ?? config.backlog?.activity?.max_commits ?? 1000;
    const maxItems = staleWork.max_items ?? 30;
    if (!Number.isInteger(staleDays) || staleDays < 1 || staleDays > 365
      || !Number.isInteger(maxCommits) || maxCommits < 1 || maxCommits > 10_000
      || !Number.isInteger(maxItems) || maxItems < 1 || maxItems > 100) {
      throw new TorchError('Invalid stale-work review bounds', { code: 'MANAGER_STALE_WORK_INPUT_INVALID' });
    }
    try {
      const activity = new BacklogService({ repositoryRoot, controlPlane }).activity({ staleDays, maxCommits, now: at });
      const scoped = activity.tasks.filter((task) => reportIds.has(task.owner)
        || (manager === 'session-manager' && task.owner === null));
      const neglected = scoped.filter((task) => task.status === 'stale');
      const unknown = scoped.filter((task) => task.status === 'unknown');
      const compact = (task) => ({ taskId: task.taskId, title: task.title.slice(0, 240),
        state: task.state, owner: task.owner, ownerRequested: task.ownerRequested,
        status: task.status, ageDays: task.ageDays, expectedWaiting: task.expectedWaiting,
        lastActivity: task.lastActivity ? { commit: task.lastActivity.commit,
          committedAt: task.lastActivity.committedAt } : null });
      staleWorkReview = { available: true, complete: activity.complete, staleDays, maxCommits, maxItems,
        generatedAt: activity.generatedAt, provenance: activity.provenance,
        staleCount: neglected.length, unknownCount: unknown.length,
        stale: neglected.slice(0, maxItems).map(compact), unknown: unknown.slice(0, maxItems).map(compact),
        truncated: neglected.length > maxItems || unknown.length > maxItems || activity.truncated,
        closurePerformed: false, mutationPerformed: false };
      for (const task of staleWorkReview.stale) findings.push({
        type: 'stale-work', areaId: task.owner ?? manager, task: task.taskId,
        title: task.title, ownerRequested: task.ownerRequested, ageDays: task.ageDays,
        expectedWaiting: task.expectedWaiting,
        note: task.expectedWaiting ? 'Blocked work needs dependency review, not automatic restart.'
          : 'No recent commit-linked activity in the observed managed history; review before changing work.',
      });
      if (!activity.complete || unknown.length) findings.push({
        type: 'stale-work-coverage-unknown', areaId: manager, unknownCount: unknown.length,
        note: 'Incomplete history or task time cannot prove absence of work. Restore observation before declaring tasks neglected.',
      });
    } catch (error) {
      staleWorkReview = { available: false, complete: false, staleDays, maxCommits, maxItems,
        reason: error.code ?? 'BACKLOG_ACTIVITY_UNAVAILABLE', stale: [], unknown: [],
        closurePerformed: false, mutationPerformed: false };
      findings.push({ type: 'stale-work-unavailable', areaId: manager,
        note: 'Task activity could not be observed; this is not evidence of inactivity.' });
    }
  }

  return {
    schema: 'torch.dev/manager-check-in/v1alpha1', mutationPerformed: false,
    managerId: manager, at: at.toISOString(), directReports,
    findings, approvalWaits, approvalWaitDetection: 'structured', staleWorkReview,
    attentionRequired: findings.length > 0 || approvalWaits.length > 0,
  };
}

/** Queue one durable self-directed prompt; never starts or steers a runtime. */
export function queueManagerCheckIn({ repositoryRoot, controlPlane, managerId, at = new Date(), staleWork = null } = {}) {
  const plan = planManagerCheckIn({ repositoryRoot, controlPlane, managerId, at, staleWork });
  if (!plan.attentionRequired) {
    return { ...plan, queued: false, reason: 'no-direct-report-attention', mutationPerformed: false };
  }
  const kind = staleWork === null ? 'manager-check-in' : 'manager-stale-work-review';
  const pending = controlPlane.readMessages({ recipient: plan.managerId, unacknowledgedOnly: true })
    .find((message) => message.kind === kind && message.sender === plan.managerId);
  if (pending) {
    return { ...plan, queued: false, reason: 'check-in-already-pending', messageId: pending.id, mutationPerformed: false };
  }
  const affected = [...new Set(plan.findings.map((finding) => finding.areaId))];
  const message = controlPlane.sendMessage({
    sender: plan.managerId, recipient: plan.managerId, kind,
    body: [
      `Scheduled TORCH check-in: review direct reports ${affected.join(', ')}.`,
      `Snapshot captured at ${plan.at}; findings below are informational and may be stale when this message is read.`,
      `Findings: ${JSON.stringify(plan.findings)}.`,
      `Structured approval waits: ${JSON.stringify(plan.approvalWaits)}.`,
      ...(staleWork === null ? [] : [
        `Stale-work review: ${JSON.stringify(plan.staleWorkReview)}.`,
        `Refresh with torch_plan_manager_check_in ${JSON.stringify({ stale_work_review: true,
          stale_days: plan.staleWorkReview.staleDays, max_commits: plan.staleWorkReview.maxCommits,
          max_items: plan.staleWorkReview.maxItems })} before acting. Owner requests come first.`,
        'Review each item to revive, explicitly defer, resolve a dependency, or propose closure with evidence through the existing task system. Commit messages and age do not authorize closing, restarting, reassigning or approving work.',
      ]),
      'Before acting, call torch_plan_manager_check_in to refresh direct-report status and approval waits from current durable state. For each pending approval, verify its evidence and act only if you are the named approver. If the owner or a peer AI is named, route/escalate to that approver; do not decide on their behalf. Do not treat this check-in as approval.',
    ].join('\n'),
  });
  return { ...plan, queued: true, messageId: message.id, mutationPerformed: true };
}
