import { describe, it } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

describe('CLI Smoke Test', () => {
  it('should print usage when no args provided', () => {
    const result = spawnSync('node', ['bin/torch-lock.mjs']);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr.toString(), /Usage:/);
  });

  it('should fail when checking without cadence', () => {
    const result = spawnSync('node', ['bin/torch-lock.mjs', 'check']);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr.toString(), /--cadence <daily|weekly> is required/);
  });

  it('should include paused agents in check output', () => {
    const configPath = 'test-torch-config.json';
    fs.writeFileSync(configPath, JSON.stringify({
      scheduler: { paused: { daily: ['paused-agent'] } }
    }));

    try {
      const result = spawnSync('node', ['bin/torch-lock.mjs', 'check', '--cadence', 'daily'], {
        env: { ...process.env, TORCH_CONFIG_PATH: configPath }
      });
      const output = JSON.parse(result.stdout.toString());
      assert.deepStrictEqual(output.paused, ['paused-agent']);
      assert.ok(output.excluded.includes('paused-agent'));
    } finally {
      if (fs.existsSync(configPath)) {
        fs.unlinkSync(configPath);
      }
    }
  });
});
