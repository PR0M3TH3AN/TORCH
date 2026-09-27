import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { analyzeRepository } from '../../src/kernel/analyze.mjs';
import { proposeDomains, validateApprovedProposal } from '../../src/kernel/domains.mjs';
import { inspectRepository } from '../../src/kernel/git.mjs';
import { inspectSpecifications } from '../../src/kernel/specifications.mjs';

const CLI = new URL('../../bin/torch.mjs', import.meta.url).pathname;

function repositoryFixture() {
  const root = mkdtempSync(join(tmpdir(), 'torch-spec-project-'));
  execFileSync('git', ['init', '-b', 'main', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'torch-test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'TORCH Test']);
  writeFileSync(join(root, 'README.md'), '# New project\n');
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'empty project shell']);
  return root;
}

function specificationFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'torch-spec-input-'));
  const path = join(directory, 'garden-product.md');
  writeFileSync(path, `# Garden Planner Product Specification

## Client experience

- The client must let a household plan beds and seasonal planting.
- The interface should remain useful offline.

## Plant data service

- The service must maintain the crop catalog and planting rules.
- Data changes require provenance.

## Quality and release

- Testing must cover saved plans and offline recovery.
- Release operations require owner approval.
`);
  return path;
}

test('SCN-spec-fleet-design: a prose-only project spec produces reviewable responsibilities without invented paths', () => {
  const root = repositoryFixture();
  const specPath = specificationFixture();
  const repository = inspectRepository(root);
  const before = execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' });
  const specifications = inspectSpecifications([specPath], { repositoryRoot: root });
  const proposal = proposeDomains({
    repository,
    analysis: analyzeRepository(repository, { specifications }),
  });
  assert.deepEqual(proposal.domains.map((domain) => domain.id), [
    'client-experience', 'plant-data-service', 'quality-and-release',
  ]);
  assert.equal(proposal.domains.every((domain) => domain.scope.length > 0), true);
  assert.equal(proposal.domains.every((domain) => domain.owned_paths.length === 0), true);
  assert.equal(proposal.domains.every((domain) => domain.design_status === 'needs-owner-path-review'), true);
  assert.equal(proposal.specifications[0].sha256.length, 64);
  assert.equal(execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }), before);

  proposal.review = {
    status: 'approved', reviewedAt: '2026-09-27T00:00:00Z', reviewedBy: 'fixture-owner', notes: [],
  };
  proposal.domains.forEach((domain) => { domain.owned_paths = [`planned/${domain.id}/**`]; });
  validateApprovedProposal({ proposal, repository });
  writeFileSync(specPath, `${readFileSync(specPath, 'utf8')}\n## Security\n\n- Security must protect household data.\n`);
  assert.throws(
    () => validateApprovedProposal({ proposal, repository }),
    (error) => error.code === 'PROPOSAL_NOT_APPROVED'
      && error.details.some((detail) => detail.startsWith('specification changed after proposal:')),
  );
});

test('SCN-cli-spec-design: startup can inspect a selected repository and external spec from another directory', () => {
  const root = repositoryFixture();
  const specPath = specificationFixture();
  const launchDirectory = mkdtempSync(join(tmpdir(), 'torch-spec-launch-'));
  const output = join(launchDirectory, 'fleet-proposal.json');
  const result = spawnSync(process.execPath, [
    CLI, 'design', '--repo', root, '--spec', specPath, '--output', output, '--json',
  ], { cwd: launchDirectory, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const response = JSON.parse(result.stdout);
  assert.equal(response.proposal.review.status, 'pending');
  assert.equal(response.proposal.repository.root, root);
  assert.equal(response.proposal.specifications[0].path, specPath);
  assert.equal(response.proposal.domains.length, 3);
  assert.equal(existsSync(join(root, '.torch')), false);
  assert.equal(execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }), '');
});
