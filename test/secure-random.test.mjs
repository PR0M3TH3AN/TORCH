import { describe, it } from 'node:test';
import assert from 'node:assert';
import { _secureRandom } from '../src/lock-ops.mjs';

describe('secureRandom', () => {
  it('returns values in [0, 1)', () => {
    for (let i = 0; i < 1000; i++) {
      const val = _secureRandom();
      assert.ok(val >= 0, `Value ${val} should be >= 0`);
      assert.ok(val < 1, `Value ${val} should be < 1`);
    }
  });

  it('returns varied values', () => {
    const values = new Set();
    for (let i = 0; i < 100; i++) {
      values.add(_secureRandom());
    }
    assert.ok(values.size > 90, 'Values should be reasonably unique');
  });
});
