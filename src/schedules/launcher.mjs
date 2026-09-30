import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { TorchError } from '../kernel/errors.mjs';
import { readInstallManifest, writeInstallManifest } from '../kernel/install.mjs';
import { loadProjectConfig } from '../kernel/config.mjs';

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function unitQuote(value) {
  return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function configPath(repositoryRoot) {
  return join(repositoryRoot, '.torch', 'torch.yaml');
}

export function scheduleConfigDigest(repositoryRoot) {
  return sha256(readFileSync(configPath(repositoryRoot)));
}

function unitDirectory(env) {
  return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'systemd', 'user');
}

function render({ repositoryRoot, projectId, command, digest, env }) {
  const base = `torch-${projectId}-schedules`;
  const serviceName = `${base}.service`;
  const timerName = `${base}.timer`;
  const directory = unitDirectory(env);
  const args = [
    ...command, 'schedules', 'dispatch-system', '--launcher-digest', digest, '--yes', '--json',
  ];
  const environment = env.XDG_DATA_HOME
    ? `Environment=${unitQuote(`XDG_DATA_HOME=${resolve(env.XDG_DATA_HOME)}`)}\n` : '';
  const service = [
    '[Unit]', `Description=TORCH system schedules for ${projectId}`, '', '[Service]', 'Type=oneshot',
    `WorkingDirectory=${unitQuote(repositoryRoot)}`, environment.trimEnd(),
    `ExecStart=${args.map(unitQuote).join(' ')}`, '',
  ].filter((line) => line !== '').join('\n') + '\n';
  const timer = [
    '[Unit]', `Description=Dispatch TORCH system schedules for ${projectId}`, '', '[Timer]',
    'OnCalendar=*-*-* *:*:00', 'Persistent=true', `Unit=${serviceName}`, '', '[Install]',
    'WantedBy=timers.target', '',
  ].join('\n');
  return {
    serviceName, timerName, directory,
    files: [
      { name: serviceName, path: join(directory, serviceName), content: service },
      { name: timerName, path: join(directory, timerName), content: timer },
    ],
  };
}

function runSystemctl(executor, args) {
  const result = executor('systemctl', ['--user', ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: false,
  });
  if (result.status !== 0 || result.error) {
    throw new TorchError(`systemctl --user ${args.join(' ')} failed`, {
      code: 'SCHEDULE_LAUNCHER_SYSTEMD_FAILED', details: result.stderr?.toString().trim() || result.error?.message,
    });
  }
}

export class ScheduleLauncherService {
  constructor({
    repositoryRoot, env = process.env, command,
    executor = (file, args, options) => spawnSync(file, args, options),
  } = {}) {
    this.repositoryRoot = resolve(repositoryRoot);
    this.env = env;
    this.command = command ?? [process.execPath, new URL('../../bin/torch.mjs', import.meta.url).pathname];
    this.executor = executor;
  }

  plan() {
    const config = loadProjectConfig(this.repositoryRoot);
    const manifest = readInstallManifest(this.repositoryRoot);
    const systemSchedules = config.schedules.filter((schedule) => schedule.lifetime === 'system');
    const digest = scheduleConfigDigest(this.repositoryRoot);
    const rendered = render({
      repositoryRoot: this.repositoryRoot, projectId: manifest.projectId,
      command: this.command, digest, env: this.env,
    });
    const blockers = [];
    if (!systemSchedules.length) blockers.push({ code: 'NO_SYSTEM_SCHEDULES' });
    for (const file of rendered.files) if (existsSync(file.path)) blockers.push({ code: 'LAUNCHER_PATH_EXISTS', path: file.path });
    return {
      action: 'install-system-schedule-launcher', projectId: manifest.projectId,
      systemSchedules: systemSchedules.map((schedule) => schedule.id), digest,
      ...rendered, blockers, canProceed: blockers.length === 0, mutationPerformed: false,
    };
  }

