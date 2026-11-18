import { spawn as spawnProcess } from 'node:child_process';
import { existsSync } from 'node:fs';

// caffeinate is part of macOS. The tool is host-side because keeping the Mac
// awake has nothing to do with Chrome, and it must also work before a tab is
// claimed (or when the browser is not connected).
export const CAFFEINATE = '/usr/bin/caffeinate';
export const MAX_MINUTES = 480;
export const DEFAULT_MINUTES = 30;

// The assertion has two independent ends: caffeinate's own -t timeout, and -w
// tying it to this process so a crashed or quit Harness cannot leave the Mac
// awake forever. The local timer only keeps our own state honest; it is unref'd
// so it never keeps Node alive.
export function createKeepAwake({
  platform = process.platform,
  spawn = spawnProcess,
  exists = existsSync,
  now = Date.now,
  pid = process.pid,
} = {}) {
  let child = null;
  let timer = null;

  function forget() {
    if (timer) clearTimeout(timer);
    timer = null;
    child = null;
  }

  function stop() {
    const active = child !== null;
    if (child) {
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
    }
    forget();
    return active;
  }

  function start(value = DEFAULT_MINUTES) {
    if (platform !== 'darwin') throw new Error('KEEP_AWAKE_UNSUPPORTED: keeping the Mac awake with caffeinate is available on macOS only');
    if (!Number.isSafeInteger(value) || value < 1 || value > MAX_MINUTES) throw new Error(`KEEP_AWAKE_MINUTES: minutes must be an integer between 1 and ${MAX_MINUTES}`);
    if (!exists(CAFFEINATE)) throw new Error('KEEP_AWAKE_UNAVAILABLE: /usr/bin/caffeinate is missing; check this macOS installation');

    const seconds = value * 60;
    let next;
    try {
      next = spawn(CAFFEINATE, ['-dimsu', '-t', String(seconds), '-w', String(pid)], { stdio: 'ignore' });
    } catch (error) {
      throw new Error(`KEEP_AWAKE_FAILED: could not start caffeinate: ${error.message}`);
    }
    if (!next || typeof next.kill !== 'function' || typeof next.unref !== 'function') throw new Error('KEEP_AWAKE_FAILED: could not start caffeinate');
    // Do not keep the Harness process alive just for the assertion.
    next.unref();

    // Start the replacement before stopping the old one so a failed renewal
    // never leaves the Mac unprotected.
    const previous = child;
    const deadline = now() + seconds * 1000;
    child = next;
    if (previous) {
      try { previous.kill('SIGTERM'); } catch { /* already gone */ }
    }

    const finish = () => { if (child === next) forget(); };
    if (typeof next.once === 'function') {
      next.once('exit', finish);
      next.once('error', finish);
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(finish, seconds * 1000);
    timer.unref?.();

    return {
      active: true,
      minutes: value,
      expiresAt: new Date(deadline).toISOString(),
      pid: typeof next.pid === 'number' ? next.pid : null,
    };
  }

  return { start, stop };
}
