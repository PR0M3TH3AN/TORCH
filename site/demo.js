// Demo transport for the real Console. State and actions remain in this tab.
(() => {
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const canonical = (value) => JSON.stringify(Object.keys(value).sort().map((key) => [key, value[key]]));
  function createWorkspace({ clock = () => new Date() } = {}) {
    const timestamp = () => clock().toISOString();
    const head = '91c4e2a70000000000000000000000000000000000';
    const profiles = [
      { name: 'codex', title: 'Codex', available: true, model: 'gpt-6-luna', reasoning: 'high' },
      { name: 'claude', title: 'Claude', available: true, model: 'sonnet', reasoning: null },
      { name: 'pi', title: 'Pi', available: true, model: null, reasoning: null },
    ];
    const titles = {
      'session-manager': 'Fleet Operations', 'program-director': 'Program Director',
      interface: 'Interface', services: 'Services', qa: 'Quality', documentation: 'Documentation',
    };
    let state;
    let sequence;
    const previews = new Map();
    const preferences = new Map();
    function reset() {
      sequence = 0;
      previews.clear();
      preferences.clear();
      const summaries = ['Routing handoffs and watching Fleet health', 'Sequencing the first public beta',
        'Waiting for your review of the project home', 'Building the project activity API',
        'Verifying the latest integration', 'Setup guide ready for peer review'];
      const agents = Object.entries(titles).map(([areaId, title], index) => ({
        areaId, title, runtime: index === 3 ? 'claude' : index === 5 ? 'pi' : 'codex',
        model: index === 3 ? 'sonnet' : index === 5 ? null : 'gpt-6-luna',
        reasoning: index === 3 || index === 5 ? null : 'high',
        state: index === 2 ? 'waiting' : index === 5 ? 'idle' : 'working',
        summary: summaries[index], heartbeatAt: timestamp(),
      }));
      const task = (id, title, owner, taskState, feature, priority = 'normal') => ({
        id, title, owner, state: taskState, feature, priority, milestone: 'Public beta', revision: 1,
        affectedDomains: [owner], dependencies: [], observedAt: head,
        description: title + '. Record review evidence against the implementation commit.',
        acceptanceCriteria: ['Verify behavior with project checks', 'Record evidence for the owner'],
      });
      const backlog = [
        task('APP-12', 'Review the project home', 'interface', 'blocked', 'Project workspace', 'high'),
        task('API-08', 'Build the activity feed', 'services', 'in_progress', 'Project workspace', 'high'),
        task('QA-06', 'Verify offline recovery', 'qa', 'verification', 'Reliability'),
        task('DOC-04', 'Write the installation guide', 'documentation', 'ready', 'Onboarding'),
        task('APP-14', 'Keyboard navigation for the work board', 'interface', 'ready', 'Project workspace'),
        task('API-05', 'Persist owner review notes', 'services', 'completed', 'Project workspace'),
        task('QA-03', 'Test interrupted session recovery', 'qa', 'completed', 'Reliability'),
        task('DOC-02', 'Document the quick start', 'documentation', 'completed', 'Onboarding'),
      ];
      const domains = agents.slice(2).map((agent) => ({
        id: agent.areaId, title: agent.title,
        owned_paths: [agent.areaId === 'interface' ? 'site/**' : agent.areaId + '/**'],
        neighbours: ['interface', 'services', 'qa'].filter((id) => id !== agent.areaId),
      }));
      state = {
        schema: 'torch.dev/snapshot/v1alpha1', mode: 'installed', generatedAt: timestamp(),
        project: { id: 'torch-demo-northstar', name: 'Northstar' },
        repository: { name: 'Northstar', branch: 'main', head, dirty: false },
        doctor: { healthy: true, findings: [] }, recoverability: { level: 'Recorded' },
        contextLocality: { measured: false, reason: 'Cache savings need a measured comparison.' },
        agents, runtimeAdapters: profiles, backlog, backlogHealth: { findings: [] },
        managerCheckIns: { available: true, managers: [{
          managerId: 'program-director', title: 'Program Director', state: 'working',
          attentionRequired: true, cadence: { type: 'interval', seconds: 900 }, findings: [],
          directReports: agents.slice(2).map((agent) => ({
            ...agent, task: backlog.find((item) => item.owner === agent.areaId)?.id,
          })), approvalWaits: [{ requester: 'interface', approver: 'owner' }],
        }] },
        approvalRequests: { available: true, pendingCount: 1, items: [{
          id: 'review-home', revision: 1, requester: 'interface', approver: 'owner', status: 'pending',
          title: 'Choose the project home layout', task: 'APP-12', evidence: 'home-wireframe',
          summary: 'The proposed home puts your active work and review requests first. Is this the direction you want?',
          createdAt: timestamp(),
        }] },
        organization: { domains, graph: { revision: 1, roles: [
          { id: 'owner', identity_id: 'owner', title: 'Project owner', kind: 'owner', responsibilities: ['Product direction and final acceptance'] },
          ...agents.map((agent) => ({
            id: agent.areaId, identity_id: agent.areaId, title: agent.title,
            kind: agent.areaId === 'session-manager' ? 'fleet-operations'
              : agent.areaId === 'program-director' ? 'program-director' : 'specialist',
            reports_to: [agent.areaId === 'program-director' || agent.areaId === 'session-manager' ? 'owner' : 'program-director'],
            consults_with: domains.filter((domain) => domain.id !== agent.areaId).map((domain) => domain.id),
            responsibilities: [agent.summary], authority: ['Assigned role responsibilities'],
          })),
        ],
          implementation_owners: domains.map((domain) => ({ identity_id: domain.id, surface: domain.owned_paths[0] })),
        }, lifecycle: {
          startupOrder: agents.map((agent) => agent.areaId),
          shutdownOrder: agents.map((agent) => agent.areaId).reverse(), blockers: [],
          managerIdsByIdentity: Object.fromEntries(domains.map((domain) => [domain.id, ['program-director']])),
        } },
        messages: { unacknowledged: 1, recent: [
          { id: 'message-1', sender: 'interface', recipient: 'services', body: 'Can the activity API include task links? The home view can then take the owner directly to the work needing review.', acknowledgedBy: ['services'], createdAt: timestamp() },
          { id: 'message-2', sender: 'services', recipient: 'interface', body: 'Yes. The contract now includes taskId and evidenceId. I have sent the examples to Quality as well.', acknowledgedBy: ['interface'], createdAt: timestamp() },
          { id: 'message-3', sender: 'qa', recipient: 'program-director', body: 'Offline recovery checks passed. The integration receipt is ready; owner acceptance is still open.', acknowledgedBy: [], createdAt: timestamp() },
        ] },
        backlogActivity: { available: true, complete: true, generatedAt: timestamp(), staleDays: 3, scannedCommits: 12,
          tasks: [{ taskId: 'APP-12', title: 'Project home owner review', status: 'stale', ageDays: 4,
            ownerRequested: true, expectedWaiting: true, closureIntent: [] }] },
        checks: { prepared: [{ id: 'sample-frozen-browser', checkId: 'browser-review', areaId: 'qa', state: 'running', createdAt: timestamp(),
          snapshot: { commit: head, digest: 'sample-input-digest', copyStrategy: 'reflink-or-independent-copy' } },
          { id: 'sample-abandoned-browser', checkId: 'interrupted-browser', areaId: 'qa', state: 'abandoned', createdAt: timestamp(),
            snapshot: { commit: head, digest: 'sample-abandoned-input-digest', copyStrategy: 'reflink-or-independent-copy' },
            recovery: { recordedAt: timestamp(), cleanupStatus: 'pending', cleanupReason: 'CHECK_SNAPSHOT_INVALID', stoppedExecutors: 'owner-attested' } }], receipts: [
          { checkId: 'unit-tests', areaId: 'services', commit: head, result: 'passed' },
          { checkId: 'recovery-scenario', areaId: 'qa', commit: head, result: 'passed',
            snapshot: { commit: head, digest: 'sample-input-digest', copyStrategy: 'reflink-or-independent-copy' },
            conditions: { before: { valid: true, report: { conditions: { visible: true, clockMoving: true } } },
              after: { valid: true, report: { conditions: { visible: true, clockMoving: true } } } } },
        ] },
        artifacts: { available: true, items: [{
          id: 'home-wireframe', title: 'Project home · layout proposal', url: '/demo-artifact.svg',
          alt: 'Illustrative project home wireframe with active work and review requests',
          taskId: 'APP-12', identityId: 'interface', commit: head, integrity: 'available', createdAt: timestamp(),
          feedback: [{ body: 'Keep the work needing my decision easy to find.', recipient: 'interface', createdAt: timestamp() }],
        }] },
        integration: [{ queueOrder: 1, sourceArea: 'services', sourceCommit: head, state: 'authorized',
          authorizedBy: 'session-manager', reason: 'Exact-commit checks passed; awaiting serialized landing.' }],
        deliveries: [{ label: 'Public beta', sourceArea: 'program-director', commit: head, state: 'Awaiting owner acceptance' }],
        canonicalFetches: [{ id: 'sample-fetch', remote: 'origin', branch: 'main', commit: head, state: 'succeeded', updatedAt: timestamp(),
          attempts: [{ ordinal: 1, state: 'failed', classification: 'transient-network' }, { ordinal: 2, state: 'succeeded', classification: 'verified-object-import' }] }],
        deliveryOperations: [{ id: 'sample-deploy', deliveryId: 'public-beta', commit: head, operation: 'deploy', provider: 'sample-adapter', state: 'unknown', updatedAt: timestamp() }],
        deliveryAttempts: [{ id: 'sample-attempt', operationId: 'sample-deploy', ordinal: 1, state: 'unknown',
          receiptSummary: { status: 'failed', classification: 'transient', effects: 'unknown', hasReference: false } }],
        deliveryEvidenceCoverage: 'Sample adapter-reported evidence, not live deployment verification.',
        fleetChanges: [{
          id: 'release-specialist', title: 'Add a release specialist', changeType: 'create-domain',
          domainId: 'release', proposer: 'session-manager', state: 'proposed', baseCommit: head,
          rationale: 'Packaging and release work has become a recurring shared responsibility.',
          expectedBenefit: 'Give the beta packaging pipeline one accountable specialist.',
          evidence: ['DOC-04', 'QA-06'], revision: 1,
        }], hierarchyProposals: [{
          id: 'sample-coordination-pilot', state: 'piloting', proposer: 'session-manager',
          proposal: { title: 'Coordination pilot', rationale: 'Test whether a domain lead reduces recurring integration waits.' },
          pilotReviews: [{ id: 'sample-pilot-review', reviewedAt: '2026-09-29T11:00:00Z',
            recommendation: 'inconclusive', summary: 'Waits appear shorter, but the current evidence is qualitative.',
            window: { complete: false }, activationCommit: head, evidenceVerification: 'reviewer-reported',
            comparisons: [{ name: 'Cross-domain wait', unit: 'days median', baseline: '3', observed: 'About 2',
              classification: 'qualitative', evidence: ['Sample coordination notes'] }],
            success: [{ criterion: 'Reduce cross-domain waiting.', outcome: 'unknown', evidence: ['Sample coordination notes'] }],
            stop: [{ criterion: 'Management delays direct collaboration.', outcome: 'not-met', evidence: ['Sample peer handoffs'] }],
          }],
        }],
        worktrees: domains.map((domain) => ({ area: domain.id, branch: 'torch/' + domain.id,
          path: '/sample-workspaces/northstar-' + domain.id, ahead: domain.id === 'services' ? 2 : 0, behind: 0 })),
        resources: { holders: [{ resourceId: 'browser-check', areaId: 'qa' }], waiters: [] },
        schedules: [], scheduleLauncher: { installed: false },
        managerWakes: { available: true, blockingCount: 1, limit: 100, reservations: [{
          id: 'sample-wake-01', managerId: 'session-manager', scheduleId: 'manager-check-in',
          messageId: 'sample-check-in-01', budgetDay: '2026-09-29',
          reservedAt: '2026-09-29T10:00:00Z', outcome: 'reserved',
          blocksManagerWake: true, managerState: 'waiting', runtimeStoppedVerified: false,
        }] },
        providers: { forge: { provider: 'git', status: 'sample' },
          runtimes: profiles.map((profile) => ({ name: profile.name, configured: true })) },
        decisions: { content: 'Prioritize project visibility and recovery for the public beta. Keep specialist communication direct. Review new roles as recurring work emerges.' },
      };
      const section = (items) => ({ available: true, count: items.length, items, truncated: false });
      state.ownerDigest = { id: 'sample-owner-briefing', report: {
        schema: 'torch.dev/owner-digest/v1alpha1', generatedAt: timestamp(),
        window: { since: new Date(clock().getTime() - 86_400_000).toISOString(), until: timestamp(), hours: 24 },
        needsOwner: section([{ id: 'review-home', title: 'Choose the project home layout', requester: 'interface' }]),
        deliveryReview: section([]), lastDeployment: null, shipped: section([]),
        landed: section([{ sourceArea: 'services', commit: head }]),
        completed: section([{ taskId: 'API-05', title: 'Persist owner review notes' }]),
        decisions: section([]), blocked: section([{ taskId: 'APP-12', reason: 'Owner layout review requested' }]),
        neglectedRequests: section([]), activityCoverage: { complete: true },
        coverage: ['Sample publication, not a live project report.', 'Structured approval decisions only; source documents are not time-indexed.'],
      } };
    }
    function message(recipient, body, task = null) {
      const item = { id: 'demo-message-' + ++sequence, sender: 'owner', recipient, body, task,
        createdAt: timestamp(), acknowledgedBy: [] };
      state.messages.recent.unshift(item);
      state.messages.unacknowledged++;
      return item;
    }
    function operation(path, input) {
      const route = path.endsWith('/preview') ? path.slice(0, -8) : path;
      const taskId = route.match(/^\/api\/backlog\/tasks\/([^/]+)\/priority$/)?.[1];
      const approvalId = route.match(/^\/api\/approvals\/([^/]+)\/decision$/)?.[1];
      const artifactId = route.match(/^\/api\/artifacts\/([^/]+)\/feedback$/)?.[1];
      const proposalId = route.match(/^\/api\/organization-proposals\/fleet\/([^/]+)$/)?.[1];
      const conclusionId = route.match(/^\/api\/organization-proposals\/hierarchy-conclusion\/([^/]+)$/)?.[1];
      const requireItem = (items, id, key = 'id') => {
        const item = items.find((entry) => entry[key] === id);
        if (!item) throw new Error('That sample record no longer exists. Reset the demo to try again.');
        return item;
      };
      if (taskId) {
        const task = requireItem(state.backlog, taskId);
        if (!['urgent', 'high', 'normal', 'low'].includes(input.priority) || !input.reason?.trim()) throw new Error('Choose a priority and give a reason.');
        return { route, plan: { taskId, title: task.title, from: task.priority, to: input.priority,
          revision: task.revision, reason: input.reason, effect: 'Change this sample task’s priority.' },
        apply: () => { task.priority = input.priority; task.revision++; return { task }; } };
      }
      if (route === '/api/backlog/tasks') {
        if (!input.title?.trim() || !input.description?.trim()) throw new Error('Add a title and description.');
        const task = { ...clone(input), state: 'proposed', owner: null, observedAt: head, revision: 1,
          affectedDomains: input.affectedDomains ?? [], dependencies: input.dependencies ?? [], acceptanceCriteria: input.acceptanceCriteria ?? [] };
        return { route, plan: { task, authority: 'Owner proposal.', effect: 'Add an unassigned task to the sample backlog.' },
          apply: () => { task.id = 'OWNER-' + ++sequence; state.backlog.push(task); return { task }; } };
      }
      if (route === '/api/owner-requests') {
        const agent = requireItem(state.agents, input.recipient, 'areaId');
        if (!input.body?.trim()) throw new Error('Write a request first.');
        const task = input.taskId ? requireItem(state.backlog, input.taskId) : null;
        return { route, plan: { ...input, recipientTitle: agent.title, task, currentHead: head,
          effect: 'Add your request to this sample agent’s inbox.' },
        apply: () => ({ message: message(agent.areaId, input.body, input.taskId) }) };
      }
      if (artifactId) {
        const artifact = requireItem(state.artifacts.items, artifactId);
        if (!input.body?.trim()) throw new Error('Write your feedback first.');
        const feedback = { body: input.body, recipient: artifact.identityId, taskId: artifact.taskId, commit: artifact.commit };
        return { route, plan: feedback, feedback: true, apply: () => {
          const item = { ...feedback, createdAt: timestamp() }; artifact.feedback.push(item);
          message(item.recipient, item.body, item.taskId); return { feedback: item };
        } };
      }
      if (approvalId) {
        const approval = requireItem(state.approvalRequests.items, approvalId);
        if (approval.status !== 'pending' || !['approved', 'rejected'].includes(input.decision)) throw new Error('Choose a decision for a pending request.');
        return { route, plan: { ...clone(approval), ...input, approvalId, effect: 'Record your decision in the sample workspace.' }, apply: () => {
          approval.status = input.decision; approval.revision++; state.approvalRequests.pendingCount--;
          message(approval.requester, approval.title + ': ' + input.decision + '. ' + (input.note ?? ''), approval.task);
          state.managerCheckIns.managers[0].approvalWaits = [];
          return { approval };
        } };
      }
      if (route === '/api/runtime-profiles') {
        const agent = requireItem(state.agents, input.areaId, 'areaId');
        const adapter = requireItem(profiles, input.runtime, 'name');
        const profile = { areaId: agent.areaId, runtime: input.runtime,
          model: input.model || adapter.model, reasoning: input.reasoning || adapter.reasoning };
        return { route, plan: { beforeProfile: clone(agent), profile, currentHead: head,
          effect: 'Change this sample agent’s next-launch profile.', resetLaunchPolicy: agent.runtime !== input.runtime },
        apply: () => { Object.assign(agent, profile); return { profile }; } };
      }
      if (conclusionId) {
        const proposal = requireItem(state.hierarchyProposals, conclusionId);
        if (!['adopt', 'reverse'].includes(input.action) || !input.reason?.trim()) throw new Error('Choose a conclusion and explain your decision.');
        if (proposal.state !== 'piloting') throw new Error('This sample pilot is no longer active.');
        const blocked = input.action === 'adopt';
        const nextGraph = clone(state.organization.graph);
        if (!blocked) {
          nextGraph.revision++;
          for (const role of nextGraph.roles) {
            if (role.kind === 'specialist') role.reports_to = ['session-manager'];
          }
        }
        return { route, plan: { type: 'hierarchy-conclusion', id: proposal.id, action: input.action,
          title: proposal.proposal.title, reason: input.reason, currentState: proposal.state,
          currentHead: head, ownerIdentity: 'owner', canProceed: !blocked,
          confirmationLabel: blocked ? 'Commit pilot adoption' : 'Commit pilot reversal',
          effect: 'Change only this sample organization. No agent or timer is started or stopped.',
          scope: { nextGraph, activeWork: state.backlog.filter((task) => task.state !== 'completed'),
            schedulesRetained: true, blockers: blocked ? [{ type: 'adoption-review-required' }] : [] } },
        apply: () => { proposal.state = 'reversed'; state.organization.graph = nextGraph;
          return { type: 'hierarchy-conclusion', proposal, decision: input.action }; } };
      }
      if (proposalId) {
        const proposal = requireItem(state.fleetChanges, proposalId);
        if (!['approve', 'reject'].includes(input.action) || (input.action === 'reject' && !input.reason?.trim())) throw new Error('Choose a decision and explain any rejection.');
        return { route, plan: { proposalId, type: 'fleet', action: input.action, title: proposal.title,
          id: proposalId, reason: input.reason, currentState: proposal.state, currentHead: head,
          baseCommit: head, ownerIdentity: 'owner', proposalRevision: proposal.revision,
          confirmationLabel: input.action === 'approve' ? 'Approve for activation review' : 'Reject',
          effect: 'Record this sample proposal decision. Creation of the identity is a separate step.', proposal: clone(proposal) },
        apply: () => { proposal.state = input.action === 'approve' ? 'approved' : 'rejected';
          return { type: 'fleet', proposal, decision: input.action }; } };
      }
      throw new Error('This operation is unavailable in the demo workspace.');
    }
    async function request(path, payload) {
      const input = clone(payload);
      if (path.endsWith('/preview')) {
        const op = operation(path, input);
        if (op.plan.canProceed === false) return clone({ plan: op.plan, token: null, planHash: 'sample-blocked' });
        const token = 'demo-review-' + ++sequence;
        previews.set(token, { op, input, expiresAt: clock().getTime() + 300000 });
        return clone({ [op.feedback ? 'preview' : 'plan']: op.plan, token, planHash: token });
      }
      const record = previews.get(input.token);
      const { token, planHash, ...submitted } = input;
      if (!record || planHash !== token || clock().getTime() > record.expiresAt
        || path !== record.op.route || canonical(submitted) !== canonical(record.input)) {
        throw new Error('Review this demo action again before confirming it.');
      }
      if (!record.result) record.result = clone(record.op.apply());
      return clone(record.result);
    }
    reset();
    return { snapshot: () => { state.generatedAt = timestamp(); return clone(state); }, request, reset,
      storage: { getItem: (key) => preferences.get(key) ?? null, setItem: (key, value) => preferences.set(key, value) } };
  }
  globalThis.TorchDemo = { createWorkspace };
  if (globalThis.location && new URLSearchParams(globalThis.location.search).get('demo') === '1') {
    globalThis.TorchConsoleDemo = createWorkspace();
  }
})();
