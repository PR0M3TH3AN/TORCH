import { existsSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { TorchError } from './errors.mjs';
import { validateSpecificationEvidence } from './specifications.mjs';

const SOURCE_ROOTS = new Set(['src', 'app', 'apps', 'server', 'client', 'lib', 'packages', 'services']);
const IGNORED_ROOTS = new Set(['node_modules', 'dist', 'build', 'coverage', 'vendor', 'artifacts', 'reports']);
const SHARED_PATTERN = /(^|\/)(shared|common|types?|schemas?|contracts?|[^/]*config[^/]*)(\/|\.|$)/i;
const TEST_PATTERN = /(^|\/)(test|tests|spec|e2e)(\/|\.|$)/i;
const OPERATIONS_PATTERN = /(^|\/)(\.github|infra|ops|deploy|release|docker|systemd)(\/|\.|$)/i;
const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?|py|rs|go|java|c|cc|cpp|h|hpp|cs|rb|php|swift|kt)$/i;

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'core';
}

function componentKey(file) {
  const parts = file.split('/');
  const root = parts[0];
  if (IGNORED_ROOTS.has(root) || TEST_PATTERN.test(file) || OPERATIONS_PATTERN.test(file)) return null;
  if (!SOURCE_EXTENSION.test(file)) return null;
  if (parts.length === 1) return 'core';
  if (SOURCE_ROOTS.has(root) && parts.length > 2) return `${root}/${parts[1]}`;
  if (SOURCE_ROOTS.has(root)) return root;
  return root;
}

function friendlyTitle(key) {
  const leaf = key.split('/').at(-1);
  const known = {
    api: 'API', backend: 'Backend', server: 'Backend', client: 'Frontend', frontend: 'Frontend',
    web: 'Web interface', ui: 'User interface', core: 'Core systems', cli: 'Command-line interface',
    database: 'Data and persistence', db: 'Data and persistence', messaging: 'Messaging',
    runtime: 'Runtime adapters', runtimes: 'Runtime adapters', adapters: 'Provider adapters',
  };
  return known[leaf] ?? leaf.replace(/[-_]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function languageOf(file) {
  const ext = posix.extname(file).toLowerCase();
  if (['.js', '.mjs', '.cjs', '.jsx'].includes(ext)) return 'JavaScript';
  if (['.ts', '.tsx', '.mts', '.cts'].includes(ext)) return 'TypeScript';
  if (ext === '.py') return 'Python';
  if (ext === '.rs') return 'Rust';
  if (ext === '.go') return 'Go';
  return ext.slice(1).toUpperCase() || 'Unknown';
}

function resolveRelativeImport(fromFile, specifier, fileSet) {
  if (!specifier.startsWith('.')) return null;
  const base = posix.normalize(posix.join(posix.dirname(fromFile), specifier));
  const candidates = [
    base, `${base}.js`, `${base}.mjs`, `${base}.ts`, `${base}.tsx`, `${base}.py`,
    `${base}/index.js`, `${base}/index.ts`, `${base}/index.tsx`,
  ];
  return candidates.find((candidate) => fileSet.has(candidate)) ?? null;
}

function importSpecifiers(content) {
  const found = new Set();
  const patterns = [
    /\b(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
    /^\s*from\s+([.\w]+)\s+import\s+/gm,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content))) found.add(match[1]);
  }
  return [...found];
}

