import { BrowserController } from './controller.js';
import { TabLeases } from './leases.js';
import { PORT, MAX_MESSAGE, PARALLEL_TABS, MESSAGE_UNREAD_MAX, validateArgs } from './protocol.js';
import { classifyPairingCode } from './pairing-code.js';

// One Chrome extension can drive several harnesses at once. Each connection
// keeps its own socket, pairing token, command map and cleanup generation. The
// only shared authority is the lease table below: it decides which connection
// may touch a tab. Bridge-local chat claims stay unchanged.
const MAX_CONNECTIONS = 10;
// Cross-Harness messages are stored here so a reconnect, or an MV3 worker
// restart, does not lose them. They are data from other agents, never user
// instructions; the bridge only surfaces a count until a tool reads the text.
const MESSAGE_TTL_MS = 600000;
const MESSAGE_LIMIT = 100;
const MESSAGE_RATE_PER_MINUTE = 20;
const MESSAGE_TARGET_ERROR = 'MESSAGE_TARGET: to must be a port between 1024 and 65535';
const MESSAGE_STORAGE_KEYS = ['agentMessages', 'agentSeq', 'agentCursors'];
const clients = new Map();
const portErrors = new Map();
const leases = new TabLeases();
const busyTabs = new Map();
// New pairings reserve a slot before the token is persisted. This counts both
// stored connections and handshakes still in flight.
const pairingInFlight = new Set();
let lastError = '';
let epochSeq = 0;
let lifecycleEpoch = 0;
let intentSeq = 0;
const portIntents = new Map();
const forgottenPorts = new Set();
let restoring;

// These actions make their tab the current tab of its window, and Chrome only
// delivers synthesized input to the current tab. Queue them across tabs so two
// commands cannot switch the same window underneath each other. They do not
// touch window focus, so the user keeps typing in whichever app is in front.
const inputActions = new Set(['activate', 'close', 'click', 'fill', 'key', 'hover', 'select', 'upload', 'drag', 'scroll_to', 'scroll']);
const inputQueue = [];
let inputBusy = false;
function acquireInput(signal) {
  if (signal.aborted) throw new Error('COMMAND_CANCELED');
  return new Promise((resolve, reject) => {
    const start = () => {
      signal.removeEventListener('abort', abort);
      inputBusy = true;
      resolve(() => {
        const next = inputQueue.shift();
        if (next) next(); else inputBusy = false;
      });
    };
    const abort = () => {
      const index = inputQueue.indexOf(start);
      if (index >= 0) inputQueue.splice(index, 1);
      reject(new Error('COMMAND_CANCELED'));
    };
    if (inputBusy) {
      inputQueue.push(start);
      signal.addEventListener('abort', abort, { once: true });
    } else start();
  });
}

// Foreground mode is shared by every connection because it is a browser
// behavior, not a per-harness preference.
async function applyMode() {
  const { foregroundMode } = await chrome.storage.local.get('foregroundMode');
  controller.foregroundMode = foregroundMode !== false;
}

const controller = new BrowserController(chrome, (tabId, reason) => {
  const owner = leases.get(tabId)?.client;
  leases.release(tabId);
  if (owner?.connected && owner.socket?.readyState === WebSocket.OPEN) {
    owner.socket.send(JSON.stringify({ type: 'detached', tabId, ...(reason ? { reason: String(reason).slice(0, 40) } : {}) }));
  }
});
const badge = text => { chrome.action.setBadgeText({ text }); chrome.action.setBadgeBackgroundColor({ color: '#185adb' }); };
const updateBadge = () => badge([...clients.values()].some(client => client.connected) ? 'ON' : '');
const isToken = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const isPort = value => Number.isSafeInteger(value) && value >= 1024 && value <= 65535;
const popupPort = value => {
  const port = typeof value === 'string' && /^\d{2,5}$/.test(value.trim()) ? Number(value.trim()) : value;
  if (!isPort(port)) throw new Error('Enter a port between 1024 and 65535.');
  return port;
};

