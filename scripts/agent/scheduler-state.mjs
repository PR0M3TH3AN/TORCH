import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readJson, getRunDateKey } from './scheduler-utils.mjs';

/**
 * Reads persisted scheduler run-state for the current UTC day.
 * Run-state is used to track lock deferral metadata across multiple invocations
 * within the same day (e.g., retry window tracking for non-strict lock failures).
 *
 * If the state file is missing, unreadable, or belongs to a previous day, returns
 * a fresh default state. State is keyed by `run_date` (YYYY-MM-DD UTC).
 *
 * @param {string} cadence - 'daily'|'weekly'
 * @returns {Promise<{ statePath: string, state: { run_date: string, lock_deferral: Object|null } }>}
 */
export async function readRunState(cadence) {
  const statePath = path.resolve(process.cwd(), 'task-logs', cadence, '.scheduler-run-state.json');
  const fallback = { run_date: getRunDateKey(), lock_deferral: null };
  const raw = await readJson(statePath, fallback);
  if (!raw || typeof raw !== 'object') {
    return { statePath, state: fallback };
  }

  if (raw.run_date !== getRunDateKey()) {
    return { statePath, state: fallback };
  }

  return {
    statePath,
    state: {
      run_date: raw.run_date,
      lock_deferral: raw.lock_deferral && typeof raw.lock_deferral === 'object' ? raw.lock_deferral : null,
    },
  };
}

/**
 * Persists scheduler run-state to disk (JSON file).
 * Creates parent directories if they do not exist.
 *
 * @param {string} statePath - Absolute path to the state file.
 * @param {Object} state - State object to serialize.
 * @returns {Promise<void>}
 */
export async function writeRunState(statePath, state) {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

/**
 * Generates a unique idempotency key for a deferred lock attempt.
 * The key is stable across retries for the same agent/cadence/date combination
 * by being stored in run-state and reused on subsequent invocations.
 *
 * @param {{ cadence: string, selectedAgent: string, runDate: string }} params
 * @returns {string}
 */
export function createIdempotencyKey({ cadence, selectedAgent, runDate }) {
  return `${cadence}:${selectedAgent}:${runDate}:${randomUUID()}`;
}
