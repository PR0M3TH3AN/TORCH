import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ExitError } from './errors.mjs';

const AUTO_HEADER = '<!-- AUTO-GENERATED: DO NOT EDIT. Source: memory/events -->';
const DEFAULT_EVENTS_DIR = 'memory/events';
const DEFAULT_SCHEMA_PATH = 'memory/schema/memory-event.schema.json';
const DEFAULT_OUTPUT_PATH = 'memory_update.md';

const UUID_V7_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const VALID_AGENT_REGEX = /^[a-zA-Z0-9_.-]+$/;

function ensureObject(value, context) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ExitError(4, `${context} must be an object`);
  }
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function normalizeToLf(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function normalizeIsoToSecondPrecision(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function toCompactTimestamp(createdAtIso) {
  const normalized = normalizeIsoToSecondPrecision(createdAtIso);
  if (!normalized) return null;
  return normalized.replace(/[-:]/g, '').replace('.000', '');
}

function generateUuidV7() {
  const bytes = crypto.randomBytes(16);
  const nowMs = BigInt(Date.now());

  bytes[0] = Number((nowMs >> 40n) & 0xffn);
  bytes[1] = Number((nowMs >> 32n) & 0xffn);
  bytes[2] = Number((nowMs >> 24n) & 0xffn);
  bytes[3] = Number((nowMs >> 16n) & 0xffn);
  bytes[4] = Number((nowMs >> 8n) & 0xffn);
  bytes[5] = Number(nowMs & 0xffn);

  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

async function readJsonFile(filePath, contextLabel) {
  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    throw new ExitError(4, `${contextLabel}: unable to read ${filePath}: ${error.message}`);
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new ExitError(4, `${contextLabel}: invalid JSON in ${filePath}: ${error.message}`);
  }
}

async function readSchema(schemaPath) {
  const schema = await readJsonFile(schemaPath, 'schema validation failed');
  ensureObject(schema, 'Schema');
  if (schema.type !== 'object') {
    throw new ExitError(4, 'schema validation failed: top-level schema type must be object');
  }
  return schema;
}

function validateStringField(errors, event, field, options = {}) {
  const value = event[field];
  if (value == null) return;
  if (typeof value !== 'string') {
    errors.push(`${field} must be a string`);
    return;
  }
  if (typeof options.minLength === 'number' && value.length < options.minLength) {
    errors.push(`${field} must be at least ${options.minLength} characters`);
  }
  if (typeof options.maxLength === 'number' && value.length > options.maxLength) {
    errors.push(`${field} must be at most ${options.maxLength} characters`);
  }
  if (options.pattern && !options.pattern.test(value)) {
    errors.push(`${field} does not match required format`);
  }
  if (options.const && value !== options.const) {
    errors.push(`${field} must equal ${options.const}`);
  }
}

function validateTags(errors, event) {
  if (!hasOwn(event, 'tags')) return;
  const { tags } = event;
  if (!Array.isArray(tags)) {
    errors.push('tags must be an array when provided');
    return;
  }
  if (tags.length > 20) {
    errors.push('tags must contain at most 20 items');
  }
  const seen = new Set();
  for (const [index, tag] of tags.entries()) {
    if (typeof tag !== 'string') {
      errors.push(`tags[${index}] must be a string`);
      continue;
    }
    if (tag.length < 1 || tag.length > 64) {
      errors.push(`tags[${index}] must be 1..64 characters`);
    }
    if (seen.has(tag)) {
      errors.push('tags must be unique');
      break;
    }
    seen.add(tag);
  }
}

function validateEventObject(event, schemaPath) {
  const errors = [];

  ensureObject(event, 'Event');
  const allowedProps = new Set([
    'id',
    'created_at',
    'project',
    'agent',
    'topic',
    'content',
    'run_id',
    'tags',
    'source',
  ]);

  const requiredProps = ['id', 'created_at', 'project', 'agent', 'topic', 'content'];
  for (const key of requiredProps) {
    if (!hasOwn(event, key)) {
      errors.push(`missing required field: ${key}`);
    }
  }

  for (const key of Object.keys(event)) {
    if (!allowedProps.has(key)) {
      errors.push(`unexpected field: ${key}`);
    }
  }

  validateStringField(errors, event, 'id', { pattern: UUID_V7_REGEX });
  validateStringField(errors, event, 'created_at');
  validateStringField(errors, event, 'project', { const: 'TORCH' });
  validateStringField(errors, event, 'agent', { minLength: 1, maxLength: 64, pattern: VALID_AGENT_REGEX });
  validateStringField(errors, event, 'topic', { minLength: 1, maxLength: 128 });
  validateStringField(errors, event, 'content', { minLength: 1, maxLength: 20000 });
  validateStringField(errors, event, 'run_id', { minLength: 1, maxLength: 128 });
  validateStringField(errors, event, 'source', { minLength: 1, maxLength: 256 });
  validateTags(errors, event);

  if (typeof event.created_at === 'string') {
    if (!event.created_at.endsWith('Z')) {
      errors.push('created_at must be UTC and end with Z');
    }
    const normalized = normalizeIsoToSecondPrecision(event.created_at);
    if (!normalized) {
      errors.push('created_at must be a valid RFC3339 timestamp');
    }
  }

  if (errors.length > 0) {
    throw new ExitError(4, `schema validation failed (${schemaPath}): ${errors.join('; ')}`);
  }
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function collectEventFiles(eventsDir) {
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });

    const files = await Promise.all(entries.map(async (entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return walk(full);
      }
      return full.endsWith('.json') ? [full] : [];
    }));

    return files.flat();
  }

  const absoluteEventsDir = path.resolve(process.cwd(), eventsDir);
  const files = await walk(absoluteEventsDir);
  return files.sort((a, b) => a.localeCompare(b));
}

