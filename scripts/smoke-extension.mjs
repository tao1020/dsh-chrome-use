#!/usr/bin/env node
// Loads the unpacked extension in a real Chrome and checks that its background
// service worker starts and reports the version this package declares.
//
// Chrome 137+ no longer honours --load-extension in branded builds, so the
// extension is installed through the DevTools Extensions domain instead
// (--enable-unsafe-extension-debugging). Nothing touches the user's profile:
// every run uses a throwaway --user-data-dir.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extension = join(root, 'extension');
const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;

// Chrome derives an unpacked extension's id from its absolute path: the first
// 32 hex digits of the SHA-256, each hex digit shifted into a-p.
const expectedId = createHash('sha256').update(extension).digest('hex').slice(0, 32)
  .split('')
  .map(digit => String.fromCharCode(97 + parseInt(digit, 16)))
  .join('');

const candidates = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];
let binary = null;
for (const candidate of candidates) {
  if (!candidate) continue;
  try {
    await readFile(candidate);
    binary = candidate;
    break;
  } catch {
    // try the next well-known location
  }
}
if (!binary) {
  console.error('smoke: no Chrome binary found; set CHROME_BIN');
  process.exit(2);
}

const profile = await mkdtemp(join(tmpdir(), 'dsh-chrome-smoke-'));
const port = 9300 + Math.floor(Math.random() * 200);
const chrome = spawn(binary, [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  '--enable-unsafe-extension-debugging',
  '--no-first-run',
  '--no-default-browser-check',
  'about:blank',
], { stdio: 'ignore' });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function browserSocket() {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const info = await (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2000) })).json();
      if (info.webSocketDebuggerUrl) return info.webSocketDebuggerUrl;
    } catch {
      // Chrome is still starting
    }
    await sleep(200);
  }
  throw new Error(`Chrome did not expose a debugger endpoint on port ${port}`);
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    let nextId = 0;
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(`${message.error.message} (${message.error.code})`));
      else waiter.resolve(message.result);
    };
    socket.onerror = reject;
    socket.onopen = () => resolve({
      send: (method, params = {}) => new Promise((res, rej) => {
        const id = ++nextId;
        pending.set(id, { resolve: res, reject: rej });
        socket.send(JSON.stringify({ id, method, params }));
      }),
      close: () => socket.close(),
    });
  });
}

let service;
try {
  service = await connect(await browserSocket());
  const loaded = await service.send('Extensions.loadUnpacked', { path: extension });
  if (loaded.id !== expectedId) {
    throw new Error(`Chrome reports extension id ${loaded.id}, but the path implies ${expectedId}`);
  }

  // A freshly installed extension registers its worker a moment later, and the
  // worker's execution context can still be restarting when the target shows up,
  // so the version check is retried instead of trusting the first evaluate.
  let reported = null;
  let lastError = 'the background service worker never started';
  for (let attempt = 0; attempt < 40 && reported !== version; attempt += 1) {
    await sleep(250);
    let targets;
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) })).json();
    } catch {
      continue;
    }
    const worker = targets.find(target => target.type === 'service_worker' && String(target.url).startsWith(`chrome-extension://${expectedId}/`));
    if (!worker) continue;
    const workerService = await connect(worker.webSocketDebuggerUrl).catch(() => null);
    if (!workerService) continue;
    try {
      const answer = await workerService.send('Runtime.evaluate', { expression: 'chrome.runtime.getManifest().version', returnByValue: true });
      if (answer?.exceptionDetails) lastError = String(answer.exceptionDetails.exception?.description ?? 'evaluate failed');
      else reported = answer?.result?.value ?? null;
      if (typeof reported === 'string' && reported !== version) {
        throw new Error(`the running extension reports version ${reported}, but package.json says ${version}`);
      }
    } catch (error) {
      if (/package\.json says/.test(error.message)) throw error;
      lastError = error.message;
    } finally {
      workerService.close();
    }
  }
  if (reported !== version) {
    throw new Error(`the background service worker did not report version ${version} (last: ${lastError})`);
  }
  console.log(`smoke ok: extension ${expectedId} loaded, service worker started, version ${version}`);
} finally {
  service?.close();
  chrome.kill('SIGKILL');
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
