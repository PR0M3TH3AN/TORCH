#!/usr/bin/env node
// Reduces a Codex protocol stream to the lifecycle facts TORCH may retain.
// Raw turns, images, and stderr are drained but never copied into parent state.
import { spawn } from 'node:child_process';

const MAX_PROTOCOL_LINE_CHARS = 32 * 1024;
const [command, ...args] = process.argv.slice(2);
if (!command) process.exit(64);

const child = spawn(command, args, { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
let pending = '';
let droppingOversizedLine = false;
let threadStarted = null;
let terminal = null;
let childSpawnError = null;

function safeCode(value) {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_.-]{0,79}$/.test(value) ? value : null;
}

function emit(record) {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

function inspectLine(line) {
  let record;
  try { record = JSON.parse(line); } catch { return; }
  if (!threadStarted && record?.type === 'thread.started'
    && typeof (record.thread_id ?? record.threadId) === 'string'
    && (record.thread_id ?? record.threadId).length <= 256) {
    threadStarted = record.thread_id ?? record.threadId;
  }
  if (record?.type === 'turn.completed') terminal = { type: 'turn.completed' };
  if (record?.type === 'turn.failed' || record?.type === 'turn.error' || record?.type === 'error') {
    const error = record.error && typeof record.error === 'object' ? record.error : record;
    const code = safeCode(error.code ?? record.code);
    terminal = { type: 'turn.failed', ...(code ? { code } : {}) };
  }
}

function consume(chunk) {
  let cursor = 0;
  while (cursor < chunk.length) {
    const newline = chunk.indexOf('\n', cursor);
    const end = newline < 0 ? chunk.length : newline;
    const fragment = chunk.slice(cursor, end);
    if (!droppingOversizedLine) {
      if (pending.length + fragment.length > MAX_PROTOCOL_LINE_CHARS) {
        pending = '';
        droppingOversizedLine = true;
      } else pending += fragment;
    }
    if (newline < 0) return;
    if (!droppingOversizedLine) inspectLine(pending.trim());
    pending = '';
    droppingOversizedLine = false;
    cursor = newline + 1;
  }
}

child.stdout.setEncoding('utf8');
child.stdout.on('data', consume);
child.stderr.on('data', () => {});
child.on('error', (error) => { childSpawnError = safeCode(error?.code) ?? 'EXECUTOR_SPAWN_ERROR'; });

const forwardedSignals = ['SIGTERM', 'SIGINT', 'SIGHUP'];
for (const signal of forwardedSignals) {
  process.on(signal, () => { if (!child.killed) child.kill(signal); });
}

function exitWithSignal(signal) {
  for (const name of forwardedSignals) process.removeAllListeners(name);
  process.kill(process.pid, signal);
}

child.on('close', (code, signal) => {
  if (pending && !droppingOversizedLine) inspectLine(pending.trim());
  if (threadStarted) emit({ type: 'thread.started', thread_id: threadStarted });
  if (childSpawnError) emit({ type: 'error', code: childSpawnError });
  else if (terminal) emit(terminal);
  if (signal) exitWithSignal(signal);
  else process.exit(Number.isInteger(code) && code >= 0 ? code : 1);
});
