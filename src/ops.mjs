import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Source paths (in the package)
const SRC_PROMPTS_DIR = path.join(PKG_ROOT, 'src', 'prompts');

// Files to treat as "Static" (always overwrite on update, with transformations)
const STATIC_FILES = [
  'META_PROMPTS.md',
  'scheduler-flow.md',
  'daily-scheduler.md',
  'weekly-scheduler.md',
];

// Directories containing "Evolving" files (copy if missing, preserve if present)
const EVOLVING_DIRS = ['daily', 'weekly'];

function getPaths(userRoot) {
    const torchDir = path.join(userRoot, 'torch');
    return {
        root: userRoot,
        torchDir,
        promptsDir: path.join(torchDir, 'prompts'),
        roster: path.join(torchDir, 'roster.json'),
    };
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function transformContent(content) {
  // Replace source paths with user paths
  return content
    .replace(/src\/prompts\/daily\//g, 'torch/prompts/daily/')
    .replace(/src\/prompts\/weekly\//g, 'torch/prompts/weekly/')
    .replace(/src\/prompts\/roster\.json/g, 'torch/roster.json')
    .replace(/src\/prompts\/scheduler-flow\.md/g, 'torch/scheduler-flow.md');
}

function copyFile(src, dest, transform = false, overwrite = true) {
  if (fs.existsSync(dest) && !overwrite) {
    return false; // Skipped
  }

  const content = fs.readFileSync(src, 'utf8');
  const finalContent = transform ? transformContent(content) : content;
  fs.writeFileSync(dest, finalContent, 'utf8');
  return true; // Copied/Overwritten
}

export async function cmdInit(force = false, cwd = process.cwd()) {
  const paths = getPaths(cwd);
  console.log(`Initializing torch configuration in ${paths.torchDir}...`);

  if (fs.existsSync(paths.torchDir) && !force) {
    throw new Error(`${paths.torchDir} already exists. Use --force to overwrite.`);
  }

  ensureDir(paths.torchDir);
  ensureDir(paths.promptsDir);

  // 1. Copy Roster (Evolving, but initially copied)
  const srcRoster = path.join(SRC_PROMPTS_DIR, 'roster.json');
  if (fs.existsSync(srcRoster)) {
    copyFile(srcRoster, paths.roster, false, true);
    console.log(`Created ${path.relative(paths.root, paths.roster)}`);
  }

  // 2. Copy Static Files (Transformed)
  for (const file of STATIC_FILES) {
    const src = path.join(SRC_PROMPTS_DIR, file);
    const dest = path.join(paths.torchDir, file);
    if (fs.existsSync(src)) {
      copyFile(src, dest, true, true);
      console.log(`Created ${path.relative(paths.root, dest)}`);
    }
  }

  // 3. Copy Prompts (Evolving)
  for (const dir of EVOLVING_DIRS) {
    const srcDir = path.join(SRC_PROMPTS_DIR, dir);
    const destDir = path.join(paths.promptsDir, dir);
    ensureDir(destDir);

    if (fs.existsSync(srcDir)) {
      const files = fs.readdirSync(srcDir);
      for (const file of files) {
        const srcFile = path.join(srcDir, file);
        const destFile = path.join(destDir, file);
        copyFile(srcFile, destFile, false, true);
      }
      console.log(`Created ${files.length} files in ${path.relative(paths.root, destDir)}/`);
    }
  }

  console.log('\nInitialization complete.');
  console.log('You can now customize the files in torch/ and torch/prompts/.');
}

export async function cmdUpdate(force = false, cwd = process.cwd()) {
  const paths = getPaths(cwd);
  console.log(`Updating torch configuration in ${paths.torchDir}...`);

  if (!fs.existsSync(paths.torchDir)) {
    throw new Error(`${paths.torchDir} not found. Run 'torch-lock init' first.`);
  }

  // 1. Backup
  const backupName = `backup_${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const backupRoot = path.join(paths.torchDir, '_backups');
  const thisBackupDir = path.join(backupRoot, backupName);

  ensureDir(thisBackupDir);
  console.log(`Creating backup at ${path.relative(paths.root, thisBackupDir)}...`);

  const entries = fs.readdirSync(paths.torchDir);
  for (const entry of entries) {
      // Skip the backups directory itself to avoid recursion
      if (entry === '_backups') continue;

      const srcPath = path.join(paths.torchDir, entry);
      const destPath = path.join(thisBackupDir, entry);
      fs.cpSync(srcPath, destPath, { recursive: true });
  }

  // 2. Update Static Files (Always Overwrite)
  console.log('Updating static files...');
  for (const file of STATIC_FILES) {
    const src = path.join(SRC_PROMPTS_DIR, file);
    const dest = path.join(paths.torchDir, file);
    if (fs.existsSync(src)) {
      copyFile(src, dest, true, true);
      console.log(`  Updated ${file}`);
    }
  }

  // 3. Update Roster (Preserve unless force)
  const srcRoster = path.join(SRC_PROMPTS_DIR, 'roster.json');
  if (fs.existsSync(srcRoster)) {
    if (force) {
      copyFile(srcRoster, paths.roster, false, true);
      console.log('  Overwrote roster.json (forced)');
    } else {
      console.log('  Skipped roster.json (preserved)');
    }
  }

  // 4. Update Prompts (Copy missing, preserve existing unless force)
  console.log('Updating prompts...');
  for (const dir of EVOLVING_DIRS) {
    const srcDir = path.join(SRC_PROMPTS_DIR, dir);
    const destDir = path.join(paths.promptsDir, dir);
    ensureDir(destDir);

    if (fs.existsSync(srcDir)) {
      const files = fs.readdirSync(srcDir);
      let added = 0;
      let updated = 0;
      let skipped = 0;

      for (const file of files) {
        const srcFile = path.join(srcDir, file);
        const destFile = path.join(destDir, file);

        // If force is true, we overwrite (updated++).
        // If force is false and file missing, we write (added++).
        // If force is false and file exists, we skip (skipped++).

        if (force) {
            copyFile(srcFile, destFile, false, true);
            updated++;
        } else {
            if (!fs.existsSync(destFile)) {
                copyFile(srcFile, destFile, false, true);
                added++;
            } else {
                skipped++;
            }
        }
      }
      console.log(`  ${dir}/: ${added} added, ${updated} updated, ${skipped} preserved`);
    }
  }

  console.log('\nUpdate complete.');
}
