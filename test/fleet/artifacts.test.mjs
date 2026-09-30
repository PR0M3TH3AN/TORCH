import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import { ArtifactService, readPublishedArtifact } from '../../src/artifacts/service.mjs';
import { BacklogService } from '../../src/backlog/service.mjs';
import { createConsoleServer } from '../../src/console/server.mjs';
import { openControlPlane } from '../../src/control-plane/service.mjs';
import { observeProject } from '../../src/observability/snapshot.mjs';
import { analyzeRepository } from '../../src/kernel/analyze.mjs';
import { proposeDomains } from '../../src/kernel/domains.mjs';
import { inspectRepository } from '../../src/kernel/git.mjs';
import { installProject } from '../../src/kernel/install.mjs';
import { createWorktrees } from '../../src/kernel/worktrees.mjs';
import { callTorchTool } from '../../src/mcp/tools.mjs';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p6sAAAAASUVORK5CYII=',
  'base64',
);
const CLI = new URL('../../bin/torch.mjs', import.meta.url).pathname;

function installedFixture() {
  const root = mkdtempSync(join(tmpdir(), 'torch-artifact-'));
  execFileSync('git', ['init', '-b', 'main', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'torch-test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'TORCH Test']);
  writeFileSync(join(root, 'index.js'), 'export const ready = true;\n');
  writeFileSync(join(root, 'index.test.js'), 'export const scenario = true;\n');
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'fixture']);

  const repository = inspectRepository(root);
  const proposal = proposeDomains({ repository, analysis: analyzeRepository(repository) });
  proposal.review = {
    status: 'approved', reviewedAt: '2026-09-27T00:00:00Z', reviewedBy: 'fixture-owner', notes: [],
  };
  const env = { ...process.env, XDG_DATA_HOME: join(tmpdir(), `${basename(root)}-state`) };
  installProject({ repository, proposal, env, projectId: 'artifact-fixture' });
  execFileSync('git', ['-C', root, 'add', '.torch']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'install torch']);
  const created = createWorktrees({
    repository: inspectRepository(root), parentOverride: join(tmpdir(), `${basename(root)}-managed-worktrees`),
  });
  const controlPlane = openControlPlane({ repositoryRoot: root, env });
  const backlog = new BacklogService({ repositoryRoot: root, controlPlane });
  const worker = proposal.domains[0].id;
  const workerWorktree = created.created.find((entry) => entry.area === worker);
  const task = backlog.create({
    actorId: 'session-manager', title: 'Review image fixture', description: 'Publish a review image.',
    affectedDomains: [worker], acceptanceCriteria: ['The image has exact provenance.'],
  });
  const ready = backlog.transition({ taskId: task.id, actorId: 'session-manager', to: 'ready', expectedRevision: 1 });
  const assigned = backlog.transition({
    taskId: task.id, actorId: 'session-manager', to: 'assigned', expectedRevision: ready.revision, owner: worker,
  });
  backlog.transition({ taskId: task.id, actorId: worker, to: 'in_progress', expectedRevision: assigned.revision });
  writeFileSync(join(workerWorktree.path, 'review.png'), ONE_PIXEL_PNG);
  controlPlane.reportStatus({
    areaId: worker, state: 'working', runtime: 'fixture-runtime', runtimeSessionId: 'fixture-session', task: task.id,
  });
  const service = new ArtifactService({ repositoryRoot: root, controlPlane, backlogService: backlog });
  const commit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  return {
    root, env, controlPlane, backlog, worker, workerWorktree, task, service, commit,
    close: () => controlPlane.close(),
  };
}

