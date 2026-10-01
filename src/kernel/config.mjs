import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { TorchError } from './errors.mjs';
import { organizationGraphFromConfig, organizationGraphSchema } from './organization.mjs';

export const PROJECT_CONFIG_SCHEMA = 'torch.dev/v1alpha1';
export const CANDIDATE_EXECUTION_POLICY_V2_SCHEMA = 'torch.dev/candidate-execution-policy/v2alpha1';
export const CANDIDATE_EXECUTION_POLICY_V2_VERSION = 2;
export const CANDIDATE_EXECUTION_POLICY_V2_MAX_FRAME_BYTES = 1024 * 1024;
export const CANDIDATE_EXECUTION_POLICY_V2_MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024;
export const CANDIDATE_EXECUTION_POLICY_V2_MAX_SNAPSHOT_TOTAL_BYTES = 512 * 1024 * 1024;
export const CANDIDATE_EXECUTION_POLICY_V2_MAX_RECORDS = 8192;
export const CANDIDATE_EXECUTION_POLICY_V2_MAX_PATH_UTF8_BYTES = 4096;

const text = z.string().trim().min(1);
const id = text.regex(/^[a-z0-9][a-z0-9-]*$/);
const textList = z.array(text);
const launchPolicy = z.record(z.string().regex(/^[a-z][A-Za-z0-9]*$/), text).optional();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const relativePath = z.string().min(1).max(1024).regex(/^(?!\/)(?!.*(?:^|\/)\.\.?\/)[A-Za-z0-9._/@+:*?-]+$/);
const environmentName = z.string().regex(/^[A-Z_][A-Z0-9_]*$/);

