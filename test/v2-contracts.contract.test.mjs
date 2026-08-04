import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  loadSchemas,
  runValidation,
  validateAgainstSchema,
  FIXTURE_DIRS,
} from '../scripts/validate-v2-contracts.mjs';

async function loadFixture(kind, name) {
  return JSON.parse(await readFile(join(FIXTURE_DIRS[kind], name), 'utf8'));
}

test('all committed fixtures match their declared expectation', async () => {
  // Given the schemas and fixtures in docs/v2/schemas
  // When the full validation run executes
  // Then every valid fixture passes, every invalid fixture fails, and at least
  // one fixture of each kind exists per schema family being exercised.
  const { failures, checked } = await runValidation();
  assert.deepEqual(failures, []);
  assert.ok(checked >= 12, `expected at least 12 fixtures checked, got ${checked}`);
});

test('every v2 schema pins its version and closes its property set', async () => {
  // Given each committed schema
  // When inspected
  // Then it declares a torch.<name>.v1 schemaVersion const and rejects unknown
  // properties, so instances cannot smuggle undeclared fields past review.
  const schemas = await loadSchemas();
  assert.equal(schemas.size, 6);
  for (const [base, { schema }] of schemas) {
    const versionConst = schema.properties.schemaVersion.const;
    assert.match(versionConst, /^torch\.[a-z-]+\.v1$/, `${base} schemaVersion const`);
    assert.equal(schema.additionalProperties, false, `${base} additionalProperties`);
    assert.ok(schema.required.includes('schemaVersion'), `${base} requires schemaVersion`);
  }
});

test('a task contract without a spending ceiling is rejected', async () => {
  // Given a well-formed task contract
  // When spendingCeiling is removed
  // Then validation fails on the missing property — budget enforcement cannot
  // be skipped by omitting the field.
  const schemas = await loadSchemas();
  const contract = await loadFixture('valid', 'task-contract-v1.audit-task.json');
  delete contract.spendingCeiling;
  const errors = validateAgainstSchema(schemas.get('task-contract-v1').schema, contract);
  assert.ok(
    errors.some((error) => error.includes('spendingCeiling')),
    `expected a spendingCeiling error, got: ${errors.join('; ')}`,
  );
});

test('a pledge cannot carry balance-like extra fields', async () => {
  // Given a well-formed pledge
  // When a custodial-balance-shaped property is added
  // Then validation fails — pledges are signals, never money (spec §14.3).
  const schemas = await loadSchemas();
  const pledge = await loadFixture('valid', 'pledge-v1.conditional.json');
  pledge.heldBalanceSats = 1000;
  const errors = validateAgainstSchema(schemas.get('pledge-v1').schema, pledge);
  assert.ok(
    errors.some((error) => error.includes('heldBalanceSats')),
    `expected an unexpected-property error, got: ${errors.join('; ')}`,
  );
});

test('an evidence bundle requires all four artifact families', async () => {
  // Given a well-formed evidence bundle
  // When the testLogs artifact is removed
  // Then validation fails — mirroring verify-run-artifacts.mjs, a run without
  // test logs is not evidence.
  const schemas = await loadSchemas();
  const bundle = await loadFixture('valid', 'evidence-bundle-v1.audit-run.json');
  delete bundle.artifacts.testLogs;
  const errors = validateAgainstSchema(schemas.get('evidence-bundle-v1').schema, bundle);
  assert.ok(
    errors.some((error) => error.includes('testLogs')),
    `expected a testLogs error, got: ${errors.join('; ')}`,
  );
});

test('tampered provenance digests are rejected', async () => {
  // Given a well-formed evidence bundle
  // When promptBundleDigest is truncated
  // Then validation fails the sha256 pattern — provenance fields cannot be
  // shortened or replaced with labels.
  const schemas = await loadSchemas();
  const bundle = await loadFixture('valid', 'evidence-bundle-v1.audit-run.json');
  bundle.promptBundleDigest = bundle.promptBundleDigest.slice(0, 40);
  const errors = validateAgainstSchema(schemas.get('evidence-bundle-v1').schema, bundle);
  assert.ok(
    errors.some((error) => error.includes('promptBundleDigest')),
    `expected a digest pattern error, got: ${errors.join('; ')}`,
  );
});

test('milestone funding legs must be whole non-negative sats', async () => {
  // Given a well-formed milestone
  // When a funding leg becomes fractional
  // Then validation fails the integer type check — sats do not subdivide here.
  const schemas = await loadSchemas();
  const milestone = await loadFixture('valid', 'milestone-v1.audit.json');
  milestone.funding.coordinationFeeSats = 0.5;
  const errors = validateAgainstSchema(schemas.get('milestone-v1').schema, milestone);
  assert.ok(
    errors.some((error) => error.includes('coordinationFeeSats')),
    `expected an integer type error, got: ${errors.join('; ')}`,
  );
});