function createdAtParts(createdAt) {
  const normalized = normalizeIsoToSecondPrecision(createdAt);
  if (!normalized) return null;
  return {
    normalized,
    year: normalized.slice(0, 4),
    month: normalized.slice(5, 7),
    day: normalized.slice(8, 10),
    compact: toCompactTimestamp(normalized),
  };
}

function validatePathContract(filePath, eventsDir, event) {
  const absoluteEventsDir = path.resolve(process.cwd(), eventsDir);
  const absoluteFile = path.resolve(filePath);
  const relative = path.relative(absoluteEventsDir, absoluteFile);
  const relPosix = relative.split(path.sep).join('/');
  const parts = relPosix.split('/');

  if (parts.length < 4) {
    throw new ExitError(4, `filename/date mismatch: ${relPosix} must be YYYY/MM/DD/<timestamp>_<id>.json`);
  }

  const fileName = parts[parts.length - 1];
  const [baseIdPart] = fileName.split('.json');
  const underscore = baseIdPart.indexOf('_');
  if (underscore <= 0) {
    throw new ExitError(4, `filename/date mismatch: ${relPosix} must include "<timestamp>_<id>.json"`);
  }

  const fileCompactTs = baseIdPart.slice(0, underscore);
  const fileId = baseIdPart.slice(underscore + 1);
  const dateParts = createdAtParts(event.created_at);
  if (!dateParts) {
    throw new ExitError(4, `filename/date mismatch: invalid created_at in ${relPosix}`);
  }

  const [year, month, day] = parts;
  if (year !== dateParts.year || month !== dateParts.month || day !== dateParts.day) {
    throw new ExitError(4, `filename/date mismatch: ${relPosix} date path does not match created_at`);
  }
  if (fileCompactTs !== dateParts.compact) {
    throw new ExitError(4, `filename/date mismatch: ${relPosix} timestamp prefix does not match created_at`);
  }
  if (fileId !== event.id) {
    throw new ExitError(4, `filename/date mismatch: ${relPosix} id suffix does not match event.id`);
  }
}

function normalizeContent(content) {
  const lines = normalizeToLf(content).split('\n').map((line) => line.replace(/[ \t]+$/g, ''));
  return lines.join('\n').trim();
}

function renderMarkdown(events) {
  const out = [AUTO_HEADER, '# Memory Update', ''];
  let currentDate = null;

  for (const event of events) {
    const date = event.created_at.slice(0, 10);
    if (date !== currentDate) {
      if (currentDate !== null) out.push('');
      out.push(`## ${date}`, '');
      currentDate = date;
    }

    out.push(`### ${event.created_at} · ${event.topic} · ${event.agent}`);
    out.push(`- id: ${event.id}`);
    if (event.run_id) out.push(`- run_id: ${event.run_id}`);
    if (Array.isArray(event.tags) && event.tags.length > 0) out.push(`- tags: ${event.tags.join(', ')}`);
    if (event.source) out.push(`- source: ${event.source}`);
    out.push('');
    out.push(normalizeContent(event.content));
    out.push('');
  }

  const normalized = out.join('\n').replace(/[ \t]+\n/g, '\n');
  return `${normalized.trimEnd()}\n`;
}

async function loadAndValidateEvents({ eventsDir, schemaPath }) {
  await readSchema(schemaPath);
  const files = await collectEventFiles(eventsDir);
  const events = [];
  const seenIds = new Set();

  for (const filePath of files) {
    const event = await readJsonFile(filePath, 'schema validation failed');
    validateEventObject(event, schemaPath);
    validatePathContract(filePath, eventsDir, event);
    if (seenIds.has(event.id)) {
      throw new ExitError(4, `duplicate id detected: ${event.id}`);
    }
    seenIds.add(event.id);

    events.push({
      ...event,
      __path: path.relative(path.resolve(process.cwd(), eventsDir), path.resolve(filePath)).split(path.sep).join('/'),
      created_at: normalizeIsoToSecondPrecision(event.created_at),
    });
  }

  events.sort((a, b) =>
    a.created_at.localeCompare(b.created_at)
    || a.id.localeCompare(b.id)
    || a.__path.localeCompare(b.__path));

  return events;
}

