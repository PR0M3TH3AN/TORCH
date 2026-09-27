import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { TorchError } from './errors.mjs';

export function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

export function writeNewFile(path, content) {
  if (existsSync(path)) {
    throw new TorchError(`Refusing to overwrite existing path: ${path}`, {
      code: 'PATH_ALREADY_EXISTS',
      details: { path },
    });
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  return { path, sha256: sha256(content) };
}

export function fileHash(path) {
  return sha256(readFileSync(path));
}