test('SCN-artifact-review / SCN-console-priority-confirmation: evidence feedback and owner reprioritization require fresh confirmed previews', async (context) => {
  const fixture = installedFixture();
  context.after(() => fixture.close());
  const { service, backlog, worker, task, commit } = fixture;
  const beforeMessages = fixture.controlPlane.database.prepare('SELECT COUNT(*) AS count FROM messages').get().count;
  const published = spawnSync(process.execPath, [CLI, 'artifacts', 'publish',
    '--area', worker, '--task', task.id, '--title', 'Building approach',
    '--alt', 'A one-pixel test image.', '--file', 'review.png', '--commit', commit, '--json'], {
    cwd: fixture.root, env: fixture.env, encoding: 'utf8',
  });
  assert.equal(published.status, 0, published.stderr || published.stdout);
  const artifact = JSON.parse(published.stdout);
  assert.equal(artifact.taskId, task.id);
  assert.equal(artifact.identityId, worker);
  assert.equal(artifact.sessionId, 'fixture-session');
  assert.equal(artifact.commit, commit);
  assert.equal(existsSync(join(fixture.root, 'review.png')), false);
  assert.deepEqual(readPublishedArtifact({ repositoryRoot: fixture.root, env: fixture.env, id: artifact.id }).bytes,
    ONE_PIXEL_PNG);
  const mcpPublished = callTorchTool(fixture.controlPlane, 'torch_publish_artifact', {
    task_id: task.id, title: 'MCP publication', alt: 'A fixed fixture image.', file: 'review.png', commit,
  }, { actorId: worker, backlogService: fixture.backlog, artifactService: service });
  assert.equal(mcpPublished.identityId, worker);
  assert.throws(() => callTorchTool(fixture.controlPlane, 'torch_publish_artifact', {
    area_id: 'session-manager', task_id: task.id, title: 'Impersonated', alt: 'No', file: 'review.png', commit,
  }, { actorId: worker, backlogService: fixture.backlog, artifactService: service }),
  (error) => error.code === 'FLEET_IDENTITY_MISMATCH');

  const plan = service.planComment({ artifactId: artifact.id, body: 'Please add more contrast.', by: 'owner' });
  assert.equal(plan.mutationPerformed, false);
  assert.equal(plan.recipient, worker);
  assert.equal(fixture.controlPlane.database.prepare('SELECT COUNT(*) AS count FROM messages').get().count, beforeMessages);
  assert.throws(
    () => service.comment({ artifactId: artifact.id, body: 'Take over the project.', by: 'session-manager' }),
    (error) => error.code === 'OWNER_AUTHORITY_REQUIRED',
  );
  const preview = spawnSync(process.execPath, [CLI, 'artifacts', 'comment',
    '--artifact', artifact.id, '--body', 'Please add more contrast.', '--by', 'owner', '--json'], {
    cwd: fixture.root, env: fixture.env, encoding: 'utf8',
  });
  assert.equal(preview.status, 0, preview.stderr || preview.stdout);
  assert.equal(JSON.parse(preview.stdout).mutationPerformed, false);
  const comment = spawnSync(process.execPath, [CLI, 'artifacts', 'comment',
    '--artifact', artifact.id, '--body', 'Please add more contrast.', '--by', 'owner', '--yes', '--json'], {
    cwd: fixture.root, env: fixture.env, encoding: 'utf8',
  });
  assert.equal(comment.status, 0, comment.stderr || comment.stdout);
  const feedback = JSON.parse(comment.stdout);
  assert.equal(feedback.recipient, worker);
  const inbox = fixture.controlPlane.readMessages({ recipient: worker, unacknowledgedOnly: true });
  assert.equal(inbox.some((message) => message.id === feedback.id
    && message.references.task === task.id
    && message.references.commit === commit
    && message.references.path === `artifact:${artifact.id}`), true);
  assert.equal(fixture.controlPlane.readAudit().some((event) => event.actorId === 'owner'
    && event.operation === 'artifact.feedback' && event.entityId === artifact.id), true);

  const snapshot = observeProject({ repositoryRoot: fixture.root, env: fixture.env });
  const observed = snapshot.artifacts.items.find((item) => item.id === artifact.id);
  assert.equal(observed.integrity, 'available');
  assert.equal(observed.feedback[0].body, 'Please add more contrast.');

  const server = createConsoleServer({ repositoryRoot: fixture.root, env: fixture.env });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  try {
    const imageResponse = await fetch(`http://127.0.0.1:${port}${artifact.url}`);
    assert.equal(imageResponse.status, 200);
    assert.equal(imageResponse.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), ONE_PIXEL_PNG);
    const writeResponse = await fetch(`http://127.0.0.1:${port}/api/snapshot`, { method: 'POST' });
    assert.equal(writeResponse.status, 405);

    const origin = `http://127.0.0.1:${port}`;
    const feedbackUrl = `${origin}/api/artifacts/${artifact.id}/feedback`;
    const countMessages = () => fixture.controlPlane.database.prepare('SELECT COUNT(*) AS count FROM messages').get().count;
    const beforeDashboardFeedback = countMessages();
    const previewOptions = (body) => ({
      method: 'POST',
      headers: { origin, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({ body }),
    });
    const readOnly = await fetch(`${feedbackUrl}/preview`);
    assert.equal(readOnly.status, 405);
    const wrongContentType = await fetch(`${feedbackUrl}/preview`, {
      method: 'POST',
      headers: { origin, 'sec-fetch-site': 'same-origin' },
      body: 'body=untrusted',
    });
    assert.equal(wrongContentType.status, 415);
    const previewResponse = await fetch(`${feedbackUrl}/preview`, previewOptions('Reduce the glow on the sign.'));
    assert.equal(previewResponse.status, 200);
    const preview = await previewResponse.json();
    assert.equal(preview.preview.mutationPerformed, false);
    assert.equal(preview.preview.recipient, worker);
    assert.equal(preview.preview.taskId, task.id);
    assert.equal(preview.preview.commit, commit);
    assert.match(preview.token, /^[a-f0-9-]{36}$/i);
    assert.equal(countMessages(), beforeDashboardFeedback);

    const crossOrigin = await fetch(`${feedbackUrl}/preview`, {
      method: 'POST', headers: {
        origin: 'http://attacker.invalid', 'content-type': 'application/json',
        'sec-fetch-site': 'cross-site',
      }, body: JSON.stringify({ body: 'Cross-origin requests must not create owner actions.' }),
    });
    assert.equal(crossOrigin.status, 403);
    assert.equal((await crossOrigin.json()).error, 'SAME_ORIGIN_REQUIRED');
    assert.equal(countMessages(), beforeDashboardFeedback);

    const priorityUrl = `${origin}/api/backlog/tasks/${task.id}/priority`;
    const priorityOptions = (payload) => ({
      method: 'POST', headers: { origin, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify(payload),
    });
    const beforePriority = backlog.get(task.id);
    const priorityPlanResponse = await fetch(priorityUrl + '/preview', priorityOptions({
      priority: 'high', reason: 'The active review blocks the milestone.', expectedRevision: beforePriority.revision,
    }));
    assert.equal(priorityPlanResponse.status, 200);
    const priorityPlan = await priorityPlanResponse.json();
    assert.equal(priorityPlan.plan.mutationPerformed, false);
    assert.equal(priorityPlan.plan.from, 'normal');
    assert.equal(backlog.get(task.id).priority, 'normal', 'preview must not alter the task');
    const rejectedPriority = await fetch(priorityUrl + '/preview', {
      method: 'POST', headers: {
        origin: 'http://attacker.invalid', 'content-type': 'application/json', 'sec-fetch-site': 'cross-site',
      }, body: JSON.stringify({ priority: 'urgent', reason: 'Cross-origin owner action.', expectedRevision: beforePriority.revision }),
    });
    assert.equal(rejectedPriority.status, 403);
    assert.equal((await rejectedPriority.json()).error, 'SAME_ORIGIN_REQUIRED');
    assert.equal(backlog.get(task.id).priority, 'normal');
    backlog.setPriority({
      taskId: task.id, actorId: 'owner', expectedRevision: beforePriority.revision,
      priority: 'low', reason: 'Fixture creates a concurrent owner change.',
    });
    const stalePriority = await fetch(priorityUrl, priorityOptions({
      priority: 'high', reason: priorityPlan.plan.reason, expectedRevision: priorityPlan.plan.revision,
      token: priorityPlan.token, planHash: priorityPlan.planHash,
    }));
    assert.equal(stalePriority.status, 409);
    assert.equal((await stalePriority.json()).error, 'BACKLOG_REVISION_CONFLICT');
    const currentPriority = backlog.get(task.id);
    const refreshedPriorityResponse = await fetch(priorityUrl + '/preview', priorityOptions({
      priority: 'high', reason: 'The active review blocks the milestone.', expectedRevision: currentPriority.revision,
    }));
    const refreshedPriority = await refreshedPriorityResponse.json();
    const appliedPriority = await fetch(priorityUrl, priorityOptions({
      priority: refreshedPriority.plan.to, reason: refreshedPriority.plan.reason,
      expectedRevision: refreshedPriority.plan.revision,
      token: refreshedPriority.token, planHash: refreshedPriority.planHash,
    }));
    assert.equal(appliedPriority.status, 200);
    const appliedRecord = (await appliedPriority.json()).task;
    assert.equal(appliedRecord.priority, 'high');
    assert.equal(appliedRecord.state, beforePriority.state);
    assert.equal(appliedRecord.owner, beforePriority.owner);
    assert.deepEqual(appliedRecord.dependencies, beforePriority.dependencies);
    assert.deepEqual(appliedRecord.evidence, beforePriority.evidence);
    assert.equal(appliedRecord.revision, currentPriority.revision + 1);
    assert.equal(appliedRecord.priorityHistory.at(-1).to, 'high');
    const priorityReplay = await fetch(priorityUrl, priorityOptions({
      priority: refreshedPriority.plan.to, reason: refreshedPriority.plan.reason,
      expectedRevision: refreshedPriority.plan.revision,
      token: refreshedPriority.token, planHash: refreshedPriority.planHash,
    }));
    assert.equal(priorityReplay.status, 409);
    assert.equal((await priorityReplay.json()).error, 'PRIORITY_PREVIEW_EXPIRED');

    const stale = await fetch(feedbackUrl, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({ body: 'Edited after preview.', token: preview.token, planHash: preview.planHash }),
    });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).error, 'FEEDBACK_PREVIEW_STALE');
    assert.equal(countMessages(), beforeDashboardFeedback);

    const refreshedPreviewResponse = await fetch(`${feedbackUrl}/preview`, previewOptions('Reduce the glow on the sign.'));
    const refreshedPreview = await refreshedPreviewResponse.json();
    const sent = await fetch(feedbackUrl, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({
        body: refreshedPreview.preview.body,
        token: refreshedPreview.token,
        planHash: refreshedPreview.planHash,
      }),
    });
    assert.equal(sent.status, 200);
    const sentRecord = (await sent.json()).feedback;
    assert.equal(sentRecord.recipient, worker);
    assert.equal(sentRecord.taskId, task.id);
    assert.equal(sentRecord.commit, commit);
    assert.equal(fixture.controlPlane.readMessages({ recipient: worker, unacknowledgedOnly: true })
      .some((message) => message.id === sentRecord.id
        && message.references.task === task.id
        && message.references.path === `artifact:${artifact.id}`
        && message.references.commit === commit), true);
    assert.equal(countMessages(), beforeDashboardFeedback + 1);
    const replay = await fetch(feedbackUrl, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({
        body: refreshedPreview.preview.body,
        token: refreshedPreview.token,
        planHash: refreshedPreview.planHash,
      }),
    });
    assert.equal(replay.status, 409);
    assert.equal((await replay.json()).error, 'FEEDBACK_PREVIEW_EXPIRED');
    assert.equal(countMessages(), beforeDashboardFeedback + 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  const storedPath = join(fixture.controlPlane.stateRoot, 'artifacts', `${artifact.id}.png`);
  writeFileSync(storedPath, Buffer.from('tampered image'));
  assert.throws(
    () => readPublishedArtifact({ repositoryRoot: fixture.root, env: fixture.env, id: artifact.id }),
    (error) => error.code === 'ARTIFACT_INTEGRITY_FAILED',
  );
  assert.equal(readFileSync(storedPath).toString(), 'tampered image');
});

