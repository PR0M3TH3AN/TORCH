import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const RUNS = 5;
const results = {};

async function runTests(i) {
  console.log(`Run ${i + 1}/${RUNS}...`);
  return new Promise((resolve) => {
    const child = spawn('node', ['--test', ...process.argv.slice(2)], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';

    child.stdout.on('data', (d) => stdout += d.toString());

    child.on('close', (code) => {
      const lines = stdout.split('\n');
      for (const line of lines) {
        if (line.startsWith('not ok ') && !line.includes('# skip') && !line.includes('# todo')) {
          const name = line.substring(line.indexOf('-') + 1).trim();
          if (!results[name]) results[name] = { pass: 0, fail: 0 };
          results[name].fail++;
        } else if (line.startsWith('ok ') && !line.includes('# skip') && !line.includes('# todo')) {
          const name = line.substring(line.indexOf('-') + 1).trim();
          if (!results[name]) results[name] = { pass: 0, fail: 0 };
          results[name].pass++;
        }
      }
      resolve();
    });
  });
}

async function main() {
  for (let i = 0; i < RUNS; i++) {
    await runTests(i);
  }

  writeFileSync('test-audit/flakiness-matrix.json', JSON.stringify(results, null, 2));
  console.log('Flakiness matrix written.');
}

main();
