// Private init entrypoint. It is never a CLI surface: bootstrap is supplied only on inherited FD3 and acknowledgement only on FD4.
import { closeSync, readSync, writeFileSync } from 'node:fs';

const MAX_BOOTSTRAP_FRAME_BYTES = 65_536;

function readBoundedFrame(fd) {
  const chunks = [];
  let total = 0;
  const buffer = Buffer.allocUnsafe(8_192);
  while (true) {
    const bytesRead = readSync(fd, buffer, 0, buffer.length, null);
    if (bytesRead === 0) break;
    total += bytesRead;
    if (total > MAX_BOOTSTRAP_FRAME_BYTES) throw new Error('CANDIDATE_FENCE_FRAME_TOO_LARGE');
    chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
  }
  return Buffer.concat(chunks, total).toString('utf8');
}

export function readPrivateFenceBootstrapV2() {
  const frame = readBoundedFrame(3);
  const value = JSON.parse(frame);
  if (!value?.nonce || !value?.generation) throw new Error('CANDIDATE_FENCE_FRAME_INVALID');
  writeFileSync(4, JSON.stringify({ nonce: value.nonce, generation: value.generation }));
  closeSync(3);
  closeSync(4);
  return Object.freeze({ nonce: value.nonce, generation: value.generation, admissionFdsClosed: true });
}
