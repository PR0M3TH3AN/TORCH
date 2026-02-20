import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ExitError } from '../src/errors.mjs';

describe('ExitError', () => {
  it('should capture the code and message correctly', () => {
    const code = 1;
    const message = 'Test error message';
    const error = new ExitError(code, message);

    assert.strictEqual(error.code, code);
    assert.strictEqual(error.message, message);
  });

  it('should be an instance of Error and ExitError', () => {
    const error = new ExitError(1, 'message');

    assert.ok(error instanceof Error);
    assert.ok(error instanceof ExitError);
  });

  it('should have a stack trace', () => {
    const error = new ExitError(1, 'message');
    assert.ok(error.stack);
  });

  it('should have the correct name', () => {
    const error = new ExitError(1, 'message');
    assert.strictEqual(error.name, 'ExitError');
  });
});
