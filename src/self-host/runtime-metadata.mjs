import { createHash } from 'node:crypto';
import {
  constants as fsConstants, fstatSync, lstatSync, openSync, opendirSync, readSync,
  readlinkSync, closeSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA = 'torch.dev/runtime-metadata/v1alpha1';
const MAX_JSON_BYTES = 64 * 1024;
const MAX_LINK_BYTES = 1024;
const MAX_TREE_ENTRIES = 8192;
const MAX_TREE_FILE_BYTES = 64 * 1024 * 1024;
const MAX_TREE_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_CONSOLE_FILES = 64;
const MAX_CONSOLE_FILE_BYTES = 4 * 1024 * 1024;
const MAX_CONSOLE_TOTAL_BYTES = 16 * 1024 * 1024;
const MAX_ISSUES = 32;
const READ_CHUNK_BYTES = 64 * 1024;

const CONSOLE_ASSETS = Object.freeze([
  'console.html',
  'styles.css',
  'torch-mark.svg',
  'work-views.js',
  'work-progress.js',
  'owner-digest.js',
  'check-evidence.js',
  'task-activity.js',
  'operation-outcomes.js',
  'attention-projection.js',
  'attention-actions.js',
  'live-refresh.js',
  'demo.js',
  'console.js',
]);

const MODULE_PATH = fileURLToPath(import.meta.url);
const MODULE_DIRECTORY = dirname(MODULE_PATH);
const PACKAGE_ROOT = resolve(MODULE_DIRECTORY, '..', '..');
const DATA_HOME = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
const TORCH_DATA_HOME = join(DATA_HOME, 'torch');
const RUNTIME_DIRECTORY = join(TORCH_DATA_HOME, 'runtime');
const VERSIONS_DIRECTORY = join(RUNTIME_DIRECTORY, 'versions');
const NOFOLLOW = fsConstants.O_NOFOLLOW;
const NONBLOCK = fsConstants.O_NONBLOCK ?? 0;

class MetadataIssue extends Error {
  constructor(code, path = null) {
    super(code);
    this.code = code;
    this.path = path;
  }
}

function issue(code, path = null) {
  return { code, path };
}

function addIssue(issues, error, fallback = 'RUNTIME_METADATA_READ_FAILED') {
  if (issues.length >= MAX_ISSUES) return;
  const code = typeof error?.code === 'string' && error.code.startsWith('RUNTIME_METADATA_')
    ? error.code
    : fallback;
  issues.push(issue(code, error?.path ?? null));
}

function isMissing(error) {
  return error?.code === 'ENOENT' || error?.code === 'ENOTDIR';
}

function stableStat(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function statNoFollow(path, displayPath) {
  try {
    return lstatSync(path, { bigint: true });
  } catch (error) {
    if (isMissing(error)) throw new MetadataIssue('RUNTIME_METADATA_FILE_MISSING', displayPath);
    throw new MetadataIssue('RUNTIME_METADATA_STAT_FAILED', displayPath);
  }
}

function assertNoFollowAvailable(displayPath) {
  if (typeof NOFOLLOW !== 'number' || NOFOLLOW === 0) {
    throw new MetadataIssue('RUNTIME_METADATA_NOFOLLOW_UNAVAILABLE', displayPath);
  }
}

function assertRegular(stat, displayPath) {
  if (stat.isSymbolicLink()) throw new MetadataIssue('RUNTIME_METADATA_LINK_REFUSED', displayPath);
  if (!stat.isFile()) throw new MetadataIssue('RUNTIME_METADATA_SPECIAL_ENTRY_REFUSED', displayPath);
}

function compareOpenedFile(path, displayPath, initialPathStat, initialFdStat, finalFdStat) {
  const finalPathStat = statNoFollow(path, displayPath);
  if (!stableStat(initialPathStat, initialFdStat)
    || !stableStat(initialFdStat, finalFdStat)
    || !stableStat(finalFdStat, finalPathStat)) {
    throw new MetadataIssue('RUNTIME_METADATA_FILE_CHANGED_DURING_READ', displayPath);
  }
}

function openRegular(path, displayPath, maxBytes) {
  assertNoFollowAvailable(displayPath);
  const pathStat = statNoFollow(path, displayPath);
  assertRegular(pathStat, displayPath);
  if (pathStat.size > BigInt(maxBytes)) {
    throw new MetadataIssue('RUNTIME_METADATA_FILE_CAP_EXCEEDED', displayPath);
  }
  let fd;
  try {
    fd = openSync(path, fsConstants.O_RDONLY | NOFOLLOW | NONBLOCK);
  } catch (error) {
    throw new MetadataIssue(error?.code === 'ELOOP'
      ? 'RUNTIME_METADATA_LINK_REFUSED'
      : 'RUNTIME_METADATA_OPEN_FAILED', displayPath);
  }
  try {
    const fdStat = fstatSync(fd, { bigint: true });
    assertRegular(fdStat, displayPath);
    if (!stableStat(pathStat, fdStat)) {
      throw new MetadataIssue('RUNTIME_METADATA_FILE_CHANGED_DURING_READ', displayPath);
    }
    if (fdStat.size > BigInt(maxBytes)) {
      throw new MetadataIssue('RUNTIME_METADATA_FILE_CAP_EXCEEDED', displayPath);
    }
    return { fd, pathStat, fdStat };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

function readBoundedRegular(path, displayPath, maxBytes = MAX_JSON_BYTES) {
  const opened = openRegular(path, displayPath, maxBytes);
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const remaining = maxBytes + 1 - total;
      if (remaining <= 0) throw new MetadataIssue('RUNTIME_METADATA_FILE_CAP_EXCEEDED', displayPath);
      const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, remaining));
      const length = readSync(opened.fd, chunk, 0, chunk.length, total);
      if (length === 0) break;
      total += length;
      if (total > maxBytes) throw new MetadataIssue('RUNTIME_METADATA_FILE_CAP_EXCEEDED', displayPath);
      chunks.push(chunk.subarray(0, length));
    }
    const finalFdStat = fstatSync(opened.fd, { bigint: true });
    compareOpenedFile(path, displayPath, opened.pathStat, opened.fdStat, finalFdStat);
    if (total !== Number(finalFdStat.size)) {
      throw new MetadataIssue('RUNTIME_METADATA_FILE_CHANGED_DURING_READ', displayPath);
    }
    return Buffer.concat(chunks, total);
  } finally {
    closeSync(opened.fd);
  }
}

