import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { TorchError } from './errors.mjs';

const MAX_SPEC_BYTES = 2 * 1024 * 1024;
const GENERIC_HEADINGS = new Set([
  'abstract', 'appendix', 'background', 'conclusion', 'contents', 'introduction',
  'overview', 'references', 'summary', 'table of contents',
]);
const DOMAIN_TERMS = /\b(?:agent|api|architecture|art|audio|backend|cli|client|content|data|database|design|documentation|domain|frontend|gameplay|integration|migration|mobile|operations|performance|qa|release|runtime|security|service|session|testing|tooling|ui|web|worker)\b/i;
const REQUIREMENT = /\b(?:must|should|shall|required|requires|need(?:s)? to|will)\b/i;

function digest(content) {
  return createHash('sha256').update(content).digest('hex');
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'project';
}

function plain(value) {
  return value
    .replace(/<!--[^]*?-->/g, ' ')
    .replace(/```[^]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_>#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pathReferences(content) {
  const found = new Set();
  for (const match of content.matchAll(/`([^`\n]+)`/g)) {
    const value = match[1].trim().replaceAll('\\', '/');
    if (value.length <= 180 && !value.includes(' ') && (value.includes('/') || /\.[a-z0-9]{1,8}$/i.test(value))) {
      found.add(value.replace(/^\.\//, ''));
    }
  }
  return [...found].slice(0, 40);
}

function responsibilities(content) {
  const lines = content.split('\n').map((line) => line.trim()).filter(Boolean);
  const selected = [];
  for (const line of lines) {
    const bullet = line.match(/^(?:[-*+] |\d+[.)] )(.+)/)?.[1];
    const candidate = plain(bullet ?? line);
    if (candidate.length < 12 || candidate.length > 300) continue;
    if (bullet || REQUIREMENT.test(candidate)) selected.push(candidate);
    if (selected.length === 8) break;
  }
  if (!selected.length) {
    const first = plain(content).split(/(?<=[.!?])\s+/).find((sentence) => sentence.length >= 12);
    if (first) selected.push(first.slice(0, 300));
  }
  return selected;
}

function sections(content) {
  const headings = [...content.matchAll(/^(#{1,4})\s+(.+?)\s*$/gm)];
  return headings.map((match, index) => {
    const start = match.index + match[0].length;
    const end = headings[index + 1]?.index ?? content.length;
    const body = content.slice(start, end).trim();
    const title = plain(match[2]);
    const line = content.slice(0, match.index).split('\n').length;
    const paths = pathReferences(body);
    const explicitDomain = DOMAIN_TERMS.test(title);
    return {
      id: slug(title), title, level: match[1].length, line,
      responsibilities: responsibilities(body), pathReferences: paths,
      explicitDomain,
    };
  }).filter((section) => section.title
    && !GENERIC_HEADINGS.has(section.title.toLowerCase())
    && (section.responsibilities.length || section.pathReferences.length));
}

function displayPath(path, repositoryRoot) {
  if (!repositoryRoot) return path;
  const name = relative(repositoryRoot, path);
  return name && !name.startsWith(`..${sep}`) && name !== '..' ? name : path;
}

export function inspectSpecifications(paths = [], { cwd = process.cwd(), repositoryRoot = null } = {}) {
  const unique = [...new Set(paths.map((path) => resolve(cwd, path)))];
  return unique.map((path) => {
    if (!existsSync(path) || !statSync(path).isFile()) {
      throw new TorchError(`Specification is not a readable file: ${path}`, {
        code: 'SPECIFICATION_NOT_FOUND', details: { path },
      });
    }
    const bytes = statSync(path).size;
    if (bytes > MAX_SPEC_BYTES) {
      throw new TorchError(`Specification exceeds ${MAX_SPEC_BYTES} bytes: ${path}`, {
        code: 'SPECIFICATION_TOO_LARGE', details: { path, bytes, maximum: MAX_SPEC_BYTES },
      });
    }
    const content = readFileSync(path, 'utf8');
    const analyzedSections = sections(content);
    const requirements = responsibilities(content).slice(0, 20);
    return {
      path: displayPath(path, repositoryRoot),
      absolutePath: path,
      sha256: digest(content), bytes,
      title: analyzedSections[0]?.level === 1 ? analyzedSections[0].title : null,
      requirements,
      sections: analyzedSections.slice(0, 80),
      domainSignals: analyzedSections.filter((section) => section.explicitDomain).slice(0, 40),
    };
  });
}

export function validateSpecificationEvidence(specifications = [], repositoryRoot) {
  const problems = [];
  for (const specification of specifications) {
    const path = specification.absolutePath
      ?? (isAbsolute(specification.path) ? specification.path : resolve(repositoryRoot, specification.path));
    if (!existsSync(path)) {
      problems.push(`specification is missing: ${specification.path}`);
      continue;
    }
    const actual = digest(readFileSync(path));
    if (actual !== specification.sha256) problems.push(`specification changed after proposal: ${specification.path}`);
  }
  return problems;
}
