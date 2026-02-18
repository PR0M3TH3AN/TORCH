import { describe, it, mock, afterEach } from 'node:test';
import assert from 'node:assert';
import { cmdCheck } from '../src/cmd-check.mjs';

// Mocks
const mockLoadTorchConfig = mock.fn(() => ({
  scheduler: {
    paused: {
      daily: [],
      weekly: [],
    },
  },
}));
const mockGetRelays = mock.fn(() => ['wss://mock-relay']);
const mockGetNamespace = mock.fn(() => 'mock-namespace');
const mockGetRoster = mock.fn(() => []);
const mockQueryLocks = mock.fn(async () => []);
const mockGetDateStr = mock.fn(() => '2023-10-27');

describe('cmdCheck', () => {
  let consoleLogOutput = [];
  let consoleErrorOutput = [];

  const mockConsoleLog = mock.fn((msg) => {
    consoleLogOutput.push(msg);
  });
  const mockConsoleError = mock.fn((msg) => {
    consoleErrorOutput.push(msg);
  });

  const deps = {
    loadTorchConfig: mockLoadTorchConfig,
    getRelays: mockGetRelays,
    getNamespace: mockGetNamespace,
    getRoster: mockGetRoster,
    queryLocks: mockQueryLocks,
    getDateStr: mockGetDateStr,
    log: mockConsoleLog,
    error: mockConsoleError,
  };

  afterEach(() => {
    // Reset mocks
    mockLoadTorchConfig.mock.resetCalls();
    mockGetRelays.mock.resetCalls();
    mockGetNamespace.mock.resetCalls();
    mockGetRoster.mock.resetCalls();
    mockQueryLocks.mock.resetCalls();
    mockGetDateStr.mock.resetCalls();
    mockConsoleLog.mock.resetCalls();
    mockConsoleError.mock.resetCalls();

    // Clear captured output
    consoleLogOutput = [];
    consoleErrorOutput = [];
  });

  it('correctly reports available agents when no locks exist', async () => {
    mockGetRoster.mock.mockImplementation(() => ['agent1', 'agent2']);
    mockQueryLocks.mock.mockImplementation(async () => []);
    mockLoadTorchConfig.mock.mockImplementation(() => ({
      scheduler: { paused: { daily: [] } }
    }));

    const result = await cmdCheck('daily', deps);

    assert.strictEqual(result.cadence, 'daily');
    assert.strictEqual(result.namespace, 'mock-namespace');
    assert.strictEqual(result.date, '2023-10-27');
    assert.deepStrictEqual(result.available, ['agent1', 'agent2']);
    assert.deepStrictEqual(result.locked, []);
    assert.deepStrictEqual(result.paused, []);
    assert.deepStrictEqual(result.excluded, []);
    assert.strictEqual(result.lockCount, 0);

    // Verify console output was JSON
    assert.strictEqual(consoleLogOutput.length, 1);
    const logOutput = JSON.parse(consoleLogOutput[0]);
    assert.deepStrictEqual(logOutput.available, ['agent1', 'agent2']);
  });

  it('correctly identifies locked agents', async () => {
    mockGetRoster.mock.mockImplementation(() => ['agent1', 'agent2', 'agent3']);
    mockQueryLocks.mock.mockImplementation(async () => [
      { agent: 'agent1', eventId: 'evt1', createdAtIso: '2023-10-27T00:00:00Z', expiresAtIso: '2023-10-27T01:00:00Z', platform: 'linux' }
    ]);
    mockLoadTorchConfig.mock.mockImplementation(() => ({
      scheduler: { paused: { daily: [] } }
    }));

    const result = await cmdCheck('daily', deps);

    assert.deepStrictEqual(result.available, ['agent2', 'agent3']);
    assert.deepStrictEqual(result.locked, ['agent1']);
    assert.deepStrictEqual(result.excluded, ['agent1']);
    assert.strictEqual(result.lockCount, 1);
    assert.strictEqual(result.locks[0].agent, 'agent1');
  });

  it('correctly identifies paused agents', async () => {
    mockGetRoster.mock.mockImplementation(() => ['agent1', 'agent2', 'agent3']);
    mockQueryLocks.mock.mockImplementation(async () => []);
    mockLoadTorchConfig.mock.mockImplementation(() => ({
      scheduler: { paused: { daily: ['agent2'] } }
    }));

    const result = await cmdCheck('daily', deps);

    assert.deepStrictEqual(result.available, ['agent1', 'agent3']);
    assert.deepStrictEqual(result.locked, []);
    assert.deepStrictEqual(result.paused, ['agent2']);
    assert.deepStrictEqual(result.excluded, ['agent2']);
  });

  it('handles agents that are both locked and paused', async () => {
    mockGetRoster.mock.mockImplementation(() => ['agent1', 'agent2']);
    mockQueryLocks.mock.mockImplementation(async () => [
      { agent: 'agent1', eventId: 'evt1' }
    ]);
    mockLoadTorchConfig.mock.mockImplementation(() => ({
      scheduler: { paused: { daily: ['agent1'] } }
    }));

    const result = await cmdCheck('daily', deps);

    assert.deepStrictEqual(result.available, ['agent2']);
    assert.deepStrictEqual(result.locked, ['agent1']);
    assert.deepStrictEqual(result.paused, ['agent1']);
    // excluded should contain unique agents
    assert.deepStrictEqual(result.excluded, ['agent1']);
  });

  it('identifies unknown locked agents (not in roster)', async () => {
    mockGetRoster.mock.mockImplementation(() => ['agent1']);
    mockQueryLocks.mock.mockImplementation(async () => [
      { agent: 'agent1', eventId: 'evt1' },
      { agent: 'unknown-agent', eventId: 'evt2' }
    ]);
    mockLoadTorchConfig.mock.mockImplementation(() => ({
      scheduler: { paused: { daily: [] } }
    }));

    const result = await cmdCheck('daily', deps);

    assert.deepStrictEqual(result.available, []);
    assert.deepStrictEqual(result.locked, ['agent1', 'unknown-agent']);
    assert.deepStrictEqual(result.unknownLockedAgents, ['unknown-agent']);
    assert.deepStrictEqual(result.excluded, ['agent1', 'unknown-agent']);
  });

  it('handles weekly cadence', async () => {
    mockGetRoster.mock.mockImplementation(() => ['weekly1', 'weekly2']);
    mockQueryLocks.mock.mockImplementation(async () => []);
    mockLoadTorchConfig.mock.mockImplementation(() => ({
      scheduler: { paused: { weekly: ['weekly2'] } }
    }));

    const result = await cmdCheck('weekly', deps);

    assert.strictEqual(result.cadence, 'weekly');
    assert.deepStrictEqual(result.available, ['weekly1']);
    assert.deepStrictEqual(result.paused, ['weekly2']);
  });

  it('handles empty roster', async () => {
    mockGetRoster.mock.mockImplementation(() => []);
    mockQueryLocks.mock.mockImplementation(async () => []);
    mockLoadTorchConfig.mock.mockImplementation(() => ({
      scheduler: { paused: { daily: [] } }
    }));

    const result = await cmdCheck('daily', deps);

    assert.deepStrictEqual(result.available, []);
    assert.deepStrictEqual(result.locked, []);
    assert.deepStrictEqual(result.paused, []);
  });
});
