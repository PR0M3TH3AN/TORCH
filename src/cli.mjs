import { analyzeRepository } from './kernel/analyze.mjs';
import { BacklogService } from './backlog/service.mjs';
import { ArtifactService } from './artifacts/service.mjs';
import { createClaudeAdapter } from './adapters/claude.mjs';
import { createRuntimeAdapterRegistry } from './adapters/registry.mjs';
import { planProviderUpdates, updateProviders } from './adapters/updates.mjs';
import { profileCapabilityIssues, resolveLaunchPolicy } from './adapters/runtime.mjs';
import {
  inspectRuntimePluginTrust, planRuntimePluginRevoke, planRuntimePluginTrust,
  revokeRuntimePlugin, runtimePluginTrustPath, trustRuntimePlugin,
} from './adapters/plugins.mjs';
import { CheckService } from './checks/service.mjs';
import { startConsole } from './console/server.mjs';
import { classifyRecoverability, createLocalCanonical, planLocalCanonical } from './canonical/local.mjs';
import { openControlPlane } from './control-plane/service.mjs';
import { fetchCanonicalObjects, planCanonicalFetch } from './canonical/fetch.mjs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  mkdirSync, mkdtempSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { diagnoseProject } from './kernel/doctor.mjs';
import { loadProjectConfig, validateProjectConfig } from './kernel/config.mjs';
import { asErrorRecord, TorchError } from './kernel/errors.mjs';
import { inspectRepository } from './kernel/git.mjs';
import { resolveInstalledProjectRoot } from './kernel/project-root.mjs';
import { setupProject, restoreProject } from './kernel/setup.mjs';
import { inspectSpecifications } from './kernel/specifications.mjs';
import { installProject, planInstall, uninstallProject } from './kernel/install.mjs';
import { IntegrationService } from './integration/service.mjs';
import { analyzeCombatrigFleet } from './importers/combatrig.mjs';
import { proposeDomains } from './kernel/domains.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { fileHash, writeNewFile } from './kernel/files.mjs';
import { createWorktrees, planWorktrees } from './kernel/worktrees.mjs';
import {
  captureFleet, createFleetBrief, detachFleet, planAreaUp, planFleetDetach,
  planFleetDown, planFleetUp, startFleet, stopFleet,
} from './runtime/lifecycle.mjs';
import { ResourceService } from './resources/service.mjs';
import { CANDIDATE_ACCEPTANCE_SCENARIOS, createVersionService } from './self-host/service.mjs';
import { observeProject } from './observability/snapshot.mjs';

// Provider output is evidence, not an unbounded artifact channel.  startFleet
// classifies ENOBUFS as an interrupted outcome instead of a completed turn.
const MAX_RUNTIME_EXECUTOR_OUTPUT_BYTES = 1024 * 1024;
const CODEX_PROTOCOL_REDUCER = fileURLToPath(new URL('./runtime/codex-protocol-reducer.mjs', import.meta.url));

export function executeRuntimeLaunch(spawn, launch, options = {}) {
  // Tests and adapter qualification inject a deterministic executor. The real
  // synchronous CLI boundary alone needs protocol reduction before buffering.
  // A tagged guard may delegate to native spawnSync after asserting hermetic
  // launch preconditions; it must opt in rather than changing fake executors.
  const usesNativeSpawn = spawn === spawnSync || spawn?.torchNativeSpawnGuard === true;
  if (launch.runtime === 'codex' && usesNativeSpawn) {
    return spawn(process.execPath, [CODEX_PROTOCOL_REDUCER, launch.command, ...launch.args], options);
  }
  return spawn(launch.command, launch.args, options);
}
import { OwnerDigestService } from './observability/owner-digest.mjs';
import { ContextTelemetryService } from './telemetry/context.mjs';
import { ScheduleService } from './schedules/service.mjs';
import { assertLauncherDigest, ScheduleLauncherService } from './schedules/launcher.mjs';
import { createFleetDesignBrief } from './design/brief.mjs';
import {
  createArchitectRunPlan, loadArchitectArtifact, runSessionArchitect, validateArchitectProposal,
} from './design/architect.mjs';
import { FleetEvolutionService } from './evolution/service.mjs';
import { HierarchyEvolutionService } from './evolution/hierarchy.mjs';
import { ConvergenceService } from './convergence/service.mjs';
import {
  attachForge, detachForge, forgeStatus, planForgeAttach, planForgeDetach,
  planForgeSync, syncForgeRemote,
} from './forge/service.mjs';
import {
  configureDelivery, DeliveryService, planDeliveryConfiguration,
} from './delivery/service.mjs';

const HELP = `TORCH — portable agent fleet

Usage:
  torch init [--repo <path>] [--spec <path>] [--json]
  torch analyze [--repo <path>] [--spec <path>] [--json]
  torch design [--repo <path>] [--spec <path>] [--output <path>] [--json]
  torch bootstrap [--repo <path>] [--spec <path>] [--output <path>] [--json]
  torch architect plan --brief <path> --provider <claude|codex> [--model <model>] [--max-budget-usd <amount>] [--json]
  torch architect validate --brief <path> --response <path> [--json]
  torch architect run --brief <path> --provider <claude|codex> --output <path> [--model <model>] [--max-budget-usd <amount>] --yes [--json]
  torch domains [--repo <path>] [--spec <path>] [--output <path>] [--json]
  torch install --proposal <path> [--runtime <adapter,adapter>] [--default-runtime <adapter>] [--update-runtimes] [--dry-run] [--yes] [--json]
  torch worktrees [--parent <path>] [--dry-run] [--yes] [--json]
  torch install --restore [--dry-run] [--yes] [--json]
  torch setup [--parent <path>] [--dry-run] [--yes] [--json]
  torch up [--fresh] [--only <id,id>] [--dry-run] [--yes] [--json]
  torch down [--dry-run] [--yes] [--json]
  torch capture [--json]
  torch detach [--dry-run] [--yes] [--json]
  torch list [--json]
  torch brief [--area <id>] [--json]
  torch identity --area <id> [--json]
  torch agents [--json]
  torch agent --area <id> [--json]
  torch roster [--json]
  torch who-owns (--path <path> | --capability <text>) [--json]
  torch neighbours --area <id> [--json]
  torch message --from <id> --to <id|all> --body <text> [--task <id>] [--path <path>] [--commit <sha>] [--json]
  torch inbox --area <id> [--unacknowledged] [--limit <n>] [--json]
  torch ack --area <id> --message <id> [--json]
  torch status --area <id> --state <state> [--summary <text>] [--runtime <name>] [--session <id>] [--task <id>] [--json]
  torch profile show --area <id> [--json]
  torch profile set --area <id> [--runtime <adapter>] [--model <model>|--inherit-model] [--reasoning <level|none>] [--launch-policy <field=value> ...] [--reset|--reset-launch-policy] [--dry-run|--yes] [--json]
  torch profile defaults --runtime <adapter> [--model <model>] [--reasoning <level|none>] [--launch-policy <field=value> ...] [--reset|--reset-launch-policy] --yes [--json]
  torch runtimes list [--json]
  torch runtimes update --runtime <codex,claude,pi> [--force] [--dry-run|--yes] [--json]
  torch runtimes update-policy --mode <auto|off> [--max-age-hours <1-168>] --yes [--json]
  torch runtimes trust --name <id> --module </absolute/path/adapter.cjs> [--yes --sha256 <reviewed-hash>] [--json]
  torch runtimes revoke --name <id> [--yes --sha256 <reviewed-hash>] [--json]
  torch complete --area <id> --summary <text> [--task <id>] [--evidence <text>] [--commit <sha>] [--json]
  torch blocked --area <id> --summary <text> [--task <id>] [--evidence <text>] [--path <path>] [--commit <sha>] [--json]
  torch coordinate --from <id> --body <text> [--with <id,id>] [--task <id>] [--path <path>] [--json]
  torch handoff --from <id> [--to <id>] (--path <path> | --task <id>) --reason <text> [--json]
  torch approvals list [--area <id|owner>] [--status <pending|approved|rejected|cancelled>] [--json]
  torch approvals decide --id <approval> --revision <n> --by owner --decision <approved|rejected> [--note <text>] --yes [--json]
  torch backlog list [--state <state>] [--owner <id>] [--json]
  torch backlog next --area <id> [--json]
  torch backlog claim-next --area <id> [--dry-run|--yes] [--json]
  torch backlog health [--stale-days <n>] [--stale-observed-commits <n>] [--json]
  torch backlog activity [--stale-days <n>] [--max-commits <n>] [--json]
  torch backlog close-landed --integration <id> --area session-manager (--dry-run | --yes) [--json]
  torch backlog get --task <id> [--json]
  torch backlog create --area <id> --title <text> --description <text> --accept <text,...> [--priority <priority>] [--domains <id,...>] [--depends <task,...>] [--observed-at <sha>] [--json]
  torch backlog classify --task <id> --area session-manager --revision <n> [--feature <name>] [--milestone <name>] [--clear-feature] [--clear-milestone] --reason <text> [--json]
  torch backlog transition --task <id> --area <id> --state <state> --revision <n> [--owner <id>] [--evidence <text,...>] [--commit <sha>] [--integration <id>] [--reason <text>] [--note <text>] [--json]
  torch artifacts list [--json]
  torch artifacts publish --area <id> --task <id> --title <text> --alt <text> --file <path> --commit <full-sha> [--json]
  torch artifacts comment --artifact <id> --body <text> --by owner [--yes] [--json]
  torch checks list [--json]
  torch checks receipts [--commit <sha>] [--id <check>] [--area <id>] [--json]
  torch checks plan --id <check> --area <id> [--json]
  torch checks run --id <check> --area <id> --yes [--json]
  torch checks prepare --id <check> --area <id> --yes [--json]
  torch checks prepared [--area <id>] [--json]
  torch checks run-prepared --prepared <id> --area <id> --yes [--json]
  torch checks cancel-prepared --prepared <id> --area <id> --yes [--json]
  torch checks recovery-plan --prepared <id> [--json]
  torch checks recover-prepared --prepared <id> --executors-stopped --evidence <text> --yes [--json]
  torch resources list [--json]
  torch resources status --id <resource> [--json]
  torch resources acquire --id <resource> --area <id> [--json]
  torch resources release --id <resource> --area <id> [--json]
  torch resources cancel --id <resource> --area <id> [--json]
  torch converge plan --area <id> [--json]
  torch converge run --area <id> --yes [--json]
  torch converge guards --area <id> [--json]
  torch converge hold --area <id> --type <measurement|pin> --reason <text> [--json]
  torch converge release --area <id> --type <measurement|pin> [--json]
  torch integrate list [--state <state>] [--json]
  torch integrate request --area <id> [--commit <sha>] [--json]
  torch integrate evaluate --request <id> [--json]
  torch integrate authorize --request <id> --area <id> [--json]
  torch integrate plan --request <id> --area <id> [--json]
  torch integrate land --request <id> --area <id> --yes [--json]
  torch integrate drain --area <landing-authority> --yes [--limit <n>] [--json]
  torch canonical plan [--json]
  torch canonical create --yes [--json]
  torch recoverability [--commit <sha>] [--json]
  torch forge plan --remote <name> [--provider <name>] [--json]
  torch forge attach --remote <name> [--provider <name>] --yes [--json]
  torch forge status [--json]
  torch forge sync plan [--json]
  torch forge sync --yes [--json]
  torch forge fetch plan [--json]
  torch forge fetch status [--json]
  torch forge fetch --yes [--attempts 3] [--json]
  torch forge detach [--dry-run] --yes [--json]
  torch delivery list [--state <state>] [--json]
  torch digest build [--json]
  torch digest latest [--json]
  torch digest publish --by owner --yes [--json]
  torch delivery attempts [--id <delivery-id>] [--json]
  torch delivery operations [--id <delivery-id>] [--json]
  torch delivery recover-not-applied --operation <id> --by owner --runtime-stopped --evidence <refs> --yes [--json]
  torch delivery recover-succeeded --operation <id> --by owner (--dry-run | --runtime-stopped --evidence <refs> --yes) [--json]
  torch delivery get --delivery <id> [--json]
  torch delivery create --area <id> [--commit <sha>] --label <text> --evidence <text,...> [--json]
  torch delivery plan --delivery <id> --to <state> --by <id|owner> [--json]
  torch delivery transition --delivery <id> --to <state> --by <id|owner> --evidence <text,...> [--yes] [--json]
  torch delivery configure [--release-provider <name>] [--deployment-provider <name>] [--dry-run] --yes [--json]
  torch candidate plan --source <path> [--version <version>] [--json]
  torch candidate build --source <path> [--version <version>] --yes [--json]
  torch candidate status [--json]
  torch candidate test --version <version> [--json]
  torch upgrade --version <version> [--dry-run] --yes [--json]
  torch rollback [--dry-run] --yes [--json]
  torch import combatrig --source <path> [--output <path>] [--json]
  torch console snapshot [--repo <path>] [--json]
  torch console serve [--repo <path>] [--host <address>] [--port <n>]
  torch context report [--area <id>] [--task <id>] [--commit <sha>] [--measurement <class>] [--json]
  torch context record --area <id> --source <text> --measurement <measured|estimated> [usage fields] [--json]
  torch schedules list [--actor <id|owner>] [--json]
  torch schedules runs [--id <schedule>] [--json]
  torch schedules wakes [--manager <id>] [--json]
  torch schedules recover-wake --reservation <id> --runtime-stopped --note <evidence> --yes [--json]
  torch schedules plan --id <schedule> --actor <id|owner> [--json]
  torch schedules run --id <schedule> --actor <id|owner> [--yes] [--json]
  torch schedules launcher <plan|plan-reconcile|status|install|reconcile|remove> [--yes] [--json]
  torch fleet changes [--state <state>] [--json]
  torch fleet get --change <id> [--json]
  torch fleet assess [--from session-manager] [--json]
  torch fleet propose --from session-manager --proposal <path> [--json]
  torch fleet propose-retirement --from session-manager --proposal <path> [--json]
  torch fleet propose-merge --from session-manager --proposal <path> [--json]
  torch fleet propose-split --from session-manager --proposal <path> [--json]
  torch fleet approve --change <id> --by <owner> --yes [--json]
  torch fleet reject --change <id> --by <owner> --reason <text> --yes [--json]
  torch fleet plan --change <id> [--json]
  torch fleet activate --change <id> --by <owner> --yes [--json]
  torch fleet start --change <id> [--fresh] [--dry-run] --yes [--json]
  torch fleet hierarchy-changes [--state <state>] [--json]
  torch fleet hierarchy-assess [--from session-manager] [--json]
  torch fleet hierarchy-get --proposal <id> [--json]
  torch fleet hierarchy-propose --from session-manager --proposal <path> [--json]
  torch fleet hierarchy-decide --proposal <id> --decision <approve-pilot|defer|reject> --by owner [--reason <text>] --yes [--json]
  torch fleet hierarchy-plan --proposal <id> [--json]
  torch fleet hierarchy-activate --proposal <id> --by owner --yes [--json]
  torch fleet hierarchy-review-pilot --proposal <id> --review <json-path> --from session-manager --yes [--json]
  torch fleet hierarchy-pilot-reviews --proposal <id> [--json]
  torch fleet hierarchy-conclusion-plan --proposal <id> --decision <adopt|reverse> --reason <text> [--json]
  torch fleet hierarchy-conclude --proposal <id> --decision <adopt|reverse> --reason <text> --plan-hash <digest> --by owner --yes [--json]
  torch doctor [--json]
  torch uninstall [--dry-run] [--purge --yes] [--json]
`;

