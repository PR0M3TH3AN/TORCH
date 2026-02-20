import { describe, it } from 'node:test';
import assert from 'node:assert';
import { withTimeout } from '../src/lock-utils.mjs';

describe('Async Utilities', () => {
  describe('withTimeout', () => {
    it('resolves when promise completes before timeout', async () => {
      const result = await withTimeout(
        new Promise((resolve) => setTimeout(() => resolve('success'), 10)),
        200,
        'Timed out'
      );
      assert.strictEqual(result, 'success');
    });

    it('rejects when promise times out', async () => {
      try {
        await withTimeout(
          new Promise((resolve) => setTimeout(() => resolve('success'), 200)),
          10,
          'Operation timed out'
        );
        assert.fail('Should have rejected');
      } catch (err) {
        assert.strictEqual(err.message, 'Operation timed out');
      }
    });

    it('clears timeout on success', async () => {
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
