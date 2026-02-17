import fs from 'fs';

const fix = (filePath) => {
  let content = fs.readFileSync(filePath, 'utf8');
  const header = '| # | Agent Name | Prompt File |\n|---|------------|-------------|';

  const parts = content.split(header);
  if (parts.length < 2) return; // Should not happen

  const pre = parts[0];
  const post = parts[1];

  const lines = post.split('\n');
  const tableLines = [];
  let i = 0;

  // Skip initial empty lines if any (though usually generateTable doesn't add them at start)
  while(i < lines.length && lines[i].trim() === '') i++;

  // Capture rows
  while(i < lines.length && lines[i].trim().startsWith('|')) {
    tableLines.push(lines[i]);
    i++;
  }

  const newContent = pre + header + '\n' + tableLines.join('\n') + '\n';
  fs.writeFileSync(filePath, newContent);
  console.log(`Fixed ${filePath}`);
};

fix('src/prompts/daily-scheduler.md');
fix('src/prompts/weekly-scheduler.md');
