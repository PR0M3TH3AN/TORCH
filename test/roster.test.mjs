import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { getRoster, _resetRosterCache, _setRosterDependencies, _restoreRosterDependencies } from '../src/roster.mjs';

// Mock dependencies
const mockFs = {
  promises: {
    readFile: mock.fn(),
  },
};

const mockLoadTorchConfig = mock.fn();

describe('Roster (Unit Tests with Dependency Injection)', () => {
  const CWD = process.cwd();
  const USER_ROSTER_FILE = path.resolve(CWD, 'torch/roster.json');
  const CWD_ROSTER_FILE = path.resolve(CWD, 'roster.json');

  // Mock console.error to suppress warnings
  const originalConsoleError = console.error;
  let mockConsoleError;

  beforeEach(() => {
    mockConsoleError = mock.fn();
    console.error = mockConsoleError;

    _resetRosterCache();
    mockFs.promises.readFile.mock.resetCalls();
    mockLoadTorchConfig.mock.resetCalls();

    // Default: config returns empty nostrLock
    mockLoadTorchConfig.mock.mockImplementation(async () => ({ nostrLock: {} }));

    // Default: fs.promises.readFile returns ENOENT
    mockFs.promises.readFile.mock.mockImplementation(async () => {
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
    });

    // Inject mocks
    _setRosterDependencies({
      fs: mockFs,
      loadTorchConfig: mockLoadTorchConfig
    });

    // Clear env vars
    delete process.env.NOSTR_LOCK_DAILY_ROSTER;
    delete process.env.NOSTR_LOCK_WEEKLY_ROSTER;
  });

  afterEach(() => {
    _restoreRosterDependencies();
    console.error = originalConsoleError;
    mock.reset();
  });

  it('returns fallback roster when no configuration or files exist', async () => {
    const roster = await getRoster('daily');
    assert.ok(Array.isArray(roster));
    assert.ok(roster.length > 0);
    assert.ok(roster.includes('audit-agent')); // verification of fallback content
  });

  it('loads internal module roster if user/cwd rosters are missing', async () => {
    // When reading file, if it's not USER or CWD (implied by default ENOENT), check ROSTER_FILE logic?
    // Wait, the logic tries USER -> CWD -> ROSTER.
    // So if first two fail (default), third one should succeed for this test.

    // We need to verify that it eventually reads internal roster (ROSTER_FILE).
    // But since we don't know the exact path of ROSTER_FILE easily in test (it depends on import.meta.url),
    // we can just say "if not USER or CWD, return content".

    mockFs.promises.readFile.mock.mockImplementation(async (filepath) => {
        if (filepath === USER_ROSTER_FILE || filepath === CWD_ROSTER_FILE) {
            const err = new Error('ENOENT');
            err.code = 'ENOENT';
            throw err;
        }
        return JSON.stringify({ daily: ['internal-daily'], weekly: ['internal-weekly'] });
    });

    const daily = await getRoster('daily');
    assert.deepStrictEqual(daily, ['internal-daily']);
  });

  it('loads roster from torch/roster.json (User Roster) if present', async () => {
    mockFs.promises.readFile.mock.mockImplementation(async (filepath) => {
        if (filepath === USER_ROSTER_FILE) {
            return JSON.stringify({ daily: ['user-agent-daily'], weekly: ['user-agent-weekly'] });
        }
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
    });

    const daily = await getRoster('daily');
    const weekly = await getRoster('weekly');

    assert.deepStrictEqual(daily, ['user-agent-daily']);
    assert.deepStrictEqual(weekly, ['user-agent-weekly']);

    // Should be cached after first call
    // Note: getRoster calls loadCanonicalRoster each time but it caches result internally.
    // However, since we call getRoster twice, and result is cached, readFile should be called once.
    assert.strictEqual(mockFs.promises.readFile.mock.calls.length, 1);
  });

  it('loads roster from roster.json (CWD Roster) if present and torch/roster.json is missing', async () => {
    mockFs.promises.readFile.mock.mockImplementation(async (filepath) => {
        if (filepath === CWD_ROSTER_FILE) {
            return JSON.stringify({ daily: ['cwd-agent-daily'], weekly: ['cwd-agent-weekly'] });
        }
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
    });

    const daily = await getRoster('daily');
    assert.deepStrictEqual(daily, ['cwd-agent-daily']);
  });

  it('falls back to default if roster file is malformed', async () => {
    mockFs.promises.readFile.mock.mockImplementation(async (filepath) => {
        if (filepath === USER_ROSTER_FILE) {
            return '{ invalid json }';
        }
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
    });

    // Should catch error and return fallback
    const daily = await getRoster('daily');
    assert.ok(daily.includes('audit-agent'));

    // Should have tried to read file
    assert.strictEqual(mockFs.promises.readFile.mock.calls.length, 1);
  });

  it('falls back to default if roster file is missing daily/weekly arrays', async () => {
    mockFs.promises.readFile.mock.mockImplementation(async (filepath) => {
        if (filepath === USER_ROSTER_FILE) {
            return JSON.stringify({ other: [] });
        }
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
    });

    const daily = await getRoster('daily');
    assert.ok(daily.includes('audit-agent'));
  });

  it('prioritizes environment variables over file and config', async () => {
    process.env.NOSTR_LOCK_DAILY_ROSTER = 'env-agent-daily';

    // Setup file to exist
    mockFs.promises.readFile.mock.mockImplementation(async (filepath) => {
        if (filepath === USER_ROSTER_FILE) {
            return JSON.stringify({ daily: ['file-agent'] });
        }
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
    });

    const daily = await getRoster('daily');
    assert.deepStrictEqual(daily, ['env-agent-daily']);
  });

  it('prioritizes config over file', async () => {
    mockLoadTorchConfig.mock.mockImplementation(async () => ({
        nostrLock: { dailyRoster: ['config-agent-daily'] }
    }));

    // Setup file to exist
    mockFs.promises.readFile.mock.mockImplementation(async (filepath) => {
        if (filepath === USER_ROSTER_FILE) {
            return JSON.stringify({ daily: ['file-agent'] });
        }
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
    });

    const daily = await getRoster('daily');
    assert.deepStrictEqual(daily, ['config-agent-daily']);
  });

  it('handles multiple items in env var roster', async () => {
    process.env.NOSTR_LOCK_DAILY_ROSTER = 'agent1, agent2,agent3 ';
    const daily = await getRoster('daily');
    assert.deepStrictEqual(daily, ['agent1', 'agent2', 'agent3']);
  });
});
