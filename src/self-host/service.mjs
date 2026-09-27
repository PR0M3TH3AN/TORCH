import { createHash, randomUUID } from 'node:crypto';
import {
  cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync,
  renameSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { TorchError } from '../kernel/errors.mjs';
import { torchDataHome } from '../kernel/paths.mjs';

export const CANDIDATE_ACCEPTANCE_SCENARIOS = Object.freeze([
  'init-analyze',
  'spec-aware-design',
  'ai-fleet-bootstrap',
  'review-install-roster',
  'branches-worktrees',
  'runtime-identities',
  'durable-messaging',
  'ownership-query',
  'unsafe-worktree-detection',
  'backlog-integration',
  'resource-lifecycle',
  'capture-stop-resume',
  'detach-uninstall',
  'combatrig-compatibility',
  'product-surface',
  'operations-observability',
]);

function json(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch (error) {
    throw new TorchError(`Cannot read ${path}`, { code: 'SELF_HOST_METADATA_INVALID', details: error.message });
  }
}

function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  renameSync(temporary, path);
}

function validVersion(version) {
  return typeof version === 'string'
    && /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version);
}

function inside(parent, child) {
  const root = `${resolve(parent)}${sep}`;
  return resolve(child).startsWith(root);
}

function inventory(root, { excludeValidation = false } = {}) {
  const records = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === '.git') continue;
      const path = join(directory, entry.name);
      const name = relative(root, path);
      if (excludeValidation && name === '.torch-validation.json') continue;
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) {
        throw new TorchError(`Candidate artifacts may not contain symbolic links: ${name}`, {
          code: 'CANDIDATE_SYMLINK_REFUSED', details: { path: name },
        });
      }
      if (stat.isDirectory()) visit(path);
      else if (stat.isFile()) records.push({ path: name, bytes: stat.size });
      else throw new TorchError(`Unsupported candidate artifact entry: ${name}`, {
        code: 'CANDIDATE_ENTRY_REFUSED', details: { path: name },
      });
    }
  };
  visit(root);
  return records;
}

function treeHash(root, records) {
  const digest = createHash('sha256');
  for (const record of records) {
    digest.update(record.path).update('\0').update(readFileSync(join(root, record.path))).update('\0');
  }
  return digest.digest('hex');
}

function validateReleaseMetadata(root, requestedVersion) {
  const packagePath = join(root, 'package.json');
  const releasePath = join(root, 'torch-release.json');
  if (!existsSync(packagePath) || !existsSync(releasePath)) {
    throw new TorchError('Candidate requires package.json and torch-release.json', {
      code: 'CANDIDATE_METADATA_MISSING', details: { packagePath, releasePath },
    });
  }
  const packageMetadata = json(packagePath);
  const release = json(releasePath);
  const version = requestedVersion ?? release.version ?? packageMetadata.version;
  if (!validVersion(version) || packageMetadata.version !== version || release.version !== version) {
    throw new TorchError('Candidate version metadata does not agree', {
      code: 'CANDIDATE_VERSION_INVALID',
      details: { requestedVersion, packageVersion: packageMetadata.version, releaseVersion: release.version },
    });
  }
  if (release.schema !== 'torch.dev/release/v1alpha1'
    || !Array.isArray(release.state?.reads)
    || typeof release.state?.writes !== 'string'
    || release.state?.rollback_safe !== true) {
    throw new TorchError('Candidate state compatibility declaration is incomplete or not rollback-safe', {
      code: 'CANDIDATE_COMPATIBILITY_INVALID', details: release.state ?? null,
    });
  }
  const bin = typeof packageMetadata.bin === 'string' ? packageMetadata.bin : packageMetadata.bin?.torch;
  if (!bin || !existsSync(join(root, bin))) {
    throw new TorchError('Candidate package has no runnable TORCH binary', {
      code: 'CANDIDATE_BINARY_MISSING', details: { bin: bin ?? null },
    });
  }
  return { version, packageMetadata, release, bin };
}

function completeAcceptance(result) {
  const completed = new Set(result?.scenarios ?? []);
  return result?.passed === true
    && CANDIDATE_ACCEPTANCE_SCENARIOS.every((scenario) => completed.has(scenario));
}