const candidateExecutionPolicyV2 = z.object({
  schema: z.literal(CANDIDATE_EXECUTION_POLICY_V2_SCHEMA),
  version: z.literal(CANDIDATE_EXECUTION_POLICY_V2_VERSION),
  check_id: id,
  registered_definition_sha256: sha256,
  package_json_path: z.literal('package.json'),
  package_script_name: z.string().min(1).max(256).regex(/^[A-Za-z0-9:_-]+$/),
  package_script_raw: z.string().min(1).max(64 * 1024),
  input_rules: z.object({
    allowSpecial: z.literal(false),
    allowSymlinks: z.literal(false),
    exclude: z.array(relativePath).max(CANDIDATE_EXECUTION_POLICY_V2_MAX_RECORDS),
    include: z.array(relativePath).min(1).max(CANDIDATE_EXECUTION_POLICY_V2_MAX_RECORDS),
    roots: z.array(relativePath).min(1).max(CANDIDATE_EXECUTION_POLICY_V2_MAX_RECORDS),
  }).strict(),
  environment_allowlist: z.array(environmentName).max(128),
  runtime_manifest: z.object({
    browser: z.null(),
    dependencies: z.array(z.object({
      realpath: z.string().min(1).max(CANDIDATE_EXECUTION_POLICY_V2_MAX_PATH_UTF8_BYTES),
      bytes: z.number().int().min(0).max(1024 * 1024 * 1024),
      sha256,
    }).strict()).max(CANDIDATE_EXECUTION_POLICY_V2_MAX_RECORDS),
    node: z.object({
      entryBytes: z.number().int().min(0).max(1024 * 1024 * 1024),
      entrySha256: sha256,
      entryUtf8: z.string().max(CANDIDATE_EXECUTION_POLICY_V2_MAX_FRAME_BYTES).optional(),
      realpath: z.string().min(1).max(CANDIDATE_EXECUTION_POLICY_V2_MAX_PATH_UTF8_BYTES),
    }).strict(),
    npm: z.object({
      entryBytes: z.number().int().min(0).max(1024 * 1024 * 1024),
      entrySha256: sha256,
      entryUtf8: z.string().max(CANDIDATE_EXECUTION_POLICY_V2_MAX_FRAME_BYTES).optional(),
      realpath: z.string().min(1).max(CANDIDATE_EXECUTION_POLICY_V2_MAX_PATH_UTF8_BYTES),
    }).strict(),
    packageJson: z.object({
      bytes: z.number().int().min(0).max(CANDIDATE_EXECUTION_POLICY_V2_MAX_FRAME_BYTES),
      sha256,
      utf8: z.string().max(CANDIDATE_EXECUTION_POLICY_V2_MAX_FRAME_BYTES).optional(),
    }).strict(),
    packageLock: z.null(),
  }).strict(),
  limits: z.object({
    maxFileBytes: z.literal(CANDIDATE_EXECUTION_POLICY_V2_MAX_SNAPSHOT_BYTES),
    maxFrameBytes: z.literal(CANDIDATE_EXECUTION_POLICY_V2_MAX_FRAME_BYTES),
    maxPathUtf8Bytes: z.literal(CANDIDATE_EXECUTION_POLICY_V2_MAX_PATH_UTF8_BYTES),
    maxRecords: z.literal(CANDIDATE_EXECUTION_POLICY_V2_MAX_RECORDS),
    maxTotalBytes: z.literal(CANDIDATE_EXECUTION_POLICY_V2_MAX_SNAPSHOT_TOTAL_BYTES),
  }).strict(),
}).strict().superRefine((value, context) => {
  if (new Set(value.input_rules.include).size !== value.input_rules.include.length) {
    context.addIssue({ code: 'custom', path: ['input_rules', 'include'], message: 'input include paths must be unique' });
  }
  if (new Set(value.input_rules.exclude).size !== value.input_rules.exclude.length) {
    context.addIssue({ code: 'custom', path: ['input_rules', 'exclude'], message: 'input exclude paths must be unique' });
  }
  if (new Set(value.environment_allowlist).size !== value.environment_allowlist.length) {
    context.addIssue({ code: 'custom', path: ['environment_allowlist'], message: 'environment names must be unique' });
  }
  if (new Set(value.input_rules.roots).size !== value.input_rules.roots.length) {
    context.addIssue({ code: 'custom', path: ['input_rules', 'roots'], message: 'input roots must be unique' });
  }
  for (const name of ['node', 'npm']) {
    const entry = value.runtime_manifest[name];
    if (entry.entryUtf8 !== undefined) {
      const bytes = Buffer.from(entry.entryUtf8, 'utf8');
      const entryDigest = createHash('sha256').update(bytes).digest('hex');
      if (bytes.length !== entry.entryBytes || entryDigest !== entry.entrySha256) {
        context.addIssue({ code: 'custom', path: ['runtime_manifest', name, 'entryUtf8'], message: 'runtime entryUtf8 must match its declared entryBytes and entrySha256' });
      }
    }
  }
  const packageJson = value.runtime_manifest.packageJson;
  if (packageJson.utf8 !== undefined) {
    const bytes = Buffer.from(packageJson.utf8, 'utf8');
    const packageDigest = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== packageJson.bytes || packageDigest !== packageJson.sha256) {
      context.addIssue({ code: 'custom', path: ['runtime_manifest', 'packageJson', 'utf8'], message: 'package json utf8 must match its declared bytes and sha256' });
    }
  }
});

const domain = z.object({
  id,
  title: text,
  kind: text.optional(),
  scope: textList.min(1),
  not_scope: textList,
  owned_paths: textList.min(1),
  shared_paths: textList,
  neighbours: textList,
  required_checks: textList,
  resources: textList,
  runtime: text,
  model: text.nullable().optional(),
  reasoning: text.nullable().optional(),
  launchPolicy,
  branch: text.nullable().optional(),
  worktree_name: text.regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/).nullable().optional(),
}).strict();

const check = z.object({
  id,
  title: text.optional(),
  command: text,
  args: textList.optional(),
  source: z.record(z.string(), z.unknown()).optional(),
  candidate_execution_policy: candidateExecutionPolicyV2.optional(),
  resources: textList.optional(),
  snapshot: z.object({
    paths: textList.min(1),
    source_commit_file: text,
  }).strict().optional(),
  conditions: z.object({
    command: text,
    args: textList.optional(),
    timeout_seconds: z.number().int().positive().max(300).optional(),
    required: z.array(z.object({
      id,
      equals: z.union([z.string(), z.boolean(), z.number().finite(), z.null()]),
    }).strict()).min(1).refine((requirements) =>
      new Set(requirements.map((requirement) => requirement.id)).size === requirements.length,
    'Condition IDs must be unique'),
  }).strict().optional(),
}).strict();

