
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const FIXTURE_PATH = path.join(process.cwd(), 'test', 'memory-telemetry-check.mjs');

const FIXTURE_CONTENT = `
import { ingestEvents } from '../src/services/memory/index.js';

// Mock process.stdout.write to capture output
const originalWrite = process.stdout.write;
let output = '';
process.stdout.write = (chunk, encoding, callback) => {
  output += chunk.toString();
  return originalWrite.call(process.stdout, chunk, encoding, callback);
};

// Also mock process.env to ensure ingest is DISABLED to trigger skip telemetry
process.env.TORCH_MEMORY_ENABLED = 'true';
process.env.TORCH_MEMORY_INGEST_ENABLED = 'off';

async function run() {
  console.log('--- Start Test ---');

  // Call ingestEvents which should trigger telemetry
  await ingestEvents([], { agent_id: 'test-agent' });

  console.log('--- End Test ---');

  if (output.includes('memory_telemetry')) {
     console.log('\\n[FAIL] Found memory_telemetry in stdout (Pollution detected)');
     process.exit(1);
  } else {
    console.log('\\n[PASS] Did not find memory_telemetry in stdout (Clean)');
  }
}

run().catch(console.error);
`;

test.before(() => {
  fs.writeFileSync(FIXTURE_PATH, FIXTURE_CONTENT);
});

test.after(() => {
  if (fs.existsSync(FIXTURE_PATH)) {
    fs.unlinkSync(FIXTURE_PATH);
  }
});

// Helper to run the script and capture output
function runScript(env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [FIXTURE_PATH], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      // The script exits with 0 on pass, 1 on fail
      resolve({ code, stdout, stderr });
    });
  });
}

test('telemetry should not log to stdout or stderr by default', async () => {
  const { code, stdout, stderr } = await runScript();

  assert.equal(code, 0, 'Script should pass');
  // The pass message contains "memory_telemetry", so we check for the FAIL condition specifically
  assert.doesNotMatch(stdout, /Pollution detected/, 'stdout should not indicate pollution');
  assert.match(stdout, /\[PASS\]/, 'stdout should indicate pass');

  // stderr should be empty or minimal (no debug logs)
  assert.doesNotMatch(stderr, /memory_telemetry/, 'stderr should not contain telemetry payload');
});

test('telemetry should log to stderr when NODE_DEBUG=torch-memory is set', async () => {
  const { code, stdout, stderr } = await runScript({ NODE_DEBUG: 'torch-memory' });

  assert.equal(code, 0, 'Script should pass (stdout is clean)');
  assert.doesNotMatch(stdout, /Pollution detected/, 'stdout should not indicate pollution');

  // stderr should contain the debug log
  // util.debuglog format: "TORCH-MEMORY <pid>: <msg>"
  assert.match(stderr, /TORCH-MEMORY/, 'stderr should contain debug tag');
  assert.match(stderr, /memory_telemetry/, 'stderr should contain telemetry event name');
});
