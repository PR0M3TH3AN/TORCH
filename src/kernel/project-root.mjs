import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { projectStatePath } from './paths.mjs';
import { TorchError } from './errors.mjs';

const read = path => JSON.parse(readFileSync(path, 'utf8'));
const git = (root, args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// A worktree's copied configuration is not authoritative. Only registered,
// same-installation worktrees may resolve to the current canonical definition.
export function resolveInstalledProjectRoot(root, env = process.env) {
  root = realpathSync(root);
  const path = join(root, '.torch', 'install-manifest.json');
  if (!existsSync(path)) return root;
  const manifest = read(path);
  const stateRoot = projectStatePath(manifest.projectId, env);
  const local = manifest.external?.find(entry => entry.type === 'local-state');
  if (!local || resolve(local.path) !== resolve(stateRoot)) {
    throw new TorchError('Installation state path does not match this project', { code: 'LOCAL_STATE_PATH_MISMATCH' });
  }
  const metadata = read(join(stateRoot, 'project.json'));
  if (metadata.projectId !== manifest.projectId) {
    throw new TorchError('Installation metadata belongs to another project', { code: 'LOCAL_STATE_METADATA_MISMATCH' });
  }
  const canonical = realpathSync(metadata.root);
  if (canonical === root) return root;
  const current = read(join(canonical, '.torch', 'install-manifest.json'));
  const registered = current.external?.find(entry => entry.type === 'worktree' && existsSync(entry.path) && realpathSync(entry.path) === root);
  const common = directory => realpathSync(resolve(directory, git(directory, ['rev-parse', '--git-common-dir'])));
  const members = git(canonical, ['worktree', 'list', '--porcelain']).split('\n').filter(line => line.startsWith('worktree ')).map(line => realpathSync(line.slice(9)));
  if (current.projectId !== manifest.projectId || current.installationId !== manifest.installationId
      || !registered || common(root) !== common(canonical) || !members.includes(root)
      || git(root, ['branch', '--show-current']) !== registered.branch) {
    throw new TorchError('This checkout is not a registered worktree of the installation', { code: 'UNREGISTERED_PROJECT_WORKTREE' });
  }
  return canonical;
}