const resource = z.object({
  id,
  capacity: z.number().int().positive(),
  queue: z.literal('fifo'),
  max_hold_seconds: z.number().int().positive().optional(),
  evidence: text.optional(),
}).strict();

const schedule = z.object({
  id,
  title: text.optional(),
  owner: text,
  lifetime: z.enum(['system', 'session']),
  trigger: z.discriminatedUnion('type', [
    z.object({ type: z.literal('manual') }).strict(),
    z.object({ type: z.literal('interval'), seconds: z.number().int().positive() }).strict(),
    z.object({ type: z.literal('cron'), expression: text }).strict(),
  ]),
  behavior: z.enum(['read-only', 'coordination', 'mutating']),
  action: z.discriminatedUnion('type', [
    z.object({ type: z.literal('command'), command: text, args: textList }).strict(),
    z.object({
      type: z.literal('manager-check-in'), manager_id: id,
      stale_work: z.object({
        stale_days: z.number().int().min(1).max(365).optional(),
        max_commits: z.number().int().min(1).max(10_000).optional(),
        max_items: z.number().int().min(1).max(100).optional(),
      }).strict().optional(),
      wake: z.object({
        enabled: z.boolean(),
        budget_mode: z.enum(['invocation-count', 'usd-hard-cap']).optional(),
        max_usd_per_invocation: z.number().finite().positive().optional(),
      }).strict().optional(),
    }).strict(),
    z.object({
      type: z.literal('integration-drain'), landing_authority_id: id,
      limit: z.number().int().min(1).max(500).optional(),
    }).strict(),
    z.object({ type: z.literal('owner-digest') }).strict(),
  ]),
  required_authority: textList.min(1),
  retry: z.object({ max_attempts: z.number().int().min(1).max(10) }).strict().optional(),
  failure_recipient: text.optional(),
  source_of_truth: text,
  detected: z.boolean().optional(),
}).strict();

