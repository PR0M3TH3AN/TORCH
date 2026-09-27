import { randomUUID } from 'node:crypto';
import { TorchError } from '../kernel/errors.mjs';
import { loadFleetDefinition } from '../kernel/worktrees.mjs';

function resourceRow(row) {
  if (!row) return null;
  return {
    id: row.id, capacity: row.capacity, queue: row.queue_policy,
    maxHoldSeconds: row.max_hold_seconds,
  };
}

function leaseRow(row, now) {
  if (!row) return null;
  return {
    id: row.id, resourceId: row.resource_id, areaId: row.area_id,
    requestId: row.request_id, acquiredAt: row.acquired_at, expiresAt: row.expires_at,
    releasedAt: row.released_at, state: row.released_at ? 'released'
      : (Date.parse(row.expires_at) <= now.getTime() ? 'stale' : 'active'),
  };
}

export class ResourceService {
  constructor({ repositoryRoot, controlPlane, clock = () => new Date(), idFactory = randomUUID } = {}) {
    this.controlPlane = controlPlane;
    this.clock = clock;
    this.idFactory = idFactory;
    const { config } = loadFleetDefinition(repositoryRoot);
    this.definitions = new Map((config.resources ?? []).map((resource) => [resource.id, resource]));
    this.controlPlane.database.exec(`
      CREATE TABLE IF NOT EXISTS resources (
        id TEXT PRIMARY KEY,
        capacity INTEGER NOT NULL,
        queue_policy TEXT NOT NULL,
        max_hold_seconds INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS resource_requests (
        id TEXT PRIMARY KEY,
        resource_id TEXT NOT NULL REFERENCES resources(id),
        area_id TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        state TEXT NOT NULL,
        granted_at TEXT,
        cancelled_at TEXT
      );
      CREATE TABLE IF NOT EXISTS resource_leases (
        id TEXT PRIMARY KEY,
        resource_id TEXT NOT NULL REFERENCES resources(id),
        area_id TEXT NOT NULL,
        request_id TEXT NOT NULL REFERENCES resource_requests(id),
        acquired_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        released_at TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS one_open_resource_request
        ON resource_requests(resource_id, area_id) WHERE state IN ('waiting', 'granted');
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_resource_lease
        ON resource_leases(resource_id, area_id) WHERE released_at IS NULL;
    `);
    const insert = this.controlPlane.database.prepare(`
      INSERT INTO resources (id, capacity, queue_policy, max_hold_seconds) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        capacity = excluded.capacity,
        queue_policy = excluded.queue_policy,
        max_hold_seconds = excluded.max_hold_seconds
    `);
    for (const definition of this.definitions.values()) {
      if (!Number.isInteger(definition.capacity) || definition.capacity < 1 || definition.queue !== 'fifo') {
        throw new TorchError(`Invalid resource definition: ${definition.id}`, {
          code: 'RESOURCE_CONFIG_INVALID', details: definition,
        });
      }
      insert.run(definition.id, definition.capacity, definition.queue, definition.max_hold_seconds ?? 3600);
    }
  }

  list() {
    return this.controlPlane.database.prepare('SELECT * FROM resources ORDER BY id').all().map(resourceRow);
  }

  assertResource(resourceId) {
    const row = this.controlPlane.database.prepare('SELECT * FROM resources WHERE id = ?').get(resourceId);
    if (!row) throw new TorchError(`Unknown resource: ${resourceId}`, { code: 'RESOURCE_NOT_FOUND' });
    return row;
  }

