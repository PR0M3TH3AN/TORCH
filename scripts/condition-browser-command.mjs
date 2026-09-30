import assert from 'node:assert/strict';

// Condition and measurement subprocesses both contact the same browser service.
const [base, operation] = process.argv.slice(2);
assert.ok(['probe', 'measure'].includes(operation));
const response = await fetch(`${base}/${operation}`, {
  method: operation === 'measure' ? 'POST' : 'GET', signal: AbortSignal.timeout(10_000),
});
assert.equal(response.status, 200);
const report = await response.json();
if (operation === 'probe') {
  assert.equal(report.subject.commit, process.env.TORCH_CHECK_COMMIT);
  assert.equal(report.subject.inputDigest, process.env.TORCH_CHECK_INPUT_DIGEST);
}
console.log(JSON.stringify(report));