// Storage writes are serialized. A pairing handshake and a disconnect can
// otherwise read the same old list and let the later write resurrect state.
let storageQueue = Promise.resolve();
function mutateStorage(operation) {
  const run = storageQueue.then(operation, operation);
  storageQueue = run.then(() => {}, () => {});
  return run;
}
function cleanName(value) {
  if (typeof value !== 'string') return undefined;
  const name = value.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, 40);
  return name || undefined;
}
function validConnections(value) {
  const list = Array.isArray(value) ? value : [];
  const seen = new Set();
  const connections = [];
  for (const item of list) {
    if (!item || !isPort(item.port) || !isToken(item.token) || seen.has(item.port)) continue;
    seen.add(item.port);
    const name = cleanName(item.name);
    connections.push({ port: item.port, token: item.token, ...(name ? { name } : {}) });
  }
  return connections.sort((a, b) => a.port - b.port);
}
async function readStored() {
  return chrome.storage.local.get(['connections', 'token', 'enabled']);
}

const isPortString = value => typeof value === 'string' && /^\d{4,5}$/.test(value) && isPort(Number(value));

// Storage is shared with older extension versions and hand-edited profiles, so
// every read is normalized before the queue or rate math touches it.
function validMessages(value) {
  const list = Array.isArray(value) ? value : [];
  const messages = [];
  for (const item of list) {
    if (!item || !Number.isSafeInteger(item.id) || item.id < 1) continue;
    if (!Number.isFinite(item.at)) continue;
    if (!isPortString(item.from)) continue;
    if (item.to !== 'all' && !isPortString(item.to)) continue;
    if (typeof item.text !== 'string' || !item.text.length || item.text.length > 800) continue;
    messages.push({ id: item.id, at: item.at, from: item.from, to: item.to, text: item.text });
  }
  return messages.sort((a, b) => a.id - b.id);
}
function validMessageCursors(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const cursors = {};
  for (const [key, id] of Object.entries(source)) {
    if (!isPortString(key) || !Number.isSafeInteger(id) || id < 0) continue;
    cursors[key] = id;
  }
  return cursors;
}
function messageSeq(stored, messages) {
  const last = messages.length ? messages[messages.length - 1].id : 0;
  const saved = Number.isSafeInteger(stored.agentSeq) && stored.agentSeq > 0 ? stored.agentSeq : 0;
  return Math.max(saved, last);
}
// Expired entries are dropped on every read and write, and the newest
// MESSAGE_LIMIT entries win so a burst cannot grow storage without bound.
function pruneMessages(messages, now) {
  const fresh = messages.filter(message => now - message.at <= MESSAGE_TTL_MS);
  return fresh.length > MESSAGE_LIMIT ? fresh.slice(-MESSAGE_LIMIT) : fresh;
}
function visibleMessages(port, messages, after) {
  return messages.filter(message => message.id > after && message.from !== port && (message.to === 'all' || message.to === port));
}
function messageTarget(value) {
  if (value === undefined) return 'all';
  const text = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{4,5}$/.test(text) || !isPort(Number(text))) throw new Error(MESSAGE_TARGET_ERROR);
  return String(Number(text));
}
function takeMessageSlot(client) {
  const now = Date.now();
  const times = (client.messageTimes ?? []).filter(time => now - time < 60000);
  if (times.length >= MESSAGE_RATE_PER_MINUTE) throw new Error(`MESSAGE_RATE_LIMITED: at most ${MESSAGE_RATE_PER_MINUTE} messages per minute per Harness`);
  times.push(now);
  client.messageTimes = times;
}

// Before multi-port support the extension kept one `token` for port 18791.
// Migrate it exactly once and remove the legacy key so forget cannot revive it.
let migration;
async function migrateLegacy() {
  await mutateStorage(async () => {
    const stored = await readStored();
    const connections = validConnections(stored.connections);
    if (!connections.length && isToken(stored.token)) connections.push({ port: PORT, token: stored.token });
    if (connections.length) await chrome.storage.local.set({ connections });
    await chrome.storage.local.remove('token');
  });
}
migration = migrateLegacy().catch(error => { lastError = String(error.message); });

async function savedConnections() {
  await migration;
  const stored = await readStored();
  return { connections: validConnections(stored.connections), enabled: stored.enabled === true };
}

function isCurrent(client, socket = client.socket) {
  return !client.revoked && clients.get(client.port) === client && client.socket === socket;
}
function createClient(port) {
  return {
    port,
    epoch: ++epochSeq,
    socket: undefined,
    connected: false,
    ready: undefined,
    version: null,
    name: null,
    lastError: '',
    tasks: new Map(),
    drain: undefined,
    revoked: false,
    abortStart: undefined,
    pairingReserved: false,
    persist: { wrote: false, wasSaved: false, committed: false },
    messageTimes: [],
  };
}

