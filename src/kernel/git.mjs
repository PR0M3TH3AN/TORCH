import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, join } from 'node:path';
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

const SOURCE_CONTENT = /\.(?:[cm]?[jt]sx?|py|rs|go|java|c|cc|cpp|h|hpp|cs|rb|php|swift|kt)$/i;
const MAX_ANALYZED_SOURCE_BYTES = 256_000;
const TEST_SURFACE = /(^|\/)(test|tests|spec|e2e)(\/|\.|$)/i;
const OPERATIONS_SURFACE = /(^|\/)(\.github|infra|ops|deploy|release|docker|systemd)(\/|\.|$)/i;
const SHARED_SURFACE = /(^|\/)(shared|common|types?|schemas?|contracts?|[^/]*config[^/]*)(\/|\.|$)/i;
const MANIFEST_PATHS = new Set([
  'package.json', 'pyproject.toml', 'requirements.txt', 'Cargo.toml', 'go.mod',
  'pom.xml', 'build.gradle', 'Makefile', 'CMakeLists.txt', 'Dockerfile',
]);

export function workingTreeFiles(root) {
  const tracked = trackedFiles(root);
  const untrackedOutput = git(root, ['ls-files', '--others', '--exclude-standard', '-z'], { optional: true });
  const untracked = untrackedOutput ? untrackedOutput.split('\0').filter(Boolean) : [];
  const trackedSet = new Set(tracked);
  const files = [...new Set([...tracked, ...untracked])].filter((path) => {
    try { return lstatSync(join(root, path)).isFile(); } catch { return false; }
  }).sort();
  const visible = new Set(files);
  return {
    files,
    trackedFileCount: tracked.filter((path) => visible.has(path)).length,
    untrackedFileCount: untracked.filter((path) => visible.has(path) && !trackedSet.has(path)).length,
  };
}

export function workingTreeFingerprint(root, files = workingTreeFiles(root).files) {
  const hash = createHash('sha256');
  const analysisInputs = files.filter((path) => SOURCE_CONTENT.test(path)
    || TEST_SURFACE.test(path) || OPERATIONS_SURFACE.test(path)
    || SHARED_SURFACE.test(path) || MANIFEST_PATHS.has(path));
  for (const path of [...analysisInputs].sort()) {
    hash.update(path);
    hash.update('\0');
    if (!SOURCE_CONTENT.test(path) && basename(path) !== 'package.json') continue;
    try {
      const absolute = join(root, path);
      const info = lstatSync(absolute);
      if (!info.isFile()) {
        hash.update('not-a-regular-file\0');
        continue;
      }
      hash.update(String(info.size));
      hash.update('\0');
      if (SOURCE_CONTENT.test(path) && info.size > MAX_ANALYZED_SOURCE_BYTES) {
        hash.update('source-content-not-inspected\0');
      } else {
        hash.update(readFileSync(absolute));
        hash.update('\0');
      }
    } catch {
      hash.update('unreadable\0');
    }
  }
  return hash.digest('hex');
}
