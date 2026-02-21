import {
  rollbackPrompt as _rollbackPrompt,
  listPromptVersions as _listPromptVersions
} from './services/governance/index.js';
import { ExitError } from './errors.mjs';

export async function cmdRollback(target, strategy, options = {}, deps = {}) {
  // Backwards compatibility: if options is destructured directly
  const { list = false } = options;

  const {
    rollbackPrompt = _rollbackPrompt,
    listPromptVersions = _listPromptVersions,
    log = console.log,
    error = console.error
  } = deps;

  if (!target) {
    error('Usage: torch-lock rollback --target <path> [--strategy <hash|latest>] [--list]');
    throw new ExitError(1, 'Missing target');
  }

  if (list) {
    try {
      const versions = await listPromptVersions(target);
      log(JSON.stringify(versions, null, 2));
    } catch (e) {
      error(`Failed to list versions: ${e.message}`);
      throw new ExitError(1, 'List versions failed');
    }
    return;
  }

  const effectiveStrategy = strategy || 'latest';

  try {
    const result = await rollbackPrompt(target, effectiveStrategy);
    log(JSON.stringify(result, null, 2));
  } catch (e) {
    error(`Rollback failed: ${e.message}`);
    throw new ExitError(1, 'Rollback failed');
  }
}
