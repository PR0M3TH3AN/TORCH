import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { basename } from 'node:path';
import { TorchError } from './errors.mjs';

function git(cwd, args, { optional = false } = {}) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    if (optional) return '';
    throw new TorchError(`Git command failed: git ${args.join(' ')}`, {
      code: 'GIT_COMMAND_FAILED',
      details: error.stderr?.toString().trim() || undefined,
    });
  }
}

export function inspectRepository(cwd = process.cwd()) {
  const rootText = git(cwd, ['rev-parse', '--show-toplevel'], { optional: true });
  if (!rootText) {
    throw new TorchError(`Not a Git repository: ${cwd}`, { code: 'NOT_GIT_REPOSITORY' });
  }

  const root = realpathSync(rootText);
  const branch = git(root, ['branch', '--show-current'], { optional: true }) || null;
  const head = git(root, ['rev-parse', 'HEAD'], { optional: true }) || null;
  const initialCommit = head
    ? git(root, ['rev-list', '--max-parents=0', 'HEAD'], { optional: true }).split('\n')[0] || null
    : null;
  const status = git(root, ['status', '--porcelain=v1', '--untracked-files=all'], { optional: true });
  const remotesText = git(root, ['remote', '-v'], { optional: true });
  const remotes = remotesText
    ? remotesText.split('\n').map((line) => {
      const [name, url, kindText = ''] = line.split(/\s+/);
      return { name, url, kind: kindText.replace(/[()]/g, '') || 'unknown' };
    })
    : [];

  return {
    root,
    name: basename(root),
    branch,
    head,
    initialCommit,
    dirtyEntries: status ? status.split('\n') : [],
    remotes,
    canonicalRemote: remotes.find((remote) => remote.name === 'origin' && remote.kind === 'fetch') ?? null,
  };
}

export function trackedFiles(root) {
  const output = git(root, ['ls-files', '-z'], { optional: true });
  return output ? output.split('\0').filter(Boolean) : [];
}