function parseJsonFile(path, displayPath) {
  const bytes = readBoundedRegular(path, displayPath);
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new MetadataIssue('RUNTIME_METADATA_JSON_MALFORMED', displayPath);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new MetadataIssue('RUNTIME_METADATA_JSON_MALFORMED', displayPath);
  }
  return parsed;
}

function readOptionalJson(path, displayPath, issues) {
  try {
    return { status: 'observed', value: parseJsonFile(path, displayPath) };
  } catch (error) {
    addIssue(issues, error);
    return { status: error?.code === 'RUNTIME_METADATA_FILE_MISSING' ? 'missing' : 'unknown', value: null };
  }
}

function validVersion(value) {
  return typeof value === 'string'
    && /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value);
}

function versionValue(value) {
  return validVersion(value) ? value : null;
}

function digestValue(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : null;
}

function commitValue(value) {
  return typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value) ? value.toLowerCase() : null;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function inside(root, candidate) {
  const rootPath = resolve(root);
  const candidatePath = resolve(candidate);
  return candidatePath !== rootPath && candidatePath.startsWith(`${rootPath}${sep}`);
}

function utf8RoundTrips(bytes) {
  return Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes);
}

function readBoundedLink(path, displayPath, cap = MAX_LINK_BYTES) {
  let linkStat;
  try {
    linkStat = lstatSync(path, { bigint: true });
  } catch {
    throw new MetadataIssue('RUNTIME_METADATA_LINK_READ_FAILED', displayPath);
  }
  if (!linkStat.isSymbolicLink()) throw new MetadataIssue('RUNTIME_METADATA_LINK_REFUSED', displayPath);
  if (linkStat.size > BigInt(cap)) {
    throw new MetadataIssue('RUNTIME_METADATA_LINK_CAP_EXCEEDED', displayPath);
  }
  let bytes;
  try {
    bytes = readlinkSync(path, { encoding: 'buffer' });
  } catch {
    throw new MetadataIssue('RUNTIME_METADATA_LINK_READ_FAILED', displayPath);
  }
  if (!Buffer.isBuffer(bytes) || bytes.length > cap) {
    throw new MetadataIssue('RUNTIME_METADATA_LINK_CAP_EXCEEDED', displayPath);
  }
  if (bytes.length !== Number(linkStat.size)) {
    throw new MetadataIssue('RUNTIME_METADATA_LINK_CHANGED_DURING_READ', displayPath);
  }
  if (!utf8RoundTrips(bytes)) throw new MetadataIssue('RUNTIME_METADATA_LINK_UTF8_INVALID', displayPath);
  return { bytes, text: bytes.toString('utf8') };
}

