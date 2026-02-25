import { test, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { WebSocketServer } from 'ws';
import { cmdInit, cmdUpdate } from '../src/ops.mjs';

const execAsync = promisify(exec);

const MOCK_CONFIG = {
  installDir: 'torch',
  namespace: 'test-namespace',
  hashtag: 'test-hashtag',
  relays: ['wss://relay.damus.io']
};

const tempBase = fs.mkdtempSync(path.join(process.cwd(), 'test-ops-'));

after(() => {
  fs.rmSync(tempBase, { recursive: true, force: true });
});

test('cmdInit creates directory structure and files', async () => {
  const projectRoot = path.join(tempBase, 'project1');
  fs.mkdirSync(projectRoot, { recursive: true });

  await cmdInit(false, projectRoot, MOCK_CONFIG);

  const torchDir = path.join(projectRoot, 'torch');
  assert.ok(fs.existsSync(torchDir), 'torch dir created');
  assert.ok(fs.existsSync(path.join(torchDir, 'prompts', 'daily')), 'daily prompts created');
  assert.ok(fs.existsSync(path.join(torchDir, 'roster.json')), 'roster created');
  assert.ok(fs.existsSync(path.join(torchDir, 'META_PROMPTS.md')), 'META_PROMPTS.md created');
  assert.ok(fs.existsSync(path.join(torchDir, 'eslint.config.mjs')), 'eslint config copied');

  // Check content transformation
  const metaPrompts = fs.readFileSync(path.join(torchDir, 'META_PROMPTS.md'), 'utf8');
  assert.ok(metaPrompts.includes('torch/prompts/daily/'), 'paths replaced in META_PROMPTS');

  // Check Dashboard file
  const dashboardPath = path.join(torchDir, 'TORCH_DASHBOARD.md');
  assert.ok(fs.existsSync(dashboardPath), 'TORCH_DASHBOARD.md created');
  const dashboardContent = fs.readFileSync(dashboardPath, 'utf8');
  assert.ok(dashboardContent.includes('test-hashtag'), 'Dashboard content contains hashtag');
  assert.ok(dashboardContent.includes('test-namespace'), 'Dashboard content contains namespace');
  assert.ok(dashboardContent.includes('https://torch.thepr0m3th3an.net/dashboard/'), 'Dashboard content contains link');
});

test('cmdInit fails if directory exists without force', async () => {
  const projectRoot = path.join(tempBase, 'project2');
  const torchDir = path.join(projectRoot, 'torch');
  fs.mkdirSync(torchDir, { recursive: true });
  fs.writeFileSync(path.join(torchDir, 'dummy.txt'), 'content');

  await assert.rejects(
    async () => await cmdInit(false, projectRoot, MOCK_CONFIG),
    /already exists/,
    'Should fail if torch dir exists'
  );
});

test('cmdUpdate preserves modified prompt', async () => {
  const projectRoot = path.join(tempBase, 'project3');
  fs.mkdirSync(projectRoot, { recursive: true });

  await cmdInit(false, projectRoot, MOCK_CONFIG);

  const dailyDir = path.join(projectRoot, 'torch', 'prompts', 'daily');
  const files = fs.readdirSync(dailyDir);
  assert.ok(files.length > 0, 'Should have daily prompts');

  const targetFile = path.join(dailyDir, files[0]);
  fs.writeFileSync(targetFile, 'MODIFIED CONTENT', 'utf8');

  await cmdUpdate(false, projectRoot);

  const content = fs.readFileSync(targetFile, 'utf8');
  assert.strictEqual(content, 'MODIFIED CONTENT', 'Prompt should be preserved');
});

test('cmdUpdate overwrites prompt with force', async () => {
  const projectRoot = path.join(tempBase, 'project4');
  fs.mkdirSync(projectRoot, { recursive: true });

  await cmdInit(false, projectRoot, MOCK_CONFIG);

  const dailyDir = path.join(projectRoot, 'torch', 'prompts', 'daily');
  const files = fs.readdirSync(dailyDir);
  const targetFile = path.join(dailyDir, files[0]);

  fs.writeFileSync(targetFile, 'MODIFIED CONTENT', 'utf8');

  await cmdUpdate(true, projectRoot); // Force update

  const content = fs.readFileSync(targetFile, 'utf8');
  assert.notStrictEqual(content, 'MODIFIED CONTENT', 'Prompt should be overwritten');
});

test('cmdUpdate creates backup', async () => {
  const projectRoot = path.join(tempBase, 'project5');
  fs.mkdirSync(projectRoot, { recursive: true });

  await cmdInit(false, projectRoot, MOCK_CONFIG);

  await cmdUpdate(false, projectRoot);

  const torchDir = path.join(projectRoot, 'torch');
  const backupRoot = path.join(torchDir, '_backups');
  assert.ok(fs.existsSync(backupRoot), '_backups directory created');

  const entries = fs.readdirSync(backupRoot);
  assert.ok(entries.length > 0, 'Should have at least one backup');
  const backupName = entries[0];
  assert.match(backupName, /^backup_/, 'Backup directory name starts with backup_');

  const backupContent = fs.readdirSync(path.join(backupRoot, backupName));
  assert.ok(backupContent.includes('roster.json'), 'Backup contains roster.json');
});

test('torch-lock check respects local roster', async () => {
  const wss = new WebSocketServer({ port: 0 });
  const port = wss.address().port;
  const mockRelayUrl = `ws://127.0.0.1:${port}`;

  wss.on('connection', (ws) => {
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        if (data[0] === 'REQ') {
          const subId = data[1];
          ws.send(JSON.stringify(['EOSE', subId]));
        }
      } catch (_err) {
        // ignore
      }
    });
  });

  try {
    const projectRoot = path.join(tempBase, 'project_roster');
    fs.mkdirSync(projectRoot, { recursive: true });

    // Use local mock relay
    const localConfig = { ...MOCK_CONFIG, relays: [mockRelayUrl] };

    // Init
    await cmdInit(false, projectRoot, localConfig);

    // Modify roster
    const rosterPath = path.join(projectRoot, 'torch', 'roster.json');
    const roster = JSON.parse(fs.readFileSync(rosterPath, 'utf8'));
    roster.daily.push('custom-agent-007');
    fs.writeFileSync(rosterPath, JSON.stringify(roster, null, 2));

    // Run CLI
    const binPath = path.resolve(process.cwd(), 'bin/torch-lock.mjs');

    const { stdout } = await execAsync(`${process.execPath} ${binPath} check --cadence daily`, {
        cwd: projectRoot,
        encoding: 'utf8',
        env: { ...process.env, NOSTR_LOCK_RELAYS: undefined, NOSTR_LOCK_RELAY_FALLBACKS: '' }
    });

    const result = JSON.parse(stdout);
    assert.ok(result.available.includes('custom-agent-007'), 'Custom agent found in roster');
  } finally {
    wss.close();
  }
});

test('cmdInit creates torch-config.json with random namespace', async () => {
  const projectRoot = path.join(tempBase, 'project_config_init');
  fs.mkdirSync(projectRoot, { recursive: true });

  await cmdInit(false, projectRoot, MOCK_CONFIG);

  const configPath = path.join(projectRoot, 'torch-config.json');
  assert.ok(fs.existsSync(configPath), 'torch-config.json created');

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.strictEqual(config.nostrLock.namespace, 'test-namespace', 'Namespace should match mock');
  assert.strictEqual(config.dashboard.hashtag, 'test-hashtag', 'Hashtag should match mock');
});