async function saveToken(client, port, token, name) {
  return mutateStorage(async () => {
    if (!isCurrent(client)) return false;
    const stored = await readStored();
    const connections = validConnections(stored.connections);
    const existing = connections.find(item => item.port === port);
    if (!existing && connections.length >= MAX_CONNECTIONS) throw new Error(`TOO_MANY_CONNECTIONS: forget a saved Harness before pairing another (maximum ${MAX_CONNECTIONS})`);
    client.persist.wasSaved = Boolean(existing);
    if (!isCurrent(client)) return false;
    const keptName = cleanName(name) ?? existing?.name;
    const next = connections.filter(item => item.port !== port)
      .concat({ port, token, ...(keptName ? { name: keptName } : {}) })
      .sort((a, b) => a.port - b.port);
    await chrome.storage.local.set({ connections: next, enabled: true });
    await chrome.storage.local.remove('token');
    client.persist.wrote = true;
    return true;
  });
}

async function drainClient(client) {
  if (client.drain) return client.drain;
  client.drain = (async () => {
    // Block commands as soon as cleanup starts, before the first await.
    for (const tabId of leases.ownedBy(client)) leases.beginClose(tabId, client);
    const tasks = [...client.tasks.values()];
    for (const task of tasks) task.cancellation.abort();
    await Promise.allSettled(tasks.map(task => task.done));
    // Tasks may have released a lease, or a canceled open may have reserved a
    // new one. Re-enumerate; never trust the pre-abort snapshot.
    for (let pass = 0; pass < 2; pass++) {
      const tabs = leases.ownedBy(client);
      if (!tabs.length) return;
      for (const tabId of tabs) leases.beginClose(tabId, client);
      for (const tabId of tabs) {
        if (leases.owner(tabId) !== client) continue;
        if (leases.get(tabId)?.state === 'quarantined') continue;
        try {
          await controller.detachTab(tabId);
        } catch (error) {
          if (leases.owner(tabId) === client) {
            leases.quarantine(tabId, client);
            client.lastError = String(error.message).slice(0, 2000);
            lastError = client.lastError;
            portErrors.set(client.port, client.lastError);
          }
          continue;
        }
        // A task or a late callback may have released/reassigned the lease while
        // native detach was running; do not clean up someone else's tab.
        if (leases.owner(tabId) !== client) continue;
        if (controller.attached.has(tabId) || controller.pendingCleanup.has(tabId)) leases.quarantine(tabId, client);
        else leases.release(tabId, client);
      }
    }
  })();
  return client.drain;
}

function retireClient(client) {
  client.revoked = true;
  if (clients.get(client.port) === client) clients.delete(client.port);
  client.abortStart?.();
  try { client.socket?.close(); } catch {}
  return drainClient(client);
}