test('SCN-artifact-boundaries: unsupported provenance, task ownership, and symlink paths fail closed', (context) => {
  const fixture = installedFixture();
  context.after(() => fixture.close());
  const { service, worker, task, commit, workerWorktree } = fixture;
  assert.throws(
    () => service.publish({ areaId: worker, taskId: 'TASK-NOT-REAL', title: 'x', alt: 'x', file: 'review.png', commit }),
    (error) => error.code === 'BACKLOG_TASK_NOT_FOUND',
  );
  assert.throws(
    () => service.publish({ areaId: worker, taskId: task.id, title: 'x', alt: 'x', file: 'review.png', commit: commit.slice(0, 12) }),
    (error) => error.code === 'ARTIFACT_COMMIT_INVALID',
  );
  const outside = join(fixture.root, 'outside.png');
  writeFileSync(outside, ONE_PIXEL_PNG);
  symlinkSync(outside, join(workerWorktree.path, 'linked.png'));
  assert.throws(
    () => service.publish({ areaId: worker, taskId: task.id, title: 'x', alt: 'x', file: 'linked.png', commit }),
    (error) => error.code === 'ARTIFACT_PATH_INVALID',
  );
  assert.throws(
    () => service.publish({ areaId: worker, taskId: task.id, title: 'x', alt: 'x', file: '../outside.png', commit }),
    (error) => error.code === 'ARTIFACT_PATH_INVALID',
  );
});

