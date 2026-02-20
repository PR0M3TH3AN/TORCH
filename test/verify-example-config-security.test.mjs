import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

test('torch-config.example.json Security', (t) => {
  const configPath = path.resolve('torch-config.example.json');
  const content = fs.readFileSync(configPath, 'utf8');
  const config = JSON.parse(content);

  if (config.dashboard) {
      assert.strictEqual(config.dashboard.auth, undefined, 'Example config should not contain auth field');
  }
});