async function startClient(client, { code, restoreEpoch } = {}) {
  const port = client.port;
  const staleRestore = () => restoreEpoch !== undefined && restoreEpoch !== lifecycleEpoch;
  if (staleRestore()) throw new Error(`COMMAND_CANCELED: restore for port ${port} was canceled`);
  if (!code && forgottenPorts.has(port)) throw new Error(`COMMAND_CANCELED: port ${port} was forgotten`);
  const { connections } = await savedConnections();
  if (staleRestore() || client.revoked) throw new Error(`COMMAND_CANCELED: connection to port ${port} was canceled`);
  if (!code && forgottenPorts.has(port)) throw new Error(`COMMAND_CANCELED: port ${port} was forgotten`);
  const saved = connections.find(item => item.port === port);
  if (!code && !saved) throw new Error(`No saved pairing for port ${port}. Enter the 8-digit code from Harness.`);
  if (!saved) {
    if (connections.length + pairingInFlight.size >= MAX_CONNECTIONS) throw new Error(`TOO_MANY_CONNECTIONS: forget a saved Harness before pairing another (maximum ${MAX_CONNECTIONS})`);
    pairingInFlight.add(port);
    client.pairingReserved = true;
  }
  if (staleRestore() || client.revoked) throw new Error(`COMMAND_CANCELED: connection to port ${port} was canceled`);

  let socket;
  try {
    socket = new WebSocket(`ws://127.0.0.1:${port}/bridge`);
    client.socket = socket;
    return await new Promise((resolve, reject) => {
      let done = false;
      let timer;
      const finish = (settle, value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        settle(value);
      };
      const fail = error => {
        finish(reject, error instanceof Error ? error : new Error(String(error)));
        try { socket.close(); } catch {}
      };
      timer = setTimeout(() => fail(new Error(`Connection to port ${port} timed out. Check that a Harness bridge is listening there.`)), 6000);
      client.abortStart = () => fail(new Error(`COMMAND_CANCELED: connection to port ${port} was canceled`));
      socket.onopen = () => {
        if (!isCurrent(client, socket)) return;
        socket.send(JSON.stringify({ ...(code ? { type: 'pair', code } : { type: 'auth', token: saved.token }), version: chrome.runtime.getManifest().version, features: [PARALLEL_TABS] }));
      };
      socket.onmessage = async event => {
        if (!isCurrent(client, socket)) return;
        try {
          if (typeof event.data !== 'string' || event.data.length > MAX_MESSAGE) throw new Error('Invalid bridge message');
          const message = JSON.parse(event.data);
          if (message.type === 'ready') {
            if (message.protocol !== 1 || !isToken(message.token)) throw new Error('Unsupported bridge protocol');
            const name = cleanName(message.name);
            const persisted = await saveToken(client, port, message.token, name);
            if (!persisted || !isCurrent(client, socket)) {
              fail(new Error(`COMMAND_CANCELED: connection to port ${port} was canceled`));
              return;
            }
            // A first pairing starts at the current message head; a reconnect
            // keeps its saved cursor so messages that arrived offline are read.
            if (client.persist.wasSaved === false) await initMessageCursor(client, port);
            client.connected = true;
            client.persist.committed = true;
            client.version = chrome.runtime.getManifest().version;
            client.name = name ?? client.name ?? null;
            client.lastError = '';
            portErrors.delete(port);
            lastError = '';
            finish(resolve, client);
            chrome.alarms.create('reconnect', { periodInMinutes: 0.5 }).catch(() => {});
            updateBadge();
          } else if (message.type === 'error') {
            client.lastError = String(message.error).slice(0, 2000);
            lastError = client.lastError;
            fail(new Error(client.lastError));
          } else if (message.type === 'command' && client.connected) {
            await handleCommand(client, message);
          } else if (message.type === 'cancel') {
            if (typeof message.id === 'string') client.tasks.get(message.id)?.cancellation.abort();
          }
        } catch (error) {
          client.lastError = String(error.message).slice(0, 2000);
          lastError = client.lastError;
          fail(error);
        }
      };
      socket.onerror = () => { client.lastError = `Cannot reach a Harness bridge on port ${port}.`; };
      socket.onclose = () => {
        if (clients.get(port) !== client || client.socket !== socket) {
          finish(reject, new Error(client.lastError || `Connection to port ${port} closed. Reconnect to continue.`));
          return;
        }
        client.connected = false;
        clients.delete(port);
        updateBadge();
        drainClient(client).catch(error => { lastError = String(error.message); });
        finish(reject, new Error(client.lastError || `Connection to port ${port} closed. Reconnect to continue.`));
      };
    });
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    client.abortStart = undefined;
    if (client.pairingReserved) {
      pairingInFlight.delete(port);
      client.pairingReserved = false;
    }
  }
}

function beginIntent(port) {
  const intent = ++intentSeq;
  portIntents.set(port, intent);
  return intent;
}

function connectPort(port, options = {}) {
  if (options.code) {
    forgottenPorts.delete(port);
    beginIntent(port);
  }
  const existing = clients.get(port);
  if (existing?.connected) return Promise.resolve(existing);
  if (existing?.ready) return existing.ready;
  if (existing) retireClient(existing).catch(() => {});
  const client = createClient(port);
  clients.set(port, client);
  const start = startClient(client, options);
  const ready = start.finally(() => {
    if (client.ready === ready) client.ready = undefined;
    if (!client.connected && !client.revoked && clients.get(port) === client) clients.delete(port);
  });
  client.ready = ready;
  ready.catch(error => { if (!/^COMMAND_CANCELED/.test(error.message)) portErrors.set(port, String(error.message).slice(0, 2000)); });
  return ready;
}

