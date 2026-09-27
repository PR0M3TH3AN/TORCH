import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { TorchError } from '../kernel/errors.mjs';

function json(path, code) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch (error) {
    throw new TorchError(`Cannot read COMBATRIG fleet input: ${path}`, { code, details: error.message });
  }
}

function strings(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function listedWorktrees(root) {
  let output;
  try { output = execFileSync('git', ['-C', root, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' }); } catch {
    return [];
  }
  const records = [];
  let current = null;
  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      current = { path: line.slice(9), branch: null, head: null };
      records.push(current);
    } else if (current && line.startsWith('branch refs/heads/')) current.branch = line.slice(18);
    else if (current && line.startsWith('HEAD ')) current.head = line.slice(5);
  }
  return records;
}

function backlogInventory(root) {
  const directory = join(root, 'docs', 'agents', 'backlog');
  if (!existsSync(directory)) return { total: 0, byStatus: {}, invalid: [], examples: [] };
  const byStatus = {};
  const invalid = [];
  const examples = [];
  for (const name of readdirSync(directory).filter((entry) => entry.endsWith('.json')).sort()) {
    try {
      const item = json(join(directory, name), 'COMBATRIG_BACKLOG_INVALID');
      byStatus[item.status ?? 'unknown'] = (byStatus[item.status ?? 'unknown'] ?? 0) + 1;
      if (examples.length < 8) examples.push({ id: item.id ?? name.slice(0, -5), area: item.area ?? null, status: item.status ?? null });
    } catch { invalid.push(name); }
  }
  return { total: Object.values(byStatus).reduce((sum, count) => sum + count, 0), byStatus, invalid, examples };
}

function packageChecks(root) {
  const path = join(root, 'package.json');
  if (!existsSync(path)) return { selected: [], catalog: [] };
  const scripts = json(path, 'COMBATRIG_PACKAGE_INVALID').scripts ?? {};
  const catalog = Object.entries(scripts)
    .filter(([name]) => name === 'build' || name === 'test' || name.startsWith('test:') || name.startsWith('qa:'))
    .map(([name, command]) => ({ name, command }));
  const selectedNames = ['test:sessions', 'build', 'test'];
  const selected = selectedNames.filter((name) => scripts[name]).map((name) => ({
    id: name.replace(/[^a-z0-9]+/gi, '-').toLowerCase(), title: name,
    command: 'npm', args: ['run', name], source: { type: 'package-script', command: scripts[name] },
    resources: name === 'test' ? ['browser-renderer'] : [],
  }));
  return { selected, catalog };
}

function gateCapacity(root) {
  const path = join(root, 'tools', 'test', 'serve.mjs');
  if (!existsSync(path)) return 1;
  const match = readFileSync(path, 'utf8').match(/GATE_SLOTS[^\n]*\|\|\s*(\d+)/);
  return match ? Number(match[1]) : 1;
}

export function analyzeCombatrigFleet({ repository } = {}) {
  const root = repository?.root;
  if (!root) throw new TorchError('COMBATRIG import requires an inspected repository', { code: 'IMPORT_REPOSITORY_REQUIRED' });
  const rosterPath = join(root, 'docs', 'agents', 'roster.json');
  const commonPromptPath = join(root, 'docs', 'agents', 'prompts', 'COMMON.md');
  if (!existsSync(rosterPath) || !existsSync(commonPromptPath)) {
    throw new TorchError('Repository does not expose the COMBATRIG portable fleet layout', {
      code: 'COMBATRIG_FLEET_NOT_FOUND', details: { rosterPath, commonPromptPath },
    });
  }
  const legacyRoster = json(rosterPath, 'COMBATRIG_ROSTER_INVALID');
  const worktrees = listedWorktrees(root);
  const parent = dirname(root);
  const gaps = [];
  const idMap = new Map(legacyRoster.areas.map((area) => [
    area.id, area.id === 'ai-sessions' ? 'session-manager' : area.id,
  ]));
  const converted = legacyRoster.areas.map((area) => {
    const id = idMap.get(area.id);
    const promptSource = `docs/agents/prompts/${area.id}.md`;
    const worktreeName = typeof area.worktree === 'string' && area.worktree.trim() ? area.worktree.trim() : null;
    const branch = typeof area.branch === 'string' && area.branch.trim() ? area.branch.trim() : null;
    const expectedPath = worktreeName ? join(parent, worktreeName) : null;
    const live = worktrees.find((entry) => (expectedPath && entry.path === expectedPath) || (branch && entry.branch === branch));
    const ownedPaths = strings(area.ownedPaths ?? area.owned_paths);
    const notScope = strings(area.notScope ?? area.not_scope);
    if (!worktreeName) gaps.push({ areaId: id, field: 'worktree_name', severity: 'blocking', reason: 'legacy roster has no worktree name' });
    if (!branch) gaps.push({ areaId: id, field: 'branch', severity: 'blocking', reason: 'legacy roster has no branch' });
    if (!ownedPaths.length) gaps.push({ areaId: id, field: 'owned_paths', severity: 'blocking', reason: 'legacy roster is prose-only' });
    if (!notScope.length) gaps.push({ areaId: id, field: 'not_scope', severity: 'blocking', reason: 'legacy roster has no explicit exclusion' });
    if (!existsSync(join(root, promptSource))) gaps.push({ areaId: id, field: 'prompt_source', severity: 'blocking', reason: 'prompt file missing' });
    return {
      legacy_id: area.id, id, title: area.title, kind: id === 'session-manager' ? 'manager' : 'development',
      scope: strings(area.scope), not_scope: notScope, owned_paths: ownedPaths,
      shared_paths: strings(area.sharedPaths ?? area.shared_paths),
      neighbours: strings(area.neighbours).map((neighbour) => idMap.get(neighbour) ?? neighbour),
      required_checks: ['test-sessions'], runtime: area.runtime ?? 'claude', branch,
      worktree_name: worktreeName, prompt_source: promptSource,
      prompt_sha256: existsSync(join(root, promptSource)) ? sha256(join(root, promptSource)) : null,
      evidence: [relative(root, rosterPath), promptSource],
      legacy_notes: area.notes ?? null,
      worktree_status: live
        ? { state: live.path === expectedPath && live.branch === branch ? 'matched' : 'mismatch', expectedPath, ...live }
        : { state: 'missing', expectedPath, branch },
    };
  });
  const manager = converted.find((area) => area.id === 'session-manager');
  const domains = converted.filter((area) => area.id !== 'session-manager');
  const collisionMap = new Map();
  for (const domain of domains) {
    for (const neighbour of domain.neighbours.filter((id) => id !== 'all' && id !== 'session-manager')) {
      if (!domains.some((candidate) => candidate.id === neighbour)) continue;
      const pair = [domain.id, neighbour].sort();
      collisionMap.set(pair.join(':'), {
        domains: pair, score: 1,
        reasons: [{ type: 'legacy-neighbour', evidence: 'docs/agents/roster.json' }],
        resolution: { strategy: 'session-manager-coordination', owner: null },
      });
    }
  }
  const checks = packageChecks(root);
  const operationsPath = join(root, 'docs', 'agents', 'OPERATIONS.md');
  const operations = existsSync(operationsPath) ? readFileSync(operationsPath, 'utf8') : '';
  return {
    schema: 'torch.dev/domain-proposal/v1alpha1',
    generatedAt: new Date().toISOString(),
    repository: { root, initialCommit: repository.initialCommit, head: repository.head },
    review: {
      status: 'pending', reviewedAt: null, reviewedBy: null,
      notes: ['Imported from COMBATRIG portable fleet. Resolve every blocking migration gap before approval.'],
    },
    paths: { worktree_parent: '..' },
    common_prompt_source: 'docs/agents/prompts/COMMON.md',
    common_prompt_sha256: sha256(commonPromptPath),
    session_manager: manager ? {
      legacy_id: manager.legacy_id, runtime: manager.runtime, branch: manager.branch,
      worktree_name: manager.worktree_name, prompt_source: manager.prompt_source,
      prompt_sha256: manager.prompt_sha256,
    } : null,
    domains,
    collisions: [...collisionMap.values()].sort((a, b) => a.domains.join(':').localeCompare(b.domains.join(':'))),
    checks: checks.selected,
    resources: [{
      id: 'browser-renderer', capacity: gateCapacity(root), queue: 'fifo', max_hold_seconds: 10800,
      evidence: 'tools/test/serve.mjs',
    }],
    architecture: { components: [], dependencies: [], sharedSurfaces: [], verificationSurfaces: [], operationalSurfaces: [] },
    compatibility: {
      source: 'combatrig-portable-fleet', sourceRoster: 'docs/agents/roster.json',
      areas: { total: converted.length, domains: domains.length, managerLegacyId: manager?.legacy_id ?? null },
      backlog: backlogInventory(root),
      checkCatalog: checks.catalog,
      schedules: [
        { id: 'release', lifetime: 'system', authority: 'owner', expression: '0 8,16 * * *', command: 'tools/dev/release.sh', detected: operations.includes('0 8,16 * * *') },
        { id: 'dispatcher-hygiene', lifetime: 'session', authority: 'session-manager', detected: operations.includes('Session-local schedules') },
      ],
      release: { provider: 'custom-command', authority: 'owner', command: 'tools/dev/release.sh' },
      worktrees: converted.map((area) => ({ areaId: area.id, ...area.worktree_status })),
      migrationGaps: gaps,
      readyForApproval: gaps.every((gap) => gap.severity !== 'blocking'),
    },
  };
}
