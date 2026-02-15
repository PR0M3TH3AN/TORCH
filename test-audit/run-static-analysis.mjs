import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function getFiles(dir, files = []) {
  try {
    const fileList = readdirSync(dir);
    for (const file of fileList) {
      const name = join(dir, file);
      if (statSync(name).isDirectory()) {
        getFiles(name, files);
      } else if (name.endsWith('.mjs') || name.endsWith('.js')) {
        files.push(name);
      }
    }
  } catch (e) {
    // ignore if dir doesn't exist
  }
  return files;
}

const testFiles = [...getFiles('test'), ...getFiles('tests')];
const suspicious = [];

for (const file of testFiles) {
  const content = readFileSync(file, 'utf8');
  const issues = [];

  if (content.includes('.only(')) issues.push('Found .only()');
  if (content.includes('.skip(')) issues.push('Found .skip()');
  if (content.includes('setTimeout(')) issues.push('Found setTimeout()');
  if (content.includes('sleep(')) issues.push('Found sleep()');

  // Naive check for assertions: look for assert., expect(, t.
  // Many tests use 't' context from node:test
  if (!content.includes('assert.') && !content.includes('expect(') && !content.includes('t.plan') && !content.includes('strictEqual')) {
     // This is very naive, might false positive on 't.ok' etc.
     // Let's look for common assertion keywords.
     const assertionKeywords = ['assert', 'expect', 'strictEqual', 'deepStrictEqual', 'ok', 'equal'];
     const hasAssertion = assertionKeywords.some(k => content.includes(k));
     if (!hasAssertion) issues.push('No obvious assertions');
  }

  if (issues.length > 0) {
    suspicious.push({ file, issues });
  }
}

writeFileSync('test-audit/suspicious-tests.json', JSON.stringify(suspicious, null, 2));
console.log(`Found ${suspicious.length} suspicious files.`);