function sendResult(client, message, response) {
  if (!isCurrent(client) || !client.connected || client.socket?.readyState !== WebSocket.OPEN) return;
  const body = JSON.stringify({ type: 'result', id: message.id, ...response });
  client.socket.send(body.length <= MAX_MESSAGE ? body : JSON.stringify({ type: 'result', id: message.id, error: 'RESULT_TOO_LARGE' }));
}

// Only the count and the senders reach the bridge; message text stays in
// storage until a tool asks for it, so the model never reads it unwittingly.
function pushInbox(sender, messages, cursors) {
  const delivered = [];
  for (const peer of clients.values()) {
    if (peer === sender || !peer.connected || !isCurrent(peer) || peer.socket?.readyState !== WebSocket.OPEN) continue;
    const unread = visibleMessages(String(peer.port), messages, cursors[String(peer.port)] ?? 0);
    if (!unread.length) continue;
    const senders = [...new Set(unread.map(message => message.from))].slice(0, 3);
    // The bridge only accepts counts up to the same cap, so clamp here instead
    // of sending a hint it would reject; chrome_messages still pages through.
    const count = Math.min(unread.length, MESSAGE_UNREAD_MAX);
    peer.socket.send(JSON.stringify({ type: 'inbox', unread: count, senders }));
    delivered.push(String(peer.port));
  }
  return delivered;
}

async function sendAgentMessage(client, message, args) {
  const to = messageTarget(args.to);
  // Another agent writes this text, so drop control characters (escape
  // sequences, NUL) before storing it; newlines and tabs are kept.
  const text = args.text.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim();
  if (!text) throw new Error('MESSAGE_TEXT: text must not be blank');
  takeMessageSlot(client);
  const from = String(client.port);
  const state = await mutateStorage(async () => {
    const stored = await chrome.storage.local.get(MESSAGE_STORAGE_KEYS);
    const now = Date.now();
    const messages = pruneMessages(validMessages(stored.agentMessages), now);
    const entry = { id: messageSeq(stored, messages) + 1, at: now, from, to, text };
    messages.push(entry);
    const kept = messages.length > MESSAGE_LIMIT ? messages.slice(-MESSAGE_LIMIT) : messages;
    const cursors = validMessageCursors(stored.agentCursors);
    await chrome.storage.local.set({ agentMessages: kept, agentSeq: entry.id });
    return { entry, messages: kept, cursors };
  });
  const delivered = pushInbox(client, state.messages, state.cursors);
  sendResult(client, message, { result: { ...state.entry, delivered } });
}

async function readAgentMessages(client, message, args) {
  const port = String(client.port);
  const limit = args.limit ?? 20;
  const outcome = await mutateStorage(async () => {
    const stored = await chrome.storage.local.get(MESSAGE_STORAGE_KEYS);
    const raw = validMessages(stored.agentMessages);
    const messages = pruneMessages(raw, Date.now());
    const cursors = validMessageCursors(stored.agentCursors);
    const cursor = cursors[port] ?? 0;
    // `after` replays from an explicit id but never moves the saved cursor
    // backwards, so the next normal read continues where it left off.
    const start = args.after === undefined ? cursor : args.after;
    const visible = visibleMessages(port, messages, start);
    const unread = visibleMessages(port, messages, cursor);
    // A busy inbox is capped instead of failing: return the newest page the
    // bridge can report, so the reader catches up without dumping everything.
    const page = unread.length > MESSAGE_UNREAD_MAX ? visible.slice(-MESSAGE_UNREAD_MAX) : visible.slice(0, limit);
    const nextCursor = Math.max(cursor, page.length ? page[page.length - 1].id : cursor);
    const unreadAfter = visibleMessages(port, messages, nextCursor).length;
    const patch = {};
    if (messages.length !== raw.length) patch.agentMessages = messages;
    if (nextCursor !== cursor) {
      cursors[port] = nextCursor;
      patch.agentCursors = cursors;
    }
    if (Object.keys(patch).length) await chrome.storage.local.set(patch);
    return { messages: page, cursor: nextCursor, unread: unreadAfter };
  });
  sendResult(client, message, { result: outcome });
}

