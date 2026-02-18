import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert';
import { cmdLock } from '../src/cmd-lock.mjs';
import { ExitError } from '../src/errors.mjs';

describe('cmdLock', () => {
  let deps;
  let mockGetRelays;
  let mockGetNamespace;
  let mockGetHashtag;
  let mockGetTtl;
  let mockGetRoster;
  let mockQueryLocks;
  let mockPublishLock;
  let mockGenerateSecretKey;
  let mockGetPublicKey;
  let mockFinalizeEvent;
  let mockGetDateStr;
  let mockNowUnix;
  let mockDetectPlatform;
  let mockConsoleLog;
  let mockConsoleError;
  let consoleLogOutput;
  let consoleErrorOutput;

  beforeEach(() => {
    mockGetRelays = mock.fn(async () => ['wss://mock-relay']);
    mockGetNamespace = mock.fn(async () => 'mock-namespace');
    mockGetHashtag = mock.fn(async () => 'mock-hashtag');
    mockGetTtl = mock.fn(async () => 3600);
    mockGetRoster = mock.fn(async () => ['agent1', 'agent2']);
    mockQueryLocks = mock.fn(async () => []);
    mockPublishLock = mock.fn(async () => {});
    mockGenerateSecretKey = mock.fn(() => new Uint8Array([1, 2, 3]));
    mockGetPublicKey = mock.fn(() => 'mock-pubkey');
    mockFinalizeEvent = mock.fn((t, k) => ({ ...t, id: 'mock-event-id', sig: 'mock-sig' }));
    mockGetDateStr = mock.fn(() => '2023-10-27');
    mockNowUnix = mock.fn(() => 1698364800);
    mockDetectPlatform = mock.fn(() => 'linux');

    consoleLogOutput = [];
    consoleErrorOutput = [];
    mockConsoleLog = mock.fn((msg) => consoleLogOutput.push(msg));
    mockConsoleError = mock.fn((msg) => consoleErrorOutput.push(msg));

    deps = {
      getRelays: mockGetRelays,
      getNamespace: mockGetNamespace,
      getHashtag: mockGetHashtag,
      getTtl: mockGetTtl,
      queryLocks: mockQueryLocks,
      getRoster: mockGetRoster,
      publishLock: mockPublishLock,
      generateSecretKey: mockGenerateSecretKey,
      getPublicKey: mockGetPublicKey,
      finalizeEvent: mockFinalizeEvent,
      getDateStr: mockGetDateStr,
      nowUnix: mockNowUnix,
      detectPlatform: mockDetectPlatform,
      log: mockConsoleLog,
      error: mockConsoleError,
      raceCheckDelayMs: 0,
    };
  });

  it('successfully acquires a lock', async () => {
    const result = await cmdLock('agent1', 'daily', false, deps);

    assert.strictEqual(result.status, 'ok');
    assert.strictEqual(result.eventId, 'mock-event-id');

    // Verify logs
    assert.ok(consoleLogOutput.includes('LOCK_STATUS=ok'));
    assert.ok(consoleLogOutput.includes('LOCK_AGENT=agent1'));
    assert.ok(consoleLogOutput.includes('LOCK_EVENT_ID=mock-event-id'));

    // Verify publish called
    assert.strictEqual(mockPublishLock.mock.callCount(), 1);
  });

  it('fails if agent is not in roster', async () => {
    mockGetRoster.mock.mockImplementation(async () => ['other-agent']);

    await assert.rejects(
      async () => await cmdLock('agent1', 'daily', false, deps),
      (err) => {
        assert.ok(err instanceof ExitError);
        assert.strictEqual(err.code, 1);
        assert.strictEqual(err.message, 'Agent not in roster');
        return true;
      }
    );
  });

  it('fails if lock already exists', async () => {
    mockQueryLocks.mock.mockImplementation(async () => [
      { agent: 'agent1', eventId: 'existing-event', createdAt: 100, createdAtIso: 'iso', platform: 'linux' }
    ]);

    await assert.rejects(
      async () => await cmdLock('agent1', 'daily', false, deps),
      (err) => {
        assert.ok(err instanceof ExitError);
        assert.strictEqual(err.code, 3);
        assert.strictEqual(err.message, 'Lock denied');
        return true;
      }
    );

    assert.ok(consoleLogOutput.includes('LOCK_STATUS=denied'));
    assert.ok(consoleLogOutput.includes('LOCK_REASON=already_locked'));
  });

  it('fails if task already completed', async () => {
    mockQueryLocks.mock.mockImplementation(async () => [
      { agent: 'agent1', eventId: 'completed-event', status: 'completed', createdAt: 100 }
    ]);

    await assert.rejects(
      async () => await cmdLock('agent1', 'daily', false, deps),
      (err) => {
        assert.ok(err instanceof ExitError);
        assert.strictEqual(err.code, 3);
        assert.strictEqual(err.message, 'Task already completed');
        return true;
      }
    );

    assert.ok(consoleLogOutput.includes('LOCK_STATUS=denied'));
    assert.ok(consoleLogOutput.includes('LOCK_REASON=already_completed'));
  });

  it('fails race check if another lock appears', async () => {
    // queryLocks is called twice: once before publish, once after.
    // First call returns empty.
    // Second call returns another lock with earlier timestamp.
    let callCount = 0;
    mockQueryLocks.mock.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) return [];
        return [
            { agent: 'agent1', eventId: 'mock-event-id', createdAt: 1698364800 }, // My lock
            { agent: 'agent1', eventId: 'winner-event', createdAt: 1698364700, createdAtIso: 'earlier' } // Winner
        ];
    });

    await assert.rejects(
      async () => await cmdLock('agent1', 'daily', false, deps),
      (err) => {
        assert.ok(err instanceof ExitError);
        assert.strictEqual(err.code, 3);
        assert.strictEqual(err.message, 'Race check lost');
        return true;
      }
    );

    assert.ok(consoleLogOutput.includes('LOCK_STATUS=race_lost'));
    assert.ok(consoleLogOutput.includes('LOCK_WINNER_EVENT=winner-event'));
  });

  it('wins race check if my lock is earliest', async () => {
      // queryLocks is called twice.
      // Second call returns another lock with LATER timestamp.
      let callCount = 0;
      mockQueryLocks.mock.mockImplementation(async () => {
          callCount++;
          if (callCount === 1) return [];
          return [
              { agent: 'agent1', eventId: 'mock-event-id', createdAt: 1698364800 }, // My lock
              { agent: 'agent1', eventId: 'loser-event', createdAt: 1698364900 } // Loser
          ];
      });

      const result = await cmdLock('agent1', 'daily', false, deps);
      assert.strictEqual(result.status, 'ok');
  });

  it('dry run skips publish', async () => {
    const result = await cmdLock('agent1', 'daily', true, deps); // dryRun = true

    assert.strictEqual(result.status, 'ok');
    assert.strictEqual(mockPublishLock.mock.callCount(), 0);
    // queryLocks should be called only once (initial check)
    assert.strictEqual(mockQueryLocks.mock.callCount(), 1);
  });

  it('uses options object for dryRun', async () => {
    const result = await cmdLock('agent1', 'daily', { dryRun: true }, deps);

    assert.strictEqual(result.status, 'ok');
    assert.strictEqual(mockPublishLock.mock.callCount(), 0);
  });
});