function assertPermittedLinkTarget(root, linkPath, linkText, displayPath) {
  if (isAbsolute(linkText) || /^[A-Za-z]:[\\/]/.test(linkText) || linkText.startsWith('\\\\')) {
    throw new MetadataIssue('RUNTIME_METADATA_LINK_ABSOLUTE_REFUSED', displayPath);
  }
  const target = resolve(dirname(linkPath), linkText);
  if (!inside(root, target)) throw new MetadataIssue('RUNTIME_METADATA_LINK_ESCAPE_REFUSED', displayPath);
  const rel = relative(root, target).split(sep).join('/');
  if (rel.split('/').includes('.git') || rel === '.torch-validation.json') {
    throw new MetadataIssue('RUNTIME_METADATA_LINK_EXCLUDED_TARGET_REFUSED', displayPath);
  }
  const components = rel.split('/');
  let current = root;
  for (let index = 0; index < components.length; index += 1) {
    current = join(current, components[index]);
    let stat;
    try {
      stat = lstatSync(current, { bigint: true });
    } catch (error) {
      if (isMissing(error)) throw new MetadataIssue('RUNTIME_METADATA_LINK_DANGLING_REFUSED', displayPath);
      throw new MetadataIssue('RUNTIME_METADATA_LINK_TARGET_UNKNOWN', displayPath);
    }
    if (index < components.length - 1 && (!stat.isDirectory() || stat.isSymbolicLink())) {
      throw new MetadataIssue('RUNTIME_METADATA_LINK_TARGET_TRAVERSAL_REFUSED', displayPath);
    }
    if (index === components.length - 1
      && !(stat.isFile() || stat.isDirectory() || stat.isSymbolicLink())) {
      throw new MetadataIssue('RUNTIME_METADATA_LINK_SPECIAL_TARGET_REFUSED', displayPath);
    }
  }
}

function statRecord(path, relativePath, root) {
  const stat = statNoFollow(path, relativePath);
  if (stat.isDirectory()) return { path, relativePath, type: 'directory', stat };
  if (stat.isFile()) {
    if (stat.size > BigInt(MAX_TREE_FILE_BYTES)) {
      throw new MetadataIssue('RUNTIME_METADATA_TREE_FILE_CAP_EXCEEDED', relativePath);
    }
    return { path, relativePath, type: 'file', stat, bytes: Number(stat.size) };
  }
  if (stat.isSymbolicLink()) {
    const link = readBoundedLink(path, relativePath);
    assertPermittedLinkTarget(root, path, link.text, relativePath);
    return { path, relativePath, type: 'symlink', stat, linkBytes: link.bytes, bytes: link.bytes.length };
  }
  throw new MetadataIssue('RUNTIME_METADATA_SPECIAL_ENTRY_REFUSED', relativePath);
}

function directoryEntries(path, relativePath) {
  const before = statNoFollow(path, relativePath);
  if (!before.isDirectory() || before.isSymbolicLink()) {
    throw new MetadataIssue('RUNTIME_METADATA_DIRECTORY_REFUSED', relativePath);
  }
  let directory;
  try {
    directory = opendirSync(path);
  } catch {
    throw new MetadataIssue('RUNTIME_METADATA_DIRECTORY_READ_FAILED', relativePath);
  }
  const entries = [];
  try {
    for (;;) {
      const entry = directory.readSync();
      if (entry === null) break;
      if (entries.length >= MAX_TREE_ENTRIES) {
        throw new MetadataIssue('RUNTIME_METADATA_TREE_ENTRY_CAP_EXCEEDED', relativePath || '.');
      }
      entries.push(entry);
    }
  } finally {
    directory.closeSync();
  }
  const after = statNoFollow(path, relativePath);
  if (!stableStat(before, after)) throw new MetadataIssue('RUNTIME_METADATA_DIRECTORY_CHANGED_DURING_READ', relativePath);
  entries.sort((left, right) => left.name.localeCompare(right.name));
  return entries;
}

