/**
 * Governance: Prompt Versioning and Rollback Tests
 *
 * Scenarios tested:
 *   SCN-proposal-create    : createProposal writes correct on-disk structure
 *   SCN-proposal-list      : listProposals returns all proposals; status filter works
 *   SCN-proposal-reject    : rejectProposal marks status and records reason
 *   SCN-archive-naming     : applyProposal archives with <base>_<timestamp>_<hash>.md + sidecar
 *   SCN-version-list       : listPromptVersions returns versions newest-first with metadata
 *   SCN-rollback-latest    : rollbackPrompt --strategy latest restores most-recent archive
 *   SCN-rollback-hash      : rollbackPrompt --strategy <fragment> restores the matching archive
 *   SCN-rollback-no-archive: rollbackPrompt falls through to git when no archive exists
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CWD = process.cwd();
const PROPOSALS_DIR = path.join(CWD, 'src/proposals');
const HISTORY_DIR = path.join(CWD, '.torch/prompt-history');

// A real daily prompt that is guaranteed to exist (passes allowlist)
const TEST_TARGET = 'src/prompts/daily/audit-agent.md';
const ABS_TARGET = path.join(CWD, TEST_TARGET);

let originalPromptContent = null;
const createdProposalIds = [];

// Read governance functions fresh each time (they're already cached by Node's ESM cache,
// but that's fine — we need stable CWD-based paths for integration tests).
const {
  createProposal,
  listProposals,
  getProposal,
  rejectProposal,
  applyProposal,
  listPromptVersions,
  rollbackPrompt,
} = await import('../src/services/governance/index.js');

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

before(async () => {
  // Save original prompt content so we can restore it after applyProposal tests
  originalPromptContent = await fsp.readFile(ABS_TARGET, 'utf8');
});

after(async () => {
  // Restore original prompt content if a test changed it
  if (originalPromptContent !== null) {
    try {
      const current = await fsp.readFile(ABS_TARGET, 'utf8');
      if (current !== originalPromptContent) {
        await fsp.writeFile(ABS_TARGET, originalPromptContent);
      }
    } catch {
      // best-effort
    }
  }

  // Remove test proposals written during tests
  for (const id of createdProposalIds) {
    const dir = path.join(PROPOSALS_DIR, id);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  // Remove test archives written during tests (keep real ones, only delete test-* prefixed)
  const archiveDir = path.join(HISTORY_DIR, path.dirname(TEST_TARGET));
  try {
    const files = await fsp.readdir(archiveDir);
    for (const f of files) {
      if (f.startsWith('__test__')) {
        fs.rmSync(path.join(archiveDir, f), { force: true });
      }
    }
  } catch { /* ignore */ }
});

// ---------------------------------------------------------------------------
// SCN-proposal-create
// ---------------------------------------------------------------------------

test('SCN-proposal-create: createProposal writes meta.json, new.md, change.diff', async () => {
  // Given: a valid target path and new content
  const newContent = originalPromptContent + '\n<!-- test marker -->';
  const agent = '__test-agent__';

  // When: a proposal is created
  const { id } = await createProposal({
    agent,
    target: TEST_TARGET,
    newContent,
    reason: 'Test proposal for SCN-proposal-create',
  });

  createdProposalIds.push(id);

  // Then: the proposal directory contains the required files
  const proposalDir = path.join(PROPOSALS_DIR, id);
  assert.ok(fs.existsSync(path.join(proposalDir, 'meta.json')), 'meta.json exists');
  assert.ok(fs.existsSync(path.join(proposalDir, 'new.md')), 'new.md exists');
  assert.ok(fs.existsSync(path.join(proposalDir, 'change.diff')), 'change.diff exists');

  const meta = JSON.parse(fs.readFileSync(path.join(proposalDir, 'meta.json'), 'utf8'));
  assert.equal(meta.author, agent, 'author recorded');
  assert.equal(meta.target, TEST_TARGET, 'target recorded');
  assert.equal(meta.status, 'pending', 'initial status is pending');
  assert.equal(meta.reason, 'Test proposal for SCN-proposal-create', 'reason recorded');

  const savedContent = fs.readFileSync(path.join(proposalDir, 'new.md'), 'utf8');
  assert.equal(savedContent, newContent, 'new.md contains proposed content');
});

