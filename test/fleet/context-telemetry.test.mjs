import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openControlPlane } from '../../src/control-plane/service.mjs';
import { analyzeRepository } from '../../src/kernel/analyze.mjs';
import { proposeDomains } from '../../src/kernel/domains.mjs';
import { inspectRepository } from '../../src/kernel/git.mjs';
import { installProject } from '../../src/kernel/install.mjs';
import { callTorchTool } from '../../src/mcp/tools.mjs';
import { observeProject } from '../../src/observability/snapshot.mjs';
import { ContextTelemetryService } from '../../src/telemetry/context.mjs';

const CLI = new URL('../../bin/torch.mjs', import.meta.url).pathname;

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'torch-context-'));
  execFileSync('git', ['init', '-b', 'main', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'torch-test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'TORCH Test']);
  writeFileSync(join(root, 'app.js'), 'export const app = true;\n');
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'fixture']);
  const repository = inspectRepository(root);
  const proposal = proposeDomains({ repository, analysis: analyzeRepository(repository) });
  proposal.review = {
    status: 'approved', reviewedAt: '2026-09-27T00:00:00Z', reviewedBy: 'fixture-owner', notes: [],
  };
  const env = { ...process.env, XDG_DATA_HOME: mkdtempSync(join(tmpdir(), 'torch-context-state-')) };
  installProject({ repository, proposal, env, projectId: 'context-fixture' });
  return { root, env, worker: proposal.domains[0].id };
}

test('SCN-context-locality: usage evidence stays identity-bound, separates estimates, and prices verified outcomes', () => {
  const context = fixture();
  const recorded = spawnSync(process.execPath, [
    CLI, 'context', 'record', '--area', context.worker, '--source', 'provider-response',
    '--measurement', 'measured', '--runtime', 'codex', '--session', 'thread-1', '--task', 'TASK-1',
    '--cached-input', '800', '--uncached-input', '200', '--cache-read', '800',
    '--cost-microusd', '500000', '--verified-items', '2', '--json',
  ], { cwd: context.root, env: context.env, encoding: 'utf8' });
  assert.equal(recorded.status, 0, recorded.stderr || recorded.stdout);
  assert.equal(JSON.parse(recorded.stdout).measurement, 'measured');

  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  const telemetry = new ContextTelemetryService({
    controlPlane: control, idFactory: () => 'estimated-sample',
    clock: () => new Date('2026-09-27T01:00:00Z'),
  });
  const estimated = callTorchTool(control, 'torch_record_context_usage', {
    source: 'prompt-size-heuristic', measurement: 'estimated', cached_input: 100,
    uncached_input: 400, cost_microusd: 100000, verified_items: 0,
  }, { actorId: context.worker, contextTelemetryService: telemetry });
  assert.equal(estimated.areaId, context.worker);
  assert.throws(() => callTorchTool(control, 'torch_record_context_usage', {
    area_id: 'session-manager', source: 'forged', measurement: 'measured',
  }, { actorId: context.worker, contextTelemetryService: telemetry }),
  (error) => error.code === 'FLEET_IDENTITY_MISMATCH');

  const report = telemetry.report({ areaId: context.worker });
  assert.equal(report.measured, true);
  assert.equal(report.samples, 2);
  assert.deepEqual(report.groups.map((group) => group.measurement), ['estimated', 'measured']);
  const measured = report.groups.find((group) => group.measurement === 'measured');
  assert.equal(measured.cacheReadRatio, 0.8);
  assert.equal(measured.costPerVerifiedItemMicrousd, 250000);
  assert.match(report.warning, /no verified outcome/i);
  control.close();

  const snapshot = observeProject({ repositoryRoot: context.root, env: context.env });
  assert.equal(snapshot.contextLocality.measured, true);
  assert.deepEqual(snapshot.contextLocality.samples.map((sample) => sample.measurement), ['estimated', 'measured']);
});