  acquire({ resourceId, areaId } = {}) {
    const area = this.controlPlane.assertIdentity(areaId);
    const resource = this.assertResource(resourceId);
    const now = this.clock();
    this.controlPlane.database.exec('BEGIN IMMEDIATE');
    try {
      const existingLease = this.controlPlane.database.prepare(`
        SELECT * FROM resource_leases WHERE resource_id = ? AND area_id = ? AND released_at IS NULL
      `).get(resourceId, area);
      if (existingLease) {
        this.controlPlane.database.exec('COMMIT');
        return { disposition: 'held', lease: leaseRow(existingLease, now), request: null };
      }
      let request = this.controlPlane.database.prepare(`
        SELECT * FROM resource_requests
        WHERE resource_id = ? AND area_id = ? AND state = 'waiting'
      `).get(resourceId, area);
      if (!request) {
        request = {
          id: this.idFactory(), resource_id: resourceId, area_id: area,
          requested_at: now.toISOString(), state: 'waiting',
        };
        this.controlPlane.database.prepare(`
          INSERT INTO resource_requests (id, resource_id, area_id, requested_at, state)
          VALUES (?, ?, ?, ?, 'waiting')
        `).run(request.id, resourceId, area, request.requested_at);
      }
      const active = this.controlPlane.database.prepare(`
        SELECT COUNT(*) AS count FROM resource_leases
        WHERE resource_id = ? AND released_at IS NULL
      `).get(resourceId).count;
      const queue = this.controlPlane.database.prepare(`
        SELECT * FROM resource_requests
        WHERE resource_id = ? AND state = 'waiting'
        ORDER BY requested_at ASC, id ASC
      `).all(resourceId);
      const position = queue.findIndex((candidate) => candidate.id === request.id);
      if (position >= 0 && position < resource.capacity - active) {
        const acquiredAt = this.clock();
        const expiresAt = new Date(acquiredAt.getTime() + resource.max_hold_seconds * 1000);
        const lease = {
          id: this.idFactory(), resource_id: resourceId, area_id: area, request_id: request.id,
          acquired_at: acquiredAt.toISOString(), expires_at: expiresAt.toISOString(), released_at: null,
        };
        this.controlPlane.database.prepare(`
          UPDATE resource_requests SET state = 'granted', granted_at = ? WHERE id = ?
        `).run(lease.acquired_at, request.id);
        this.controlPlane.database.prepare(`
          INSERT INTO resource_leases (
            id, resource_id, area_id, request_id, acquired_at, expires_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(lease.id, resourceId, area, request.id, lease.acquired_at, lease.expires_at);
        this.controlPlane.audit({
          actorId: area, operation: 'resource.acquire', entityType: 'resource-lease', entityId: lease.id,
          details: { resourceId },
        });
        this.controlPlane.database.exec('COMMIT');
        return { disposition: 'acquired', lease: leaseRow(lease, acquiredAt), request: null };
      }
      this.controlPlane.audit({
        actorId: area, operation: 'resource.queue', entityType: 'resource-request', entityId: request.id,
        details: { resourceId, position: position + 1 },
      });
      this.controlPlane.database.exec('COMMIT');
      return {
        disposition: 'queued', lease: null,
        request: { id: request.id, resourceId, areaId: area, requestedAt: request.requested_at, position: position + 1 },
      };
    } catch (error) {
      this.controlPlane.database.exec('ROLLBACK');
      throw error;
    }
  }

  release({ resourceId, areaId } = {}) {
    const area = this.controlPlane.assertIdentity(areaId);
    this.assertResource(resourceId);
    const row = this.controlPlane.database.prepare(`
      SELECT * FROM resource_leases WHERE resource_id = ? AND area_id = ? AND released_at IS NULL
    `).get(resourceId, area);
    if (!row) throw new TorchError(`${area} does not hold ${resourceId}`, { code: 'RESOURCE_LEASE_NOT_HELD' });
    const releasedAt = this.clock().toISOString();
    this.controlPlane.database.exec('BEGIN IMMEDIATE');
    try {
      this.controlPlane.database.prepare('UPDATE resource_leases SET released_at = ? WHERE id = ?')
        .run(releasedAt, row.id);
      this.controlPlane.database.prepare("UPDATE resource_requests SET state = 'released' WHERE id = ?")
        .run(row.request_id);
      this.controlPlane.audit({
        actorId: area, operation: 'resource.release', entityType: 'resource-lease', entityId: row.id,
        details: { resourceId },
      });
      this.controlPlane.database.exec('COMMIT');
    } catch (error) {
      this.controlPlane.database.exec('ROLLBACK');
      throw error;
    }
    return { ...leaseRow({ ...row, released_at: releasedAt }, this.clock()), state: 'released' };
  }

  cancel({ resourceId, areaId } = {}) {
    const area = this.controlPlane.assertIdentity(areaId);
    this.assertResource(resourceId);
    const request = this.controlPlane.database.prepare(`
      SELECT * FROM resource_requests
      WHERE resource_id = ? AND area_id = ? AND state = 'waiting'
    `).get(resourceId, area);
    if (!request) throw new TorchError(`${area} has no queued request for ${resourceId}`, { code: 'RESOURCE_REQUEST_NOT_FOUND' });
    const cancelledAt = this.clock().toISOString();
    this.controlPlane.database.prepare(`
      UPDATE resource_requests SET state = 'cancelled', cancelled_at = ? WHERE id = ?
    `).run(cancelledAt, request.id);
    this.controlPlane.audit({
      actorId: area, operation: 'resource.cancel', entityType: 'resource-request', entityId: request.id,
      details: { resourceId },
    });
    return { id: request.id, resourceId, areaId: area, state: 'cancelled', cancelledAt };
  }

  hasActiveLease({ resourceId, areaId } = {}) {
    const row = this.controlPlane.database.prepare(`
      SELECT * FROM resource_leases WHERE resource_id = ? AND area_id = ? AND released_at IS NULL
    `).get(resourceId, areaId);
    return Boolean(row) && leaseRow(row, this.clock()).state === 'active';
  }

  status(resourceId) {
    const resource = this.assertResource(resourceId);
    const now = this.clock();
    const leases = this.controlPlane.database.prepare(`
      SELECT * FROM resource_leases WHERE resource_id = ? AND released_at IS NULL ORDER BY acquired_at, id
    `).all(resourceId).map((row) => leaseRow(row, now));
    const queue = this.controlPlane.database.prepare(`
      SELECT * FROM resource_requests WHERE resource_id = ? AND state = 'waiting' ORDER BY requested_at, id
    `).all(resourceId).map((row, index) => ({
      id: row.id, resourceId: row.resource_id, areaId: row.area_id,
      requestedAt: row.requested_at, position: index + 1,
    }));
    return { resource: resourceRow(resource), leases, queue };
  }
}
