import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import { CheckService } from '../../src/checks/service.mjs';
import { openControlPlane } from '../../src/control-plane/service.mjs';
import { analyzeRepository } from '../../src/kernel/analyze.mjs';
import { proposeDomains } from '../../src/kernel/domains.mjs';
import { inspectRepository } from '../../src/kernel/git.mjs';
import { installProject } from '../../src/kernel/install.mjs';
import { createWorktrees } from '../../src/kernel/worktrees.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'torch-generated-artifacts-'));
  execFileSync('git', ['init', '-b', 'main', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'torch-test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'TORCH Test']);
  writeFileSync(join(root, 'package.json'), `${JSON.stringify({
    name: 'generated-artifacts-fixture', scripts: { 'verify:pass': 'node -e "process.exit(0)"' },
  }, null, 2)}\n`);
  writeFileSync(join(root, 'app.js'), 'export const app = true;\n');
  mkdirSync(join(root, 'test'));
  writeFileSync(join(root, 'test', 'scenario.js'), 'export const scenario = true;\n');
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'fixture']);
  let repository = inspectRepository(root);
  const proposal = proposeDomains({ repository, analysis: analyzeRepository(repository) });
  proposal.review = { status: 'approved', reviewedAt: '2026-09-30T00:00:00Z', reviewedBy: 'fixture-owner', notes: [] };
  const env = { ...process.env, XDG_DATA_HOME: join(tmpdir(), `${basename(root)}-state`) };
  installProject({ repository, proposal, env, projectId: 'generated-artifacts-fixture' });
  execFileSync('git', ['-C', root, 'add', '.torch']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'install torch']);
  repository = inspectRepository(root);
  createWorktrees({ repository, parentOverride: join(tmpdir(), `${basename(root)}-worktrees`) });
  return { root, env, worker: proposal.domains.find((domain) => domain.id !== 'qa').id };
}

function addCheck(context, definition) {
  const path = join(context.root, '.torch', 'torch.yaml');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  config.checks.push(definition);
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
}

function treeStatus(path) {
  return execFileSync('git', ['-C', path, 'status', '--porcelain'], { encoding: 'utf8' });
}

test('SCN-generated-check-artifacts: sequential exact checks retain external hashed evidence without changing tracked inputs', () => {
  const context = fixture();
  addCheck(context, {
    id: 'emit-proof', command: process.execPath,
    args: ['-e', `const fs=require('node:fs');const path=require('node:path');
      const output=process.env.TORCH_CHECK_ARTIFACT_DIR;if(!output)process.exit(44);
      fs.mkdirSync(path.join(output,'screenshots'),{recursive:true});
      fs.writeFileSync(path.join(output,'screenshots','proof.txt'),'captured boundary evidence');`],
  });
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  let id = 0;
  const checks = new CheckService({ repositoryRoot: context.root, controlPlane: control,
    idFactory: () => `artifact-run-${++id}` });
  const expectedHash = createHash('sha256').update('captured boundary evidence').digest('hex');
  try {
    const receipts = [
      checks.run({ checkId: 'emit-proof', areaId: context.worker }),
      checks.run({ checkId: 'emit-proof', areaId: context.worker }),
    ];
    for (const receipt of receipts) {
      assert.equal(receipt.result, 'pass');
      assert.equal(treeStatus(receipt.worktree), '', 'a passing check must leave its tested tree unchanged');
      const retained = JSON.parse(readFileSync(receipt.artifactPath, 'utf8')).generatedArtifacts;
      assert.deepEqual(retained.candidate, { commit: receipt.commit });
      assert.deepEqual(retained.check, { id: 'emit-proof',
        definitionHash: createHash('sha256').update(JSON.stringify(receipt.definition)).digest('hex') });
      assert.deepEqual(retained.run, { id: receipt.id });
      assert.deepEqual(retained.files, [{ path: 'screenshots/proof.txt', bytes: 26, sha256: expectedHash }]);
      assert.equal(readFileSync(join(retained.directory, 'screenshots', 'proof.txt'), 'utf8'), 'captured boundary evidence');
    }
    assert.notEqual(receipts[0].generatedArtifacts.directory, receipts[1].generatedArtifacts.directory,
      'each run retains its own recoverable evidence directory');
    assert.equal(checks.exactPasses({ commit: receipts[0].commit, requiredChecks: ['emit-proof'] }), true);
  } finally {
    control.close();
  }
});

test('SCN-generated-check-mutation: exit zero plus a tested-tree mutation is incomplete even when external evidence was retained', () => {
  const context = fixture();
  addCheck(context, {
    id: 'emit-and-mutate', command: process.execPath,
    args: ['-e', `const fs=require('node:fs');const path=require('node:path');
      fs.writeFileSync(path.join(process.env.TORCH_CHECK_ARTIFACT_DIR,'proof.txt'),'retained despite mutation');
      fs.writeFileSync('app.js','source mutation');`],
  });
  const control = openControlPlane({ repositoryRoot: context.root, env: context.env });
  const checks = new CheckService({ repositoryRoot: context.root, controlPlane: control,
    idFactory: () => 'mutation-run' });
  try {
    const receipt = checks.run({ checkId: 'emit-and-mutate', areaId: context.worker });
    assert.equal(receipt.exitStatus, 0);
    assert.equal(receipt.result, 'incomplete');
    assert.equal(receipt.invalidReason, 'worktree-changed-during-check');
    const retained = JSON.parse(readFileSync(receipt.artifactPath, 'utf8')).generatedArtifacts;
    assert.equal(existsSync(join(retained.directory, 'proof.txt')), true);
    assert.notEqual(treeStatus(receipt.worktree), '');
    assert.equal(checks.exactPasses({ commit: receipt.commit, requiredChecks: ['emit-and-mutate'] }), false);
  } finally {
    control.close();
  }
});
