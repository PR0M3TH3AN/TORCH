import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createConsoleServer } from '../../src/console/server.mjs';
import { openControlPlane } from '../../src/control-plane/service.mjs';
import { analyzeRepository } from '../../src/kernel/analyze.mjs';
import { proposeDomains } from '../../src/kernel/domains.mjs';
import { inspectRepository } from '../../src/kernel/git.mjs';
import { installProject } from '../../src/kernel/install.mjs';
import { ScheduleLauncherService } from '../../src/schedules/launcher.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'torch-console-schedule-launcher-'));
  const env = {
    ...process.env,
    XDG_DATA_HOME: mkdtempSync(join(tmpdir(), 'torch-console-schedule-state-')),
    XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), 'torch-console-schedule-config-')),
  };
  execFileSync('git', ['init', '-b', 'main', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'torch-test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'TORCH Test']);
  writeFileSync(join(root, 'app.js'), 'export const app = true;\n');
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'fixture']);
  const repository = inspectRepository(root);
  const proposal = proposeDomains({ repository, analysis: analyzeRepository(repository) });
  proposal.schedules = [
    {
      id: 'manager-check-in', title: 'Session manager check-in', owner: 'session-manager',
      lifetime: 'system', trigger: { type: 'interval', seconds: 900 }, behavior: 'coordination',
      action: { type: 'manager-check-in', manager_id: 'session-manager' },
      required_authority: ['owner'], retry: { max_attempts: 1 },
      failure_recipient: 'session-manager', source_of_truth: 'active organization graph',
    },
    {
      id: 'authorized-integration-drain', title: 'Authorized integration drain', owner: 'owner',
      lifetime: 'system', trigger: { type: 'interval', seconds: 60 }, behavior: 'mutating',
      action: { type: 'integration-drain', landing_authority_id: 'session-manager', limit: 20 },
      required_authority: ['owner'], retry: { max_attempts: 1 },
      failure_recipient: 'session-manager', source_of_truth: 'owner-approved integration policy',
    },
  ];
  proposal.review = {
    status: 'approved', reviewedAt: '2026-09-28T00:00:00Z', reviewedBy: 'fixture-owner', notes: [],
  };
  installProject({ repository, proposal, env, projectId: 'console-schedule-fixture' });
  return { root, env };
}

async function request(origin, path, payload) {
  return fetch(`${origin}${path}`, {
    method: 'POST', headers: {
      origin, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin',
    }, body: JSON.stringify(payload),
  });
}

