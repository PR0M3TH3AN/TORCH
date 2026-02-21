import fs from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

// Calculate paths relative to this file
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const governanceServicePath = path.resolve(repoRoot, 'src/services/governance/index.js');

async function runTest() {
  // Create temp dir
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'torch-gov-test-'));
  console.log(`Using temp dir: ${tempDir}`);

  // Setup git repo
  execSync('git init', { cwd: tempDir, stdio: 'ignore' });
  execSync('git config user.name "Test User"', { cwd: tempDir, stdio: 'ignore' });
  execSync('git config user.email "test@example.com"', { cwd: tempDir, stdio: 'ignore' });

  // Create required directory structure
  await fs.mkdir(path.join(tempDir, 'src/prompts/daily'), { recursive: true });
  await fs.mkdir(path.join(tempDir, 'src/prompts/weekly'), { recursive: true });
  // Proposals dir is created automatically by ensureDirs() but allowlist check needs prompts dir

  // Create a target file
  const targetFile = 'src/prompts/daily/test-agent.md';
  const absoluteTarget = path.join(tempDir, targetFile);
  await fs.writeFile(absoluteTarget, 'Original Content');

  // Commit initial state so we have a HEAD
  execSync(`git add ${targetFile}`, { cwd: tempDir });
  execSync('git commit -m "Initial commit"', { cwd: tempDir });

  // Switch cwd to tempDir
  const originalCwd = process.cwd();
  try {
    process.chdir(tempDir);
    console.log(`Changed cwd to: ${process.cwd()}`);

    // Import governance service dynamically so it picks up the new cwd
    const governance = await import(governanceServicePath);

    // Malicious payload
    const maliciousPayload = 'attacker"; touch /tmp/pwned_check; echo "';
    // const proposalId = `test-proposal-${Date.now()}`; // unused

    // Manually create proposal metadata and files because createProposal also uses git diff
    // We can use createProposal from the service, but we need to pass the malicious agent name there.
    // Let's try using createProposal first.

    const proposalContent = `Shared contract (required):\nRequired startup + artifacts + memory + issue capture\n\nNew Content`;

    console.log('Creating proposal...');
    const { id } = await governance.createProposal({
      agent: maliciousPayload,
      target: targetFile,
      newContent: proposalContent,
      reason: 'Testing security'
    });

    console.log(`Proposal created with ID: ${id}`);

    // Verify metadata has the malicious author
    const metaPath = path.join(tempDir, 'src/proposals', id, 'meta.json');
    const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
    if (meta.author !== maliciousPayload) {
      throw new Error('Meta author does not match malicious payload');
    }

    // Apply proposal
    console.log('Applying proposal...');
    await governance.applyProposal(id);
    console.log('Proposal applied.');

    // Verification 1: Check if /tmp/pwned_check exists
    try {
      await fs.access('/tmp/pwned_check');
      console.error('VULNERABILITY DETECTED: /tmp/pwned_check exists!');
      process.exit(1);
    } catch {
      console.log('Security check passed: /tmp/pwned_check does not exist.');
    }

    // Verification 2: Check git log for commit message
    const log = execSync('git log -1 --pretty=%B', { cwd: tempDir }).toString();
    console.log(`Commit message: ${log}`);

    if (!log.includes(maliciousPayload)) {
      console.error('Verification failed: Commit message does not contain the payload literally.');
      process.exit(1);
    }

    // Check if the commit message looks "broken" (e.g. if newlines were injected)
    // Here we just want to ensure the whole thing is in the message.
    console.log('Verification passed: Commit message contains payload.');

  } finally {
    // Cleanup
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
    // Also remove /tmp/pwned_check if it exists (it shouldn't)
    try { await fs.unlink('/tmp/pwned_check'); } catch { /* ignore */ }
  }
}

runTest().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
