import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { analyzeCombatrigFleet } from '../../src/importers/combatrig.mjs';
import { validateApprovedProposal } from '../../src/kernel/domains.mjs';
import { inspectRepository } from '../../src/kernel/git.mjs';
import { installProject } from '../../src/kernel/install.mjs';
import { planWorktrees } from '../../src/kernel/worktrees.mjs';

const CLI = new URL('../../bin/torch.mjs', import.meta.url).pathname;

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'torch-combatrig-import-'));
  execFileSync('git', ['init', '-b', 'main', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'torch-test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'TORCH Test']);
  mkdirSync(join(root, 'docs', 'agents', 'prompts'), { recursive: true });
  mkdirSync(join(root, 'docs', 'agents', 'backlog'), { recursive: true });
  mkdirSync(join(root, 'tools', 'test'), { recursive: true });
  const roster = { areas: [
    {
      id: 'ai-sessions', title: 'AI session management', worktree: 'FIXTURE-ai-sessions',
      branch: 'feat/ai-session-management', scope: 'dispatch and fleet health', neighbours: ['all'],
    },
    {
      id: 'terrain', title: 'Terrain', worktree: 'FIXTURE-terrain', branch: 'feat/terrain',
      scope: 'terrain compiler and world', neighbours: ['animation'],
    },
    {
      id: 'animation', title: 'Animation', worktree: 'FIXTURE-animation', branch: 'feat/animation',
      scope: 'animation systems', notScope: ['terrain generation'], ownedPaths: ['src/animation/**'],
      neighbours: ['terrain'],
    },
  ] };
  writeFileSync(join(root, 'docs', 'agents', 'roster.json'), `${JSON.stringify(roster, null, 2)}\n`);
  writeFileSync(join(root, 'docs', 'agents', 'prompts', 'COMMON.md'), '# Legacy common rules\n');
  for (const area of roster.areas) {
    writeFileSync(join(root, 'docs', 'agents', 'prompts', `${area.id}.md`), `# Legacy ${area.title}\n`);
  }
  writeFileSync(join(root, 'docs', 'agents', 'backlog', 'terr-1.json'), JSON.stringify({
    id: 'terr-1', area: 'terrain', status: 'assigned', title: 'Terrain task',
  }));
  writeFileSync(join(root, 'docs', 'agents', 'backlog', 'anim-1.json'), JSON.stringify({
    id: 'anim-1', area: 'animation', status: 'done', title: 'Animation task',
  }));
  writeFileSync(join(root, 'package.json'), `${JSON.stringify({
    name: 'combatrig-fixture', scripts: {
      'test:sessions': 'node sessions.mjs', build: 'node build.mjs', test: 'node all.mjs', 'test:terrain': 'node terrain.mjs',
    },
  }, null, 2)}\n`);
  writeFileSync(join(root, 'tools', 'test', 'serve.mjs'), 'export const GATE_SLOTS = Math.max(1, Number(process.env.CR_GATE_SLOTS) || 2);\n');
  writeFileSync(join(root, 'docs', 'agents', 'OPERATIONS.md'), 'Session-local schedules\n0 8,16 * * * tools/dev/release.sh\n');
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'legacy fleet fixture']);
  return root;
}

test('SCN-combatrig-import: legacy fleet evidence converts without mutation and blocks invented ownership', () => {
  const root = fixture();
  const repository = inspectRepository(root);
  const before = execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' });
  const proposal = analyzeCombatrigFleet({ repository });
  const after = execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' });
  assert.equal(after, before);
  assert.equal(proposal.review.status, 'pending');
  assert.equal(proposal.session_manager.legacy_id, 'ai-sessions');
  assert.deepEqual(proposal.domains.map((domain) => domain.id), ['terrain', 'animation']);
  assert.equal(proposal.resources[0].capacity, 2);
  assert.deepEqual(proposal.compatibility.backlog.byStatus, { done: 1, assigned: 1 });
  assert.equal(proposal.compatibility.schedules.every((schedule) => schedule.detected), true);
  assert.equal(proposal.compatibility.readyForApproval, false);
  assert.equal(proposal.compatibility.migrationGaps.some((gap) =>
    gap.areaId === 'terrain' && gap.field === 'owned_paths'), true);

  proposal.review = {
    status: 'approved', reviewedAt: '2026-09-27T00:00:00Z', reviewedBy: 'fixture-owner', notes: [],
  };
  assert.throws(
    () => validateApprovedProposal({ proposal, repository }),
    (error) => error.code === 'PROPOSAL_NOT_APPROVED' && error.details.includes('domain terrain has no owned paths'),
  );
  proposal.domains.find((domain) => domain.id === 'terrain').owned_paths = ['src/terrain/**'];
  proposal.domains.find((domain) => domain.id === 'terrain').not_scope = ['animation systems'];
  validateApprovedProposal({ proposal, repository });
  const stateRoot = mkdtempSync(join(tmpdir(), 'torch-combatrig-state-'));
  const installed = installProject({ repository, proposal, env: {
    ...process.env, XDG_DATA_HOME: stateRoot,
  }, projectId: 'combatrig-import-fixture' });
  const config = JSON.parse(readFileSync(join(root, '.torch', 'torch.yaml'), 'utf8'));
  assert.equal(config.paths.worktree_parent, '..');
  assert.equal(config.domains.find((domain) => domain.id === 'terrain').branch, 'feat/terrain');
  assert.equal(config.domains.find((domain) => domain.id === 'terrain').worktree_name, 'FIXTURE-terrain');
  assert.equal(readFileSync(join(root, '.torch', 'prompts', 'terrain.md'), 'utf8'), '# Legacy Terrain\n');
  const worktrees = planWorktrees({ repository: inspectRepository(root) });
  assert.equal(worktrees.actions.find((action) => action.area === 'terrain').path,
    join(dirname(root), 'FIXTURE-terrain'));
  assert.equal(installed.mutationPerformed, true);
});

test('SCN-cli-combatrig-import: public import command writes a review artifact and returns the blocking status', () => {
  const root = fixture();
  const output = join(mkdtempSync(join(tmpdir(), 'torch-combatrig-report-')), 'proposal.json');
  const before = execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' });
  const result = spawnSync(process.execPath, [CLI, 'import', 'combatrig', '--source', root, '--output', output, '--json'], {
    cwd: dirname(root), encoding: 'utf8',
  });
  assert.equal(result.status, 1, result.stderr || result.stdout);
  const response = JSON.parse(result.stdout);
  assert.equal(response.output, output);
  assert.equal(response.proposal.compatibility.readyForApproval, false);
  assert.equal(readFileSync(output, 'utf8').includes('combatrig-portable-fleet'), true);
  assert.equal(execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }), before);
});