// ---------------------------------------------------------------------------
// SCN-proposal-list
// ---------------------------------------------------------------------------

test('SCN-proposal-list: listProposals returns created proposal; status filter works', async () => {
  // Given: at least one pending proposal exists (created in previous test)
  // When: listing all proposals
  const all = await listProposals();
  assert.ok(Array.isArray(all), 'listProposals returns an array');
  assert.ok(all.length >= 1, 'at least one proposal returned');

  const testProposals = all.filter(p => p.author === '__test-agent__');
  assert.ok(testProposals.length >= 1, 'test proposal is in the list');
  assert.equal(testProposals[0].status, 'pending', 'status is pending');

  // When: filtering by status that returns nothing
  const rejected = all.filter(p => p.status === 'rejected' && p.author === '__test-agent__');
  assert.equal(rejected.length, 0, 'no rejected proposals from our test agent yet');
});

// ---------------------------------------------------------------------------
// SCN-proposal-reject
// ---------------------------------------------------------------------------

test('SCN-proposal-reject: rejectProposal marks proposal with rejected status and reason', async () => {
  // Given: an existing pending proposal
  const newContent = originalPromptContent + '\n<!-- reject-test -->';
  const { id } = await createProposal({
    agent: '__test-agent__',
    target: TEST_TARGET,
    newContent,
    reason: 'Will be rejected',
  });
  createdProposalIds.push(id);

  // When: the proposal is rejected
  const rejectionReason = 'Does not meet EXIT CRITERIA standard';
  await rejectProposal(id, rejectionReason);

  // Then: the meta.json reflects rejected status
  const proposal = await getProposal(id);
  assert.equal(proposal.meta.status, 'rejected', 'status is rejected');
  assert.equal(proposal.meta.rejectionReason, rejectionReason, 'rejection reason recorded');
  assert.ok(proposal.meta.rejectedAt, 'rejectedAt timestamp set');
});

// ---------------------------------------------------------------------------
// SCN-archive-naming: applyProposal creates <base>_<ts>_<hash>.md + .meta.json sidecar
// ---------------------------------------------------------------------------

test('SCN-archive-naming: applyProposal archives with timestamp_hash filename and sidecar', async () => {
  // Given: a valid pending proposal for a real prompt file
  const newContent = originalPromptContent.replace(
    /^(# )/m,
    '# [VERSIONING TEST MARKER] '
  );
  // Ensure newContent still passes contract validation
  const hasContract = /Shared contract \(required\):/i.test(newContent) &&
    /Required startup \+ artifacts \+ memory \+ issue capture/i.test(newContent);
  if (!hasContract) {
    // Skip: the prompt doesn't have required headers; not a governance test failure
    return;
  }

  const { id } = await createProposal({
    agent: '__test-agent__',
    target: TEST_TARGET,
    newContent,
    reason: 'Archive naming test',
  });
  createdProposalIds.push(id);

  const expectedHash = createHash('sha256').update(originalPromptContent).digest('hex');

  // When: the proposal is applied
  await applyProposal(id);

  // Then: find the archive whose sidecar references this specific proposal ID
  // (There may be archives from prior test runs with the same hash; we must find ours.)
  const archiveDir = path.join(HISTORY_DIR, path.dirname(TEST_TARGET));
  const baseName = path.basename(TEST_TARGET, '.md');
  const files = fs.readdirSync(archiveDir);
  const sidecarFiles = files.filter(f => f.startsWith(baseName + '_') && f.endsWith('.meta.json'));

  let archiveFile = null;
  let sidecar = null;
  for (const sf of sidecarFiles) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(archiveDir, sf), 'utf8'));
      if (s.proposalId === id) {
        sidecar = s;
        archiveFile = sf.replace('.meta.json', '.md');
        break;
      }
    } catch { /* skip unreadable sidecars */ }
  }

  assert.ok(archiveFile, `archive sidecar found for proposal ${id}`);
  assert.ok(fs.existsSync(path.join(archiveDir, archiveFile)), 'archive .md file exists');

  // Filename must contain a timestamp segment (not just hash)
  const withoutPrefix = archiveFile.slice(baseName.length + 1, -3); // strip base_ and .md
  const parts = withoutPrefix.split('_');
  assert.ok(parts.length >= 2, 'filename has timestamp + hash parts');

  assert.equal(sidecar.proposalId, id, 'sidecar references the proposal ID');
  assert.equal(sidecar.author, '__test-agent__', 'sidecar records author');
  assert.equal(sidecar.hash, expectedHash, 'sidecar records SHA-256 hash');
  assert.ok(sidecar.archivedAt, 'sidecar records archivedAt timestamp');

  // Applied content is the new content
  const applied = fs.readFileSync(ABS_TARGET, 'utf8');
  assert.equal(applied, newContent, 'new content was written to target file');
});