function print(value, { json = false } = {}) {
  if (json || typeof value !== 'string') process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  else process.stdout.write(`${value}\n`);
}

function optionValue(argv, name) {
  const direct = argv.find((arg) => arg.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function optionValues(argv, name) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index].startsWith(`${name}=`)) values.push(argv[index].slice(name.length + 1));
    else if (argv[index] === name && argv[index + 1] !== undefined) values.push(argv[index + 1]);
  }
  return values;
}

function launchPolicyOptions(argv) {
  const result = {};
  for (const entry of optionValues(argv, '--launch-policy')) {
    const match = /^([a-z][A-Za-z0-9]*)=(.+)$/.exec(entry);
    if (!match || Object.hasOwn(result, match[1])) {
      throw new TorchError(`Invalid or duplicate --launch-policy value: ${entry}`, {
        code: 'RUNTIME_PROFILE_INVALID', details: { expected: 'field=value' },
      });
    }
    result[match[1]] = match[2];
  }
  return result;
}

function assertEffectiveProfileSupported(config, areaId, registry) {
  const profile = effectiveProfile(config, areaId, registry);
  const issues = profileCapabilityIssues(registry.get(profile.runtime), profile);
  if (issues.length) {
    throw new TorchError(`Runtime profile is unsupported by ${profile.runtime}`, {
      code: 'RUNTIME_PROFILE_UNSUPPORTED', details: { profile, capabilities: issues },
    });
  }
  return profile;
}

function assertRuntimeDefaultsSupported(config, runtime, registry) {
  const adapter = registry.get(runtime);
  const settings = config.runtimes[runtime] ?? {};
  const profile = {
    model: settings.model ?? adapter?.configuration?.model ?? null,
    reasoning: settings.reasoning ?? adapter?.configuration?.reasoning ?? null,
    launchPolicy: resolveLaunchPolicy({
      runtime, adapterDefaults: adapter?.configuration, runtimeConfig: settings,
    }),
  };
  const issues = profileCapabilityIssues(adapter, profile);
  if (issues.length) throw new TorchError(`Runtime defaults are unsupported by ${runtime}`, {
    code: 'RUNTIME_PROFILE_UNSUPPORTED', details: { profile, capabilities: issues },
  });
}

function migrateLegacyRuntimeLaunchPolicy(runtime, settings, adapter) {
  if (runtime !== 'codex' || (!Object.hasOwn(settings, 'sandbox') && !Object.hasOwn(settings, 'approval'))) return;
  const migrated = resolveLaunchPolicy({ runtime, adapterDefaults: adapter?.configuration, runtimeConfig: settings });
  if (settings.sandbox === 'workspace-write' && settings.approval === 'approve-for-me') {
    // If the owner changes approval away from approve-for-me, preserve the
    // implicit workspace-write boundary as an explicit sandbox field.
    migrated.sandbox = 'workspace-write';
  }
  delete settings.sandbox;
  delete settings.approval;
  if (Object.keys(migrated).length) settings.launchPolicy = migrated;
  else delete settings.launchPolicy;
}

function commaList(value) {
  return (value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
}

function loadProposal(cwd, proposalPath) {
  if (!proposalPath) {
    throw new TorchError('Installation requires an approved domain proposal from torch domains --output.', {
      code: 'PROPOSAL_REQUIRED',
    });
  }
  try { return JSON.parse(readFileSync(resolve(cwd, proposalPath), 'utf8')); } catch (error) {
    throw new TorchError(`Cannot read domain proposal: ${proposalPath}`, {
      code: 'PROPOSAL_INVALID', details: error.message,
    });
  }
}

function loadJsonFile(cwd, inputPath, { label = 'JSON input', code = 'INPUT_INVALID' } = {}) {
  if (!inputPath) throw new TorchError(`${label} path is required`, { code });
  try { return JSON.parse(readFileSync(resolve(cwd, inputPath), 'utf8')); } catch (error) {
    throw new TorchError(`Cannot read ${label}: ${inputPath}`, { code, details: error.message });
  }
}

function effectiveProfile(config, areaId, runtimeRegistry = createRuntimeAdapterRegistry()) {
  const identity = areaId === 'session-manager'
    ? config.session_manager : config.domains.find((area) => area.id === areaId);
  if (!identity) throw new TorchError(`Unknown Fleet identity: ${areaId}`, { code: 'FLEET_IDENTITY_MISSING' });
  const runtime = identity.runtime ?? config.runtimes.default;
  const defaults = config.runtimes[runtime] ?? {};
  const adapterDefaults = runtimeRegistry.configuration(runtime) ?? {};
  const launchPolicy = resolveLaunchPolicy({ runtime, adapterDefaults, runtimeConfig: defaults, identity });
  return {
    areaId, runtime,
    model: identity.model ?? defaults.model ?? adapterDefaults.model ?? null,
    reasoning: identity.reasoning ?? defaults.reasoning ?? adapterDefaults.reasoning ?? null,
    launchPolicy,
    overrides: {
      runtime: identity.runtime !== undefined,
      model: identity.model != null,
      reasoning: identity.reasoning != null,
      launchPolicy: identity.launchPolicy !== undefined,
    },
  };
}

function persistProfileConfig(repositoryRoot, config) {
  validateProjectConfig(config);
  const path = resolve(repositoryRoot, '.torch', 'torch.yaml');
  const mode = statSync(path).mode & 0o777;
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode });
  renameSync(temporaryPath, path);
  return path;
}

function withControlPlane(repository, env, callback) {
  const controlPlane = openControlPlane({ repositoryRoot: repository.root, env });
  try {
    return callback(controlPlane);
  } finally {
    controlPlane.close();
  }
}

function configuredRuntimeNames(repositoryRoot, areaIds = undefined) {
  const config = loadProjectConfig(repositoryRoot);
  const selected = areaIds === undefined ? null : new Set(areaIds);
  const identities = [config.session_manager, ...config.domains];
  return [...new Set(identities
    .filter((identity) => !selected || selected.has(identity.id))
    .map((identity) => identity.runtime ?? config.runtimes.default))];
}

function activeRuntimeNames(controlPlane) {
  return controlPlane.listAgents().map((identity) => identity.runtime).filter(Boolean);
}

function proposalRuntimeNames(proposal) {
  return [...new Set([
    proposal.session_manager?.runtime,
    ...proposal.domains.map((domain) => domain.runtime),
  ].filter((runtime) => runtime && runtime !== 'default'))];
}

function runtimeAdapters(env = process.env, pluginNames = undefined) {
  return createRuntimeAdapterRegistry({ env, loadPlugins: true, pluginNames }).toMap();
}

function runtimeStoppers(spawn, env = process.env, pluginNames = undefined) {
  const registry = createRuntimeAdapterRegistry({ env, loadPlugins: true, pluginNames });
  registry.replace(createClaudeAdapter({
    runner: (executable, args) => spawn(executable, args, {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }),
  }));
  return registry.toMap();
}

function stopThrough(adapters, action) {
  const adapter = adapters.get(action.runtime);
  if (!adapter) throw new TorchError(`No runtime stopper for ${action.runtime}`, {
    code: 'RUNTIME_ADAPTER_MISSING', details: { runtime: action.runtime },
  });
  return adapter.stopSession({
    runtimeSessionId: action.runtimeSessionId, worktree: action.worktree?.path,
  });
}

function acceptanceExcerpt(value, limit = 12_000) {
  const output = value?.toString() ?? '';
  return output.length > limit ? `[earlier output truncated]\n${output.slice(-limit)}` : output;
}

export const CANDIDATE_ACCEPTANCE_EVIDENCE = Object.freeze({
  'candidate-acceptance-isolation': ['SCN-candidate-acceptance-isolation'],
  'init-analyze': ['SCN-init-read-only'],
  'spec-aware-design': ['SCN-spec-fleet-design', 'SCN-cli-spec-design'],
  'ai-fleet-bootstrap': ['SCN-ai-fleet-bootstrap', 'SCN-bootstrap-specialist-only'],
  'ai-fleet-planning': ['SCN-ai-fleet-planning', 'SCN-architect-organization-assessment', 'SCN-bootstrap-primary-ownership', 'SCN-architect-file-ownership'],
  'fleet-evolution': ['SCN-fleet-evolution', 'SCN-cli-fleet-evolution'],
  'fleet-boundary-evolution': ['SCN-fleet-boundary-evolution'],
  'cli-lifecycle-surface': ['SCN-cli-lifecycle-surface'],
  'forge-migration': ['SCN-forge-migration'],
  'delivery-lifecycle': ['SCN-delivery-lifecycle', 'SCN-delivery-attempts', 'SCN-delivery-retry-boundaries', 'SCN-delivery-succeeded-recovery',
    'SCN-owner-digest', 'SCN-owner-digest-schedule', 'SCN-owner-digest-receipts'],
  'review-install-roster': ['SCN-cli-domain-review', 'SCN-cli-install-provider-default', 'SCN-install-provider-inheritance', 'SCN-guided-setup'],
  'branches-worktrees': ['SCN-worktree-bootstrap'],
  'runtime-identities': ['SCN-mixed-runtime'],
  'runtime-profiles': ['SCN-runtime-profiles', 'SCN-runtime-cost-ceiling', 'SCN-runtime-profile-cli'],
  'provider-updates': ['SCN-provider-updates', 'SCN-provider-updates-recovery', 'SCN-provider-update-safety', 'SCN-provider-update-cli'],
  'console-runtime-profile': ['SCN-console-runtime-profile'],
  'console-schedule-launcher': ['SCN-console-schedule-launcher'],
  'runtime-adapters': [
    'SCN-pi-adapter', 'SCN-pi-lifecycle-plan', 'SCN-pi-mcp-bridge',
    'SCN-claude-adapter', 'SCN-codex-adapter',
  ],
  'runtime-plugin-trust': ['SCN-runtime-plugin-trust', 'SCN-runtime-plugin-lifecycle'],
  'organization-graph': ['SCN-organization-graph'],
  'manager-check-ins': [
    'SCN-manager-check-in', 'SCN-manager-check-in-refresh', 'SCN-manager-check-in-specialist', 'SCN-manager-check-in-schedule',
    'SCN-manager-check-in-budgeted-wake', 'SCN-manager-check-in-cost-ceiling', 'SCN-manager-check-in-active-runtime',
    'SCN-manager-check-in-count-mode', 'SCN-manager-wake-reservation',
    'SCN-manager-wake-policy', 'SCN-manager-wake-recovery',
    'SCN-manager-schedule-coverage', 'SCN-manager-schedule-growth',
    'SCN-default-manager-checkin-config', 'SCN-manager-check-in-cadence-floor',
  ],
  'manager-check-in-console': ['SCN-console-manager-check-ins'],
  'structured-approvals': ['SCN-approval-request'],
  'console-owner-approval': ['SCN-console-owner-approval'],
  'hierarchy-evolution': [
    'SCN-hierarchy-proposal', 'SCN-hierarchy-pressure-assessment',
    'SCN-hierarchy-reconsideration-after-new-evidence',
    'SCN-console-organization-review', 'SCN-hierarchy-proposal-mcp',
    'SCN-hierarchy-activation', 'SCN-hierarchy-activation-rollback',
    'SCN-hierarchy-pilot-review', 'SCN-hierarchy-pilot-reversal', 'SCN-console-hierarchy-conclusion', 'SCN-console-hierarchy-adoption',
  ],
  'hierarchy-cli-review': [
    'SCN-hierarchy-cli', 'SCN-hierarchy-cli-activation', 'SCN-console-hierarchy-activation',
  ],
  'durable-messaging': ['SCN-durable-message'],
  'ownership-query': ['SCN-ownership-handoff'],
  'unsafe-worktree-detection': ['SCN-worktree-purge-safety'],
  'backlog-integration': [
    'SCN-backlog-lifecycle', 'SCN-native-integration',
    'SCN-backlog-commit-activity', 'SCN-backlog-activity-coverage', 'SCN-commit-closure-intent',
    'SCN-landed-task-closure', 'SCN-landed-closure-recovery',
    'SCN-backlog-self-claim', 'SCN-backlog-self-claim-readiness',
    'SCN-backlog-self-claim-race', 'SCN-cli-backlog-self-claim',
    'SCN-backlog-blocked-resume-serialization',
    'SCN-integration-fifo-drain', 'SCN-cli-integration-drain',
  ],
  'forge-sync': ['SCN-forge-sync', 'SCN-canonical-fetch', 'SCN-canonical-fetch-boundaries'],
  'resource-lifecycle': [
    'SCN-resource-fifo', 'SCN-frozen-check-inputs', 'SCN-frozen-check-rejection',
    'SCN-frozen-resource-check', 'SCN-frozen-check-mutating-executor',
    'SCN-check-conditions-contract', 'SCN-check-conditions-fail-closed',
    'SCN-check-condition-drift', 'SCN-condition-receipts',
  ],
  'package-distribution': ['SCN-package-distribution'],
  'capture-stop-resume': [
    'SCN-fleet-fresh-resume', 'SCN-hierarchy-aware-start-stop', 'SCN-hierarchy-startup-cycle',
  ],
  'detach-uninstall': ['SCN-install-doctor-purge', 'SCN-install-restore', 'SCN-worktree-canonical-brief'],
  'combatrig-compatibility': ['SCN-combatrig-import', 'SCN-cli-combatrig-import'],
  'product-surface': ['SCN-product-site', 'SCN-dashboard-demo', 'SCN-console-readonly', 'SCN-console-lifecycle-blockers',
    'SCN-console-owner-digest', 'SCN-demo-owner-digest', 'SCN-console-check-evidence', 'SCN-console-task-activity', 'SCN-console-operation-outcomes', 'SCN-console-live-refresh'],
  'artifact-review': ['SCN-artifact-review', 'SCN-artifact-boundaries'],
  'operations-observability': [
    'SCN-context-locality', 'SCN-schedule-boundaries', 'SCN-cli-schedules',
    'SCN-scheduled-integration-drain',
  ],
});

