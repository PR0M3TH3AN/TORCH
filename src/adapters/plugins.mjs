import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { TorchError } from '../kernel/errors.mjs';
import { sha256 } from '../kernel/files.mjs';

export const RUNTIME_PLUGIN_TRUST_SCHEMA = 'torch.dev/runtime-plugin-trust/v1alpha1';
const require = createRequire(import.meta.url);
const BUILT_INS = new Set(['claude', 'codex', 'pi']);

function pluginError(message, code, details) {
  return new TorchError(message, { code, details });
}

export function runtimePluginTrustPath(env = process.env) {
  const configHome = resolve(env.XDG_CONFIG_HOME || join(homedir(), '.config'));
  return join(configHome, 'torch', 'runtime-adapters.json');
}

function validatePluginName(name) {
  if (typeof name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(name)) {
    throw pluginError('Runtime plugin name must be a lowercase adapter identifier.', 'RUNTIME_PLUGIN_INVALID', { name });
  }
  if (BUILT_INS.has(name)) {
    throw pluginError(`Runtime plugin cannot replace the built-in adapter: ${name}`, 'RUNTIME_PLUGIN_RESERVED', { name });
  }
  return name;
}

function inspectEntrypoint(modulePath) {
  if (typeof modulePath !== 'string' || !modulePath.trim() || !isAbsolute(modulePath)) {
    throw pluginError('Runtime plugin entrypoint must be an absolute local path.', 'RUNTIME_PLUGIN_PATH_INVALID', { modulePath });
  }
  const path = resolve(modulePath);
  if (extname(path) !== '.cjs') {
    throw pluginError('Runtime plugin entrypoints must be standalone CommonJS .cjs files.', 'RUNTIME_PLUGIN_FORMAT_UNSUPPORTED', { path });
  }
  let metadata;
  let canonicalPath;
  try {
    metadata = lstatSync(path);
    canonicalPath = realpathSync(path);
  } catch (error) {
    throw pluginError(`Cannot inspect runtime plugin entrypoint: ${path}`, 'RUNTIME_PLUGIN_UNAVAILABLE', {
      path, cause: error.message,
    });
  }
  if (!metadata.isFile() || canonicalPath !== path) {
    throw pluginError('Runtime plugin entrypoint must be a regular, non-symlink file at its canonical path.', 'RUNTIME_PLUGIN_PATH_UNSAFE', {
      path, canonicalPath,
    });
  }
  return { path, digest: sha256(readFileSync(path)) };
}

function emptyStore() {
  return { schema: RUNTIME_PLUGIN_TRUST_SCHEMA, plugins: [] };
}

export function readRuntimePluginTrust({ env = process.env } = {}) {
  const path = runtimePluginTrustPath(env);
  if (!existsSync(path)) return { path, store: emptyStore() };
  let metadata;
  let store;
  try {
    metadata = lstatSync(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw pluginError('Runtime plugin trust store must be a regular non-symlink file.', 'RUNTIME_PLUGIN_STORE_UNSAFE', { path });
    }
    store = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (error instanceof TorchError) throw error;
    throw pluginError(`Cannot read runtime plugin trust store: ${path}`, 'RUNTIME_PLUGIN_STORE_INVALID', {
      path, cause: error.message,
    });
  }
  if (store?.schema !== RUNTIME_PLUGIN_TRUST_SCHEMA || !Array.isArray(store.plugins)) {
    throw pluginError('Runtime plugin trust store has an unsupported schema.', 'RUNTIME_PLUGIN_STORE_INVALID', { path });
  }
  const names = new Set();
  for (const record of store.plugins) {
    if (!record || typeof record.name !== 'string' || typeof record.modulePath !== 'string'
      || !/^[a-z][a-z0-9-]*$/.test(record.name) || !/^[a-f0-9]{64}$/.test(record.sha256)
      || typeof record.trustedAt !== 'string' || names.has(record.name)) {
      throw pluginError('Runtime plugin trust store contains an invalid or duplicate record.', 'RUNTIME_PLUGIN_STORE_INVALID', { path });
    }
    names.add(record.name);
  }
  return { path, store };
}

