import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { loadFleetDefinition } from '../kernel/worktrees.mjs';
import { TorchError } from '../kernel/errors.mjs';
import { queueManagerCheckIn } from '../observability/manager-checkin.mjs';
import { CheckService } from '../checks/service.mjs';
import { IntegrationService } from '../integration/service.mjs';
import { OwnerDigestService } from '../observability/owner-digest.mjs';

function cronPartMatches(part, value, { sunday = false } = {}) {
  return part.split(',').some((segment) => {
    const [rangeText, stepText] = segment.split('/');
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) return false;
    const normalize = (number) => (sunday && number === 7 ? 0 : number);
    if (rangeText === '*') return value % step === 0;
    const [startText, endText] = rangeText.split('-');
    const start = normalize(Number(startText));
    const end = endText === undefined ? start : normalize(Number(endText));
    if (!Number.isInteger(start) || !Number.isInteger(end) || value < start || value > end) return false;
    return (value - start) % step === 0;
  });
}

export function cronMatches(expression, at) {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [minute, hour, day, month, weekday] = parts;
  if (!cronPartMatches(minute, at.getMinutes()) || !cronPartMatches(hour, at.getHours())
    || !cronPartMatches(month, at.getMonth() + 1)) return false;
  const dayMatches = cronPartMatches(day, at.getDate());
  const weekdayMatches = cronPartMatches(weekday, at.getDay(), { sunday: true });
  if (day === '*' && weekday === '*') return true;
  if (day === '*') return weekdayMatches;
  if (weekday === '*') return dayMatches;
  return dayMatches || weekdayMatches;
}

function sameMinute(left, right) {
  return left && right && left.slice(0, 16) === right.slice(0, 16);
}

function text(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TorchError(`Schedule ${field} is required`, { code: 'SCHEDULE_CONFIG_INVALID', details: { field } });
  }
  return value.trim();
}