function inventoryTree(root, { excludeRootValidation = false } = {}) {
  const rootStat = statNoFollow(root, '.');
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new MetadataIssue('RUNTIME_METADATA_PACKAGE_ROOT_REFUSED', '.');
  }
  const records = [];
  let entryCount = 0;
  const visit = (directory, relativeDirectory) => {
    const entries = directoryEntries(directory, relativeDirectory);
    for (const entry of entries) {
      entryCount += 1;
      if (entryCount > MAX_TREE_ENTRIES) {
        throw new MetadataIssue('RUNTIME_METADATA_TREE_ENTRY_CAP_EXCEEDED', relativeDirectory || '.');
      }
      if (entry.name === '.git') continue;
      const path = join(directory, entry.name);
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (excludeRootValidation && relativePath === '.torch-validation.json') continue;
      const record = statRecord(path, relativePath, root);
      if (record.type === 'directory') visit(path, relativePath);
      else records.push(record);
    }
  };
  visit(root, '');
  let totalBytes = 0;
  for (const record of records) {
    if (record.type === 'file' || record.type === 'symlink') {
      if (record.bytes > MAX_TREE_FILE_BYTES) {
        throw new MetadataIssue('RUNTIME_METADATA_TREE_FILE_CAP_EXCEEDED', record.relativePath);
      }
      if (totalBytes + record.bytes > MAX_TREE_TOTAL_BYTES) {
        throw new MetadataIssue('RUNTIME_METADATA_TREE_TOTAL_CAP_EXCEEDED', record.relativePath);
      }
      totalBytes += record.bytes;
    }
  }
  return { records, totalBytes, entries: entryCount };
}

function updateRecordPrefix(digest, record) {
  digest.update(record.relativePath, 'utf8').update('\0')
    .update(record.type, 'utf8').update('\0')
    .update(String(Number(record.stat.mode) & 0o777), 'utf8').update('\0');
}

function hashRegularRecord(root, record, digest) {
  const opened = openRegular(record.path, record.relativePath, MAX_TREE_FILE_BYTES);
  if (!stableStat(record.stat, opened.pathStat) || !stableStat(opened.pathStat, opened.fdStat)) {
    closeSync(opened.fd);
    throw new MetadataIssue('RUNTIME_METADATA_FILE_CHANGED_DURING_READ', record.relativePath);
  }
  let total = 0;
  try {
    for (;;) {
      const remaining = MAX_TREE_FILE_BYTES + 1 - total;
      if (remaining <= 0) throw new MetadataIssue('RUNTIME_METADATA_TREE_FILE_CAP_EXCEEDED', record.relativePath);
      const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, remaining));
      const length = readSync(opened.fd, chunk, 0, chunk.length, total);
      if (length === 0) break;
      total += length;
      if (total > MAX_TREE_FILE_BYTES) {
        throw new MetadataIssue('RUNTIME_METADATA_TREE_FILE_CAP_EXCEEDED', record.relativePath);
      }
      digest.update(chunk.subarray(0, length));
    }
    const finalFdStat = fstatSync(opened.fd, { bigint: true });
    compareOpenedFile(record.path, record.relativePath, opened.pathStat, opened.fdStat, finalFdStat);
    if (total !== Number(finalFdStat.size) || total !== record.bytes) {
      throw new MetadataIssue('RUNTIME_METADATA_FILE_CHANGED_DURING_READ', record.relativePath);
    }
  } finally {
    closeSync(opened.fd);
  }
}

function candidateTreeObservation() {
  const inventory = inventoryTree(PACKAGE_ROOT, { excludeRootValidation: true });
  const digest = createHash('sha256');
  for (const record of inventory.records) {
    updateRecordPrefix(digest, record);
    if (record.type === 'symlink') digest.update(record.linkBytes);
    else hashRegularRecord(PACKAGE_ROOT, record, digest);
    digest.update('\0');
  }
  return {
    status: 'observed',
    sha256: digest.digest('hex'),
    entries: inventory.entries,
    files: inventory.records.length,
    bytes: inventory.totalBytes,
    atomicSnapshot: false,
  };
}

