import { analyzeRepository } from './kernel/analyze.mjs';
import { diagnoseProject } from './kernel/doctor.mjs';
import { asErrorRecord, TorchError } from './kernel/errors.mjs';
import { inspectRepository } from './kernel/git.mjs';
import { installProject, planInstall, uninstallProject } from './kernel/install.mjs';

const HELP = `TORCH — portable agent fleet

Usage:
  torch init [--json]
  torch analyze [--json]
  torch install [--dry-run] [--yes] [--json]
  torch doctor [--json]
  torch uninstall [--dry-run] [--purge] [--json]
`;

function print(value, { json = false } = {}) {
  if (json || typeof value !== 'string') process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  else process.stdout.write(`${value}\n`);
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
    if (command === 'install') {
      if (argv.includes('--dry-run')) {
        print(planInstall({ repository, env }), { json });
        return 0;
      }
      if (!argv.includes('--yes')) {
        throw new TorchError('Installation requires reviewed approval. Re-run with --dry-run, then --yes.', {
          code: 'APPROVAL_REQUIRED',
        });
      }
      print(installProject({ repository, env }), { json });
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
