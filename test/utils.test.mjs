import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import { getIsoWeekStr, todayDateStr, nowUnix } from '../src/utils.mjs';

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
