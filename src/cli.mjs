import { analyzeRepository } from './kernel/analyze.mjs';
import { diagnoseProject } from './kernel/doctor.mjs';
import { asErrorRecord, TorchError } from './kernel/errors.mjs';
import { inspectRepository } from './kernel/git.mjs';
import { installProject, planInstall, uninstallProject } from './kernel/install.mjs';
import { proposeDomains } from './kernel/domains.mjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeNewFile } from './kernel/files.mjs';

const HELP = `TORCH — portable agent fleet

Usage:
  torch init [--json]
  torch analyze [--json]
  torch domains [--output <path>] [--json]
  torch install --proposal <path> [--dry-run] [--yes] [--json]
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