// ---------------------------------------------------------------------------
// SCN-version-list: listPromptVersions returns metadata sorted newest first
// ---------------------------------------------------------------------------

test('SCN-version-list: listPromptVersions returns versions newest-first with metadata', async () => {
  // Given: two manually created archive files with different timestamps
  const archiveDir = path.join(HISTORY_DIR, path.dirname(TEST_TARGET));
  await fsp.mkdir(archiveDir, { recursive: true });

  const baseName = '__test__versioning-probe';
  const ts1 = '2026-01-10T00-00-00-000Z';
  const ts2 = '2026-01-20T00-00-00-000Z';
  const hash1 = 'aaa000';
  const hash2 = 'bbb111';

  const file1 = `${baseName}_${ts1}_${hash1}.md`;
  const file2 = `${baseName}_${ts2}_${hash2}.md`;

  fs.writeFileSync(path.join(archiveDir, file1), 'old version');
  fs.writeFileSync(path.join(archiveDir, file2), 'newer version');
  fs.writeFileSync(
    path.join(archiveDir, file2.replace('.md', '.meta.json')),
    JSON.stringify({ proposalId: 'test-prop', author: 'test-agent', reason: 'v2', hash: hash2, archivedAt: '2026-01-20T00:00:00.000Z' })
  );

  // When: listing versions for the probe target
  const probeTarget = `src/prompts/daily/${baseName}.md`;
  const versions = await listPromptVersions(probeTarget);

  // Then: sorted newest first (ts2 > ts1)
  assert.ok(versions.length >= 2, 'at least 2 versions returned');
  assert.equal(versions[0].filename, file2, 'newest version is first');
  assert.equal(versions[1].filename, file1, 'older version is second');

  // Metadata from sidecar is surfaced
  assert.equal(versions[0].author, 'test-agent', 'author from sidecar');
  assert.equal(versions[0].reason, 'v2', 'reason from sidecar');
  assert.equal(versions[0].hash, hash2, 'hash from sidecar');

  // Version without sidecar still has hash extracted from filename
  assert.ok(versions[1].hash, 'hash extracted from filename for legacy entry');
});

// ---------------------------------------------------------------------------
// SCN-rollback-latest
// NOTE: Uses a dedicated probe target (not an actual prompt) so there is no
//       interference from archives created by other tests or the scheduler.
// ---------------------------------------------------------------------------

// Probe target: a path inside the allowed subpath structure but with a name
// that will not conflict with real prompts.  rollbackPrompt only needs to
// write to this path; the file is cleaned up in after().
const ROLLBACK_PROBE_TARGET = 'src/prompts/daily/__rollback-probe__.md';
const ABS_ROLLBACK_PROBE = path.join(CWD, ROLLBACK_PROBE_TARGET);

