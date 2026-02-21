import { test } from 'node:test';
import assert from 'node:assert/strict';

test('fail fixture stays red', () => {
  assert.equal(1, 2);
});