test('SCN-console-schedule-launcher: the owner reviews exact timer effects before a single audited install or refresh', async () => {
  const context = fixture();
  const systemdCalls = [];
  const executor = (file, args) => {
    systemdCalls.push({ file, args });
    return { status: 0, stdout: '', stderr: '' };
  };
  const server = createConsoleServer({
    repositoryRoot: context.root, env: context.env, scheduleLauncherExecutor: executor,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const initial = await fetch(`${origin}/api/snapshot`);
    const initialSnapshot = await initial.json();
    assert.equal(initialSnapshot.scheduleLauncher.installed, false);
    const unitDirectory = join(context.env.XDG_CONFIG_HOME, 'systemd', 'user');
    assert.equal(existsSync(unitDirectory), false);

    const crossOrigin = await fetch(`${origin}/api/schedule-launcher/preview`, {
      method: 'POST', headers: { origin: 'https://untrusted.example', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'install' }),
    });
    assert.equal(crossOrigin.status, 403);
    assert.deepEqual(systemdCalls, []);

    const firstPreviewResponse = await request(origin, '/api/schedule-launcher/preview', { action: 'install' });
    assert.equal(firstPreviewResponse.status, 200);
    const firstPreview = await firstPreviewResponse.json();
    assert.equal(firstPreview.plan.canProceed, true);
    assert.equal(firstPreview.plan.mutationPerformed, false);
    assert.equal(firstPreview.plan.systemSchedules.length, 2);
    assert.equal(firstPreview.plan.systemSchedules.find((schedule) => schedule.id === 'authorized-integration-drain').behavior, 'mutating');
    assert.deepEqual(firstPreview.plan.files.map((file) => file.name), [
      firstPreview.plan.serviceName, firstPreview.plan.timerName,
    ]);
    assert.match(firstPreview.plan.effect, /enables and starts the timer/);
    assert.equal(existsSync(unitDirectory), false, 'preview must not create unit files');
    assert.deepEqual(systemdCalls, [], 'preview must not call systemd');

    const configPath = join(context.root, '.torch', 'torch.yaml');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.schedules[0].title = 'Changed after preview';
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    const staleConfirmation = await request(origin, '/api/schedule-launcher', {
      action: 'install', token: firstPreview.token, planHash: firstPreview.planHash,
    });
    assert.equal(staleConfirmation.status, 409);
    assert.equal((await staleConfirmation.json()).error, 'SCHEDULE_LAUNCHER_PREVIEW_STALE');
    assert.deepEqual(systemdCalls, []);
    assert.equal(existsSync(unitDirectory), false);

    const previewResponse = await request(origin, '/api/schedule-launcher/preview', { action: 'install' });
    assert.equal(previewResponse.status, 200);
    const preview = await previewResponse.json();
    assert.equal(preview.plan.canProceed, true);
    const confirmationPayload = {
      action: 'install', token: preview.token, planHash: preview.planHash,
    };
    const confirmed = await request(origin, '/api/schedule-launcher', confirmationPayload);
    assert.equal(confirmed.status, 200);
    const result = await confirmed.json();
    assert.equal(result.mutationPerformed, true);
    assert.equal(result.auditEventId.length > 0, true);
    assert.deepEqual(systemdCalls.map((call) => call.args), [
      ['--user', 'daemon-reload'],
      ['--user', 'enable', '--now', preview.plan.timerName],
    ]);
    assert.equal(existsSync(join(unitDirectory, preview.plan.serviceName)), true);
    assert.equal(existsSync(join(unitDirectory, preview.plan.timerName)), true);

    const replay = await request(origin, '/api/schedule-launcher', confirmationPayload);
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).auditEventId, result.auditEventId);
    assert.equal(systemdCalls.length, 2, 'replay cannot repeat systemd mutation');
    const controlPlane = openControlPlane({ repositoryRoot: context.root, env: context.env });
    try {
      const audits = controlPlane.database.prepare(
        "SELECT * FROM audit_events WHERE operation = 'schedule.launcher.install'",
      ).all();
      assert.equal(audits.length, 1);
    } finally { controlPlane.close(); }

    const refreshed = await fetch(`${origin}/api/snapshot`);
    const snapshot = await refreshed.json();
    assert.equal(snapshot.scheduleLauncher.installed, true);
    assert.equal(snapshot.scheduleLauncher.stale, false);

    const updatedConfig = JSON.parse(readFileSync(configPath, 'utf8'));
    updatedConfig.schedules[0].title = 'Changed after installation';
    writeFileSync(configPath, `${JSON.stringify(updatedConfig, null, 2)}\n`);
    const reconcilePreviewResponse = await request(origin, '/api/schedule-launcher/preview', { action: 'reconcile' });
    assert.equal(reconcilePreviewResponse.status, 200);
    const reconcilePreview = await reconcilePreviewResponse.json();
    assert.equal(reconcilePreview.plan.canProceed, true);
    assert.equal(reconcilePreview.plan.stale, true);
    assert.equal(reconcilePreview.plan.updates.some((entry) => entry.changed), true);
    const reconcilePayload = {
      action: 'reconcile', token: reconcilePreview.token, planHash: reconcilePreview.planHash,
    };
    const reconciled = await request(origin, '/api/schedule-launcher', reconcilePayload);
    assert.equal(reconciled.status, 200);
    assert.equal((await reconciled.json()).mutationPerformed, true);
    assert.equal(systemdCalls.length, 4);
    const reconcileReplay = await request(origin, '/api/schedule-launcher', reconcilePayload);
    assert.equal(reconcileReplay.status, 200);
    assert.equal(systemdCalls.length, 4, 'replayed refresh cannot repeat systemd mutation');
    const finalSnapshot = await fetch(`${origin}/api/snapshot`);
    assert.equal((await finalSnapshot.json()).scheduleLauncher.stale, false);
    const auditControl = openControlPlane({ repositoryRoot: context.root, env: context.env });
    try {
      const audits = auditControl.database.prepare(
        "SELECT operation FROM audit_events WHERE operation LIKE 'schedule.launcher.%' ORDER BY rowid",
      ).all();
      assert.deepEqual(audits.map((event) => event.operation), [
        'schedule.launcher.install', 'schedule.launcher.reconcile',
      ]);
    } finally { auditControl.close(); }
    assert.match(readFileSync(new URL('../../site/console.html', import.meta.url), 'utf8'), /data-schedule-launcher-confirm/);
    const consoleScript = readFileSync(new URL('../../site/console.js', import.meta.url), 'utf8');
    const consoleServer = readFileSync(new URL('../../src/console/server.mjs', import.meta.url), 'utf8');
    assert.match(consoleScript, /\/api\/schedule-launcher\/preview/);
    assert.match(consoleServer, /SCHEDULE_LAUNCHER_PREVIEW_STALE/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  const direct = new ScheduleLauncherService({
    repositoryRoot: context.root, env: context.env,
    executor: () => { throw new Error('expected-digest check must precede systemd'); },
  });
  assert.throws(() => direct.reconcile({ expectedDigest: 'out-of-date' }), (error) =>
    error.code === 'SCHEDULE_LAUNCHER_PLAN_STALE');
});
