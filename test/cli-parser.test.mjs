import { test } from 'node:test';
import assert from 'node:assert';
import { parseArgs } from '../src/cli-parser.mjs';
import { DEFAULT_DASHBOARD_PORT } from '../src/constants.mjs';

test('parseArgs should parse basic command', () => {
  const args = parseArgs(['check', '--cadence', 'daily']);
  assert.strictEqual(args.command, 'check');
  assert.strictEqual(args.cadence, 'daily');
});

test('parseArgs should parse agent and cadence', () => {
  const args = parseArgs(['lock', '--agent', 'my-agent', '--cadence', 'weekly']);
  assert.strictEqual(args.command, 'lock');
  assert.strictEqual(args.agent, 'my-agent');
  assert.strictEqual(args.cadence, 'weekly');
});

test('parseArgs should parse equals sign syntax', () => {
  const args = parseArgs(['lock', '--agent=my-agent', '--cadence=weekly']);
  assert.strictEqual(args.command, 'lock');
  assert.strictEqual(args.agent, 'my-agent');
  assert.strictEqual(args.cadence, 'weekly');
});

test('parseArgs should parse dry-run flag', () => {
  const args = parseArgs(['lock', '--dry-run']);
  assert.strictEqual(args.dryRun, true);
});

test('parseArgs should parse port with default', () => {
  const args = parseArgs(['dashboard']);
  assert.strictEqual(args.port, DEFAULT_DASHBOARD_PORT);
});

test('parseArgs should parse custom port', () => {
  const args = parseArgs(['dashboard', '--port', '8080']);
  assert.strictEqual(args.port, 8080);
});

test('parseArgs should parse ignore-logs flag', () => {
  const args = parseArgs(['check', '--ignore-logs']);
  assert.strictEqual(args.ignoreLogs, true);
});

test('parseArgs should parse memory flags', () => {
  const args = parseArgs([
    'list-memories',
    '--id', '123',
    '--type', 'retrieve',
    '--tags', 'a,b',
    '--pinned', 'true',
    '--limit', '10',
    '--offset', '5'
  ]);
  assert.strictEqual(args.id, '123');
  assert.strictEqual(args.type, 'retrieve');
  assert.deepStrictEqual(args.tags, ['a', 'b']);
  assert.strictEqual(args.pinned, true);
  assert.strictEqual(args.limit, 10);
  assert.strictEqual(args.offset, 5);
});

test('parseArgs should parse memory flags with equals', () => {
  const args = parseArgs([
    'list-memories',
    '--id=123',
    '--type=retrieve',
    '--tags=a,b',
    '--pinned=false',
    '--limit=10',
    '--offset=5'
  ]);
  assert.strictEqual(args.id, '123');
  assert.strictEqual(args.type, 'retrieve');
  assert.deepStrictEqual(args.tags, ['a', 'b']);
  assert.strictEqual(args.pinned, false);
  assert.strictEqual(args.limit, 10);
  assert.strictEqual(args.offset, 5);
});
