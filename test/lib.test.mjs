import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { cmdCheck, cmdLock, cmdList, cmdComplete } from '../src/lib.mjs';

describe('src/lib.mjs', () => {
  // Common mocks
  const mockRelays = ['wss://relay.test'];
  const mockNamespace = 'test-ns';
  const mockTtl = 3600;
  const mockRoster = ['agent1', 'agent2', 'agent3'];
  const mockDateStr = new Date().toISOString().slice(0, 10);

  let logs = [];
  let errors = [];

  const mockLog = (...args) => logs.push(args.join(' '));
  const mockError = (...args) => errors.push(args.join(' '));

  const baseDeps = {
    getRelays: () => mockRelays,
    getNamespace: () => mockNamespace,
    getTtl: () => mockTtl,
    getRoster: () => mockRoster,
    loadTorchConfig: () => ({ scheduler: { paused: { daily: [], weekly: [] } } }),
    getDateStr: () => mockDateStr,
    log: mockLog,
    error: mockError,
    readdir: async () => [],
  };

  beforeEach(() => {
    logs = [];
    errors = [];
  });

  describe('cmdCheck', () => {
    it('returns correct structure with empty locks', async () => {
      const deps = {
        ...baseDeps,
        queryLocks: async () => [],
      };

      const result = await cmdCheck('daily', deps);

      assert.strictEqual(result.namespace, mockNamespace);
      assert.strictEqual(result.cadence, 'daily');
      assert.strictEqual(result.date, mockDateStr);
      assert.deepStrictEqual(result.locked, []);
      assert.deepStrictEqual(result.available, mockRoster.sort());
      assert.strictEqual(result.lockCount, 0);
    });

    it('identifies locked agents', async () => {
      const locks = [
        { agent: 'agent1', eventId: 'ev1', createdAtIso: 'iso1', platform: 'test' }
      ];
      const deps = {
        ...baseDeps,
        queryLocks: async () => locks,
      };

      const result = await cmdCheck('daily', deps);

      assert.deepStrictEqual(result.locked, ['agent1']);
      assert.deepStrictEqual(result.available, ['agent2', 'agent3']);
      assert.strictEqual(result.lockCount, 1);
    });

    it('excludes paused agents', async () => {
      const deps = {
        ...baseDeps,
        queryLocks: async () => [],
        loadTorchConfig: () => ({ scheduler: { paused: { daily: ['agent2'], weekly: [] } } }),
      };

      const result = await cmdCheck('daily', deps);

      assert.deepStrictEqual(result.paused, ['agent2']);
      assert.deepStrictEqual(result.excluded, ['agent2']);
      assert.deepStrictEqual(result.available, ['agent1', 'agent3']);
    });

    it('identifies unknown locked agents', async () => {
      const locks = [
        { agent: 'unknown-agent', eventId: 'ev1' }
      ];
      const deps = {
        ...baseDeps,
        queryLocks: async () => locks,
      };

      const result = await cmdCheck('daily', deps);

      assert.deepStrictEqual(result.unknownLockedAgents, ['unknown-agent']);
      assert.deepStrictEqual(result.locked, ['unknown-agent']);
      // unknown agents are not in roster, so available should be full roster (since no roster agent is locked)
      assert.deepStrictEqual(result.available, mockRoster.sort());
    });
  });

  describe('cmdLock', () => {
    const mockPublishLock = async () => {};
    const mockGenerateSecretKey = () => new Uint8Array(32);
    const mockGetPublicKey = () => 'mock-pubkey';
    const mockFinalizeEvent = (t) => ({ ...t, id: 'mock-id', sig: 'mock-sig' });

    it('successfully locks an available agent', async () => {
      let published = false;
      const deps = {
        ...baseDeps,
        queryLocks: async () => [], // No existing locks, and race check returns empty
        publishLock: async () => { published = true; },
        generateSecretKey: mockGenerateSecretKey,
        getPublicKey: mockGetPublicKey,
        finalizeEvent: mockFinalizeEvent,
        raceCheckDelayMs: 1, // Fast race check
      };

      const result = await cmdLock('agent1', 'daily', false, deps);

      assert.strictEqual(result.status, 'ok');
      assert.strictEqual(result.eventId, 'mock-id');
      assert.strictEqual(published, true);
      assert.match(logs.join('\n'), /LOCK_STATUS=ok/);
    });

    it('fails if agent is not in roster', async () => {
      const deps = { ...baseDeps };

      await assert.rejects(
        async () => await cmdLock('unknown', 'daily', false, deps),
        (err) => err.code === 1 && err.message === 'Agent not in roster'
      );
    });

    it('fails if agent is already locked', async () => {
      const existingLocks = [
        { agent: 'agent1', eventId: 'existing', createdAt: 100, createdAtIso: 'time' }
      ];
      const deps = {
        ...baseDeps,
        queryLocks: async () => existingLocks,
      };

      await assert.rejects(
        async () => await cmdLock('agent1', 'daily', false, deps),
        (err) => err.code === 3 && err.message === 'Lock denied'
      );
      assert.match(logs.join('\n'), /LOCK_STATUS=denied/);
    });

    it('fails if agent is already completed', async () => {
      const existingLocks = [
        { agent: 'agent1', eventId: 'done-id', status: 'completed' }
      ];
      const deps = {
        ...baseDeps,
        queryLocks: async () => existingLocks,
      };

      await assert.rejects(
        async () => await cmdLock('agent1', 'daily', false, deps),
        (err) => err.code === 3 && err.message === 'Task already completed'
      );
      assert.match(logs.join('\n'), /LOCK_STATUS=denied/);
      assert.match(logs.join('\n'), /LOCK_REASON=already_completed/);
    });

    it('fails if race check is lost', async () => {
      let callCount = 0;
      const deps = {
        ...baseDeps,
        queryLocks: async () => {
          callCount++;
          if (callCount === 1) return []; // First check: no locks
          // Second check (race): found an earlier lock
          return [{
            agent: 'agent1',
            eventId: 'winner',
            createdAt: 100, // old timestamp
            createdAtIso: 'old-time'
          }, {
            agent: 'agent1',
            eventId: 'mock-id',
            createdAt: 200, // our timestamp (mocked event)
          }];
        },
        publishLock: async () => {},
        generateSecretKey: mockGenerateSecretKey,
        getPublicKey: mockGetPublicKey,
        finalizeEvent: mockFinalizeEvent,
        raceCheckDelayMs: 1,
      };

      await assert.rejects(
        async () => await cmdLock('agent1', 'daily', false, deps),
        (err) => err.code === 3 && err.message === 'Race check lost'
      );
      assert.match(logs.join('\n'), /LOCK_STATUS=race_lost/);
    });

    it('dry run does not publish', async () => {
      let published = false;
      const deps = {
        ...baseDeps,
        queryLocks: async () => [],
        publishLock: async () => { published = true; },
        generateSecretKey: mockGenerateSecretKey,
        getPublicKey: mockGetPublicKey,
        finalizeEvent: mockFinalizeEvent,
      };

      const result = await cmdLock('agent1', 'daily', true, deps);

      assert.strictEqual(result.status, 'ok');
      assert.strictEqual(published, false);
      assert.match(errors.join('\n'), /\[DRY RUN\]/);
    });
  });

  describe('cmdList', () => {
    it('lists active locks', async () => {
      const locks = [
        { agent: 'agent1', eventId: 'ev1', createdAt: Date.now()/1000 - 60, createdAtIso: 'iso1', platform: 'test' }
      ];
      const deps = {
        ...baseDeps,
        queryLocks: async () => locks,
      };

      await cmdList('daily', deps);

      const output = logs.join('\n');
      assert.match(output, /Active test-ns daily locks/);
      assert.match(output, /agent1/);
      assert.match(output, /Locked: 1\/3/);
    });

    it('warns about unknown agents', async () => {
       const locks = [
        { agent: 'unknown', eventId: 'ev1', createdAt: Date.now()/1000 }
      ];
      const deps = {
        ...baseDeps,
        queryLocks: async () => locks,
      };

      await cmdList('daily', deps);

      const output = logs.join('\n');
      assert.match(output, /Warning: lock events found with non-roster agent names: unknown/);
    });

    it('handles no locks', async () => {
      const deps = {
        ...baseDeps,
        queryLocks: async () => [],
      };

      await cmdList('daily', deps);

      const output = logs.join('\n');
      assert.match(output, /\(no active locks\)/);
    });
  });

  describe('cmdComplete', () => {
    const mockPublishLock = async () => {};
    const mockGenerateSecretKey = () => new Uint8Array(32);
    const mockGetPublicKey = () => 'mock-pubkey';
    const mockFinalizeEvent = (t) => ({ ...t, id: 'mock-id-complete' });

    it('successfully completes an active lock', async () => {
      let publishedEvent = null;
      const locks = [
        { agent: 'agent1', eventId: 'lock-id', createdAt: 100, createdAtIso: 'iso1', status: 'started' }
      ];
      const deps = {
        ...baseDeps,
        queryLocks: async () => locks,
        publishLock: async (relays, evt) => { publishedEvent = evt; },
        generateSecretKey: mockGenerateSecretKey,
        getPublicKey: mockGetPublicKey,
        finalizeEvent: mockFinalizeEvent,
      };

      const result = await cmdComplete('agent1', 'daily', false, deps);

      assert.strictEqual(result.status, 'completed');
      assert.strictEqual(result.eventId, 'mock-id-complete');
      assert.ok(publishedEvent);
      // Verify no expiration tag
      const expTag = publishedEvent.tags.find(t => t[0] === 'expiration');
      assert.strictEqual(expTag, undefined);
      // Verify content
      const content = JSON.parse(publishedEvent.content);
      assert.strictEqual(content.status, 'completed');
      assert.strictEqual(content.startedAt, 'iso1');
      assert.match(logs.join('\n'), /LOCK_STATUS=completed/);
    });

    it('fails if no active lock found', async () => {
      const deps = {
        ...baseDeps,
        queryLocks: async () => [], // No locks
      };

      await assert.rejects(
        async () => await cmdComplete('agent1', 'daily', false, deps),
        (err) => err.code === 1 && err.message === 'No active lock found'
      );
    });

    it('detects already completed task', async () => {
      const locks = [
        { agent: 'agent1', eventId: 'done-id', status: 'completed' }
      ];
      const deps = {
        ...baseDeps,
        queryLocks: async () => locks,
      };

      const result = await cmdComplete('agent1', 'daily', false, deps);
      assert.strictEqual(result.status, 'completed');
      assert.strictEqual(result.eventId, 'done-id');
      assert.match(logs.join('\n'), /LOCK_STATUS=completed/);
    });
  });
});
