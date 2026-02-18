import { test } from 'node:test';
import assert from 'node:assert';
import { cmdInit } from '../src/ops.mjs';
import fs from 'node:fs';
import path from 'node:path';

const TEST_DIR = 'test_validation_env';

test('cmdInit should validate install directory name', async (t) => {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_DIR);

  const mockPkg = { name: "host", scripts: {} };
  fs.writeFileSync(path.join(TEST_DIR, 'package.json'), JSON.stringify(mockPkg));

  await t.test('should reject directory with semicolon', async () => {
    await assert.rejects(async () => {
      await cmdInit(false, TEST_DIR, {
        installDir: 'torch; echo pwned',
        namespace: 'ns',
        relays: []
      });
    }, /Invalid directory name/);
  });

  await t.test('should reject directory with spaces', async () => {
    await assert.rejects(async () => {
      await cmdInit(false, TEST_DIR, {
        installDir: 'torch dir',
        namespace: 'ns',
        relays: []
      });
    }, /Invalid directory name/);
  });

  await t.test('should reject directory with quotes', async () => {
    await assert.rejects(async () => {
      await cmdInit(false, TEST_DIR, {
        installDir: 'torch"dir',
        namespace: 'ns',
        relays: []
      });
    }, /Invalid directory name/);
  });

  await t.test('should reject directory with backticks', async () => {
    await assert.rejects(async () => {
      await cmdInit(false, TEST_DIR, {
        installDir: 'torch`dir',
        namespace: 'ns',
        relays: []
      });
    }, /Invalid directory name/);
  });

  await t.test('should reject directory with $', async () => {
    await assert.rejects(async () => {
      await cmdInit(false, TEST_DIR, {
        installDir: 'torch$dir',
        namespace: 'ns',
        relays: []
      });
    }, /Invalid directory name/);
  });

  await t.test('should accept valid directory names', async () => {
    try {
        await cmdInit(false, TEST_DIR, {
            installDir: 'valid-dir_123',
            namespace: 'ns',
            relays: []
        });
    } catch (e) {
        // It might fail because of other initialization steps, but shouldn't fail validation
        assert.notMatch(e.message, /Invalid directory name/);
    }
  });

  await t.test('should accept "."', async () => {
    try {
        await cmdInit(false, TEST_DIR, {
            installDir: '.',
            namespace: 'ns',
            relays: []
        });
    } catch (e) {
        assert.notMatch(e.message, /Invalid directory name/);
    }
  });

  await t.test('should accept nested paths with slashes', async () => {
      try {
          await cmdInit(false, TEST_DIR, {
              installDir: 'path/to/torch',
              namespace: 'ns',
              relays: []
          });
      } catch (e) {
          assert.notMatch(e.message, /Invalid directory name/);
      }
  });

  // Cleanup
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
});
