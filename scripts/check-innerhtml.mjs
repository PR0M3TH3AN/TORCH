import fs from 'node:fs';
import path from 'node:path';

const EXCLUDED_DIRS = ['node_modules', '.git', 'dist', 'artifacts', 'test_logs', 'coverage'];
const TARGET_EXTENSIONS = ['.js', '.mjs', '.ts', '.html'];

function countInnerHTML(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    // Basic regex to find assignment to innerHTML
    const regex = /\.innerHTML\s*=/g;
    const matches = content.match(regex);
    return matches ? matches.length : 0;
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
        if (TARGET_EXTENSIONS.includes(path.extname(item))) {
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
  let totalAssignments = 0;
  let offenderCount = 0;

  for (const file of files) {
    const count = countInnerHTML(file);
    if (count > 0) {
      console.log(`${file}: ${count} assignments`);
      totalAssignments += count;
      offenderCount++;
    }
  }

  if (reportMode && totalAssignments > 0) {
    console.log(`Total assignments: ${totalAssignments}`);
  }

  if (!reportMode && offenderCount > 0) {
    process.exit(1);
  }
}

main();
