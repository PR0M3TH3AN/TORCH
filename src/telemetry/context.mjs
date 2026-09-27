import { randomUUID } from 'node:crypto';
import { TorchError } from '../kernel/errors.mjs';

const METRICS = [
  'cachedInput', 'uncachedInput', 'cacheCreation', 'cacheRead',
  'compactions', 'resumedPromptBytes', 'costMicrousd', 'verifiedItems',
];

function nonnegativeInteger(value, field) {
  const number = value === undefined || value === null || value === '' ? 0 : Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TorchError(`${field} must be a nonnegative safe integer`, {
      code: 'CONTEXT_METRIC_INVALID', details: { field, value },
    });
  }
  return number;
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function hasTable(database) {
  return Boolean(database.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'context_usage'
  `).get());
}

export class ContextTelemetryService {
  constructor({ controlPlane, clock = () => new Date(), idFactory = randomUUID } = {}) {
    this.controlPlane = controlPlane;
    this.clock = clock;
    this.idFactory = idFactory;
  }

  #initialize() {
    this.controlPlane.database.exec(`
      CREATE TABLE IF NOT EXISTS context_usage (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        area_id TEXT NOT NULL,
        runtime TEXT,
        runtime_session_id TEXT,
        task_ref TEXT,
        commit_sha TEXT,
        measurement TEXT NOT NULL,
        source TEXT NOT NULL,
        cached_input INTEGER NOT NULL,
        uncached_input INTEGER NOT NULL,
        cache_creation INTEGER NOT NULL,
        cache_read INTEGER NOT NULL,
        compactions INTEGER NOT NULL,
        resumed_prompt_bytes INTEGER NOT NULL,
        cost_microusd INTEGER NOT NULL,
        verified_items INTEGER NOT NULL,
        recorded_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS context_usage_area_time
        ON context_usage(area_id, recorded_at, id);
      CREATE INDEX IF NOT EXISTS context_usage_task
        ON context_usage(task_ref, area_id);
    `);
  }

  record(input = {}) {
    const areaId = this.controlPlane.assertIdentity(input.areaId);
    if (!['measured', 'estimated'].includes(input.measurement)) {
      throw new TorchError('Context usage must declare measured or estimated evidence', {
        code: 'CONTEXT_MEASUREMENT_INVALID', details: { measurement: input.measurement },
      });
    }
    const source = optionalText(input.source);
    if (!source) throw new TorchError('Context usage requires an evidence source', { code: 'CONTEXT_SOURCE_REQUIRED' });
    const values = Object.fromEntries(METRICS.map((field) => [field, nonnegativeInteger(input[field], field)]));
    const sample = {
      id: this.idFactory(), projectId: this.controlPlane.projectId, areaId,
      runtime: optionalText(input.runtime), runtimeSessionId: optionalText(input.runtimeSessionId),
      task: optionalText(input.task), commit: optionalText(input.commit),
      measurement: input.measurement, source, ...values, recordedAt: this.clock().toISOString(),
    };
    this.#initialize();
    this.controlPlane.database.prepare(`
      INSERT INTO context_usage (
        id, project_id, area_id, runtime, runtime_session_id, task_ref, commit_sha,
        measurement, source, cached_input, uncached_input, cache_creation, cache_read,
        compactions, resumed_prompt_bytes, cost_microusd, verified_items, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sample.id, sample.projectId, sample.areaId, sample.runtime, sample.runtimeSessionId,
      sample.task, sample.commit, sample.measurement, sample.source, sample.cachedInput,
      sample.uncachedInput, sample.cacheCreation, sample.cacheRead, sample.compactions,
      sample.resumedPromptBytes, sample.costMicrousd, sample.verifiedItems, sample.recordedAt,
    );
    this.controlPlane.audit({
      actorId: areaId, operation: 'context.record', entityType: 'context-usage', entityId: sample.id,
      details: { measurement: sample.measurement, source: sample.source, task: sample.task, commit: sample.commit },
    });
    return sample;
  }

  report({ areaId, task, commit, measurement } = {}) {
    if (areaId) this.controlPlane.assertIdentity(areaId);
    if (measurement && !['measured', 'estimated'].includes(measurement)) {
      throw new TorchError('Unknown context measurement class', { code: 'CONTEXT_MEASUREMENT_INVALID' });
    }
    if (!hasTable(this.controlPlane.database)) {
      return { measured: false, samples: 0, groups: [], warning: 'No context usage has been reported.' };
    }
    const clauses = [];
    const parameters = [];
    for (const [column, value] of [['area_id', areaId], ['task_ref', task], ['commit_sha', commit], ['measurement', measurement]]) {
      if (value) { clauses.push(`${column} = ?`); parameters.push(value); }
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const groups = this.controlPlane.database.prepare(`
      SELECT area_id AS areaId, measurement,
        COUNT(*) AS samples,
        SUM(cached_input) AS cachedInput,
        SUM(uncached_input) AS uncachedInput,
        SUM(cache_creation) AS cacheCreation,
        SUM(cache_read) AS cacheRead,
        SUM(compactions) AS compactions,
        SUM(resumed_prompt_bytes) AS resumedPromptBytes,
        SUM(cost_microusd) AS costMicrousd,
        SUM(verified_items) AS verifiedItems
      FROM context_usage ${where}
      GROUP BY area_id, measurement ORDER BY area_id, measurement
    `).all(...parameters).map((group) => ({
      ...group,
      cacheReadRatio: group.cacheRead + group.uncachedInput > 0
        ? group.cacheRead / (group.cacheRead + group.uncachedInput) : null,
      costPerVerifiedItemMicrousd: group.verifiedItems > 0 ? group.costMicrousd / group.verifiedItems : null,
    }));
    return {
      measured: groups.some((group) => group.measurement === 'measured'),
      samples: groups.reduce((total, group) => total + group.samples, 0), groups,
      warning: groups.some((group) => group.verifiedItems === 0)
        ? 'Some usage has no verified outcome; lower context volume alone is not success.' : null,
    };
  }
}
