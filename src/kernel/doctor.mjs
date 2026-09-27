import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileHash } from './files.mjs';
import { projectStatePath } from './paths.mjs';

function parseJsonYaml(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function diagnoseProject({ repository, env = process.env }) {
  const trackedRoot = join(repository.root, '.torch');
  const configPath = join(trackedRoot, 'torch.yaml');
  const manifestPath = join(trackedRoot, 'install-manifest.json');
  const findings = [];

  if (!existsSync(configPath)) {
    return { status: 'not-installed', healthy: false, findings: [{ severity: 'error', code: 'CONFIG_MISSING', path: configPath }] };
  }
  if (!existsSync(manifestPath)) {
    return { status: 'broken', healthy: false, findings: [{ severity: 'error', code: 'MANIFEST_MISSING', path: manifestPath }] };
  }

  let config;
  let manifest;
  try { config = parseJsonYaml(configPath); } catch (error) {
    findings.push({ severity: 'error', code: 'CONFIG_INVALID', message: error.message });
  }
  try { manifest = parseJsonYaml(manifestPath); } catch (error) {
    findings.push({ severity: 'error', code: 'MANIFEST_INVALID', message: error.message });
  }

  if (manifest) {
    for (const record of manifest.created ?? []) {
      const path = join(repository.root, record.path);
      if (!existsSync(path)) findings.push({ severity: 'error', code: 'OWNED_FILE_MISSING', path: record.path });
      else if (fileHash(path) !== record.sha256) findings.push({ severity: 'info', code: 'OWNED_FILE_MODIFIED', path: record.path });
    }
    const stateRoot = projectStatePath(manifest.projectId, env);
    if (!existsSync(stateRoot)) findings.push({ severity: 'error', code: 'LOCAL_STATE_MISSING', path: stateRoot });
  }

  if (config?.project?.id && manifest?.projectId && config.project.id !== manifest.projectId) {
    findings.push({ severity: 'error', code: 'PROJECT_ID_MISMATCH' });
  }
  if (repository.dirtyEntries.length) {
    findings.push({ severity: 'info', code: 'WORKTREE_DIRTY', count: repository.dirtyEntries.length });
  }

  return {
    status: findings.some((finding) => finding.severity === 'error') ? 'broken' : 'ok',
    healthy: !findings.some((finding) => finding.severity === 'error'),
    projectId: config?.project?.id ?? null,
    findings,
  };
}