export const projectConfigSchema = z.object({
  schema: z.literal(PROJECT_CONFIG_SCHEMA),
  project: z.object({ id, name: text, main_branch: text }).strict(),
  paths: z.object({ tracked_state: z.literal('.torch'), worktree_parent: text }).strict(),
  repository: z.object({
    canonical: z.discriminatedUnion('type', [
      z.object({ type: z.literal('unconfigured') }).strict(),
      z.object({ type: z.literal('remote'), remote: text }).strict(),
      z.object({ type: z.literal('local'), remote: text, path: text }).strict(),
    ]),
  }).strict(),
  forge: z.object({ provider: text }).passthrough(),
  git: z.object({
    branch_prefix: text,
    convergence: z.literal('merge'),
    allow_rebase: z.literal(false),
    allow_force_push: z.literal(false),
    allow_bare_stash: z.literal(false),
  }).strict(),
  synchronization: z.object({
    strategy: text,
    auto_merge_worktrees: z.literal(false),
  }).passthrough(),
  runtimes: z.record(z.string(), z.unknown()).refine((value) => typeof value.default === 'string', {
    message: 'runtimes.default must name a configured runtime',
  }),
  checks: z.array(check),
  backlog: z.object({
    self_claim: z.object({ enabled: z.boolean(), areas: textList }).strict().optional(),
    activity: z.object({
      stale_days: z.number().int().min(1).max(365).optional(),
      max_commits: z.number().int().min(1).max(10_000).optional(),
      auto_close_after_landing: z.boolean().optional(),
    }).strict().optional(),
  }).strict().optional(),
  resources: z.array(resource),
  schedules: z.array(schedule),
  runtime_wake_budget: z.object({
    max_invocations_per_day: z.number().int().min(1).max(24),
  }).strict().optional(),
  integration: z.object({
    provider: text,
    target: text,
    require_current_main: z.boolean(),
    required_checks: textList,
    landing_authority: textList.min(1),
  }).strict(),
  delivery: z.object({
    retry: z.object({ max_attempts: z.number().int().min(1).max(5) }).strict().optional(),
    authority: z.object({
      implemented: textList.min(1),
      verified: textList.min(1),
      integrated: textList.min(1),
      release_ready: textList.min(1),
      released: textList.min(1),
      deployed: textList.min(1),
      live_verified: textList.min(1),
    }).strict(),
    adapters: z.object({
      release: z.object({ provider: text }).passthrough(),
      deployment: z.object({ provider: text }).passthrough(),
    }).strict(),
  }).strict(),
  owner_digest: z.object({ enabled: z.boolean(), window_hours: z.number().int().min(1).max(168).optional(),
    max_items: z.number().int().min(1).max(100).optional() }).strict().optional(),
  session_manager: z.object({
    id: z.literal('session-manager'),
    runtime: text,
    model: text.nullable().optional(),
    reasoning: text.nullable().optional(),
    launchPolicy,
    // Older installations carried this launch-order hint. Current lifecycle
    // ordering is derived from the organization graph; retain only for reads.
    start_last: z.literal(true).optional(),
    branch: text.nullable().optional(),
    worktree_name: text.regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/).nullable().optional(),
  }).strict(),
  domains: z.array(domain).min(1),
  organization: organizationGraphSchema.optional(),
  organization_assessment: z.object({
    observation_window_days: z.number().int().min(7).max(365),
    minimum_recurrences: z.number().int().min(3).max(10),
  }).strict().optional(),
  retired_domains: z.array(z.object({
    id,
    title: text,
    branch: text,
    change_id: text,
    retired_at: text,
  }).strict()).optional(),
}).strict().superRefine((config, context) => {
  const runtimeNames = new Set(Object.keys(config.runtimes).filter((name) => name !== 'default'));
  const scheduleIds = new Set();
  const identityIds = new Set(['session-manager', ...config.domains.map((entry) => entry.id)]);
  for (const [index, area] of (config.backlog?.self_claim?.areas ?? []).entries()) {
    if (area === 'session-manager' || !identityIds.has(area)) context.addIssue({
      code: 'custom', path: ['backlog', 'self_claim', 'areas', index],
      message: 'self-claim allowlist must name a defined specialist identity',
    });
  }
  for (const [index, entry] of config.schedules.entries()) {
    if (scheduleIds.has(entry.id)) {
      context.addIssue({ code: 'custom', path: ['schedules', index, 'id'], message: `duplicate schedule id: ${entry.id}` });
    }
    scheduleIds.add(entry.id);
    if (entry.action.type === 'manager-check-in') {
      if (entry.behavior !== 'coordination' || entry.lifetime !== 'system'
        || !entry.required_authority.includes('owner')) {
        context.addIssue({
          code: 'custom', path: ['schedules', index],
          message: 'manager check-in must be an owner-authorized system coordination schedule',
        });
      }
      if (entry.trigger.type === 'interval' && entry.trigger.seconds < 60) {
        context.addIssue({
          code: 'custom', path: ['schedules', index, 'trigger', 'seconds'],
          message: 'manager check-in intervals must be at least 60 seconds',
        });
      }
      if (!identityIds.has(entry.action.manager_id)) {
        context.addIssue({
          code: 'custom', path: ['schedules', index, 'action', 'manager_id'],
          message: `manager check-in references unknown identity: ${entry.action.manager_id}`,
        });
      }
      const wake = entry.action.wake;
      const mode = wake?.budget_mode ?? (wake?.max_usd_per_invocation !== undefined ? 'usd-hard-cap' : null);
      if (wake?.enabled === true && mode === null) {
        context.addIssue({
          code: 'custom', path: ['schedules', index, 'action', 'wake', 'budget_mode'],
          message: 'enabled manager runtime wakes require an explicit invocation-count policy or a positive per-invocation USD ceiling',
        });
      }
      if (mode === 'usd-hard-cap' && !(Number.isFinite(wake.max_usd_per_invocation)
        && wake.max_usd_per_invocation > 0)) {
        context.addIssue({
          code: 'custom', path: ['schedules', index, 'action', 'wake', 'max_usd_per_invocation'],
          message: 'enabled manager runtime wakes require a positive per-invocation USD ceiling',
        });
      }
      if (mode === 'invocation-count' && wake?.max_usd_per_invocation !== undefined) {
        context.addIssue({
          code: 'custom', path: ['schedules', index, 'action', 'wake', 'max_usd_per_invocation'],
          message: 'invocation-count mode cannot promise a USD ceiling; select usd-hard-cap instead',
        });
      }
    } else if (entry.action.type === 'integration-drain') {
      if (entry.behavior !== 'mutating' || entry.lifetime !== 'system'
        || !['interval', 'cron'].includes(entry.trigger.type)
        || !entry.required_authority.includes('owner')) {
        context.addIssue({
          code: 'custom', path: ['schedules', index],
          message: 'integration drain must be an owner-authorized periodic system mutation schedule',
        });
      }
      if (!identityIds.has(entry.action.landing_authority_id)) {
        context.addIssue({
          code: 'custom', path: ['schedules', index, 'action', 'landing_authority_id'],
          message: `integration drain references unknown identity: ${entry.action.landing_authority_id}`,
        });
      }
      if (!config.integration.landing_authority.includes(entry.action.landing_authority_id)) {
        context.addIssue({
          code: 'custom', path: ['schedules', index, 'action', 'landing_authority_id'],
          message: `integration drain identity lacks configured landing authority: ${entry.action.landing_authority_id}`,
        });
      }
      if (entry.trigger.type === 'interval' && entry.trigger.seconds < 60) {
        context.addIssue({
          code: 'custom', path: ['schedules', index, 'trigger', 'seconds'],
          message: 'integration-drain intervals must be at least 60 seconds',
        });
      }
    } else if (entry.action.type === 'owner-digest') {
      if (entry.behavior !== 'coordination' || entry.lifetime !== 'system'
        || !entry.required_authority.includes('owner') || (entry.retry?.max_attempts ?? 1) !== 1) {
        context.addIssue({ code: 'custom', path: ['schedules', index],
          message: 'owner digest must be an owner-authorized system coordination schedule without automatic retry' });
      }
    } else if (entry.behavior === 'coordination') {
      context.addIssue({
        code: 'custom', path: ['schedules', index, 'behavior'],
        message: 'coordination behavior is reserved for the typed manager-check-in action',
      });
    }
  }
  const managerRoleIds = new Set(config.organization
    ? config.organization.roles.flatMap((role) => role.reports_to)
    : []);
  const scheduledManagers = new Set(config.schedules
    .filter((entry) => entry.action.type === 'manager-check-in')
    .map((entry) => entry.action.manager_id));
  for (const managerIdentity of new Set(organizationGraphFromConfig(config).roles
    .filter((role) => managerRoleIds.has(role.id) && role.kind !== 'owner')
    .map((role) => role.identity_id))) {
    if (!scheduledManagers.has(managerIdentity)) {
      context.addIssue({
        code: 'custom', path: ['schedules'],
        message: `manager identity ${managerIdentity} has direct reports but no manager-check-in schedule`,
      });
    }
  }
  const wakeEnabled = config.schedules.some((entry) =>
    entry.action.type === 'manager-check-in' && entry.action.wake?.enabled === true);
  if (wakeEnabled && !config.runtime_wake_budget) {
    context.addIssue({
      code: 'custom', path: ['runtime_wake_budget'],
      message: 'enabled manager runtime wakes require a project-wide daily invocation budget',
    });
  }
  if (!runtimeNames.has(config.runtimes.default)) {
    context.addIssue({ code: 'custom', path: ['runtimes', 'default'], message: 'default runtime is not configured' });
  }
  for (const [index, entry] of config.domains.entries()) {
    if (!runtimeNames.has(entry.runtime)) {
      context.addIssue({ code: 'custom', path: ['domains', index, 'runtime'], message: 'domain runtime is not configured' });
    }
  }
  for (const [runtime, profile] of Object.entries(config.runtimes)) {
    if (runtime !== 'default' && profile?.updatePolicy !== undefined) {
      const policy = z.object({ mode: z.enum(['auto', 'off']),
        max_age_hours: z.number().int().min(1).max(168) }).strict().safeParse(profile.updatePolicy);
      if (!policy.success) for (const issue of policy.error.issues) {
        context.addIssue({ ...issue, path: ['runtimes', runtime, 'updatePolicy', ...issue.path] });
      }
    }
    if (runtime === 'default' || !profile || typeof profile !== 'object' || Array.isArray(profile)) continue;
    if (profile.launchPolicy !== undefined) {
      const result = launchPolicy.safeParse(profile.launchPolicy);
      if (!result.success) {
        for (const issue of result.error.issues) context.addIssue({
          ...issue, path: ['runtimes', runtime, 'launchPolicy', ...issue.path],
        });
      }
    }
  }
});