function writeStore(path, store) {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(store, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  renameSync(temporary, path);
  return path;
}

export function planRuntimePluginTrust({ name, modulePath, env = process.env } = {}) {
  const adapterName = validatePluginName(name);
  const entrypoint = inspectEntrypoint(modulePath);
  const { path: storePath, store } = readRuntimePluginTrust({ env });
  const existing = store.plugins.find((plugin) => plugin.name === adapterName);
  return {
    action: existing ? 'replace-runtime-plugin-trust' : 'trust-runtime-plugin',
    name: adapterName,
    modulePath: entrypoint.path,
    sha256: entrypoint.digest,
    previousSha256: existing?.sha256 ?? null,
    trustStorePath: storePath,
    executesPluginDuringPlan: false,
    trustEffect: 'The exact entrypoint module is allowed to execute in TORCH with the current user permissions.',
    mutationPerformed: false,
  };
}

export function trustRuntimePlugin({
  name, modulePath, env = process.env, approved = false, expectedSha256, now = () => new Date(),
} = {}) {
  const plan = planRuntimePluginTrust({ name, modulePath, env });
  if (!approved) {
    throw pluginError('Trusting a runtime plugin requires explicit user approval.', 'APPROVAL_REQUIRED', {
      action: plan.action, name: plan.name, modulePath: plan.modulePath, sha256: plan.sha256,
    });
  }
  if (expectedSha256 !== plan.sha256) {
    throw pluginError('Runtime plugin changed since review; inspect the new path and hash before trusting it.', 'RUNTIME_PLUGIN_REVIEW_STALE', {
      reviewedSha256: expectedSha256 ?? null, currentSha256: plan.sha256,
    });
  }
  const { path, store } = readRuntimePluginTrust({ env });
  const plugins = store.plugins.filter((plugin) => plugin.name !== plan.name);
  plugins.push({ name: plan.name, modulePath: plan.modulePath, sha256: plan.sha256, trustedAt: now().toISOString() });
  writeStore(path, { ...store, plugins: plugins.sort((left, right) => left.name.localeCompare(right.name)) });
  return { ...plan, mutationPerformed: true, sessionsStarted: false };
}

export function revokeRuntimePlugin({ name, env = process.env, approved = false, expectedSha256 } = {}) {
  const adapterName = validatePluginName(name);
  const { path, store } = readRuntimePluginTrust({ env });
  const existing = store.plugins.find((plugin) => plugin.name === adapterName);
  const plan = planRuntimePluginRevoke({ name: adapterName, env });
  if (!existing) return { ...plan, disposition: 'not-trusted' };
  if (!approved) throw pluginError('Revoking a runtime plugin requires explicit user approval.', 'APPROVAL_REQUIRED', plan);
  if (expectedSha256 !== existing.sha256) {
    throw pluginError('Runtime plugin trust changed since review; inspect the current record before revoking it.', 'RUNTIME_PLUGIN_REVIEW_STALE', {
      reviewedSha256: expectedSha256 ?? null, currentSha256: existing.sha256,
    });
  }
  writeStore(path, { ...store, plugins: store.plugins.filter((plugin) => plugin.name !== adapterName) });
  return { ...plan, mutationPerformed: true, disposition: 'revoked' };
}

export function planRuntimePluginRevoke({ name, env = process.env } = {}) {
  const adapterName = validatePluginName(name);
  const { path, store } = readRuntimePluginTrust({ env });
  const existing = store.plugins.find((plugin) => plugin.name === adapterName);
  return {
    action: 'revoke-runtime-plugin-trust', name: adapterName,
    modulePath: existing?.modulePath ?? null, sha256: existing?.sha256 ?? null,
    trustStorePath: path, mutationPerformed: false, sessionsStopped: false,
  };
}

export function inspectRuntimePluginTrust({ env = process.env } = {}) {
  const { path, store } = readRuntimePluginTrust({ env });
  const plugins = store.plugins.map((record) => {
    try {
      const current = inspectEntrypoint(record.modulePath);
      return {
        ...record,
        status: current.digest === record.sha256 ? 'trusted' : 'hash-mismatch',
        currentSha256: current.digest,
      };
    } catch (error) {
      return { ...record, status: 'unavailable', error: { code: error.code, message: error.message } };
    }
  });
  return { path, schema: store.schema, plugins, mutationPerformed: false };
}

export function loadTrustedRuntimeAdapters({ env = process.env, names } = {}) {
  const { store } = readRuntimePluginTrust({ env });
  const adapters = [];
  const errors = [];
  const allowedNames = names === undefined ? null : new Set(names);
  const selected = allowedNames ? store.plugins.filter((record) => allowedNames.has(record.name)) : store.plugins;
  for (const record of selected) {
    try {
      const entrypoint = inspectEntrypoint(record.modulePath);
      if (entrypoint.digest !== record.sha256) {
        throw pluginError(`Runtime plugin entrypoint changed after it was trusted: ${record.name}`, 'RUNTIME_PLUGIN_HASH_MISMATCH', {
          name: record.name, modulePath: record.modulePath, trustedSha256: record.sha256, currentSha256: entrypoint.digest,
        });
      }
      const resolved = require.resolve(entrypoint.path);
      delete require.cache[resolved];
      const plugin = require(entrypoint.path);
      if (typeof plugin.createTorchRuntimeAdapter !== 'function') {
        throw pluginError('Runtime plugin must export createTorchRuntimeAdapter({ env }).', 'RUNTIME_PLUGIN_CONTRACT_INVALID', {
          name: record.name,
        });
      }
      const adapter = plugin.createTorchRuntimeAdapter({ env });
      if (adapter && typeof adapter.then === 'function') {
        throw pluginError('Runtime plugin factories must be synchronous.', 'RUNTIME_PLUGIN_CONTRACT_INVALID', { name: record.name });
      }
      if (adapter?.name !== record.name) {
        throw pluginError('Runtime plugin adapter name does not match its trusted identifier.', 'RUNTIME_PLUGIN_NAME_MISMATCH', {
          expected: record.name, actual: adapter?.name ?? null,
        });
      }
      adapters.push(adapter);
    } catch (error) {
      errors.push({
        name: record.name, code: error.code ?? 'RUNTIME_PLUGIN_LOAD_FAILED', message: error.message,
        details: error.details,
      });
    }
  }
  return { adapters, errors };
}