function candidateTreeOrUnknown(issues) {
  try {
    return candidateTreeObservation();
  } catch (error) {
    addIssue(issues, error);
    return {
      status: error?.code === 'RUNTIME_METADATA_TREE_ENTRY_CAP_EXCEEDED'
        || error?.code === 'RUNTIME_METADATA_TREE_FILE_CAP_EXCEEDED'
        || error?.code === 'RUNTIME_METADATA_TREE_TOTAL_CAP_EXCEEDED'
        ? 'refused'
        : 'unknown',
      sha256: null,
      entries: null,
      files: null,
      bytes: null,
      atomicSnapshot: false,
    };
  }
}

function observedValue(status, value) {
  return { status, value };
}

function evaluateReaderModule() {
  const issues = [];
  const packageJson = readOptionalJson(join(PACKAGE_ROOT, 'package.json'), 'package.json', issues);
  const releaseJson = readOptionalJson(join(PACKAGE_ROOT, 'torch-release.json'), 'torch-release.json', issues);
  const validationJson = readOptionalJson(join(PACKAGE_ROOT, '.torch-validation.json'), '.torch-validation.json', issues);
  let moduleFileSha256 = null;
  let moduleFileBytes = null;
  try {
    const bytes = readBoundedRegular(MODULE_PATH, 'src/self-host/runtime-metadata.mjs', 8 * 1024 * 1024);
    moduleFileSha256 = sha256(bytes);
    moduleFileBytes = bytes.length;
  } catch (error) {
    addIssue(issues, error);
  }
  const tree = candidateTreeOrUnknown(issues);
  const packageVersion = versionValue(packageJson.value?.version);
  const releaseVersion = versionValue(releaseJson.value?.version);
  const validation = validationJson.value;
  const declaredDigest = digestValue(validation?.digest);
  const declaredSourceCommit = commitValue(validation?.source?.commit);
  const consistency = declaredDigest && tree.sha256
    ? (declaredDigest === tree.sha256 ? 'match' : 'mismatch')
    : 'unknown';
  if (packageJson.status === 'observed' && packageVersion === null) issues.push(issue('RUNTIME_METADATA_PACKAGE_VERSION_INVALID', 'package.json'));
  if (releaseJson.status === 'observed' && releaseVersion === null) issues.push(issue('RUNTIME_METADATA_RELEASE_VERSION_INVALID', 'torch-release.json'));
  if (validationJson.status === 'observed' && validation?.digest != null && declaredDigest === null) {
    issues.push(issue('RUNTIME_METADATA_DECLARED_DIGEST_INVALID', '.torch-validation.json'));
  }
  if (validationJson.status === 'observed' && validation?.source?.commit != null && declaredSourceCommit === null) {
    issues.push(issue('RUNTIME_METADATA_DECLARED_COMMIT_INVALID', '.torch-validation.json'));
  }
  return {
    status: issues.length === 0 ? 'observed' : 'partial',
    moduleUrl: import.meta.url,
    modulePath: MODULE_PATH,
    moduleEvaluationAt: new Date().toISOString(),
    packageRoot: PACKAGE_ROOT,
    packageVersion: observedValue(packageJson.status, packageVersion),
    releaseVersion: observedValue(releaseJson.status, releaseVersion),
    declaredSourceCommit: observedValue(validationJson.status, declaredSourceCommit),
    validation: {
      status: validationJson.status,
      schema: typeof validation?.schema === 'string' ? validation.schema : null,
      declaredVersion: versionValue(validation?.version),
      declaredDigest,
      validatedAt: typeof validation?.validatedAt === 'string' ? validation.validatedAt : null,
      declaredPassed: typeof validation?.passed === 'boolean' ? validation.passed : null,
    },
    moduleFile: { sha256: moduleFileSha256, bytes: moduleFileBytes, observation: 'disk-at-module-evaluation' },
    candidateTree: { ...tree, declaredDigest, consistency },
    authenticationConfidence: 'unknown',
    loadedMemoryCodeDigest: null,
    issues: issues.slice(0, MAX_ISSUES),
  };
}

