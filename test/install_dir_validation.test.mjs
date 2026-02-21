import { test } from 'node:test';
import assert from 'node:assert';
import { cmdInit } from '../src/ops.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

test('cmdInit should validate install directory name', async (t) => {

  async function runWithTempDir(fn) {
     const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'torch-test-'));
     // Setup mock package.json
     const mockPkg = { name: "host", scripts: {} };
     fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(mockPkg));

     try {
       await fn(tmpDir);
     } finally {
       if (fs.existsSync(tmpDir)) {
         fs.rmSync(tmpDir, { recursive: true, force: true });
       }
     }
  }

  await t.test('should reject directory with semicolon', async () => {
    await runWithTempDir(async (cwd) => {
        await assert.rejects(async () => {
          await cmdInit(false, cwd, {
            installDir: 'torch; echo pwned',
            namespace: 'ns',
            relays: []
          });
        }, /Invalid directory name/);
    });
  });

  await t.test('should reject directory with spaces', async () => {
    await runWithTempDir(async (cwd) => {
        await assert.rejects(async () => {
          await cmdInit(false, cwd, {
            installDir: 'torch dir',
            namespace: 'ns',
            relays: []
          });
        }, /Invalid directory name/);
    });
  });

  await t.test('should reject directory with quotes', async () => {
    await runWithTempDir(async (cwd) => {
        await assert.rejects(async () => {
          await cmdInit(false, cwd, {
            installDir: 'torch"dir',
            namespace: 'ns',
            relays: []
          });
        }, /Invalid directory name/);
    });
  });

  await t.test('should reject directory with backticks', async () => {
    await runWithTempDir(async (cwd) => {
        await assert.rejects(async () => {
          await cmdInit(false, cwd, {
            installDir: 'torch`dir',
            namespace: 'ns',
            relays: []
          });
        }, /Invalid directory name/);
    });
  });

  await t.test('should reject directory with $', async () => {
    await runWithTempDir(async (cwd) => {
        await assert.rejects(async () => {
          await cmdInit(false, cwd, {
            installDir: 'torch$dir',
            namespace: 'ns',
            relays: []
          });
        }, /Invalid directory name/);
    });
  });

  await t.test('should accept valid directory names', async () => {
    await runWithTempDir(async (cwd) => {
        try {
            await cmdInit(false, cwd, {
                installDir: 'valid-dir_123',
                namespace: 'ns',
                relays: []
            });
        } catch (e) {
            assert.notMatch(e.message, /Invalid directory name/);
        }
    });
  });

  await t.test('should accept "."', async () => {
    await runWithTempDir(async (cwd) => {
        try {
            await cmdInit(false, cwd, {
                installDir: '.',
                namespace: 'ns',
                relays: []
            });
        } catch (e) {
            assert.notMatch(e.message, /Invalid directory name/);
        }
    });
  });

  await t.test('should accept nested paths with slashes', async () => {
      await runWithTempDir(async (cwd) => {
          try {
              await cmdInit(false, cwd, {
                  installDir: 'path/to/torch',
                  namespace: 'ns',
                  relays: []
              });
          } catch (e) {
              assert.notMatch(e.message, /Invalid directory name/);
          }
      });
  });
});