export function buildArchitectureGraph({ repository, files }) {
  const fileSet = new Set(files);
  const groups = new Map();
  for (const file of files) {
    const key = componentKey(file);
    if (!key) continue;
    const group = groups.get(key) ?? { key, files: [], languages: new Set() };
    group.files.push(file);
    group.languages.add(languageOf(file));
    groups.set(key, group);
  }

  const dependencies = [];
  for (const [key, group] of groups) {
    for (const file of group.files) {
      const absolute = `${repository.root}/${file}`;
      if (!existsSync(absolute)) continue;
      let content;
      try {
        content = readFileSync(absolute, 'utf8');
        if (content.length > 256_000) continue;
      } catch { continue; }
      for (const specifier of importSpecifiers(content)) {
        const targetFile = resolveRelativeImport(file, specifier, fileSet);
        if (!targetFile) continue;
        const target = componentKey(targetFile);
        if (target && target !== key && !dependencies.some((edge) => edge.from === key && edge.to === target)) {
          dependencies.push({ from: key, to: target, evidence: file, targetEvidence: targetFile });
        }
      }
    }
  }

  const components = [...groups.values()].map((group) => ({
    id: slug(group.key),
    key: group.key,
    title: friendlyTitle(group.key),
    paths: group.key === 'core'
      ? [...new Set(group.files.map((file) => `*${posix.extname(file)}`))].sort()
      : [SOURCE_ROOTS.has(group.key) ? `${group.key}/*` : `${group.key}/**`],
    fileCount: group.files.length,
    languages: [...group.languages].sort(),
    evidence: group.files.slice(0, 12),
    dependencies: dependencies.filter((edge) => edge.from === group.key).map((edge) => edge.to),
    consumers: dependencies.filter((edge) => edge.to === group.key).map((edge) => edge.from),
  })).sort((a, b) => a.key.localeCompare(b.key));

  return {
    components,
    dependencies,
    sharedSurfaces: files.filter((file) => SHARED_PATTERN.test(file)).slice(0, 200),
    verificationSurfaces: files.filter((file) => TEST_PATTERN.test(file)).slice(0, 200),
    operationalSurfaces: files.filter((file) => OPERATIONS_PATTERN.test(file)).slice(0, 200),
  };
}

function domainFromComponent(component) {
  return {
    id: component.id,
    title: component.title,
    kind: 'development',
    scope: [`implementation and maintenance under ${component.paths.join(', ')}`],
    not_scope: [],
    owned_paths: component.paths,
    shared_paths: [],
    neighbours: [],
    required_checks: [],
    runtime: 'claude',
    evidence: component.evidence,
  };
}