function formatIssues(issues) {
  return issues.map((issue) => ({
    path: issue.path.length ? issue.path.join('.') : '<root>',
    message: issue.message,
    code: issue.code,
  }));
}

export function validateProjectConfig(value) {
  if (value?.schema !== PROJECT_CONFIG_SCHEMA) {
    throw new TorchError(`Unsupported TORCH project configuration schema: ${value?.schema ?? '<missing>'}`, {
      code: 'CONFIG_SCHEMA_UNSUPPORTED',
      details: { actual: value?.schema ?? null, supported: [PROJECT_CONFIG_SCHEMA] },
    });
  }
  const result = projectConfigSchema.safeParse(value);
  if (!result.success) {
    throw new TorchError('TORCH project configuration is invalid', {
      code: 'CONFIG_SCHEMA_INVALID', details: formatIssues(result.error.issues),
    });
  }
  return value;
}

export function loadProjectConfig(repositoryRoot) {
  const path = join(repositoryRoot, '.torch', 'torch.yaml');
  let value;
  try { value = JSON.parse(readFileSync(path, 'utf8')); } catch (error) {
    throw new TorchError(`Cannot read ${path}`, { code: 'CONFIG_INVALID', details: error.message });
  }
  return validateProjectConfig(value);
}

export function planProjectConfigMigration(value) {
  if (value?.schema === PROJECT_CONFIG_SCHEMA) {
    validateProjectConfig(value);
    return {
      from: PROJECT_CONFIG_SCHEMA, to: PROJECT_CONFIG_SCHEMA,
      steps: [], canProceed: true, changed: false, mutationPerformed: false,
    };
  }
  return {
    from: value?.schema ?? null, to: PROJECT_CONFIG_SCHEMA, steps: [], canProceed: false,
    changed: false, mutationPerformed: false,
    blockers: [{ code: 'CONFIG_MIGRATION_UNAVAILABLE', schema: value?.schema ?? null }],
  };
}