function readActivePointer(issues) {
  const path = join(RUNTIME_DIRECTORY, 'active');
  let stat;
  try {
    stat = lstatSync(path, { bigint: true });
  } catch (error) {
    if (isMissing(error)) return { status: 'missing', target: null, version: null };
    issues.push(issue('RUNTIME_METADATA_ACTIVE_POINTER_STAT_FAILED', 'runtime/active'));
    return { status: 'unknown', target: null, version: null };
  }
  if (!stat.isSymbolicLink()) {
    issues.push(issue('RUNTIME_METADATA_ACTIVE_POINTER_NOT_LINK', 'runtime/active'));
    return { status: 'refused', target: null, version: null };
  }
  let link;
  try {
    link = readBoundedLink(path, 'runtime/active', 256);
  } catch (error) {
    addIssue(issues, error, 'RUNTIME_METADATA_ACTIVE_POINTER_READ_FAILED');
    return { status: 'unknown', target: null, version: null };
  }
  const match = /^versions\/([^/]+)$/.exec(link.text);
  const version = match ? versionValue(match[1]) : null;
  if (!version) {
    issues.push(issue('RUNTIME_METADATA_ACTIVE_POINTER_TARGET_INVALID', 'runtime/active'));
    return { status: 'refused', target: link.text, version: null };
  }
  return { status: 'observed', target: link.text, version };
}

function readRuntimeState() {
  const issues = [];
  const pointer = readActivePointer(issues);
  const registry = readOptionalJson(join(RUNTIME_DIRECTORY, 'registry.json'), 'runtime/registry.json', issues);
  const journal = readOptionalJson(join(RUNTIME_DIRECTORY, 'activation-journal.json'), 'runtime/activation-journal.json', issues);
  let registryValue = null;
  if (registry.status === 'observed') {
    const raw = registry.value;
    if (raw.schema !== 'torch.dev/version-registry/v1alpha1'
      || !(raw.activeVersion === null || validVersion(raw.activeVersion))
      || !(raw.previousVersion === null || validVersion(raw.previousVersion))
      || !Number.isSafeInteger(raw.generation) || raw.generation < 0) {
      issues.push(issue('RUNTIME_METADATA_REGISTRY_MALFORMED', 'runtime/registry.json'));
    } else {
      registryValue = {
        schema: raw.schema,
        activeVersion: raw.activeVersion,
        previousVersion: raw.previousVersion,
        generation: raw.generation,
        updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
      };
    }
  }
  let journalValue = null;
  if (journal.status === 'observed') {
    const raw = journal.value;
    if (raw.schema !== 'torch.dev/activation-journal/v1alpha1'
      || !(raw.from === null || validVersion(raw.from))
      || !validVersion(raw.to)
      || typeof raw.startedAt !== 'string') {
      issues.push(issue('RUNTIME_METADATA_JOURNAL_MALFORMED', 'runtime/activation-journal.json'));
    } else {
      journalValue = { schema: raw.schema, from: raw.from, to: raw.to, startedAt: raw.startedAt };
    }
  }
  let consistency = 'unknown';
  if (pointer.status === 'observed' && registryValue) {
    consistency = pointer.version === registryValue.activeVersion ? 'match' : 'mismatch';
  } else if (pointer.status === 'missing' && registryValue?.activeVersion === null) {
    consistency = 'match';
  }
  if (journal.status === 'observed' && journalValue) {
    if (pointer.status === 'observed' && registryValue
      && ![journalValue.from, journalValue.to].includes(pointer.version)) consistency = 'mismatch';
    else if (consistency === 'match') consistency = 'partial';
  }
  return {
    status: issues.length === 0 ? 'observed' : 'partial',
    activePointer: pointer,
    registry: { status: registry.status, value: registryValue },
    journal: { status: journal.status, value: journalValue },
    consistency,
    issues: issues.slice(0, MAX_ISSUES),
  };
}

