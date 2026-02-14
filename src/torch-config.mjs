import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_RELAYS,
  DEFAULT_TTL,
  DEFAULT_NAMESPACE,
  DEFAULT_QUERY_TIMEOUT_MS,
} from './constants.mjs';

const DEFAULT_CONFIG_PATH = 'torch-config.json';

let cachedConfig = null;

function normalizeCadence(value, fallback) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'daily' || normalized === 'weekly' || normalized === 'all' ? normalized : fallback;
}

function normalizeStatus(value, fallback) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'active' || normalized === 'all' ? normalized : fallback;
}

function parseRoster(value) {
  if (!Array.isArray(value)) return null;
  const parsed = value.map((item) => String(item).trim()).filter(Boolean);
  return parsed.length > 0 ? parsed : null;
}

export function getTorchConfigPath() {
  const explicitPath = (process.env.TORCH_CONFIG_PATH || '').trim();
  if (explicitPath) return path.resolve(process.cwd(), explicitPath);
  return path.resolve(process.cwd(), DEFAULT_CONFIG_PATH);
}

export function loadTorchConfig() {
  if (cachedConfig) return cachedConfig;

  const configPath = getTorchConfigPath();
  let raw = {};

  if (fs.existsSync(configPath)) {
    try {
      raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (err) {
      throw new Error(`Failed to parse ${configPath}: ${err.message}`, { cause: err });
    }
  }

  const nostrLock = raw.nostrLock || {};
  const dashboard = raw.dashboard || {};
  const scheduler = raw.scheduler || {};
  const firstPromptByCadence = scheduler.firstPromptByCadence || {};
  const paused = scheduler.paused || {};

  cachedConfig = {
    configPath,
    raw,
    nostrLock: {
      namespace: typeof nostrLock.namespace === 'string' ? nostrLock.namespace.trim() : null,
      relays: Array.isArray(nostrLock.relays)
        ? nostrLock.relays.map((relay) => String(relay).trim()).filter(Boolean)
        : null,
      ttlSeconds: Number.isFinite(nostrLock.ttlSeconds) && nostrLock.ttlSeconds > 0
        ? Math.floor(nostrLock.ttlSeconds)
        : null,
      queryTimeoutMs: Number.isFinite(nostrLock.queryTimeoutMs) && nostrLock.queryTimeoutMs > 0
        ? Math.floor(nostrLock.queryTimeoutMs)
        : null,
      dailyRoster: parseRoster(nostrLock.dailyRoster),
      weeklyRoster: parseRoster(nostrLock.weeklyRoster),
    },
    dashboard: {
      defaultCadenceView: normalizeCadence(dashboard.defaultCadenceView, 'daily'),
      defaultStatusView: normalizeStatus(dashboard.defaultStatusView, 'active'),
      relays: Array.isArray(dashboard.relays)
        ? dashboard.relays.map((relay) => String(relay).trim()).filter(Boolean)
        : null,
      namespace: typeof dashboard.namespace === 'string' ? dashboard.namespace.trim() : null,
      hashtag: typeof dashboard.hashtag === 'string' ? dashboard.hashtag.trim() : null,
    },
    scheduler: {
      firstPromptByCadence: {
        daily: typeof firstPromptByCadence.daily === 'string' ? firstPromptByCadence.daily.trim() : null,
        weekly: typeof firstPromptByCadence.weekly === 'string' ? firstPromptByCadence.weekly.trim() : null,
      },
      paused: {
        daily: parseRoster(paused.daily) || [],
        weekly: parseRoster(paused.weekly) || [],
      },
    },
  };

  return cachedConfig;
}

export function getRelays() {
  const config = loadTorchConfig();
  const envRelays = process.env.NOSTR_LOCK_RELAYS;
  if (envRelays) {
    return envRelays.split(',').map((r) => r.trim()).filter(Boolean);
  }
  if (config.nostrLock.relays?.length) {
    return config.nostrLock.relays;
  }
  return DEFAULT_RELAYS;
}

export function getNamespace() {
  const config = loadTorchConfig();
  const namespace = (process.env.NOSTR_LOCK_NAMESPACE || config.nostrLock.namespace || DEFAULT_NAMESPACE).trim();
  return namespace || DEFAULT_NAMESPACE;
}

export function getTtl() {
  const config = loadTorchConfig();
  const envTtl = process.env.NOSTR_LOCK_TTL;
  if (envTtl) {
    const parsed = parseInt(envTtl, 10);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  if (config.nostrLock.ttlSeconds) {
    return config.nostrLock.ttlSeconds;
  }
  return DEFAULT_TTL;
}

export function getQueryTimeoutMs() {
  const config = loadTorchConfig();
  const envValue = process.env.NOSTR_LOCK_QUERY_TIMEOUT_MS;
  if (envValue) {
    const parsed = parseInt(envValue, 10);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  return config.nostrLock.queryTimeoutMs || DEFAULT_QUERY_TIMEOUT_MS;
}
