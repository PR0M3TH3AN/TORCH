import { spawn } from 'node:child_process';
import http from 'node:http';

const PORT = 3334;
const CONCURRENCY = 100;
const TOTAL_REQUESTS = 2000;
const ENDPOINT = `http://localhost:${PORT}/torch-config.example.json`;

async function startServer() {
  const child = spawn('node', ['bin/torch-lock.mjs', 'dashboard', '--port', PORT], {
    stdio: 'ignore', // 'inherit' for debugging
    detached: false
  });
  return child;
}

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(`http://localhost:${PORT}/dashboard/`, (res) => {
          if (res.statusCode === 200) resolve();
          else reject(new Error(`Status ${res.statusCode}`));
        });
        req.on('error', reject);
        req.end();
      });
      return;
    } catch {
      await new Promise(r => setTimeout(r, 100));
    }
  }
  throw new Error('Server not ready');
}

async function runBenchmark() {
  let completed = 0;
  let failures = 0;
  const start = process.hrtime.bigint();

  const promises = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    promises.push(worker());
  }

  async function worker() {
    while (completed + failures < TOTAL_REQUESTS) {
      if (completed + failures >= TOTAL_REQUESTS) break;
      try {
        await makeRequest();
        completed++;
      } catch {
        failures++;
        // console.error(e);
      }
    }
  }

  await Promise.all(promises);
  const end = process.hrtime.bigint();
  const duration = Number(end - start) / 1e6; // ms

  console.log(`Requests: ${completed}`);
  console.log(`Failures: ${failures}`);
  console.log(`Total time: ${duration.toFixed(2)}ms`);
  console.log(`RPS: ${(completed / (duration / 1000)).toFixed(2)}`);
  return duration;
}

function makeRequest() {
  return new Promise((resolve, reject) => {
    http.get(ENDPOINT, (res) => {
      res.resume(); // Consume data
      if (res.statusCode === 200) resolve();
      else reject(new Error(`Status ${res.statusCode}`));
    }).on('error', reject);
  });
}

async function main() {
  console.log('Starting server...');
  const server = await startServer();
  try {
    await waitForServer();
    console.log('Server ready. Benchmarking...');
    await runBenchmark();
  } finally {
    server.kill();
  }
}

main().catch(console.error);