async function initMessageCursor(client, port) {
  await mutateStorage(async () => {
    if (!isCurrent(client)) return;
    const stored = await chrome.storage.local.get(MESSAGE_STORAGE_KEYS);
    const messages = pruneMessages(validMessages(stored.agentMessages), Date.now());
    const cursors = validMessageCursors(stored.agentCursors);
    // A fresh pairing starts at the current head instead of replaying history;
    // a reconnect keeps its saved cursor so offline messages still arrive.
    cursors[String(port)] = messageSeq(stored, messages);
    await chrome.storage.local.set({ agentCursors: cursors });
  });
}

async function settleFailedLease(client, tabId, action) {
  if (tabId === undefined || leases.owner(tabId) !== client) return;
  // A failed command must never clear a tab that is waiting for native cleanup.
  if (leases.get(tabId)?.state === 'quarantined') return;
  if (action === 'close') { leases.quarantine(tabId, client); return; }
  if (controller.attached.has(tabId)) return;
  if (controller.pendingCleanup.has(tabId)) { leases.quarantine(tabId, client); return; }
  leases.release(tabId, client);
}

async function handleCommand(client, message) {
  const id = message.id;
  if (typeof id !== 'string' || id.length > 200 || !Number.isFinite(message.deadline) || message.deadline <= Date.now() || message.deadline > Date.now() + 20000) {
    throw new Error('Invalid command deadline');
  }
  if (client.tasks.has(id)) {
    sendResult(client, message, { error: 'DUPLICATE_COMMAND_ID' });
    return;
  }
  const action = message.action;
  let args;
  try {
    args = validateArgs(`chrome_${action}`, message.args);
  } catch (error) {
    sendResult(client, message, { error: String(error.message).slice(0, 2000) });
    return;
  }
  // Inbox tools only touch extension storage: they need no tab, input lock,
  // lease or controller access, so they never take a busy tab or a task slot.
  if (action === 'send_message' || action === 'messages') {
    try {
      if (action === 'send_message') await sendAgentMessage(client, message, args);
      else await readAgentMessages(client, message, args);
    } catch (error) {
      sendResult(client, message, { error: String(error.message).slice(0, 2000) });
    }
    return;
  }
  const tabId = Number.isSafeInteger(args.tabId) ? args.tabId : undefined;
  const lease = tabId === undefined ? undefined : leases.get(tabId);
  if (lease?.state === 'quarantined') {
    sendResult(client, message, { error: 'TAB_LEASE_QUARANTINED: this tab did not finish native cleanup; reload the extension to clear it' });
    return;
  }
  if (lease?.state === 'closing') {
    sendResult(client, message, { error: 'TAB_LEASE_CLOSING: this tab is being cleaned up; retry after cleanup settles' });
    return;
  }
  if (tabId !== undefined && busyTabs.has(tabId)) {
    sendResult(client, message, { error: 'TAB_BUSY: another command is already running on this tab' });
    return;
  }
  if (action === 'claim' && tabId !== undefined) {
    try { leases.acquire(tabId, client); }
    catch (error) { sendResult(client, message, { error: String(error.message).slice(0, 2000) }); return; }
  } else if (action === 'release' || action === 'close') {
    const owner = tabId === undefined ? undefined : leases.owner(tabId);
    if (!owner) { sendResult(client, message, { error: 'TAB_NOT_LEASED: claim the tab first' }); return; }
    if (owner !== client) { sendResult(client, message, { error: 'TAB_OWNED_BY_ANOTHER_HARNESS: another Harness has claimed this tab; use another tab or release it there' }); return; }
  } else if (tabId !== undefined) {
    const owner = leases.owner(tabId);
    if (!owner) { sendResult(client, message, { error: 'TAB_NOT_LEASED: claim the tab first' }); return; }
    if (owner !== client) { sendResult(client, message, { error: 'TAB_OWNED_BY_ANOTHER_HARNESS: another Harness has claimed this tab; use another tab or release it there' }); return; }
  }

  const cancellation = new AbortController();
  let finish;
  const done = new Promise(resolve => { finish = resolve; });
  const task = { id, client, tabId, cancellation, done };
  client.tasks.set(id, task);
  if (tabId !== undefined) busyTabs.set(tabId, task);
  const deadline = setTimeout(() => cancellation.abort(), message.deadline - Date.now());
  let response;
  let releaseInput;
  let openedTabId;
  let cleanupFailed = false;
  try {
    if (inputActions.has(action)) {
      try { await applyMode(); }
      catch (error) { lastError = error.message; }
      releaseInput = await acquireInput(cancellation.signal);
    }
    const options = action === 'open'
      ? { onTabCreated: tabId => { openedTabId = tabId; return leases.reserve(tabId, client); } }
      : undefined;
    response = { result: await controller.execute(action, args, cancellation.signal, options) };
  } catch (error) {
    response = { error: String(error.message).slice(0, 2000) };
  } finally {
    clearTimeout(deadline);
    try {
      if (tabId !== undefined && leases.owner(tabId) === client && (cancellation.signal.aborted || controller.pendingCleanup.has(tabId))) {
        try { await controller.detachTab(tabId); }
        catch (error) {
          cleanupFailed = true;
          leases.quarantine(tabId, client);
          client.lastError = String(error.message).slice(0, 2000);
          portErrors.set(client.port, client.lastError);
        }
        if (controller.attached.has(tabId) || controller.pendingCleanup.has(tabId)) {
          cleanupFailed = true;
          leases.quarantine(tabId, client);
          client.lastError = 'BROWSER_CLEANUP_PENDING: native cleanup did not settle; reload the extension before touching this tab';
          portErrors.set(client.port, client.lastError);
        } else if (action === 'close') leases.quarantine(tabId, client);
        else leases.release(tabId, client);
      }
    } finally {
      client.tasks.delete(id);
      if (tabId !== undefined && busyTabs.get(tabId) === task) busyTabs.delete(tabId);
      releaseInput?.();
      finish();
    }
  }
  if (!response.error) {
    if ((action === 'release' || action === 'close') && tabId !== undefined) leases.release(tabId, client);
  } else {
    await settleFailedLease(client, openedTabId ?? tabId, action);
  }
  // An unresolved native cleanup must not acknowledge the command: the bridge
  // would release its lock while Chrome may still dispatch the old work.
  if (cleanupFailed) {
    try { client.socket?.close(); } catch {}
    return;
  }
  sendResult(client, message, response);
}

