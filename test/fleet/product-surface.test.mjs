import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createConsoleServer } from '../../src/console/server.mjs';
import { analyzeRepository } from '../../src/kernel/analyze.mjs';
import { proposeDomains } from '../../src/kernel/domains.mjs';
import { inspectRepository } from '../../src/kernel/git.mjs';
import { installProject } from '../../src/kernel/install.mjs';
import { createWorktrees } from '../../src/kernel/worktrees.mjs';
import { observeProject } from '../../src/observability/snapshot.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'torch-console-'));
  execFileSync('git', ['init', '-b', 'main', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'torch-test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'TORCH Test']);
  writeFileSync(join(root, 'README.md'), '# Console fixture\n');
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'fixture']);
  return root;
}

test('SCN-product-site: public surface explains the portable fleet and separates the local console', () => {
  const html = readFileSync(new URL('../../site/index.html', import.meta.url), 'utf8');
  const consoleHtml = readFileSync(new URL('../../site/console.html', import.meta.url), 'utf8');
  assert.match(html, /One repository[\s\S]*coordinated AI engineering team/);
  assert.match(html, /id="route-toggle"/);
  assert.match(html, /Exact-commit checks/);
  assert.match(html, /Live gate open/);
  assert.match(html, /Context savings are a measured hypothesis/);
  assert.match(html, /torch bootstrap/);
  assert.doesNotMatch(html, /node bin\/torch\.mjs/);
  assert.match(html, /Isolated build \+ activation/);
  assert.match(html, /data-label="Evidence"/);
  assert.match(html, /manager can propose another specialist[\s\S]*owner approval/i);
  assert.doesNotMatch(html, /nostr|relay coordination|task lock/i);
  assert.match(consoleHtml, /Local Fleet Console/);
  assert.match(consoleHtml, /noindex,nofollow/);
  for (const label of ['Ownership', 'Worktrees', 'Delivery', 'Checks', 'Schedules', 'Providers', 'Decisions']) {
    assert.match(consoleHtml, new RegExp(`>${label}<`));
  }
});

test('SCN-architecture-decisions: every specification decision has an explicit accepted or gated boundary', () => {
  const decisions = readFileSync(new URL('../../docs/ARCHITECTURE_DECISIONS.md', import.meta.url), 'utf8');
  for (let number = 1; number <= 11; number += 1) {
    assert.match(decisions, new RegExp(`ADR-${String(number).padStart(3, '0')}:`));
  }
  assert.match(decisions, /Multi-machine security[\s\S]*\*\*Status:\*\* gated/);
  assert.match(decisions, /Distribution and update signing[\s\S]*\*\*Status:\*\* gated/);
  assert.match(decisions, /MCP over\s+stdio/);
  assert.match(decisions, /exact Git commit and the exact hash/);
  assert.match(decisions, /Project-specific coordination hierarchy[\s\S]*\*\*Status:\*\* gated/);
  assert.match(decisions, /headcount alone must never trigger an added management layer/);
  const spec = readFileSync(new URL('../../docs/PORTABLE_AGENT_FLEET_SPEC.md', import.meta.url), 'utf8');
  assert.match(spec, /Optional coordination hierarchy/);
  assert.match(spec, /existing single backlog remains the task ledger and queue/);
  assert.match(spec, /COMBATRIG example, not a default organization/);
});

test('SCN-console-readonly: HTTP console serves fixed assets and observes an installed fleet without mutation', async (context) => {
  const root = fixture();
  const env = { ...process.env, XDG_DATA_HOME: mkdtempSync(join(tmpdir(), 'torch-console-state-')) };
  const repository = inspectRepository(root);
  const proposal = proposeDomains({ repository, analysis: analyzeRepository(repository) });
  proposal.review = {
    status: 'approved', reviewedAt: '2026-09-27T00:00:00Z', reviewedBy: 'fixture-owner', notes: [],
  };
  installProject({ repository, proposal, env, projectId: 'console-fixture' });
  execFileSync('git', ['-C', root, 'add', '.torch']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'install torch']);
  createWorktrees({
    repository: inspectRepository(root),
    parentOverride: mkdtempSync(join(tmpdir(), 'torch-console-worktrees-')),
  });
  execFileSync('git', ['-C', root, 'add', '.torch/install-manifest.json']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'record worktrees']);
  const databasePath = join(env.XDG_DATA_HOME, 'torch', 'projects', 'console-fixture', 'state.db');
  assert.equal(existsSync(databasePath), false);
  const before = execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' });
  const observed = observeProject({ repositoryRoot: root, env, now: () => new Date('2026-09-27T00:00:00Z') });
  assert.equal(observed.mode, 'installed');
  assert.equal(observed.mutationPerformed, false);
  assert.equal(observed.agents.length, proposal.domains.length + 1);
  assert.equal(observed.organization.domains.length, proposal.domains.length);
  assert.equal(observed.worktrees.length, proposal.domains.length + 1);
  assert.equal(observed.worktrees.every((worktree) => Number.isInteger(worktree.behind)), true);
  assert.equal(observed.recoverability.level, 'ONE-DISK');
  assert.match(observed.decisions.content, /TORCH decisions/);
  assert.equal(observed.providers.forge.status, 'local-only');
  assert.equal(observed.providers.delivery.release.provider, 'none');
  assert.deepEqual(observed.deliveries, []);
  assert.equal(observed.contextLocality.measured, false);
  assert.deepEqual(observed.fleetChanges, []);
  assert.equal(existsSync(databasePath), false);
  assert.equal(execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }), before);

  const server = createConsoleServer({ repositoryRoot: root, env });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(`${origin}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(await page.text(), /coordinated AI engineering team/);
  const snapshot = await fetch(`${origin}/api/snapshot`);
  assert.equal(snapshot.status, 200);
  assert.equal((await snapshot.json()).mutationPerformed, false);
  assert.equal((await fetch(`${origin}/../package.json`)).status, 404);
  assert.equal(execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }), before);
});
