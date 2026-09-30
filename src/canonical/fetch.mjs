import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { loadProjectConfig } from '../kernel/config.mjs';
import { TorchError } from '../kernel/errors.mjs';

const runGit = (root, args, timeout = 10_000) => spawnSync('git', ['-C', root, ...args], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout, maxBuffer: 1_048_576,
  env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
});
const hash = (value) => createHash('sha256').update(value).digest('hex');

export function planCanonicalFetch({ repositoryRoot } = {}) {
  const config = loadProjectConfig(repositoryRoot);
  const remote = config.repository.canonical.remote;
  const branch = config.project.main_branch;
  if (!remote || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(remote)
    || runGit(repositoryRoot, ['check-ref-format', '--branch', branch]).status !== 0) {
    throw new TorchError('Canonical remote or branch is unavailable', { code: 'CANONICAL_FETCH_CONFIG_INVALID' });
  }
  const url = runGit(repositoryRoot, ['remote', 'get-url', '--', remote]);
  if (url.status !== 0) throw new TorchError('Configured canonical remote is missing', { code: 'CANONICAL_FETCH_CONFIG_INVALID' });
  const observed = runGit(repositoryRoot, ['ls-remote', '--heads', '--', remote, `refs/heads/${branch}`]);
  const lines = (observed.stdout ?? '').trim().split('\n');
  const match = lines.length === 1 && /^([a-f0-9]{40,64})\s+(.+)$/.exec(lines[0]);
  if (observed.status !== 0 || !match || match[2] !== `refs/heads/${branch}`) {
    throw new TorchError('Canonical branch cannot be resolved; no fetch was attempted', { code: 'CANONICAL_FETCH_HEAD_UNAVAILABLE' });
  }
  return { action: 'fetch-canonical-objects', remote, branch, commit: match[1],
    destinationHash: hash(url.stdout.trim()), requiresConfirmation: true,
    changesBranches: false, changesWorkingTree: false, publishesRemote: false,
    mutationPerformed: false };
}

// Only object import is retried. Never share this classifier with pushes/deploys.
export function classifyFetchFailure(result) {
  const error = String(result?.stderr ?? '');
  if (/authentication|permission denied|access denied|could not read username|repository not found|not a git repository|host key verification failed|certificate/i.test(error)) return 'permanent';
  if (result?.error?.code === 'ETIMEDOUT'
    || /could not resolve host|temporary failure in name resolution|connection timed out|connection reset|failed to connect|remote end hung up unexpectedly|HTTP (?:502|503|504)\b/i.test(error)) return 'transient-network';
  return 'unclassified';
}

export function fetchCanonicalObjects({ repositoryRoot, controlPlane, actorId = 'owner', attempts = 3,
  executor = runGit, clock = () => new Date(), idFactory = randomUUID } = {}) {
  if (!controlPlane) throw new TorchError('Fetch requires owner audit', { code: 'CANONICAL_FETCH_AUDIT_REQUIRED' });
  controlPlane.assertOwnerActor(actorId);
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 5) {
    throw new TorchError('Fetch attempts must be between one and five', { code: 'CANONICAL_FETCH_INPUT_INVALID' });
  }
  const plan = planCanonicalFetch({ repositoryRoot });
  const database = controlPlane.database;
  database.exec(`CREATE TABLE IF NOT EXISTS canonical_fetches (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, remote TEXT NOT NULL, branch TEXT NOT NULL,
    commit_sha TEXT NOT NULL, destination_hash TEXT NOT NULL, state TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, attempt_limit INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS canonical_fetch_attempts (
    fetch_id TEXT NOT NULL, ordinal INTEGER NOT NULL, state TEXT NOT NULL,
    classification TEXT, started_at TEXT NOT NULL, finished_at TEXT,
    PRIMARY KEY(fetch_id, ordinal));`);
  const id = idFactory();
  const started = clock().toISOString();
  database.prepare('INSERT INTO canonical_fetches VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,
    controlPlane.projectId, plan.remote, plan.branch, plan.commit, plan.destinationHash, 'running', started, started, attempts);
  let state = 'failed';
  for (let ordinal = 1; ordinal <= attempts; ordinal += 1) {
    const config = loadProjectConfig(repositoryRoot);
    const currentUrl = runGit(repositoryRoot, ['remote', 'get-url', '--', plan.remote]);
    if (config.repository.canonical.remote !== plan.remote || config.project.main_branch !== plan.branch
      || currentUrl.status !== 0 || hash(currentUrl.stdout.trim()) !== plan.destinationHash) {
      state = 'policy-changed';
      break;
    }
    database.prepare('INSERT INTO canonical_fetch_attempts VALUES (?,?,?,?,?,?)')
      .run(id, ordinal, 'running', null, clock().toISOString(), null);
    let result;
    try {
      result = executor(repositoryRoot, ['fetch', '--no-tags', '--no-write-fetch-head', '--no-recurse-submodules',
        '--no-auto-maintenance', '--refmap=', '--', currentUrl.stdout.trim(), plan.commit], 30_000);
    } catch { result = { status: null, stderr: '' }; }
    const verified = result?.status === 0 && !result.error && !result.signal
      && runGit(repositoryRoot, ['cat-file', '-e', `${plan.commit}^{commit}`]).status === 0;
    const classification = verified ? 'verified-object-import' : classifyFetchFailure(result);
    database.prepare('UPDATE canonical_fetch_attempts SET state = ?, classification = ?, finished_at = ? WHERE fetch_id = ? AND ordinal = ?')
      .run(verified ? 'succeeded' : 'failed', classification, clock().toISOString(), id, ordinal);
    if (verified) { state = 'succeeded'; break; }
    if (classification !== 'transient-network') break;
  }
  database.exec('BEGIN');
  try {
    database.prepare('UPDATE canonical_fetches SET state = ?, updated_at = ? WHERE id = ?')
      .run(state, clock().toISOString(), id);
    controlPlane.auditOwnerAction({ actorId, operation: 'canonical.fetch', entityType: 'canonical-fetch', entityId: id,
      details: { remote: plan.remote, branch: plan.branch, commit: plan.commit, state } });
    database.exec('COMMIT');
  } catch (error) { database.exec('ROLLBACK'); throw error; }
  return { ...plan, id, state, succeeded: state === 'succeeded', mutationPerformed: true,
    attempts: database.prepare(`SELECT ordinal, state, classification, started_at AS startedAt,
      finished_at AS finishedAt FROM canonical_fetch_attempts WHERE fetch_id = ? ORDER BY ordinal`).all(id),
    evidence: 'Local object presence plus Git exit status; not deployment or remote publication evidence' };
}