function words(value) {
  return new Set(value.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
}

function overlap(left, right) {
  const a = words(left);
  const b = words(right);
  return [...a].filter((word) => b.has(word)).length;
}

function specDomain(signal, specification) {
  return {
    id: signal.id,
    title: signal.title,
    kind: 'planning',
    scope: signal.responsibilities.length
      ? signal.responsibilities
      : [`responsibilities described by ${specification.path}:${signal.line}`],
    not_scope: [],
    owned_paths: signal.pathReferences,
    shared_paths: [], neighbours: [], required_checks: [], runtime: 'claude',
    evidence: [`${specification.path}:${signal.line}`],
    design_status: signal.pathReferences.length ? 'evidence-backed' : 'needs-owner-path-review',
  };
}

export function proposeDomains({ repository, analysis }) {
  const graph = analysis.architecture;
  const sourceComponents = graph.components.filter((component) => !SHARED_PATTERN.test(component.key));
  const specFirst = sourceComponents.length === 0;
  const selected = sourceComponents.filter((component) => component.fileCount >= 2);
  const basis = selected.length ? selected : sourceComponents.slice(0, 1);
  const domains = basis.map(domainFromComponent);
  const specifications = analysis.specifications ?? [];
  const signals = specifications.flatMap((specification) =>
    specification.domainSignals.map((signal) => ({ signal, specification })));

  for (const { signal, specification } of signals) {
    const candidate = domains
      .map((domain) => ({ domain, score: overlap(`${domain.id} ${domain.title} ${domain.owned_paths.join(' ')}`, `${signal.title} ${signal.pathReferences.join(' ')}`) }))
      .sort((a, b) => b.score - a.score)[0];
    if (candidate?.score > 0) {
      for (const responsibility of signal.responsibilities) {
        if (!candidate.domain.scope.includes(responsibility)) candidate.domain.scope.push(responsibility);
      }
      candidate.domain.evidence.push(`${specification.path}:${signal.line}`);
      continue;
    }
    if (signal.level <= 3 && (signal.pathReferences.length || specFirst)) {
      const proposed = specDomain(signal, specification);
      if (!domains.some((domain) => domain.id === proposed.id)) domains.push(proposed);
    }
  }
  if (!domains.length) {
    domains.push({
      id: 'core', title: 'Core project', kind: 'development',
      scope: ['initial project implementation and architecture'],
      not_scope: [], owned_paths: ['**'], shared_paths: [], neighbours: [], required_checks: [],
      runtime: 'claude',
      evidence: analysis.inventory.manifests,
    });
  }

  if (analysis.inventory.testFileCount >= 2) {
    domains.push({
      id: 'qa', title: 'Quality and integration', kind: 'cross-cutting',
      scope: ['scenario integrity', 'integration verification', 'cross-domain regression evidence'],
      not_scope: ['implementing domain features solely to make checks pass'],
      owned_paths: ['test/**', 'tests/**', 'e2e/**'], shared_paths: [], neighbours: [],
      required_checks: [], evidence: graph.verificationSurfaces.slice(0, 12),
      runtime: 'claude',
    });
  }
  if (graph.operationalSurfaces.some((path) => /deploy|release/i.test(path))) {
    domains.push({
      id: 'release', title: 'Release and operations', kind: 'cross-cutting',
      scope: ['release packaging', 'deployment adapters', 'operational automation'],
      not_scope: ['feature implementation', 'deployment without configured authority'],
      owned_paths: graph.operationalSurfaces.filter((path) => /deploy|release|workflow/i.test(path)).slice(0, 20),
      shared_paths: [], neighbours: [], required_checks: [],
      runtime: 'claude',
      evidence: graph.operationalSurfaces.slice(0, 12),
    });
  }

  const byKey = new Map(graph.components.map((component) => [component.key, component.id]));
  const collisions = [];
  const addCollision = (leftId, rightId, score, reason) => {
    if (!leftId || !rightId || leftId === rightId) return;
    const ids = [leftId, rightId].sort();
    let collision = collisions.find((item) => item.domains[0] === ids[0] && item.domains[1] === ids[1]);
    if (!collision) {
      collision = { domains: ids, score: 0, reasons: [], resolution: { strategy: 'session-manager-coordination', owner: null } };
      collisions.push(collision);
    }
    collision.score += score;
    collision.reasons.push(reason);
  };
  for (const edge of graph.dependencies) {
    const left = domains.find((domain) => domain.id === byKey.get(edge.from));
    const right = domains.find((domain) => domain.id === byKey.get(edge.to));
    if (left && right) {
      addCollision(left.id, right.id, 2, {
        type: 'dependency', from: edge.from, to: edge.to, evidence: edge.evidence,
      });
    }
  }

  const edgesByTarget = new Map();
  for (const edge of graph.dependencies) {
    if (!SHARED_PATTERN.test(edge.to)) continue;
    const list = edgesByTarget.get(edge.to) ?? [];
    list.push(edge);
    edgesByTarget.set(edge.to, list);
  }
  for (const [target, edges] of edgesByTarget) {
    const consumers = [...new Set(edges.map((edge) => byKey.get(edge.from)).filter((id) =>
      domains.some((domain) => domain.id === id)))];
    for (let index = 0; index < consumers.length; index += 1) {
      for (let other = index + 1; other < consumers.length; other += 1) {
        addCollision(consumers[index], consumers[other], 2, {
          type: 'shared-dependency', target,
          evidence: edges.filter((edge) => [consumers[index], consumers[other]].includes(byKey.get(edge.from)))
            .map((edge) => edge.evidence),
        });
      }
    }
  }

  const qa = domains.find((domain) => domain.id === 'qa');
  if (qa) {
    for (const domain of domains) {
      if (domain.id !== qa.id) addCollision(domain.id, qa.id, 1, {
        type: 'verification-boundary', evidence: qa.evidence,
      });
    }
  }

  for (const domain of domains) {
    const neighbors = new Set();
    for (const collision of collisions) {
      if (collision.domains.includes(domain.id)) {
        collision.domains.filter((id) => id !== domain.id).forEach((id) => neighbors.add(id));
      }
    }
    domain.neighbours = [...neighbors].sort();
    domain.not_scope.push(...domains
      .filter((other) => other.id !== domain.id && other.owned_paths.length)
      .map((other) => `${other.title} owns ${other.owned_paths.join(', ')}`));
    domain.shared_paths = graph.sharedSurfaces.slice(0, 40);
  }

  return {
    schema: 'torch.dev/domain-proposal/v1alpha1',
    generatedAt: new Date().toISOString(),
    repository: { root: repository.root, initialCommit: repository.initialCommit, head: repository.head },
    review: { status: 'pending', reviewedAt: null, reviewedBy: null, notes: [] },
    specifications: specifications.map((specification) => ({
      path: specification.path,
      sha256: specification.sha256,
      bytes: specification.bytes,
      title: specification.title,
    })),
    domains,
    collisions: collisions.sort((a, b) => b.score - a.score || a.domains.join(':').localeCompare(b.domains.join(':'))),
    checks: analysis.inventory.checks.map((check) => ({
      id: slug(check.name), title: check.name, command: 'npm', args: ['run', check.name],
      source: { type: 'package-script', command: check.command }, resources: [],
    })),
    resources: analysis.inventory.scarceResources.map((id) => ({
      id, capacity: 1, queue: 'fifo', max_hold_seconds: 3600,
    })),
    schedules: [],
    architecture: graph,
  };
}

export function validateApprovedProposal({ proposal, repository }) {
  const problems = [];
  if (proposal?.schema !== 'torch.dev/domain-proposal/v1alpha1') problems.push('unsupported proposal schema');
  if (proposal?.review?.status !== 'approved') problems.push('proposal review status is not approved');
  if (proposal?.repository?.initialCommit !== repository.initialCommit) problems.push('proposal belongs to a different Git history');
  if (proposal?.repository?.head !== repository.head) problems.push('proposal is stale because HEAD changed');
  if (!Array.isArray(proposal?.domains) || proposal.domains.length === 0) problems.push('proposal has no domains');
  problems.push(...validateSpecificationEvidence(proposal?.specifications ?? [], repository.root));
  const ids = new Set();
  for (const domain of proposal?.domains ?? []) {
    if (!domain.id || ids.has(domain.id)) problems.push(`invalid or duplicate domain id: ${domain.id ?? '<missing>'}`);
    ids.add(domain.id);
    if (!domain.scope?.length) problems.push(`domain ${domain.id} has no scope`);
    if (!Array.isArray(domain.not_scope)) problems.push(`domain ${domain.id} has no not_scope list`);
    if (!domain.owned_paths?.length) problems.push(`domain ${domain.id} has no owned paths`);
    if (domain.runtime !== undefined && (typeof domain.runtime !== 'string' || !domain.runtime.trim())) {
      problems.push(`domain ${domain.id} has an invalid runtime`);
    }
    if (domain.worktree_name !== undefined && domain.worktree_name !== null
      && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(domain.worktree_name)) {
      problems.push(`domain ${domain.id} has an invalid worktree_name`);
    }
    if (domain.branch !== undefined && domain.branch !== null
      && (typeof domain.branch !== 'string' || !domain.branch.trim())) {
      problems.push(`domain ${domain.id} has an invalid branch`);
    }
    if (domain.prompt_source) {
      const source = posix.normalize(domain.prompt_source.replaceAll('\\', '/'));
      if (source.startsWith('../') || source.startsWith('/') || !existsSync(`${repository.root}/${source}`)) {
        problems.push(`domain ${domain.id} prompt_source is missing or escapes the repository`);
      }
    }
  }
  if (proposal.common_prompt_source) {
    const source = posix.normalize(proposal.common_prompt_source.replaceAll('\\', '/'));
    if (source.startsWith('../') || source.startsWith('/') || !existsSync(`${repository.root}/${source}`)) {
      problems.push('common_prompt_source is missing or escapes the repository');
    }
  }
  for (const collision of proposal?.collisions ?? []) {
    if (!collision.resolution?.strategy) problems.push(`collision ${collision.domains?.join('/')} has no resolution`);
  }
  for (const schedule of proposal?.schedules ?? []) {
    if (!schedule.id || !['system', 'session'].includes(schedule.lifetime)
      || !['read-only', 'mutating'].includes(schedule.behavior)
      || !schedule.owner || !schedule.trigger || !schedule.action
      || !schedule.required_authority?.length || !schedule.source_of_truth) {
      problems.push(`schedule ${schedule.id ?? '<missing>'} is incomplete`);
    }
  }
  if (proposal?.session_manager?.worktree_name !== undefined
    && proposal.session_manager.worktree_name !== null
    && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(proposal.session_manager.worktree_name)) {
    problems.push('session_manager has an invalid worktree_name');
  }
  if (proposal?.session_manager?.prompt_source) {
    const source = posix.normalize(proposal.session_manager.prompt_source.replaceAll('\\', '/'));
    if (source.startsWith('../') || source.startsWith('/') || !existsSync(`${repository.root}/${source}`)) {
      problems.push('session_manager prompt_source is missing or escapes the repository');
    }
  }
  if (problems.length) {
    throw new TorchError('Domain proposal is not approved for installation', {
      code: 'PROPOSAL_NOT_APPROVED', details: problems,
    });
  }
  return proposal;
}