async function writeFileEnsuringDir(filePath, content) {
  const absolute = path.resolve(process.cwd(), filePath);
  await ensureDir(path.dirname(absolute));
  await fs.writeFile(absolute, content, 'utf8');
}

function getContentFromArgs(args) {
  if (args.message && args.messageFile) {
    throw new ExitError(1, 'choose either --message or --message-file');
  }
  if (args.message) {
    return args.message;
  }
  return null;
}

async function resolveAddContent(args) {
  const inline = getContentFromArgs(args);
  if (inline != null) return inline;

  if (args.messageFile) {
    try {
      return await fs.readFile(args.messageFile, 'utf8');
    } catch (error) {
      throw new ExitError(1, `unable to read --message-file: ${error.message}`);
    }
  }

  throw new ExitError(1, 'memory add requires --message or --message-file');
}

export async function cmdMemoryAdd(args) {
  const eventsDir = args.eventsDir || DEFAULT_EVENTS_DIR;
  const schemaPath = args.schemaPath || DEFAULT_SCHEMA_PATH;

  if (!args.agent) throw new ExitError(1, 'memory add requires --agent');
  if (!args.topic) throw new ExitError(1, 'memory add requires --topic');

  const message = await resolveAddContent(args);
  const createdAt = args.createdAt || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const id = args.id || generateUuidV7();
  const project = args.project || 'TORCH';
  const tags = Array.isArray(args.tags) && args.tags.length > 0 ? args.tags : undefined;

  const event = {
    id,
    created_at: createdAt,
    project,
    agent: args.agent,
    topic: args.topic,
    content: message,
    ...(args.runId ? { run_id: args.runId } : {}),
    ...(tags ? { tags } : {}),
    ...(args.source ? { source: args.source } : {}),
  };

  await readSchema(schemaPath);
  validateEventObject(event, schemaPath);

  const dateParts = createdAtParts(event.created_at);
  if (!dateParts) {
    throw new ExitError(4, 'created_at must be a valid RFC3339 timestamp');
  }

  const relativePath = path.posix.join(
    dateParts.year,
    dateParts.month,
    dateParts.day,
    `${dateParts.compact}_${event.id}.json`,
  );
  const outputPath = path.resolve(process.cwd(), eventsDir, relativePath);
  await ensureDir(path.dirname(outputPath));

  try {
    await fs.access(outputPath);
    throw new ExitError(4, `event file already exists: ${outputPath}`);
  } catch (error) {
    if (error instanceof ExitError) throw error;
    if (error.code !== 'ENOENT') {
      throw new ExitError(4, `unable to access event file path: ${error.message}`);
    }
  }

  const serialized = `${JSON.stringify(event, null, 2)}\n`;
  await fs.writeFile(outputPath, serialized, 'utf8');

  console.log(JSON.stringify({
    ok: true,
    id: event.id,
    created_at: normalizeIsoToSecondPrecision(event.created_at),
    path: path.relative(process.cwd(), outputPath).split(path.sep).join('/'),
  }, null, 2));
}

export async function cmdMemoryBuild(args) {
  const eventsDir = args.eventsDir || DEFAULT_EVENTS_DIR;
  const schemaPath = args.schemaPath || DEFAULT_SCHEMA_PATH;
  const outputPath = args.output || DEFAULT_OUTPUT_PATH;

  const events = await loadAndValidateEvents({ eventsDir, schemaPath });
  const rendered = renderMarkdown(events);
  await writeFileEnsuringDir(outputPath, rendered);

  console.log(JSON.stringify({
    ok: true,
    output: outputPath,
    events: events.length,
  }, null, 2));
}

export async function cmdMemoryVerify(args) {
  const eventsDir = args.eventsDir || DEFAULT_EVENTS_DIR;
  const schemaPath = args.schemaPath || DEFAULT_SCHEMA_PATH;
  const outputPath = args.output || DEFAULT_OUTPUT_PATH;

  const events = await loadAndValidateEvents({ eventsDir, schemaPath });
  const first = renderMarkdown(events);
  const second = renderMarkdown(events);

  if (first !== second) {
    throw new ExitError(4, 'determinism check failed: repeated render produced different output');
  }

  const absoluteOutput = path.resolve(process.cwd(), outputPath);
  let existing = '';
  try {
    existing = await fs.readFile(absoluteOutput, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw new ExitError(4, `unable to read output file ${outputPath}: ${error.message}`);
    }
  }

  if (existing && !existing.startsWith(AUTO_HEADER)) {
    throw new ExitError(4, `${outputPath} missing generated-file header`);
  }

  if (existing !== first) {
    throw new ExitError(4, `${outputPath} is out of date; run "torch-lock memory build"`);
  }

  console.log(JSON.stringify({
    ok: true,
    verified_events: events.length,
    output: outputPath,
  }, null, 2));
}
