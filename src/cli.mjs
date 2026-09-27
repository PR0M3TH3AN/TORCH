import { analyzeRepository } from './kernel/analyze.mjs';
import { createClaudeAdapter } from './adapters/claude.mjs';
import { openControlPlane } from './control-plane/service.mjs';
import { spawnSync } from 'node:child_process';
import { diagnoseProject } from './kernel/doctor.mjs';
import { asErrorRecord, TorchError } from './kernel/errors.mjs';
import { inspectRepository } from './kernel/git.mjs';
import { installProject, planInstall, uninstallProject } from './kernel/install.mjs';
import { proposeDomains } from './kernel/domains.mjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeNewFile } from './kernel/files.mjs';
import { createWorktrees, planWorktrees } from './kernel/worktrees.mjs';
import { planFleetDown, planFleetUp, startFleet, stopFleet } from './runtime/lifecycle.mjs';

const HELP = `TORCH — portable agent fleet

Usage:
  torch init [--json]
  torch analyze [--json]
  torch domains [--output <path>] [--json]
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

function withControlPlane(repository, env, callback) {
  const controlPlane = openControlPlane({ repositoryRoot: repository.root, env });
  try {
    return callback(controlPlane);
  } finally {
    controlPlane.close();
  }
}

export async function runCli(argv = process.argv.slice(2), { cwd = process.cwd(), env = process.env } = {}) {
  const command = argv.find((arg) => !arg.startsWith('-')) ?? 'help';
  const json = argv.includes('--json');
  try {
    if (command === 'help' || argv.includes('--help') || argv.includes('-h')) {
      process.stdout.write(HELP);
      return 0;
    }
    const repository = inspectRepository(cwd);
    if (command === 'init' || command === 'analyze') {
      const analysis = analyzeRepository(repository);
      print({ command, repository, analysis, next: 'Review analysis, then run torch install --dry-run.' }, { json });
      return 0;
    }
    if (command === 'domains') {
      const analysis = analyzeRepository(repository);
      const proposal = proposeDomains({ repository, analysis });
      const output = optionValue(argv, '--output');
      if (output) {
        const path = resolve(cwd, output);
        writeNewFile(path, `${JSON.stringify(proposal, null, 2)}\n`);
        print({ proposal, output: path, mutationPerformed: true }, { json });
      } else {
        print({ proposal, mutationPerformed: false }, { json });
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
        const adapter = createClaudeAdapter();
        const plan = planFleetUp({
          repositoryRoot: repository.root, controlPlane: control, adapter, fresh: argv.includes('--fresh'),
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
          plan, controlPlane: control,
          executor: (launch) => spawnSync(launch.command, launch.args, {
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
        const plan = planFleetDown({ repositoryRoot: repository.root, controlPlane: control });
        if (argv.includes('--dry-run')) {
          print(plan, { json });
          return plan.canProceed ? 0 : 1;
        }
        if (!argv.includes('--yes')) {
          throw new TorchError('Fleet wind-down stops configured runtime sessions. Review --dry-run, then re-run with --yes.', {
            code: 'APPROVAL_REQUIRED',
          });
        }
        const adapter = createClaudeAdapter({
          runner: (executable, args) => spawnSync(executable, args, {
            encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
          }),
        });
        print(stopFleet({
          plan, controlPlane: control,
          stopRuntime: (action) => adapter.stopSession({ runtimeSessionId: action.runtimeSessionId }),
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