export function runCandidateAcceptance(candidateRoot, spawn) {
  const acceptanceRoot = mkdtempSync(join(tmpdir(), 'torch-candidate-acceptance-'));
  const home = join(acceptanceRoot, 'home');
  const env = {
    ...process.env,
    HOME: home,
    TMPDIR: join(acceptanceRoot, 'tmp'),
    XDG_CACHE_HOME: join(home, '.cache'),
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_DATA_HOME: join(home, '.local', 'share'),
    XDG_STATE_HOME: join(home, '.local', 'state'),
    XDG_RUNTIME_DIR: join(acceptanceRoot, 'runtime'),
  };
  let checks;
  try {
    for (const path of [home, env.TMPDIR, env.XDG_CACHE_HOME, env.XDG_CONFIG_HOME,
      env.XDG_DATA_HOME, env.XDG_STATE_HOME, env.XDG_RUNTIME_DIR]) {
      mkdirSync(path, { recursive: true, mode: 0o700 });
    }
    checks = [
      { id: 'test', args: ['test'] },
      { id: 'lint', args: ['run', 'lint'] },
      { id: 'syntax', args: ['run', 'check'] },
    ].map((check) => {
      const result = spawn('npm', check.args, {
        cwd: candidateRoot, env, encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'], timeout: 300_000,
      });
      return {
        id: check.id, status: result.status ?? (result.error ? 1 : 0),
        signal: result.signal ?? null, error: result.error?.message ?? null,
        stdout: result.stdout ?? '', stderr: result.stderr ?? '',
      };
    });
  } finally {
    rmSync(acceptanceRoot, { recursive: true, force: true });
  }
  const testOutput = checks.find((check) => check.id === 'test')?.stdout ?? '';
  const observedMarkers = new Set(testOutput.match(/\bSCN-[A-Za-z0-9_-]+\b/g) ?? []);
  const evidenceMappingComplete = CANDIDATE_ACCEPTANCE_SCENARIOS.every((scenario) =>
    Array.isArray(CANDIDATE_ACCEPTANCE_EVIDENCE[scenario])
      && CANDIDATE_ACCEPTANCE_EVIDENCE[scenario].length > 0);
  const scenarios = CANDIDATE_ACCEPTANCE_SCENARIOS.filter((scenario) =>
    CANDIDATE_ACCEPTANCE_EVIDENCE[scenario]?.every((marker) => observedMarkers.has(marker)) === true);
  const passed = checks.every((check) => check.status === 0 && !check.signal && !check.error)
    && evidenceMappingComplete && scenarios.length === CANDIDATE_ACCEPTANCE_SCENARIOS.length;
  return {
    passed,
    scenarios,
    evidence: checks.map(({ stdout, stderr, ...check }) => {
      const failed = check.status !== 0 || check.signal || check.error;
      return {
        ...check,
        outputBytes: Buffer.byteLength(stdout) + Buffer.byteLength(stderr),
        ...(failed ? {
          stdoutExcerpt: acceptanceExcerpt(stdout), stderrExcerpt: acceptanceExcerpt(stderr),
        } : {}),
      };
    }),
  };
}

