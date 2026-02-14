import fs from 'node:fs';
import path from 'node:path';

const MAX_LINES = 300;
const EXCLUDED_DIRS = ['node_modules', '.git', 'dist', 'artifacts', 'test_logs', 'coverage'];
const EXCLUDED_FILES = ['package-lock.json'];

function countLines(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return content.split('\n').length;
  } catch (error) {
    console.error(`Error reading ${filePath}: ${error.message}`);
    return 0;
  }
}

function scanDirectory(dir) {
  let files = [];
  try {
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        if (!EXCLUDED_DIRS.includes(item)) {
          files = files.concat(scanDirectory(fullPath));
        }
      } else if (stat.isFile()) {
        if (EXCLUDED_FILES.includes(item)) {
          continue;
        }
        if (['.js', '.mjs', '.ts', '.html', '.css', '.json', '.md'].includes(path.extname(item))) {
           files.push(fullPath);
        }
      }
    }
  } catch (error) {
    console.error(`Error scanning ${dir}: ${error.message}`);
  }
  return files;
}

function main() {
  const args = process.argv.slice(2);
  const reportMode = args.includes('--report');

  const files = scanDirectory('.');
  let oversizedCount = 0;

  for (const file of files) {
    const lines = countLines(file);
    if (lines > MAX_LINES) {
      const excess = lines - MAX_LINES;
      console.log(`${file}: ${lines} lines (excess: ${excess})`);
      oversizedCount++;
    }
  }

  if (!reportMode && oversizedCount > 0) {
    process.exit(1);
  }
}

main();
