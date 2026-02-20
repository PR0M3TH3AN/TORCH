import fs from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';
import os from 'node:os';
import process from 'node:process';
import dns from 'node:dns/promises';

// Colors for output
const RESET = '\x1b[0m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m';

let hasError = false;

function log(msg) { console.log(msg); }
function success(msg) { console.log(`${GREEN}✔ ${msg}${RESET}`); }
function fail(msg) {
  console.log(`${RED}✘ ${msg}${RESET}`);
  hasError = true;
}
function warn(msg) { console.log(`${YELLOW}⚠ ${msg}${RESET}`); }
function info(msg) { console.log(`  ${msg}`); }

async function checkNodeVersion() {
  log(`\n${BOLD}Checking Node.js Environment...${RESET}`);
  const version = process.version;
  const major = parseInt(version.slice(1).split('.')[0], 10);

  if (major >= 22) {
    success(`Node.js version: ${version}`);
  } else {
    fail(`Node.js version: ${version} (Expected >= 22.0.0)`);
  }

  info(`Platform: ${os.platform()} ${os.release()} (${os.arch()})`);
  info(`Memory: ${Math.round(os.totalmem() / 1024 / 1024 / 1024)} GB Total`);
}

async function checkDependencies() {
  log(`\n${BOLD}Checking Dependencies...${RESET}`);
  const nodeModulesPath = path.resolve('node_modules');
  try {
    await fs.access(nodeModulesPath);
    success('node_modules directory exists');
  } catch {
    fail('node_modules directory missing. Run "npm install".');
    return;
  }

  try {
    await import('nostr-tools');
    success('nostr-tools loaded successfully');
  } catch (e) {
    fail(`Failed to load nostr-tools: ${e.message}`);
  }

  try {
    await import('ws');
    success('ws loaded successfully');
  } catch (e) {
    fail(`Failed to load ws: ${e.message}`);
  }
}

async function checkConfiguration() {
  log(`\n${BOLD}Checking Configuration...${RESET}`);
  const configPath = path.resolve('torch-config.json');
  try {
    await fs.access(configPath);
    success('torch-config.json exists');

    // Validate content
    const content = await fs.readFile(configPath, 'utf8');
    const config = JSON.parse(content);

    if (config.nostrLock && config.nostrLock.relays && Array.isArray(config.nostrLock.relays)) {
      success(`Configuration valid. Found ${config.nostrLock.relays.length} relays.`);
      info(`Namespace: ${config.nostrLock.namespace || 'default'}`);
    } else {
      fail('torch-config.json structure invalid (missing nostrLock.relays array)');
    }
  } catch (e) {
    fail(`Configuration check failed: ${e.message}`);
  }
}

async function checkFileSystem() {
  log(`\n${BOLD}Checking File System...${RESET}`);
  const dirs = [
    'src',
    'task-logs',
    'src/prompts',
    'src/prompts/daily',
    'src/prompts/weekly'
  ];

  for (const dir of dirs) {
    try {
      await fs.access(path.resolve(dir));
      success(`${dir} exists`);
    } catch {
      fail(`${dir} is missing`);
    }
  }

  // Check write access to task-logs
  const testFile = path.resolve('task-logs', '.diagnostic-write-test');
  try {
    await fs.writeFile(testFile, 'test');
    await fs.unlink(testFile);
    success('Write access to task-logs verified');
  } catch (e) {
    fail(`Write access to task-logs failed: ${e.message}`);
  }
}

async function checkGit() {
  log(`\n${BOLD}Checking Git...${RESET}`);
  try {
    execSync('git --version', { stdio: 'ignore' });
    success('Git is installed');

    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
      const commit = execSync('git rev-parse --short HEAD').toString().trim();
      success(`Git repository valid (Branch: ${branch}, Commit: ${commit})`);
    } catch {
      warn('Not a git repository or no commits yet');
    }
  } catch {
    fail('Git is not installed or not in PATH');
  }
}

async function checkConnectivity() {
  log(`\n${BOLD}Checking Connectivity...${RESET}`);
  try {
    await dns.lookup('google.com');
    success('Internet connectivity verified (DNS lookup)');
  } catch (e) {
    fail(`Internet connectivity failed: ${e.message}`);
  }
}

async function main() {
  console.log(`${BOLD}TORCH Diagnostic Tool${RESET}`);
  console.log('='.repeat(30));

  await checkNodeVersion();
  await checkDependencies();
  await checkConfiguration();
  await checkFileSystem();
  await checkGit();
  await checkConnectivity();

  console.log('\n' + '='.repeat(30));
  if (hasError) {
    console.log(`${RED}Diagnostic failed with errors.${RESET}`);
    process.exit(1);
  } else {
    console.log(`${GREEN}Diagnostic passed.${RESET}`);
  }
}

main().catch(console.error);
