import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { executeConditionedCheck } from '../../src/checks/conditions.mjs';

function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'torch-test-conditions-'));
  const subject = { commit: 'a'.repeat(40), inputDigest: 'b'.repeat(64) };
  const report = {
    schema: 'torch.dev/check-conditions/v1alpha1', subject: { ...subject },
    conditions: { 'clock-moving': true, 'gpu-active': true, visible: true, invincible: false },
  };
  writeFileSync(join(cwd, 'report.json'), JSON.stringify(report));
  const definition = {
    command: 'node', args: ['-e', 'require("node:fs").writeFileSync("measured", "yes"); console.log("measurement finished");'],
    conditions: {
      command: 'node', args: ['-e', 'console.log(require("node:fs").readFileSync("report.json","utf8"));'],
      required: [
        { id: 'clock-moving', equals: true }, { id: 'gpu-active', equals: true },
        { id: 'visible', equals: true }, { id: 'invincible', equals: false },
      ],
    },
  };
  const options = { cwd, subject, definition, clock: () => new Date('2026-09-30T06:00:00Z'),
    executor: (command, args, settings) => spawnSync(command, args, settings) };
  return { ...options, report };
}

test('SCN-check-conditions-contract: valid conditions precede measurements and are checked again afterward', () => {
  const input = fixture();
  const output = executeConditionedCheck(input);
  assert.equal(output.invalidReason, null);
  assert.equal(output.result.status, 0);
  assert.equal(output.conditions.before.valid, true);
  assert.equal(output.conditions.after.valid, true);
  assert.equal(output.conditions.provenance, 'project-reported');
  assert.equal(existsSync(join(input.cwd, 'measured')), true);
  assert.equal(output.result.stdout.split('\n')[0].startsWith('TORCH_CHECK_CONDITIONS '), true);
  assert.equal(output.result.stdout.includes('measurement finished'), true);
});

test('SCN-check-measurement-subject: real measurement commands receive the same exact identity as probes, even without conditions', () => {
  for (const conditioned of [true, false]) {
    const input = fixture();
    if (!conditioned) delete input.definition.conditions;
    input.definition.args = ['-e', 'console.log(JSON.stringify({commit:process.env.TORCH_CHECK_COMMIT,inputDigest:process.env.TORCH_CHECK_INPUT_DIGEST}));'];
    const output = executeConditionedCheck(input);
    assert.equal(output.result.status, 0);
    assert.equal(output.invalidReason, null);
    const measured = output.result.stdout.split('\n').find((line) => line.startsWith('{'));
    assert.deepEqual(JSON.parse(measured), input.subject);
  }
});

test('SCN-check-conditions-fail-closed: false, absent, malformed and wrong-subject reports never execute measurements', () => {
  const variants = [
    (report) => { report.conditions['clock-moving'] = false; },
    (report) => { delete report.conditions.visible; },
    (report) => { report.conditions['gpu-active'] = 'true'; },
    (report) => { report.conditions.invincible = true; },
    (report) => { report.subject.commit = 'c'.repeat(40); },
    (report) => { report.subject.inputDigest = 'c'.repeat(64); },
    (report) => { report.schema = 'unknown'; },
  ];
  for (const change of variants) {
    const input = fixture();
    change(input.report);
    writeFileSync(join(input.cwd, 'report.json'), JSON.stringify(input.report));
    const output = executeConditionedCheck(input);
    assert.equal(output.invalidReason, 'test-conditions-invalid-before');
    assert.equal(output.measurementsExecuted, false);
    assert.equal(output.conditions.before.valid, false);
    assert.equal(existsSync(join(input.cwd, 'measured')), false);
  }
  for (const raw of ['not-json', '{}', 'x'.repeat(65_537)]) {
    const input = fixture();
    writeFileSync(join(input.cwd, 'report.json'), raw);
    const output = executeConditionedCheck(input);
    assert.equal(output.measurementsExecuted, false);
    assert.equal(existsSync(join(input.cwd, 'measured')), false);
  }
  const failed = fixture();
  failed.definition.conditions.args = ['-e', 'process.exit(9)'];
  assert.equal(executeConditionedCheck(failed).conditions.before.reason, 'condition-probe-failed');
});

test('SCN-check-condition-drift: a green measurement cannot conceal changing test conditions', () => {
  const input = fixture();
  input.definition.args = ['-e', 'const fs=require("node:fs");const r=JSON.parse(fs.readFileSync("report.json"));r.conditions.visible=false;fs.writeFileSync("report.json",JSON.stringify(r));console.log("green measurements");'];
  const output = executeConditionedCheck(input);
  assert.equal(output.result.status, 0);
  assert.equal(output.invalidReason, 'test-conditions-invalid-after');
  assert.equal(output.conditions.after.reason, 'condition-mismatch:visible');
  assert.equal(JSON.parse(readFileSync(join(input.cwd, 'report.json'))).conditions.visible, false);
});

test('SCN-check-runtime-continuity: reported runtime replacement or disappearance invalidates a green result', () => {
  for (const replacement of ['second-runtime', null]) {
    const input = fixture();
    input.report.runtimeId = 'first-runtime';
    writeFileSync(join(input.cwd, 'report.json'), JSON.stringify(input.report));
    input.definition.args = ['-e', `const fs=require("node:fs");const r=JSON.parse(fs.readFileSync("report.json"));
      ${replacement ? 'r.runtimeId="second-runtime";' : 'delete r.runtimeId;'}
      fs.writeFileSync("report.json",JSON.stringify(r));console.log("green");`];
    const output = executeConditionedCheck(input);
    assert.equal(output.result.status, 0);
    assert.equal(output.conditions.before.valid, true);
    assert.equal(output.conditions.after.valid, false);
    assert.equal(output.conditions.after.reason, 'condition-runtime-changed');
    assert.equal(output.invalidReason, 'test-conditions-invalid-after');
  }
  for (const identity of ['', ' ', 7, 'x'.repeat(257)]) {
    const input = fixture();
    input.report.runtimeId = identity;
    writeFileSync(join(input.cwd, 'report.json'), JSON.stringify(input.report));
    const output = executeConditionedCheck(input);
    assert.equal(output.measurementsExecuted, false);
    assert.equal(output.conditions.before.reason, 'condition-runtime-identity-invalid');
  }
});
