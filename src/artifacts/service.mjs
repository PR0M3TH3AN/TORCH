import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync, closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync,
  realpathSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { TorchError } from '../kernel/errors.mjs';
import { readInstallManifest } from '../kernel/install.mjs';
import { projectStatePath } from '../kernel/paths.mjs';

const IMAGE_TYPES = new Map([
  ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'], ['.gif', 'image/gif'],
]);
const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;

function requiredText(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TorchError(`${field} must be a non-empty string`, {
      code: 'INVALID_ARTIFACT_INPUT', details: { field },
    });
  }
  return value.trim();
}

function taskId(value) {
  const normalized = requiredText(value, 'taskId');
  if (!/^TASK-[A-Za-z0-9-]+$/.test(normalized)) {
    throw new TorchError('Artifact taskId must identify an authoritative backlog item', {
      code: 'INVALID_ARTIFACT_TASK', details: { taskId: normalized },
    });
  }
  return normalized;
}

function localRelativePath(value) {
  const normalized = requiredText(value, 'file').replaceAll('\\', '/').replace(/^\.\//, '');
  if (normalized.startsWith('/') || normalized.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new TorchError('Artifact source must be a normalized path inside the identity worktree', {
      code: 'ARTIFACT_PATH_INVALID', details: { file: value },
    });
  }
  return normalized;
}

function safeSourcePath(root, relativePath) {
  const source = resolve(root, ...relativePath.split('/'));
  const rel = relative(root, source);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || resolve(source) !== source) {
    throw new TorchError('Artifact source must remain inside the identity worktree', {
      code: 'ARTIFACT_PATH_INVALID', details: { file: relativePath },
    });
  }
  let current = root;
  for (const part of relativePath.split('/')) {
    current = join(current, part);
    const stat = (() => {
      try { return requireStat(current); } catch (error) {
        throw new TorchError(`Cannot inspect artifact source: ${relativePath}`, {
          code: 'ARTIFACT_SOURCE_UNAVAILABLE', details: error.message,
        });
      }
    })();
    if (stat.isSymbolicLink()) {
      throw new TorchError('Artifact source cannot traverse symbolic links', {
        code: 'ARTIFACT_PATH_INVALID', details: { file: relativePath },
      });
    }
  }
  const realRoot = realpathSync(root);
  const realSource = realpathSync(source);
  const realRel = relative(realRoot, realSource);
  if (realRel === '..' || realRel.startsWith(`..${sep}`) || !realRel) {
    throw new TorchError('Artifact source resolves outside the identity worktree', {
      code: 'ARTIFACT_PATH_INVALID', details: { file: relativePath },
    });
  }
  return source;
}

function requireStat(path) {
  // Kept behind a helper so every traversed segment gets the same failure mapping.
  return statSync(path);
}