function readConsoleDisk() {
  const issues = [];
  const assets = [];
  if (CONSOLE_ASSETS.length > MAX_CONSOLE_FILES) {
    return { status: 'refused', assets: [], aggregateSha256: null, bytes: null, issues: [issue('RUNTIME_METADATA_CONSOLE_FILE_CAP_EXCEEDED')] };
  }
  const observations = [];
  let totalBytes = 0;
  try {
    for (const relativePath of CONSOLE_ASSETS) {
      const path = join(PACKAGE_ROOT, 'site', relativePath);
      const displayPath = `site/${relativePath}`;
      const stat = statNoFollow(path, displayPath);
      assertRegular(stat, displayPath);
      if (stat.size > BigInt(MAX_CONSOLE_FILE_BYTES)) {
        throw new MetadataIssue('RUNTIME_METADATA_CONSOLE_FILE_CAP_EXCEEDED', displayPath);
      }
      const bytes = Number(stat.size);
      if (totalBytes + bytes > MAX_CONSOLE_TOTAL_BYTES) {
        throw new MetadataIssue('RUNTIME_METADATA_CONSOLE_TOTAL_CAP_EXCEEDED', displayPath);
      }
      totalBytes += bytes;
      observations.push({ path, relativePath: displayPath, bytes });
    }
    const hashed = [];
    for (const item of observations) {
      const bytes = readBoundedRegular(item.path, item.relativePath, MAX_CONSOLE_FILE_BYTES);
      if (bytes.length !== item.bytes) {
        throw new MetadataIssue('RUNTIME_METADATA_FILE_CHANGED_DURING_READ', item.relativePath);
      }
      hashed.push({ path: item.relativePath, bytes: bytes.length, sha256: sha256(bytes) });
    }
    const aggregate = createHash('sha256').update('torch.dev/console-assets/v1alpha1\0', 'utf8');
    for (const asset of hashed) {
      aggregate.update(asset.path, 'utf8').update('\0')
        .update(String(asset.bytes), 'utf8').update('\0')
        .update(asset.sha256, 'utf8').update('\0');
    }
    assets.push(...hashed);
    return {
      status: 'observed',
      files: assets.length,
      bytes: totalBytes,
      aggregateSha256: aggregate.digest('hex'),
      assets,
      atomicSnapshot: false,
      deliveredBytesProof: null,
      issues,
    };
  } catch (error) {
    addIssue(issues, error);
    return {
      status: 'refused',
      files: null,
      bytes: null,
      aggregateSha256: null,
      assets: [],
      atomicSnapshot: false,
      deliveredBytesProof: null,
      issues,
    };
  }
}

function relation(left, right) {
  if (left == null || right == null) return 'unknown';
  return left === right ? 'match' : 'mismatch';
}

const READER_MODULE_EVALUATION = evaluateReaderModule();
const CONSOLE_DISK_AT_EVALUATION = readConsoleDisk();
const RUNTIME_AT_EVALUATION = readRuntimeState();

export function readLoadedRuntimeMetadataV1() {
  const currentConsoleDisk = readConsoleDisk();
  const currentRuntime = readRuntimeState();
  return {
    schema: SCHEMA,
    observedAt: new Date().toISOString(),
    readerModuleEvaluation: structuredClone(READER_MODULE_EVALUATION),
    currentConsoleDisk,
    activeRuntimeAtModuleEvaluation: structuredClone(RUNTIME_AT_EVALUATION),
    currentActiveRuntime: currentRuntime,
    relations: {
      localPackageReleaseVersion: relation(
        READER_MODULE_EVALUATION.packageVersion.value,
        READER_MODULE_EVALUATION.releaseVersion.value,
      ),
      candidateTreeConsistency: READER_MODULE_EVALUATION.candidateTree.consistency,
      consoleDiskSinceModuleEvaluation: relation(
        CONSOLE_DISK_AT_EVALUATION.aggregateSha256,
        currentConsoleDisk.aggregateSha256,
      ),
      activePointerSinceModuleEvaluation: relation(
        RUNTIME_AT_EVALUATION.activePointer.version,
        currentRuntime.activePointer.version,
      ),
      registryGenerationSinceModuleEvaluation: relation(
        RUNTIME_AT_EVALUATION.registry.value?.generation,
        currentRuntime.registry.value?.generation,
      ),
    },
    authenticationConfidence: 'unknown',
    loadedMemoryCodeDigest: null,
    deliveredBytesProof: null,
    nativeAuthority: null,
  };
}
