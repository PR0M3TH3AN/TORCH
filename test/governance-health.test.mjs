import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProposal, validateProposal } from '../src/services/governance/index.js';
import path from 'node:path';
import fs from 'node:fs/promises';

test('createProposal should throw error for disallowed target', async () => {
  const agent = 'test-agent';
  const target = 'secrets/passwords.txt';
  const newContent = 'new content';

  await assert.rejects(
    createProposal({ agent, target, newContent, reason: 'test' }),
    {
      message: /Target secrets\/passwords.txt is not in an allowed directory/
    }
  );
});

test('validateProposal should return invalid for disallowed target', async () => {
  const id = 'test-disallowed-proposal';
  const dir = path.resolve(process.cwd(), 'src/proposals', id);
  await fs.mkdir(dir, { recursive: true });

  const meta = {
    id,
    author: 'test-agent',
    target: 'secrets/passwords.txt',
    reason: 'test',
    timestamp: new Date().toISOString(),
    status: 'pending'
  };

  await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta));
  await fs.writeFile(path.join(dir, 'new.md'), 'Shared contract (required):\nRequired startup + artifacts + memory + issue capture');

  try {
    const result = await validateProposal(id);
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.reason, 'Target not in allowed directories.');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('validateProposal should return valid for allowed target', async () => {
  const id = 'test-allowed-proposal';
  const dir = path.resolve(process.cwd(), 'src/proposals', id);
  await fs.mkdir(dir, { recursive: true });

  const meta = {
    id,
    author: 'test-agent',
    target: 'src/prompts/daily/test.md',
    reason: 'test',
    timestamp: new Date().toISOString(),
    status: 'pending'
  };

  await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta));
  await fs.writeFile(path.join(dir, 'new.md'), 'Shared contract (required):\nRequired startup + artifacts + memory + issue capture');

  try {
    const result = await validateProposal(id);
    assert.strictEqual(result.valid, true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
