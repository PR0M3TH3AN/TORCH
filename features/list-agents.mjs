import fs from 'fs/promises';
import path from 'path';

async function main() {
  try {
    const rosterPath = path.resolve('src/prompts/roster.json');
    const rosterData = await fs.readFile(rosterPath, 'utf-8');
    const roster = JSON.parse(rosterData);

    console.log('Available Agents:\n');

    console.log('Daily Agents:');
    for (const agent of roster.daily || []) {
      console.log(`  - ${agent}`);
    }

    console.log('\nWeekly Agents:');
    for (const agent of roster.weekly || []) {
      console.log(`  - ${agent}`);
    }
  } catch (err) {
    console.error('Error reading roster.json:', err.message);
    process.exit(1);
  }
}

main();
