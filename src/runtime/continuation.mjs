import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TorchError } from '../kernel/errors.mjs';

function statePath(control) { return join(control.stateRoot, 'continuation.json'); }
function occupiedAreas(control) {
  const path = join(control.stateRoot, 'sessions', 'turn-guards');
  return existsSync(path) ? readdirSync(path, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name) : [];
}
function taskKey(tasks) { return JSON.stringify(tasks.map(t => [t.id, t.revision]).sort((a, b) => a[0].localeCompare(b[0]))); }
function read(control) {
  const policyPath = join(control.stateRoot, 'continuation-policy.json');
  const state = { enabled: false, maxTurnsPerDay: 12, maxConcurrency: 3, areas: [], day: null, attempts: 0, handled: {}, progress: {},
    ...(existsSync(statePath(control)) ? JSON.parse(readFileSync(statePath(control), 'utf8')) : {}),
    ...(existsSync(policyPath) ? JSON.parse(readFileSync(policyPath, 'utf8')) : {}) };
  if (typeof state.enabled !== 'boolean' || !Number.isInteger(state.maxTurnsPerDay)
    || state.maxTurnsPerDay < 1 || state.maxTurnsPerDay > 48 || !Array.isArray(state.areas)
    || !Number.isInteger(state.maxConcurrency) || state.maxConcurrency < 1 || state.maxConcurrency > 7
    || !Number.isInteger(state.attempts) || state.attempts < 0 || !state.handled || typeof state.handled !== 'object'
    || !state.progress || typeof state.progress !== 'object') {
    throw new TorchError('Continuation policy or attempt ledger is invalid; launch refused.', { code: 'CONTINUATION_POLICY_INVALID' });
  }
  return state;
}
function save(control, state, policy = false) {
  const path = policy ? join(control.stateRoot, 'continuation-policy.json') : statePath(control);
  const temporary = `${path}.${randomUUID()}.tmp`;
  const value = policy ? { enabled: state.enabled, maxTurnsPerDay: state.maxTurnsPerDay, maxConcurrency: state.maxConcurrency, areas: state.areas }
    : { day: state.day, attempts: state.attempts, handled: state.handled, progress: state.progress };
  writeFileSync(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
  renameSync(temporary, path);
}

export function configureContinuation(control, { actorId, enabled, maxTurnsPerDay, maxConcurrency } = {}) {
  control.assertOwnerActor(actorId);
  const previous = read(control);
  maxTurnsPerDay ??= previous.maxTurnsPerDay;
  maxConcurrency ??= previous.maxConcurrency;
  if (typeof enabled !== 'boolean' || !Number.isInteger(maxTurnsPerDay) || maxTurnsPerDay < 1 || maxTurnsPerDay > 48
    || !Number.isInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 7) {
    throw new TorchError('Continuation requires explicit enable/pause, 1–48 daily turns and 1–7 concurrent turns.', { code: 'CONTINUATION_POLICY_INVALID' });
  }
  const state = { ...previous, enabled, maxTurnsPerDay, maxConcurrency, areas: control.listAgents().map(a => a.areaId) };
  save(control, state, true);
  control.auditOwnerAction({ actorId, operation: 'runtime.continuation.configure', entityType: 'project', entityId: control.projectId,
    details: { enabled, maxTurnsPerDay, maxConcurrency, areas: state.areas } });
  return { enabled, maxTurnsPerDay, maxConcurrency, areas: state.areas, sessionsStarted: false };
}

export function observeContinuation({ stateRoot, tasks = [], now = () => new Date() } = {}) {
  try {
    const state = read({ stateRoot });
    const day = now().toISOString().slice(0, 10);
    const attempts = state.day === day ? state.attempts : 0;
    const remainingTurns = Math.max(0, state.maxTurnsPerDay - attempts);
    const held = Object.entries(state.progress).filter(([area, progress]) => {
      const active = tasks.filter(t => t.owner === area && ['assigned', 'in_progress'].includes(t.state));
      return active.length && progress?.status === 0 && progress.noProgress >= 2 && progress.taskKey === taskKey(active);
    }).map(([areaId]) => ({ areaId, reason: 'no-progress-needs-coordination' }));
    return { available: existsSync(join(stateRoot, 'continuation-policy.json')), enabled: state.enabled,
      day, dayTimezone: 'UTC', attempts, maxTurnsPerDay: state.maxTurnsPerDay, maxConcurrency: state.maxConcurrency, remainingTurns,
      stopReason: !state.enabled ? 'paused' : remainingTurns === 0 ? 'daily-turn-cap' : null,
      capacityHeldBy: occupiedAreas({ stateRoot }), held,
      budgetKind: 'automatic-turn-cap', manualTurnsIncluded: false, tokenOrCostGovernance: 'unknown',
      timerInstallationVerified: false, mutationPerformed: false };
  } catch {
    return { available: false, stopReason: 'policy-or-ledger-unreadable', mutationPerformed: false };
  }
}

export function planContinuation(control, backlog, { at = new Date(), limit } = {}) {
  const state = read(control);
  const day = at.toISOString().slice(0, 10);
  const attempts = state.day === day ? state.attempts : 0;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 7)) throw new TorchError('Continuation limit must be 1–7.', { code: 'CONTINUATION_POLICY_INVALID' });
  const capacity = Math.min(limit ?? state.maxConcurrency, state.maxConcurrency);
  const metadata = JSON.parse(readFileSync(join(control.stateRoot, 'project.json'), 'utf8'));
  if (!state.enabled || metadata.detachedAt || attempts >= state.maxTurnsPerDay) {
    return { enabled: state.enabled, maxConcurrency: capacity, reason: metadata.detachedAt ? 'detached' : !state.enabled ? 'paused' : 'daily-turn-cap', candidates: [], attempts };
  }
  const tasks = backlog.list();
  const candidates = [];
  const held = [];
  for (const areaId of state.areas) {
    const agent = control.getAgent(areaId);
    if (!['idle', 'offline', 'waiting'].includes(agent.state)
      || existsSync(join(control.stateRoot, 'sessions', 'turn-guards', areaId))) continue;
    const messages = control.readMessages({ recipient: areaId, unacknowledgedOnly: true, limit: 1000 });
    const active = tasks.filter(t => t.owner === areaId && ['assigned', 'in_progress'].includes(t.state)
      && (t.dependencies ?? []).every(id => tasks.find(t => t.id === id)?.state === 'completed'));
    const previous = state.handled[areaId] ?? {};
    const freshMessages = messages.filter(m => !previous.messageIds?.includes(m.id));
    const freshTasks = active.filter(t => previous.taskRevisions?.[t.id] !== t.revision);
    const progress = state.progress[areaId];
    const continueWork = active.length > 0 && progress?.status === 0
      && progress.taskKey === taskKey(active) && progress.noProgress < 2;
    if (!freshMessages.length && !freshTasks.length && !continueWork) {
      if (active.length && progress?.noProgress >= 2) held.push({ areaId, reason: 'no-progress-needs-coordination', taskIds: active.map(t => t.id) });
      continue;
    }
    const signal = { messageIds: messages.map(m => m.id), taskRevisions: Object.fromEntries(active.map(t => [t.id, t.revision])) };
    const fingerprint = createHash('sha256').update(JSON.stringify(signal)).digest('hex');
    candidates.push({ areaId, fingerprint, signal, workKey: taskKey(active),
      messageCount: freshMessages.length, taskIds: active.map(t => t.id), continueWork });
  }
  const ordinal = area => state.handled[area]?.dispatchedDay === day ? state.handled[area].dispatchedOrdinal ?? 0 : 0;
  candidates.sort((a, b) => ordinal(a.areaId) - ordinal(b.areaId)
    || Number(b.areaId === 'session-manager') - Number(a.areaId === 'session-manager'));
  return { enabled: true, maxConcurrency: capacity, day, attempts, remainingTurns: state.maxTurnsPerDay - attempts,
    occupiedAreas: occupiedAreas(control), held,
    candidates: candidates.slice(0, Math.min(capacity, state.maxTurnsPerDay - attempts)), mutationPerformed: false };
}