async function disconnectAll() {
  lifecycleEpoch++;
  portErrors.clear();
  const current = [...clients.values()];
  const oldClients = new Set(current);
  for (const client of current) {
    client.revoked = true;
    if (clients.get(client.port) === client) clients.delete(client.port);
    client.abortStart?.();
    try { client.socket?.close(); } catch {}
  }
  await mutateStorage(async () => {
    const stored = await readStored();
    const connections = validConnections(stored.connections);
    // A completed pairing is user state and survives disconnect. Only a token
    // written by a handshake that never reached ready is rolled back.
    const keep = connections.filter(item => {
      const client = current.find(candidate => candidate.port === item.port);
      if (!client?.persist.wrote) return true;
      return Boolean(client.persist.wasSaved || client.persist.committed);
    });
    await chrome.storage.local.set({ connections: keep, enabled: false });
    await chrome.storage.local.remove('token');
  });
  await chrome.alarms.clear('reconnect');
  await Promise.all(current.map(client => drainClient(client)));
  // Never reset the whole controller here: a new connection may already own
  // tabs while the old cleanup is still settling.
  for (const [tabId, entry] of leases.entries) {
    if (!oldClients.has(entry.client)) continue;
    if (entry.state === 'quarantined' || entry.state === 'closing' || controller.attached.has(tabId) || controller.pendingCleanup.has(tabId)) leases.quarantine(tabId, entry.client);
    else leases.release(tabId, entry.client);
  }
  updateBadge();
}

