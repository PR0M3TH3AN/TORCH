#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const REQUIRED_ARTIFACTS = [
  { dir: 'src/context', expectedPrefix: 'CONTEXT_' },
  { dir: 'src/todo', expectedPrefix: 'TODO_' },
  { dir: 'src/decisions', expectedPrefix: 'DECISIONS_' },
  { dir: 'src/test_logs', expectedPrefix: 'TEST_LOG_' },
];

function parseArgs(argv) {
  const args = {
    since: null,
    session: null,
    checkFailureNotes: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--since') {
      args.since = argv[i + 1] || null;
      i += 1;
      continue;
    }
    if (value === '--session') {
      args.session = argv[i + 1] || null;
      i += 1;
      continue;
    }
    if (value === '--check-failure-notes') {
      args.checkFailureNotes = true;
    }
  }

  return args;
}

function toMs(iso) {
  if (!iso) return null;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : null;
}

function isNotNeededNote(content) {
  return /\bnot needed\b/i.test(content);
}

async function listRecentFiles(dirPath, sinceMs) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const filePath = path.join(dirPath, entry.name);
      const stat = await fs.stat(filePath);
      if (sinceMs != null && stat.mtimeMs < sinceMs) continue;
      files.push({ name: entry.name, filePath, mtimeMs: stat.mtimeMs });
    }
    return files.sort((a, b) => a.mtimeMs - b.mtimeMs);
  } catch {
    return [];
  }
}

async function hasExplicitNotNeeded(files) {
  for (const file of files) {
    const content = await fs.readFile(file.filePath, 'utf8').catch(() => '');
    if (isNotNeededNote(content)) return true;
  }
  return false;
}

function hasExpectedArtifact(files, { expectedPrefix, session }) {
  if (!files.length) return false;
  if (session) {
    return files.some((file) => file.name.includes(session));
  }
  return files.some((file) => file.name.startsWith(expectedPrefix));
}

async function checkFailureTracking({ sinceMs }) {
  const recentTestLogs = await listRecentFiles(path.resolve(process.cwd(), 'src/test_logs'), sinceMs);
  let sawFailure = false;

  for (const file of recentTestLogs) {
    const content = await fs.readFile(file.filePath, 'utf8').catch(() => '');
    if (/\b(fail|failed|failure|error)\b/i.test(content)) {
      sawFailure = true;
      break;
    }
  }

  if (!sawFailure) {
    return { ok: true, message: null };
  }

  const knownIssuesStat = await fs.stat(path.resolve(process.cwd(), 'KNOWN_ISSUES.md')).catch(() => null);
  const incidents = await listRecentFiles(path.resolve(process.cwd(), 'docs/agent-handoffs/incidents'), sinceMs);

  const touchedKnownIssues = Boolean(knownIssuesStat && (sinceMs == null || knownIssuesStat.mtimeMs >= sinceMs));
  const touchedIncident = incidents.length > 0;

  if (touchedKnownIssues || touchedIncident) {
    return { ok: true, message: null };
  }

  return {
    ok: false,
    message: 'Failure-related output detected in src/test_logs but neither KNOWN_ISSUES.md nor docs/agent-handoffs/incidents/ were updated during this run.',
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sinceMs = toMs(args.since);

  if (args.since && sinceMs == null) {
    console.error(`Invalid --since value: ${args.since}`);
    process.exit(2);
  }

  const missing = [];

  for (const artifact of REQUIRED_ARTIFACTS) {
    const dirPath = path.resolve(process.cwd(), artifact.dir);
    const files = await listRecentFiles(dirPath, sinceMs);
    const hasExpected = hasExpectedArtifact(files, {
      expectedPrefix: artifact.expectedPrefix,
      session: args.session,
    });

    if (hasExpected) continue;

    const hasNotNeeded = await hasExplicitNotNeeded(files);
    if (hasNotNeeded) continue;

    const expectedName = args.session
      ? `${artifact.expectedPrefix}${args.session}.md`
      : `${artifact.expectedPrefix}<timestamp>.md`;
    missing.push(`${artifact.dir}/${expectedName}`);
  }

  if (args.checkFailureNotes) {
    const failureTracking = await checkFailureTracking({ sinceMs });
    if (!failureTracking.ok && failureTracking.message) {
      missing.push(failureTracking.message);
    }
  }

  if (missing.length) {
    console.error('Missing required run artifacts:');
    for (const item of missing) {
      console.error(`- ${item}`);
    }
    process.exit(1);
  }

  console.log('Run artifacts verified.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