function validate(definition) {
  const id = text(definition?.id, 'id');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new TorchError(`Invalid schedule id: ${id}`, { code: 'SCHEDULE_CONFIG_INVALID' });
  if (!['system', 'session'].includes(definition.lifetime)) throw new TorchError(`Invalid schedule lifetime: ${id}`, { code: 'SCHEDULE_CONFIG_INVALID' });
  if (!['read-only', 'coordination', 'mutating'].includes(definition.behavior)) throw new TorchError(`Invalid schedule behavior: ${id}`, { code: 'SCHEDULE_CONFIG_INVALID' });
  if (!Array.isArray(definition.required_authority) || !definition.required_authority.length) {
    throw new TorchError(`Schedule has no required authority: ${id}`, { code: 'SCHEDULE_CONFIG_INVALID' });
  }
  if (!definition.trigger || !['manual', 'interval', 'cron'].includes(definition.trigger.type)) {
    throw new TorchError(`Invalid schedule trigger: ${id}`, { code: 'SCHEDULE_CONFIG_INVALID' });
  }
  if (definition.trigger.type === 'interval'
    && (!Number.isInteger(definition.trigger.seconds) || definition.trigger.seconds < 1)) {
    throw new TorchError(`Invalid schedule interval: ${id}`, { code: 'SCHEDULE_CONFIG_INVALID' });
  }
  if (definition.trigger.type === 'cron'
    && (typeof definition.trigger.expression !== 'string' || definition.trigger.expression.trim().split(/\s+/).length !== 5)) {
    throw new TorchError(`Invalid schedule cron expression: ${id}`, { code: 'SCHEDULE_CONFIG_INVALID' });
  }
  if (definition.action?.type === 'command') {
    if (typeof definition.action.command !== 'string' || !Array.isArray(definition.action.args)
      || definition.action.args.some((arg) => typeof arg !== 'string') || definition.behavior === 'coordination') {
      throw new TorchError(`Schedule action/behavior is invalid: ${id}`, { code: 'SCHEDULE_CONFIG_INVALID' });
    }
  } else if (definition.action?.type === 'manager-check-in') {
    if (definition.behavior !== 'coordination' || definition.lifetime !== 'system'
      || !definition.required_authority.includes('owner')) {
      throw new TorchError(`Manager check-in schedules must be owner-authorized system coordination schedules: ${id}`, {
        code: 'SCHEDULE_CONFIG_INVALID', details: { id },
      });
    }
  } else if (definition.action?.type === 'integration-drain') {
    if (definition.behavior !== 'mutating' || definition.lifetime !== 'system'
      || !['interval', 'cron'].includes(definition.trigger.type)
      || !definition.required_authority.includes('owner')
      || (definition.trigger.type === 'interval' && definition.trigger.seconds < 60)
      || typeof definition.action.landing_authority_id !== 'string'
      || !/^[a-z0-9][a-z0-9-]*$/.test(definition.action.landing_authority_id)
      || (definition.action.limit !== undefined
        && (!Number.isInteger(definition.action.limit) || definition.action.limit < 1 || definition.action.limit > 500))) {
      throw new TorchError(`Integration-drain schedules must be owner-authorized system mutation schedules: ${id}`, {
        code: 'SCHEDULE_CONFIG_INVALID', details: { id },
      });
    }
    if (definition.retry?.max_attempts !== undefined && definition.retry.max_attempts !== 1) {
      throw new TorchError(`Integration-drain schedules cannot retry an ambiguous partial drain: ${id}`, {
        code: 'SCHEDULE_CONFIG_INVALID', details: { id },
      });
    }
  } else if (definition.action?.type === 'owner-digest') {
    if (definition.behavior !== 'coordination' || definition.lifetime !== 'system'
      || !definition.required_authority.includes('owner') || (definition.retry?.max_attempts ?? 1) !== 1) {
      throw new TorchError('Owner digest requires an owner-authorized system coordination schedule without automatic retry', { code: 'SCHEDULE_CONFIG_INVALID' });
    }
  } else {
    throw new TorchError(`Unsupported schedule action: ${id}`, { code: 'SCHEDULE_CONFIG_INVALID' });
  }
  const attempts = definition.retry?.max_attempts ?? 1;
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10) {
    throw new TorchError(`Invalid schedule retry policy: ${id}`, { code: 'SCHEDULE_CONFIG_INVALID' });
  }
  text(definition.owner, 'owner');
  text(definition.source_of_truth, 'source_of_truth');
  return { ...definition, retry: { max_attempts: attempts } };
}

