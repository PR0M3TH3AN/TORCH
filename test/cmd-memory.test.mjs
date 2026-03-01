import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cmdMemoryAdd, cmdMemoryBuild, cmdMemoryVerify } from '../src/cmd-memory.mjs';
import { ExitError } from '../src/errors.mjs';

const SCHEMA_PATH = 'memory/schema/memory-event.schema.json';

async function withTempProject(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'torch-memory-cmd-'));
  const cwd = process.cwd();
  process.chdir(root);
  try {
    await fs.mkdir('memory/events', { recursive: true });
    await fs.mkdir('memory/schema', { recursive: true });
    const schemaSource = path.resolve(cwd, SCHEMA_PATH);
    await fs.copyFile(schemaSource, path.join(root, SCHEMA_PATH));
    await fn(root);
  } finally {
    process.chdir(cwd);
  }
}

async function writeEvent(root, event) {
  const compact = event.created_at.replace(/[-:]/g, '').replace('.000', '');
  const year = event.created_at.slice(0, 4);
  const month = event.created_at.slice(5, 7);
  const day = event.created_at.slice(8, 10);
  const dir = path.join(root, 'memory', 'events', year, month, day);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${compact}_${event.id}.json`);
  await fs.writeFile(filePath, `${JSON.stringify(event, null, 2)}\n`, 'utf8');
}

test('memory add writes one append-only event file with schema-valid shape', async () => {
  await withTempProject(async () => {
    const createdAt = '2026-03-01T15:20:11Z';
    await cmdMemoryAdd({
      subcommand: 'add',
      agent: 'codex',
      topic: 'memory',
      message: 'Append-only event created.',
      createdAt,
      runId: 'run_abc123',
      tags: ['architecture', 'memory'],
      source: 'test',
    });

    const eventDir = path.resolve('memory/events/2026/03/01');
    const files = await fs.readdir(eventDir);
    assert.strictEqual(files.length, 1);
    const json = JSON.parse(await fs.readFile(path.join(eventDir, files[0]), 'utf8'));
    assert.strictEqual(json.project, 'TORCH');
    assert.strictEqual(json.created_at, createdAt);
    assert.strictEqual(json.agent, 'codex');
    assert.ok(json.id.includes('-7'));
  });
});

test('memory build renders deterministic markdown sorted by created_at then id', async () => {
  await withTempProject(async (root) => {
    await writeEvent(root, {
      id: '0195505d-0000-7000-8000-000000000002',
      created_at: '2026-03-01T15:20:11Z',
      project: 'TORCH',
      agent: 'codex',
      topic: 'memory',
      content: 'second',
    });
    await writeEvent(root, {
      id: '0195505d-0000-7000-8000-000000000001',
      created_at: '2026-03-01T15:20:11Z',
      project: 'TORCH',
      agent: 'codex',
      topic: 'memory',
      content: 'first',
    });

    await cmdMemoryBuild({ subcommand: 'build' });
    const rendered = await fs.readFile('memory_update.md', 'utf8');
    const firstPos = rendered.indexOf('000000000001');
    const secondPos = rendered.indexOf('000000000002');
    assert.ok(firstPos > 0);
    assert.ok(secondPos > firstPos);
    assert.ok(rendered.startsWith('<!-- AUTO-GENERATED: DO NOT EDIT. Source: memory/events -->'));
  });
});

test('memory verify fails when generated output is stale', async () => {
  await withTempProject(async (root) => {
    await writeEvent(root, {
      id: '0195505d-0000-7000-8000-000000000001',
      created_at: '2026-03-01T15:20:11Z',
      project: 'TORCH',
      agent: 'codex',
      topic: 'memory',
      content: 'expected output',
    });
    await fs.writeFile('memory_update.md', 'manually edited\n', 'utf8');

    await assert.rejects(
      async () => cmdMemoryVerify({ subcommand: 'verify' }),
      (error) => error instanceof ExitError && error.code === 4 && /out of date|missing generated-file header/i.test(error.message),
    );
  });
});

test('memory verify fails on duplicate event ids', async () => {
  await withTempProject(async (root) => {
    const sharedId = '0195505d-0000-7000-8000-000000000001';
    await writeEvent(root, {
      id: sharedId,
      created_at: '2026-03-01T15:20:11Z',
      project: 'TORCH',
      agent: 'codex',
      topic: 'memory',
      content: 'first',
    });
    await writeEvent(root, {
      id: sharedId,
      created_at: '2026-03-01T15:20:12Z',
      project: 'TORCH',
      agent: 'codex',
      topic: 'memory',
      content: 'second',
    });

    await assert.rejects(
      async () => cmdMemoryVerify({ subcommand: 'verify' }),
      (error) => error instanceof ExitError && error.code === 4 && /duplicate id/i.test(error.message),
    );
  });
});