export class VersionService {
  constructor({ env = process.env, now = () => new Date(), afterPointerSwap = null } = {}) {
    this.root = join(torchDataHome(env), 'runtime');
    this.versionsRoot = join(this.root, 'versions');
    this.activePath = join(this.root, 'active');
    this.registryPath = join(this.root, 'registry.json');
    this.journalPath = join(this.root, 'activation-journal.json');
    this.now = now;
    this.afterPointerSwap = afterPointerSwap;
  }

  planCandidate({ source, version } = {}) {
    const sourceRoot = resolve(source ?? '');
    if (!existsSync(sourceRoot) || !lstatSync(sourceRoot).isDirectory()) {
      throw new TorchError('Candidate source must be an existing directory', {
        code: 'CANDIDATE_SOURCE_INVALID', details: { source: sourceRoot },
      });
    }
    if (inside(sourceRoot, this.root) || inside(this.root, sourceRoot) || resolve(sourceRoot) === resolve(this.root)) {
      throw new TorchError('Candidate source and version store must be separate', {
        code: 'CANDIDATE_NAMESPACE_COLLISION', details: { source: sourceRoot, store: this.root },
      });
    }
    const metadata = validateReleaseMetadata(sourceRoot, version);
    const records = inventory(sourceRoot);
    if (records.some((record) => record.path === '.torch-validation.json')) {
      throw new TorchError('Candidate source contains TORCH-owned validation state', {
        code: 'CANDIDATE_RESERVED_FILE', details: { path: '.torch-validation.json' },
      });
    }
    const destination = join(this.versionsRoot, metadata.version);
    return {
      action: 'candidate-install', source: sourceRoot, destination, version: metadata.version,
      digest: treeHash(sourceRoot, records), files: records.length,
      bytes: records.reduce((total, record) => total + record.bytes, 0),
      compatibility: metadata.release.state,
      conflicts: existsSync(destination) ? [{ code: 'VERSION_ALREADY_INSTALLED', version: metadata.version }] : [],
      mutationPerformed: false,
    };
  }

  installCandidate({ source, version, validate } = {}) {
    if (typeof validate !== 'function') {
      throw new TorchError('Candidate installation requires an acceptance validator', {
        code: 'CANDIDATE_VALIDATOR_REQUIRED',
      });
    }
    const plan = this.planCandidate({ source, version });
    if (plan.conflicts.length) {
      throw new TorchError('Candidate installation has conflicts', {
        code: 'CANDIDATE_INSTALL_CONFLICT', details: plan.conflicts,
      });
    }
    mkdirSync(this.versionsRoot, { recursive: true });
    const staging = join(this.versionsRoot, `.candidate-${plan.version}-${randomUUID()}`);
    try {
      cpSync(plan.source, staging, {
        recursive: true, errorOnExist: true, force: false,
        filter: (path) => basename(path) !== '.git',
      });
      validateReleaseMetadata(staging, plan.version);
      const copiedRecords = inventory(staging);
      const copiedDigest = treeHash(staging, copiedRecords);
      if (copiedDigest !== plan.digest) {
        throw new TorchError('Candidate changed while it was being staged', {
          code: 'CANDIDATE_CHANGED_DURING_COPY', details: { before: plan.digest, after: copiedDigest },
        });
      }
      const acceptance = validate({ candidateRoot: staging, version: plan.version });
      if (!completeAcceptance(acceptance)) {
        throw new TorchError('Candidate did not complete the required acceptance scenarios', {
          code: 'CANDIDATE_ACCEPTANCE_FAILED',
          details: { required: CANDIDATE_ACCEPTANCE_SCENARIOS, result: acceptance ?? null },
        });
      }
      atomicJson(join(staging, '.torch-validation.json'), {
        schema: 'torch.dev/candidate-validation/v1alpha1', version: plan.version,
        digest: plan.digest, validatedAt: this.now().toISOString(),
        scenarios: CANDIDATE_ACCEPTANCE_SCENARIOS, evidence: acceptance.evidence ?? [], passed: true,
      });
      renameSync(staging, plan.destination);
      return { ...plan, validation: join(plan.destination, '.torch-validation.json'), mutationPerformed: true };
    } catch (error) {
      if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
      throw error;
    }
  }

