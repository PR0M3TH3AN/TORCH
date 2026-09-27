import { analyzeRepository } from './kernel/analyze.mjs';
import { BacklogService } from './backlog/service.mjs';
import { createClaudeAdapter } from './adapters/claude.mjs';
import { createCodexAdapter } from './adapters/codex.mjs';
import { CheckService } from './checks/service.mjs';
import { startConsole } from './console/server.mjs';
import { classifyRecoverability, createLocalCanonical, planLocalCanonical } from './canonical/local.mjs';
import { openControlPlane } from './control-plane/service.mjs';
import { spawnSync } from 'node:child_process';
import { diagnoseProject } from './kernel/doctor.mjs';
import { asErrorRecord, TorchError } from './kernel/errors.mjs';
import { inspectRepository } from './kernel/git.mjs';
import { inspectSpecifications } from './kernel/specifications.mjs';
import { installProject, planInstall, uninstallProject } from './kernel/install.mjs';
import { IntegrationService } from './integration/service.mjs';
import { analyzeCombatrigFleet } from './importers/combatrig.mjs';
import { proposeDomains } from './kernel/domains.mjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeNewFile } from './kernel/files.mjs';
import { createWorktrees, planWorktrees } from './kernel/worktrees.mjs';
import { planAreaUp, planFleetDown, planFleetUp, startFleet, stopFleet } from './runtime/lifecycle.mjs';
import { ResourceService } from './resources/service.mjs';
import { CANDIDATE_ACCEPTANCE_SCENARIOS, createVersionService } from './self-host/service.mjs';
import { observeProject } from './observability/snapshot.mjs';
import { ContextTelemetryService } from './telemetry/context.mjs';
import { ScheduleService } from './schedules/service.mjs';
import { createFleetDesignBrief } from './design/brief.mjs';
import {
  createArchitectRunPlan, loadArchitectArtifact, runSessionArchitect, validateArchitectProposal,
} from './design/architect.mjs';
import { FleetEvolutionService } from './evolution/service.mjs';

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
  torch install --proposal <path> [--dry-run] [--yes] [--json]
  torch worktrees [--parent <path>] [--dry-run] [--yes] [--json]
  torch up [--fresh] [--dry-run] [--yes] [--json]
  torch down [--dry-run] [--yes] [--json]
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
  torch complete --area <id> --summary <text> [--task <id>] [--evidence <text>] [--commit <sha>] [--json]
  torch blocked --area <id> --summary <text> [--task <id>] [--evidence <text>] [--path <path>] [--commit <sha>] [--json]
  torch coordinate --from <id> --body <text> [--with <id,id>] [--task <id>] [--path <path>] [--json]
  torch handoff --from <id> [--to <id>] (--path <path> | --task <id>) --reason <text> [--json]
  torch backlog list [--state <state>] [--owner <id>] [--json]
  torch backlog get --task <id> [--json]
  torch backlog create --area <id> --title <text> --description <text> --accept <text,...> [--priority <priority>] [--domains <id,...>] [--depends <task,...>] [--json]
  torch backlog transition --task <id> --area <id> --state <state> --revision <n> [--owner <id>] [--evidence <text,...>] [--commit <sha>] [--integration <id>] [--reason <text>] [--note <text>] [--json]
  torch checks list [--json]
  torch checks receipts [--commit <sha>] [--id <check>] [--area <id>] [--json]
  torch checks plan --id <check> --area <id> [--json]
  torch checks run --id <check> --area <id> --yes [--json]
  torch resources list [--json]
  torch resources status --id <resource> [--json]
  torch resources acquire --id <resource> --area <id> [--json]
  torch resources release --id <resource> --area <id> [--json]
  torch resources cancel --id <resource> --area <id> [--json]
  torch integrate list [--state <state>] [--json]
  torch integrate request --area <id> [--commit <sha>] [--json]
  torch integrate evaluate --request <id> [--json]
  torch integrate authorize --request <id> --area <id> [--json]
  torch integrate plan --request <id> --area <id> [--json]
  torch integrate land --request <id> --area <id> --yes [--json]
  torch canonical plan [--json]
  torch canonical create --yes [--json]
  torch recoverability [--commit <sha>] [--json]
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
  torch schedules plan --id <schedule> --actor <id|owner> [--json]
  torch schedules run --id <schedule> --actor <id|owner> [--yes] [--json]
  torch fleet changes [--state <state>] [--json]
  torch fleet get --change <id> [--json]
  torch fleet propose --from session-manager --proposal <path> [--json]
  torch fleet approve --change <id> --by <owner> --yes [--json]
  torch fleet plan --change <id> [--json]
  torch fleet activate --change <id> --by <owner> --yes [--json]
  torch fleet start --change <id> [--fresh] [--dry-run] --yes [--json]
  torch doctor [--json]
  torch uninstall [--dry-run] [--purge] [--json]
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

