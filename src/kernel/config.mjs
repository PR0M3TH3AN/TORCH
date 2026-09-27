import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { TorchError } from './errors.mjs';

export const PROJECT_CONFIG_SCHEMA = 'torch.dev/v1alpha1';

const text = z.string().trim().min(1);
const id = text.regex(/^[a-z0-9][a-z0-9-]*$/);
const textList = z.array(text);

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
  branch: text.nullable().optional(),
  worktree_name: text.regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/).nullable().optional(),
}).strict();

const check = z.object({
  id,
  title: text.optional(),
  command: text,
  args: textList.optional(),
  source: z.record(z.string(), z.unknown()).optional(),
  resources: textList.optional(),
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
  behavior: z.enum(['read-only', 'mutating']),
  action: z.object({ type: z.literal('command'), command: text, args: textList }).strict(),
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
  resources: z.array(resource),
  schedules: z.array(schedule),
  integration: z.object({
    provider: text,
    target: text,
    require_current_main: z.boolean(),
    required_checks: textList,
    landing_authority: textList.min(1),
  }).strict(),
  delivery: z.object({
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
  session_manager: z.object({
    id: z.literal('session-manager'),
    runtime: text,
    start_last: z.literal(true),
    branch: text.nullable().optional(),
    worktree_name: text.regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/).nullable().optional(),
  }).strict(),
  domains: z.array(domain).min(1),
  retired_domains: z.array(z.object({
    id,
    title: text,
    branch: text,
    change_id: text,
    retired_at: text,
  }).strict()).optional(),
}).strict().superRefine((config, context) => {
  const runtimeNames = new Set(Object.keys(config.runtimes).filter((name) => name !== 'default'));
  if (!runtimeNames.has(config.runtimes.default)) {
    context.addIssue({ code: 'custom', path: ['runtimes', 'default'], message: 'default runtime is not configured' });
  }
  for (const [index, entry] of config.domains.entries()) {
    if (!runtimeNames.has(entry.runtime)) {
      context.addIssue({ code: 'custom', path: ['domains', index, 'runtime'], message: 'domain runtime is not configured' });
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
