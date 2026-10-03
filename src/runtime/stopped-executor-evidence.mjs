import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, readlinkSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { TorchError } from '../kernel/errors.mjs';

const issued = new WeakMap();
const TTL_MS = 60_000;
function refuse(message) {
  throw new TorchError(message, { code: 'RUNTIME_RECOVERY_UNVERIFIED' });
}

export function readStoppedUnit(unit) {
  const result = spawnSync('systemctl', ['--user', 'show', unit,
    '--property=Id,ActiveState,SubState,MainPID,ControlPID,InvocationID,ExecStart,WorkingDirectory,ControlGroup,ExecMainExitTimestamp'],
  { encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024 });
  if (result.error || result.signal || result.status !== 0) refuse('Cannot verify the owner-selected service invocation.');
  return Object.fromEntries(result.stdout.trim().split('\n').map(line => {
    const index = line.indexOf('=');
    return [line.slice(0, index), line.slice(index + 1)];
  }));
}

export function readNativeProcesses() {
  if (process.platform !== 'linux') refuse('Legacy process inspection is supported only on Linux.');
  const processes = [];
  for (const name of readdirSync('/proc').filter(value => /^\d+$/.test(value))) {
    const directory = join('/proc', name);
    try {
      if (statSync(directory).uid !== process.getuid()) continue;
      const argv = readFileSync(join(directory, 'cmdline'), 'utf8').split('\0').filter(Boolean);
      if (!argv.length) continue;
      const native = argv.some(value => /^(?:codex|claude|pi)(?:\.js)?$/.test(basename(value)));
      if (native) processes.push({ pid: Number(name), argv, cwd: readlinkSync(join(directory, 'cwd')) });
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ESRCH') refuse('Native process visibility is incomplete; recovery refused.');
    }
  }
  return processes;
}

function verify(record) {
  const unit = record.readUnit(record.unit);
  const prefix = `torch-${record.projectId}-`;
  if (typeof record.unit !== 'string' || !record.unit.startsWith(prefix) || !/^[A-Za-z0-9_.-]+\.service$/.test(record.unit)
    || unit.Id !== record.unit || !/^[a-f0-9]{32}$/.test(unit.InvocationID ?? '')
    || unit.InvocationID !== record.invocationId
    || !['failed', 'inactive'].includes(unit.ActiveState)
    || !['failed', 'dead'].includes(unit.SubState)
    || unit.MainPID !== '0' || unit.ControlPID !== '0' || unit.ControlGroup !== ''
    || resolve(unit.WorkingDirectory || '/') !== record.repositoryRoot) {
    refuse('The selected project service is not a verified stopped invocation.');
  }
  // Explicit legacy operator binding, not a claim of cryptographic session provenance.
  // Exact area token and terminal timestamp must agree with the retained unknown row.
  if (!(unit.ExecStart ?? '').split(/[\s;]+/).includes(record.identity.areaId)
    || !Number.isFinite(Date.parse(unit.ExecMainExitTimestamp))
    || Math.abs(Date.parse(unit.ExecMainExitTimestamp) - Date.parse(record.identity.updatedAt)) > 5000) {
    refuse('Service area or terminal timestamp does not match the retained unknown identity.');
  }
  for (const processRecord of record.readProcesses()) {
    if (processRecord.argv.includes(record.identity.runtimeSessionId)
      || processRecord.argv.includes(record.worktree)
      || resolve(processRecord.cwd) === record.worktree) {
      refuse('A native process still references the selected session or workspace.');
    }
  }
  return { unit: record.unit, invocationId: unit.InvocationID,
    terminalAt: new Date(Date.parse(unit.ExecMainExitTimestamp)).toISOString(),
    outcome: 'unknown', verification: 'owner-selected-legacy-invocation' };
}

export function issueStoppedExecutorEvidence({ controlPlane, actorId, areaId, unit, invocationId,
  readUnit = readStoppedUnit, readProcesses = readNativeProcesses, now = () => Date.now() } = {}) {
  controlPlane.assertOwnerActor(actorId);
  const identity = controlPlane.getAgent(areaId);
  if (identity.state !== 'working' || !identity.runtimeSessionId || !identity.updatedAt
    || !identity.summary?.includes('Runtime executor completion is unknown')) {
    refuse('Only an exact retained working/unknown identity can use legacy recovery.');
  }
  const worktree = controlPlane.manifest.external?.find(entry => entry.type === 'worktree' && entry.area === areaId)?.path;
  if (!worktree) refuse('No registered workspace exists for this identity.');
  const record = { identity: Object.freeze({ areaId, state: identity.state, runtime: identity.runtime,
    runtimeSessionId: identity.runtimeSessionId, updatedAt: identity.updatedAt }),
  unit, invocationId, projectId: controlPlane.projectId, repositoryRoot: resolve(controlPlane.repositoryRoot),
  worktree: resolve(worktree), readUnit, readProcesses, now, issuedAt: now() };
  const facts = verify(record);
  const evidence = Object.freeze({});
  issued.set(evidence, record);
  return { evidence, plan: { areaId, expectedIdentity: record.identity, ...facts,
    mutationPerformed: false, effect: 'Recover presence to offline; preserve task, session and unknown outcome. No provider launch.' } };
}

export function consumeStoppedExecutorEvidence(evidence, { projectId, repositoryRoot, identity } = {}) {
  const record = issued.get(evidence);
  if (!record) refuse('Recovery requires fresh Runtime-issued evidence, not caller text or a Boolean.');
  issued.delete(evidence);
  if (record.projectId !== projectId || record.repositoryRoot !== resolve(repositoryRoot)
    || record.now() < record.issuedAt
    || record.now() - record.issuedAt > TTL_MS
    || ['areaId', 'state', 'runtime', 'runtimeSessionId', 'updatedAt'].some(key => record.identity[key] !== identity[key])) {
    refuse('Recovery evidence is stale, expired or belongs to another identity.');
  }
  const facts = verify(record); // Recheck physical state immediately before the transactional mutation.
  return { ...facts, digest: createHash('sha256').update(JSON.stringify({ identity: record.identity, ...facts })).digest('hex') };
}