function commitSha(repositoryRoot, value) {
  const sha = requiredText(value, 'commit');
  if (!/^[0-9a-f]{40}$/i.test(sha)) {
    throw new TorchError('Artifact provenance requires a full Git commit SHA', {
      code: 'ARTIFACT_COMMIT_INVALID', details: { commit: sha },
    });
  }
  let resolved;
  try {
    resolved = execFileSync('git', ['-C', repositoryRoot, 'rev-parse', '--verify', `${sha}^{commit}`], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    throw new TorchError('Artifact commit is not present in the local project history', {
      code: 'ARTIFACT_COMMIT_INVALID', details: { commit: sha },
    });
  }
  if (resolved.toLowerCase() !== sha.toLowerCase()) {
    throw new TorchError('Artifact commit must be the exact full commit SHA', {
      code: 'ARTIFACT_COMMIT_INVALID', details: { commit: sha, resolved },
    });
  }
  return resolved;
}

function artifactRecord(row) {
  return {
    id: row.id, projectId: row.project_id, title: row.title, alt: row.alt_text,
    taskId: row.task_ref, sessionId: row.runtime_session_id, identityId: row.area_id,
    commit: row.commit_sha, mediaType: row.media_type, sha256: row.sha256,
    bytes: row.bytes, createdAt: row.created_at, url: `/api/artifacts/${encodeURIComponent(row.id)}`,
  };
}

function validStoredImage(row) {
  const match = /^([a-f0-9-]{36})\.(png|jpe?g|webp|gif)$/i.exec(row.stored_name ?? '');
  return Boolean(match && match[1] === row.id
    && IMAGE_TYPES.get(`.${match[2].toLowerCase()}`) === row.media_type);
}

export class ArtifactService {
  constructor({ repositoryRoot, controlPlane, backlogService, clock = () => new Date(), idFactory = randomUUID } = {}) {
    this.repositoryRoot = resolve(repositoryRoot ?? controlPlane?.repositoryRoot ?? process.cwd());
    if (!controlPlane || !backlogService) {
      throw new TorchError('Artifact service requires the installed control plane and authoritative backlog', {
        code: 'ARTIFACT_SERVICE_DEPENDENCY_MISSING',
      });
    }
    this.controlPlane = controlPlane;
    this.backlogService = backlogService;
    this.clock = clock;
    this.idFactory = idFactory;
    this.stateRoot = controlPlane.stateRoot;
    this.artifactRoot = join(this.stateRoot, 'artifacts');
    this.database = controlPlane.database;
  }

  ensureSchema() {
    mkdirSync(this.artifactRoot, { recursive: true, mode: 0o700 });
    const storage = lstatSync(this.artifactRoot);
    if (!storage.isDirectory() || storage.isSymbolicLink()) {
      throw new TorchError('Artifact storage must be a private, real directory', { code: 'ARTIFACT_STORAGE_INVALID' });
    }
    chmodSync(this.artifactRoot, 0o700);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        alt_text TEXT NOT NULL,
        task_ref TEXT NOT NULL,
        area_id TEXT NOT NULL,
        runtime_session_id TEXT,
        commit_sha TEXT NOT NULL,
        source_path TEXT NOT NULL,
        media_type TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        stored_name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS artifacts_created ON artifacts(created_at DESC, id);
    `);
  }

  publish({ areaId, taskId: rawTaskId, title, alt, file, commit } = {}) {
    const actor = this.controlPlane.assertIdentity(areaId);
    const task = this.backlogService.get(taskId(rawTaskId));
    if (task.owner !== actor) {
      throw new TorchError('Only the backlog owner may publish evidence for this task', {
        code: 'ARTIFACT_TASK_OWNER_MISMATCH', details: { taskId: task.id, owner: task.owner, actor },
      });
    }
    const sourceRelative = localRelativePath(file);
    const worktree = (this.controlPlane.manifest.external ?? []).find((entry) =>
      entry.type === 'worktree' && entry.area === actor)?.path ?? this.repositoryRoot;
    if (!existsSync(worktree)) {
      throw new TorchError(`Identity worktree is unavailable: ${actor}`, {
        code: 'ARTIFACT_WORKTREE_MISSING', details: { areaId: actor },
      });
    }
    const extension = sourceRelative.slice(sourceRelative.lastIndexOf('.')).toLowerCase();
    const rootExtension = sourceRelative.slice(sourceRelative.lastIndexOf('.')).toLowerCase();
    const mediaType = IMAGE_TYPES.get(rootExtension);
    if (!mediaType) {
      throw new TorchError('Review gallery supports PNG, JPEG, WebP, and GIF images', {
        code: 'ARTIFACT_MEDIA_TYPE_UNSUPPORTED', details: { extension },
      });
    }
    const sourcePath = safeSourcePath(worktree, sourceRelative);
    const descriptor = openSync(sourcePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    let content;
    try {
      const stat = fstatSync(descriptor);
      if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_ARTIFACT_BYTES) {
        throw new TorchError('Artifact image must be a regular file no larger than 25 MiB', {
          code: 'ARTIFACT_SIZE_INVALID', details: { bytes: stat.size },
        });
      }
      content = readFileSync(descriptor);
    } finally { closeSync(descriptor); }
    const exactCommit = commitSha(this.repositoryRoot, commit);
    const identity = this.controlPlane.identity(actor);
    const id = this.idFactory();
    if (!/^[a-f0-9-]{36}$/i.test(id)) {
      throw new TorchError('Artifact ID factory must return a UUID-shaped value', { code: 'ARTIFACT_ID_INVALID' });
    }
    const storedName = `${id}${rootExtension}`;
    const storedPath = join(this.artifactRoot, storedName);
    const record = {
      id, projectId: this.controlPlane.projectId, title: requiredText(title, 'title'),
      alt: requiredText(alt, 'alt'), taskId: task.id, areaId: actor,
      runtimeSessionId: identity.runtimeSessionId, commit: exactCommit,
      sourcePath: sourceRelative, mediaType, sha256: createHash('sha256').update(content).digest('hex'),
      bytes: content.byteLength, storedName, createdAt: this.clock().toISOString(),
    };
    this.ensureSchema();
    writeFileSync(storedPath, content, { flag: 'wx', mode: 0o600 });
    try {
      this.database.exec('BEGIN IMMEDIATE');
      this.database.prepare(`
        INSERT INTO artifacts (
          id, project_id, title, alt_text, task_ref, area_id, runtime_session_id,
          commit_sha, source_path, media_type, sha256, bytes, stored_name, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.id, record.projectId, record.title, record.alt, record.taskId, record.areaId,
        record.runtimeSessionId, record.commit, record.sourcePath, record.mediaType,
        record.sha256, record.bytes, record.storedName, record.createdAt,
      );
      this.controlPlane.audit({
        actorId: actor, operation: 'artifact.publish', entityType: 'artifact', entityId: id,
        details: { taskId: task.id, commit: exactCommit, sha256: record.sha256, bytes: record.bytes },
      });
      this.database.exec('COMMIT');
    } catch (error) {
      try { this.database.exec('ROLLBACK'); } catch { /* transaction may not have begun */ }
      unlinkSync(storedPath);
      throw error;
    }
    return {
      id: record.id, projectId: record.projectId, title: record.title, alt: record.alt,
      taskId: record.taskId, identityId: record.areaId, sessionId: record.runtimeSessionId,
      commit: record.commit, mediaType: record.mediaType, sha256: record.sha256,
      bytes: record.bytes, createdAt: record.createdAt, url: `/api/artifacts/${encodeURIComponent(id)}`,
    };
  }

  list({ limit = 40 } = {}) {
    const bounded = Number.isInteger(limit) && limit > 0 && limit <= 100 ? limit : 40;
    if (!this.database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'artifacts'").get()) return [];
    return this.database.prepare('SELECT * FROM artifacts ORDER BY created_at DESC, id LIMIT ?')
      .all(bounded).map(artifactRecord);
  }

  get(id) {
    if (!this.database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'artifacts'").get()) {
      throw new TorchError(`Unknown artifact: ${id}`, { code: 'ARTIFACT_NOT_FOUND' });
    }
    const row = this.database.prepare('SELECT * FROM artifacts WHERE id = ?').get(requiredText(id, 'artifactId'));
    if (!row) throw new TorchError(`Unknown artifact: ${id}`, { code: 'ARTIFACT_NOT_FOUND' });
    return { ...artifactRecord(row), storedName: row.stored_name };
  }

  comment({ artifactId, body, by } = {}) {
    const plan = this.planComment({ artifactId, body, by });
    const artifact = this.get(plan.artifactId);
    const content = plan.body;
    const createdAt = this.clock().toISOString();
    const messageId = this.idFactory();
    this.database.prepare(`
      INSERT INTO messages (
        id, project_id, sender_id, recipient_id, kind, created_at, body,
        task_ref, path_ref, commit_ref, handoff_ref
      ) VALUES (?, ?, 'owner', ?, 'message', ?, ?, ?, ?, ?, NULL)
    `).run(
      messageId, artifact.projectId, artifact.identityId, createdAt, content,
      artifact.taskId, `artifact:${artifact.id}`, artifact.commit,
    );
    this.controlPlane.auditOwnerAction({
      actorId: by, operation: 'artifact.feedback', entityType: 'artifact', entityId: artifact.id,
      details: { recipient: artifact.identityId, messageId },
    });
    return {
      id: messageId, artifactId: artifact.id, sender: 'owner', recipient: artifact.identityId,
      taskId: artifact.taskId, commit: artifact.commit, body: content, createdAt,
    };
  }

  planComment({ artifactId, body, by } = {}) {
    if (by !== 'owner') {
      throw new TorchError('Only the project owner may submit artifact review feedback', {
        code: 'OWNER_AUTHORITY_REQUIRED', details: { operation: 'artifact.comment' },
      });
    }
    const artifact = this.get(artifactId);
    const content = requiredText(body, 'body');
    return {
      schema: 'torch.dev/artifact-feedback-plan/v1alpha1', mutationPerformed: false,
      artifactId: artifact.id, body: content, by: 'owner', recipient: artifact.identityId,
      taskId: artifact.taskId, commit: artifact.commit,
      effect: 'Create one durable owner message for the responsible identity, linked to this artifact and backlog task.',
    };
  }

}

export function observeArtifacts({ database, stateRoot, limit = 40 } = {}) {
  const table = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'artifacts'").get();
  if (!table) return {
    available: false, items: [],
    reason: 'No project-local artifact catalog with task, session, and commit provenance is connected yet.',
  };
  const bounded = Number.isInteger(limit) && limit > 0 && limit <= 100 ? limit : 40;
  const items = database.prepare('SELECT * FROM artifacts ORDER BY created_at DESC, id LIMIT ?').all(bounded);
  const comments = database.prepare(`
    SELECT id, sender_id AS sender, recipient_id AS recipient, body, created_at AS createdAt,
      task_ref AS taskId, commit_ref AS "commit", path_ref AS path
    FROM messages WHERE path_ref LIKE 'artifact:%' ORDER BY created_at, id
  `).all();
  const messagesByArtifact = new Map();
  for (const message of comments) {
    const id = message.path.slice('artifact:'.length);
    if (!messagesByArtifact.has(id)) messagesByArtifact.set(id, []);
    messagesByArtifact.get(id).push(message);
  }
  const artifactRoot = join(stateRoot, 'artifacts');
  let storageValid = false;
  try {
    const directory = lstatSync(artifactRoot);
    storageValid = directory.isDirectory() && !directory.isSymbolicLink();
  } catch { /* absent storage is an explicit unavailable state */ }
  return {
    available: true,
    items: items.map((row) => {
      const record = artifactRecord(row);
      const filePath = validStoredImage(row) ? join(artifactRoot, row.stored_name) : null;
      let valid = false;
      try {
        const stat = storageValid && filePath ? lstatSync(filePath) : null;
        valid = Boolean(stat?.isFile() && !stat.isSymbolicLink()
          && stat.size === row.bytes && row.bytes <= MAX_ARTIFACT_BYTES);
      } catch { /* observation reports unavailable evidence rather than inferring integrity */ }
      return {
        ...record, integrity: valid ? 'available' : 'unavailable',
        url: valid ? record.url : null,
        feedback: messagesByArtifact.get(row.id) ?? [],
      };
    }),
    reason: null,
  };
}

export function readPublishedArtifact({ repositoryRoot, env = process.env, id } = {}) {
  const artifactId = requiredText(id, 'artifactId');
  if (!/^[a-f0-9-]{36}$/i.test(artifactId)) {
    throw new TorchError('Artifact ID is invalid', { code: 'ARTIFACT_NOT_FOUND' });
  }
  const root = resolve(repositoryRoot);
  const manifest = readInstallManifest(root);
  const expectedStateRoot = projectStatePath(manifest.projectId, env);
  const stateEntry = (manifest.external ?? []).find((entry) => entry.type === 'local-state');
  if (!stateEntry?.path || resolve(stateEntry.path) !== resolve(expectedStateRoot)) {
    throw new TorchError('Artifact state does not belong to this installed project', {
      code: 'LOCAL_STATE_PATH_MISMATCH',
    });
  }
  const metadataPath = join(expectedStateRoot, 'project.json');
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
  if (metadata.projectId !== manifest.projectId || resolve(metadata.root) !== root) {
    throw new TorchError('Artifact state metadata does not match the current project', {
      code: 'LOCAL_STATE_METADATA_MISMATCH',
    });
  }
  const database = new DatabaseSync(join(expectedStateRoot, 'state.db'), { readOnly: true });
  try {
    const table = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'artifacts'").get();
    if (!table) throw new TorchError(`Unknown artifact: ${artifactId}`, { code: 'ARTIFACT_NOT_FOUND' });
    const row = database.prepare('SELECT * FROM artifacts WHERE id = ? AND project_id = ?').get(artifactId, manifest.projectId);
    if (!row || !validStoredImage(row)) {
      throw new TorchError(`Unknown artifact: ${artifactId}`, { code: 'ARTIFACT_NOT_FOUND' });
    }
    const artifactRoot = join(expectedStateRoot, 'artifacts');
    const storageStat = lstatSync(artifactRoot);
    if (!storageStat.isDirectory() || storageStat.isSymbolicLink()) {
      throw new TorchError('Artifact storage directory is invalid', { code: 'ARTIFACT_STORAGE_INVALID' });
    }
    const realStorageRoot = realpathSync(artifactRoot);
    const storageRelative = relative(realpathSync(expectedStateRoot), realStorageRoot);
    if (storageRelative.startsWith(`..${sep}`) || storageRelative === '..') {
      throw new TorchError('Artifact storage resolves outside project-local state', { code: 'ARTIFACT_PATH_INVALID' });
    }
    const storedPath = resolve(artifactRoot, row.stored_name);
    const fileRelative = relative(artifactRoot, storedPath);
    if (fileRelative.startsWith(`..${sep}`) || fileRelative === '..') {
      throw new TorchError('Published artifact resolves outside local artifact storage', { code: 'ARTIFACT_PATH_INVALID' });
    }
    const descriptor = openSync(storedPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    let bytes;
    try {
      const stat = fstatSync(descriptor);
      if (!stat.isFile() || stat.size !== row.bytes || stat.size > MAX_ARTIFACT_BYTES) {
        throw new TorchError('Published image has invalid size or file type', { code: 'ARTIFACT_INTEGRITY_FAILED' });
      }
      bytes = readFileSync(descriptor);
    } finally { closeSync(descriptor); }
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== row.sha256) throw new TorchError('Published image failed its stored integrity check', {
      code: 'ARTIFACT_INTEGRITY_FAILED',
    });
    return { mediaType: row.media_type, bytes };
  } finally { database.close(); }
}