async function forgetConnection(port) {
  // Revoke the current connection and cancel pending restores synchronously,
  // before the first await. A concurrent explicit pairing must not receive the
  // soon-to-retire client.
  lifecycleEpoch++;
  forgottenPorts.add(port);
  const intent = beginIntent(port);
  portErrors.delete(port);
  const client = clients.get(port);
  const retiring = client ? retireClient(client) : undefined;
  const remove = () => mutateStorage(async () => {
    const stored = await readStored();
    const connections = validConnections(stored.connections).filter(item => item.port !== port);
    await chrome.storage.local.set({ connections, ...(connections.length ? {} : { enabled: false }) });
    await chrome.storage.local.remove('token');
    return connections.length;
  });
  let remaining = await remove();
  if (retiring) await retiring;
  // A newer explicit pairing on the same port wins. Do not erase its token.
  if (portIntents.get(port) !== intent) { updateBadge(); return; }
  // A handshake that was already past the admission fence may have written a
  // token while cleanup ran. Remove it once more.
  remaining = await remove();
  if (!remaining) await chrome.alarms.clear('reconnect');
  updateBadge();
}

async function restoreConnections() {
  if (restoring) return restoring;
  restoring = (async () => {
    const epoch = lifecycleEpoch;
    await migration;
    if (epoch !== lifecycleEpoch) return;
    const { connections, enabled: auto } = await savedConnections();
    if (epoch !== lifecycleEpoch) return;
    if (!auto || !connections.length) { await chrome.alarms.clear('reconnect'); updateBadge(); return; }
    if (connections.length > MAX_CONNECTIONS) lastError = `TOO_MANY_CONNECTIONS: only the first ${MAX_CONNECTIONS} saved Harness connections are restored`;
    // Each missing port is attempted independently; one healthy peer must not
    // suppress recovery of another. The captured epoch cancels a stale restore
    // after disconnect or forget.
    await Promise.allSettled(connections.slice(0, MAX_CONNECTIONS).map(({ port }) => {
      if (epoch !== lifecycleEpoch) return null;
      if (clients.get(port)?.connected) return null;
      return connectPort(port, { restoreEpoch: epoch }).catch(error => { lastError = String(error.message).slice(0, 2000); });
    }));
    if (epoch !== lifecycleEpoch) { updateBadge(); return; }
    // Create the retry alarm only after the admission-fenced attempts. A delayed
    // create can no longer race with disconnect/forget and revive a peer.
    await chrome.alarms.create('reconnect', { periodInMinutes: 0.5 });
    updateBadge();
  })();
  try { await restoring; } finally { restoring = undefined; }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('popup.html')) return false;
  (async () => {
    if (message.action === 'connect') {
      const raw = String(message.code ?? '').trim();
      const suppliedPort = message.port === undefined || String(message.port).trim() === '' ? undefined : popupPort(message.port);
      let port;
      let code;
      if (raw) {
        const parsed = classifyPairingCode(raw);
        if (!parsed) throw new Error('Enter the 8-character pairing code from Harness.');
        if (parsed.kind === 'encoded') {
          if (suppliedPort !== undefined && suppliedPort !== parsed.port) throw new Error(`PAIRING_CODE_PORT_MISMATCH: this code belongs to port ${parsed.port}; clear or update the port field`);
          port = parsed.port;
        } else {
          port = suppliedPort ?? PORT;
        }
        code = parsed.code;
      } else {
        port = suppliedPort ?? PORT;
      }
      await connectPort(port, code ? { code } : undefined);
    } else if (message.action === 'disconnect') await disconnectAll();
    else if (message.action === 'forget') await forgetConnection(popupPort(message.port));
    else if (message.action !== 'status') throw new Error('Unknown action');
    const { connections, enabled: auto } = await savedConnections();
    const connected = [...clients.values()].some(client => client.connected);
    return {
      // Old single-connection fields stay for the first-generation popup.
      connected,
      paired: connections.length > 0,
      reconnecting: auto && !connected,
      connections: connections.map(item => {
        const client = clients.get(item.port);
        return { port: item.port, name: client?.name ?? item.name ?? null, connected: Boolean(client?.connected), version: client?.version ?? null, error: client?.lastError || portErrors.get(item.port) || '' };
      }),
      enabled: auto,
      error: lastError,
      tabs: (await chrome.tabs.query({})).filter(tab => controller.attached.has(tab.id)).map(tab => ({ id: tab.id, title: tab.title, attached: true })),
    };
  })().then(result => respond({ ok: true, ...result }), error => respond({ ok: false, error: error.message }));
  return true;
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'reconnect') restoreConnections().catch(error => { lastError = error.message; });
});
chrome.runtime.onStartup.addListener(() => restoreConnections().catch(error => { lastError = error.message; }));
restoreConnections().catch(error => { lastError = error.message; });
