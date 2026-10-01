import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

function isWithin(path, root) {
  const difference = relative(root, path);
  return difference === '' || (!difference.startsWith('..') && !difference.includes('/../'));
}

function existingAncestor(path) {
  let ancestor = resolve(path);
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) throw new Error(`No existing ancestor for ${path}`);
    ancestor = parent;
  }
  return ancestor;
}

function trackedWorktreeRoots(repositoryRoot) {
  const roots = new Set([resolve(repositoryRoot)]);
  const output = execFileSync('git', ['worktree', 'list', '--porcelain'], {
    cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) roots.add(resolve(line.slice('worktree '.length)));
  }
  return [...roots].flatMap((root) => existsSync(root) ? [root, realpathSync(root)] : [root]);
}

function refusal(target, protectedRoot) {
  const error = new Error(`DASHBOARD_ARTIFACT_DIRECTORY_FORBIDDEN: ${target} resolves into tracked worktree ${protectedRoot}`);
  error.code = 'DASHBOARD_ARTIFACT_DIRECTORY_FORBIDDEN';
  return error;
}

export function createDashboardArtifactDirectory({
  environment = process.env,
  repositoryRoot,
  temporaryRoot = tmpdir(),
} = {}) {
  if (!repositoryRoot) throw new Error('repositoryRoot is required for dashboard artifact isolation');
  const requestedDirectory = environment.TORCH_CHECK_ARTIFACT_DIR;
  if (!requestedDirectory) {
    const directory = mkdtempSync(join(temporaryRoot, 'torch-dashboard-artifacts-'));
    return { directory, provenance: 'standalone-temporary', requestedDirectory: null };
  }

  const requested = resolve(requestedDirectory);
  const ancestor = existingAncestor(requested);
  const resolved = resolve(realpathSync(ancestor), relative(ancestor, requested));
  for (const protectedRoot of trackedWorktreeRoots(repositoryRoot)) {
    if (isWithin(resolved, protectedRoot)) throw refusal(requested, protectedRoot);
  }
  mkdirSync(resolved, { recursive: true });
  return { directory: resolved, provenance: 'TORCH_CHECK_ARTIFACT_DIR', requestedDirectory: requested };
}

function artifactFiles(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      const relativePath = join(prefix, entry.name);
      if (entry.isDirectory()) return artifactFiles(path, relativePath);
      if (!entry.isFile()) return [];
      const bytes = readFileSync(path);
      return [{ path: relativePath, bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex') }];
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

export function describeDashboardArtifacts(artifacts) {
  return {
    kind: 'dashboard-artifacts',
    directory: artifacts.directory,
    provenance: artifacts.provenance,
    requestedDirectory: artifacts.requestedDirectory,
    files: artifactFiles(artifacts.directory),
  };
}
