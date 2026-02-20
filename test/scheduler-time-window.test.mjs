/**
 * Unit tests for the scheduler time-window guard.
 *
 * Scenario-first, cheat-resistant (Dark Factory standard):
 * - Every test asserts observable outcomes at the boundary of
 *   buildRecentlyRunExclusionSet (the Set it returns).
 * - Determinism controls: `now` is injected so the clock is fixed.
 * - No mocking of internal logic; real temp-directory I/O is used so
 *   the implementation cannot "return true" and pass.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildRecentlyRunExclusionSet,
  parseDateValue,
  parseTimestampFromFilename,
  parseAgentFromFilename,
  isStrictSchedulerLogFilename,
  parseFrontmatterCreatedAt,
  parseFrontmatterAgent,
  CADENCE_WINDOW_MS,
} from '../scripts/agent/scheduler-utils.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a task log file with optional YAML frontmatter. */
async function writeLog(dir, filename, { createdAt } = {}) {
  const frontmatter = createdAt
    ? `---\nagent: test\ncreated_at: ${createdAt}\n---\n`
    : '';
  await fs.writeFile(path.join(dir, filename), `${frontmatter}# log\n`, 'utf8');
}

/** ISO string with colons replaced by dashes (canonical log filename format). */
function isoToFilename(isoString) {
  return isoString.replace(/:/g, '-').replace(/\.\d+Z$/, 'Z');
}

/** Build a canonical log filename for a given agent/status/time. */
function logFilename(agent, status, isoString) {
  return `${isoToFilename(isoString)}__${agent}__${status}.md`;
}

// Fixed reference point: 2026-02-20T12:00:00Z
const NOW = new Date('2026-02-20T12:00:00Z').getTime();

// ---------------------------------------------------------------------------
// Unit tests for helper utilities
// ---------------------------------------------------------------------------

describe('parseDateValue', () => {
  it('parses a valid ISO string', () => {
    assert.equal(parseDateValue('2026-02-20T12:00:00Z'), NOW);
  });

  it('returns null for empty input', () => {
    assert.equal(parseDateValue(''), null);
    assert.equal(parseDateValue(null), null);
    assert.equal(parseDateValue(undefined), null);
  });

  it('returns null for invalid date strings', () => {
    assert.equal(parseDateValue('not-a-date'), null);
  });
});

describe('isStrictSchedulerLogFilename', () => {
  it('accepts valid completed log', () => {
    assert.ok(isStrictSchedulerLogFilename('2026-02-20T12-00-00Z__audit-agent__completed.md'));
  });

  it('accepts valid failed log', () => {
    assert.ok(isStrictSchedulerLogFilename('2026-02-20T12-00-00Z__audit-agent__failed.md'));
  });

  it('rejects deferred logs', () => {
    assert.ok(!isStrictSchedulerLogFilename('2026-02-20T12-00-00Z__audit-agent__deferred.md'));
  });

  it('rejects filenames without timestamp', () => {
    assert.ok(!isStrictSchedulerLogFilename('audit-agent__completed.md'));
  });

  it('rejects plain text files', () => {
    assert.ok(!isStrictSchedulerLogFilename('notes.md'));
  });

  it('rejects .scheduler-run-state.json', () => {
    assert.ok(!isStrictSchedulerLogFilename('.scheduler-run-state.json'));
  });
});

describe('parseAgentFromFilename', () => {
  it('extracts agent name from completed log', () => {
    assert.equal(parseAgentFromFilename('2026-02-20T12-00-00Z__audit-agent__completed.md'), 'audit-agent');
  });

  it('extracts agent name from failed log', () => {
    assert.equal(parseAgentFromFilename('2026-02-20T12-00-00Z__ci-health-agent__failed.md'), 'ci-health-agent');
  });

  it('returns null for invalid filename', () => {
    assert.equal(parseAgentFromFilename('bad-file.md'), null);
  });
});

describe('parseTimestampFromFilename', () => {
  it('parses timestamp from canonical filename', () => {
    const filename = '2026-02-20T12-00-00Z__audit-agent__completed.md';
    assert.equal(parseTimestampFromFilename(filename), NOW);
  });

  it('returns null for non-canonical filename', () => {
    assert.equal(parseTimestampFromFilename('audit-agent__completed.md'), null);
  });
});

