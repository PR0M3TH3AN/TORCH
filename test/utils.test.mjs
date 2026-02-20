import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { getIsoWeekStr, todayDateStr, nowUnix, ensureDir, detectPlatform, withTimeout } from '../src/utils.mjs';

describe('Date Utilities', () => {
  describe('todayDateStr', () => {
    it('returns current date in YYYY-MM-DD format', (t) => {
      t.mock.timers.enable({ apis: ['Date'] });
      // 2023-10-25 12:00:00 UTC
      const date = new Date('2023-10-25T12:00:00Z');
      t.mock.timers.setTime(date.getTime());

      assert.strictEqual(todayDateStr(), '2023-10-25');
    });
  });

  describe('nowUnix', () => {
    it('returns current unix timestamp', (t) => {
      t.mock.timers.enable({ apis: ['Date'] });
      const timeMs = 1700000000000;
      t.mock.timers.setTime(timeMs);

      // 1700000000000 / 1000 = 1700000000
      assert.strictEqual(nowUnix(), 1700000000);
    });
  });

  describe('getIsoWeekStr', () => {
    it('returns correct ISO week for simple cases', () => {
      assert.strictEqual(getIsoWeekStr('2023-01-02'), '2023-W01'); // Mon
      assert.strictEqual(getIsoWeekStr('2023-01-08'), '2023-W01'); // Sun
      assert.strictEqual(getIsoWeekStr('2023-01-09'), '2023-W02'); // Mon
    });

    it('handles year boundaries correctly', () => {
      // 2023-01-01 is Sunday. Belong to last week of 2022.
      assert.strictEqual(getIsoWeekStr('2023-01-01'), '2022-W52');
      // 2024-01-01 is Monday. Week 1 of 2024.
      assert.strictEqual(getIsoWeekStr('2024-01-01'), '2024-W01');
      // 2023-12-31 is Sunday. Week 52 of 2023.
      assert.strictEqual(getIsoWeekStr('2023-12-31'), '2023-W52');
    });

    it('handles leap years', () => {
      assert.strictEqual(getIsoWeekStr('2024-02-29'), '2024-W09');
    });

    it('handles empty input (defaults to today)', () => {
      // Just check it returns a string in correct format
      const result = getIsoWeekStr();
      assert.match(result, /^\d{4}-W\d{2}$/);
    });

    it('handles invalid input gracefully', () => {
      assert.strictEqual(getIsoWeekStr('invalid-date'), '');
    });
  });
});