test('SCN-console-task-create-confirmation: owner task creation previews routing and replays idempotently without dispatch', async (context) => {
  const fixture = installedFixture();
  context.after(() => fixture.close());
  const server = createConsoleServer({ repositoryRoot: fixture.root, env: fixture.env });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  const origin = `http://127.0.0.1:${port}`;
  const endpoint = `${origin}/api/backlog/tasks`;
  const options = (payload, requestOrigin = origin) => ({
    method: 'POST',
    headers: { origin: requestOrigin, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify(payload),
  });
  const input = {
    title: 'Add project-specific task proposal',
    description: 'Let the owner introduce work while preserving Session Manager triage.',
    priority: 'high', affectedDomains: [fixture.worker], dependencies: [],
    acceptanceCriteria: ['The task is proposed and unassigned.', 'No runtime launches.'],
    feature: 'Owner dashboard', milestone: '',
  };
  const before = fixture.backlog.list().length;
  const runtimeSessionBefore = fixture.controlPlane.identity(fixture.worker).runtimeSessionId;
  try {
    const rejectedOrigin = await fetch(`${endpoint}/preview`, options(input, 'http://attacker.invalid'));
    assert.equal(rejectedOrigin.status, 403);
    assert.equal(fixture.backlog.list().length, before);

    const previewResponse = await fetch(`${endpoint}/preview`, options(input));
    assert.equal(previewResponse.status, 200);
    const preview = await previewResponse.json();
    assert.equal(preview.plan.mutationPerformed, false);
    assert.equal(preview.plan.task.state, 'proposed');
    assert.equal(preview.plan.task.owner, null);
    assert.deepEqual(preview.plan.task.affectedDomains, [fixture.worker]);
    assert.equal(fixture.backlog.list().length, before);

    const stale = await fetch(endpoint, options({
      ...input, title: 'Changed after owner preview', token: preview.token, planHash: preview.planHash,
    }));
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).error, 'TASK_CREATE_PREVIEW_STALE');
    assert.equal(fixture.backlog.list().length, before);

    const freshResponse = await fetch(`${endpoint}/preview`, options(input));
    const fresh = await freshResponse.json();
    const confirmation = { ...input, token: fresh.token, planHash: fresh.planHash };
    const createdResponse = await fetch(endpoint, options(confirmation));
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    assert.equal(created.mutationPerformed, true);
    assert.equal(created.task.state, 'proposed');
    assert.equal(created.task.owner, null);
    assert.deepEqual(created.task.affectedDomains, [fixture.worker]);
    assert.equal(fixture.backlog.list().length, before + 1);
    assert.equal(fixture.controlPlane.readAudit().some((event) => event.actorId === 'owner'
      && event.operation === 'backlog.create' && event.entityId === created.task.id), true);

    const replay = await fetch(endpoint, options(confirmation));
    assert.equal(replay.status, 201);
    assert.equal((await replay.json()).task.id, created.task.id);
    assert.equal(fixture.backlog.list().length, before + 1);
    assert.equal(fixture.controlPlane.identity(fixture.worker).runtimeSessionId, runtimeSessionBefore);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('SCN-console-owner-agent-request: an owner request is previewed, durable, inbox-only, and idempotent', async (context) => {
  const fixture = installedFixture();
  context.after(() => fixture.close());
  const server = createConsoleServer({ repositoryRoot: fixture.root, env: fixture.env });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  const origin = `http://127.0.0.1:${port}`;
  const endpoint = `${origin}/api/owner-requests`;
  const options = (payload, requestOrigin = origin) => ({
    method: 'POST', headers: {
      origin: requestOrigin, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin',
    }, body: JSON.stringify(payload),
  });
  const body = 'Please inspect the exact-commit checks for this task and report whether the evidence is still current.';
  const backlogBefore = fixture.backlog.get(fixture.task.id);
  const identityBefore = fixture.controlPlane.identity(fixture.worker);
  const messageCount = () => fixture.controlPlane.database.prepare('SELECT COUNT(*) AS count FROM messages').get().count;
  const messagesBefore = messageCount();
  try {
    const crossOrigin = await fetch(`${endpoint}/preview`, options({ recipient: fixture.worker, taskId: fixture.task.id, body }, 'http://attacker.invalid'));
    assert.equal(crossOrigin.status, 403);
    assert.equal(messageCount(), messagesBefore);

    const previewResponse = await fetch(`${endpoint}/preview`, options({ recipient: fixture.worker, taskId: fixture.task.id, body }));
    assert.equal(previewResponse.status, 200);
    const preview = await previewResponse.json();
    assert.equal(preview.plan.mutationPerformed, false);
    assert.equal(preview.plan.owner, 'owner');
    assert.equal(preview.plan.recipient, fixture.worker);
    assert.equal(preview.plan.task.id, fixture.task.id);
    assert.equal(preview.plan.body, body);
    assert.match(preview.plan.effect, /does not create or change a task.*wake or start a session/);
    assert.equal(messageCount(), messagesBefore);

    const changedBody = await fetch(endpoint, options({
      recipient: fixture.worker, taskId: fixture.task.id, body: `${body} Changed after preview.`,
      token: preview.token, planHash: preview.planHash,
    }));
    assert.equal(changedBody.status, 409);
    assert.equal((await changedBody.json()).error, 'OWNER_REQUEST_PREVIEW_STALE');
    assert.equal(messageCount(), messagesBefore);

    writeFileSync(join(fixture.root, 'new-evidence.md'), '# Repository changed after preview\n');
    execFileSync('git', ['-C', fixture.root, 'add', 'new-evidence.md']);
    execFileSync('git', ['-C', fixture.root, 'commit', '-m', 'advance repository after owner preview']);
    const staleHead = await fetch(endpoint, options({
      recipient: fixture.worker, taskId: fixture.task.id, body, token: preview.token, planHash: preview.planHash,
    }));
    assert.equal(staleHead.status, 409);
    assert.equal((await staleHead.json()).error, 'OWNER_REQUEST_PREVIEW_STALE');

    const freshResponse = await fetch(`${endpoint}/preview`, options({ recipient: fixture.worker, taskId: fixture.task.id, body }));
    const fresh = await freshResponse.json();
    const confirmation = { recipient: fixture.worker, taskId: fixture.task.id, body, token: fresh.token, planHash: fresh.planHash };
    const sentResponse = await fetch(endpoint, options(confirmation));
    assert.equal(sentResponse.status, 201);
    const sent = await sentResponse.json();
    assert.equal(sent.mutationPerformed, true);
    assert.equal(sent.message.sender, 'owner');
    assert.equal(sent.message.recipient, fixture.worker);
    assert.equal(sent.message.body, body);
    assert.equal(sent.message.references.task, fixture.task.id);
    assert.equal(messageCount(), messagesBefore + 1);
    assert.equal(fixture.controlPlane.readMessages({ recipient: fixture.worker }).some((message) => message.id === sent.message.id), true);
    assert.equal(fixture.controlPlane.readAudit().some((event) => event.actorId === 'owner'
      && event.operation === 'agent.request' && event.entityId === sent.message.id), true);
    assert.deepEqual(fixture.backlog.get(fixture.task.id), backlogBefore);
    assert.deepEqual(fixture.controlPlane.identity(fixture.worker), identityBefore);

    const replay = await fetch(endpoint, options(confirmation));
    assert.equal(replay.status, 201);
    assert.equal((await replay.json()).message.id, sent.message.id);
    assert.equal(messageCount(), messagesBefore + 1);
    assert.throws(() => fixture.controlPlane.sendOwnerRequest({
      actorId: 'session-manager', recipient: fixture.worker, body,
    }), (error) => error.code === 'OWNER_AUTHORITY_REQUIRED');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
