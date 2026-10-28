import { createServer } from 'node:http';
import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { PORT, MAX_MESSAGE, DEADLINE_MS } from '../extension/protocol.js';

const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const extensionOrigin = /^chrome-extension:\/\/[a-p]{32}$/;

export class Bridge {
  constructor({ port = PORT, stateDir, deadlineMs = DEADLINE_MS } = {}) {
    this.port = port;
    this.stateDir = stateDir;
    this.deadlineMs = deadlineMs;
    this.claims = new Map();
    this.closed = false;
    this.authFailures = [];
  }

  async start() {
    if (this.stateDir) {
      await mkdir(this.stateDir, { recursive: true, mode: 0o700 });
      try {
        this.identity = JSON.parse(await readFile(join(this.stateDir, 'pairing.json'), 'utf8'));
        if (!extensionOrigin.test(this.identity.origin) || !/^[a-f0-9]{64}$/.test(this.identity.token)) throw new Error('Invalid saved pairing');
      } catch (error) {
        if (error.code !== 'ENOENT') throw new Error(`PAIRING_STATE_ERROR: ${error.message}`);
      }
    }
    this.http = createServer((req, res) => {
      res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      res.end('dsh-chrome-use accepts only authenticated extension connections.');
    });
    this.http.requestTimeout = 5000;
    this.http.headersTimeout = 5000;
    this.ws = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE, perMessageDeflate: false });
    this.http.on('upgrade', (req, socket, head) => {
      if (this.closed || req.url !== '/bridge' || req.headers.host !== `127.0.0.1:${this.port}` || !extensionOrigin.test(req.headers.origin ?? '') || this.ws.clients.size >= 4) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        return;
      }
      this.ws.handleUpgrade(req, socket, head, client => this.accept(client, req.headers.origin));
    });
    await new Promise((resolve, reject) => {
      this.http.once('error', reject);
      this.http.listen(this.port, '127.0.0.1', () => {
        this.http.off('error', reject);
        this.port = this.http.address().port;
        resolve();
      });
    }).catch(error => { this.ws.close(); throw new Error(`BRIDGE_START_FAILED: ${error.code ?? error.message}. Another Harness profile may already own port ${this.port}.`); });
    this.http.on('error', error => { this.lastError = error.message; });
    this.heartbeat = setInterval(() => {
      for (const client of this.ws.clients) {
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
    return { connected: this.peer?.readyState === WebSocket.OPEN, port: this.port, extensionVersion: this.peer?.extensionVersion ?? null, claimedTabs: [...this.claims.keys()], ...(this.lastError ? { lastError: this.lastError } : {}) };
  }

  pair() {
    if (this.peer) throw new Error('ALREADY_CONNECTED: disconnect in the extension before pairing again');
    this.pairing = { code: String(randomInt(10000000, 100000000)), expires: Date.now() + 120000, attempts: 0 };
    return { code: this.pairing.code, port: this.port, expiresInSeconds: 120, instructions: 'Open dsh-chrome-use in the Chrome toolbar, enter this code and click Connect. Connecting permits access to all normal tabs in this Chrome. Do not enter the code into a website or post it publicly.' };
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
        this.claims.clear();
        this.pending?.reject(new Error('BROWSER_DISCONNECTED: outcome may be unknown; inspect before retrying'));
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
          if (message.type === 'pair' && this.pairing && Date.now() < this.pairing.expires && ++this.pairing.attempts <= 5 && equal(message.code, this.pairing.code)) {
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
          this.lastError = undefined;
          clearTimeout(timer);
          client.send(JSON.stringify({ type: 'ready', token: identity.token, protocol: 1 }));
          return;
        }
        if (message.type === 'detached' && Number.isSafeInteger(message.tabId)) {
          this.claims.delete(message.tabId);
          return;
        }
        if (message.type === 'result' && this.pending?.id === message.id) {
          if (message.error) this.pending.reject(new Error(String(message.error).slice(0, 2000)));
          else if (message.result && typeof message.result === 'object' && !Array.isArray(message.result)) this.pending.resolve(message.result);
          else this.pending.reject(new Error('INVALID_BROWSER_RESPONSE'));
        }
      } catch (error) {
        this.lastError = String(error.message).slice(0, 2000);
        if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: 'error', error: this.lastError }));
        client.close(1008, 'Protocol or authentication error');
      }
    });
  }

  async call(action, args, owner, signal = new AbortController().signal) {
    signal.throwIfAborted();
    if (this.closed) throw new Error('BRIDGE_STOPPED');
    if (!this.peer?.authenticated || this.peer.readyState !== WebSocket.OPEN) throw new Error('BROWSER_NOT_CONNECTED: open the extension or use chrome_pair');
    if (this.pending) throw new Error('BROWSER_BUSY: another command is running; wait for its result');
    if (!owner) throw new Error('MISSING_CHAT_ID');
    if (args.tabId && action !== 'claim' && this.claims.get(args.tabId) !== owner) throw new Error('TAB_NOT_OWNED: claim the tab first');
    if (action === 'claim' && this.claims.has(args.tabId) && this.claims.get(args.tabId) !== owner) throw new Error('TAB_IN_USE: another chat owns this tab');
    const id = randomUUID();
    const peer = this.peer;
    let timer;
    let abort;
    try {
      const result = await new Promise((resolve, reject) => {
        this.pending = { id, resolve, reject };
        const uncertain = (code) => {
          peer.close(1011, 'Command interrupted');
          this.claims.clear();
          reject(new Error(`${code}: browser disconnected to stop further work. The operation may already have happened; inspect before retrying.`));
        };
        timer = setTimeout(() => uncertain('BROWSER_TIMEOUT'), this.deadlineMs);
        abort = () => uncertain('CANCELED');
        signal.addEventListener('abort', abort, { once: true });
        peer.send(JSON.stringify({ type: 'command', id, action, args, deadline: Date.now() + this.deadlineMs }));
      });
      signal.throwIfAborted();
      if (action === 'claim' || action === 'open') {
        const tab = action === 'open' ? result.tabId : args.tabId;
        if (!Number.isSafeInteger(tab) || tab < 1 || this.claims.has(tab) && this.claims.get(tab) !== owner) throw new Error('INVALID_BROWSER_TAB');
        this.claims.set(tab, owner);
      }
      if (action === 'release') this.claims.delete(args.tabId);
      return result;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (this.pending?.id === id) this.pending = undefined;
    }
  }

  async stop() {
    this.closed = true;
    clearInterval(this.heartbeat);
    this.pending?.reject(new Error('BRIDGE_STOPPED'));
    for (const client of this.ws?.clients ?? []) client.terminate();
    this.claims.clear();
    await Promise.all([
      this.ws && new Promise(resolve => this.ws.close(resolve)),
      this.http?.listening && new Promise(resolve => this.http.close(resolve)),
    ]);
  }
}
