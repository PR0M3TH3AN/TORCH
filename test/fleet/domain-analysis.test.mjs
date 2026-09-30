import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { analyzeRepository } from '../../src/kernel/analyze.mjs';
import { proposeDomains, validateApprovedProposal } from '../../src/kernel/domains.mjs';
import { inspectRepository } from '../../src/kernel/git.mjs';
import { inspectSpecifications } from '../../src/kernel/specifications.mjs';
import { createFleetDesignBrief } from '../../src/design/brief.mjs';
import { renderDomainPrompt } from '../../src/kernel/prompts.mjs';

function architectureFixture() {
  const root = mkdtempSync(join(tmpdir(), 'torch-domains-'));
  for (const dir of ['src/client', 'src/server', 'src/shared', 'test']) mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, 'src/shared/types.js'), 'export const protocol = 1;\n');
  writeFileSync(join(root, 'src/client/app.js'), "import { protocol } from '../shared/types.js';\nexport const client = protocol;\n");
  writeFileSync(join(root, 'src/client/view.js'), 'export const view = true;\n');
  writeFileSync(join(root, 'src/server/api.js'), "import { protocol } from '../shared/types.js';\nexport const api = protocol;\n");
  writeFileSync(join(root, 'src/server/store.js'), 'export const store = true;\n');
  writeFileSync(join(root, 'test/system.test.js'), 'export const scenario = true;\n');
  writeFileSync(join(root, 'test/contracts.test.js'), 'export const contracts = true;\n');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'split-app', scripts: { test: 'node --test' } }));
  execFileSync('git', ['init', '-b', 'main', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'torch-test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'TORCH Test']);
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'architecture fixture']);
  return root;
}

test('SCN-bootstrap-specialist-only: test-only and release-only repositories do not receive a conflicting catch-all owner', () => {
  for (const kind of ['qa', 'release', 'qa-and-release', 'empty']) {
    const root = mkdtempSync(join(tmpdir(), 'torch-specialist-only-'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: `specialist-${kind}` }));
    if (kind.includes('qa')) {
      mkdirSync(join(root, 'test'));
      for (const name of ['one', 'two']) writeFileSync(join(root, 'test', `${name}.test.js`), 'export const test = true;\n');
    }
    if (kind.includes('release')) {
      mkdirSync(join(root, 'deploy'));
      writeFileSync(join(root, 'deploy', 'release.sh'), '#!/bin/sh\nexit 0\n');
    }
    execFileSync('git', ['init', '-b', 'main', root]);
    execFileSync('git', ['-C', root, 'add', '.']);
    execFileSync('git', ['-C', root, '-c', 'user.name=TORCH Test', '-c', 'user.email=torch-test@example.invalid', 'commit', '-m', 'specialist-only evidence']);
    const repository = inspectRepository(root);
    const analysis = analyzeRepository(repository);
    const proposal = proposeDomains({ repository, analysis });
    const expected = kind === 'empty' ? ['core'] : kind === 'qa-and-release' ? ['qa', 'release'] : [kind];
    assert.deepEqual(proposal.domains.map((domain) => domain.id), expected);
    proposal.review = { status: 'approved', reviewedAt: '2026-09-30T00:00:00Z', reviewedBy: 'fixture-owner', notes: [] };
    validateApprovedProposal({ proposal, repository });
    assert.equal(execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }), '');
  }
});

test('SCN-domain-collision: shared contracts create evidence-linked neighboring domains', () => {
  const repository = inspectRepository(architectureFixture());
  const analysis = analyzeRepository(repository);
  const proposal = proposeDomains({ repository, analysis });
  const ids = proposal.domains.map((domain) => domain.id);

  assert.deepEqual(ids, ['src-client', 'src-server', 'qa']);
  assert.equal(analysis.architecture.dependencies.some((edge) =>
    edge.from === 'src/client' && edge.to === 'src/shared' && edge.evidence === 'src/client/app.js'), true);
  assert.equal(analysis.architecture.dependencies.some((edge) =>
    edge.from === 'src/server' && edge.to === 'src/shared' && edge.evidence === 'src/server/api.js'), true);
  assert.equal(analysis.architecture.sharedSurfaces.includes('src/shared/types.js'), true);

  const frontend = proposal.domains.find((domain) => domain.id === 'src-client');
  const backend = proposal.domains.find((domain) => domain.id === 'src-server');
  assert.deepEqual(frontend.shared_paths, ['src/shared/types.js']);
  assert.deepEqual(backend.shared_paths, ['src/shared/types.js']);
  assert.equal(frontend.shared_paths.includes('package.json'), false,
    'repository-wide shared candidates are not blindly granted to every domain');
  assert.deepEqual(frontend.neighbours, ['qa', 'src-server']);
  const collision = proposal.collisions.find((item) => item.domains.join(':') === 'src-client:src-server');
  assert.equal(collision.score >= 1, true);
  assert.equal(collision.reasons.some((reason) => reason.type === 'shared-dependency'), true);
  assert.equal(collision.resolution.strategy, 'session-manager-coordination');
  assert.equal(proposal.review.status, 'pending');
});

