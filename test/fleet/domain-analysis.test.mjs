import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { analyzeRepository } from '../../src/kernel/analyze.mjs';
import { proposeDomains } from '../../src/kernel/domains.mjs';
import { inspectRepository } from '../../src/kernel/git.mjs';

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
  assert.deepEqual(frontend.neighbours, ['qa', 'src-server']);
  const collision = proposal.collisions.find((item) => item.domains.join(':') === 'src-client:src-server');
  assert.equal(collision.score >= 1, true);
  assert.equal(collision.reasons.some((reason) => reason.type === 'shared-dependency'), true);
  assert.equal(collision.resolution.strategy, 'session-manager-coordination');
  assert.equal(proposal.review.status, 'pending');
});
