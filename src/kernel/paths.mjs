import { homedir } from 'node:os';
import { join } from 'node:path';

export function torchDataHome(env = process.env) {
  const dataHome = env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
  return join(dataHome, 'torch');
}

export function projectStatePath(projectId, env = process.env) {
  return join(torchDataHome(env), 'projects', projectId);
}
