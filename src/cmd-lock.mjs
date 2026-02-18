import { generateSecretKey as _generateSecretKey, getPublicKey as _getPublicKey, finalizeEvent as _finalizeEvent } from 'nostr-tools/pure';
import {
  getRelays as _getRelays,
  getNamespace as _getNamespace,
  getTtl as _getTtl,
  getHashtag as _getHashtag,
} from './torch-config.mjs';
import {
  RACE_CHECK_DELAY_MS,
  KIND_APP_DATA,
} from './constants.mjs';
import { getRoster as _getRoster } from './roster.mjs';
import { queryLocks as _queryLocks, publishLock as _publishLock } from './lock-ops.mjs';
import { todayDateStr as _todayDateStr, nowUnix as _nowUnix, detectPlatform as _detectPlatform } from './utils.mjs';
import { ExitError } from './errors.mjs';

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
    getDateStr = _todayDateStr,
    nowUnix = _nowUnix,
    detectPlatform = _detectPlatform,
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

  error(`Locking: namespace=${namespace}, agent=${agent}, cadence=${cadence}, date=${dateStr}`);
  error(`Hashtag: #${hashtag}`);
  error(`TTL: ${ttl}s, expires: ${new Date(expiresAt * 1000).toISOString()}`);
  error(`Relays: ${relays.join(', ')}`);

  const roster = await getRoster(cadence);
  if (!roster.includes(agent)) {
    error(`ERROR: agent "${agent}" is not in the ${cadence} roster`);
    error(`Allowed ${cadence} agents: ${roster.join(', ')}`);
    throw new ExitError(1, 'Agent not in roster');
  }

  error('Step 1: Checking for existing locks...');
  const existingLocks = await queryLocks(relays, cadence, dateStr, namespace);
  const conflicting = existingLocks.filter((l) => l.agent === agent);

  if (conflicting.length > 0) {
    const earliest = conflicting.sort((a, b) => a.createdAt - b.createdAt)[0];

    // Check if it is a completed task
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

  error('Step 2: Generating ephemeral keypair...');
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);
  error(`  Ephemeral pubkey: ${pk.slice(0, 16)}...`);

  error('Step 3: Building lock event...');
  const event = finalizeEvent(
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
        lockedAt: new Date(now * 1000).toISOString(),
        expiresAt: new Date(expiresAt * 1000).toISOString(),
      }),
    },
    sk,
  );

  error(`  Event ID: ${event.id}`);

  if (dryRun) {
    error('Step 4: [DRY RUN] Skipping publish — event built but not sent');
    error('RACE CHECK: won (dry run — no real contention possible)');
  } else {
    error('Step 4: Publishing to relays...');
    await publishLock(relays, event);

    error('Step 5: Race check...');
    await new Promise((resolve) => setTimeout(resolve, raceCheckDelayMs));

    const postLocks = await queryLocks(relays, cadence, dateStr, namespace);
    const racingLocks = postLocks
      .filter((l) => l.agent === agent)
      .sort((a, b) => (a.createdAt - b.createdAt) || String(a.eventId).localeCompare(String(b.eventId)));

    if (racingLocks.length > 1 && racingLocks[0].eventId !== event.id) {
      const winner = racingLocks[0];
      error(
        `RACE CHECK: lost (earlier lock by event ${winner.eventId}, created ${winner.createdAtIso})`,
      );
      log('LOCK_STATUS=race_lost');
      log('LOCK_REASON=earlier_claim_exists');
      log(`LOCK_WINNER_EVENT=${winner.eventId}`);
      throw new ExitError(3, 'Race check lost');
    }

    error('RACE CHECK: won');
  }

  log('LOCK_STATUS=ok');
  log(`LOCK_EVENT_ID=${event.id}`);
  log(`LOCK_PUBKEY=${pk}`);
  log(`LOCK_AGENT=${agent}`);
  log(`LOCK_CADENCE=${cadence}`);
  log(`LOCK_HASHTAG=${hashtag}`);
  log(`LOCK_DATE=${dateStr}`);
  log(`LOCK_EXPIRES=${expiresAt}`);
  log(`LOCK_EXPIRES_ISO=${new Date(expiresAt * 1000).toISOString()}`);
  return { status: 'ok', eventId: event.id };
}