function bounded(value) {
  const content = value?.toString() ?? '';
  const safe = content
    .replace(/\bBearer\s+[-A-Za-z0-9._~+/]+=*/gi, 'Bearer [REDACTED]')
    .replace(/((?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|token|password|secret|credential|authorization|cookie|prompt|private reasoning)\s*(?:=|:|\s)\s*)([^\s,;]+)/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@');
  return safe.length > 65_536 ? `${safe.slice(0, 65_536)}\n[truncated]` : safe;
}

function managerWakeCapability(prepared, managerId, maxUsd) {
  const plan = prepared?.plan;
  if (!plan || plan.canProceed !== true) {
    const blockers = plan?.blockers ?? [];
    const unsupportedCeiling = blockers.some((blocker) => blocker.code?.startsWith('RUNTIME_COST_CEILING_'));
    return {
      plan, action: null,
      reason: unsupportedCeiling ? 'runtime-cost-ceiling-unsupported' : 'manager-runtime-wake-plan-blocked',
      blockers,
    };
  }
  const action = plan.actions?.find((entry) => entry.areaId === managerId);
  if (!action || plan.actions.length !== 1) {
    return { plan, action: null, reason: 'manager-runtime-wake-plan-invalid', blockers: [] };
  }
  if (maxUsd === undefined) return { plan, action, reason: null, blockers: [] };
  const receipt = action?.costCeiling;
  if (receipt?.enforced !== true || receipt.maxUsd !== maxUsd || typeof receipt.mode !== 'string'
    || !receipt.mode.trim()) {
    return { plan, action: null, reason: 'runtime-cost-ceiling-unproven', blockers: [] };
  }
  return { plan, action, reason: null, blockers: [] };
}

export class ScheduleService {
  constructor({
    repositoryRoot, controlPlane,
    wakeManager = null,
    executor = (command, args, options) => spawnSync(command, args, options),
    clock = () => new Date(), idFactory = randomUUID,
  } = {}) {
    this.repositoryRoot = repositoryRoot;
    this.controlPlane = controlPlane;
    this.wakeManager = wakeManager;
    this.executor = executor;
    this.clock = clock;
    this.idFactory = idFactory;
    const { config } = loadFleetDefinition(repositoryRoot);
    this.integrationPolicy = config.integration;
    this.runtimeWakeBudget = config.runtime_wake_budget?.max_invocations_per_day ?? 0;
    this.definitions = new Map((config.schedules ?? []).map((definition) => {
      const normalized = validate(definition);
      if (normalized.action.type === 'integration-drain') {
        if (!this.integrationPolicy.landing_authority.includes(normalized.action.landing_authority_id)) {
          throw new TorchError(`Integration-drain schedule ${normalized.id} names an identity without landing authority`, {
            code: 'SCHEDULE_CONFIG_INVALID', details: { landingAuthorityId: normalized.action.landing_authority_id },
          });
        }
        this.controlPlane.assertIdentity(normalized.action.landing_authority_id);
      }
      return [normalized.id, normalized];
    }));
  }

  #initialize() {
    this.controlPlane.database.exec(`
      CREATE TABLE IF NOT EXISTS schedule_runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        schedule_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        exit_status INTEGER,
        result TEXT NOT NULL,
        stdout TEXT,
        stderr TEXT
      );
      CREATE INDEX IF NOT EXISTS schedule_runs_schedule_time
        ON schedule_runs(schedule_id, started_at, id);
      CREATE TABLE IF NOT EXISTS schedule_wake_reservations (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        schedule_id TEXT NOT NULL,
        manager_id TEXT NOT NULL,
        message_id TEXT NOT NULL UNIQUE,
        budget_day TEXT NOT NULL,
        reserved_at TEXT NOT NULL,
        outcome TEXT NOT NULL DEFAULT 'reserved'
      );
      CREATE INDEX IF NOT EXISTS schedule_wake_project_budget_day
        ON schedule_wake_reservations(project_id, budget_day);
    `);
  }

  #reserveWake(definition, managerId, messageId, at) {
    const cap = this.runtimeWakeBudget;
    if (!definition.action.wake?.enabled || !Number.isInteger(cap) || cap < 1) {
      return { allowed: false, reason: 'wake-disabled' };
    }
    const database = this.controlPlane.database;
    const budgetDay = at.toISOString().slice(0, 10);
    this.#initialize();
    database.exec('BEGIN IMMEDIATE');
    try {
      const existing = database.prepare(`
        SELECT outcome FROM schedule_wake_reservations WHERE message_id = ?
      `).get(messageId);
      if (existing) {
        database.exec('COMMIT');
        return { allowed: false, reason: 'manager-wake-already-attempted', outcome: existing.outcome };
      }
      const pending = database.prepare(`
        SELECT id FROM schedule_wake_reservations
        WHERE project_id = ? AND manager_id = ? AND outcome = 'reserved'
      `).get(this.controlPlane.projectId, managerId);
      const state = this.controlPlane.identity(managerId).state;
      if (pending || !['offline', 'idle', 'waiting', 'stale'].includes(state)) {
        database.exec('COMMIT');
        return { allowed: false, reason: 'manager-runtime-already-active', managerState: state };
      }
      const count = database.prepare(`
        SELECT COUNT(*) AS count FROM schedule_wake_reservations
        WHERE project_id = ? AND budget_day = ?
      `).get(this.controlPlane.projectId, budgetDay).count;
      if (count >= cap) {
        database.exec('COMMIT');
        return { allowed: false, reason: 'daily-invocation-budget-exhausted', used: count, limit: cap };
      }
      database.prepare(`
        INSERT INTO schedule_wake_reservations (
          id, project_id, schedule_id, manager_id, message_id, budget_day, reserved_at, outcome
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'reserved')
      `).run(this.idFactory(), this.controlPlane.projectId, definition.id, managerId,
        messageId, budgetDay, at.toISOString());
      database.exec('COMMIT');
      return { allowed: true, used: count + 1, limit: cap, budgetDay };
    } catch (error) {
      try { database.exec('ROLLBACK'); } catch { /* retain the original failure */ }
      throw error;
    }
  }

  #definition(id) {
    const definition = this.definitions.get(id);
    if (!definition) throw new TorchError(`Unknown schedule: ${id}`, { code: 'SCHEDULE_NOT_FOUND' });
    return definition;
  }

  wakeReservations({ managerId, limit = 100 } = {}) {
    if (managerId) this.controlPlane.assertIdentity(managerId);
    const database = this.controlPlane.database;
    if (!database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schedule_wake_reservations'").get()) return [];
    const safeLimit = Number.isInteger(limit) && limit > 0 && limit <= 1000 ? limit : 100;
    const rows = managerId
      ? database.prepare(`SELECT * FROM schedule_wake_reservations
          WHERE project_id = ? AND manager_id = ? ORDER BY reserved_at DESC, id DESC LIMIT ?`)
        .all(this.controlPlane.projectId, managerId, safeLimit)
      : database.prepare(`SELECT * FROM schedule_wake_reservations
          WHERE project_id = ? ORDER BY reserved_at DESC, id DESC LIMIT ?`)
        .all(this.controlPlane.projectId, safeLimit);
    return rows.map((row) => ({
      id: row.id, scheduleId: row.schedule_id, managerId: row.manager_id,
      messageId: row.message_id, budgetDay: row.budget_day,
      reservedAt: row.reserved_at, outcome: row.outcome,
      blocksManagerWake: row.outcome === 'reserved',
      managerState: this.controlPlane.identity(row.manager_id).state,
      runtimeStoppedVerified: false,
    }));
  }

  recoverWake({ reservationId, actorId, approved = false, runtimeStopped = false, note } = {}) {
    this.controlPlane.assertOwnerActor(actorId);
    if (!approved || runtimeStopped !== true || typeof note !== 'string' || !note.trim()) {
      throw new TorchError('Wake recovery requires owner approval, a stopped-runtime attestation and an evidence note.', {
        code: 'WAKE_RECOVERY_APPROVAL_REQUIRED',
      });
    }
    const database = this.controlPlane.database;
    this.#initialize();
    database.exec('BEGIN IMMEDIATE');
    try {
      const row = database.prepare('SELECT * FROM schedule_wake_reservations WHERE id = ? AND project_id = ?')
        .get(reservationId, this.controlPlane.projectId);
      if (!row) throw new TorchError('Unknown wake reservation', { code: 'WAKE_RESERVATION_NOT_FOUND' });
      if (row.outcome === 'recovered-stopped') {
        database.exec('COMMIT');
        return { id: row.id, outcome: row.outcome, replay: true, invoked: false };
      }
      if (row.outcome !== 'reserved' || this.controlPlane.identity(row.manager_id).state !== 'offline') {
        throw new TorchError('Only an interrupted reservation for an offline manager can be recovered.', {
          code: 'WAKE_RECOVERY_BLOCKED', details: { outcome: row.outcome, managerId: row.manager_id },
        });
      }
      database.prepare("UPDATE schedule_wake_reservations SET outcome = 'recovered-stopped' WHERE id = ?")
        .run(row.id);
      this.controlPlane.auditOwnerAction({ actorId, operation: 'schedule.wake.recover',
        entityType: 'wake-reservation', entityId: row.id,
        details: { managerId: row.manager_id, messageId: row.message_id, note: note.trim(),
          runtimeStoppedAttested: true, runtimeStoppedVerified: false,
          budgetChargeRetained: true, messageReplayBlocked: true },
      });
      database.exec('COMMIT');
      return { id: row.id, outcome: 'recovered-stopped', replay: false, invoked: false,
        budgetChargeRetained: true, messageReplayBlocked: true };
    } catch (error) {
      try { database.exec('ROLLBACK'); } catch { /* retain original failure */ }
      throw error;
    }
  }

  runs({ scheduleId, limit = 100 } = {}) {
    const table = this.controlPlane.database.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schedule_runs'
    `).get();
    if (!table) return [];
    const safeLimit = Number.isInteger(limit) && limit > 0 && limit <= 1000 ? limit : 100;
    const rows = scheduleId
      ? this.controlPlane.database.prepare(`SELECT * FROM schedule_runs WHERE schedule_id = ? ORDER BY started_at DESC, id DESC LIMIT ?`).all(scheduleId, safeLimit)
      : this.controlPlane.database.prepare(`SELECT * FROM schedule_runs ORDER BY started_at DESC, id DESC LIMIT ?`).all(safeLimit);
    return rows.map((row) => ({
      id: row.id, scheduleId: row.schedule_id, actorId: row.actor_id,
      startedAt: row.started_at, finishedAt: row.finished_at, attempts: row.attempts,
      exitStatus: row.exit_status, result: row.result, stdout: row.stdout, stderr: row.stderr,
    }));
  }

  plan({ scheduleId, actorId, at = this.clock() } = {}) {
    const definition = this.#definition(scheduleId);
    const blockers = [];
    if (definition.action.type === 'owner-digest' && loadFleetDefinition(this.repositoryRoot).config.owner_digest?.enabled !== true) blockers.push('owner-digest-disabled');
    if (!definition.required_authority.includes(actorId)) blockers.push('actor-not-authorized');
    if (actorId !== 'owner') {
      try { this.controlPlane.assertIdentity(actorId); } catch { blockers.push('actor-not-a-fleet-identity'); }
    }
    if (definition.lifetime === 'session') {
      const manager = this.controlPlane.identity('session-manager');
      if (manager.state === 'offline') blockers.push('session-manager-offline');
    }
    const lastRun = this.runs({ scheduleId, limit: 1 })[0] ?? null;
    let due = definition.trigger.type === 'manual' ? null : !lastRun;
    let nextAt = null;
    if (definition.trigger.type === 'interval' && lastRun) {
      nextAt = new Date(Date.parse(lastRun.startedAt) + definition.trigger.seconds * 1000).toISOString();
      due = at.getTime() >= Date.parse(nextAt);
    }
    if (definition.trigger.type === 'cron') {
      due = cronMatches(definition.trigger.expression, at)
        && !sameMinute(lastRun?.startedAt, at.toISOString());
    }
    return {
      schedule: definition, actorId, due, nextAt, blockers,
      wakeEnabled: definition.action.type === 'manager-check-in' && definition.action.wake?.enabled === true,
      wakeAvailable: typeof this.wakeManager?.plan === 'function'
        && typeof this.wakeManager?.invoke === 'function',
      wakeMaxUsdPerInvocation: definition.action.type === 'manager-check-in'
        ? definition.action.wake?.max_usd_per_invocation ?? null : null,
      wakeBudgetMode: definition.action.type === 'manager-check-in'
        ? definition.action.wake?.budget_mode
          ?? (definition.action.wake?.max_usd_per_invocation !== undefined ? 'usd-hard-cap' : null) : null,
      canRun: blockers.length === 0, mutationPerformed: false,
    };
  }

  run({ scheduleId, actorId, approved = false } = {}) {
    const plan = this.plan({ scheduleId, actorId });
    if (!plan.canRun) throw new TorchError(`Schedule cannot run: ${scheduleId}`, { code: 'SCHEDULE_BLOCKED', details: plan.blockers });
    if (plan.schedule.behavior !== 'read-only' && approved !== true) {
      throw new TorchError('Mutating or coordination schedule requires explicit approval', { code: 'APPROVAL_REQUIRED' });
    }
    const startedAt = this.clock().toISOString();
    let execution;
    let attempts = 0;
    let terminalAttempt = false;
    do {
      attempts += 1;
      if (plan.schedule.action.type === 'manager-check-in') {
        try {
          const checkIn = queueManagerCheckIn({
            repositoryRoot: this.repositoryRoot, controlPlane: this.controlPlane,
            managerId: plan.schedule.action.manager_id, at: this.clock(),
            staleWork: plan.schedule.action.stale_work ?? null,
          });
          const needsWake = checkIn.queued
            || (checkIn.reason === 'check-in-already-pending' && Boolean(checkIn.messageId));
          let wake = { attempted: false, reason: checkIn.queued ? 'wake-disabled' : checkIn.reason };
          const managerState = this.controlPlane.identity(plan.schedule.action.manager_id).state;
          const managerCanBeWoken = ['offline', 'idle', 'waiting', 'stale'].includes(managerState);
          const hasWakeManager = typeof this.wakeManager?.plan === 'function'
            && typeof this.wakeManager?.invoke === 'function';
          if (needsWake && plan.schedule.action.wake?.enabled && !hasWakeManager) {
            wake = { attempted: false, reason: 'manager-runtime-waker-unavailable' };
          } else if (needsWake && plan.schedule.action.wake?.enabled && !managerCanBeWoken) {
            wake = { attempted: false, reason: 'manager-runtime-already-active', managerState };
          } else if (needsWake && plan.schedule.action.wake?.enabled) {
            const managerId = plan.schedule.action.manager_id;
            const budgetMode = plan.wakeBudgetMode;
            const maxUsd = budgetMode === 'usd-hard-cap'
              ? plan.schedule.action.wake.max_usd_per_invocation : undefined;
            let prepared;
            try {
              prepared = this.wakeManager.plan({ managerId, maxUsd, scheduleId });
            } catch (error) {
              wake = { attempted: false, reason: 'manager-runtime-wake-plan-failed', error: error.message };
            }
            if (!wake.error) {
              const capability = managerWakeCapability(prepared, managerId, maxUsd);
              if (capability.reason) {
                wake = {
                  attempted: false, reason: capability.reason,
                  ...(capability.blockers.length ? { blockers: capability.blockers } : {}),
                };
              } else {
                const reservation = this.#reserveWake(
                  plan.schedule, managerId, checkIn.messageId, this.clock(),
                );
                if (!reservation.allowed) {
                  wake = { attempted: false, ...reservation };
                } else {
                  try {
                    const result = this.wakeManager.invoke({
                      managerId, checkIn, scheduleId, reservation, maxUsd, prepared,
                    });
                    wake = {
                      attempted: true, ...reservation, budgetMode,
                      dollarCapEnforced: maxUsd !== undefined,
                      ...(maxUsd === undefined ? {} : { maxUsd, costCeiling: capability.action.costCeiling }), result,
                    };
                    this.controlPlane.database.prepare(`
                      UPDATE schedule_wake_reservations SET outcome = 'invoked'
                      WHERE message_id = ?
                    `).run(checkIn.messageId);
                  } catch (error) {
                    this.controlPlane.database.prepare(`
                      UPDATE schedule_wake_reservations SET outcome = 'failed'
                      WHERE message_id = ?
                    `).run(checkIn.messageId);
                    terminalAttempt = true;
                    throw error;
                  }
                }
              }
            }
          }
          execution = { status: 0, stdout: JSON.stringify({ checkIn, wake }), stderr: '' };
        } catch (error) {
          execution = { status: 1, stdout: '', stderr: error.message, error };
        }
      } else if (plan.schedule.action.type === 'owner-digest') {
        try {
          const digest = new OwnerDigestService({ repositoryRoot: this.repositoryRoot, controlPlane: this.controlPlane, clock: this.clock });
          const published = digest.publish({ actorId: 'session-manager' });
          execution = { status: 0, stdout: JSON.stringify({ digestId: published.id, generatedAt: published.report.generatedAt,
            externalDeliveryPerformed: false }), stderr: '' };
        } catch (error) { execution = { status: 1, stdout: '', stderr: error.message, error }; }
      } else if (plan.schedule.action.type === 'integration-drain') {
        try {
          const checkService = new CheckService({
            repositoryRoot: this.repositoryRoot, controlPlane: this.controlPlane,
          });
          const integration = new IntegrationService({
            repositoryRoot: this.repositoryRoot, controlPlane: this.controlPlane, checkService,
          });
          const drain = integration.drain({
            actorId: plan.schedule.action.landing_authority_id,
            limit: plan.schedule.action.limit ?? 50,
          });
          execution = { status: 0, stdout: JSON.stringify(drain), stderr: '' };
        } catch (error) {
          execution = { status: 1, stdout: '', stderr: error.message, error };
        }
      } else {
        execution = this.executor(plan.schedule.action.command, plan.schedule.action.args, {
          cwd: this.repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: false,
        });
      }
    } while ((execution.status !== 0 || execution.error)
      && attempts < plan.schedule.retry.max_attempts && !terminalAttempt);
    const succeeded = execution.status === 0 && !execution.error && !execution.signal;
    const run = {
      id: this.idFactory(), scheduleId, actorId, startedAt, finishedAt: this.clock().toISOString(),
      attempts, exitStatus: execution.status ?? null, result: succeeded ? 'succeeded' : 'failed',
      stdout: bounded(execution.stdout), stderr: bounded(execution.stderr ?? execution.error?.message),
    };
    this.#initialize();
    this.controlPlane.database.prepare(`
      INSERT INTO schedule_runs (
        id, project_id, schedule_id, actor_id, started_at, finished_at,
        attempts, exit_status, result, stdout, stderr
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      run.id, this.controlPlane.projectId, run.scheduleId, run.actorId, run.startedAt,
      run.finishedAt, run.attempts, run.exitStatus, run.result, run.stdout, run.stderr,
    );
    if (!succeeded && plan.schedule.failure_recipient && actorId !== 'owner') {
      this.controlPlane.sendMessage({
        sender: actorId, recipient: plan.schedule.failure_recipient, kind: 'blocker',
        body: `Schedule ${scheduleId} failed after ${attempts} attempt${attempts === 1 ? '' : 's'}.`,
      });
    }
    return { ...run, mutationPerformed: true };
  }

  list({ actorId } = {}) {
    return [...this.definitions.values()].map((definition) => this.plan({ scheduleId: definition.id, actorId }));
  }

  dispatchSystem({ actorId = 'owner', approved = false, at = this.clock() } = {}) {
    const considered = [...this.definitions.values()].filter((definition) => definition.lifetime === 'system');
    const due = considered.filter((definition) => {
      if (definition.trigger.type === 'manual') return false;
      return this.plan({ scheduleId: definition.id, actorId, at }).due === true;
    });
    const runs = due.map((definition) => this.run({ scheduleId: definition.id, actorId, approved }));
    return {
      at: at.toISOString(), considered: considered.map((definition) => definition.id),
      due: due.map((definition) => definition.id), runs, mutationPerformed: runs.length > 0,
    };
  }
}
