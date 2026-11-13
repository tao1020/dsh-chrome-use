import { createServer } from 'node:http';
import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { PORT, MAX_MESSAGE, DEADLINE_MS, PARALLEL_TABS, MESSAGE_UNREAD_MAX } from '../extension/protocol.js';
import { classifyPairingCode, generatePairingCode, normalizePairingCode } from '../extension/pairing-code.js';
import { candidatePorts, portStateDir, preferencePath, probePort, readPreferredPort, writePreferredPort } from './port-selector.js';

const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const extensionOrigin = /^chrome-extension:\/\/[a-p]{32}$/;
const CLAIM_WAIT_MS = 10000;
const normalizeName = value => {
  if (typeof value !== 'string') return undefined;
  const name = value.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, 40);
  return name || undefined;
};
const portValue = value => {
  const port = typeof value === 'string' ? Number(value) : value;
  return Number.isSafeInteger(port) && port >= 1024 && port <= 65535 ? String(port) : undefined;
};

export class Bridge {
  constructor({ port = PORT, auto = false, portCandidates, baseStateDir, stateDir, name, probe = probePort, deadlineMs = DEADLINE_MS, claimWaitMs = CLAIM_WAIT_MS } = {}) {
    // Optional label the agent side shows in the popup so the user can tell
    // Harnesses apart; it is display-only and never used for routing.
    this.name = normalizeName(name);
    this.port = auto ? undefined : port;
    this.requestedPort = auto ? undefined : port;
    this.auto = auto;
    this.portCandidates = portCandidates;
    this.baseStateDir = baseStateDir;
    this.stateDir = stateDir;
    this.probe = probe;
    this.deadlineMs = deadlineMs;
    this.claimWaitMs = claimWaitMs;
    this.claims = new Map();
    // One in-flight command per tab. Commands without a tabId may run together.
    this.pending = new Map();
    this.busyTabs = new Map();
    // Chats queue here when they want a tab another chat already claimed.
    this.claimWaiters = new Map();
    this.closingTabs = new Set();
    // Chrome can drop a debugger session on its own. Remember why for a short
    // while so a follow-up command can say more than "claim the tab first".
    this.lastDetach = new Map();
    this.closed = false;
    this.authFailures = [];
    // Cross-Harness inbox hint. Only a count and sender ports live here; the
    // message text waits in extension storage until chrome_messages reads it.
    this.inbox = undefined;
  }

  async start() {
    if (!this.auto) {
      try {
        await this.listen(this.port);
      } catch (error) {
        if (error.message.startsWith('PAIRING_STATE_ERROR')) throw error;
        throw this.startFailure(error, this.port);
      }
      this.requestedPort = this.port;
      return;
    }

    const preferred = this.baseStateDir ? await readPreferredPort(preferencePath(this.baseStateDir)) : undefined;
    const candidates = this.portCandidates ?? candidatePorts(preferred);
    this.requestedPort = candidates[0];
    for (const candidate of candidates) {
      if (!(await this.probe(candidate))) continue;
      try {
        await this.listen(candidate);
      } catch (error) {
        if (error.code === 'EADDRINUSE') continue;
        if (error.message.startsWith('PAIRING_STATE_ERROR')) throw error;
        throw this.startFailure(error, candidate);
      }
      if (this.baseStateDir) {
        await writePreferredPort(preferencePath(this.baseStateDir), this.port).catch(error => { this.lastError = `PORT_PREFERENCE_WRITE_FAILED: ${error.message}`; });
      }
      return;
    }
    throw new Error(`BRIDGE_START_FAILED: no free loopback port among ${candidates.join(', ')}. Set DSH_CHROME_USE_PORT to a free port.`);
  }

  startFailure(error, port) {
    return new Error(`BRIDGE_START_FAILED: ${error.code ?? error.message}. Port ${port} is unavailable; stop the other process or start this Harness with DSH_CHROME_USE_PORT set to a free port.`);
  }

