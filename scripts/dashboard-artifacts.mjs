import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

function isWithin(path, root) {
  const difference = relative(root, path);
  return difference === '' || (!isAbsolute(difference) && difference !== '..' && !difference.startsWith(`..${sep}`));
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

function targetExists(target) {
  try {
    lstatSync(target);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function resolvePhysicalDirectory(directory) {
  const requested = resolve(directory);
  const ancestor = existingAncestor(requested);
  return { requested, resolved: resolve(realpathSync(ancestor), relative(ancestor, requested)) };
}

function assertExternalDirectory({ requested, resolved }, repositoryRoot) {
  for (const protectedRoot of trackedWorktreeRoots(repositoryRoot)) {
    if (isWithin(resolved, protectedRoot)) throw refusal(requested, protectedRoot);
  }
}

export function createDashboardArtifactDirectory({
  environment = process.env,
  repositoryRoot,
  temporaryRoot = tmpdir(),
} = {}) {
  if (!repositoryRoot) throw new Error('repositoryRoot is required for dashboard artifact isolation');
  const requestedDirectory = environment.TORCH_CHECK_ARTIFACT_DIR;
  if (!requestedDirectory) {
    const temporary = resolvePhysicalDirectory(temporaryRoot);
    assertExternalDirectory(temporary, repositoryRoot);
    const directory = mkdtempSync(join(temporary.resolved, 'torch-dashboard-artifacts-'));
    return { directory, provenance: 'standalone-temporary', requestedDirectory: null };
  }

  const output = resolvePhysicalDirectory(requestedDirectory);
  assertExternalDirectory(output, repositoryRoot);
  mkdirSync(output.resolved, { recursive: true });
  return { directory: output.resolved, provenance: 'TORCH_CHECK_ARTIFACT_DIR', requestedDirectory: output.requested };
}

export function prepareDashboardArtifactTargets(artifacts, names) {
  if (new Set(names).size !== names.length || names.some((name) => name !== basename(name))) {
    throw new Error('Dashboard screenshot names must be unique plain filenames');
  }
  const paths = {};
  for (const name of names) {
    const target = join(artifacts.directory, name);
    if (targetExists(target)) {
      const error = new Error(`DASHBOARD_ARTIFACT_TARGET_EXISTS: refusing to replace ${target}`);
      error.code = 'DASHBOARD_ARTIFACT_TARGET_EXISTS';
      throw error;
    }
    paths[name] = target;
  }
  return Object.freeze(paths);
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