function withControlPlane(repository, env, callback) {
  const controlPlane = openControlPlane({ repositoryRoot: repository.root, env });
  try {
    return callback(controlPlane);
  } finally {
    controlPlane.close();
  }
}

function runtimeAdapters() {
  return new Map([
    ['claude', createClaudeAdapter()],
    ['codex', createCodexAdapter()],
  ]);
}

function runCandidateAcceptance(candidateRoot, spawn) {
  const checks = [
    { id: 'test', args: ['test'] },
    { id: 'lint', args: ['run', 'lint'] },
    { id: 'syntax', args: ['run', 'check'] },
  ].map((check) => {
    const result = spawn('npm', check.args, {
      cwd: candidateRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 300_000,
    });
    return {
      id: check.id, status: result.status ?? (result.error ? 1 : 0),
      signal: result.signal ?? null, error: result.error?.message ?? null,
      stdout: result.stdout ?? '',
    };
  });
  const testOutput = checks.find((check) => check.id === 'test')?.stdout ?? '';
  const evidenceByScenario = new Map([
    ['init-analyze', ['SCN-init-read-only']],
    ['spec-aware-design', ['SCN-spec-fleet-design', 'SCN-cli-spec-design']],
    ['ai-fleet-bootstrap', ['SCN-ai-fleet-bootstrap']],
    ['ai-fleet-planning', ['SCN-ai-fleet-planning']],
    ['fleet-evolution', ['SCN-fleet-evolution', 'SCN-cli-fleet-evolution']],
    ['review-install-roster', ['SCN-cli-domain-review']],
    ['branches-worktrees', ['SCN-worktree-bootstrap']],
    ['runtime-identities', ['SCN-mixed-runtime']],
    ['durable-messaging', ['SCN-durable-message']],
    ['ownership-query', ['SCN-ownership-handoff']],
    ['unsafe-worktree-detection', ['SCN-worktree-purge-safety']],
    ['backlog-integration', ['SCN-backlog-lifecycle', 'SCN-native-integration']],
    ['resource-lifecycle', ['SCN-resource-fifo']],
    ['capture-stop-resume', ['SCN-fleet-fresh-resume']],
    ['detach-uninstall', ['SCN-install-doctor-purge']],
    ['combatrig-compatibility', ['SCN-combatrig-import', 'SCN-cli-combatrig-import']],
    ['product-surface', ['SCN-product-site', 'SCN-console-readonly']],
    ['operations-observability', ['SCN-context-locality', 'SCN-schedule-boundaries', 'SCN-cli-schedules']],
  ]);
  const scenarios = CANDIDATE_ACCEPTANCE_SCENARIOS.filter((scenario) =>
    (evidenceByScenario.get(scenario) ?? []).every((marker) => testOutput.includes(marker)));
  const passed = checks.every((check) => check.status === 0 && !check.signal && !check.error)
    && scenarios.length === CANDIDATE_ACCEPTANCE_SCENARIOS.length;
  return {
    passed,
    scenarios,
    evidence: checks.map(({ stdout, ...check }) => ({
      ...check, outputBytes: Buffer.byteLength(stdout),
    })),
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
    const repository = inspectRepository(repositoryRoot);
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
      const proposalPath = optionValue(argv, '--proposal');
      if (argv.includes('--dry-run')) {
        const proposal = loadProposal(cwd, proposalPath);
        print({ ...planInstall({ repository, proposal, env }), proposal: resolve(cwd, proposalPath) }, { json });
        return 0;
      }
      if (!argv.includes('--yes')) {
        throw new TorchError('Installation requires reviewed approval. Re-run with --dry-run, then --yes.', {
          code: 'APPROVAL_REQUIRED',
        });
      }
      const proposal = loadProposal(cwd, proposalPath);
      print(installProject({ repository, proposal, env }), { json });
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
      const control = openControlPlane({ repositoryRoot: repository.root, env });
      try {
        const adapters = runtimeAdapters();
        const plan = planFleetUp({
          repositoryRoot: repository.root, controlPlane: control, adapters, fresh: argv.includes('--fresh'),
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
          executor: (launch) => spawn(launch.command, launch.args, {
            cwd: launch.cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
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
        const adapters = runtimeAdapters();
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
        const runtimeStoppers = new Map([
          ['claude', createClaudeAdapter({
          runner: (executable, args) => spawn(executable, args, {
            encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
          }),
          })],
          ['codex', createCodexAdapter()],
        ]);
        print(stopFleet({
          plan, controlPlane: control,
          stopRuntime: (action) => runtimeStoppers.get(action.runtime)
            .stopSession({ runtimeSessionId: action.runtimeSessionId }),
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
    if (command === 'agents') {
      print(withControlPlane(repository, env, (control) => ({ agents: control.listAgents() })), { json });
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
    if (command === 'fleet') {
      const operation = argv[1] ?? 'changes';
      const control = openControlPlane({ repositoryRoot: repository.root, env });
      try {
        const evolution = new FleetEvolutionService({ repositoryRoot: repository.root, controlPlane: control });
        const changeId = optionValue(argv, '--change');
        if (operation === 'changes') print({ changes: evolution.list({ state: optionValue(argv, '--state') }) }, { json });
        else if (operation === 'get') print(evolution.get(changeId), { json });
        else if (operation === 'propose') {
          const input = loadJsonFile(cwd, optionValue(argv, '--proposal'), {
            label: 'Fleet domain proposal', code: 'FLEET_PROPOSAL_INVALID',
          });
          print(evolution.proposeDomain({
            ...input, proposer: optionValue(argv, '--from') ?? input.proposer,
          }), { json });
        } else if (operation === 'approve') {
          if (!argv.includes('--yes')) {
            throw new TorchError('Owner approval of a Fleet change requires explicit --yes.', { code: 'APPROVAL_REQUIRED' });
          }
          print(evolution.approve({ changeId, approvedBy: optionValue(argv, '--by') }), { json });
        } else if (operation === 'plan') print(evolution.planActivation(changeId), { json });
        else if (operation === 'activate') {
          if (!argv.includes('--yes')) {
            throw new TorchError('Fleet activation commits configuration and creates a worktree. Review fleet plan, then use --yes.', {
              code: 'APPROVAL_REQUIRED',
            });
          }
          print(evolution.activate({ changeId, approvedBy: optionValue(argv, '--by') }), { json });
        } else if (operation === 'start') {
          const change = evolution.get(changeId);
          if (change.state !== 'active') {
            throw new TorchError('Only an active Fleet domain can start a runtime session', {
              code: 'FLEET_CHANGE_STATE_CONFLICT', details: { state: change.state },
            });
          }
          const adapters = runtimeAdapters();
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
            executor: (launch) => spawn(launch.command, launch.args, {
              cwd: launch.cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
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
          repositoryRoot: repository.root, controlPlane: control,
          integrationLookup: (requestId) => integration.get(requestId),
        });
        if (operation === 'list') print({ tasks: backlog.list({
          state: optionValue(argv, '--state'), owner: optionValue(argv, '--owner'),
        }) }, { json });
        else if (operation === 'get') print(backlog.get(optionValue(argv, '--task')), { json });
        else if (operation === 'create') print(backlog.create({
          actorId: optionValue(argv, '--area'), title: optionValue(argv, '--title'),
          description: optionValue(argv, '--description'), priority: optionValue(argv, '--priority') ?? 'normal',
          acceptanceCriteria: commaList(optionValue(argv, '--accept')),
          affectedDomains: commaList(optionValue(argv, '--domains')),
          dependencies: commaList(optionValue(argv, '--depends')),
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
      const control = openControlPlane({ repositoryRoot: repository.root, env });
      try {
        const schedules = new ScheduleService({ repositoryRoot: repository.root, controlPlane: control });
        const scheduleId = optionValue(argv, '--id');
        const actorId = optionValue(argv, '--actor') ?? 'owner';
        if (operation === 'list') print({ schedules: schedules.list({ actorId }) }, { json });
        else if (operation === 'runs') print({ runs: schedules.runs({ scheduleId }) }, { json });
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
        else if (operation === 'run') {
          if (!argv.includes('--yes')) {
            throw new TorchError('Configured check execution requires an explicit --yes.', { code: 'APPROVAL_REQUIRED' });
          }
          print(checks.run({ checkId: optionValue(argv, '--id'), areaId: optionValue(argv, '--area') }), { json });
        } else throw new TorchError(`Unknown checks operation: ${operation}`, { code: 'UNKNOWN_COMMAND' });
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
    if (command === 'uninstall') {
      const result = uninstallProject({
        repository,
        purge: argv.includes('--purge'),
        dryRun: argv.includes('--dry-run'),
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
