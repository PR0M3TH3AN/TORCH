import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getIsoWeekStr } from '../src/utils.mjs';

describe('Date Utilities', () => {
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