  async listen(port) {
    const stateDir = this.baseStateDir ? portStateDir(this.baseStateDir, port) : this.stateDir;
    const http = createServer((req, res) => {
      res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      res.end('dsh-chrome-use accepts only authenticated extension connections.');
    });
    http.requestTimeout = 5000;
    http.headersTimeout = 5000;
    const ws = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE, perMessageDeflate: false });
    const boundPort = () => http.address()?.port ?? port;
    http.on('upgrade', (req, socket, head) => {
      if (this.closed || req.url !== '/bridge' || req.headers.host !== `127.0.0.1:${boundPort()}` || !extensionOrigin.test(req.headers.origin ?? '') || ws.clients.size >= 4) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        return;
      }
      ws.handleUpgrade(req, socket, head, client => this.accept(client, req.headers.origin));
    });
    await new Promise((resolve, reject) => {
      http.once('error', reject);
      http.listen(port, '127.0.0.1', () => {
        http.off('error', reject);
        resolve();
      });
    }).catch(error => {
      ws.close();
      const failure = new Error(error.code ?? error.message);
      failure.code = error.code;
      throw failure;
    });
    let identity;
    if (stateDir) {
      try {
        await mkdir(stateDir, { recursive: true, mode: 0o700 });
        try {
          identity = JSON.parse(await readFile(join(stateDir, 'pairing.json'), 'utf8'));
          if (!extensionOrigin.test(identity.origin) || !/^[a-f0-9]{64}$/.test(identity.token)) throw new Error('Invalid saved pairing');
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      } catch (error) {
        ws.close();
        await new Promise(resolve => http.close(resolve));
        throw new Error(`PAIRING_STATE_ERROR: ${error.message}`);
      }
    }
    http.on('error', error => { this.lastError = error.message; });
    this.http = http;
    this.ws = ws;
    this.port = boundPort();
    this.stateDir = stateDir;
    this.identity = identity;
    this.heartbeat = setInterval(() => {
      for (const client of ws.clients) {
        if (client.alive === false) client.terminate();
        else {
          client.alive = false;
          client.ping();
          // Application messages keep an MV3 service worker alive (Chrome 116+).
          if (client.authenticated) client.send(JSON.stringify({ type: 'heartbeat' }));
        }
      }
    }, 15000);
    this.heartbeat.unref();
  }

  status() {
    return {
      connected: this.peer?.readyState === WebSocket.OPEN,
      port: this.port,
      ...(this.requestedPort !== undefined && this.requestedPort !== this.port ? { requestedPort: this.requestedPort } : {}),
      extensionVersion: this.peer?.extensionVersion ?? null,
      claimedTabs: [...this.claims.keys()],
      ...(this.inbox?.unread ? { messages: { unread: this.inbox.unread, senders: [...this.inbox.senders] } } : {}),
      ...(this.lastError ? { lastError: this.lastError } : {}),
    };
  }

  pair() {
    if (this.peer) throw new Error('ALREADY_CONNECTED: disconnect in the extension before pairing again');
    const code = String(randomInt(10000000, 100000000));
    const pairingCode = generatePairingCode(this.port, () => randomInt(0, 0x1000000));
    this.pairing = { code, pairingCode, expires: Date.now() + 600000, attempts: 0 };
    return {
      code,
      pairingCode,
      port: this.port,
      expiresInSeconds: 600,
      instructions: `Open dsh-chrome-use in the Chrome toolbar and enter the 8-character pairing code for port ${this.port}. New extensions read the port from the code; older extensions use the 8-digit compatibility code only on port 18791. Connecting permits access to all normal tabs in this Chrome. Do not enter the code into a website or post it publicly.`,
    };
  }

  accept(client, origin) {
    client.alive = true;
    client.on('pong', () => { client.alive = true; });
    const timer = setTimeout(() => client.close(1008, 'Authentication timeout'), 5000);
    timer.unref();
    client.on('error', () => {}); // close handles cleanup; never log page payloads or tokens.
    client.on('close', () => {
      clearTimeout(timer);
      if (this.peer === client) {
        this.peer = undefined;
        this.inbox = undefined;
        this.claims.clear();
        this.busyTabs.clear();
        this.closingTabs.clear();
        this.rejectAllWaiters(new Error('BROWSER_DISCONNECTED: the extension disconnected; nothing was changed'));
        for (const task of this.pending.values()) {
          clearTimeout(task.cleanupTimer);
          task.reject(new Error('BROWSER_DISCONNECTED: outcome may be unknown; inspect before retrying'));
        }
        this.pending.clear();
      }
    });
    client.on('message', async (bytes, binary) => {
      try {
        if (binary) throw new Error('INVALID_MESSAGE');
        const message = JSON.parse(bytes.toString());
        if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('INVALID_MESSAGE');
        if (!client.authenticated) {
          if (client.authenticating) throw new Error('AUTH_IN_PROGRESS');
          client.authenticating = true;
          this.authFailures = this.authFailures.filter(time => time > Date.now() - 60000);
          if (this.authFailures.length >= 10) throw new Error('PAIRING_RATE_LIMIT');
          let identity;
          if (message.type === 'pair') {
            const pairing = this.pairing;
            let matched = false;
            if (pairing && Date.now() < pairing.expires) {
              pairing.attempts += 1;
              if (pairing.attempts <= 5) {
                const submitted = normalizePairingCode(message.code);
                const classified = classifyPairingCode(submitted);
                if (classified?.kind === 'encoded') matched = classified.port === this.port && equal(classified.code, pairing.pairingCode);
                else if (classified?.kind === 'legacy') matched = equal(classified.code, pairing.code);
              }
            }
            if (!matched) {
              this.authFailures.push(Date.now());
              throw new Error('AUTH_FAILED: request a fresh pairing code from Harness');
            }
            if (this.peer) throw new Error('BROWSER_ALREADY_CONNECTED');
            // Reserve before file I/O so two pairing requests cannot win.
            this.pairing = undefined;
            identity = { origin, token: randomBytes(32).toString('hex') };
          } else if (message.type === 'auth' && this.identity?.origin === origin && equal(message.token, this.identity.token)) {
            identity = this.identity;
          } else {
            this.authFailures.push(Date.now());
            throw new Error('AUTH_FAILED: request a fresh pairing code from Harness');
          }
          if (this.peer) throw new Error('BROWSER_ALREADY_CONNECTED');
          this.peer = client;
          if (identity !== this.identity && this.stateDir) {
            const temporary = join(this.stateDir, `pairing-${randomUUID()}.tmp`);
            await writeFile(temporary, JSON.stringify(identity), { mode: 0o600, flag: 'wx' });
            await rename(temporary, join(this.stateDir, 'pairing.json'));
          }
          if (client.readyState !== WebSocket.OPEN || this.closed) throw new Error('BROWSER_DISCONNECTED');
          this.identity = identity;
          client.authenticated = true;
          client.extensionVersion = typeof message.version === 'string' && /^\d+(\.\d+){0,3}$/.test(message.version) ? message.version : null;
          client.parallel = Array.isArray(message.features) && message.features.includes(PARALLEL_TABS);
          this.lastError = undefined;
          clearTimeout(timer);
          client.send(JSON.stringify({ type: 'ready', token: identity.token, protocol: 1, ...(this.name ? { name: this.name } : {}) }));
          return;
        }
        if (message.type === 'inbox') {
          const senders = Array.isArray(message.senders) && message.senders.length <= 3 ? message.senders.map(portValue) : [];
          if (Number.isSafeInteger(message.unread) && message.unread >= 1 && message.unread <= MESSAGE_UNREAD_MAX && senders.length && senders.every(port => port !== undefined)) {
            this.inbox = { unread: message.unread, senders, at: Date.now() };
          }
          // A malformed hint is ignored: it is not worth dropping a working
          // connection over, and the next chrome_messages call re-syncs state.
          return;
        }
        if (message.type === 'detached' && Number.isSafeInteger(message.tabId)) {
          this.claims.delete(message.tabId);
          this.lastDetach.set(message.tabId, {
            reason: typeof message.reason === 'string' ? message.reason.slice(0, 40) : null,
            at: Date.now(),
          });
          if (this.lastDetach.size > 200) this.lastDetach.delete(this.lastDetach.keys().next().value);
          this.wake(message.tabId);
          return;
        }
        if (message.type === 'result') {
          const task = this.pending.get(message.id);
          if (!task) return;
          this.pending.delete(message.id);
          clearTimeout(task.cleanupTimer);
          if (task.interrupted) {
            // open has no input tabId: a late success can leave an attached tab
            // unknown to its canceled caller. Disconnect so reset cleans it up.
            if (task.action === 'open' && !message.error) {
              this.lastError = 'CANCELED_OPEN: disconnecting to clean up an unowned tab; the page may remain open';
              client.terminate();
              return;
            }
            if (this.busyTabs.get(task.tabId) === message.id) this.busyTabs.delete(task.tabId);
            this.wake(task.tabId);
            return;
          }
          if (message.error) {
            const error = new Error(String(message.error).slice(0, 2000));
            if (message.failure && typeof message.failure === 'object' && typeof message.failure.code === 'string') error.failure = message.failure;
            task.reject(error);
          }
          else if (message.result && typeof message.result === 'object' && !Array.isArray(message.result)) task.resolve(message.result);
          else task.reject(new Error('INVALID_BROWSER_RESPONSE'));
        }
      } catch (error) {
        this.lastError = String(error.message).slice(0, 2000);
        if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: 'error', error: this.lastError }));
        client.close(1008, 'Protocol or authentication error');
      }
    });
  }

  // Grant the tab to the first waiting chat only when no command is using it.
  wake(tabId) {
    if (this.claims.has(tabId) || this.busyTabs.has(tabId) || this.closingTabs.has(tabId)) return;
    const queue = this.claimWaiters.get(tabId);
    if (!queue?.length) return;
    const waiter = queue.shift();
    if (!queue.length) this.claimWaiters.delete(tabId);
    if (waiter.done) {
      this.wake(tabId);
      return;
    }
    this.claims.set(tabId, waiter.owner);
    waiter.finish();
  }

  waitForClaim(tabId, owner, signal) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const queue = this.claimWaiters.get(tabId) ?? [];
      if (queue.some(waiter => waiter.owner === owner)) {
        reject(new Error('TAB_CLAIM_PENDING: this chat is already waiting for the tab; await its first claim'));
        return;
      }
      let timer;
      let abort;
      const waiter = { owner, done: false, finish: error => {
        if (waiter.done) return;
        waiter.done = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        const index = queue.indexOf(waiter);
        if (index >= 0) queue.splice(index, 1);
        if (!queue.length && this.claimWaiters.get(tabId) === queue) this.claimWaiters.delete(tabId);
        if (error) reject(error); else resolve();
      } };
      abort = () => waiter.finish(new Error('CANCELED: waiting for the tab was canceled; nothing was changed'));
      timer = setTimeout(() => waiter.finish(new Error(`TAB_IN_USE: another chat kept this tab for ${Math.round(this.claimWaitMs / 1000)}s; use another tab or ask the user to release it`)), this.claimWaitMs);
      signal.addEventListener('abort', abort, { once: true });
      queue.push(waiter);
      this.claimWaiters.set(tabId, queue);
    });
  }

  releaseClaim(tabId, owner) {
    if (this.claims.get(tabId) !== owner) return;
    this.claims.delete(tabId);
    this.wake(tabId);
  }

  // Chrome reasons are short codes. Expire them so an old detach cannot explain
  // an unrelated failure much later.
  detachNote(tabId) {
    const last = this.lastDetach.get(tabId);
    if (!last || Date.now() - last.at > 60000) return '';
    const age = Math.max(0, Math.round((Date.now() - last.at) / 1000));
    return ` (Chrome detached this tab ${age}s ago${last.reason ? `: ${last.reason}` : ''})`;
  }

  rejectWaiters(tabId, error) {
    const queue = this.claimWaiters.get(tabId);
    if (!queue) return;
    this.claimWaiters.delete(tabId);
    for (const waiter of [...queue]) waiter.finish(error);
  }

  rejectAllWaiters(error) {
    for (const tabId of [...this.claimWaiters.keys()]) this.rejectWaiters(tabId, error);
  }

  async call(action, args, owner, signal = new AbortController().signal) {
    signal.throwIfAborted();
    if (this.closed) throw new Error('BRIDGE_STOPPED');
    const peer = this.peer;
    if (!peer?.authenticated || peer.readyState !== WebSocket.OPEN) throw new Error('BROWSER_NOT_CONNECTED: open the extension or use chrome_pair');
    const parallel = peer.parallel === true;
    if (!parallel && this.pending.size) throw new Error('BROWSER_BUSY: another command is running; wait for its result');
    if (!owner) throw new Error('MISSING_CHAT_ID');
    if (args.tabId && action !== 'claim' && this.claims.get(args.tabId) !== owner) throw new Error(`TAB_NOT_OWNED: claim the tab first${this.detachNote(args.tabId)}`);
    const tabId = Number.isSafeInteger(args.tabId) ? args.tabId : undefined;
    let reserved = false;
    let acquired = false;
    let closing = false;
    let id;
    let timer;
    let abort;
    try {
      if (action === 'claim' && tabId !== undefined && this.claims.get(tabId) !== owner) {
        if (!this.claims.has(tabId) && !this.busyTabs.has(tabId)) {
          // Reserve before sending so a second chat queues instead of racing the extension.
          this.claims.set(tabId, owner);
          reserved = true;
        } else {
          await this.waitForClaim(tabId, owner, signal);
          reserved = true;
        }
      }
      signal.throwIfAborted();
      if (tabId !== undefined && this.busyTabs.has(tabId)) throw new Error('TAB_BUSY: another command is already running on this tab; wait for it or use another tab');
      if (this.closed) throw new Error('BRIDGE_STOPPED');
      if (this.peer !== peer || !peer.authenticated || peer.readyState !== WebSocket.OPEN) throw new Error('BROWSER_NOT_CONNECTED: the extension disconnected; nothing was changed');
      // A queued claim may resume after another legacy command started.
      if (!parallel && this.pending.size) throw new Error('BROWSER_BUSY: another command is running; wait for its result');
      id = randomUUID();
      if (action === 'close' && tabId !== undefined) {
        this.closingTabs.add(tabId);
        closing = true;
      }
      const result = await new Promise((resolve, reject) => {
        const task = { resolve, reject, tabId, action, interrupted: false, cleanupTimer: undefined };
        this.pending.set(id, task);
        if (tabId !== undefined) this.busyTabs.set(tabId, id);
        const uncertain = (code) => {
          if (!this.pending.has(id) || task.interrupted) return; // The result won the race; keep it.
          task.interrupted = true;
          if (!parallel) {
            // An older extension cannot stop one command; disconnecting is the only safe option.
            this.claims.clear();
            this.rejectAllWaiters(new Error('BROWSER_DISCONNECTED: the connection was closed; nothing was changed'));
            if (peer.readyState === WebSocket.OPEN) peer.close(1011, 'Command interrupted');
            reject(new Error(`${code}: the connection was closed; inspect the page before retrying.`));
            return;
          }
          // Keep the tab locked until the final result acknowledges extension cleanup.
          // If cleanup never finishes, fail closed instead of handing out an unsafe tab.
          task.cleanupTimer = setTimeout(() => {
            this.lastError = 'BROWSER_CLEANUP_TIMEOUT: closing connection because canceled work did not settle';
            peer.terminate();
          }, 8000);
          if (peer.readyState === WebSocket.OPEN) {
            try { peer.send(JSON.stringify({ type: 'cancel', id })); }
            catch { peer.terminate(); }
          }
          reject(new Error(`${code}: cancellation requested for this command; its tab stays locked until cleanup finishes. The operation may already have happened; inspect before retrying.`));
        };
        timer = setTimeout(() => uncertain('BROWSER_TIMEOUT'), this.deadlineMs);
        abort = () => uncertain('CANCELED');
        signal.addEventListener('abort', abort, { once: true });
        peer.send(JSON.stringify({ type: 'command', id, action, args, deadline: Date.now() + this.deadlineMs }));
      });
      // A received result wins a simultaneous cancellation; preserve ownership
      // of successful opens instead of losing their newly attached tab.
      if (action === 'claim' || action === 'open') {
        const tab = action === 'open' ? result.tabId : args.tabId;
        if (!Number.isSafeInteger(tab) || tab < 1 || this.claims.has(tab) && this.claims.get(tab) !== owner) throw new Error('INVALID_BROWSER_TAB');
        this.claims.set(tab, owner);
        this.lastDetach.delete(tab);
        acquired = true;
      }
      if (action === 'release') this.releaseClaim(args.tabId, owner);
      if (action === 'messages') {
        // Reading consumes the hint; the result already carries the text.
        const unread = Number.isSafeInteger(result?.unread) && result.unread > 0 ? result.unread : 0;
        this.inbox = unread && unread <= MESSAGE_UNREAD_MAX ? { unread, senders: this.inbox?.senders ?? [], at: Date.now() } : undefined;
        return result;
      }
      // The hint rides along with the next tool result so a busy chat still
      // learns the inbox changed without polling chrome_status.
      if (this.inbox?.unread) return { ...result, messages: { unread: this.inbox.unread, senders: [...this.inbox.senders] } };
      return result;
    } catch (error) {
      // The extension lost its debugger session; free the claim so the next chat can attach.
      if (action === 'release' && /^TAB_NOT_ATTACHED/.test(error.message)) this.releaseClaim(args.tabId, owner);
      throw error;
    } finally {
      clearTimeout(timer);
      if (abort) signal.removeEventListener('abort', abort);
      const cleaningUp = id && this.pending.get(id)?.interrupted;
      if (id && !cleaningUp) this.pending.delete(id);
      if (!cleaningUp && tabId !== undefined && this.busyTabs.get(tabId) === id) this.busyTabs.delete(tabId);
      // Failed claims release their reservation, but canceled work retains its busy lock.
      if (action === 'claim' && reserved && !acquired) this.releaseClaim(tabId, owner);
      if (closing) {
        this.closingTabs.delete(tabId);
        this.claims.delete(tabId);
        this.rejectWaiters(tabId, new Error('TAB_CLOSED: the tab was closed; claim another tab'));
      }
      if (tabId !== undefined) this.wake(tabId);
    }
  }

  async stop() {
    this.closed = true;
    this.inbox = undefined;
    clearInterval(this.heartbeat);
    this.rejectAllWaiters(new Error('BRIDGE_STOPPED: the bridge is shutting down; nothing was changed'));
    this.claimWaiters.clear();
    this.closingTabs.clear();
    for (const task of this.pending.values()) {
      clearTimeout(task.cleanupTimer);
      task.reject(new Error('BRIDGE_STOPPED'));
    }
    this.pending.clear();
    this.busyTabs.clear();
    for (const client of this.ws?.clients ?? []) client.terminate();
    this.claims.clear();
    await Promise.all([
      this.ws && new Promise(resolve => this.ws.close(resolve)),
      this.http?.listening && new Promise(resolve => this.http.close(resolve)),
    ]);
  }
}
