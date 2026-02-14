#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const REQUIRED_ARTIFACTS = [
  {
    dir: 'src/context',
    expectedPrefix: 'CONTEXT_',
    structureCheck: (content) =>
      /\bgoal\b/i.test(content) && /\bscope\b/i.test(content) && /\bconstraints\b/i.test(content),
    structureHint: 'must include goal/scope/constraints',
  },
  {
    dir: 'src/todo',
    expectedPrefix: 'TODO_',
    structureCheck: (content) =>
      /\bpending(?:\s+tasks?)?\b[\s\S]{0,400}^\s*[-*]\s+/im.test(content)
      || /\bcompleted(?:\s+tasks?)?\b[\s\S]{0,400}^\s*[-*]\s+/im.test(content),
    structureHint: 'must include at least one pending or completed item',
  },
  {
    dir: 'src/decisions',
    expectedPrefix: 'DECISIONS_',
    structureCheck: (content) => /\bdecision\b/i.test(content) && /\brationale\b/i.test(content),
    structureHint: 'must include decision + rationale',
  },
  {
    dir: 'src/test_logs',
    expectedPrefix: 'TEST_LOG_',
    structureCheck: (content) => {
      const hasCommand = /(^|\n)\s*[-*]?\s*\**command\**\s*:/im.test(content);
      const hasResult = /(^|\n)\s*[-*]?\s*\**result\**\s*:/im.test(content);
      return hasCommand && hasResult;
    },
    structureHint: 'must include command/result pairs',
  },
];

const FAILURE_KEYWORD_RE = /\b(fail|failed|failure|error)\b/i;
const UNRESOLVED_REFERENCE_RE = /\bunresolved\s+finding(s)?\b|\bunresolved\b/i;

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

function getMatchingArtifacts(files, { expectedPrefix, session }) {
  if (session) {
    return files.filter((file) => file.name.includes(session));
  }
  return files.filter((file) => file.name.startsWith(expectedPrefix));
}

async function hasValidArtifactStructure(files, artifact) {
  for (const file of files) {
    const content = await fs.readFile(file.filePath, 'utf8').catch(() => '');
    if (artifact.structureCheck(content)) {
      return true;
    }
  }
  return false;
}

async function checkFailureTracking({ sinceMs }) {
  const recentTestLogs = await listRecentFiles(path.resolve(process.cwd(), 'src/test_logs'), sinceMs);
  let sawFailure = false;

  for (const file of recentTestLogs) {
    const content = await fs.readFile(file.filePath, 'utf8').catch(() => '');
    if (FAILURE_KEYWORD_RE.test(content)) {
      sawFailure = true;
      break;
    }
  }

  if (!sawFailure) {
    return { ok: true, message: null };
  }

  const knownIssuesPath = path.resolve(process.cwd(), 'KNOWN_ISSUES.md');
  const knownIssuesStat = await fs.stat(knownIssuesPath).catch(() => null);
  const knownIssuesContent = await fs.readFile(knownIssuesPath, 'utf8').catch(() => '');
  const incidents = await listRecentFiles(path.resolve(process.cwd(), 'docs/agent-handoffs/incidents'), sinceMs);

  const touchedKnownIssues = Boolean(knownIssuesStat && (sinceMs == null || knownIssuesStat.mtimeMs >= sinceMs));
  const knownIssuesHasExplicitReference = touchedKnownIssues
    && UNRESOLVED_REFERENCE_RE.test(knownIssuesContent)
    && FAILURE_KEYWORD_RE.test(knownIssuesContent);

  let incidentHasExplicitReference = false;
  for (const incident of incidents) {
    const incidentContent = await fs.readFile(incident.filePath, 'utf8').catch(() => '');
    if (UNRESOLVED_REFERENCE_RE.test(incidentContent) && FAILURE_KEYWORD_RE.test(incidentContent)) {
      incidentHasExplicitReference = true;
      break;
    }
  }

  if (knownIssuesHasExplicitReference || incidentHasExplicitReference) {
    return { ok: true, message: null };
  }

  return {
    ok: false,
    message: 'Failure-related output detected in src/test_logs; add an explicit unresolved-finding reference (with failure context) in updated KNOWN_ISSUES.md or a new incident note.',
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
    const matchingArtifacts = getMatchingArtifacts(files, {
      expectedPrefix: artifact.expectedPrefix,
      session: args.session,
    });

    if (!matchingArtifacts.length) {
      const hasNotNeeded = await hasExplicitNotNeeded(files);
      if (hasNotNeeded) continue;

      const expectedName = args.session
        ? `${artifact.expectedPrefix}${args.session}.md`
        : `${artifact.expectedPrefix}<timestamp>.md`;
      missing.push(`${artifact.dir}/${expectedName}`);
      continue;
    }

    const hasValidStructure = await hasValidArtifactStructure(matchingArtifacts, artifact);
    if (!hasValidStructure) {
      missing.push(`${artifact.dir}: ${artifact.structureHint}`);
    }
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