  #activeVersion() {
    if (!existsSync(this.activePath)) return null;
    try { return basename(resolve(dirname(this.activePath), readlinkSync(this.activePath))); } catch { return null; }
  }

  #registry() {
    return existsSync(this.registryPath) ? json(this.registryPath) : {
      schema: 'torch.dev/version-registry/v1alpha1', activeVersion: null, previousVersion: null,
      generation: 0, updatedAt: null,
    };
  }

  #reconcile() {
    if (!existsSync(this.journalPath)) return;
    const journal = json(this.journalPath);
    const activeVersion = this.#activeVersion();
    const registry = this.#registry();
    if (activeVersion === journal.to) {
      atomicJson(this.registryPath, {
        ...registry, activeVersion: journal.to, previousVersion: journal.from,
        generation: registry.generation + 1, updatedAt: this.now().toISOString(),
      });
    } else if (activeVersion !== journal.from) {
      throw new TorchError('Activation journal does not match the active version pointer', {
        code: 'ACTIVATION_JOURNAL_INCONSISTENT', details: { journal, activeVersion },
      });
    }
    rmSync(this.journalPath, { force: true });
  }

  status() {
    this.#reconcile();
    const registry = this.#registry();
    const activeVersion = this.#activeVersion();
    const installed = existsSync(this.versionsRoot)
      ? readdirSync(this.versionsRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.candidate-'))
        .map((entry) => entry.name).sort()
      : [];
    return {
      root: this.root, activeVersion, previousVersion: registry.previousVersion,
      generation: registry.generation, installed,
      consistent: activeVersion === registry.activeVersion,
    };
  }

  activate(version) {
    if (!validVersion(version)) throw new TorchError('Invalid TORCH version', { code: 'VERSION_INVALID' });
    mkdirSync(this.root, { recursive: true });
    this.#reconcile();
    const destination = join(this.versionsRoot, version);
    const validationPath = join(destination, '.torch-validation.json');
    if (!existsSync(destination) || !existsSync(validationPath) || json(validationPath).passed !== true) {
      throw new TorchError('Only an installed, accepted candidate may become active', {
        code: 'CANDIDATE_NOT_ACCEPTED', details: { version },
      });
    }
    const validation = json(validationPath);
    const installedDigest = treeHash(destination, inventory(destination, { excludeValidation: true }));
    if (validation.digest !== installedDigest) {
      throw new TorchError('Accepted candidate contents changed after validation', {
        code: 'CANDIDATE_VALIDATION_STALE',
        details: { version, expected: validation.digest, actual: installedDigest },
      });
    }
    const candidate = validateReleaseMetadata(destination, version).release;
    const from = this.#activeVersion();
    if (from === version) return { ...this.status(), changed: false, mutationPerformed: false };
    if (from) {
      const current = validateReleaseMetadata(join(this.versionsRoot, from), from).release;
      if (!candidate.state.reads.includes(current.state.writes)
        || candidate.state.writes !== current.state.writes
        || current.state.rollback_safe !== true) {
        throw new TorchError('Candidate is not forward-and-rollback compatible with the active version', {
          code: 'STATE_COMPATIBILITY_REFUSED', details: { from, to: version },
        });
      }
    }
    atomicJson(this.journalPath, {
      schema: 'torch.dev/activation-journal/v1alpha1', from, to: version, startedAt: this.now().toISOString(),
    });
    const temporary = `${this.activePath}.tmp-${process.pid}-${randomUUID()}`;
    symlinkSync(relative(this.root, destination), temporary, 'dir');
    renameSync(temporary, this.activePath);
    this.afterPointerSwap?.({ from, to: version });
    this.#reconcile();
    return { ...this.status(), changed: true, mutationPerformed: true };
  }

  rollback() {
    const status = this.status();
    if (!status.previousVersion) {
      throw new TorchError('No previously active TORCH version is available', { code: 'ROLLBACK_UNAVAILABLE' });
    }
    return this.activate(status.previousVersion);
  }
}

export function createVersionService(options) {
  return new VersionService(options);
}
