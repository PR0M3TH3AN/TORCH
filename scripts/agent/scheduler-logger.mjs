import fs from 'node:fs/promises';
import path from 'node:path';
import { toYamlScalar } from './scheduler-utils.mjs';

/**
 * Returns an ISO 8601 timestamp string safe for use as a filename component.
 * Colons are replaced with dashes and milliseconds are stripped.
 * Example output: `2026-02-20T07-00-00Z`
 *
 * @returns {string}
 */
export function ts() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');
}

/**
 * Builds a metadata object that includes a standardized `failure_category` field.
 * Used by writeLog() to attach structured failure classification to task logs.
 *
 * @param {string} failureCategory - One of FAILURE_CATEGORY values (e.g. 'lock_backend_error').
 * @param {Object} [extraMetadata={}] - Additional key/value pairs to merge.
 * @returns {Object}
 */
export function categorizeFailureMetadata(failureCategory, extraMetadata = {}) {
  return {
    failure_category: failureCategory,
    ...extraMetadata,
  };
}

/**
 * Writes a task log file to `task-logs/<cadence>/` with YAML frontmatter.
 * File naming: `<ts>__<agent>__<status>.md`
 *
 * The frontmatter includes cadence, agent, status, reason, created_at, platform,
 * and any additional metadata fields. The file body repeats key fields as bullets
 * for human readability.
 *
 * These files are read by getLatestFile(), cmdCheck(), and the dashboard.
 *
 * @param {{ cadence: string, agent: string, status: string, reason: string,
 *           detail?: string, platform?: string, metadata?: Object }} params
 * @returns {Promise<string>} The filename (not full path) of the written log.
 */
export async function writeLog({ cadence, agent, status, reason, detail, platform, metadata = {} }) {
  const logDir = path.resolve(process.cwd(), 'task-logs', cadence);
  await fs.mkdir(logDir, { recursive: true });
  const file = `${ts()}__${agent}__${status}.md`;
  const mergedMetadata = {
    platform: platform || process.env.AGENT_PLATFORM || 'unknown',
    ...metadata,
  };

  const body = [
    '---',
    `cadence: ${cadence}`,
    `agent: ${agent}`,
    `status: ${status}`,
    `reason: ${toYamlScalar(reason)}`,
    detail ? `detail: ${toYamlScalar(detail)}` : null,
    `created_at: ${new Date().toISOString()}`,
    `timestamp: ${new Date().toISOString()}`,
    ...Object.entries(mergedMetadata)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => `${key}: ${toYamlScalar(value)}`),
    '---',
    '',
    `# Scheduler ${status}`,
    '',
    `- reason: ${reason}`,
    detail ? `- detail: ${detail}` : null,
    ...Object.entries(mergedMetadata)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => `- ${key}: ${value}`),
    '',
  ].filter(Boolean).join('\n');
  await fs.writeFile(path.join(logDir, file), body, 'utf8');
  return file;
}

/**
 * Prints a human-readable run summary to stdout.
 * Includes status, agent, prompt path, platform, reason, and the contents of
 * the memory update file (up to 2000 characters, truncated if longer).
 *
 * @param {{ status: string, agent: string, promptPath: string|null, reason: string,
 *           detail?: string, memoryFile?: string, platform: string }} params
 * @returns {Promise<void>}
 */
export async function printRunSummary({ status, agent, promptPath, reason, detail, memoryFile, platform }) {
  let learnings = 'No learnings recorded.';
  if (memoryFile) {
    try {
      const content = await fs.readFile(memoryFile, 'utf8');
      if (content.trim()) {
        learnings = content.trim();
        if (learnings.length > 2000) {
          learnings = learnings.slice(0, 2000) + '\n... (truncated)';
        }
      }
    } catch {
      // ignore read errors
    }
  }

  process.stdout.write('\n================================================================================\n');
  process.stdout.write('Scheduler Run Summary\n');
  process.stdout.write('================================================================================\n');
  process.stdout.write(`Status:    ${status}\n`);
  process.stdout.write(`Agent:     ${agent}\n`);
  process.stdout.write(`Prompt:    ${promptPath || '(none)'}\n`);
  process.stdout.write(`Platform:  ${platform}\n`);
  process.stdout.write(`Reason:    ${reason}\n`);
  if (detail) {
    process.stdout.write(`Detail:    ${detail}\n`);
  }
  process.stdout.write('\nLearnings / Discoveries:\n');
  process.stdout.write(`${learnings}\n`);
  process.stdout.write('================================================================================\n\n');
}

/**
 * Prints the run summary then terminates the process with the given exit code.
 * All normal and failure exit paths in main() go through this function to ensure
 * a summary is always printed before exit.
 *
 * @param {number} code - Exit code (0 = success, 1 = general failure, 2 = backend error).
 * @param {Object|null} summaryData - Data passed to printRunSummary, or null to skip.
 * @returns {Promise<never>}
 */
export async function exitWithSummary(code, summaryData) {
  if (summaryData) {
    await printRunSummary(summaryData);
  }
  process.exit(code);
}
