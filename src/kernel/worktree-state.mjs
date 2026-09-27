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
  const status = git(entry.path, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (status) problems.push('worktree-dirty');
  const ahead = Number(git(root, ['rev-list', '--count', `${mainBranch}..${entry.branch}`]) || 0);
  const behind = Number(git(root, ['rev-list', '--count', `${entry.branch}..${mainBranch}`]) || 0);
  if (ahead > 0) problems.push(`unique-commits:${ahead}`);
  return {
    ...entry, actualBranch, ahead, behind,
    drift: ahead === 0 && behind === 0 ? 'current' : 'diverged',
    safeToRemove: problems.length === 0, problems,
  };
}
