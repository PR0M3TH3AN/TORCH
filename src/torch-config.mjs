import fs from 'node:fs';
import path from 'node:path';

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
