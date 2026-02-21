import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const IGNORE_DIRS = [
  'node_modules',
  '.git',
  'dist',
  'coverage',
  'test_logs',
  'task-logs',
  'reports',
  'artifacts',
  'bin'
];

const IGNORE_FILES = [
  'package-lock.json',
  'yarn.lock'
];

function getAllFiles(dirPath, arrayOfFiles) {
  const files = fs.readdirSync(dirPath);

  arrayOfFiles = arrayOfFiles || [];

  files.forEach(function(file) {
    if (IGNORE_DIRS.includes(file) || IGNORE_FILES.includes(file)) {
      return;
    }
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
    } else {
      if (file.endsWith('.md')) {
        arrayOfFiles.push(fullPath);
      }
    }
  });

  return arrayOfFiles;
}

function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove all non-word chars
    .replace(/[\s_-]+/g, '-') // Replace spaces and underscores with -
    .replace(/^-+|-+$/g, ''); // Remove leading/trailing -
}

function getAnchors(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const anchors = new Set();

  // Markdown headings
  const headingRegex = /^(#{1,6})\s+(.*)$/gm;
  let match;
  while ((match = headingRegex.exec(content)) !== null) {
    anchors.add(slugify(match[2]));
  }

  // HTML anchors <a name="..."> or <a id="...">
  const htmlAnchorRegex = /<a\s+(?:name|id)=["']([^"']+)["']/g;
  while ((match = htmlAnchorRegex.exec(content)) !== null) {
    anchors.add(match[1]);
  }

  return anchors;
}

const fileAnchorsCache = new Map();

function getFileAnchors(filePath) {
  if (!fileAnchorsCache.has(filePath)) {
    fileAnchorsCache.set(filePath, getAnchors(filePath));
  }
  return fileAnchorsCache.get(filePath);
}

function checkLinks(files) {
  let brokenLinks = [];

  files.forEach(file => {
    const content = fs.readFileSync(file, 'utf8');
    const relativeFilePath = path.relative(ROOT_DIR, file);

    const processLink = (link) => {
        link = link.trim();
        // Remove title
        if (link.includes(' "') || link.includes(" '")) {
           const parts = link.split(/\s+["']/);
           link = parts[0];
        }
        // Remove wrapping < >
        if (link.startsWith('<') && link.endsWith('>')) {
          link = link.slice(1, -1);
        }
        validateLink(link, file, relativeFilePath, brokenLinks);
    };

    // Regex for [text](url)
    const inlineLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let match;
    while ((match = inlineLinkRegex.exec(content)) !== null) {
      processLink(match[2]);
    }

    // Regex for [ref]: url
    const refLinkRegex = /^\[([^\]]+)\]:\s*(\S+)/gm;
    while ((match = refLinkRegex.exec(content)) !== null) {
       processLink(match[2]);
    }
  });

  return brokenLinks;
}

function validateLink(link, currentFile, relativeFilePath, brokenLinks) {
  if (!link) return;
  if (link.startsWith('http://') || link.startsWith('https://') || link.startsWith('mailto:') || link.startsWith('data:')) return;

  const [linkPath, anchor] = link.split('#');

  let targetPath;

  if (!linkPath) {
    // Internal anchor link: #header
    targetPath = currentFile;
  } else if (linkPath.startsWith('/')) {
    targetPath = path.join(ROOT_DIR, linkPath);
  } else {
    targetPath = path.resolve(path.dirname(currentFile), linkPath);
  }

  if (!fs.existsSync(targetPath)) {
    brokenLinks.push({
      file: relativeFilePath,
      link: link,
      target: path.relative(ROOT_DIR, targetPath),
      reason: 'File not found'
    });
    return;
  }

  // Check anchor if present and if target is a markdown file
  if (anchor && targetPath.endsWith('.md')) {
    const anchors = getFileAnchors(targetPath);
    if (!anchors.has(anchor)) {
       // Try decoding URI component just in case
       try {
           if (anchors.has(decodeURIComponent(anchor))) return;
       } catch {
         // Ignore decoding errors
       }

      brokenLinks.push({
        file: relativeFilePath,
        link: link,
        target: path.relative(ROOT_DIR, targetPath),
        reason: `Anchor '#${anchor}' not found`
      });
    }
  }
}

console.log('Scanning for markdown files...');
const files = getAllFiles(ROOT_DIR);
console.log(`Found ${files.length} markdown files. Checking links (including anchors)...`);
const brokenLinks = checkLinks(files);

if (brokenLinks.length > 0) {
  console.error(`Found ${brokenLinks.length} broken links:`);
  brokenLinks.forEach(item => {
    console.error(`  ${item.file}: '${item.link}' -> ${item.reason}`);
  });
  process.exit(1);
} else {
  console.log('No broken links found.');
}