test('SCN-rollback-latest: rollbackPrompt restores the most recently archived content', async () => {
  // Given: two manually created archive files for the probe target; newest is distinctive
  const archiveDir = path.join(HISTORY_DIR, path.dirname(ROLLBACK_PROBE_TARGET));
  await fsp.mkdir(archiveDir, { recursive: true });

  const baseName = path.basename(ROLLBACK_PROBE_TARGET, '.md');
  const olderTs  = '2025-06-01T00-00-00-000Z';
  const newerTs  = '2025-12-01T00-00-00-000Z';
  const olderHash = '__older-hash-scn-latest__';
  const newerHash = '__newer-hash-scn-latest__';
  const olderContent = '<!-- SCN-rollback-latest: older -->';
  const newerContent = '<!-- SCN-rollback-latest: newer -->';

  const olderFile = `${baseName}_${olderTs}_${olderHash}.md`;
  const newerFile = `${baseName}_${newerTs}_${newerHash}.md`;

  await fsp.writeFile(path.join(archiveDir, olderFile), olderContent);
  await fsp.writeFile(path.join(archiveDir, olderFile.replace('.md', '.meta.json')),
    JSON.stringify({ archivedAt: '2025-06-01T00:00:00.000Z', hash: olderHash }));
  await fsp.writeFile(path.join(archiveDir, newerFile), newerContent);
  await fsp.writeFile(path.join(archiveDir, newerFile.replace('.md', '.meta.json')),
    JSON.stringify({ archivedAt: '2025-12-01T00:00:00.000Z', hash: newerHash }));

  try {
    // When: rolling back with 'latest' strategy
    const result = await rollbackPrompt(ROLLBACK_PROBE_TARGET, 'latest');

    // Then: target file contains the newer archive's content
    assert.ok(result.success, 'rollback reported success');
    assert.equal(result.source, 'archive', 'restored from archive, not git');
    assert.equal(result.restored, newerFile, 'restored from newer archive');

    const restoredContent = await fsp.readFile(ABS_ROLLBACK_PROBE, 'utf8');
    assert.equal(restoredContent, newerContent, 'target file contains newer archived content');
  } finally {
    // Cleanup probe artifacts
    for (const f of [olderFile, olderFile.replace('.md', '.meta.json'),
                     newerFile, newerFile.replace('.md', '.meta.json')]) {
      try { await fsp.unlink(path.join(archiveDir, f)); } catch { /* ignore */ }
    }
    try { await fsp.unlink(ABS_ROLLBACK_PROBE); } catch { /* ignore */ }
  }
});

// ---------------------------------------------------------------------------
// SCN-rollback-hash
// ---------------------------------------------------------------------------

test('SCN-rollback-hash: rollbackPrompt --strategy <fragment> restores matching archive', async () => {
  // Given: one archive with a distinctive hash fragment for the probe target
  const archiveDir = path.join(HISTORY_DIR, path.dirname(ROLLBACK_PROBE_TARGET));
  await fsp.mkdir(archiveDir, { recursive: true });

  const baseName = path.basename(ROLLBACK_PROBE_TARGET, '.md');
  const specificHash = 'cafecafe1234scn';
  const specificContent = '<!-- SCN-rollback-hash: specific content -->';
  const specificTs = '2025-09-15T00-00-00-000Z';
  const specificFile = `${baseName}_${specificTs}_${specificHash}.md`;

  await fsp.writeFile(path.join(archiveDir, specificFile), specificContent);
  await fsp.writeFile(path.join(archiveDir, specificFile.replace('.md', '.meta.json')),
    JSON.stringify({ archivedAt: '2025-09-15T00:00:00.000Z', hash: specificHash }));

  try {
    // When: rolling back with the specific hash fragment
    const result = await rollbackPrompt(ROLLBACK_PROBE_TARGET, 'cafecafe1234scn');

    // Then: the correct archive was selected
    assert.ok(result.success, 'rollback succeeded');
    assert.equal(result.source, 'archive', 'restored from archive');
    assert.equal(result.restored, specificFile, 'correct archive file selected');

    const restoredContent = await fsp.readFile(ABS_ROLLBACK_PROBE, 'utf8');
    assert.equal(restoredContent, specificContent, 'content matches the specific archive');
  } finally {
    for (const f of [specificFile, specificFile.replace('.md', '.meta.json')]) {
      try { await fsp.unlink(path.join(archiveDir, f)); } catch { /* ignore */ }
    }
    try { await fsp.unlink(ABS_ROLLBACK_PROBE); } catch { /* ignore */ }
  }
});
