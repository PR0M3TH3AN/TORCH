import fs from 'fs';
import path from 'path';
import { test } from 'node:test';
import assert from 'node:assert';

const DIST_DIR = path.resolve('dist');

test('Build artifacts verification', async (t) => {
  await t.test('dist directory exists', () => {
    assert.strictEqual(fs.existsSync(DIST_DIR), true, 'dist directory should exist');
  });

  await t.test('Critical files exist in dist', () => {
    const criticalFiles = [
      'index.html',
      'dashboard/index.html',
      'src/docs/TORCH.md',
      'assets/logo.svg',
      'src/constants.mjs',
      'src/prompts/META_PROMPTS.md'
    ];

    criticalFiles.forEach(file => {
      const filePath = path.join(DIST_DIR, file);
      assert.strictEqual(fs.existsSync(filePath), true, `File ${file} should exist in dist`);
    });
  });

  await t.test('TORCH.md content is not empty', () => {
    const torchMdPath = path.join(DIST_DIR, 'src/docs/TORCH.md');
    const content = fs.readFileSync(torchMdPath, 'utf8');
    assert.ok(content.length > 0, 'TORCH.md should not be empty');
  });
});