function policyFail(message, code, details) {
  throw new TorchError(message, { code, details });
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function fieldFrame(label, value) {
  const bytes = Buffer.from(value, 'utf8');
  return Buffer.concat([Buffer.from(`${label}:${bytes.length}\n`, 'ascii'), bytes, Buffer.from('\n', 'ascii')]);
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * A data-only, versioned representation of the registered check definition.
 * The policy itself is deliberately excluded so its digest cannot self-reference.
 */
export function canonicalRegisteredCheckDefinitionBytesV2(checkDefinition) {
  const parsed = z.object({
    id,
    title: text.optional(),
    command: text,
    args: textList.optional(),
    source: z.record(z.string(), z.unknown()).optional(),
    resources: textList.optional(),
    snapshot: z.object({ paths: textList.min(1), source_commit_file: text }).strict().optional(),
    conditions: z.unknown().optional(),
  }).strict().safeParse(checkDefinition);
  if (!parsed.success) policyFail('Registered check definition is invalid', 'CANDIDATE_EXECUTION_POLICY_INVALID', formatIssues(parsed.error.issues));
  const bytes = Buffer.from(`candidate-check-definition/v2alpha1\n${canonicalJson(parsed.data)}\n`, 'utf8');
  if (bytes.length > CANDIDATE_EXECUTION_POLICY_V2_MAX_FRAME_BYTES) {
    policyFail('Registered check definition exceeds the policy frame bound', 'CANDIDATE_EXECUTION_POLICY_FRAME_TOO_LARGE');
  }
  return bytes;
}

export function registeredCheckDefinitionDigestV2(checkDefinition) {
  return digest(canonicalRegisteredCheckDefinitionBytesV2(checkDefinition));
}

/**
 * Produces the fixed UTF-8/LF v2 policy preimage. It has no filesystem, process,
 * ControlPlane, or registration side effects; an issued native parent is required
 * before a parsed policy becomes execution authority.
 */
export function canonicalCandidateExecutionPolicyBytesV2(policy) {
  const parsed = candidateExecutionPolicyV2.safeParse(policy);
  if (!parsed.success) policyFail('Candidate execution policy is invalid', 'CANDIDATE_EXECUTION_POLICY_INVALID', formatIssues(parsed.error.issues));
  const value = parsed.data;
  const fields = [
    ['schema', value.schema],
    ['version', String(value.version)],
    ['check_id', value.check_id],
    ['registered_definition_sha256', value.registered_definition_sha256],
    ['package_json_path', value.package_json_path],
    ['package_script_name', value.package_script_name],
    ['package_script_raw', value.package_script_raw],
    ['input_rules_json', canonicalJson(value.input_rules)],
    ['environment_allowlist_json', canonicalJson(value.environment_allowlist)],
    ['runtime_manifest_json', canonicalJson(value.runtime_manifest)],
    ['limits_json', canonicalJson(value.limits)],
  ];
  const bytes = Buffer.concat([
    Buffer.from('candidate-execution-policy/v2alpha1\n', 'ascii'),
    ...fields.map(([label, fieldValue]) => fieldFrame(label, fieldValue)),
  ]);
  if (bytes.length > CANDIDATE_EXECUTION_POLICY_V2_MAX_FRAME_BYTES) {
    policyFail('Candidate execution policy exceeds the policy frame bound', 'CANDIDATE_EXECUTION_POLICY_FRAME_TOO_LARGE');
  }
  return bytes;
}

export function candidateExecutionPolicyDigestV2(policy) {
  return digest(canonicalCandidateExecutionPolicyBytesV2(policy));
}

/**
 * Resolves only a policy already present in a parsed project configuration. This
 * validates declaration consistency but does not authenticate a caller or issue
 * native authority; Work's registered CheckService admission remains that origin.
 */
export function resolveRegisteredCandidateExecutionPolicyV2(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some((key) => !new Set(['config', 'checkId']).has(key))) {
    policyFail('Candidate policy resolver input is invalid', 'CANDIDATE_EXECUTION_POLICY_INPUT_INVALID');
  }
  const { config, checkId } = input;
  validateProjectConfig(config);
  if (typeof checkId !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(checkId)) {
    policyFail('Candidate policy check ID is invalid', 'CANDIDATE_EXECUTION_POLICY_INPUT_INVALID');
  }
  const checkDefinition = config.checks.find((entry) => entry.id === checkId);
  if (!checkDefinition) policyFail('Registered check definition is absent', 'CANDIDATE_CHECK_UNREGISTERED', { checkId });
  const policy = checkDefinition.candidate_execution_policy;
  if (!policy) {
    policyFail('Candidate snapshot policy is not registered for this check', 'CANDIDATE_SNAPSHOT_POLICY_UNDECLARED', { checkId });
  }
  const definition = { ...checkDefinition };
  delete definition.candidate_execution_policy;
  const definitionDigest = registeredCheckDefinitionDigestV2(definition);
  if (policy.check_id !== checkDefinition.id || policy.registered_definition_sha256 !== definitionDigest) {
    policyFail('Candidate policy does not bind the registered check definition', 'CANDIDATE_EXECUTION_POLICY_BINDING_MISMATCH');
  }
  const scriptName = checkDefinition.args?.[1];
  const scriptRaw = checkDefinition.source?.type === 'package-script' ? checkDefinition.source.command : undefined;
  if (checkDefinition.command !== 'npm' || checkDefinition.args?.[0] !== 'run'
    || typeof scriptName !== 'string' || policy.package_script_name !== scriptName
    || typeof scriptRaw !== 'string' || policy.package_script_raw !== scriptRaw) {
    policyFail('Candidate policy does not bind the registered npm package script', 'CANDIDATE_EXECUTION_POLICY_BINDING_MISMATCH');
  }
  const bytes = canonicalCandidateExecutionPolicyBytesV2(policy);
  return deepFreeze({
    schema: CANDIDATE_EXECUTION_POLICY_V2_SCHEMA,
    checkId,
    policy: structuredClone(policy),
    bytes,
    digest: digest(bytes),
    registeredDefinitionBytes: canonicalRegisteredCheckDefinitionBytesV2(definition),
    registeredDefinitionDigest: definitionDigest,
  });
}