describe('Platform Utilities', () => {
  describe('detectPlatform', () => {
    const originalEnv = { ...process.env };

    // Helper to clear relevant env vars
    const clearEnv = () => {
      delete process.env.JULES_SESSION_ID;
      delete process.env.JULES_API_KEY;
      delete process.env.CODEX_SESSION_ID;
      delete process.env.CODEX_API_KEY;
      delete process.env.GOOSE_SESSION_ID;
      delete process.env.GOOSE_API_KEY;
      delete process.env.CLAUDE_SESSION_ID;
      delete process.env.CLAUDE_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_API_KEY;
      delete process.env.ANTIGRAVITY_API_KEY;
      delete process.env.ANTIGRAVITY_SESSION_ID;
      delete process.env.QWEN_API_KEY;
      delete process.env.QWEN_SESSION_ID;
    };

    after(() => {
      process.env = originalEnv;
    });

    it('detects jules', () => {
      clearEnv();
      process.env.JULES_SESSION_ID = 'test';
      assert.strictEqual(detectPlatform(), 'jules');
    });

    it('detects codex', () => {
      clearEnv();
      process.env.CODEX_API_KEY = 'test';
      assert.strictEqual(detectPlatform(), 'codex');
    });

    it('detects goose', () => {
      clearEnv();
      process.env.GOOSE_SESSION_ID = 'test';
      assert.strictEqual(detectPlatform(), 'goose');
    });

    it('detects claude via CLAUDE_API_KEY', () => {
      clearEnv();
      process.env.CLAUDE_API_KEY = 'test';
      assert.strictEqual(detectPlatform(), 'claude');
    });

    it('detects claude via ANTHROPIC_API_KEY', () => {
      clearEnv();
      process.env.ANTHROPIC_API_KEY = 'test';
      assert.strictEqual(detectPlatform(), 'claude');
    });

    it('detects gemini via GEMINI_API_KEY', () => {
      clearEnv();
      process.env.GEMINI_API_KEY = 'test';
      assert.strictEqual(detectPlatform(), 'gemini');
    });

    it('detects gemini via GOOGLE_API_KEY', () => {
      clearEnv();
      process.env.GOOGLE_API_KEY = 'test';
      assert.strictEqual(detectPlatform(), 'gemini');
    });

    it('detects antigravity via ANTIGRAVITY_API_KEY', () => {
      clearEnv();
      process.env.ANTIGRAVITY_API_KEY = 'test';
      assert.strictEqual(detectPlatform(), 'antigravity');
    });

    it('detects antigravity via ANTIGRAVITY_SESSION_ID', () => {
      clearEnv();
      process.env.ANTIGRAVITY_SESSION_ID = 'test';
      assert.strictEqual(detectPlatform(), 'antigravity');
    });

    it('detects qwen via QWEN_API_KEY', () => {
      clearEnv();
      process.env.QWEN_API_KEY = 'test';
      assert.strictEqual(detectPlatform(), 'qwen');
    });

    it('returns null if no platform detected', () => {
      clearEnv();
      assert.strictEqual(detectPlatform(), null);
    });
  });
});

describe('File Utilities', () => {
  describe('ensureDir', () => {
    const tempBase = fs.mkdtempSync(path.join(process.cwd(), 'test-utils-'));

    after(() => {
      fs.rmSync(tempBase, { recursive: true, force: true });
    });

    it('creates directory if it does not exist', () => {
      const targetDir = path.join(tempBase, 'new-dir');
      assert.strictEqual(fs.existsSync(targetDir), false);
      ensureDir(targetDir);
      assert.strictEqual(fs.existsSync(targetDir), true);
    });

    it('does nothing if directory already exists', () => {
      const targetDir = path.join(tempBase, 'existing-dir');
      fs.mkdirSync(targetDir);
      assert.strictEqual(fs.existsSync(targetDir), true);
      ensureDir(targetDir);
      assert.strictEqual(fs.existsSync(targetDir), true);
    });

    it('creates nested directories recursively', () => {
      const targetDir = path.join(tempBase, 'nested', 'deep', 'dir');
      assert.strictEqual(fs.existsSync(targetDir), false);
      ensureDir(targetDir);
      assert.strictEqual(fs.existsSync(targetDir), true);
    });
  });
});

describe('Async Utilities', () => {
  describe('withTimeout', () => {
    it('resolves when promise completes before timeout', async () => {
      const result = await withTimeout(
        new Promise((resolve) => setTimeout(() => resolve('success'), 10)),
        100,
        'Timed out'
      );
      assert.strictEqual(result, 'success');
    });

    it('rejects when promise times out', async () => {
      try {
        await withTimeout(
          new Promise((resolve) => setTimeout(() => resolve('success'), 100)),
          10,
          'Operation timed out'
        );
        assert.fail('Should have rejected');
      } catch (err) {
        assert.strictEqual(err.message, 'Operation timed out');
      }
    });

    it('clears timeout on success', async () => {
       // This is hard to test directly without mocking setTimeout/clearTimeout
       // but we can verify it doesn't throw or hang.
       const result = await withTimeout(
         Promise.resolve('fast'),
         1000,
         'timeout'
       );
       assert.strictEqual(result, 'fast');
    });

    it('propagates original promise rejection', async () => {
      try {
        await withTimeout(
          Promise.reject(new Error('Original error')),
          100,
          'Timeout'
        );
        assert.fail('Should have rejected');
      } catch (err) {
        assert.strictEqual(err.message, 'Original error');
      }
    });
  });
});
