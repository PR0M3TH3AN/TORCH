import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

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

// New constants for full application install
const APP_DIRS = ['src', 'bin', 'dashboard', 'landing', 'assets', 'scripts'];
const APP_FILES = ['package.json', 'build.mjs', 'README.md', 'torch-config.example.json'];

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

function copyDir(src, dest) {
    if (fs.existsSync(src)) {
        fs.cpSync(src, dest, { recursive: true });
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
  if (!fs.existsSync(src)) return false;

  const content = fs.readFileSync(src, 'utf8');
  const finalContent = transform ? transformContent(content) : content;
  fs.writeFileSync(dest, finalContent, 'utf8');
  return true; // Copied/Overwritten
}

export function cmdInit(force = false, cwd = process.cwd()) {
  const paths = getPaths(cwd);
  console.log(`Initializing torch configuration in ${paths.torchDir}...`);

  if (fs.existsSync(paths.torchDir) && !force) {
    throw new Error(`${paths.torchDir} already exists. Use --force to overwrite.`);
  }

  ensureDir(paths.torchDir);
  ensureDir(paths.promptsDir);

  // 1. Copy App Directories
  console.log('Copying application directories...');
  for (const dir of APP_DIRS) {
      const src = path.join(PKG_ROOT, dir);
      const dest = path.join(paths.torchDir, dir);
      if (fs.existsSync(src)) {
          copyDir(src, dest);
          console.log(`  Copied ${dir}/`);
      }
  }

  // 2. Copy App Files
  console.log('Copying application files...');
  for (const file of APP_FILES) {
      const src = path.join(PKG_ROOT, file);
      const dest = path.join(paths.torchDir, file);
      if (fs.existsSync(src)) {
          fs.copyFileSync(src, dest);
          console.log(`  Copied ${file}`);
      }
  }

  // 3. Copy Roster (Evolving, but initially copied)
  const srcRoster = path.join(SRC_PROMPTS_DIR, 'roster.json');
  if (fs.existsSync(srcRoster)) {
    copyFile(srcRoster, paths.roster, false, true);
    console.log(`Created ${path.relative(paths.root, paths.roster)}`);
  }

  // 4. Copy Static Files (Transformed) - Prompts root files
  for (const file of STATIC_FILES) {
    const src = path.join(SRC_PROMPTS_DIR, file);
    const dest = path.join(paths.torchDir, file);
    if (fs.existsSync(src)) {
      copyFile(src, dest, true, true);
      console.log(`Created ${path.relative(paths.root, dest)}`);
    }
  }

  // 5. Copy Prompts (Evolving)
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

  // 6. Create torch-config.json logic
  const configPath = path.join(paths.torchDir, 'torch-config.json');
  const rootConfigPath = path.join(cwd, 'torch-config.json');

  if (!fs.existsSync(configPath)) {
      // Check root config first
      if (fs.existsSync(rootConfigPath)) {
          fs.copyFileSync(rootConfigPath, configPath);
          console.log(`Copied existing configuration from root to ${path.relative(cwd, configPath)}`);
      } else {
          // Generate new
            try {
              const exampleConfigPath = path.join(PKG_ROOT, 'torch-config.example.json');
              if (fs.existsSync(exampleConfigPath)) {
                const exampleConfig = JSON.parse(fs.readFileSync(exampleConfigPath, 'utf8'));

                // Generate random namespace
                const randomSuffix = crypto.randomBytes(4).toString('hex');
                const newNamespace = `torch-${randomSuffix}`;

                if (exampleConfig.nostrLock) {
                    exampleConfig.nostrLock.namespace = newNamespace;
                } else {
                    exampleConfig.nostrLock = { namespace: newNamespace };
                }

                fs.writeFileSync(configPath, JSON.stringify(exampleConfig, null, 2), 'utf8');
                console.log(`Created ${path.relative(cwd, configPath)} with namespace "${newNamespace}"`);
              } else {
                 console.warn(`Warning: Could not find ${exampleConfigPath} to generate torch-config.json`);
              }
            } catch (err) {
              console.error(`Failed to create torch-config.json: ${err.message}`);
            }
      }
  } else {
      console.log(`Skipped ${path.relative(cwd, configPath)} (exists)`);
  }

  console.log('\nInitialization complete.');
  console.log('You can now customize the files in torch/ and torch/prompts/.');
}

export function cmdUpdate(force = false, cwd = process.cwd()) {
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

  // We backup EVERYTHING in torchDir except _backups and node_modules
  const entries = fs.readdirSync(paths.torchDir);
  for (const entry of entries) {
      if (entry === '_backups' || entry === 'node_modules' || entry === '.git') continue;

      const srcPath = path.join(paths.torchDir, entry);
      const destPath = path.join(thisBackupDir, entry);
      fs.cpSync(srcPath, destPath, { recursive: true });
  }

  // 2. Update App Directories (Overwrite)
  console.log('Updating application directories...');
  for (const dir of APP_DIRS) {
      const src = path.join(PKG_ROOT, dir);
      const dest = path.join(paths.torchDir, dir);
      if (fs.existsSync(src)) {
          copyDir(src, dest);
          console.log(`  Updated ${dir}/`);
      }
  }

  // 3. Update App Files (Overwrite)
  console.log('Updating application files...');
  for (const file of APP_FILES) {
      const src = path.join(PKG_ROOT, file);
      const dest = path.join(paths.torchDir, file);
      if (fs.existsSync(src)) {
          fs.copyFileSync(src, dest);
          console.log(`  Updated ${file}`);
      }
  }

  // 4. Update Static Files (Always Overwrite)
  console.log('Updating static files...');
  for (const file of STATIC_FILES) {
    const src = path.join(SRC_PROMPTS_DIR, file);
    const dest = path.join(paths.torchDir, file);
    if (fs.existsSync(src)) {
      copyFile(src, dest, true, true);
      console.log(`  Updated ${file}`);
    }
  }

  // 5. Update Roster (Preserve unless force)
  const srcRoster = path.join(SRC_PROMPTS_DIR, 'roster.json');
  if (fs.existsSync(srcRoster)) {
    if (force) {
      copyFile(srcRoster, paths.roster, false, true);
      console.log('  Overwrote roster.json (forced)');
    } else {
      console.log('  Skipped roster.json (preserved)');
    }
  }

  // 6. Update Prompts (Copy missing, preserve existing unless force)
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
