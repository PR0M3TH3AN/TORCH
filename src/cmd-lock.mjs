import { generateSecretKey as _generateSecretKey, getPublicKey as _getPublicKey, finalizeEvent as _finalizeEvent } from 'nostr-tools/pure';
import {
  getRelays as _getRelays,
  getNamespace as _getNamespace,
  getHashtag as _getHashtag,
  getTtl as _getTtl,
} from './torch-config.mjs';
import {
  KIND_APP_DATA,
  RACE_CHECK_DELAY_MS,
  MS_PER_SECOND,
} from './constants.mjs';
import { getRoster as _getRoster } from './roster.mjs';
import { queryLocks as _queryLocks, publishLock as _publishLock } from './lock-ops.mjs';
import { ExitError } from './errors.mjs';
import { todayDateStr, nowUnix, detectPlatform } from './utils.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';

function getGitCommit() {
  try {
    return execSync('git rev-parse HEAD', { stdio: 'pipe' }).toString().trim();
  } catch {
    return null;
  }
}

async function getPromptInfo(agent, cadence) {
  try {
    const potentialPath = path.join(process.cwd(), 'src', 'prompts', cadence, `${agent}.md`);
    const content = await fs.readFile(potentialPath, 'utf8');
    const promptHash = createHash('sha256').update(content).digest('hex');
    const promptPath = `src/prompts/${cadence}/${agent}.md`;
    return { promptHash, promptPath };
  } catch {
    return { promptHash: null, promptPath: null };
  }
}

function validateRoster(agent, roster, cadence, error) {
  if (!roster.includes(agent)) {
    error(`ERROR: agent "${agent}" is not in the ${cadence} roster`);
    error(`Allowed ${cadence} agents: ${roster.join(', ')}`);
    throw new ExitError(1, 'Agent not in roster');
  }
}

function checkExistingLocks(existingLocks, agent, error, log) {
  const conflicting = existingLocks.filter((l) => l.agent === agent);

  if (conflicting.length > 0) {
    const earliest = conflicting.sort((a, b) => a.createdAt - b.createdAt)[0];

    if (earliest.status === 'completed') {
       error(`LOCK DENIED: Task already completed by event ${earliest.eventId}`);
       log('LOCK_STATUS=denied');
       log('LOCK_REASON=already_completed');
       throw new ExitError(3, 'Task already completed');
    }

    error(
      `LOCK DENIED: ${agent} already locked by event ${earliest.eventId} ` +
        `(created ${earliest.createdAtIso}, platform: ${earliest.platform})`,
    );
    log('LOCK_STATUS=denied');
    log('LOCK_REASON=already_locked');
    log(`LOCK_EXISTING_EVENT=${earliest.eventId}`);
    throw new ExitError(3, 'Lock denied');
  }
}

function buildLockEvent(agent, cadence, namespace, hashtag, dateStr, now, expiresAt, platform, model, gitCommit, promptPath, promptHash, finalizeEvent, sk) {
  return finalizeEvent(
    {
      kind: KIND_APP_DATA,
      created_at: now,
      tags: [
        ['d', `${namespace}-lock/${cadence}/${agent}/${dateStr}`],
        ['t', hashtag],
        ['t', `${namespace}-lock-${cadence}`],
        ['t', `${namespace}-lock-${cadence}-${dateStr}`],
        ['expiration', String(expiresAt)],
      ],
      content: JSON.stringify({
        agent,
        cadence,
        status: 'started',
        namespace,
        date: dateStr,
        platform: platform || process.env.AGENT_PLATFORM || detectPlatform() || 'unknown',
        model: model || process.env.AGENT_MODEL || 'unknown',
        lockedAt: new Date(now * MS_PER_SECOND).toISOString(),
        expiresAt: new Date(expiresAt * MS_PER_SECOND).toISOString(),
        gitCommit,
        promptPath,
        promptHash,
      }),
    },
    sk,
  );
}

async function performRaceCheck(relays, cadence, dateStr, namespace, agent, myEventId, queryLocks, raceCheckDelayMs, error, log) {
    await new Promise((resolve) => setTimeout(resolve, raceCheckDelayMs));

    const postLocks = await queryLocks(relays, cadence, dateStr, namespace);
    const racingLocks = postLocks
      .filter((l) => l.agent === agent)
      .sort((a, b) => (a.createdAt - b.createdAt) || String(a.eventId).localeCompare(String(b.eventId)));

    if (racingLocks.length > 1 && racingLocks[0].eventId !== myEventId) {
      const winner = racingLocks[0];
      error(
        `RACE CHECK: lost (earlier lock by event ${winner.eventId}, created ${winner.createdAtIso})`,
      );
      log('LOCK_STATUS=race_lost');
      log('LOCK_REASON=earlier_claim_exists');
      log(`LOCK_WINNER_EVENT=${winner.eventId}`);
      throw new ExitError(3, 'Race check lost');
    }
}

