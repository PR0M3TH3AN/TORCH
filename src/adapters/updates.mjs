import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { accessSync, constants, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { torchDataHome } from '../kernel/paths.mjs';
import { TorchError } from '../kernel/errors.mjs';

// Fixed official distribution names. Project input cannot supply npm packages,
// registries, scripts, prefixes or alternate update commands.
export const PROVIDER_PACKAGES = Object.freeze({
  codex: '@openai/codex', claude: '@anthropic-ai/claude-code',
  pi: '@earendil-works/pi-coding-agent',
});
const REGISTRY = 'https://registry.npmjs.org';
const VERSION = /^\d+\.\d+\.\d+$/;

function fail(message, details) {
  return new TorchError(message, { code: 'RUNTIME_UPDATE_FAILED', details });
}

function safePath(path) {
  let current = resolve(path);
  for (;;) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw fail('Provider store must not traverse symlink directories', { path: current });
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

export function providerStore(env = process.env) {
  return join(torchDataHome(env), 'provider-runtimes');
}

function pointer(root, name) { return join(root, `${name}.json`); }
function hash(path) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }

export function managedProvider(name, { env = process.env } = {}) {
  if (!Object.hasOwn(PROVIDER_PACKAGES, name)) return null;
  const root = providerStore(env);
  safePath(root);
  const path = pointer(root, name);
  if (!existsSync(path)) return null;
  safePath(path);
  let record;
  try { record = JSON.parse(readFileSync(path, 'utf8')); } catch {
    throw fail('Provider activation record is unreadable', { name });
  }
  const prefix = resolve(record.prefix ?? '');
  if (record.name !== name || record.package !== PROVIDER_PACKAGES[name]
    || !VERSION.test(record.version ?? '') || dirname(prefix) !== resolve(root)
    || !prefix.startsWith(join(root, `${name}-${record.version}-`))) {
    throw fail('Provider activation record is invalid', { name });
  }
  safePath(prefix);
  const executable = join(prefix, 'node_modules', '.bin', name);
  try {
    const target = realpathSync(executable);
    if (relative(prefix, target).startsWith(`..${sep}`) || !target.startsWith(`${prefix}${sep}`)) throw Error('outside prefix');
    accessSync(executable, constants.X_OK);
    if (hash(target) !== record.sha256) throw Error('changed executable');
  } catch {
    throw fail('Managed provider executable is missing or changed', { name, executable });
  }
  return { ...record, executable };
}

export function planProviderUpdates(names, { env = process.env } = {}) {
  return {
    action: 'provider-update', scope: 'torch-managed-only', registry: REGISTRY,
    providers: [...new Set(names)].map((name) => {
      if (!Object.hasOwn(PROVIDER_PACKAGES, name)) {
        throw fail('Automatic updates support only built-in providers', { name });
      }
      return { name, package: PROVIDER_PACKAGES[name], active: managedProvider(name, { env }) };
    }),
    root: providerStore(env), networkRequired: true, executesPackageInstallScripts: true,
    modifiesGlobalInstallations: false, mutationPerformed: false,
  };
}

export function updateProviders(names, { env = process.env, runner = spawnSync,
  authorized = false, force = false, maxAgeHours = 24, now = () => new Date() } = {}) {
  if (!authorized) throw new TorchError('Provider downloads require owner approval', { code: 'APPROVAL_REQUIRED' });
  if (!Number.isInteger(maxAgeHours) || maxAgeHours < 1 || maxAgeHours > 168) {
    throw fail('Provider freshness must be 1–168 hours');
  }
  const plan = planProviderUpdates(names, { env });
  safePath(plan.root);
  mkdirSync(plan.root, { recursive: true, mode: 0o700 });
  const lock = join(plan.root, 'update.lock');
  try { mkdirSync(lock); } catch {
    throw new TorchError('Provider update already running; inspect update.lock before recovery', { code: 'RUNTIME_UPDATE_BUSY' });
  }
  const run = (command, args, cwd, timeout) => {
    const result = runner(command, args, { cwd, env, encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'], timeout, maxBuffer: 8 * 1024 * 1024 });
    if (result.status !== 0 || result.error || result.signal) {
      throw fail('Provider update command failed; previous activation retained', {
        command, args, status: result.status, signal: result.signal,
        message: result.error?.message, stderr: String(result.stderr ?? '').slice(-2000),
      });
    }
    return String(result.stdout ?? '').trim();
  };
  const results = [];
  try {
    for (const provider of plan.providers) {
      const { name, package: pkg, active } = provider;
      const age = active ? now().getTime() - Date.parse(active.checkedAt) : NaN;
      if (!force && Number.isFinite(age) && age >= 0 && age < maxAgeHours * 3600000) {
        results.push({ ...active, outcome: 'fresh' }); continue;
      }
      const version = JSON.parse(run('npm', ['view', `${pkg}@latest`, 'version', '--json', '--registry', REGISTRY], plan.root, 30000));
      if (typeof version !== 'string' || !VERSION.test(version)) throw fail('Registry returned an invalid stable version', { name });
      let record = active;
      if (!active || active.version !== version) {
        const prefix = mkdtempSync(join(plan.root, `${name}-${version}-`));
        const args = ['install', '--prefix', prefix, '--no-audit', '--no-fund', '--save-exact', '--registry', REGISTRY];
        if (name === 'pi') args.push('--ignore-scripts');
        args.push(`${pkg}@${version}`);
        run('npm', args, prefix, 180000);
        const executable = join(prefix, 'node_modules', '.bin', name);
        const target = realpathSync(executable);
        if (!target.startsWith(`${prefix}${sep}`)) throw fail('Provider binary escaped its owned prefix', { name });
        const actual = run(executable, ['--version'], prefix, 20000);
        if (!actual.match(/\b\d+\.\d+\.\d+\b/) || actual.match(/\b\d+\.\d+\.\d+\b/)[0] !== version) {
          throw fail('Installed provider version does not match the resolved release', { name, expected: version, actual });
        }
        // Smoke-check parser startup before activation. Real model/account and
        // adapter-specific compatibility still require their own live gates.
        run(executable, ['--help'], prefix, 20000);
        record = { name, package: pkg, version, prefix, sha256: hash(target), previous: active?.prefix ?? null };
      }
      record = { ...record, checkedAt: now().toISOString() };
      const temporary = join(plan.root, `${name}-${randomUUID()}.tmp`);
      writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
      renameSync(temporary, pointer(plan.root, name));
      results.push({ ...managedProvider(name, { env }), outcome: active?.version === version ? 'current' : 'updated' });
    }
    return { ...plan, results, mutationPerformed: true };
  } finally {
    rmdirSync(lock);
  }
}
