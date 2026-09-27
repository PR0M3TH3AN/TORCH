import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

function git(root, args) {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch { return ''; }
}

export function inspectManagedWorktree(root, entry, mainBranch) {
  if (!existsSync(entry.path)) return { ...entry, safeToRemove: false, problems: ['worktree-missing'] };
  const problems = [];
  const actualBranch = git(entry.path, ['branch', '--show-current']);
  if (actualBranch !== entry.branch) problems.push(`branch-mismatch:${actualBranch || 'detached'}`);
  const operations = ['MERGE_HEAD', 'REBASE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']
    .filter((name) => existsSync(git(entry.path, ['rev-parse', '--git-path', name])));
  for (const operation of operations) problems.push(`git-operation:${operation}`);
  const status = git(entry.path, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (status) problems.push('worktree-dirty');
  const commit = git(entry.path, ['rev-parse', 'HEAD']);
  const ahead = Number(git(root, ['rev-list', '--count', `${mainBranch}..${entry.branch}`]) || 0);
  const behind = Number(git(root, ['rev-list', '--count', `${entry.branch}..${mainBranch}`]) || 0);
  const oldestMissingCommitAt = behind > 0
    ? git(root, ['log', '--reverse', '--format=%cI', `${entry.branch}..${mainBranch}`]).split('\n')[0] || null
    : null;
  if (ahead > 0) problems.push(`unique-commits:${ahead}`);
  return {
    ...entry, actualBranch, commit, ahead, behind, oldestMissingCommitAt, operations,
    drift: ahead > 0 && behind > 0 ? 'diverged'
      : (ahead > 0 ? 'ahead' : (behind > 0 ? 'behind' : 'current')),
    safeToRemove: problems.length === 0, problems,
  };
}