export async function runContinuation(control, backlog, { actorId, launch, at, clock = () => at ?? new Date(), limit } = {}) {
  control.assertOwnerActor(actorId);
  if (typeof launch !== 'function') throw new TorchError('Continuation needs an authorized launcher.', { code: 'RUNTIME_EXECUTION_NOT_AUTHORIZED' });
  const lock = join(control.stateRoot, 'continuation.lock');
  try { mkdirSync(lock); } catch (error) {
    if (error.code === 'EEXIST') return { reason: 'controller-active-or-unreconciled', launched: [] };
    throw error;
  }
  try {
    const pending = new Map();
    const launched = [];
    let reason = null;
    while (true) {
      // Refill immediately after EACH completion. Pending promises and physical
      // guards both count, including manual executors outside this controller.
      let current = planContinuation(control, backlog, { at: clock(), limit });
      let occupied = new Set([...occupiedAreas(control), ...pending.keys()]);
      while (occupied.size < current.maxConcurrency && current.enabled && !current.reason) {
        const candidate = current.candidates.find(c => !occupied.has(c.areaId));
        if (!candidate) break;
        const state = read(control);
        if (state.day !== current.day) { state.day = current.day; state.attempts = 0; }
        state.attempts++;
        state.handled[candidate.areaId] = { ...candidate.signal,
          dispatchedDay: current.day, dispatchedOrdinal: state.attempts };
        save(control, state); // Reserve before launch; unknown attempts are never refunded.
        let result;
        try { result = launch(candidate.areaId); } catch { result = null; }
        pending.set(candidate.areaId, Promise.resolve(result).catch(() => null)
          .then(status => ({ areaId: candidate.areaId, status, candidate })));
        current = planContinuation(control, backlog, { at: clock(), limit });
        occupied = new Set([...occupiedAreas(control), ...pending.keys()]);
      }
      reason = current.reason ?? (occupied.size >= current.maxConcurrency ? 'capacity-full' : null);
      if (!pending.size) break;
      const completed = await Promise.race(pending.values());
      pending.delete(completed.areaId);
      launched.push({ areaId: completed.areaId, status: completed.status });
      const state = read(control);
      const active = backlog.list().filter(t => t.owner === completed.areaId && ['assigned', 'in_progress'].includes(t.state));
      const key = taskKey(active);
      const unchanged = active.length > 0 && key === completed.candidate.workKey;
      const prior = state.progress[completed.areaId];
      const noProgress = unchanged ? (prior?.taskKey === key ? prior.noProgress : 0) + 1 : 0;
      state.progress[completed.areaId] = { status: completed.status, taskKey: key, noProgress, completedAt: clock().toISOString() };
      save(control, state);
      if (completed.status === 0 && noProgress === 2 && typeof control.sendOwnerRequest === 'function') {
        control.sendOwnerRequest({ actorId, recipient: 'session-manager',
          body: `TORCH continuation requires coordination: ${completed.areaId} completed two turns without advancing assigned task state (${active.map(t => t.id).join(', ')}). Automatic unchanged-work retries are held. Inspect the blocker and route a concrete decision; do not mark work done without evidence.` });
      }
    }
    return { launched, reason };
  } finally { rmdirSync(lock); }
}
