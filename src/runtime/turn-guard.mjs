import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readlinkSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { TorchError } from '../kernel/errors.mjs';

function nativeProcess(pid) {
  if (process.platform !== 'linux') throw new Error('Process observation unavailable');
  const directory = `/proc/${pid}`;
  const stat = readFileSync(join(directory, 'stat'), 'utf8');
  const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  return { uid: statSync(directory).uid, state: fields[0], startTicks: fields[19],
    cwd: readlinkSync(join(directory, 'cwd')),
    argv: readFileSync(join(directory, 'cmdline'), 'utf8').split('\0').filter(Boolean) };
}

// Observational only: never changes assignments, heartbeat, authority or launch eligibility.
export function observeRuntimeTurn({ stateRoot, repositoryRoot, projectId, areaId,
  inspectProcess = nativeProcess, uid = process.getuid?.(), now = () => new Date() } = {}) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(areaId)) return { state: 'unknown', reason: 'invalid-identity' };
  let record;
  try { record = JSON.parse(readFileSync(join(stateRoot, 'sessions', 'turn-guards', areaId, 'owner.json'), 'utf8')); }
  catch (error) { return { state: error.code === 'ENOENT' ? 'inactive' : 'unknown', reason: 'guard-unavailable' }; }
  if (record.projectId !== projectId || record.areaId !== areaId || !Number.isSafeInteger(record.pid)
    || record.pid < 1 || typeof record.nonce !== 'string' || !record.nonce) {
    return { state: 'unknown', reason: 'guard-invalid' };
  }
  try {
    const live = inspectProcess(record.pid);
    if (live.uid !== uid || ['Z', 'X'].includes(live.state)) return { state: 'unknown', reason: 'executor-not-live' };
    if (record.startTicks) {
      if (record.startTicks !== live.startTicks) return { state: 'unknown', reason: 'executor-replaced' };
    } else {
      // Existing pre-observation guards: require an exact identity-bound TORCH up process.
      const only = live.argv.indexOf('--only');
      if (resolve(live.cwd) !== resolve(repositoryRoot) || !live.argv.includes('up')
        || only < 0 || live.argv[only + 1] !== areaId
        || !live.argv.some(arg => ['torch.mjs', 'torch'].includes(basename(arg)))) {
        return { state: 'unknown', reason: 'legacy-executor-unverified' };
      }
    }
    return { state: 'active', phase: record.phase === 'starting' ? 'starting' : 'working',
      observedAt: now().toISOString(), source: 'live-process-and-turn-guard' };
  } catch { return { state: 'unknown', reason: 'executor-unobservable' }; }
}

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
  let startTicks;
  try { startTicks = nativeProcess(process.pid).startTicks; } catch { /* Unavailable hosts remain observationally unknown. */ }
  const record = { nonce, pid: process.pid, areaId, projectId: controlPlane.projectId, startTicks, phase: 'starting' };
  writeFileSync(path, JSON.stringify(record), { flag: 'wx', mode: 0o600 });
  const setPhase = phase => {
    if (!['starting', 'working'].includes(phase)) throw new TorchError('Invalid runtime phase.', { code: 'INVALID_RUNTIME_INPUT' });
    const current = JSON.parse(readFileSync(path, 'utf8'));
    if (current.nonce !== nonce || current.pid !== process.pid) throw new TorchError('Runtime guard changed.', { code: 'RUNTIME_TURN_ACTIVE' });
    const temporary = `${path}.${nonce}.tmp`;
    writeFileSync(temporary, JSON.stringify({ ...record, phase }), { flag: 'wx', mode: 0o600 });
    renameSync(temporary, path);
  };
  try { return run(setPhase); } finally {
    // Delete only the exact guard created by this invocation; preserve foreign/changed guards.
    const record = JSON.parse(readFileSync(path, 'utf8'));
    if (record.nonce === nonce && record.pid === process.pid) {
      unlinkSync(path);
      rmdirSync(directory);
    }
  }
}
