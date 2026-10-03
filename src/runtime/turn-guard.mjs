import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TorchError } from '../kernel/errors.mjs';

// One physical executor per identity, including the interval after an agent
// reports idle but before its harness actually exits. Crashed guards never expire.
export function withRuntimeTurnGuard(controlPlane, areaId, run) {
  controlPlane.assertIdentity(areaId);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(areaId)) throw new TorchError('Invalid runtime guard identity.', { code: 'INVALID_RUNTIME_INPUT' });
  const parent = join(controlPlane.stateRoot, 'sessions', 'turn-guards');
  mkdirSync(parent, { recursive: true });
  const directory = join(parent, areaId);
  try { mkdirSync(directory); } catch (error) {
    if (error.code === 'EEXIST') throw new TorchError('An executor already holds this identity turn guard.', {
      code: 'RUNTIME_TURN_ACTIVE', details: { areaId },
    });
    throw error;
  }
  const path = join(directory, 'owner.json');
  const nonce = randomUUID();
  writeFileSync(path, JSON.stringify({ nonce, pid: process.pid, areaId, projectId: controlPlane.projectId }), { flag: 'wx', mode: 0o600 });
  try { return run(); } finally {
    // Delete only the exact guard created by this invocation; preserve foreign/changed guards.
    const record = JSON.parse(readFileSync(path, 'utf8'));
    if (record.nonce === nonce && record.pid === process.pid) {
      unlinkSync(path);
      rmdirSync(directory);
    }
  }
}
