import { existsSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { workingTreeFiles, workingTreeFingerprint } from './git.mjs';
import { buildArchitectureGraph } from './domains.mjs';

const LANGUAGE_BY_EXTENSION = new Map([
  ['.js', 'JavaScript'], ['.mjs', 'JavaScript'], ['.cjs', 'JavaScript'],
  ['.ts', 'TypeScript'], ['.tsx', 'TypeScript'], ['.jsx', 'JavaScript'],
  ['.py', 'Python'], ['.rs', 'Rust'], ['.go', 'Go'], ['.java', 'Java'],
  ['.c', 'C'], ['.h', 'C/C++'], ['.cc', 'C++'], ['.cpp', 'C++'],
  ['.cs', 'C#'], ['.rb', 'Ruby'], ['.php', 'PHP'], ['.swift', 'Swift'],
  ['.kt', 'Kotlin'], ['.sh', 'Shell'], ['.bash', 'Shell'], ['.ps1', 'PowerShell'],
  ['.html', 'HTML'], ['.css', 'CSS'], ['.scss', 'CSS'], ['.vue', 'Vue'],
  ['.svelte', 'Svelte'], ['.sol', 'Solidity'],
]);

const MANIFESTS = [
  'package.json', 'pyproject.toml', 'requirements.txt', 'Cargo.toml', 'go.mod',
  'pom.xml', 'build.gradle', 'Makefile', 'CMakeLists.txt', 'Dockerfile',
];

export function analyzeRepository(repository, { specifications = [] } = {}) {
  const workingTree = workingTreeFiles(repository.root);
  const files = workingTree.files;
  const languageCounts = new Map();
  const topLevel = new Set();

  for (const file of files) {
    const language = LANGUAGE_BY_EXTENSION.get(extname(file).toLowerCase());
    if (language) languageCounts.set(language, (languageCounts.get(language) ?? 0) + 1);
    const first = file.split('/')[0];
    if (file.includes('/')) topLevel.add(first);
  }

  const languages = [...languageCounts.entries()]
    .map(([name, files]) => ({ name, files }))
    .sort((a, b) => b.files - a.files || a.name.localeCompare(b.name));
  const manifests = MANIFESTS.filter((file) => files.includes(file));
  const operations = files.filter((file) =>
    /(^|\/)(\.github\/workflows|Dockerfile|docker-compose|vercel\.json|systemd|deploy|release|cron)/i.test(file));
  const testFiles = files.filter((file) => /(^|\/)(test|tests|spec|e2e)(\/|\.|$)/i.test(file));
  const docs = files.filter((file) => /(^|\/)(docs?|README)(\/|\.|$)/i.test(file));
  const sharedCandidates = files.filter((file) =>
    /(^|\/)(package(-lock)?\.json|[^/]*config[^/]*|schema|schemas|types|shared)(\/|\.|$)/i.test(file));

  const checks = [];
  const packagePath = `${repository.root}/package.json`;
  if (existsSync(packagePath)) {
    try {
      const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
      for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
        if (/test|check|lint|type|build|verify|audit/i.test(name)) checks.push({ name, command });
      }
    } catch {
      // The analyzer reports observable repository shape. Invalid manifests are
      // surfaced later by doctor and should not make read-only analysis mutate.
    }
  }

  const scarceResources = [];
  const joined = files.join('\n').toLowerCase();
  if (/playwright|puppeteer|cypress|browser/.test(joined)) scarceResources.push('browser');
  if (/cuda|gpu|webgl|three\.js|threejs/.test(joined)) scarceResources.push('gpu');
  if (/postgres|mysql|sqlite|database/.test(joined)) scarceResources.push('database');

  const result = {
    generatedAt: new Date().toISOString(),
    repository: {
      root: repository.root,
      name: repository.name,
      branch: repository.branch,
      head: repository.head,
      hasRemote: repository.remotes.length > 0,
      workingTreeFingerprint: workingTreeFingerprint(repository.root, files),
    },
    inventory: {
      trackedFileCount: workingTree.trackedFileCount,
      untrackedFileCount: workingTree.untrackedFileCount,
      analyzedFileCount: files.length,
      languages,
      manifests,
      topLevelDirectories: [...topLevel].sort(),
      testFileCount: testFiles.length,
      documentationFileCount: docs.length,
      operations: operations.slice(0, 100),
      sharedSurfaceCandidates: sharedCandidates.slice(0, 100),
      checks,
      scarceResources,
    },
    mutationPerformed: false,
    specifications,
  };
  result.architecture = buildArchitectureGraph({ repository, files });
  return result;
}