export async function runCli(argv = process.argv.slice(2), {
  cwd = process.cwd(), env = process.env, spawn = spawnSync,
} = {}) {
  const command = argv.find((arg) => !arg.startsWith('-')) ?? 'help';
  const json = argv.includes('--json');
  try {
    if (command === 'help' || argv.includes('--help') || argv.includes('-h')) {
      process.stdout.write(HELP);
      return 0;
    }
    if (command === 'runtimes') {
      const operation = argv[1] ?? 'list';
      if (operation === 'update') {
        const names = commaList(optionValue(argv, '--runtime'));
        if (!names.length) throw new TorchError('Select --runtime codex,claude,pi', { code: 'RUNTIME_UPDATE_INVALID' });
        const plan = planProviderUpdates(names, { env });
        if (argv.includes('--dry-run') || !argv.includes('--yes')) {
          print({ ...plan, requiresApproval: true }, { json }); return 0;
        }
        print(updateProviders(names, { env, runner: spawn, authorized: true, force: argv.includes('--force') }), { json });
        return 0;
      }
      if (operation === 'update-policy') {
        const repository = inspectRepository(optionValue(argv, '--repo') ?? cwd);
        const config = loadProjectConfig(repository.root);
        const mode = optionValue(argv, '--mode');
        const maxAge = Number(optionValue(argv, '--max-age-hours') ?? 24);
        const policy = { mode, max_age_hours: maxAge };
        const names = optionValue(argv, '--runtime') === undefined
          ? Object.keys(config.runtimes).filter(name => name !== 'default')
          : commaList(optionValue(argv, '--runtime'));
        planProviderUpdates(names, { env });
        for (const name of names) {
          if (!Object.hasOwn(config.runtimes, name)) throw new TorchError('Runtime is not configured', { code: 'RUNTIME_UPDATE_INVALID', details: { name } });
          config.runtimes[name].updatePolicy = policy;
        }
        validateProjectConfig(config);
        if (argv.includes('--dry-run') || !argv.includes('--yes')) {
          print({ policy, runtimes: names, requiresApproval: true, mutationPerformed: false }, { json }); return 0;
        }
        print({ path: persistProfileConfig(repository.root, config), policy, runtimes: names,
          sessionsStarted: false, mutationPerformed: true }, { json });
        return 0;
      }
      if (operation === 'list') {
        const builtIns = createRuntimeAdapterRegistry({ env, loadPlugins: false }).names();
        let trust;
        try { trust = inspectRuntimePluginTrust({ env }); } catch (error) {
          trust = {
            path: runtimePluginTrustPath(env), status: 'invalid',
            error: { code: error.code ?? 'RUNTIME_PLUGIN_STORE_INVALID', message: error.message },
          };
        }
        print({
          schema: 'torch.dev/runtime-catalog/v1alpha1', builtIns,
          trust, mutationPerformed: false,
          executesPluginCode: false,
        }, { json });
        return 0;
      }
      if (operation === 'trust') {
        const name = optionValue(argv, '--name');
        const modulePath = optionValue(argv, '--module');
        const plan = planRuntimePluginTrust({ name, modulePath, env });
        if (!argv.includes('--yes')) {
          print({ ...plan, requiresApproval: true }, { json });
          return 0;
        }
        print(trustRuntimePlugin({
          name, modulePath, env, approved: true, expectedSha256: optionValue(argv, '--sha256'),
        }), { json });
        return 0;
      }
      if (operation === 'revoke') {
        const name = optionValue(argv, '--name');
        const plan = planRuntimePluginRevoke({ name, env });
        if (!argv.includes('--yes') || plan.sha256 === null) {
          print({ ...plan, requiresApproval: plan.sha256 !== null }, { json });
          return 0;
        }
        print(revokeRuntimePlugin({
          name, env, approved: true, expectedSha256: optionValue(argv, '--sha256'),
        }), { json });
        return 0;
      }
      throw new TorchError(`Unknown runtimes operation: ${operation}`, { code: 'UNKNOWN_COMMAND' });
    }
    if (command === 'candidate') {
      const operation = argv[1] ?? 'status';
      const versions = createVersionService({ env });
      if (operation === 'status') {
        print(versions.status(), { json });
        return 0;
      }
      if (operation === 'test') {
        const version = optionValue(argv, '--version');
        const status = versions.status();
        const validationPath = resolve(status.root, 'versions', version ?? '', '.torch-validation.json');
        if (!version || !status.installed.includes(version)) {
          throw new TorchError('Candidate test receipt requires an installed version', {
            code: 'VERSION_NOT_INSTALLED', details: { version: version ?? null },
          });
        }
        print(JSON.parse(readFileSync(validationPath, 'utf8')), { json });
        return 0;
      }
      const source = optionValue(argv, '--source');
      const version = optionValue(argv, '--version');
      if (operation === 'plan') {
        print(versions.planCandidate({ source: resolve(cwd, source ?? ''), version }), { json });
        return 0;
      }
      if (operation === 'build') {
        if (!argv.includes('--yes')) {
          throw new TorchError('Candidate build copies code and runs its acceptance suite. Review candidate plan, then re-run with --yes.', {
            code: 'APPROVAL_REQUIRED',
          });
        }
        print(versions.installCandidate({
          source: resolve(cwd, source ?? ''), version,
          validate: ({ candidateRoot }) => runCandidateAcceptance(candidateRoot, spawn),
        }), { json });
        return 0;
      }
      throw new TorchError(`Unknown candidate operation: ${operation}`, { code: 'UNKNOWN_COMMAND' });
    }
    if (command === 'upgrade') {
      const versions = createVersionService({ env });
      const version = optionValue(argv, '--version');
      const status = versions.status();
      const plan = {
        action: 'upgrade', from: status.activeVersion, to: version ?? null,
        canProceed: Boolean(version && status.installed.includes(version)), mutationPerformed: false,
      };
      if (argv.includes('--dry-run')) {
        print(plan, { json });
        return plan.canProceed ? 0 : 1;
      }
      if (!argv.includes('--yes')) {
        throw new TorchError('Upgrade atomically changes the active TORCH version. Review --dry-run, then re-run with --yes.', {
          code: 'APPROVAL_REQUIRED',
        });
      }
      print(versions.activate(version), { json });
      return 0;
    }
    if (command === 'rollback') {
      const versions = createVersionService({ env });
      const status = versions.status();
      const plan = {
        action: 'rollback', from: status.activeVersion, to: status.previousVersion,
        canProceed: Boolean(status.previousVersion), mutationPerformed: false,
      };
      if (argv.includes('--dry-run')) {
        print(plan, { json });
        return plan.canProceed ? 0 : 1;
      }
      if (!argv.includes('--yes')) {
        throw new TorchError('Rollback atomically restores the previous TORCH version. Review --dry-run, then re-run with --yes.', {
          code: 'APPROVAL_REQUIRED',
        });
      }
      print(versions.rollback(), { json });
      return 0;
    }
    if (command === 'import') {
      const format = argv[1];
      if (format !== 'combatrig') {
        throw new TorchError(`Unsupported fleet import format: ${format ?? '<missing>'}`, {
          code: 'IMPORT_FORMAT_UNSUPPORTED',
        });
      }
      const source = optionValue(argv, '--source');
      if (!source) throw new TorchError('COMBATRIG import requires --source', { code: 'IMPORT_SOURCE_REQUIRED' });
      const sourceRepository = inspectRepository(resolve(cwd, source));
      const proposal = analyzeCombatrigFleet({ repository: sourceRepository });
      const output = optionValue(argv, '--output');
      if (output) {
        const path = resolve(cwd, output);
        writeNewFile(path, `${JSON.stringify(proposal, null, 2)}\n`);
        print({ proposal, output: path, mutationPerformed: true }, { json });
      } else print({ proposal, mutationPerformed: false }, { json });
      return proposal.compatibility.readyForApproval ? 0 : 1;
    }
    if (command === 'console') {
      const operation = argv[1] ?? 'serve';
      const root = resolve(cwd, optionValue(argv, '--repo') ?? '.');
      if (operation === 'snapshot') {
        print(observeProject({ repositoryRoot: root, env }), { json });
        return 0;
      }
      if (operation === 'serve') {
        const host = optionValue(argv, '--host') ?? '127.0.0.1';
        const port = Number(optionValue(argv, '--port') ?? 4317);
        if (!Number.isInteger(port) || port < 0 || port > 65535) {
          throw new TorchError('Console port must be an integer from 0 through 65535', { code: 'CONSOLE_PORT_INVALID' });
        }
        startConsole({ repositoryRoot: root, env, host, port });
        return 0;
      }
      throw new TorchError(`Unknown console operation: ${operation}`, { code: 'UNKNOWN_COMMAND' });
    }
    if (command === 'architect') {
      const operation = argv[1] ?? 'plan';
      const briefPath = resolve(cwd, optionValue(argv, '--brief') ?? '');
      const brief = loadArchitectArtifact(briefPath, 'Fleet design brief');
      if (operation === 'validate') {
        const responsePath = resolve(cwd, optionValue(argv, '--response') ?? '');
        const proposal = loadArchitectArtifact(responsePath, 'Session Architect proposal');
        const validation = validateArchitectProposal({ brief, proposal });
        print({ proposal, validation, mutationPerformed: false }, { json });
        return validation.valid ? 0 : 1;
      }
      const provider = optionValue(argv, '--provider');
      const model = optionValue(argv, '--model');
      const budgetValue = optionValue(argv, '--max-budget-usd');
      const maxBudgetUsd = budgetValue === undefined ? undefined : Number(budgetValue);
      if (budgetValue !== undefined && (!Number.isFinite(maxBudgetUsd) || maxBudgetUsd <= 0)) {
        throw new TorchError('--max-budget-usd must be a positive number', { code: 'ARCHITECT_BUDGET_INVALID' });
      }
      if (operation === 'plan') {
        print(createArchitectRunPlan({ brief, provider, model, maxBudgetUsd }), { json });
        return 0;
      }
      if (operation === 'run') {
        if (!argv.includes('--yes')) {
          throw new TorchError('Session Architect execution consumes provider quota. Review architect plan, then use --yes.', {
            code: 'APPROVAL_REQUIRED',
          });
        }
        if (provider === 'claude' && maxBudgetUsd === undefined) {
          throw new TorchError('Claude architect execution requires an explicit --max-budget-usd limit.', {
            code: 'ARCHITECT_BUDGET_REQUIRED',
          });
        }
        const output = optionValue(argv, '--output');
        if (!output) throw new TorchError('Architect run requires --output for the validated pending proposal.', { code: 'OUTPUT_REQUIRED' });
        const result = await runSessionArchitect({
          brief, provider, model, maxBudgetUsd, authorized: true,
          executor: (plan) => spawn(plan.command, plan.args, {
            cwd: plan.cwd, input: plan.input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 300_000,
          }),
        });
        const path = resolve(cwd, output);
        writeNewFile(path, `${JSON.stringify(result.proposal, null, 2)}\n`);
        print({ ...result, output: path, mutationPerformed: true }, { json });
        return 0;
      }
      throw new TorchError(`Unknown architect operation: ${operation}`, { code: 'UNKNOWN_COMMAND' });
    }
    const designCommand = ['init', 'analyze', 'domains', 'design', 'bootstrap'].includes(command);
    const repositoryRoot = designCommand ? resolve(cwd, optionValue(argv, '--repo') ?? '.') : cwd;
    const inspectedRepository = inspectRepository(repositoryRoot);
    const repository = designCommand ? inspectedRepository
      : inspectRepository(resolveInstalledProjectRoot(inspectedRepository.root, env));
    if (command === 'profile') {
      const operation = argv[1] ?? 'show';
      const areaId = optionValue(argv, '--area');
      const config = loadProjectConfig(repository.root);
      if (operation === 'defaults') {
        const runtime = optionValue(argv, '--runtime');
        if (!argv.includes('--yes')) {
          throw new TorchError('Changing project runtime defaults affects future launch plans. Review profile show, then re-run with --yes.', {
            code: 'APPROVAL_REQUIRED',
          });
        }
        const registry = createRuntimeAdapterRegistry({ env, loadPlugins: true, pluginNames: [runtime] });
        if (!runtime || runtime === 'default' || !registry.has(runtime)) {
          throw new TorchError(`Runtime adapter is not configured: ${runtime ?? '<missing>'}`, {
            code: 'RUNTIME_ADAPTER_MISSING', details: { runtime: runtime ?? null },
          });
        }
        const model = optionValue(argv, '--model');
        const reasoning = optionValue(argv, '--reasoning');
        const policyOptions = launchPolicyOptions(argv);
        const reset = argv.includes('--reset');
        const resetLaunchPolicy = argv.includes('--reset-launch-policy');
        const beforeSettings = structuredClone(config.runtimes[runtime] ?? registry.configuration(runtime) ?? {});
        if (reset && (model !== undefined || reasoning !== undefined || Object.keys(policyOptions).length || resetLaunchPolicy)) {
          throw new TorchError('--reset cannot be combined with profile values.', { code: 'RUNTIME_PROFILE_INVALID' });
        }
        if (resetLaunchPolicy && (Object.keys(policyOptions).length || reset)) {
          throw new TorchError('--reset-launch-policy cannot be combined with launch-policy values or --reset.', { code: 'RUNTIME_PROFILE_INVALID' });
        }
        if (!reset && model === undefined && reasoning === undefined && !Object.keys(policyOptions).length && !resetLaunchPolicy) {
          throw new TorchError('Set --model, --reasoning, --launch-policy, or use a reset option.', { code: 'RUNTIME_PROFILE_INVALID' });
        }
        if (!Object.hasOwn(config.runtimes, runtime)) config.runtimes[runtime] = registry.configuration(runtime) ?? {};
        if (!reset && (Object.keys(policyOptions).length || resetLaunchPolicy)) {
          migrateLegacyRuntimeLaunchPolicy(runtime, config.runtimes[runtime], registry.get(runtime));
        }
        if (reset) {
          delete config.runtimes[runtime].model;
          delete config.runtimes[runtime].reasoning;
          delete config.runtimes[runtime].launchPolicy;
        } else {
          if (model !== undefined) config.runtimes[runtime].model = model;
          if (reasoning === 'none') delete config.runtimes[runtime].reasoning;
          else if (reasoning !== undefined) config.runtimes[runtime].reasoning = reasoning;
          if (resetLaunchPolicy) delete config.runtimes[runtime].launchPolicy;
          else if (Object.keys(policyOptions).length) {
            config.runtimes[runtime].launchPolicy = {
              ...(config.runtimes[runtime].launchPolicy ?? {}), ...policyOptions,
            };
          }
        }
        assertRuntimeDefaultsSupported(config, runtime, registry);
        const path = persistProfileConfig(repository.root, config);
        const profile = {
          model: config.runtimes[runtime].model ?? registry.configuration(runtime)?.model ?? null,
          reasoning: config.runtimes[runtime].reasoning ?? registry.configuration(runtime)?.reasoning ?? null,
          launchPolicy: resolveLaunchPolicy({
            runtime, adapterDefaults: registry.configuration(runtime), runtimeConfig: config.runtimes[runtime],
          }),
        };
        withControlPlane(repository, env, (controlPlane) => controlPlane.auditOwnerAction({
          actorId: 'owner', operation: 'profile.change', entityType: 'runtime-default', entityId: runtime,
          details: { before: beforeSettings, after: config.runtimes[runtime], effectiveProfile: profile, currentHead: repository.head },
        }));
        print({
          runtime, profile,
          path, mutationPerformed: true,
          sessionsStarted: false, existingSessionChanged: false,
        }, { json });
        return 0;
      }
      if (!areaId) throw new TorchError('Runtime profile commands require --area <id>.', { code: 'FLEET_IDENTITY_REQUIRED' });
      const identity = areaId === 'session-manager'
        ? config.session_manager : config.domains.find((area) => area.id === areaId);
      if (!identity) throw new TorchError(`Unknown Fleet identity: ${areaId}`, { code: 'FLEET_IDENTITY_MISSING' });
      if (operation === 'show') {
        print(effectiveProfile(config, areaId, createRuntimeAdapterRegistry({ env })), { json });
        return 0;
      }
      if (operation !== 'set') throw new TorchError(`Unknown profile operation: ${operation}`, { code: 'UNKNOWN_COMMAND' });
      const dryRun = argv.includes('--dry-run');
      if (!dryRun && !argv.includes('--yes')) {
        throw new TorchError('Changing a project runtime profile affects future launch plans. Review profile show, then re-run with --yes.', {
          code: 'APPROVAL_REQUIRED',
        });
      }
      const requestedRuntime = optionValue(argv, '--runtime');
      const requestedModel = optionValue(argv, '--model');
      const inheritModel = argv.includes('--inherit-model');
      const requestedReasoning = optionValue(argv, '--reasoning');
      const policyOptions = launchPolicyOptions(argv);
      const reset = argv.includes('--reset');
      const resetLaunchPolicy = argv.includes('--reset-launch-policy');
      const registry = createRuntimeAdapterRegistry({
        env, loadPlugins: true,
        pluginNames: [...new Set([identity.runtime ?? config.runtimes.default, requestedRuntime].filter(Boolean))],
      });
      if (inheritModel && requestedModel !== undefined) {
        throw new TorchError('--inherit-model cannot be combined with --model.', { code: 'RUNTIME_PROFILE_INVALID' });
      }
      if (reset && (requestedRuntime !== undefined || requestedModel !== undefined || inheritModel || requestedReasoning !== undefined
        || Object.keys(policyOptions).length || resetLaunchPolicy)) {
        throw new TorchError('--reset cannot be combined with profile values.', { code: 'RUNTIME_PROFILE_INVALID' });
      }
      if (resetLaunchPolicy && (Object.keys(policyOptions).length || reset)) {
        throw new TorchError('--reset-launch-policy cannot be combined with launch-policy values or --reset.', { code: 'RUNTIME_PROFILE_INVALID' });
      }
      if (!reset && requestedRuntime === undefined && requestedModel === undefined && !inheritModel && requestedReasoning === undefined
        && !Object.keys(policyOptions).length && !resetLaunchPolicy) {
        throw new TorchError('Set at least one profile value or use a reset option.', {
          code: 'RUNTIME_PROFILE_INVALID',
        });
      }
      const beforeProfile = effectiveProfile(config, areaId, registry);
      if (requestedRuntime !== undefined) {
        if (!registry.has(requestedRuntime) || requestedRuntime === 'default') {
          throw new TorchError(`Runtime adapter is not configured: ${requestedRuntime}`, {
            code: 'RUNTIME_ADAPTER_MISSING', details: { runtime: requestedRuntime },
          });
        }
        if (!Object.hasOwn(config.runtimes, requestedRuntime)) {
          config.runtimes[requestedRuntime] = registry.configuration(requestedRuntime) ?? {};
        }
        identity.runtime = requestedRuntime;
      }
      if (reset) {
        delete identity.model;
        delete identity.reasoning;
        delete identity.launchPolicy;
      } else {
        if (requestedModel !== undefined) identity.model = requestedModel;
        else if (inheritModel) delete identity.model;
        if (requestedReasoning === 'none') delete identity.reasoning;
        else if (requestedReasoning !== undefined) identity.reasoning = requestedReasoning;
        if (resetLaunchPolicy) delete identity.launchPolicy;
        else if (Object.keys(policyOptions).length) identity.launchPolicy = {
          ...(identity.launchPolicy ?? {}), ...policyOptions,
        };
      }
      assertEffectiveProfileSupported(config, areaId, registry);
      const profile = effectiveProfile(config, areaId, registry);
      const configPath = resolve(repository.root, '.torch', 'torch.yaml');
      const configSha256 = fileHash(configPath);
      const expectedConfigHash = optionValue(argv, '--expect-config-sha256');
      if (expectedConfigHash && expectedConfigHash !== configSha256) {
        throw new TorchError('Runtime configuration changed after review; inspect a fresh profile plan.', {
          code: 'RUNTIME_PROFILE_REVIEW_STALE',
        });
      }
      if (dryRun) {
        print({
          action: 'change-runtime-profile', beforeProfile, profile,
          configSha256,
          effect: 'Updates this identity’s profile for future launch plans only. It does not change or start a running session.',
          mutationPerformed: false, sessionsStarted: false, existingSessionChanged: false,
        }, { json });
        return 0;
      }
      const path = persistProfileConfig(repository.root, config);
      withControlPlane(repository, env, (controlPlane) => controlPlane.auditOwnerAction({
        actorId: 'owner', operation: 'profile.change', entityType: 'runtime-profile', entityId: areaId,
        details: { before: beforeProfile, after: profile, currentHead: repository.head },
      }));
      print({
        profile, path, mutationPerformed: true,
        sessionsStarted: false, existingSessionChanged: false,
      }, { json });
      return 0;
    }
    if (command === 'init' || command === 'analyze') {
      const specifications = inspectSpecifications(optionValues(argv, '--spec'), {
        cwd, repositoryRoot: repository.root,
      });
      const analysis = analyzeRepository(repository, { specifications });
      print({
        command, repository, analysis,
        next: 'Run torch bootstrap with the same inputs for an AI Session Architect brief, or torch design for the deterministic baseline. Review the resulting proposal before install.',
      }, { json });
      return 0;
    }
    if (command === 'domains' || command === 'design' || command === 'bootstrap') {
      const specifications = inspectSpecifications(optionValues(argv, '--spec'), {
        cwd, repositoryRoot: repository.root,
      });
      const analysis = analyzeRepository(repository, { specifications });
      const proposal = proposeDomains({ repository, analysis });
      const artifact = command === 'bootstrap'
        ? createFleetDesignBrief({ repository, analysis, baseline: proposal })
        : proposal;
      const output = optionValue(argv, '--output');
      if (output) {
        const path = resolve(cwd, output);
        writeNewFile(path, `${JSON.stringify(artifact, null, 2)}\n`);
        print({ [command === 'bootstrap' ? 'brief' : 'proposal']: artifact, output: path, mutationPerformed: true }, { json });
      } else {
        print({ [command === 'bootstrap' ? 'brief' : 'proposal']: artifact, mutationPerformed: false }, { json });
      }
      return 0;
    }
    if (command === 'install') {
      if (argv.includes('--restore')) {
        const result = restoreProject({ repository, env, dryRun: argv.includes('--dry-run'), authorized: argv.includes('--yes') });
        print(result, { json });
        return 0;
      }
      const proposalPath = optionValue(argv, '--proposal');
      const runtimeOption = optionValue(argv, '--runtime');
      const defaultRuntime = optionValue(argv, '--default-runtime');
      const runtimes = runtimeOption === undefined ? undefined : commaList(runtimeOption);
      if (argv.includes('--dry-run')) {
        const proposal = loadProposal(cwd, proposalPath);
        const plan = planInstall({
          repository, proposal, env, runtimes, defaultRuntime,
          runtimeRegistry: createRuntimeAdapterRegistry({
            env, loadPlugins: true, pluginNames: [...(runtimes ?? proposalRuntimeNames(proposal)), ...[defaultRuntime].filter(Boolean)],
          }),
        });
        print({ ...plan, proposal: resolve(cwd, proposalPath),
          ...(argv.includes('--update-runtimes') ? { providerUpdates: planProviderUpdates(plan.runtimes, { env }) } : {}),
        }, { json });
        return 0;
      }
      if (!argv.includes('--yes')) {
        throw new TorchError('Installation requires reviewed approval. Re-run with --dry-run, then --yes.', {
          code: 'APPROVAL_REQUIRED',
        });
      }
      const proposal = loadProposal(cwd, proposalPath);
      if (argv.includes('--update-runtimes')) {
        const installPlan = planInstall({ repository, proposal, env, runtimes, defaultRuntime });
        if (!installPlan.canProceed) throw new TorchError('Install plan has blockers', { code: 'INSTALL_BLOCKED', details: installPlan.blockers });
        updateProviders(installPlan.runtimes, { env, runner: spawn, authorized: true });
      }
      const installed = installProject({
        repository, proposal, env, runtimes, defaultRuntime,
        runtimeRegistry: createRuntimeAdapterRegistry({
          env, loadPlugins: true, pluginNames: [...(runtimes ?? proposalRuntimeNames(proposal)), ...[defaultRuntime].filter(Boolean)],
        }),
      });
      if (argv.includes('--update-runtimes')) {
        const config = loadProjectConfig(repository.root);
        for (const name of Object.keys(config.runtimes).filter(name => name !== 'default')) {
          config.runtimes[name].updatePolicy = { mode: 'auto', max_age_hours: 24 };
        }
        persistProfileConfig(repository.root, config);
      }
      print(argv.includes('--setup') ? { ...installed, setup: setupProject({ repository: inspectRepository(repository.root), env, authorized: true, parentOverride: optionValue(argv, '--parent') }) } : installed, { json });
      return 0;
    }
    if (command === 'setup') {
      print(setupProject({ repository, env, authorized: argv.includes('--yes'), dryRun: argv.includes('--dry-run'), parentOverride: optionValue(argv, '--parent') }), { json });
      return 0;
    }
    if (command === 'doctor') {
      const diagnosis = diagnoseProject({ repository, env });
      print(diagnosis, { json });
      return diagnosis.healthy ? 0 : 1;
    }
    if (command === 'worktrees') {
      const parentOverride = optionValue(argv, '--parent');
      if (argv.includes('--dry-run')) {
        const plan = planWorktrees({ repository, parentOverride });
        print(plan, { json });
        return plan.canProceed ? 0 : 1;
      }
      if (!argv.includes('--yes')) {
        throw new TorchError('Worktree creation requires a reviewed dry run. Re-run with --dry-run, then --yes.', {
          code: 'APPROVAL_REQUIRED',
        });
      }
      print(createWorktrees({ repository, parentOverride }), { json });
      return 0;
    }
    if (command === 'up') {
      const updateConfig = loadProjectConfig(repository.root);
      if (argv.includes('--yes') && !argv.includes('--dry-run')) {
        const selected = optionValue(argv, '--only') === undefined ? undefined : commaList(optionValue(argv, '--only'));
        for (const name of configuredRuntimeNames(repository.root, selected)) {
          const policy = updateConfig.runtimes[name]?.updatePolicy;
          if (policy?.mode === 'auto') updateProviders([name], {
            env, runner: spawn, authorized: true, maxAgeHours: policy.max_age_hours,
          });
        }
      }
      const control = openControlPlane({ repositoryRoot: repository.root, env });
      try {
        const only = optionValue(argv, '--only') === undefined ? undefined : commaList(optionValue(argv, '--only'));
        const adapters = runtimeAdapters(env, configuredRuntimeNames(repository.root, only));
        const plan = planFleetUp({
          repositoryRoot: repository.root, controlPlane: control, adapters, fresh: argv.includes('--fresh'),
          only,
        });
        if (argv.includes('--dry-run')) {
          print(plan, { json });
          return plan.canProceed ? 0 : 1;
        }
        if (!argv.includes('--yes')) {
          throw new TorchError('Fleet startup launches configured AI runtimes. Review --dry-run, then re-run with --yes.', {
            code: 'APPROVAL_REQUIRED',
          });
        }
        print(startFleet({
          plan, controlPlane: control, adapters,
          executor: (launch) => executeRuntimeLaunch(spawn, launch, {
            cwd: launch.cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
            maxBuffer: MAX_RUNTIME_EXECUTOR_OUTPUT_BYTES,
          }),
        }), { json });
        return 0;
      } finally {
        control.close();
      }
    }
    if (command === 'down') {
      const control = openControlPlane({ repositoryRoot: repository.root, env });
      try {
        const pluginNames = [...new Set([
          ...configuredRuntimeNames(repository.root), ...activeRuntimeNames(control),
        ])];
        const adapters = runtimeAdapters(env, pluginNames);
        const plan = planFleetDown({ repositoryRoot: repository.root, controlPlane: control, adapters });
        if (argv.includes('--dry-run')) {
          print(plan, { json });
          return plan.canProceed ? 0 : 1;
        }
        if (!argv.includes('--yes')) {
          throw new TorchError('Fleet wind-down stops configured runtime sessions. Review --dry-run, then re-run with --yes.', {
            code: 'APPROVAL_REQUIRED',
          });
        }
        const stoppers = runtimeStoppers(spawn, env, pluginNames);
        print(stopFleet({
          plan, controlPlane: control,
          stopRuntime: (action) => stopThrough(stoppers, action),
        }), { json });
        return 0;
      } finally {
        control.close();
      }
    }
    if (command === 'capture') {
      print(withControlPlane(repository, env, (control) => captureFleet({
        repositoryRoot: repository.root, controlPlane: control,
      })), { json });
      return 0;
    }
    if (command === 'detach') {
      const control = openControlPlane({ repositoryRoot: repository.root, env });
      try {
        const stoppers = runtimeStoppers(spawn, env, activeRuntimeNames(control));
        const plan = planFleetDetach({
          repositoryRoot: repository.root, controlPlane: control, adapters: stoppers,
        });
        if (argv.includes('--dry-run')) {
          print(plan, { json });
          return plan.canProceed ? 0 : 1;
        }
        if (!argv.includes('--yes')) {
          throw new TorchError('Fleet detach stops runtime sessions while preserving organization and worktrees. Review --dry-run, then use --yes.', {
            code: 'APPROVAL_REQUIRED',
          });
        }
        print(detachFleet({
          plan, controlPlane: control, stopRuntime: (action) => stopThrough(stoppers, action),
        }), { json });
        return 0;
      } finally {
        control.close();
      }
    }
    if (command === 'identity') {
      print(withControlPlane(repository, env, (control) => control.identity(optionValue(argv, '--area'))), { json });
      return 0;
    }
    if (command === 'agents' || command === 'list') {
      print(withControlPlane(repository, env, (control) => ({ agents: control.listAgents() })), { json });
      return 0;
    }
    if (command === 'brief') {
      print(withControlPlane(repository, env, (control) => createFleetBrief({
        repositoryRoot: repository.root, controlPlane: control, areaId: optionValue(argv, '--area'),
      })), { json });
      return 0;
    }
    if (command === 'agent') {
      print(withControlPlane(repository, env, (control) => control.getAgent(optionValue(argv, '--area'))), { json });
      return 0;
    }
    if (command === 'roster') {
      print(withControlPlane(repository, env, (control) => control.getRoster()), { json });
      return 0;
    }
    if (command === 'who-owns') {
      print(withControlPlane(repository, env, (control) => control.whoOwns({
        path: optionValue(argv, '--path'), capability: optionValue(argv, '--capability'),
      })), { json });
      return 0;
    }
    if (command === 'neighbours') {
      const areaId = optionValue(argv, '--area');
      print(withControlPlane(repository, env, (control) => ({ areaId, neighbours: control.neighbours(areaId) })), { json });
      return 0;
    }
    if (command === 'message') {
      print(withControlPlane(repository, env, (control) => control.sendMessage({
        sender: optionValue(argv, '--from'), recipient: optionValue(argv, '--to'),
        body: optionValue(argv, '--body'), references: {
          task: optionValue(argv, '--task'), path: optionValue(argv, '--path'),
          commit: optionValue(argv, '--commit'), handoff: optionValue(argv, '--handoff'),
        },
      })), { json });
      return 0;
    }
    if (command === 'inbox') {
      print(withControlPlane(repository, env, (control) => ({
        recipient: optionValue(argv, '--area'),
        messages: control.readMessages({
          recipient: optionValue(argv, '--area'), unacknowledgedOnly: argv.includes('--unacknowledged'),
          limit: Number(optionValue(argv, '--limit') ?? 100),
        }),
      })), { json });
      return 0;
    }
    if (command === 'ack') {
      print(withControlPlane(repository, env, (control) => control.ackMessage({
        recipient: optionValue(argv, '--area'), messageId: optionValue(argv, '--message'),
      })), { json });
      return 0;
    }
    if (command === 'status') {
      print(withControlPlane(repository, env, (control) => control.reportStatus({
        areaId: optionValue(argv, '--area'), state: optionValue(argv, '--state'),
        summary: optionValue(argv, '--summary'), runtime: optionValue(argv, '--runtime'),
        runtimeSessionId: optionValue(argv, '--session'), task: optionValue(argv, '--task'),
      })), { json });
      return 0;
    }
    if (command === 'complete' || command === 'blocked') {
      const input = {
        areaId: optionValue(argv, '--area'), summary: optionValue(argv, '--summary'),
        task: optionValue(argv, '--task'), evidence: optionValue(argv, '--evidence'),
        path: optionValue(argv, '--path'), commit: optionValue(argv, '--commit'),
      };
      print(withControlPlane(repository, env, (control) =>
        (command === 'complete' ? control.reportComplete(input) : control.reportBlocked(input))), { json });
      return 0;
    }
    if (command === 'coordinate') {
      const participants = (optionValue(argv, '--with') ?? '').split(',').filter(Boolean);
      print(withControlPlane(repository, env, (control) => control.requestCoordination({
        sender: optionValue(argv, '--from'), participants, body: optionValue(argv, '--body'),
        task: optionValue(argv, '--task'), path: optionValue(argv, '--path'),
      })), { json });
      return 0;
    }
    if (command === 'handoff') {
      print(withControlPlane(repository, env, (control) => control.requestHandoff({
        sender: optionValue(argv, '--from'), recipient: optionValue(argv, '--to') ?? 'session-manager',
        path: optionValue(argv, '--path'), task: optionValue(argv, '--task'), reason: optionValue(argv, '--reason'),
      })), { json });
      return 0;
    }
    if (command === 'approvals') {
      const operation = argv[1] ?? 'list';
      const control = openControlPlane({ repositoryRoot: repository.root, env });
      try {
        if (operation === 'list') {
          const actorId = optionValue(argv, '--area') ?? 'owner';
          print({ approvals: control.listApprovals({ actorId, status: optionValue(argv, '--status') }) }, { json });
          return 0;
        }
        if (operation === 'decide') {
          const decidedBy = optionValue(argv, '--by');
          if (decidedBy !== 'owner') {
            throw new TorchError('AI approvals must be decided through the bound TORCH MCP identity.', {
              code: 'APPROVER_AUTHORITY_REQUIRED',
            });
          }
          if (!argv.includes('--yes')) {
            throw new TorchError('Owner approval decisions require explicit --yes after reviewing the request.', {
              code: 'APPROVAL_REQUIRED',
            });
          }
          const result = control.decideApproval({
            approvalId: optionValue(argv, '--id'), decidedBy,
            decision: optionValue(argv, '--decision'), note: optionValue(argv, '--note'),
            expectedRevision: Number(optionValue(argv, '--revision')) || undefined,
          });
          print(result, { json });
          return 0;
        }
        throw new TorchError(`Unknown approvals operation: ${operation}`, { code: 'UNKNOWN_COMMAND' });
      } finally {
        control.close();
      }
    }
    if (command === 'fleet') {
      const operation = argv[1] ?? 'changes';
      const control = openControlPlane({ repositoryRoot: repository.root, env });
      try {
        const evolution = new FleetEvolutionService({ repositoryRoot: repository.root, controlPlane: control });
        const hierarchy = new HierarchyEvolutionService({ repositoryRoot: repository.root, controlPlane: control });
        const changeId = optionValue(argv, '--change');
        const hierarchyProposalId = optionValue(argv, '--proposal');
        if (operation === 'hierarchy-assess') print(hierarchy.assess({
          assessor: optionValue(argv, '--from') ?? 'session-manager',
        }), { json });
        else if (operation === 'hierarchy-changes') print({ proposals: hierarchy.list({ state: optionValue(argv, '--state') }) }, { json });
        else if (operation === 'hierarchy-get') print(hierarchy.get(hierarchyProposalId), { json });
        else if (operation === 'hierarchy-propose') {
          const input = loadJsonFile(cwd, optionValue(argv, '--proposal'), {
            label: 'Hierarchy change proposal', code: 'HIERARCHY_PROPOSAL_INVALID',
          });
          print(hierarchy.propose({
            proposer: optionValue(argv, '--from') ?? input.proposer,
            proposal: input.proposal ?? input,
          }), { json });
        } else if (operation === 'hierarchy-decide') {
          if (!argv.includes('--yes')) {
            throw new TorchError('Owner review of a hierarchy proposal requires explicit --yes.', { code: 'APPROVAL_REQUIRED' });
          }
          print(hierarchy.decide({
            proposalId: hierarchyProposalId, decision: optionValue(argv, '--decision'),
            decidedBy: optionValue(argv, '--by'), reason: optionValue(argv, '--reason'),
          }), { json });
        } else if (operation === 'hierarchy-plan') print(hierarchy.planPilot(hierarchyProposalId), { json });
        else if (operation === 'hierarchy-conclusion-plan') print(hierarchy.planConclusion({
          proposalId: hierarchyProposalId, decision: optionValue(argv, '--decision'), reason: optionValue(argv, '--reason'),
        }), { json });
        else if (operation === 'hierarchy-conclude') print(hierarchy.concludePilot({
          proposalId: hierarchyProposalId, decision: optionValue(argv, '--decision'), reason: optionValue(argv, '--reason'),
          planHash: optionValue(argv, '--plan-hash'), decidedBy: optionValue(argv, '--by'), approved: argv.includes('--yes'),
        }), { json });
        else if (operation === 'hierarchy-pilot-reviews') print({ reviews: hierarchy.pilotReviews(hierarchyProposalId) }, { json });
        else if (operation === 'hierarchy-review-pilot') {
          if (!argv.includes('--yes')) throw new TorchError('Recording pilot review evidence requires explicit --yes.', { code: 'APPROVAL_REQUIRED' });
          print(hierarchy.recordPilotReview({ proposalId: hierarchyProposalId,
            reviewer: optionValue(argv, '--from') ?? 'session-manager',
            review: loadJsonFile(cwd, optionValue(argv, '--review'), {
              label: 'Hierarchy pilot review', code: 'HIERARCHY_REVIEW_INVALID',
            }),
          }), { json });
        }
        else if (operation === 'hierarchy-activate') {
          if (!argv.includes('--yes')) {
            throw new TorchError('Hierarchy activation writes and commits tracked organization state. Review hierarchy-plan, then use --yes; no runtime is started.', {
              code: 'APPROVAL_REQUIRED',
            });
          }
          print(hierarchy.activatePilot({
            proposalId: hierarchyProposalId, activatedBy: optionValue(argv, '--by'),
          }), { json });
        }
        else if (operation === 'changes') print({ changes: evolution.list({ state: optionValue(argv, '--state') }) }, { json });
        else if (operation === 'get') print(evolution.get(changeId), { json });
        else if (operation === 'assess') print(evolution.assessDomainNeeds({
          assessor: optionValue(argv, '--from') ?? 'session-manager',
        }), { json });
        else if (operation === 'propose') {
          const input = loadJsonFile(cwd, optionValue(argv, '--proposal'), {
            label: 'Fleet domain proposal', code: 'FLEET_PROPOSAL_INVALID',
          });
          print(evolution.proposeDomain({
            ...input, proposer: optionValue(argv, '--from') ?? input.proposer,
          }), { json });
        } else if (operation === 'propose-retirement') {
          const input = loadJsonFile(cwd, optionValue(argv, '--proposal'), {
            label: 'Fleet domain retirement proposal', code: 'FLEET_PROPOSAL_INVALID',
          });
          print(evolution.proposeRetirement({
            ...input, areaId: input.area_id ?? input.areaId,
            proposer: optionValue(argv, '--from') ?? input.proposer,
          }), { json });
        } else if (operation === 'propose-merge' || operation === 'propose-split') {
          const input = loadJsonFile(cwd, optionValue(argv, '--proposal'), {
            label: 'Fleet boundary proposal', code: 'FLEET_PROPOSAL_INVALID',
          });
          const request = {
            ...input,
            proposer: optionValue(argv, '--from') ?? input.proposer,
            sourceDomains: input.sourceDomains ?? input.source_domains,
            resultDomains: input.resultDomains ?? input.result_domains,
            ownershipAssignments: input.ownershipAssignments ?? input.ownership_assignments,
            expectedBenefit: input.expectedBenefit ?? (input.expected_benefit ? {
              summary: input.expected_benefit.summary,
              recurringWork: input.expected_benefit.recurring_work,
              contextLocality: input.expected_benefit.context_locality,
              coordinationCost: input.expected_benefit.coordination_cost,
            } : undefined),
          };
          print(operation === 'propose-merge'
            ? evolution.proposeMerge(request) : evolution.proposeSplit(request), { json });
        } else if (operation === 'approve') {
          if (!argv.includes('--yes')) {
            throw new TorchError('Owner approval of a Fleet change requires explicit --yes.', { code: 'APPROVAL_REQUIRED' });
          }
          print(evolution.approve({ changeId, approvedBy: optionValue(argv, '--by') }), { json });
        } else if (operation === 'reject') {
          if (!argv.includes('--yes')) {
            throw new TorchError('Owner rejection of a Fleet change requires explicit --yes.', { code: 'APPROVAL_REQUIRED' });
          }
          print(evolution.reject({
            changeId, rejectedBy: optionValue(argv, '--by'), reason: optionValue(argv, '--reason'),
          }), { json });
        } else if (operation === 'plan') print(evolution.planActivation(changeId), { json });
        else if (operation === 'activate') {
          if (!argv.includes('--yes')) {
            throw new TorchError('Fleet activation changes tracked organization state and may create or remove a worktree. Review fleet plan, then use --yes.', {
              code: 'APPROVAL_REQUIRED',
            });
          }
          print(evolution.activate({ changeId, approvedBy: optionValue(argv, '--by') }), { json });
        } else if (operation === 'start') {
          const change = evolution.get(changeId);
          if (change.type !== 'add-domain' || change.state !== 'active') {
            throw new TorchError('Only an active Fleet domain can start a runtime session', {
              code: 'FLEET_CHANGE_STATE_CONFLICT', details: { state: change.state },
            });
          }
          const adapters = runtimeAdapters(env, [
            ...configuredRuntimeNames(repository.root), change.domain.runtime,
          ]);
          const plan = planAreaUp({
            repositoryRoot: repository.root, controlPlane: control, areaId: change.domain.id,
            adapters, fresh: argv.includes('--fresh'),
          });
          if (argv.includes('--dry-run')) {
            print(plan, { json });
            return plan.canProceed ? 0 : 1;
          }
          if (!argv.includes('--yes')) {
            throw new TorchError('Starting the new domain invokes its configured AI runtime. Review --dry-run, then use --yes.', {
              code: 'APPROVAL_REQUIRED',
            });
          }
          print(startFleet({
            plan, controlPlane: control, adapters,
            executor: (launch) => executeRuntimeLaunch(spawn, launch, {
              cwd: launch.cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
              maxBuffer: MAX_RUNTIME_EXECUTOR_OUTPUT_BYTES,
            }),
          }), { json });
        } else throw new TorchError(`Unknown fleet operation: ${operation}`, { code: 'UNKNOWN_COMMAND' });
        return 0;
      } finally {
        control.close();
      }
    }
    if (command === 'backlog') {
      const operation = argv[1] ?? 'list';
      const control = openControlPlane({ repositoryRoot: repository.root, env });
      try {
        const resources = new ResourceService({ repositoryRoot: repository.root, controlPlane: control });
        const checks = new CheckService({
          repositoryRoot: repository.root, controlPlane: control, resourceService: resources,
        });
        const integration = new IntegrationService({
          repositoryRoot: repository.root, controlPlane: control, checkService: checks,
        });
        const backlog = new BacklogService({
          repositoryRoot: repository.root, controlPlane: control, checkService: checks,
          integrationLookup: (requestId) => integration.get(requestId),
        });
        if (operation === 'list') print({ tasks: backlog.list({
          state: optionValue(argv, '--state'), owner: optionValue(argv, '--owner'),
        }) }, { json });
        else if (operation === 'next') print(backlog.next({
          areaId: optionValue(argv, '--area'),
        }), { json });
        else if (operation === 'claim-next') {
          const areaId = optionValue(argv, '--area');
          if (argv.includes('--dry-run')) print(backlog.planClaim({ areaId }), { json });
          else {
            if (!argv.includes('--yes')) throw new TorchError('Self-claim requires explicit --yes and approved project policy.', {
              code: 'APPROVAL_REQUIRED',
            });
            print(backlog.claimNext({ areaId }), { json });
          }
        }
        else if (operation === 'health') print(backlog.health({
          staleAfterDays: optionValue(argv, '--stale-days') === undefined
            ? 7 : Number(optionValue(argv, '--stale-days')),
          staleObservedCommits: optionValue(argv, '--stale-observed-commits') === undefined
            ? 50 : Number(optionValue(argv, '--stale-observed-commits')),
        }), { json });
        else if (operation === 'activity') print(backlog.activity({
          staleDays: optionValue(argv, '--stale-days') === undefined ? undefined : Number(optionValue(argv, '--stale-days')),
          maxCommits: optionValue(argv, '--max-commits') === undefined ? undefined : Number(optionValue(argv, '--max-commits')),
        }), { json });
        else if (operation === 'close-landed') {
          const input = { integrationRequest: optionValue(argv, '--integration'), actorId: optionValue(argv, '--area') };
          if (argv.includes('--dry-run')) print(backlog.planLandedClosure(input), { json });
          else {
            if (!argv.includes('--yes')) throw new TorchError('Landed closure requires explicit --yes.', { code: 'APPROVAL_REQUIRED' });
            print(backlog.reconcileLanded({ ...input, approved: true }), { json });
          }
        }
        else if (operation === 'get') print(backlog.get(optionValue(argv, '--task')), { json });
        else if (operation === 'create') print(backlog.create({
          actorId: optionValue(argv, '--area'), title: optionValue(argv, '--title'),
          description: optionValue(argv, '--description'), priority: optionValue(argv, '--priority') ?? 'normal',
          acceptanceCriteria: commaList(optionValue(argv, '--accept')),
          affectedDomains: commaList(optionValue(argv, '--domains')),
          dependencies: commaList(optionValue(argv, '--depends')),
          observedAt: optionValue(argv, '--observed-at'),
          feature: optionValue(argv, '--feature'), milestone: optionValue(argv, '--milestone'),
        }), { json });
        else if (operation === 'classify') print(backlog.classify({
          taskId: optionValue(argv, '--task'), actorId: optionValue(argv, '--area'),
          expectedRevision: Number(optionValue(argv, '--revision')),
          feature: optionValue(argv, '--feature'), milestone: optionValue(argv, '--milestone'),
          clearFeature: argv.includes('--clear-feature'), clearMilestone: argv.includes('--clear-milestone'),
          reason: optionValue(argv, '--reason'),
        }), { json });
        else if (operation === 'transition') print(backlog.transition({
          taskId: optionValue(argv, '--task'), actorId: optionValue(argv, '--area'),
          to: optionValue(argv, '--state'), expectedRevision: Number(optionValue(argv, '--revision')),
          owner: optionValue(argv, '--owner'), evidence: commaList(optionValue(argv, '--evidence')),
          commit: optionValue(argv, '--commit'), integrationRequest: optionValue(argv, '--integration'),
          blockedReason: optionValue(argv, '--reason'), note: optionValue(argv, '--note'),
        }), { json });
        else throw new TorchError(`Unknown backlog operation: ${operation}`, { code: 'UNKNOWN_COMMAND' });
        return 0;
      } finally {
        control.close();
      }
    }
    if (command === 'context') {
      const operation = argv[1] ?? 'report';
      const control = openControlPlane({ repositoryRoot: repository.root, env });
      try {
        const telemetry = new ContextTelemetryService({ controlPlane: control });
        if (operation === 'report') print(telemetry.report({
          areaId: optionValue(argv, '--area'), task: optionValue(argv, '--task'),
          commit: optionValue(argv, '--commit'), measurement: optionValue(argv, '--measurement'),
        }), { json });
        else if (operation === 'record') print(telemetry.record({
          areaId: optionValue(argv, '--area'), source: optionValue(argv, '--source'),
          measurement: optionValue(argv, '--measurement'), runtime: optionValue(argv, '--runtime'),
          runtimeSessionId: optionValue(argv, '--session'), task: optionValue(argv, '--task'),
          commit: optionValue(argv, '--commit'), cachedInput: optionValue(argv, '--cached-input'),
          uncachedInput: optionValue(argv, '--uncached-input'), cacheCreation: optionValue(argv, '--cache-creation'),
          cacheRead: optionValue(argv, '--cache-read'), compactions: optionValue(argv, '--compactions'),
          resumedPromptBytes: optionValue(argv, '--resumed-prompt-bytes'), costMicrousd: optionValue(argv, '--cost-microusd'),
          verifiedItems: optionValue(argv, '--verified-items'),
        }), { json });
        else throw new TorchError(`Unknown context operation: ${operation}`, { code: 'UNKNOWN_COMMAND' });
        return 0;
      } finally {
        control.close();
      }
    }
    if (command === 'schedules') {
      const operation = argv[1] ?? 'list';
      if (operation === 'launcher') {
        const launcherOperation = argv[2] ?? 'status';
        const launcher = new ScheduleLauncherService({
          repositoryRoot: repository.root, env,
          command: [process.execPath, new URL('../bin/torch.mjs', import.meta.url).pathname],
        });
        if (launcherOperation === 'plan') {
          const plan = launcher.plan();
          print(plan, { json });
          return plan.canProceed ? 0 : 1;
        }
        if (launcherOperation === 'plan-reconcile') {
          const plan = launcher.planReconcile();
          print(plan, { json });
          return plan.canProceed ? 0 : 1;
        }
        if (launcherOperation === 'status') {
          print(launcher.status(), { json });
          return 0;
        }
        if (!['install', 'reconcile', 'remove'].includes(launcherOperation)) {
          throw new TorchError(`Unknown schedule launcher operation: ${launcherOperation}`, { code: 'UNKNOWN_COMMAND' });
        }
        if (!argv.includes('--yes')) {
          throw new TorchError('Persistent schedule launcher changes user systemd state. Review the plan, then re-run with --yes.', {
            code: 'APPROVAL_REQUIRED',
          });
        }
        const result = launcherOperation === 'install' ? launcher.install()
          : launcherOperation === 'reconcile' ? launcher.reconcile() : launcher.remove();
        print(result, { json });
        return 0;
      }
      const control = openControlPlane({ repositoryRoot: repository.root, env });
      try {
        const schedules = new ScheduleService({
          repositoryRoot: repository.root, controlPlane: control,
          wakeManager: {
            plan: ({ managerId, maxUsd }) => {
              const adapters = runtimeAdapters(env, configuredRuntimeNames(repository.root, [managerId]));
              const plan = planAreaUp({
                repositoryRoot: repository.root, controlPlane: control, areaId: managerId,
                adapters, maxCostUsd: maxUsd,
              });
              return { plan, adapters };
            },
            invoke: ({ managerId, maxUsd, prepared }) => {
              const { plan, adapters } = prepared;
              const plannedAction = plan.actions?.find((action) => action.areaId === managerId);
              if (!plan.canProceed || !plannedAction || plan.actions.length !== 1
                || (maxUsd !== undefined && (plannedAction.costCeiling?.enforced !== true
                  || plannedAction.costCeiling.maxUsd !== maxUsd))) {
                throw new TorchError(`Manager runtime wake is blocked for ${managerId}`, {
                  code: 'MANAGER_WAKE_BLOCKED', details: plan.blockers,
                });
              }
              return startFleet({
                plan, controlPlane: control, adapters,
                executor: (launch) => executeRuntimeLaunch(spawn, launch, {
                  cwd: launch.cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
                  timeout: 300_000, maxBuffer: MAX_RUNTIME_EXECUTOR_OUTPUT_BYTES, killSignal: 'SIGTERM',
                }),
              });
            },
          },
        });
        const scheduleId = optionValue(argv, '--id');
        const actorId = optionValue(argv, '--actor') ?? 'owner';
        if (operation === 'dispatch-system') {
          if (!argv.includes('--yes')) throw new TorchError('System schedule dispatch requires installed-launcher approval.', { code: 'APPROVAL_REQUIRED' });
          assertLauncherDigest(repository.root, optionValue(argv, '--launcher-digest'));
          const dispatched = schedules.dispatchSystem({ actorId: 'owner', approved: true });
          print(dispatched, { json });
          return dispatched.runs.every((run) => run.result === 'succeeded') ? 0 : 1;
        }
        if (operation === 'list') print({ schedules: schedules.list({ actorId }) }, { json });
        else if (operation === 'runs') print({ runs: schedules.runs({ scheduleId }) }, { json });
        else if (operation === 'wakes') print({ reservations: schedules.wakeReservations({
          managerId: optionValue(argv, '--manager'),
        }) }, { json });
        else if (operation === 'recover-wake') print(schedules.recoverWake({
          reservationId: optionValue(argv, '--reservation'), actorId,
          approved: argv.includes('--yes'), runtimeStopped: argv.includes('--runtime-stopped'),
          note: optionValue(argv, '--note'),
        }), { json });
        else if (operation === 'plan') print(schedules.plan({ scheduleId, actorId }), { json });
        else if (operation === 'run') {
          const result = schedules.run({ scheduleId, actorId, approved: argv.includes('--yes') });
          print(result, { json });
          return result.result === 'succeeded' ? 0 : 1;
        } else throw new TorchError(`Unknown schedules operation: ${operation}`, { code: 'UNKNOWN_COMMAND' });
        return 0;
      } finally {
        control.close();
      }
    }
    if (command === 'checks') {
      const operation = argv[1] ?? 'list';
      const control = openControlPlane({ repositoryRoot: repository.root, env });
      try {
        const resources = new ResourceService({ repositoryRoot: repository.root, controlPlane: control });
        const checks = new CheckService({
          repositoryRoot: repository.root, controlPlane: control, resourceService: resources,
        });
        if (operation === 'list') print({ checks: checks.listChecks() }, { json });
        else if (operation === 'receipts') print({ receipts: checks.receipts({
          commit: optionValue(argv, '--commit'), checkId: optionValue(argv, '--id'),
          areaId: optionValue(argv, '--area'),
        }) }, { json });
        else if (operation === 'plan') print(checks.plan({
          checkId: optionValue(argv, '--id'), areaId: optionValue(argv, '--area'),
        }), { json });
        else if (operation === 'prepared') print({ prepared: checks.prepared({
          areaId: optionValue(argv, '--area'),
        }) }, { json });
        else if (operation === 'recovery-plan') print(checks.planPreparedRecovery({
          preparedId: optionValue(argv, '--prepared'), actorId: 'owner',
        }), { json });
        else if (operation === 'recover-prepared') print(checks.recoverPrepared({
          preparedId: optionValue(argv, '--prepared'), actorId: 'owner', approved: argv.includes('--yes'),
          executorsStopped: argv.includes('--executors-stopped'), evidence: optionValue(argv, '--evidence'),
        }), { json });
        else if (['run', 'prepare', 'run-prepared', 'cancel-prepared'].includes(operation)) {
          if (!argv.includes('--yes')) {
            throw new TorchError('Configured check execution requires an explicit --yes.', { code: 'APPROVAL_REQUIRED' });
          }
          const input = { checkId: optionValue(argv, '--id'), areaId: optionValue(argv, '--area'),
            preparedId: optionValue(argv, '--prepared') };
          const action = { run: 'run', prepare: 'prepare', 'run-prepared': 'runPrepared', 'cancel-prepared': 'cancelPrepared' }[operation];
          print(checks[action](input), { json });
        } else throw new TorchError(`Unknown checks operation: ${operation}`, { code: 'UNKNOWN_COMMAND' });
        return 0;
      } finally {
        control.close();
      }
    }
    if (command === 'converge') {
      const operation = argv[1] ?? 'plan';
      const control = openControlPlane({ repositoryRoot: repository.root, env });
      try {
        const convergence = new ConvergenceService({ repositoryRoot: repository.root, controlPlane: control });
        const areaId = optionValue(argv, '--area');
        if (operation === 'plan') print(convergence.plan({ areaId }), { json });
        else if (operation === 'guards') print({ guards: convergence.guards(areaId) }, { json });
        else if (operation === 'hold') {
          const type = optionValue(argv, '--type');
          if (!['measurement', 'pin'].includes(type)) {
            throw new TorchError('CLI guards may only hold measurement or pin; check guards are automatic.', {
              code: 'WORKTREE_GUARD_INVALID', details: { type: type ?? null },
            });
          }
          print(convergence.hold({ areaId, type, reason: optionValue(argv, '--reason') }), { json });
        } else if (operation === 'release') {
          const type = optionValue(argv, '--type');
          if (!['measurement', 'pin'].includes(type)) {
            throw new TorchError('CLI guards may only release measurement or pin; check guards are automatic.', {
              code: 'WORKTREE_GUARD_INVALID', details: { type: type ?? null },
            });
          }
          print(convergence.release({ areaId, type }), { json });
        } else if (operation === 'run') {
          if (!argv.includes('--yes')) {
            throw new TorchError('Convergence merges canonical state into a domain worktree. Review converge plan, then re-run with --yes.', {
              code: 'APPROVAL_REQUIRED',
            });
          }
          print(convergence.converge({ areaId }), { json });
        } else throw new TorchError(`Unknown converge operation: ${operation}`, { code: 'UNKNOWN_COMMAND' });
        return 0;
      } finally {
        control.close();
      }
    }
    if (command === 'resources') {
      const operation = argv[1] ?? 'list';
      const control = openControlPlane({ repositoryRoot: repository.root, env });
      try {
        const resources = new ResourceService({ repositoryRoot: repository.root, controlPlane: control });
        const resourceId = optionValue(argv, '--id');
        const areaId = optionValue(argv, '--area');
        if (operation === 'list') print({ resources: resources.list() }, { json });
        else if (operation === 'status') print(resources.status(resourceId), { json });
        else if (operation === 'acquire') print(resources.acquire({ resourceId, areaId }), { json });
        else if (operation === 'release') print(resources.release({ resourceId, areaId }), { json });
        else if (operation === 'cancel') print(resources.cancel({ resourceId, areaId }), { json });
        else throw new TorchError(`Unknown resources operation: ${operation}`, { code: 'UNKNOWN_COMMAND' });
        return 0;
      } finally {
        control.close();
      }
    }
    if (command === 'integrate') {
      const operation = argv[1] ?? 'list';
      const control = openControlPlane({ repositoryRoot: repository.root, env });
      try {
        const resources = new ResourceService({ repositoryRoot: repository.root, controlPlane: control });
        const checks = new CheckService({
          repositoryRoot: repository.root, controlPlane: control, resourceService: resources,
        });
        const integration = new IntegrationService({
          repositoryRoot: repository.root, controlPlane: control, checkService: checks,
        });
        const requestId = optionValue(argv, '--request');
        const actorId = optionValue(argv, '--area');
        if (operation === 'list') print({ requests: integration.list({ state: optionValue(argv, '--state') }) }, { json });
        else if (operation === 'request') print(integration.request({
          areaId: actorId, commit: optionValue(argv, '--commit'),
        }), { json });
        else if (operation === 'evaluate') print(integration.evaluate(requestId), { json });
        else if (operation === 'authorize') print(integration.authorize({ requestId, actorId }), { json });
        else if (operation === 'plan') print(integration.planLanding({ requestId, actorId }), { json });
        else if (operation === 'land') {
          if (!argv.includes('--yes')) {
            throw new TorchError('Landing changes canonical main. Review integrate plan, then re-run with --yes.', {
              code: 'APPROVAL_REQUIRED',
            });
          }
          print(integration.land({ requestId, actorId }), { json });
        } else if (operation === 'drain') {
          if (!argv.includes('--yes')) {
            throw new TorchError('Draining the authorized FIFO integration queue changes canonical main. Review integrate list, then re-run with --yes.', {
              code: 'APPROVAL_REQUIRED',
            });
          }
          const limit = optionValue(argv, '--limit') === undefined ? 50 : Number(optionValue(argv, '--limit'));
          print(integration.drain({ actorId, limit }), { json });
        } else throw new TorchError(`Unknown integrate operation: ${operation}`, { code: 'UNKNOWN_COMMAND' });
        return 0;
      } finally {
        control.close();
      }
    }
    if (command === 'canonical') {
      const operation = argv[1] ?? 'plan';
      if (operation === 'plan') {
        const plan = planLocalCanonical({ repositoryRoot: repository.root });
        print(plan, { json });
        return plan.canProceed ? 0 : 1;
      }
      if (operation === 'create') {
        if (!argv.includes('--yes')) {
          throw new TorchError('Local canonical creation changes Git configuration. Review canonical plan, then use --yes.', {
            code: 'APPROVAL_REQUIRED',
          });
        }
        print(createLocalCanonical({ repositoryRoot: repository.root }), { json });
        return 0;
      }
      throw new TorchError(`Unknown canonical operation: ${operation}`, { code: 'UNKNOWN_COMMAND' });
    }
    if (command === 'recoverability') {
      print(classifyRecoverability({
        repositoryRoot: repository.root, commit: optionValue(argv, '--commit') ?? 'HEAD',
      }), { json });
      return 0;
    }
    if (command === 'artifacts') {
      const operation = argv[1] ?? 'list';
      if (operation === 'list') {
        const snapshot = observeProject({ repositoryRoot: repository.root, env });
        print(snapshot.artifacts ?? { available: false, items: [] }, { json });
        return 0;
      }
      if (operation === 'comment' && !argv.includes('--yes')) {
        const by = optionValue(argv, '--by');
        if (by !== 'owner') throw new TorchError('Artifact feedback preview requires --by owner.', {
          code: 'OWNER_AUTHORITY_REQUIRED',
        });
        const artifactId = optionValue(argv, '--artifact');
        const artifact = (observeProject({ repositoryRoot: repository.root, env }).artifacts?.items ?? [])
          .find((item) => item.id === artifactId);
        if (!artifact) throw new TorchError(`Unknown artifact: ${artifactId}`, { code: 'ARTIFACT_NOT_FOUND' });
        const body = optionValue(argv, '--body');
        if (!body?.trim()) throw new TorchError('Artifact feedback body is required.', { code: 'INVALID_ARTIFACT_INPUT' });
        print({
          schema: 'torch.dev/artifact-feedback-plan/v1alpha1', mutationPerformed: false,
          artifactId, body: body.trim(), by, recipient: artifact.identityId,
          taskId: artifact.taskId, commit: artifact.commit,
          effect: 'Create one durable owner message for the responsible identity, linked to this artifact and backlog task.',
        }, { json });
        return 0;
      }
      const control = openControlPlane({ repositoryRoot: repository.root, env });
      try {
        const backlog = new BacklogService({ repositoryRoot: repository.root, controlPlane: control });
        const artifacts = new ArtifactService({ repositoryRoot: repository.root, controlPlane: control, backlogService: backlog });
        if (operation === 'publish') {
          print(artifacts.publish({
            areaId: optionValue(argv, '--area'), taskId: optionValue(argv, '--task'),
            title: optionValue(argv, '--title'), alt: optionValue(argv, '--alt'),
            file: optionValue(argv, '--file'), commit: optionValue(argv, '--commit'),
          }), { json });
        } else if (operation === 'comment') {
          print(artifacts.comment({
            artifactId: optionValue(argv, '--artifact'), body: optionValue(argv, '--body'),
            by: optionValue(argv, '--by'),
          }), { json });
        } else throw new TorchError(`Unsupported artifacts operation: ${operation}`, { code: 'CLI_USAGE' });
      } finally { control.close(); }
      return 0;
    }
    if (command === 'forge') {
      const operation = argv[1] ?? 'status';
      if (operation === 'fetch') {
        if (argv[2] === 'status') {
          print({ fetches: observeProject({ repositoryRoot: repository.root, env }).canonicalFetches ?? [],
            evidence: 'Recorded operations; running records do not establish live executor state' }, { json });
          return 0;
        }
        if (!argv.includes('--yes')) {
          if (argv[2] !== 'plan') throw new TorchError('Review forge fetch plan, then confirm with --yes.', { code: 'APPROVAL_REQUIRED' });
          print(planCanonicalFetch({ repositoryRoot: repository.root }), { json });
          return 0;
        }
        const result = withControlPlane(repository, env, (controlPlane) => fetchCanonicalObjects({
          repositoryRoot: repository.root, controlPlane, attempts: Number(optionValue(argv, '--attempts') ?? 3),
        }));
        print(result, { json });
        return result.succeeded ? 0 : 1;
      }
      if (operation === 'sync') {
        if ((argv[2] ?? 'plan') === 'plan') {
          const plan = planForgeSync({ repositoryRoot: repository.root });
          print(plan, { json });
          return plan.canProceed ? 0 : 1;
        }
        if (!argv.includes('--yes')) {
          throw new TorchError('Forge sync publishes the current canonical commit to the configured remote. Review forge sync plan, then use --yes.', {
            code: 'APPROVAL_REQUIRED',
          });
        }
        const control = openControlPlane({ repositoryRoot: repository.root, env });
        try {
          print(syncForgeRemote({ repositoryRoot: repository.root, controlPlane: control, actorId: 'owner' }), { json });
        } finally { control.close(); }
        return 0;
      }
      if (operation === 'status') {
        const status = forgeStatus({ repositoryRoot: repository.root });
        print(status, { json });
        return status.available === false ? 1 : 0;
      }
      if (operation === 'plan') {
        const plan = planForgeAttach({
          repositoryRoot: repository.root, remote: optionValue(argv, '--remote'),
          provider: optionValue(argv, '--provider') ?? 'generic-git',
        });
        print(plan, { json });
        return plan.canProceed ? 0 : 1;
      }
      if (operation === 'attach') {
        if (!argv.includes('--yes')) {
          throw new TorchError('Forge attach changes tracked canonical-repository policy. Review forge plan, then use --yes.', {
            code: 'APPROVAL_REQUIRED',
          });
        }
        print(attachForge({
          repositoryRoot: repository.root, remote: optionValue(argv, '--remote'),
          provider: optionValue(argv, '--provider') ?? 'generic-git',
        }), { json });
        return 0;
      }
      if (operation === 'detach') {
        if (argv.includes('--dry-run')) {
          const plan = planForgeDetach({ repositoryRoot: repository.root });
          print(plan, { json });
          return plan.canProceed ? 0 : 1;
        }
        if (!argv.includes('--yes')) {
          throw new TorchError('Forge detach changes tracked canonical-repository policy. Review the current status, then use --yes.', {
            code: 'APPROVAL_REQUIRED',
          });
        }
        print(detachForge({ repositoryRoot: repository.root }), { json });
        return 0;
      }
      throw new TorchError(`Unknown forge operation: ${operation}`, { code: 'UNKNOWN_COMMAND' });
    }
    if (command === 'digest') {
      const operation = argv[1] ?? 'build';
      const control = openControlPlane({ repositoryRoot: repository.root, env });
      try {
        const service = new OwnerDigestService({ repositoryRoot: repository.root, controlPlane: control });
        if (operation === 'build') {
          const report = service.build();
          if (json) print(report, { json }); else process.stdout.write(report.markdown);
        } else if (operation === 'latest') print(service.latest(), { json });
        else if (operation === 'publish') print(service.publish({ actorId: optionValue(argv, '--by'), approved: argv.includes('--yes') }), { json });
        else throw new TorchError('Unknown digest operation', { code: 'UNKNOWN_COMMAND' });
        return 0;
      } finally { control.close(); }
    }
    if (command === 'delivery') {
      const operation = argv[1] ?? 'list';
      if (operation === 'configure') {
        const input = {
          repositoryRoot: repository.root,
          releaseProvider: optionValue(argv, '--release-provider') ?? 'none',
          deploymentProvider: optionValue(argv, '--deployment-provider') ?? 'none',
        };
        if (argv.includes('--dry-run')) {
          const plan = planDeliveryConfiguration(input);
          print(plan, { json });
          return plan.canProceed ? 0 : 1;
        }
        if (!argv.includes('--yes')) {
          throw new TorchError('Delivery adapter configuration changes tracked project policy. Review --dry-run, then use --yes.', {
            code: 'APPROVAL_REQUIRED',
          });
        }
        print(configureDelivery(input), { json });
        return 0;
      }
      const control = openControlPlane({ repositoryRoot: repository.root, env });
      try {
        const resources = new ResourceService({ repositoryRoot: repository.root, controlPlane: control });
        const checks = new CheckService({
          repositoryRoot: repository.root, controlPlane: control, resourceService: resources,
        });
        const delivery = new DeliveryService({
          repositoryRoot: repository.root, controlPlane: control, checkService: checks,
        });
        const deliveryId = optionValue(argv, '--delivery');
        if (operation === 'list') print({ deliveries: delivery.list({ state: optionValue(argv, '--state') }) }, { json });
        else if (operation === 'attempts') print({ attempts: delivery.attempts({ deliveryId }) }, { json });
        else if (operation === 'operations') print({ operations: delivery.operations({ deliveryId }) }, { json });
        else if (operation === 'recover-not-applied') print(delivery.recoverNotApplied({
          operationId: optionValue(argv, '--operation'), actor: optionValue(argv, '--by'),
          approved: argv.includes('--yes'), runtimeStopped: argv.includes('--runtime-stopped'),
          evidence: commaList(optionValue(argv, '--evidence')),
        }), { json });
        else if (operation === 'recover-succeeded') {
          const input = { operationId: optionValue(argv, '--operation'), actor: optionValue(argv, '--by') };
          if (argv.includes('--dry-run')) print(delivery.planSucceededRecovery(input), { json });
          else print(delivery.reconcileSucceeded({ ...input, approved: argv.includes('--yes'),
            runtimeStopped: argv.includes('--runtime-stopped'), evidence: commaList(optionValue(argv, '--evidence')),
          }), { json });
        }
        else if (operation === 'get') print(delivery.get(deliveryId), { json });
        else if (operation === 'create') print(delivery.create({
          sourceArea: optionValue(argv, '--area'), commit: optionValue(argv, '--commit') ?? 'HEAD',
          label: optionValue(argv, '--label'), evidence: commaList(optionValue(argv, '--evidence')),
        }), { json });
        else if (operation === 'plan') {
          const plan = delivery.planTransition({
            deliveryId, targetState: optionValue(argv, '--to'), actor: optionValue(argv, '--by'),
          });
          print(plan, { json });
          return plan.canProceed ? 0 : 1;
        } else if (operation === 'transition') {
          print(delivery.transition({
            deliveryId, targetState: optionValue(argv, '--to'), actor: optionValue(argv, '--by'),
            evidence: commaList(optionValue(argv, '--evidence')), approved: argv.includes('--yes'),
          }), { json });
        } else throw new TorchError(`Unknown delivery operation: ${operation}`, { code: 'UNKNOWN_COMMAND' });
        return 0;
      } finally {
        control.close();
      }
    }
    if (command === 'uninstall') {
      const purge = argv.includes('--purge');
      const dryRun = argv.includes('--dry-run');
      if (!dryRun && !argv.includes('--yes')) {
        throw new TorchError(purge
          ? 'Purging TORCH removes tracked configuration, managed worktrees, and local state. Review --dry-run, then re-run with --purge --yes.'
          : 'Uninstall stops the Fleet and removes owned persistent runtime integrations while preserving project state. Review --dry-run, then re-run with --yes.', {
          code: 'APPROVAL_REQUIRED',
        });
      }
      if (!purge) {
        const control = openControlPlane({ repositoryRoot: repository.root, env });
        try {
          const stoppers = runtimeStoppers(spawn, env, activeRuntimeNames(control));
          const fleet = planFleetDetach({
            repositoryRoot: repository.root, controlPlane: control, adapters: stoppers,
          });
          const launcher = new ScheduleLauncherService({ repositoryRoot: repository.root, env });
          const runtimeIntegrations = launcher.planRemoval();
          const plan = {
            action: 'uninstall', projectId: fleet.projectId, fleet, runtimeIntegrations,
            blockers: [...fleet.blockers, ...runtimeIntegrations.blockers],
            canProceed: fleet.canProceed && runtimeIntegrations.canProceed,
            preserved: ['tracked organization', 'worktrees', 'branches', 'local state'],
            mutationPerformed: false,
          };
          if (dryRun) {
            print(plan, { json });
            return plan.canProceed ? 0 : 1;
          }
          if (!plan.canProceed) throw new TorchError('TORCH uninstall stopped because active work or changed runtime integrations remain', {
            code: 'UNSAFE_TO_UNINSTALL', details: plan.blockers,
          });
          const detached = detachFleet({
            plan: fleet, controlPlane: control, stopRuntime: (action) => stopThrough(stoppers, action),
          });
          const removedRuntimeIntegrations = launcher.remove();
          print({
            ...plan, detached, removedRuntimeIntegrations,
            mutationPerformed: true,
          }, { json });
          return 0;
        } finally {
          control.close();
        }
      }
      const result = uninstallProject({
        repository,
        purge,
        dryRun,
        env,
      });
      print(result, { json });
      return result.canProceed === false ? 1 : 0;
    }
    throw new TorchError(`Unknown command: ${command}`, { code: 'UNKNOWN_COMMAND' });
  } catch (error) {
    print(asErrorRecord(error), { json: true });
    return error instanceof TorchError ? 2 : 1;
  }
}
