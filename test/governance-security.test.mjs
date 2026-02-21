import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const implPath = path.join(__dirname, 'governance-security-impl.mjs');

test('Governance Service Security: Command Injection Prevention', (_t) => {
  // We run the implementation in a separate process to ensure process.cwd() isolation
  // and to verify that the dynamic import picks up the correct paths.
  try {
    const output = execFileSync(process.execPath, [implPath], { encoding: 'utf8' });
    // If we reach here, the process exited with code 0 (success)
    // We can optionally check the output for specific messages if needed,
    // but the implementation script asserts internally.
    assert.ok(output.includes('Verification passed: Commit message contains payload.'), 'Output should confirm verification passed');
  } catch (err) {
    console.error('Test implementation failed.');
    if (err.stdout) console.error('STDOUT:', err.stdout);
    if (err.stderr) console.error('STDERR:', err.stderr);
    assert.fail(`Security test failed with exit code ${err.status}: ${err.message}`);
  }
});
