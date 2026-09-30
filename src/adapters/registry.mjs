import { TorchError } from '../kernel/errors.mjs';
import { createClaudeAdapter } from './claude.mjs';
import { createCodexAdapter } from './codex.mjs';
import { createPiAdapter } from './pi.mjs';
import { validateRuntimeAdapter } from './runtime.mjs';
import { inspectRuntimePluginTrust, loadTrustedRuntimeAdapters } from './plugins.mjs';

export class RuntimeAdapterRegistry {
  constructor({ env = process.env, adapters = [], loadPlugins = false, pluginNames } = {}) {
    this.adapters = new Map([
      ['claude', createClaudeAdapter({ env })],
      ['codex', createCodexAdapter({ env })],
      ['pi', createPiAdapter({ env })],
    ]);
    this.pluginErrors = [];
    this.trustedPlugins = [];
    try {
      const inspected = inspectRuntimePluginTrust({ env });
      this.trustedPlugins = inspected.plugins;
      if (loadPlugins) {
        const loaded = loadTrustedRuntimeAdapters({ env, names: pluginNames });
        this.pluginErrors.push(...loaded.errors);
        for (const adapter of loaded.adapters) {
          try { this.register(adapter); } catch (error) {
            this.pluginErrors.push({
              name: adapter.name, code: error.code ?? 'RUNTIME_PLUGIN_LOAD_FAILED', message: error.message,
              details: error.details,
            });
          }
        }
      } else {
        for (const plugin of inspected.plugins.filter((entry) => entry.status !== 'trusted')) {
          this.pluginErrors.push({
            name: plugin.name,
            code: plugin.status === 'hash-mismatch' ? 'RUNTIME_PLUGIN_HASH_MISMATCH' : 'RUNTIME_PLUGIN_UNAVAILABLE',
            message: plugin.error?.message ?? `Runtime plugin is ${plugin.status}.`,
          });
        }
      }
    } catch (error) {
      this.pluginErrors.push({
        name: null, code: error.code ?? 'RUNTIME_PLUGIN_STORE_INVALID', message: error.message,
        details: error.details,
      });
    }
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter) {
    validateRuntimeAdapter(adapter);
    if (!/^[a-z][a-z0-9-]*$/.test(adapter.name)) {
      throw new TorchError(`Invalid runtime adapter name: ${adapter.name}`, {
        code: 'INVALID_RUNTIME_ADAPTER', details: { name: adapter.name },
      });
    }
    if (this.adapters.has(adapter.name)) {
      throw new TorchError(`Runtime adapter already registered: ${adapter.name}`, {
        code: 'RUNTIME_ADAPTER_EXISTS', details: { name: adapter.name },
      });
    }
    this.adapters.set(adapter.name, adapter);
    return adapter;
  }

  replace(adapter) {
    validateRuntimeAdapter(adapter);
    if (!this.adapters.has(adapter.name)) {
      throw new TorchError(`Cannot replace an unregistered runtime adapter: ${adapter.name}`, {
        code: 'RUNTIME_ADAPTER_MISSING', details: { name: adapter.name },
      });
    }
    this.adapters.set(adapter.name, adapter);
    return adapter;
  }

  get(name) { return this.adapters.get(name); }

  has(name) { return this.adapters.has(name); }

  names() { return [...this.adapters.keys()]; }

  toMap() { return new Map(this.adapters); }

  configuration(name) {
    const adapter = this.get(name);
    if (!adapter) return undefined;
    return structuredClone(adapter.configuration ?? {});
  }
}

export function createRuntimeAdapterRegistry(options) {
  return new RuntimeAdapterRegistry(options);
}
