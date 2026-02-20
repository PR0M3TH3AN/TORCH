import { test, mock, describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';

// Mock process.exit
const originalExit = process.exit;
let exitMock;

// Mock console
const originalError = console.error;
let errorMock;
const originalLog = console.log;
let logMock;

describe('main dispatch', () => {
  let main;

  before(async () => {
    exitMock = mock.fn();
    process.exit = exitMock;

    errorMock = mock.fn();
    console.error = errorMock;

    logMock = mock.fn();
    console.log = logMock;

    // We import main
    // Since we cannot mock modules easily in this environment (mock.module missing),
    // we will rely on testing the error paths of the handlers, which don't trigger side effects.
    const mod = await import('../src/lib.mjs');
    main = mod.main;
  });

  after(() => {
    process.exit = originalExit;
    console.error = originalError;
    console.log = originalLog;
    mock.reset();
  });

  beforeEach(() => {
      exitMock.mock.resetCalls();
      errorMock.mock.resetCalls();
      logMock.mock.resetCalls();
  });

  it('should exit with code 1 if no command provided', async () => {
    await main([]);

    assert.strictEqual(exitMock.mock.callCount(), 1);
    assert.strictEqual(exitMock.mock.calls[0].arguments[0], 1);
  });

  it('should exit with code 1 if unknown command provided', async () => {
    await main(['unknown']);

    assert.strictEqual(exitMock.mock.callCount(), 1);
    assert.strictEqual(exitMock.mock.calls[0].arguments[0], 1);
    const unknownMsg = errorMock.mock.calls.find(c => c.arguments[0].includes('Unknown command'));
    assert.ok(unknownMsg);
  });

  it('should exit with code 1 if check command misses cadence', async () => {
    await main(['check']);

    assert.strictEqual(exitMock.mock.callCount(), 1);
    assert.strictEqual(exitMock.mock.calls[0].arguments[0], 1);
    const missingMsg = errorMock.mock.calls.find(c => c.arguments[0].includes('required for check'));
    assert.ok(missingMsg);
  });

  it('should exit with code 1 if lock command misses agent', async () => {
    await main(['lock']);

    assert.strictEqual(exitMock.mock.callCount(), 1);
    assert.strictEqual(exitMock.mock.calls[0].arguments[0], 1);
    const missingMsg = errorMock.mock.calls.find(c => c.arguments[0].includes('required for lock'));
    assert.ok(missingMsg);
  });

  it('should exit with code 1 if complete command misses agent', async () => {
    await main(['complete']);

    assert.strictEqual(exitMock.mock.callCount(), 1);
    assert.strictEqual(exitMock.mock.calls[0].arguments[0], 1);
    const missingMsg = errorMock.mock.calls.find(c => c.arguments[0].includes('required for complete'));
    assert.ok(missingMsg);
  });

  it('should exit with code 1 if proposal command misses subcommand', async () => {
    await main(['proposal']);

    assert.strictEqual(exitMock.mock.callCount(), 1);
    assert.strictEqual(exitMock.mock.calls[0].arguments[0], 1);
    const missingMsg = errorMock.mock.calls.find(c => c.arguments[0].includes('Missing subcommand'));
    assert.ok(missingMsg);
  });
});
