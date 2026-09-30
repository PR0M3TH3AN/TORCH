import { execFileSync } from 'node:child_process';
import { TorchError } from '../kernel/errors.mjs';

export function commitTaskReferences(message) {
  const references = [...new Set(message.match(/\bTASK-[A-Za-z0-9-]+\b/g) ?? [])];
  const closes = [];
  for (const line of message.split('\n')) {
    const match = /^Closes:\s*(TASK-[A-Za-z0-9-]+(?:\s*,\s*TASK-[A-Za-z0-9-]+)*)\s*$/i.exec(line);
    if (match) closes.push(...match[1].split(',').map((id) => id.trim()));
  }
  return { references, closes: [...new Set(closes)] };
}

/** Bounded, read-only observation. Commit messages are intent, not authority.
 * A truncated scan cannot prove absence of recent activity.
 */
export function observeTaskActivity({
  repositoryRoot, tasks, branches, now = new Date(), staleDays = 3, maxCommits = 1000,
} = {}) {
  if (!Number.isInteger(staleDays) || staleDays < 1 || staleDays > 365
    || !Number.isInteger(maxCommits) || maxCommits < 1 || maxCommits > 10_000
    || !Number.isFinite(now.getTime())) {
    throw new TorchError('Invalid task activity observation limits', { code: 'BACKLOG_ACTIVITY_INPUT_INVALID' });
  }
  const git = (args) => execFileSync('git', ['-C', repositoryRoot, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024,
  });
  const refs = [...new Set(branches ?? [])];
  const heads = [];
  const unavailableBranches = [];
  for (const branch of refs) {
    try { heads.push(git(['rev-parse', '--verify', `refs/heads/${branch}^{commit}`]).trim()); }
    catch { unavailableBranches.push(branch); }
  }
  if (!heads.length) throw new TorchError('No managed branches available for activity observation', { code: 'BACKLOG_ACTIVITY_UNAVAILABLE' });
  let output;
  try {
    output = git(['log', `--max-count=${maxCommits + 1}`, '--format=%H%x00%cI%x00%B%x00', ...new Set(heads), '--']);
  } catch (error) {
    throw new TorchError('Task activity scan could not complete', { code: 'BACKLOG_ACTIVITY_UNAVAILABLE', details: error.message });
  }
  const parts = output.split('\0');
  if (parts.pop()?.trim()) throw new TorchError('Malformed commit activity output', { code: 'BACKLOG_ACTIVITY_UNAVAILABLE' });
  if (parts.length % 3) throw new TorchError('Malformed commit activity output', { code: 'BACKLOG_ACTIVITY_UNAVAILABLE' });
  const commits = [];
  for (let index = 0; index < parts.length; index += 3) {
    const commit = parts[index].trim();
    const committedAt = parts[index + 1].trim();
    if (!/^[0-9a-f]{40,64}$/.test(commit) || !Number.isFinite(Date.parse(committedAt))) {
      throw new TorchError('Malformed commit activity identity', { code: 'BACKLOG_ACTIVITY_UNAVAILABLE' });
    }
    commits.push({ commit, committedAt, ...commitTaskReferences(parts[index + 2]) });
  }
  const truncated = commits.length > maxCommits;
  const scanned = commits.slice(0, maxCommits);
  const complete = !truncated && !unavailableBranches.length;
  const known = new Set(tasks.map((task) => task.id));
  const unknownReferences = [...new Set(scanned.flatMap((commit) => commit.references).filter((id) => !known.has(id)))];
  const futureCommits = scanned.filter((commit) => Date.parse(commit.committedAt) > now.getTime()).map((commit) => commit.commit);
  const observations = tasks.map((task) => {
    const linked = scanned.filter((commit) => commit.references.includes(task.id)
      && Date.parse(commit.committedAt) <= now.getTime())
      .sort((left, right) => Date.parse(right.committedAt) - Date.parse(left.committedAt) || left.commit.localeCompare(right.commit));
    const lastActivity = linked[0] ?? null;
    const created = Date.parse(task.createdAt);
    const baseline = lastActivity
      ? Math.max(Date.parse(lastActivity.committedAt), Number.isFinite(created) ? created : 0) : created;
    const ageDays = Number.isFinite(baseline) && baseline <= now.getTime()
      ? Math.floor((now.getTime() - baseline) / 86_400_000) : null;
    const terminal = ['completed', 'cancelled'].includes(task.state);
    const recent = lastActivity && ageDays !== null && ageDays < staleDays;
    const status = terminal ? 'terminal' : recent ? 'recent' : !complete || ageDays === null ? 'unknown'
      : ageDays >= staleDays ? 'stale' : 'new';
    return {
      taskId: task.id, title: task.title, state: task.state, owner: task.owner ?? null,
      ownerRequested: task.history?.[0]?.actorId === 'owner',
      status, ageDays, lastActivity, linkedCommits: linked.length,
      closureIntent: linked.filter((commit) => commit.closes.includes(task.id)).map((commit) => commit.commit),
      expectedWaiting: task.state === 'blocked',
    };
  }).sort((left, right) => Number(right.ownerRequested) - Number(left.ownerRequested)
    || (right.ageDays ?? -1) - (left.ageDays ?? -1) || left.taskId.localeCompare(right.taskId));
  return {
    schema: 'torch.dev/backlog-activity/v1alpha1', generatedAt: now.toISOString(),
    provenance: 'git-commit-metadata', staleDays, maxCommits, scannedCommits: scanned.length,
    complete, truncated, unavailableBranches, futureCommits, unknownReferences,
    tasks: observations, stale: observations.filter((task) => task.status === 'stale'),
    mutationPerformed: false, closurePerformed: false,
  };
}