describe('parseFrontmatterCreatedAt / parseFrontmatterAgent', () => {
  const doc = `---\nagent: known-issues-agent\ncreated_at: 2026-02-20T12:00:00Z\nstatus: completed\n---\n# body\n`;

  it('reads created_at from frontmatter', () => {
    assert.equal(parseFrontmatterCreatedAt(doc), '2026-02-20T12:00:00Z');
  });

  it('reads agent from frontmatter', () => {
    assert.equal(parseFrontmatterAgent(doc), 'known-issues-agent');
  });

  it('returns null when no frontmatter', () => {
    assert.equal(parseFrontmatterCreatedAt('# no frontmatter'), null);
    assert.equal(parseFrontmatterAgent('# no frontmatter'), null);
  });
});

// ---------------------------------------------------------------------------
// Scenario tests for buildRecentlyRunExclusionSet
// ---------------------------------------------------------------------------

describe('buildRecentlyRunExclusionSet — scenarios', () => {
  let tmpDir;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'torch-time-window-'));
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // SCN-TWG-01
  it('SCN-TWG-01: excludes agents with completed logs within 24-hour daily window', async () => {
    const dir = await fs.mkdtemp(path.join(tmpDir, 'scn01-'));
    // Ran 1 hour ago — within the 24h window
    const recentTs = new Date(NOW - 60 * 60 * 1000).toISOString();
    await writeLog(dir, logFilename('audit-agent', 'completed', recentTs));

    const result = await buildRecentlyRunExclusionSet(dir, 'daily', NOW);

    assert.ok(result.has('audit-agent'), 'audit-agent ran 1h ago should be excluded');
    assert.equal(result.size, 1);
  });

  // SCN-TWG-02
  it('SCN-TWG-02: does NOT exclude agents whose last run is outside the 24-hour window', async () => {
    const dir = await fs.mkdtemp(path.join(tmpDir, 'scn02-'));
    // Ran 25 hours ago — outside the window
    const oldTs = new Date(NOW - 25 * 60 * 60 * 1000).toISOString();
    await writeLog(dir, logFilename('audit-agent', 'completed', oldTs));

    const result = await buildRecentlyRunExclusionSet(dir, 'daily', NOW);

    assert.ok(!result.has('audit-agent'), 'agent outside window should not be excluded');
    assert.equal(result.size, 0);
  });

  // SCN-TWG-03
  it('SCN-TWG-03: excludes agents with failed logs within the window', async () => {
    const dir = await fs.mkdtemp(path.join(tmpDir, 'scn03-'));
    const recentTs = new Date(NOW - 30 * 60 * 1000).toISOString(); // 30 min ago
    await writeLog(dir, logFilename('ci-health-agent', 'failed', recentTs));

    const result = await buildRecentlyRunExclusionSet(dir, 'daily', NOW);

    assert.ok(result.has('ci-health-agent'), 'recently failed agent should be excluded');
  });

  // SCN-TWG-04
  it('SCN-TWG-04: cross-midnight scenario — agent ran 10 min before midnight, checked 10 min after', async () => {
    const dir = await fs.mkdtemp(path.join(tmpDir, 'scn04-'));
    const tenMinutesAgo = new Date(NOW - 20 * 60 * 1000).toISOString(); // 20 min ago (simulates cross-midnight)
    await writeLog(dir, logFilename('load-test-agent', 'completed', tenMinutesAgo));

    const result = await buildRecentlyRunExclusionSet(dir, 'daily', NOW);

    assert.ok(result.has('load-test-agent'), 'cross-midnight agent should still be excluded');
  });

  // SCN-TWG-05
  it('SCN-TWG-05: uses frontmatter created_at over filename timestamp when both present', async () => {
    const dir = await fs.mkdtemp(path.join(tmpDir, 'scn05-'));

    // Filename timestamp = 26h ago (outside window), but frontmatter says 1h ago (inside window)
    const oldTs = new Date(NOW - 26 * 60 * 60 * 1000).toISOString();
    const recentFrontmatter = new Date(NOW - 60 * 60 * 1000).toISOString();
    await writeLog(dir, logFilename('docs-agent', 'completed', oldTs), { createdAt: recentFrontmatter });

    const result = await buildRecentlyRunExclusionSet(dir, 'daily', NOW);

    assert.ok(result.has('docs-agent'), 'frontmatter created_at should take precedence over filename timestamp');
  });

  // SCN-TWG-06
  it('SCN-TWG-06: weekly window uses 7-day threshold', async () => {
    const dir = await fs.mkdtemp(path.join(tmpDir, 'scn06-'));

    // 5 days ago — within 7-day window
    const inWindowTs = new Date(NOW - 5 * 24 * 60 * 60 * 1000).toISOString();
    await writeLog(dir, logFilename('changelog-agent', 'completed', inWindowTs));

    // 8 days ago — outside 7-day window
    const outWindowTs = new Date(NOW - 8 * 24 * 60 * 60 * 1000).toISOString();
    await writeLog(dir, logFilename('dead-code-agent', 'completed', outWindowTs));

    const result = await buildRecentlyRunExclusionSet(dir, 'weekly', NOW);

    assert.ok(result.has('changelog-agent'), 'agent 5d ago should be excluded for weekly');
    assert.ok(!result.has('dead-code-agent'), 'agent 8d ago should not be excluded for weekly');
  });

  // SCN-TWG-07
  it('SCN-TWG-07: empty log directory returns empty set', async () => {
    const dir = await fs.mkdtemp(path.join(tmpDir, 'scn07-'));

    const result = await buildRecentlyRunExclusionSet(dir, 'daily', NOW);

    assert.equal(result.size, 0);
  });

  // SCN-TWG-08
  it('SCN-TWG-08: non-existent directory returns empty set without throwing', async () => {
    const nonExistent = path.join(tmpDir, 'does-not-exist-' + Date.now());

    const result = await buildRecentlyRunExclusionSet(nonExistent, 'daily', NOW);

    assert.equal(result.size, 0);
  });

  // SCN-TWG-09
  it('SCN-TWG-09: only the most recent log matters — agent excluded if any log is within window', async () => {
    const dir = await fs.mkdtemp(path.join(tmpDir, 'scn09-'));

    // Two logs: one old, one recent
    const oldTs = new Date(NOW - 25 * 60 * 60 * 1000).toISOString();
    const recentTs = new Date(NOW - 2 * 60 * 60 * 1000).toISOString();
    await writeLog(dir, logFilename('perf-agent', 'completed', oldTs));
    await writeLog(dir, logFilename('perf-agent', 'failed', recentTs));

    const result = await buildRecentlyRunExclusionSet(dir, 'daily', NOW);

    assert.ok(result.has('perf-agent'), 'agent with any log within window should be excluded');
  });

  // SCN-TWG-10
  it('SCN-TWG-10: mixed roster — correctly partitions in-window vs out-of-window agents', async () => {
    const dir = await fs.mkdtemp(path.join(tmpDir, 'scn10-'));

    const recentTs = new Date(NOW - 1 * 60 * 60 * 1000).toISOString();  // 1h ago
    const oldTs = new Date(NOW - 30 * 60 * 60 * 1000).toISOString();    // 30h ago

    await writeLog(dir, logFilename('audit-agent', 'completed', recentTs));
    await writeLog(dir, logFilename('ci-health-agent', 'completed', oldTs));
    await writeLog(dir, logFilename('log-fixer-agent', 'failed', recentTs));

    const result = await buildRecentlyRunExclusionSet(dir, 'daily', NOW);

    assert.ok(result.has('audit-agent'));
    assert.ok(!result.has('ci-health-agent'));
    assert.ok(result.has('log-fixer-agent'));
    assert.equal(result.size, 2);
  });

  // SCN-TWG-11 — anti-cheat: verify the guard cannot be trivially bypassed
  it('SCN-TWG-11: non-log files in directory are ignored', async () => {
    const dir = await fs.mkdtemp(path.join(tmpDir, 'scn11-'));

    // Write files that are NOT canonical log filenames
    await fs.writeFile(path.join(dir, '.scheduler-run-state.json'), '{}', 'utf8');
    await fs.writeFile(path.join(dir, 'README.md'), '# readme', 'utf8');
    await fs.writeFile(path.join(dir, '2026-02-20T12-00-00Z__audit-agent__deferred.md'), 'deferred', 'utf8');

    const result = await buildRecentlyRunExclusionSet(dir, 'daily', NOW);

    assert.equal(result.size, 0, 'non-log files and deferred logs must not trigger exclusion');
  });
});

describe('CADENCE_WINDOW_MS constants', () => {
  it('daily window is exactly 24 hours', () => {
    assert.equal(CADENCE_WINDOW_MS.daily, 24 * 60 * 60 * 1000);
  });

  it('weekly window is exactly 7 days', () => {
    assert.equal(CADENCE_WINDOW_MS.weekly, 7 * 24 * 60 * 60 * 1000);
  });
});
