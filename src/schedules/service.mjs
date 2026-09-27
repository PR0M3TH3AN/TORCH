import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { loadFleetDefinition } from '../kernel/worktrees.mjs';
import { TorchError } from '../kernel/errors.mjs';

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
  if (!['read-only', 'mutating'].includes(definition.behavior)) throw new TorchError(`Invalid schedule behavior: ${id}`, { code: 'SCHEDULE_CONFIG_INVALID' });
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
  if (definition.action?.type !== 'command' || typeof definition.action.command !== 'string'
    || !Array.isArray(definition.action.args) || definition.action.args.some((arg) => typeof arg !== 'string')) {
    throw new TorchError(`Schedule action must be a shell-free command: ${id}`, { code: 'SCHEDULE_CONFIG_INVALID' });
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
  return content.length > 65_536 ? `${content.slice(0, 65_536)}\n[truncated]` : content;
}

export class ScheduleService {
  constructor({
    repositoryRoot, controlPlane,
    executor = (command, args, options) => spawnSync(command, args, options),
    clock = () => new Date(), idFactory = randomUUID,
  } = {}) {
    this.repositoryRoot = repositoryRoot;
    this.controlPlane = controlPlane;
    this.executor = executor;
    this.clock = clock;
    this.idFactory = idFactory;
    const { config } = loadFleetDefinition(repositoryRoot);
    this.definitions = new Map((config.schedules ?? []).map((definition) => {
      const normalized = validate(definition);
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
    `);
  }

  #definition(id) {
    const definition = this.definitions.get(id);
    if (!definition) throw new TorchError(`Unknown schedule: ${id}`, { code: 'SCHEDULE_NOT_FOUND' });
    return definition;
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
      canRun: blockers.length === 0, mutationPerformed: false,
    };
  }

  run({ scheduleId, actorId, approved = false } = {}) {
    const plan = this.plan({ scheduleId, actorId });
    if (!plan.canRun) throw new TorchError(`Schedule cannot run: ${scheduleId}`, { code: 'SCHEDULE_BLOCKED', details: plan.blockers });
    if (plan.schedule.behavior === 'mutating' && approved !== true) {
      throw new TorchError('Mutating schedule requires explicit approval', { code: 'APPROVAL_REQUIRED' });
    }
    const startedAt = this.clock().toISOString();
    let execution;
    let attempts = 0;
    do {
      attempts += 1;
      execution = this.executor(plan.schedule.action.command, plan.schedule.action.args, {
        cwd: this.repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: false,
      });
    } while ((execution.status !== 0 || execution.error) && attempts < plan.schedule.retry.max_attempts);
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