test('SCN-project-gates-in-domain-prompt: repository-wide checks are visible without inventing domain ownership', () => {
  const repository = inspectRepository(architectureFixture());
  const proposal = proposeDomains({ repository, analysis: analyzeRepository(repository) });
  const frontend = proposal.domains.find((domain) => domain.id === 'src-client');
  assert.deepEqual(frontend.required_checks, [], 'global checks are not mislabeled as specialist-owned checks');
  const prompt = renderDomainPrompt(frontend, { projectChecks: proposal.checks });
  assert.match(prompt, /## Project integration gates/);
  assert.match(prompt, /test: \["npm","run","test"\]/);
  assert.match(prompt, /repository-wide gates, not inferred ownership/);
});

test('SCN-default-manager-checkin-config: new proposals declare the owner-gated cadence without installing a timer', () => {
  const root = architectureFixture();
  const repository = inspectRepository(root);
  const proposal = proposeDomains({ repository, analysis: analyzeRepository(repository) });
  const schedule = proposal.schedules.find((entry) => entry.action?.type === 'manager-check-in');
  assert.equal(schedule.id, 'session-manager-check-in');
  assert.equal(schedule.trigger.seconds, 900);
  assert.equal(schedule.lifetime, 'system');
  assert.equal(schedule.required_authority.includes('owner'), true);
  assert.equal(existsSync(join(root, '.torch')), false);
});

test('SCN-spec-evidence-grounding: prose-only requirements remain architect review signals instead of being assigned by keyword overlap', () => {
  const root = architectureFixture();
  mkdirSync(join(root, 'src/adapters'), { recursive: true });
  writeFileSync(join(root, 'src/adapters/claude.mjs'), 'export const claude = true;\n');
  writeFileSync(join(root, 'src/adapters/codex.mjs'), 'export const codex = true;\n');
  const specDirectory = mkdtempSync(join(tmpdir(), 'torch-spec-grounding-'));
  const specPath = join(specDirectory, 'profiles.md');
  writeFileSync(specPath, '# Runtime Design\n\n## Runtime adapters\n\n- Runtime adapters must preserve a separate model choice for each identity.\n');
  const repository = inspectRepository(root);
  const specifications = inspectSpecifications([specPath], { repositoryRoot: root });
  const analysis = analyzeRepository(repository, { specifications });
  const proposal = proposeDomains({ repository, analysis });
  const adapters = proposal.domains.find((domain) => domain.id === 'src-adapters');
  assert.deepEqual(adapters.scope, ['implementation and maintenance under src/adapters/**']);
  assert.equal(adapters.evidence.some((entry) => entry.startsWith(`${specifications[0].path}:`)), false);
  const brief = createFleetDesignBrief({ repository, analysis, baseline: proposal });
  assert.equal(brief.reviewFocus.specificationSignals.some((signal) =>
    signal.title === 'Runtime adapters' && !signal.representedInBaseline), true);
});

test('SCN-analysis-working-tree: untracked source is analyzed and any source drift invalidates approval', () => {
  const root = architectureFixture();
  mkdirSync(join(root, 'src/billing'), { recursive: true });
  writeFileSync(join(root, 'src/billing/invoice.js'), 'export const invoice = true;\n');
  writeFileSync(join(root, 'src/billing/ledger.js'), 'export const ledger = true;\n');
  const repository = inspectRepository(root);
  const analysis = analyzeRepository(repository);
  const proposal = proposeDomains({ repository, analysis });

  assert.equal(analysis.inventory.untrackedFileCount, 2);
  assert.equal(analysis.inventory.analyzedFileCount, analysis.inventory.trackedFileCount + 2);
  assert.equal(analysis.repository.workingTreeFingerprint.length, 64);
  assert.equal(analysis.architecture.components.some((component) => component.key === 'src/billing'), true);
  assert.equal(proposal.domains.some((domain) => domain.id === 'src-billing'), true);
  assert.deepEqual(proposal.schedules.find((schedule) => schedule.action?.type === 'manager-check-in'), {
    id: 'session-manager-check-in', title: 'Session Manager direct-report check-in',
    owner: 'session-manager', lifetime: 'system',
    trigger: { type: 'interval', seconds: 900 }, behavior: 'coordination',
    action: { type: 'manager-check-in', manager_id: 'session-manager' },
    required_authority: ['owner'], retry: { max_attempts: 1 },
    failure_recipient: 'session-manager',
    source_of_truth: 'active organization direct-report graph',
  });

  proposal.review = {
    status: 'approved', reviewedAt: '2026-09-28T00:00:00Z', reviewedBy: 'fixture-owner', notes: [],
  };
  validateApprovedProposal({ proposal, repository });
  writeFileSync(join(root, 'src/billing/invoice.js'), 'export const invoice = false;\n');
  assert.throws(
    () => validateApprovedProposal({ proposal, repository }),
    (error) => error.code === 'PROPOSAL_NOT_APPROVED'
      && error.details.includes('proposal is stale because the repository working tree changed'),
  );
});
