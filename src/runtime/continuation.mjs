import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TorchError } from '../kernel/errors.mjs';

function statePath(control) { return join(control.stateRoot, 'continuation.json'); }
function read(control) {
  const policyPath = join(control.stateRoot, 'continuation-policy.json');
  const state = { enabled: false, maxTurnsPerDay: 12, areas: [], day: null, attempts: 0, handled: {},
    ...(existsSync(statePath(control)) ? JSON.parse(readFileSync(statePath(control), 'utf8')) : {}),
    ...(existsSync(policyPath) ? JSON.parse(readFileSync(policyPath, 'utf8')) : {}) };
  if (typeof state.enabled !== 'boolean' || !Number.isInteger(state.maxTurnsPerDay)
    || state.maxTurnsPerDay < 1 || state.maxTurnsPerDay > 48 || !Array.isArray(state.areas)
    || !Number.isInteger(state.attempts) || state.attempts < 0 || !state.handled || typeof state.handled !== 'object') {
    throw new TorchError('Continuation policy or attempt ledger is invalid; launch refused.', { code: 'CONTINUATION_POLICY_INVALID' });
  }
  return state;
}
function save(control, state, policy = false) {
  const path = policy ? join(control.stateRoot, 'continuation-policy.json') : statePath(control);
  const temporary = `${path}.${randomUUID()}.tmp`;
  const value = policy ? { enabled: state.enabled, maxTurnsPerDay: state.maxTurnsPerDay, areas: state.areas }
    : { day: state.day, attempts: state.attempts, handled: state.handled };
  writeFileSync(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
  renameSync(temporary, path);
}

export function configureContinuation(control, { actorId, enabled, maxTurnsPerDay = 12 } = {}) {
  control.assertOwnerActor(actorId);
  if (typeof enabled !== 'boolean' || !Number.isInteger(maxTurnsPerDay) || maxTurnsPerDay < 1 || maxTurnsPerDay > 48) {
    throw new TorchError('Continuation requires an explicit enable/pause and 1–48 daily turns.', { code: 'CONTINUATION_POLICY_INVALID' });
  }
  const state = { ...read(control), enabled, maxTurnsPerDay, areas: control.listAgents().map(a => a.areaId) };
  save(control, state, true);
  control.auditOwnerAction({ actorId, operation: 'runtime.continuation.configure', entityType: 'project', entityId: control.projectId,
    details: { enabled, maxTurnsPerDay, areas: state.areas } });
  return { enabled, maxTurnsPerDay, areas: state.areas, sessionsStarted: false };
}

export function planContinuation(control, backlog, { at = new Date(), limit = 3 } = {}) {
  const state = read(control);
  const day = at.toISOString().slice(0, 10);
  const attempts = state.day === day ? state.attempts : 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 3) throw new TorchError('Continuation limit must be 1–3.', { code: 'CONTINUATION_POLICY_INVALID' });
  const metadata = JSON.parse(readFileSync(join(control.stateRoot, 'project.json'), 'utf8'));
  if (!state.enabled || metadata.detachedAt || attempts >= state.maxTurnsPerDay) {
    return { enabled: state.enabled, reason: metadata.detachedAt ? 'detached' : !state.enabled ? 'paused' : 'daily-turn-cap', candidates: [], attempts };
  }
  const tasks = backlog.list();
  const candidates = [];
  for (const areaId of state.areas) {
    const agent = control.getAgent(areaId);
    if (!['idle', 'offline', 'waiting'].includes(agent.state)
      || existsSync(join(control.stateRoot, 'sessions', 'turn-guards', areaId))) continue;
    const messages = control.readMessages({ recipient: areaId, unacknowledgedOnly: true, limit: 1000 });
    const active = tasks.filter(t => t.owner === areaId && ['assigned', 'in_progress'].includes(t.state));
    if (!messages.length && !active.length) continue;
    const fingerprint = createHash('sha256').update(JSON.stringify({ messages: messages.map(m => m.id), tasks: active.map(t => [t.id, t.revision]) })).digest('hex');
    if (state.handled[areaId] === fingerprint) continue;
    candidates.push({ areaId, fingerprint, messageCount: messages.length, taskIds: active.map(t => t.id) });
  }
  candidates.sort((a, b) => Number(b.areaId === 'session-manager') - Number(a.areaId === 'session-manager'));
  return { enabled: true, day, attempts, remainingTurns: state.maxTurnsPerDay - attempts,
    candidates: candidates.slice(0, Math.min(limit, state.maxTurnsPerDay - attempts)), mutationPerformed: false };
}

export async function runContinuation(control, backlog, { actorId, launch, at, clock = () => at ?? new Date(), limit = 3 } = {}) {
  control.assertOwnerActor(actorId);
  if (typeof launch !== 'function') throw new TorchError('Continuation needs an authorized launcher.', { code: 'RUNTIME_EXECUTION_NOT_AUTHORIZED' });
  const lock = join(control.stateRoot, 'continuation.lock');
  try { mkdirSync(lock); } catch (error) {
    if (error.code === 'EEXIST') return { reason: 'controller-active-or-unreconciled', launched: [] };
    throw error;
  }
  try {
    const plan = planContinuation(control, backlog, { at: clock(), limit });
    const launched = [];
    for (const candidate of plan.candidates) {
      // Fresh plan and policy check before each launch; a concurrent pause wins.
      const current = planContinuation(control, backlog, { at: clock(), limit: 3 });
      if (!current.candidates.some(c => c.areaId === candidate.areaId && c.fingerprint === candidate.fingerprint)) continue;
      const state = read(control);
      if (state.day !== current.day) { state.day = current.day; state.attempts = 0; }
      state.attempts++;
      state.handled[candidate.areaId] = candidate.fingerprint;
      save(control, state); // Charge/reserve before launch; interrupted attempts are never refunded/retried silently.
      const status = await launch(candidate.areaId);
      launched.push({ areaId: candidate.areaId, status });
    }
    return { launched, reason: plan.reason ?? null };
  } finally { rmdirSync(lock); }
}