  install({ expectedDigest } = {}) {
    const plan = this.plan();
    if (expectedDigest && plan.digest !== expectedDigest) {
      throw new TorchError('System schedule configuration changed after review', {
        code: 'SCHEDULE_LAUNCHER_PLAN_STALE', details: { expected: expectedDigest, actual: plan.digest },
      });
    }
    if (!plan.canProceed) throw new TorchError('System schedule launcher installation is blocked', {
      code: 'SCHEDULE_LAUNCHER_BLOCKED', details: plan.blockers,
    });
    const manifest = readInstallManifest(this.repositoryRoot);
    const originalManifest = structuredClone(manifest);
    const created = [];
    try {
      mkdirSync(plan.directory, { recursive: true });
      for (const file of plan.files) {
        const temporary = `${file.path}.tmp-${process.pid}`;
        writeFileSync(temporary, file.content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        renameSync(temporary, file.path);
        created.push(file.path);
        manifest.external.push({
          type: 'systemd-user-unit', name: file.name, path: file.path,
          sha256: sha256(file.content), configDigest: plan.digest,
        });
      }
      writeInstallManifest(this.repositoryRoot, manifest);
      runSystemctl(this.executor, ['daemon-reload']);
      runSystemctl(this.executor, ['enable', '--now', plan.timerName]);
      return { ...plan, mutationPerformed: true, requiresCommit: ['.torch/install-manifest.json'] };
    } catch (error) {
      try { runSystemctl(this.executor, ['disable', '--now', plan.timerName]); } catch { /* best-effort rollback */ }
      for (const path of created.reverse()) if (existsSync(path)) rmSync(path);
      writeInstallManifest(this.repositoryRoot, originalManifest);
      throw error;
    }
  }

  planReconcile() {
    const config = loadProjectConfig(this.repositoryRoot);
    const manifest = readInstallManifest(this.repositoryRoot);
    const installed = (manifest.external ?? []).filter((entry) => entry.type === 'systemd-user-unit');
    const digest = scheduleConfigDigest(this.repositoryRoot);
    const rendered = render({
      repositoryRoot: this.repositoryRoot, projectId: manifest.projectId,
      command: this.command, digest, env: this.env,
    });
    const blockers = [];
    if (!config.schedules.some((schedule) => schedule.lifetime === 'system')) {
      blockers.push({ code: 'NO_SYSTEM_SCHEDULES' });
    }
    if (!installed.length) blockers.push({ code: 'LAUNCHER_NOT_INSTALLED' });
    for (const file of rendered.files) {
      const record = installed.find((entry) => entry.name === file.name && resolve(entry.path) === resolve(file.path));
      if (!record) {
        blockers.push({ code: 'LAUNCHER_OWNERSHIP_MISMATCH', path: file.path });
        continue;
      }
      if (!existsSync(file.path)) {
        blockers.push({ code: 'LAUNCHER_FILE_MISSING', path: file.path });
      } else if (sha256(readFileSync(file.path)) !== record.sha256) {
        blockers.push({ code: 'LAUNCHER_FILE_MODIFIED', path: file.path });
      }
    }
    for (const record of installed) {
      if (!rendered.files.some((file) => file.name === record.name && resolve(file.path) === resolve(record.path))) {
        blockers.push({ code: 'LAUNCHER_OWNERSHIP_MISMATCH', path: record.path });
      }
    }
    const updates = rendered.files.map((file) => ({
      name: file.name, path: file.path,
      changed: !existsSync(file.path) || readFileSync(file.path, 'utf8') !== file.content,
    }));
    const stale = installed.some((entry) => entry.configDigest !== digest);
    return {
      action: 'reconcile-system-schedule-launcher', projectId: manifest.projectId,
      digest, currentConfigDigest: digest,
      installedConfigDigests: [...new Set(installed.map((entry) => entry.configDigest))],
      systemSchedules: config.schedules.filter((schedule) => schedule.lifetime === 'system').map((schedule) => schedule.id),
      ...rendered, updates, stale,
      blockers, canProceed: blockers.length === 0,
      mutationPerformed: false,
    };
  }

  reconcile({ expectedDigest } = {}) {
    const plan = this.planReconcile();
    if (expectedDigest && plan.digest !== expectedDigest) {
      throw new TorchError('System schedule configuration changed after review', {
        code: 'SCHEDULE_LAUNCHER_PLAN_STALE', details: { expected: expectedDigest, actual: plan.digest },
      });
    }
    if (!plan.canProceed) throw new TorchError('System schedule launcher reconciliation is blocked', {
      code: 'SCHEDULE_LAUNCHER_RECONCILE_BLOCKED', details: plan.blockers,
    });
    if (!plan.stale && !plan.updates.some((entry) => entry.changed)) {
      return { ...plan, changed: false, mutationPerformed: false };
    }
    const manifest = readInstallManifest(this.repositoryRoot);
    const originalManifest = structuredClone(manifest);
    const previous = new Map(plan.files.map((file) => [file.path, readFileSync(file.path, 'utf8')]));
    try {
      for (const file of plan.files) {
        const temporary = `${file.path}.tmp-${process.pid}-${randomUUID()}`;
        writeFileSync(temporary, file.content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        renameSync(temporary, file.path);
      }
      for (const record of manifest.external ?? []) {
        if (record.type !== 'systemd-user-unit') continue;
        const replacement = plan.files.find((file) => file.name === record.name && resolve(file.path) === resolve(record.path));
        record.sha256 = sha256(replacement.content);
        record.configDigest = plan.digest;
      }
      writeInstallManifest(this.repositoryRoot, manifest);
      runSystemctl(this.executor, ['daemon-reload']);
      runSystemctl(this.executor, ['enable', '--now', plan.timerName]);
      return { ...plan, changed: true, mutationPerformed: true, requiresCommit: ['.torch/install-manifest.json'] };
    } catch (error) {
      for (const [path, content] of previous) {
        try {
          const temporary = `${path}.rollback-${process.pid}-${randomUUID()}`;
          writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
          renameSync(temporary, path);
        } catch { /* preserve the original failure; status will expose drift */ }
      }
      writeInstallManifest(this.repositoryRoot, originalManifest);
      try { runSystemctl(this.executor, ['daemon-reload']); } catch { /* best-effort restore the loaded units */ }
      throw error;
    }
  }

  status() {
    const manifest = readInstallManifest(this.repositoryRoot);
    const units = (manifest.external ?? []).filter((entry) => entry.type === 'systemd-user-unit');
    return {
      installed: units.length > 0,
      units: units.map((entry) => ({ ...entry, exists: existsSync(entry.path) })),
      currentConfigDigest: scheduleConfigDigest(this.repositoryRoot),
      stale: units.some((entry) => entry.configDigest !== scheduleConfigDigest(this.repositoryRoot)
        || !existsSync(entry.path) || sha256(readFileSync(entry.path)) !== entry.sha256),
      mutationPerformed: false,
    };
  }

  planRemoval() {
    const manifest = readInstallManifest(this.repositoryRoot);
    const units = (manifest.external ?? []).filter((entry) => entry.type === 'systemd-user-unit');
    const blockers = units
      .filter((entry) => !existsSync(entry.path) || sha256(readFileSync(entry.path)) !== entry.sha256)
      .map((entry) => ({ code: 'SCHEDULE_LAUNCHER_MODIFIED', path: entry.path }));
    return {
      action: 'remove-system-schedule-launcher',
      units: units.map((entry) => ({ name: entry.name, path: entry.path })),
      blockers, canProceed: blockers.length === 0, mutationPerformed: false,
    };
  }

  remove() {
    const plan = this.planRemoval();
    if (!plan.canProceed) throw new TorchError('Refusing to remove changed or missing system schedule launcher files', {
      code: 'SCHEDULE_LAUNCHER_MODIFIED', details: plan.blockers.map((blocker) => blocker.path),
    });
    const manifest = readInstallManifest(this.repositoryRoot);
    const units = (manifest.external ?? []).filter((entry) => entry.type === 'systemd-user-unit');
    if (!units.length) return { removed: [], changed: false, mutationPerformed: false };
    const timer = units.find((entry) => entry.name.endsWith('.timer'));
    if (timer) runSystemctl(this.executor, ['disable', '--now', timer.name]);
    for (const entry of units) rmSync(entry.path);
    manifest.external = manifest.external.filter((entry) => entry.type !== 'systemd-user-unit');
    writeInstallManifest(this.repositoryRoot, manifest);
    runSystemctl(this.executor, ['daemon-reload']);
    return {
      removed: units.map((entry) => entry.path), changed: true, mutationPerformed: true,
      requiresCommit: ['.torch/install-manifest.json'],
    };
  }
}

export function assertLauncherDigest(repositoryRoot, expected) {
  const actual = scheduleConfigDigest(repositoryRoot);
  if (!expected || expected !== actual) throw new TorchError('System schedule launcher is stale for the tracked configuration', {
    code: 'SCHEDULE_LAUNCHER_STALE', details: { expected: expected ?? null, actual },
  });
  return actual;
}
