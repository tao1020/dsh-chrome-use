import { createServer } from 'node:net';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { PORT } from '../extension/protocol.js';

export const FIXTURE_PORT = 18792;
export const AUTO_PORTS = [PORT, 18793, 18794, 18795, 18796, 18797, 18798, 18799];
export const PREFERENCE_FILE = 'port.json';

export function isValidAutoPort(value) {
  return Number.isSafeInteger(value) && value >= 1024 && value <= 65535 && value !== FIXTURE_PORT;
}

export function portStateDir(baseDir, port) {
  return port === PORT ? baseDir : join(baseDir, `port-${port}`);
}

export function candidatePorts(preferred) {
  const candidates = [];
  for (const port of [preferred, ...AUTO_PORTS]) {
    if (isValidAutoPort(port) && !candidates.includes(port)) candidates.push(port);
  }
  return candidates;
}

export async function readPreferredPort(file) {
  try {
    const value = JSON.parse(await readFile(file, 'utf8'));
    return isValidAutoPort(value?.port) ? value.port : undefined;
  } catch {
    return undefined;
  }
}

export async function writePreferredPort(file, port) {
  if (!isValidAutoPort(port)) throw new Error(`INVALID_PORT: ${port}`);
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, JSON.stringify({ port }), { mode: 0o600 });
  await rename(temporary, file);
}

// A loopback probe is advisory only. The actual bind is still the reservation,
// so a concurrent process can win between probe and bind.
export async function probePort(port) {
  const probe = createServer();
  try {
    await new Promise((resolve, reject) => {
      probe.once('error', reject);
      probe.listen(port, '127.0.0.1', resolve);
    });
    return true;
  } catch (error) {
    if (error.code === 'EADDRINUSE') return false;
    throw new Error(`BRIDGE_PORT_PROBE_FAILED: ${error.code ?? error.message}`);
  } finally {
    if (probe.listening) await new Promise(resolve => probe.close(resolve));
  }
}

export function preferencePath(baseDir) {
  return join(baseDir, PREFERENCE_FILE);
}
