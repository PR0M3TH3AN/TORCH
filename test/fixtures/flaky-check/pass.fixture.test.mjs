import { test } from 'node:test';
import assert from 'node:assert/strict';

test('pass fixture stays green', () => {
  assert.equal(2 + 2, 4);
});