/**
 * Attempts to acquire an exclusive lock for an agent on the specified cadence.
 *
 * Algorithm:
 * 1. Validate agent against the roster.
 * 2. Query relays for existing valid locks (checking for conflicts).
 * 3. Generate a new ephemeral keypair and build a lock event (kind 30078).
 * 4. Publish the lock event to relays.
 * 5. Wait for propagation (raceCheckDelayMs) and re-query to confirm no earlier lock won the race.
 *
 * @param {string} agent - Agent name
 * @param {string} cadence - 'daily' or 'weekly'
 * @param {boolean} [dryRun=false] - If true, skips publishing
 * @param {Object} [deps] - Dependency injection
 * @returns {Promise<{status: string, eventId: string}>}
 * @throws {ExitError} If lock is denied (already locked, completed, or race lost)
 */
export async function cmdLock(agent, cadence, optionsOrDryRun = false, deps = {}) {
  const options = typeof optionsOrDryRun === 'object' ? optionsOrDryRun : { dryRun: !!optionsOrDryRun };
  const { dryRun = false, platform = null, model = null } = options;

  const {
    getRelays = _getRelays,
    getNamespace = _getNamespace,
    getHashtag = _getHashtag,
    getTtl = _getTtl,
    queryLocks = _queryLocks,
    getRoster = _getRoster,
    publishLock = _publishLock,
    generateSecretKey = _generateSecretKey,
    getPublicKey = _getPublicKey,
    finalizeEvent = _finalizeEvent,
    raceCheckDelayMs = RACE_CHECK_DELAY_MS,
    getDateStr = todayDateStr,
    log = console.log,
    error = console.error
  } = deps;

  const relays = await getRelays();
  const namespace = await getNamespace();
  const hashtag = await getHashtag();
  const dateStr = getDateStr();
  const ttl = await getTtl();
  const now = nowUnix();
  const expiresAt = now + ttl;

  const gitCommit = getGitCommit();
  const { promptHash, promptPath } = await getPromptInfo(agent, cadence);

  error(`Locking: namespace=${namespace}, agent=${agent}, cadence=${cadence}, date=${dateStr}`);
  error(`Hashtag: #${hashtag}`);
  error(`TTL: ${ttl}s, expires: ${new Date(expiresAt * MS_PER_SECOND).toISOString()}`);
  error(`Relays: ${relays.join(', ')}`);
  if (gitCommit) error(`Git Commit: ${gitCommit}`);
  if (promptHash) error(`Prompt Hash: ${promptHash.slice(0, 12)}...`);

  const roster = await getRoster(cadence);
  validateRoster(agent, roster, cadence, error);

  error('Step 1: Checking for existing locks...');
  const existingLocks = await queryLocks(relays, cadence, dateStr, namespace);
  checkExistingLocks(existingLocks, agent, error, log);

  error('Step 2: Generating ephemeral keypair...');
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);
  error(`  Ephemeral pubkey: ${pk.slice(0, 16)}...`);

  error('Step 3: Building lock event...');
  const event = buildLockEvent(agent, cadence, namespace, hashtag, dateStr, now, expiresAt, platform, model, gitCommit, promptPath, promptHash, finalizeEvent, sk);

  error(`  Event ID: ${event.id}`);

  if (dryRun) {
    error('Step 4: [DRY RUN] Skipping publish — event built but not sent');
    error('RACE CHECK: won (dry run — no real contention possible)');
  } else {
    error('Step 4: Publishing to relays...');
    await publishLock(relays, event);

    error('Step 5: Race check...');
    await performRaceCheck(relays, cadence, dateStr, namespace, agent, event.id, queryLocks, raceCheckDelayMs, error, log);

    error('RACE CHECK: won');
  }

  log('LOCK_STATUS=ok');
  log(`LOCK_EVENT_ID=${event.id}`);
  log(`LOCK_PUBKEY=${pk}`);
  log(`LOCK_AGENT=${agent}`);
  log(`LOCK_HASHTAG=${hashtag}`);
  log(`LOCK_CADENCE=${cadence}`);
  log(`LOCK_DATE=${dateStr}`);
  log(`LOCK_EXPIRES=${expiresAt}`);
  log(`LOCK_EXPIRES_ISO=${new Date(expiresAt * MS_PER_SECOND).toISOString()}`);
  if (gitCommit) log(`LOCK_GIT_COMMIT=${gitCommit}`);
  if (promptHash) log(`LOCK_PROMPT_HASH=${promptHash}`);
  return { status: 'ok', eventId: event.id };
}
