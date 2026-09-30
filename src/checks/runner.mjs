import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';

function linuxIdentity(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
    return { start: fields[19], state: fields[0],
      boot: readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() };
  } catch { return null; }
}

export function checkRunnerIdentity() {
  return { pid: process.pid, host: hostname(), linux: linuxIdentity(process.pid) };
}

// Runner identity is not proof that its descendants have stopped. Recovery
// separately requires explicit owner evidence covering all executors.
export function observeCheckRunner(runner) {
  if (!runner || runner.host !== hostname() || !Number.isInteger(runner.pid) || runner.pid < 1) {
    return { state: 'unknown' };
  }
  const current = linuxIdentity(runner.pid);
  if (runner.linux && current) {
    if (runner.linux.boot !== current.boot || runner.linux.start !== current.start) return { state: 'stopped' };
    return { state: ['Z', 'X'].includes(current.state) ? 'stopped' : 'live' };
  }
  try { process.kill(runner.pid, 0); return { state: 'live' }; }
  catch (error) { return { state: error.code === 'ESRCH' ? 'stopped' : 'unknown' }; }
}
