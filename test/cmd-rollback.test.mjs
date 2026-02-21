import { describe, it } from 'node:test';
import assert from 'node:assert';
import { cmdRollback } from '../src/cmd-rollback.mjs';
import { ExitError } from '../src/errors.mjs';

describe('cmdRollback', () => {
  it('should throw ExitError if target is missing', async () => {
    const deps = {
      error: () => {},
    };
    await assert.rejects(
      async () => cmdRollback(undefined, undefined, {}, deps),
      (err) => err instanceof ExitError && err.code === 1 && err.message === 'Missing target'
    );
  });

  it('should list versions when list option is true', async () => {
    const logs = [];
    const mockVersions = [{ hash: 'abc', archivedAt: '2023-01-01' }];
    const deps = {
      listPromptVersions: async (target) => {
        assert.strictEqual(target, 'foo.md');
        return mockVersions;
      },
      log: (msg) => logs.push(msg),
      error: () => {},
    };

    await cmdRollback('foo.md', undefined, { list: true }, deps);
    assert.strictEqual(logs.length, 1);
    assert.deepStrictEqual(JSON.parse(logs[0]), mockVersions);
  });

  it('should throw ExitError if list versions fails', async () => {
     const deps = {
      listPromptVersions: async () => { throw new Error('fail'); },
      log: () => {},
      error: () => {}, // suppress error output
    };

    await assert.rejects(
      async () => cmdRollback('foo.md', undefined, { list: true }, deps),
      (err) => err instanceof ExitError && err.code === 1 && err.message === 'List versions failed'
    );
  });

  it('should rollback to latest if strategy is missing', async () => {
    const logs = [];
    const mockResult = { success: true, restored: 'HEAD' };
    const deps = {
      rollbackPrompt: async (target, strategy) => {
        assert.strictEqual(target, 'foo.md');
        assert.strictEqual(strategy, 'latest');
        return mockResult;
      },
      log: (msg) => logs.push(msg),
      error: () => {},
    };

    await cmdRollback('foo.md', undefined, {}, deps);
    assert.strictEqual(logs.length, 1);
    assert.deepStrictEqual(JSON.parse(logs[0]), mockResult);
  });

  it('should rollback to specific strategy', async () => {
    const logs = [];
    const mockResult = { success: true, restored: 'hash123' };
    const deps = {
      rollbackPrompt: async (target, strategy) => {
        assert.strictEqual(target, 'foo.md');
        assert.strictEqual(strategy, 'hash123');
        return mockResult;
      },
      log: (msg) => logs.push(msg),
      error: () => {},
    };

    await cmdRollback('foo.md', 'hash123', {}, deps);
    assert.strictEqual(logs.length, 1);
    assert.deepStrictEqual(JSON.parse(logs[0]), mockResult);
  });

  it('should throw ExitError if rollback fails', async () => {
    const deps = {
      rollbackPrompt: async () => { throw new Error('fail'); },
      log: () => {},
      error: () => {},
    };

    await assert.rejects(
      async () => cmdRollback('foo.md', 'latest', {}, deps),
      (err) => err instanceof ExitError && err.message === 'Rollback failed'
    );
  });
});
