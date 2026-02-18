import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { getRoster, _resetRosterCache } from '../src/roster.mjs';

describe('Roster (Unit Tests with Dependency Injection)', () => {
  const CWD = process.cwd();
  const USER_ROSTER_FILE = path.resolve(CWD, 'torch/roster.json');
  const CWD_ROSTER_FILE = path.resolve(CWD, 'roster.json');

  const mockFs = {
    existsSync: mock.fn(),
    readFileSync: mock.fn(),
  };

  const mockLoadTorchConfig = mock.fn();
  const originalConsoleError = console.error;

  beforeEach(() => {
    _resetRosterCache();
    mockFs.existsSync.mock.resetCalls();
    mockFs.readFileSync.mock.resetCalls();
    mockLoadTorchConfig.mock.resetCalls();
    console.error = mock.fn();

    // Default: config returns empty nostrLock
    mockLoadTorchConfig.mock.mockImplementation(async () => ({ nostrLock: {} }));

    // Default: fs.existsSync returns false (no files found)
    mockFs.existsSync.mock.mockImplementation(() => false);

    // Default: fs.readFileSync returns empty object
    mockFs.readFileSync.mock.mockImplementation(() => '{}');

    // Clear env vars
    delete process.env.NOSTR_LOCK_DAILY_ROSTER;
    delete process.env.NOSTR_LOCK_WEEKLY_ROSTER;
  });

  afterEach(() => {
    mock.reset();
    console.error = originalConsoleError;
  });

  it('returns fallback roster when no configuration or files exist', async () => {
    const deps = { fs: mockFs, loadTorchConfig: mockLoadTorchConfig };
    const roster = await getRoster('daily', deps);
    assert.ok(Array.isArray(roster));
    assert.ok(roster.length > 0);
    assert.ok(roster.includes('audit-agent'));
  });

  it('loads roster from torch/roster.json (User Roster) if present', async () => {
    mockFs.existsSync.mock.mockImplementation((filepath) => filepath === USER_ROSTER_FILE);
    mockFs.readFileSync.mock.mockImplementation((filepath) => {
        if (filepath === USER_ROSTER_FILE) {
            return JSON.stringify({ daily: ['user-agent-daily'], weekly: ['user-agent-weekly'] });
        }
        throw new Error('ENOENT');
    });

    const deps = { fs: mockFs, loadTorchConfig: mockLoadTorchConfig };
    const daily = await getRoster('daily', deps);
    const weekly = await getRoster('weekly', deps);

    assert.deepStrictEqual(daily, ['user-agent-daily']);
    assert.deepStrictEqual(weekly, ['user-agent-weekly']);
    assert.strictEqual(mockFs.readFileSync.mock.calls.length, 1);
  });

  it('loads roster from roster.json (CWD Roster) if present and torch/roster.json is missing', async () => {
    mockFs.existsSync.mock.mockImplementation((filepath) => filepath === CWD_ROSTER_FILE);
    mockFs.readFileSync.mock.mockImplementation((filepath) => {
        if (filepath === CWD_ROSTER_FILE) {
            return JSON.stringify({ daily: ['cwd-agent-daily'], weekly: ['cwd-agent-weekly'] });
        }
        throw new Error('ENOENT');
    });

    const deps = { fs: mockFs, loadTorchConfig: mockLoadTorchConfig };
    const daily = await getRoster('daily', deps);
    assert.deepStrictEqual(daily, ['cwd-agent-daily']);
  });

  it('falls back to default if roster file is malformed', async () => {
    mockFs.existsSync.mock.mockImplementation((filepath) => filepath === USER_ROSTER_FILE);
    mockFs.readFileSync.mock.mockImplementation(() => '{ invalid json }');

    const deps = { fs: mockFs, loadTorchConfig: mockLoadTorchConfig };
    // Should catch error and return fallback
    const daily = await getRoster('daily', deps);
    assert.ok(daily.includes('audit-agent'));

    // Should have tried to read file
    assert.strictEqual(mockFs.readFileSync.mock.calls.length, 1);
  });

  it('falls back to default if roster file is missing daily/weekly arrays', async () => {
    mockFs.existsSync.mock.mockImplementation((filepath) => filepath === USER_ROSTER_FILE);
    mockFs.readFileSync.mock.mockImplementation(() => JSON.stringify({ other: [] }));

    const deps = { fs: mockFs, loadTorchConfig: mockLoadTorchConfig };
    const daily = await getRoster('daily', deps);
    assert.ok(daily.includes('audit-agent'));
  });

  it('prioritizes environment variables over file and config', async () => {
    process.env.NOSTR_LOCK_DAILY_ROSTER = 'env-agent-daily';

    // Setup file to exist
    mockFs.existsSync.mock.mockImplementation((filepath) => filepath === USER_ROSTER_FILE);
    mockFs.readFileSync.mock.mockImplementation(() => JSON.stringify({ daily: ['file-agent'] }));

    const deps = { fs: mockFs, loadTorchConfig: mockLoadTorchConfig };
    const daily = await getRoster('daily', deps);
    assert.deepStrictEqual(daily, ['env-agent-daily']);
  });

  it('prioritizes config over file', async () => {
    mockLoadTorchConfig.mock.mockImplementation(async () => ({
        nostrLock: { dailyRoster: ['config-agent-daily'] }
    }));

    // Setup file to exist
    mockFs.existsSync.mock.mockImplementation((filepath) => filepath === USER_ROSTER_FILE);
    mockFs.readFileSync.mock.mockImplementation(() => JSON.stringify({ daily: ['file-agent'] }));

    const deps = { fs: mockFs, loadTorchConfig: mockLoadTorchConfig };
    const daily = await getRoster('daily', deps);
    assert.deepStrictEqual(daily, ['config-agent-daily']);
  });

  it('handles multiple items in env var roster', async () => {
    process.env.NOSTR_LOCK_DAILY_ROSTER = 'agent1, agent2,agent3 ';
    const deps = { fs: mockFs, loadTorchConfig: mockLoadTorchConfig };
    const daily = await getRoster('daily', deps);
    assert.deepStrictEqual(daily, ['agent1', 'agent2', 'agent3']);
  });
});
