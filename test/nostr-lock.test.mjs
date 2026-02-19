import { describe, it } from 'node:test';
import assert from 'node:assert';
import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import { WebSocketServer } from 'ws';

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

  it('should include paused agents in check output', async () => {
    // Start a mock relay
    const wss = new WebSocketServer({ port: 0 });
    const port = await new Promise(resolve => wss.on('listening', () => resolve(wss.address().port)));
    
    wss.on('connection', (ws) => {
      ws.on('message', (message) => {
        const [type, subId] = JSON.parse(message);
        if (type === 'REQ') {
          ws.send(JSON.stringify(['EOSE', subId]));
        }
      });
    });

    const configPath = 'test-torch-config-paused.json';
    fs.writeFileSync(configPath, JSON.stringify({
      nostrLock: {
        relays: [`ws://127.0.0.1:${port}`]
      },
      scheduler: { paused: { daily: ['paused-agent'] } }
    }));

    try {
      const child = spawn('node', ['bin/torch-lock.mjs', 'check', '--cadence', 'daily', '--json', '--quiet'], {
        env: { ...process.env, TORCH_CONFIG_PATH: configPath }
      });

      let stdout = '';
      child.stdout.on('data', data => stdout += data);

      const code = await new Promise(resolve => child.on('close', resolve));
      
      assert.strictEqual(code, 0);
      const output = JSON.parse(stdout);
      assert.deepStrictEqual(output.paused, ['paused-agent']);
      assert.ok(output.excluded.includes('paused-agent'));
    } finally {
      wss.close();
      if (fs.existsSync(configPath)) {
        fs.unlinkSync(configPath);
      }
    }
  });
});
