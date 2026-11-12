import test from 'node:test';
import assert from 'node:assert/strict';
import { PARALLEL_TABS } from '../extension/protocol.js';
import { encodePairingCode } from '../extension/pairing-code.js';

async function until(predicate, timeout = 2000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error('condition not reached in time');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

async function fixture(t, initial = {}) {
  const stored = { ...initial };
  const listeners = {};
  const sockets = [];
  const alarms = new Set();
  const tabUrls = new Map();
  const readyTokens = new Map();
  const readyNames = new Map();
  const heldReady = new Set();
  let autoReady = true;
  let nextTabId = 9;
  const event = name => ({ addListener(fn) { listeners[name] = fn; } });
  const originalChrome = globalThis.chrome;
  const originalSocket = globalThis.WebSocket;
  const runtime = {
    id: 'test-extension',
    getURL: file => `chrome-extension://test-extension/${file}`,
    getManifest: () => ({ version: '0.1.1' }),
    onMessage: event('message'),
    onStartup: event('startup'),
  };
  const api = {
    runtime,
    storage: { local: {
      get: async () => ({ ...stored }),
      set: async value => { Object.assign(stored, value); },
      remove: async key => { delete stored[key]; },
    } },
    action: { setBadgeText() {}, setBadgeBackgroundColor() {} },
    alarms: { onAlarm: event('alarm'), create: async name => alarms.add(name), clear: async name => alarms.delete(name) },
    tabs: {
      onRemoved: event('removed'),
      query: async () => [],
      get: async id => ({ id, url: tabUrls.get(id) ?? 'https://example.com/', windowId: 1 }),
      create: async () => { const id = nextTabId++; tabUrls.set(id, 'about:blank'); return { id, url: 'about:blank', windowId: 1 }; },
      group: async options => { listeners.group?.({ options }); return 77; },
      update: async (id, info) => ({ id, ...info }),
      remove: async id => { tabUrls.delete(id); listeners.removed?.(id); },
    },
    windows: { update: async (id, info) => ({ id, ...info }) },
    tabGroups: { query: async () => [], update: async () => {} },
    downloads: { search: async () => [] },
    debugger: {
      onDetach: event('detach'),
      onEvent: event('debugEvent'),
      attach: async () => {},
      detach: async () => {},
      sendCommand: async (target, method, params) => {
        if (method === 'Page.navigate') tabUrls.set(target.tabId, params.url);
        return {};
      },
    },
  };
  globalThis.chrome = api;
  globalThis.WebSocket = class {
    static OPEN = 1;
    readyState = 1;
    sent = [];
    constructor(url) {
      this.url = url;
      this.port = Number(/:(\d+)\/bridge$/.exec(url)?.[1]);
      this.pendingReady = undefined;
      sockets.push(this);
      queueMicrotask(() => { if (this.readyState === 1) this.onopen?.(); });
    }
    send(body) {
      if (this.readyState !== 1) return;
      const message = JSON.parse(body);
      this.sent.push(message);
      if (message.type !== 'auth' && message.type !== 'pair') return;
      const reply = () => {
        if (this.readyState !== 1) return;
        const name = readyNames.get(this.port);
        this.onmessage?.({ data: JSON.stringify({ type: 'ready', protocol: 1, token: readyTokens.get(this.port) ?? 'a'.repeat(64), ...(name ? { name } : {}) }) });
      };
      if (autoReady && !heldReady.has(this.port)) queueMicrotask(reply);
      else this.pendingReady = reply;
    }
    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.onclose?.();
    }
  };
  // Separate module instances model a newly started extension worker. No browser or network is used.
  await import(`../extension/background.js?test=${crypto.randomUUID()}`);
  const message = (action, extra = {}) => new Promise(resolve => listeners.message({ action, ...extra }, { id: runtime.id, url: runtime.getURL('popup.html') }, resolve));
  const settled = () => new Promise(resolve => setImmediate(resolve));
  const socketFor = port => [...sockets].reverse().find(socket => socket.port === port && socket.readyState === 1);
  const socketCount = port => sockets.filter(socket => socket.port === port).length;
  const commandOn = (port, id, action, args = {}) => {
    const socket = socketFor(port);
    if (!socket) throw new Error(`no open socket on ${port}`);
    return socket.onmessage({ data: JSON.stringify({ type: 'command', id, action, args, deadline: Date.now() + 5000 }) });
  };
  const defaultPort = () => socketFor(18791) ? 18791 : socketFor(18793) ? 18793 : sockets[0]?.port;
  const command = (id, action, args = {}) => commandOn(defaultPort(), id, action, args);
  const releaseReady = port => {
    heldReady.delete(port);
    const socket = [...sockets].reverse().find(item => item.port === port && item.readyState === 1);
    socket?.pendingReady?.();
  };
  t.after(async () => {
    await message('disconnect');
    globalThis.chrome = originalChrome;
    globalThis.WebSocket = originalSocket;
  });
  await settled();
  await settled();
  return {
    stored, sockets, alarms, listeners, message, settled, command, commandOn, socketFor, socketCount,
    api, readyTokens, heldReady, setReadyName: (port, name) => readyNames.set(port, name),
    holdReady: port => { autoReady = false; heldReady.add(port); },
    releaseReady,
    setNextTabId: id => { nextTabId = id; },
    setAutoReady: value => { autoReady = value; },
    tabUrls,
  };
}

test('worker startup migrates the legacy token to port 18791 and disconnect keeps it but disables reconnect', async t => {
  const { sockets, alarms, stored, message, listeners, settled } = await fixture(t, { token: 'a'.repeat(64), enabled: true, foregroundMode: false });
  assert.equal(sockets.length, 1);
  assert.equal(sockets[0].url, 'ws://127.0.0.1:18791/bridge');
  assert.equal(sockets[0].sent[0].type, 'auth');
  assert.equal(sockets[0].sent[0].code, undefined);
  assert.deepEqual(sockets[0].sent[0].features, [PARALLEL_TABS]);
  assert.deepEqual(stored.connections, [{ port: 18791, token: 'a'.repeat(64) }]);
  assert.equal(stored.token, undefined);
  const status = await message('status');
  assert.equal(status.connected, true);
  assert.equal(status.paired, true);
  assert.deepEqual(status.connections.map(row => row.port), [18791]);
  assert.equal(alarms.has('reconnect'), true);
  await message('disconnect');
  assert.equal(stored.enabled, false);
  assert.deepEqual(stored.connections, [{ port: 18791, token: 'a'.repeat(64) }]);
  listeners.alarm({ name: 'reconnect' });
  await settled();
  assert.equal(sockets.length, 1);
  assert.equal(alarms.has('reconnect'), false);
});

test('a saved pair waits for Connect, then reconnects without a code and restores the missing peer', async t => {
  const { sockets, message, listeners, settled, socketFor, socketCount } = await fixture(t, {
    connections: [{ port: 18791, token: 'a'.repeat(64) }, { port: 18793, token: 'b'.repeat(64) }],
    enabled: false,
  });
  assert.equal(sockets.length, 0);
  assert.equal((await message('status')).paired, true);
  await message('connect', { port: 18791 });
  await message('connect', { port: 18793 });
  assert.equal(socketFor(18791).sent[0].type, 'auth');
  assert.equal(socketFor(18793).sent[0].type, 'auth');
  socketFor(18793).close();
  listeners.alarm({ name: 'reconnect' });
  await until(() => socketCount(18793) === 2);
  assert.equal(socketCount(18791), 1); // one original, never a duplicate
  await settled();
  assert.equal((await message('status')).connected, true);
});

test('a bridge name is saved and shown in status, and survives a reconnect without one', async t => {
  const { message, setReadyName, stored, socketFor, settled } = await fixture(t, {
    connections: [{ port: 18791, token: 'a'.repeat(64) }],
    enabled: false,
  });
  setReadyName(18791, 'Codex');
  await message('connect', { port: 18791 });
  await settled();
  assert.deepEqual(stored.connections, [{ port: 18791, token: 'a'.repeat(64), name: 'Codex' }]);
  let status = await message('status');
  assert.equal(status.connections[0].name, 'Codex');
  socketFor(18791).close();
  setReadyName(18791, undefined);
  await message('connect', { port: 18791 });
  await settled();
  status = await message('status');
  assert.equal(status.connections[0].name, 'Codex');
});

test('disconnect cancels a Connect before it has read saved state', async t => {
  const { api, message, sockets } = await fixture(t, {
    connections: [{ port: 18791, token: 'a'.repeat(64) }],
    enabled: false,
  });
  const get = api.storage.local.get;
  let releaseRead;
  let gated = false;
  api.storage.local.get = async keys => {
    if (!gated) {
      gated = true;
      await new Promise(resolve => { releaseRead = resolve; });
    }
    return get(keys);
  };
  const connecting = message('connect', { port: 18791 });
  await until(() => gated);
  const disconnecting = message('disconnect');
  releaseRead();
  const [result] = await Promise.all([connecting, disconnecting]);
  assert.equal(result.ok, false);
  assert.equal(sockets.length, 0);
});

test('tab-switching commands are FIFO across tabs while reads remain parallel', async t => {
  const { api, command, settled } = await fixture(t, {
    connections: [{ port: 18791, token: 'a'.repeat(64) }], enabled: true, foregroundMode: false,
  });
  for (const tabId of [7, 8, 9, 10]) await command(`claim-${tabId}`, 'claim', { tabId });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const focused = [];
  api.tabs.update = async (id, info) => {
    focused.push(id);
    if (id === 7) await gate;
    return { id, ...info };
  };
  const first = command('first', 'key', { tabId: 7, key: 'Enter' });
  await until(() => focused.length === 1);
  const second = command('second', 'key', { tabId: 8, key: 'Enter' });
  const third = command('third', 'key', { tabId: 9, key: 'Enter' });
  try {
    await command('read', 'tabs');
    await command('tab-read', 'screenshot', { tabId: 10 });
    await settled();
    assert.deepEqual(focused, [7]);
  } finally { release(); await Promise.all([first, second, third]); }
  assert.deepEqual(focused, [7, 8, 9]);
});

test('cancellation holds tab and input lock until detach completes and acknowledges cleanup', async t => {
  const { api, command, socketFor, settled } = await fixture(t, {
    connections: [{ port: 18791, token: 'a'.repeat(64) }], enabled: true, foregroundMode: false,
  });
  for (const tabId of [7, 8]) await command(`claim-${tabId}`, 'claim', { tabId });
  const socket = socketFor(18791);
  const focused = [];
  api.tabs.update = async (id, info) => {
    focused.push(id);
    if (id === 7) return new Promise(() => {});
    return { id, ...info };
  };
  let detached = false;
  let finishDetach;
  const detachGate = new Promise(resolve => { finishDetach = resolve; });
  api.debugger.detach = async () => { detached = true; await detachGate; };
  const first = command('first', 'key', { tabId: 7, key: 'Enter' });
  await until(() => focused.length === 1);
  const second = command('second', 'key', { tabId: 8, key: 'Enter' });
  socket.onmessage({ data: JSON.stringify({ type: 'cancel', id: 'first' }) });
  await until(() => detached);
  try {
    await settled();
    assert.deepEqual(focused, [7]);
    assert.equal(socket.sent.some(item => item.type === 'result' && item.id === 'first'), false);
    await command('early-claim', 'claim', { tabId: 7 });
    assert.match(socket.sent.find(item => item.id === 'early-claim').error, /TAB_BUSY/);
  } finally { finishDetach(); await Promise.all([first, second]); }
  const notification = socket.sent.findIndex(item => item.type === 'detached' && item.tabId === 7);
  const result = socket.sent.findIndex(item => item.type === 'result' && item.id === 'first');
  assert.ok(notification >= 0 && result > notification);
  assert.deepEqual(focused, [7, 8]);
});

test('unresolved cancellation cleanup closes the socket without acknowledging success', async t => {
  const { api, command, socketFor } = await fixture(t, {
    connections: [{ port: 18791, token: 'a'.repeat(64) }], enabled: true, foregroundMode: false,
  });
  await command('claim', 'claim', { tabId: 7 });
  let started = false;
  api.tabs.update = async () => { started = true; return new Promise(() => {}); };
  api.debugger.detach = () => new Promise(() => {});
  const socket = socketFor(18791);
  const work = command('canceled', 'key', { tabId: 7, key: 'Enter' });
  await until(() => started);
  await socket.onmessage({ data: JSON.stringify({ type: 'cancel', id: 'canceled' }) });
  await work;
  assert.equal(socket.readyState, 3);
  assert.equal(socket.sent.some(item => item.type === 'result' && item.id === 'canceled'), false);
});

test('canceling a queued input command removes it without blocking the next tab', async t => {
  const { api, command, socketFor } = await fixture(t, {
    connections: [{ port: 18791, token: 'a'.repeat(64) }], enabled: true, foregroundMode: false,
  });
  for (const tabId of [7, 8, 9]) await command(`claim-${tabId}`, 'claim', { tabId });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const focused = [];
  api.tabs.update = async (id, info) => {
    focused.push(id);
    if (id === 7) await gate;
    return { id, ...info };
  };
  const first = command('first', 'key', { tabId: 7, key: 'Enter' });
  await until(() => focused.length === 1);
  const canceled = command('canceled', 'key', { tabId: 8, key: 'Enter' });
  const third = command('third', 'key', { tabId: 9, key: 'Enter' });
  try {
    await socketFor(18791).onmessage({ data: JSON.stringify({ type: 'cancel', id: 'canceled' }) });
    await canceled;
    assert.match(socketFor(18791).sent.find(item => item.id === 'canceled').error, /COMMAND_CANCELED/);
    assert.deepEqual(focused, [7]);
  } finally { release(); await Promise.all([first, third]); }
  assert.deepEqual(focused, [7, 9]);
});

test('foreground mode makes input raise the Chrome window', async t => {
  const { api, command } = await fixture(t, {
    connections: [{ port: 18791, token: 'a'.repeat(64) }], enabled: true, foregroundMode: true,
  });
  await command('claim', 'claim', { tabId: 7 });
  const methods = [];
  api.debugger.sendCommand = async (target, method) => { methods.push(method); return {}; };
  api.tabs.update = async (id, info) => { methods.push('tabs.update'); return { id, ...info }; };
  await command('key', 'key', { tabId: 7, key: 'Enter' });
  assert.ok(methods.includes('Page.bringToFront'));
  assert.ok(!methods.includes('tabs.update'));
});

test('background silent mode switches the tab without raising the window', async t => {
  const { api, command } = await fixture(t, {
    connections: [{ port: 18791, token: 'a'.repeat(64) }], enabled: true, foregroundMode: false,
  });
  await command('claim', 'claim', { tabId: 7 });
  const methods = [];
  api.debugger.sendCommand = async (target, method) => { methods.push(method); return {}; };
  const update = api.tabs.update;
  api.tabs.update = async (id, info) => { methods.push('tabs.update'); return update(id, info); };
  await command('key', 'key', { tabId: 7, key: 'Enter' });
  assert.ok(methods.includes('tabs.update'));
  assert.ok(!methods.includes('Page.bringToFront'));
});

test('commands without a tab run together instead of being rejected as busy', async t => {
  const { socketFor } = await fixture(t, {
    connections: [{ port: 18791, token: 'a'.repeat(64) }], enabled: true, foregroundMode: false,
  });
  const socket = socketFor(18791);
  let started = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  globalThis.chrome.tabs.query = async () => {
    started++;
    if (started === 2) release();
    await gate;
    return [{ id: 7, url: 'https://example.com/', title: 'Example' }];
  };
  const deadline = Date.now() + 5000;
  socket.onmessage({ data: JSON.stringify({ type: 'command', id: 'one', action: 'tabs', args: {}, deadline }) });
  socket.onmessage({ data: JSON.stringify({ type: 'command', id: 'two', action: 'tabs', args: {}, deadline }) });
  await until(() => started === 2);
  release();
  await until(() => socket.sent.filter(message => message.type === 'result').length === 2);
  const results = socket.sent.filter(message => message.type === 'result');
  assert.deepEqual(results.map(result => result.id).sort(), ['one', 'two']);
  assert.ok(results.every(result => result.result.tabs[0].tabId === 7));
});

async function twoHarnesses(t) {
  const fixtureState = await fixture(t, {
    connections: [{ port: 18791, token: 'a'.repeat(64) }, { port: 18793, token: 'b'.repeat(64) }],
    enabled: true,
    foregroundMode: false,
  });
  await until(() => fixtureState.socketFor(18791) && fixtureState.socketFor(18793));
  return fixtureState;
}
const resultOf = (socket, id) => socket.sent.find(item => item.type === 'result' && item.id === id);

test('a tab claimed by one Harness is rejected for another, and release hands it over', async t => {
  const { commandOn, socketFor } = await twoHarnesses(t);
  await commandOn(18791, 'a-claim', 'claim', { tabId: 7 });
  assert.equal(resultOf(socketFor(18791), 'a-claim').result.attached, true);
  await commandOn(18793, 'b-claim', 'claim', { tabId: 7 });
  assert.match(resultOf(socketFor(18793), 'b-claim').error, /TAB_OWNED_BY_ANOTHER_HARNESS/);
  await commandOn(18793, 'b-other', 'claim', { tabId: 8 });
  assert.equal(resultOf(socketFor(18793), 'b-other').result.attached, true);
  await commandOn(18791, 'a-release', 'release', { tabId: 7 });
  await commandOn(18793, 'b-reclaim', 'claim', { tabId: 7 });
  assert.equal(resultOf(socketFor(18793), 'b-reclaim').result.attached, true);
});

test('disconnect marks idle leases closing and blocks claims until native detach resolves', async t => {
  const { api, commandOn, socketFor, settled } = await twoHarnesses(t);
  await commandOn(18791, 'a-claim', 'claim', { tabId: 7 });
  let started = false;
  let finishDetach;
  api.debugger.detach = async () => { started = true; await new Promise(resolve => { finishDetach = resolve; }); };
  socketFor(18791).close();
  await until(() => started);
  await commandOn(18793, 'b-claim', 'claim', { tabId: 7 });
  assert.match(resultOf(socketFor(18793), 'b-claim').error, /TAB_LEASE_CLOSING/);
  finishDetach();
  await settled();
  await until(() => resultOf(socketFor(18793), 'b-claim'));
  await commandOn(18793, 'b-reclaim', 'claim', { tabId: 7 });
  assert.equal(resultOf(socketFor(18793), 'b-reclaim').result.attached, true);
});

test('open reserves the new tab before group and navigation, so a concurrent claim fails', async t => {
  const { api, commandOn, socketFor, setNextTabId } = await twoHarnesses(t);
  setNextTabId(9);
  let grouped = false;
  let finishGroup;
  const gate = new Promise(resolve => { finishGroup = resolve; });
  api.tabs.group = async () => { grouped = true; await gate; return 77; };
  const opening = commandOn(18791, 'a-open', 'open', { url: 'https://example.com/', group: 'series' });
  await until(() => grouped);
  await commandOn(18793, 'b-claim9', 'claim', { tabId: 9 });
  assert.match(resultOf(socketFor(18793), 'b-claim9').error, /TAB_OWNED_BY_ANOTHER_HARNESS/);
  finishGroup();
  await opening;
  assert.equal(resultOf(socketFor(18791), 'a-open').result.tabId, 9);
  await commandOn(18791, 'a-release9', 'release', { tabId: 9 });
  await commandOn(18793, 'b-reclaim9', 'claim', { tabId: 9 });
  const reclaim9 = resultOf(socketFor(18793), 'b-reclaim9');
  assert.equal(reclaim9.result?.attached, true, JSON.stringify(reclaim9));
});

test('an open lease collision fails closed without detaching the owner tab', async t => {
  const { api, commandOn, socketFor } = await twoHarnesses(t);
  await commandOn(18791, 'a-claim', 'claim', { tabId: 7 });
  let detached = false;
  api.debugger.detach = async () => { detached = true; };
  api.tabs.create = async () => ({ id: 7, url: 'about:blank', windowId: 1 });
  await commandOn(18791, 'a-open-conflict', 'open', { url: 'https://example.com/', group: 'series' });
  assert.match(resultOf(socketFor(18791), 'a-open-conflict').error, /LEASE_CONFLICT/);
  assert.equal(detached, false);
  await commandOn(18791, 'a-reclaim', 'claim', { tabId: 7 });
  assert.equal(resultOf(socketFor(18791), 'a-reclaim').result.attached, true);
});

test('two Connect calls for one port share one handshake', async t => {
  const { api, message, socketCount } = await fixture(t, {
    connections: [{ port: 18791, token: 'a'.repeat(64) }],
    enabled: false,
  });
  const get = api.storage.local.get;
  let releaseRead;
  let gated = false;
  api.storage.local.get = async keys => {
    if (!gated) {
      gated = true;
      await new Promise(resolve => { releaseRead = resolve; });
    }
    return get(keys);
  };
  const first = message('connect', { port: 18793, code: '12345678' });
  const second = message('connect', { port: 18793, code: '12345678' });
  await until(() => gated);
  releaseRead();
  await Promise.all([first, second]);
  assert.equal(socketCount(18793), 1);
});

test('the same command id and cancel id on two connections stay isolated', async t => {
  const { api, commandOn, socketFor, settled } = await twoHarnesses(t);
  await commandOn(18791, 'a-claim', 'claim', { tabId: 7 });
  await commandOn(18793, 'b-claim', 'claim', { tabId: 8 });
  let started = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  api.tabs.update = async (id, info) => {
    started++;
    await gate;
    return { id, ...info };
  };
  const first = commandOn(18791, 'same', 'key', { tabId: 7, key: 'Enter' });
  await until(() => started === 1);
  const second = commandOn(18793, 'same', 'key', { tabId: 8, key: 'Enter' });
  await settled();
  await socketFor(18793).onmessage({ data: JSON.stringify({ type: 'cancel', id: 'same' }) });
  await second;
  assert.match(resultOf(socketFor(18793), 'same').error, /COMMAND_CANCELED/);
  release();
  await first;
  const aResult = resultOf(socketFor(18791), 'same');
  assert.equal(aResult.result?.pressed, 'Enter', JSON.stringify(aResult));
});

test('a stale socket cannot delete or command a newer connection on the same port', async t => {
  const { message, socketFor, socketCount } = await fixture(t, {
    connections: [{ port: 18791, token: 'a'.repeat(64) }],
    enabled: false,
  });
  await message('connect', { port: 18791 });
  const old = socketFor(18791);
  await message('disconnect');
  await message('connect', { port: 18791 });
  assert.equal(socketCount(18791), 2);
  old.onclose?.();
  old.onmessage?.({ data: JSON.stringify({ type: 'command', id: 'stale', action: 'tabs', args: {}, deadline: Date.now() + 5000 }) });
  assert.equal((await message('status')).connected, true);
  assert.equal(socketFor(18791).sent.some(item => item.id === 'stale'), false);
});

test('a late ready after disconnect does not persist a new connection', async t => {
  const { message, stored, holdReady, releaseReady, socketFor } = await fixture(t, {
    connections: [{ port: 18791, token: 'a'.repeat(64) }],
    enabled: false,
  });
  holdReady(18793);
  const connecting = message('connect', { port: 18793, code: '12345678' });
  await until(() => socketFor(18793)?.sent.some(item => item.type === 'pair'));
  await message('disconnect');
  releaseReady(18793);
  const result = await connecting;
  assert.equal(result.ok, false);
  assert.equal(stored.enabled, false);
  assert.deepEqual(stored.connections, [{ port: 18791, token: 'a'.repeat(64) }]);
});

test('the eleventh pairing is rejected before creating a socket', async t => {
  const ports = [18791, 18793, 18794, 18795, 18796, 18797, 18798, 18799, 18800, 18801];
  const { message, socketCount } = await fixture(t, {
    connections: ports.map((port, index) => ({ port, token: '0123456789abcdef'[index].repeat(64) })),
    enabled: false,
  });
  const result = await message('connect', { port: 18802, code: '12345678' });
  assert.equal(result.ok, false);
  assert.match(result.error, /TOO_MANY_CONNECTIONS/);
  assert.equal(socketCount(18802), 0);
});

test('failed native cleanup quarantines the tab instead of releasing it', async t => {
  const { api, commandOn, message, socketFor, settled } = await twoHarnesses(t);
  await commandOn(18791, 'a-claim', 'claim', { tabId: 7 });
  api.debugger.detach = async () => { throw new Error('DETACH_FAILED'); };
  socketFor(18791).close();
  await settled();
  await settled();
  await commandOn(18793, 'b-claim', 'claim', { tabId: 7 });
  assert.match(resultOf(socketFor(18793), 'b-claim').error, /TAB_LEASE_QUARANTINED/);
  const status = await message('status');
  assert.match(status.connections.find(row => row.port === 18791).error, /DETACH_FAILED/);
});

test('a detach notice reaches only the lease owner; unknown detach is silent', async t => {
  const { commandOn, socketFor, listeners, settled } = await twoHarnesses(t);
  await commandOn(18791, 'a-claim', 'claim', { tabId: 7 });
  listeners.detach({ tabId: 7 }, 'replaced_with_devtools');
  await settled();
  assert.ok(socketFor(18791).sent.some(item => item.type === 'detached' && item.tabId === 7));
  assert.equal(socketFor(18793).sent.some(item => item.type === 'detached' && item.tabId === 7), false);
  listeners.detach({ tabId: 99 }, 'target_closed');
  await settled();
  assert.equal(socketFor(18791).sent.some(item => item.type === 'detached' && item.tabId === 99), false);
  assert.equal(socketFor(18793).sent.some(item => item.type === 'detached' && item.tabId === 99), false);
  await commandOn(18793, 'b-after-detach', 'claim', { tabId: 7 });
  assert.equal(resultOf(socketFor(18793), 'b-after-detach').result.attached, true);
});

test('two simultaneous pairings are serialized and neither token is lost', async t => {
  const { message, stored, socketCount } = await fixture(t, {
    connections: [{ port: 18791, token: 'a'.repeat(64) }],
    enabled: false,
  });
  const [first, second] = await Promise.all([
    message('connect', { port: 18793, code: '12345678' }),
    message('connect', { port: 18794, code: '12345678' }),
  ]);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(socketCount(18793), 1);
  assert.equal(socketCount(18794), 1);
  assert.deepEqual(stored.connections.map(item => item.port), [18791, 18793, 18794]);
});

test('disconnect also cleans a tab that was opened but never released', async t => {
  const { api, commandOn, socketFor, settled } = await twoHarnesses(t);
  const detached = [];
  api.debugger.detach = async target => { detached.push(target.tabId); };
  await commandOn(18791, 'a-open', 'open', { url: 'https://example.com/', group: 'series' });
  assert.equal(resultOf(socketFor(18791), 'a-open').result.tabId, 9);
  socketFor(18791).close();
  await settled();
  await settled();
  assert.deepEqual(detached, [9]);
  await commandOn(18793, 'b-claim9', 'claim', { tabId: 9 });
  assert.equal(resultOf(socketFor(18793), 'b-claim9').result.attached, true);
});

test('a canceled close stays quarantined instead of handing the tab to another Harness', async t => {
  const { api, commandOn, socketFor, settled } = await twoHarnesses(t);
  await commandOn(18791, 'a-claim', 'claim', { tabId: 7 });
  let removing = false;
  api.tabs.remove = async () => { removing = true; return new Promise(() => {}); };
  const closing = commandOn(18791, 'a-close', 'close', { tabId: 7 });
  await until(() => removing);
  await socketFor(18791).onmessage({ data: JSON.stringify({ type: 'cancel', id: 'a-close' }) });
  await closing;
  await settled();
  assert.match(resultOf(socketFor(18791), 'a-close').error, /COMMAND_CANCELED/);
  await commandOn(18793, 'b-claim', 'claim', { tabId: 7 });
  assert.match(resultOf(socketFor(18793), 'b-claim').error, /TAB_LEASE_QUARANTINED/);
});

test('a failed saved connection keeps its error in the per-port status', async t => {
  const { message, readyTokens, socketFor } = await fixture(t, {
    connections: [{ port: 18791, token: 'a'.repeat(64) }, { port: 18793, token: 'b'.repeat(64) }],
    enabled: false,
  });
  await message('connect', { port: 18791 });
  readyTokens.set(18793, 'not-a-token');
  const failed = await message('connect', { port: 18793 });
  assert.equal(failed.ok, false);
  const status = await message('status');
  const row = status.connections.find(item => item.port === 18793);
  assert.match(row.error, /Unsupported bridge protocol/);
  assert.equal(status.connected, true);
  assert.ok(socketFor(18791));
});

test('disconnect all does not clear a quarantined tab before native cleanup is proven', async t => {
  const { api, message, commandOn, socketFor, settled } = await twoHarnesses(t);
  await commandOn(18791, 'a-claim', 'claim', { tabId: 7 });
  api.debugger.detach = async () => { throw new Error('DETACH_FAILED'); };
  socketFor(18791).close();
  await settled();
  await settled();
  await message('disconnect');
  await message('connect', { port: 18793 });
  await commandOn(18793, 'b-claim', 'claim', { tabId: 7 });
  assert.match(resultOf(socketFor(18793), 'b-claim').error, /TAB_LEASE_QUARANTINED/);
});

test('forget removes the port without reviving the legacy token or auto-reconnect', async t => {
  const { message, stored, sockets, alarms, settled } = await fixture(t, { token: 'a'.repeat(64), enabled: true, foregroundMode: false });
  assert.equal(sockets.length, 1);
  await message('forget', { port: 18791 });
  await settled();
  assert.deepEqual(stored.connections, []);
  assert.equal(stored.token, undefined);
  assert.equal(stored.enabled, false);
  assert.equal(alarms.has('reconnect'), false);
  assert.equal(sockets[0].readyState, 3);
});

test('disconnect keeps a completed first-time pairing so it can reconnect without a code', async t => {
  const { message, stored, readyTokens } = await fixture(t, {
    connections: [{ port: 18791, token: 'a'.repeat(64) }],
    enabled: false,
  });
  readyTokens.set(18793, 'b'.repeat(64));
  const paired = await message('connect', { port: 18793, code: '12345678' });
  assert.equal(paired.ok, true);
  await message('disconnect');
  assert.deepEqual(stored.connections.map(item => item.port), [18791, 18793]);
  assert.equal(stored.enabled, false);
  const reconnect = await message('connect', { port: 18793 });
  assert.equal(reconnect.ok, true);
});

test('a restore gated in storage cannot reconnect after disconnect all', async t => {
  const { api, listeners, message, stored, socketCount, settled } = await fixture(t, {
    connections: [{ port: 18791, token: 'a'.repeat(64) }],
    enabled: false,
  });
  stored.enabled = true;
  const get = api.storage.local.get;
  let releaseRead;
  let gated = false;
  api.storage.local.get = async keys => {
    if (!gated) {
      gated = true;
      await new Promise(resolve => { releaseRead = resolve; });
    }
    return get(keys);
  };
  listeners.alarm({ name: 'reconnect' });
  await until(() => gated);
  await message('disconnect');
  releaseRead();
  await settled();
  await settled();
  assert.equal(socketCount(18791), 0);
  assert.equal(stored.enabled, false);
});

test('forget removes the entry before cleanup, so an alarm cannot revive the port', async t => {
  const { api, commandOn, message, listeners, stored, socketCount, settled } = await twoHarnesses(t);
  await commandOn(18791, 'a-claim', 'claim', { tabId: 7 });
  let started = false;
  let finishDetach;
  api.debugger.detach = async () => { started = true; await new Promise(resolve => { finishDetach = resolve; }); };
  const forgetting = message('forget', { port: 18791 });
  await until(() => started);
  assert.deepEqual(stored.connections.map(item => item.port), [18793]);
  listeners.alarm({ name: 'reconnect' });
  await settled();
  await settled();
  assert.equal(socketCount(18791), 1);
  finishDetach();
  await forgetting;
  await settled();
  assert.equal(socketCount(18791), 1);
});

test('a new connection can claim a tab while disconnect all is still draining an old one', async t => {
  const { api, commandOn, message, socketFor, settled } = await twoHarnesses(t);
  await commandOn(18791, 'a-claim', 'claim', { tabId: 7 });
  let started = false;
  let finishDetach;
  api.debugger.detach = async () => { started = true; await new Promise(resolve => { finishDetach = resolve; }); };
  const disconnecting = message('disconnect');
  await until(() => started);
  await message('connect', { port: 18793 });
  await commandOn(18793, 'new-claim', 'claim', { tabId: 9 });
  finishDetach();
  await disconnecting;
  await settled();
  assert.equal(resultOf(socketFor(18793), 'new-claim').result.attached, true);
  assert.equal((await message('status')).connected, true);
});

test('a quarantined lease blocks release as well as claim', async t => {
  const { api, commandOn, socketFor } = await twoHarnesses(t);
  await commandOn(18791, 'a-claim', 'claim', { tabId: 7 });
  let removing = false;
  api.tabs.remove = async () => { removing = true; return new Promise(() => {}); };
  const closing = commandOn(18791, 'a-close', 'close', { tabId: 7 });
  await until(() => removing);
  await socketFor(18791).onmessage({ data: JSON.stringify({ type: 'cancel', id: 'a-close' }) });
  await closing;
  await commandOn(18791, 'a-release', 'release', { tabId: 7 });
  assert.match(resultOf(socketFor(18791), 'a-release').error, /TAB_LEASE_QUARANTINED/);
  await commandOn(18791, 'a-snapshot', 'snapshot', { tabId: 7, format: 'text' });
  assert.match(resultOf(socketFor(18791), 'a-snapshot').error, /TAB_LEASE_QUARANTINED/);
});

test('a restore gated at alarm creation cannot revive a port forgotten meanwhile', async t => {
  const { api, message, listeners, socketCount, settled } = await twoHarnesses(t);
  let releaseAlarm;
  let gated = false;
  api.alarms.create = async () => {
    if (!gated) {
      gated = true;
      await new Promise(resolve => { releaseAlarm = resolve; });
    }
  };
  listeners.alarm({ name: 'reconnect' });
  await until(() => gated);
  await message('forget', { port: 18791 });
  releaseAlarm();
  await settled();
  await settled();
  assert.equal(socketCount(18791), 1);
  assert.equal((await message('status')).connected, true);
});

test('numeric-string tab ids are validated before lease checks across peers', async t => {
  const { commandOn, socketFor } = await twoHarnesses(t);
  await commandOn(18791, 'a-claim', 'claim', { tabId: 7 });
  await commandOn(18793, 'b-string-read', 'snapshot', { tabId: '7', format: 'text' });
  assert.match(resultOf(socketFor(18793), 'b-string-read').error, /TAB_OWNED_BY_ANOTHER_HARNESS/);
  await commandOn(18793, 'b-string-claim', 'claim', { tabId: '8' });
  assert.equal(resultOf(socketFor(18793), 'b-string-claim').result.attached, true);
  await commandOn(18791, 'a-claim-8', 'claim', { tabId: 8 });
  assert.match(resultOf(socketFor(18791), 'a-claim-8').error, /TAB_OWNED_BY_ANOTHER_HARNESS/);
});

test('an invalid claim argument does not reserve a lease', async t => {
  const { commandOn, socketFor } = await twoHarnesses(t);
  await commandOn(18793, 'bad-claim', 'claim', { tabId: 'not-a-tab' });
  assert.match(resultOf(socketFor(18793), 'bad-claim').error, /INVALID_ARGUMENT/);
  await commandOn(18791, 'a-claim', 'claim', { tabId: 7 });
  assert.equal(resultOf(socketFor(18791), 'a-claim').result.attached, true);
});

test('a canceled command cannot make an old drain detach a tab reclaimed by another peer', async t => {
  const { api, commandOn, socketFor, settled } = await twoHarnesses(t);
  await commandOn(18791, 'a-claim-7', 'claim', { tabId: 7 });
  await commandOn(18791, 'a-claim-8', 'claim', { tabId: 8 });
  const detaches = [];
  let release7;
  let release8;
  api.debugger.detach = async ({ tabId }) => {
    detaches.push(tabId);
    await new Promise(resolve => { if (tabId === 7) release7 = resolve; else release8 = resolve; });
  };
  const releasing = commandOn(18791, 'a-release-7', 'release', { tabId: 7 });
  await until(() => detaches.includes(7));
  socketFor(18791).close();
  release7();
  await until(() => detaches.includes(8));
  await commandOn(18793, 'b-reclaim-7', 'claim', { tabId: 7 });
  release8();
  await releasing;
  await settled();
  assert.equal(resultOf(socketFor(18793), 'b-reclaim-7').result.attached, true);
  assert.equal(detaches.filter(tabId => tabId === 7).length, 1);
  assert.equal(socketFor(18793).sent.some(item => item.type === 'detached' && item.tabId === 7), false);
});

test('an open task that is still running when its connection drains detaches its new tab', async t => {
  const { api, commandOn, socketFor, settled, tabUrls } = await twoHarnesses(t);
  let grouped = false;
  let finishGroup;
  api.tabs.group = async () => { grouped = true; await new Promise(resolve => { finishGroup = resolve; }); return 77; };
  const opening = commandOn(18791, 'a-open', 'open', { url: 'https://example.com/', group: 'series' });
  await until(() => grouped);
  socketFor(18791).close();
  finishGroup();
  await opening;
  await settled();
  tabUrls.set(9, 'https://example.com/');
  await commandOn(18793, 'b-claim-9', 'claim', { tabId: 9 });
  assert.equal(resultOf(socketFor(18793), 'b-claim-9').result.attached, true);
});

test('forget does not erase a newer explicit pairing for the same port', async t => {
  const { api, commandOn, message, socketFor, stored, settled } = await twoHarnesses(t);
  await commandOn(18791, 'a-claim', 'claim', { tabId: 7 });
  let started = false;
  let finishDetach;
  api.debugger.detach = async () => { started = true; await new Promise(resolve => { finishDetach = resolve; }); };
  const forgetting = message('forget', { port: 18791 });
  await until(() => started);
  const paired = await message('connect', { port: 18791, code: '12345678' });
  assert.equal(paired.ok, true);
  finishDetach();
  await forgetting;
  await settled();
  assert.ok(stored.connections.some(item => item.port === 18791));
  assert.equal((await message('status')).connected, true);
  assert.equal(socketFor(18791).sent[0].type, 'pair');
});


test('an encoded pairing code selects its port and is sent unchanged', async t => {
  const { message, socketFor, socketCount } = await fixture(t, {
    connections: [{ port: 18791, token: 'a'.repeat(64) }],
    enabled: false,
  });
  const code = encodePairingCode(18793, 7);
  const result = await message('connect', { port: 18793, code });
  assert.equal(result.ok, true);
  assert.equal(socketFor(18793).url, 'ws://127.0.0.1:18793/bridge');
  assert.equal(socketFor(18793).sent[0].type, 'pair');
  assert.equal(socketFor(18793).sent[0].code, code);
  assert.equal(socketCount(18793), 1);
});

test('an encoded code rejects a different manual port before opening a socket', async t => {
  const { message, socketCount } = await fixture(t, {
    connections: [{ port: 18791, token: 'a'.repeat(64) }],
    enabled: false,
  });
  const code = encodePairingCode(18793, 8);
  const result = await message('connect', { port: 18791, code });
  assert.equal(result.ok, false);
  assert.match(result.error, /PAIRING_CODE_PORT_MISMATCH/);
  assert.equal(socketCount(18793), 0);
  assert.equal(socketCount(18791), 0);
});

test('a legacy numeric code defaults to 18791 unless an advanced port is supplied', async t => {
  const { message, socketFor, socketCount } = await fixture(t, {
    connections: [{ port: 18791, token: 'a'.repeat(64) }, { port: 18793, token: 'b'.repeat(64) }],
    enabled: false,
  });
  const result = await message('connect', { code: '12345678' });
  assert.equal(result.ok, true);
  assert.equal(socketFor(18791).url, 'ws://127.0.0.1:18791/bridge');
  assert.equal(socketCount(18791), 1);
  const advanced = await message('connect', { port: 18793, code: '22345678' });
  assert.equal(advanced.ok, true);
  assert.equal(socketFor(18793).sent[0].code, '22345678');
});

// --- Cross-Harness messaging ---

async function threeHarnesses(t) {
  const state = await fixture(t, {
    connections: [
      { port: 18791, token: 'a'.repeat(64) },
      { port: 18793, token: 'b'.repeat(64) },
      { port: 18795, token: 'c'.repeat(64) },
    ],
    enabled: true,
    foregroundMode: false,
  });
  await until(() => state.socketFor(18791) && state.socketFor(18793) && state.socketFor(18795));
  return state;
}
const inboxes = socket => socket.sent.filter(item => item.type === 'inbox');

test('a broadcast reaches other Harnesses as an unread hint and reading consumes it', async t => {
  const { commandOn, socketFor, stored } = await twoHarnesses(t);
  await commandOn(18791, 'a-send', 'send_message', { text: 'hello from A' });
  const sent = resultOf(socketFor(18791), 'a-send').result;
  assert.equal(sent.from, '18791');
  assert.equal(sent.to, 'all');
  assert.deepEqual(sent.delivered, ['18793']);
  assert.equal(stored.agentMessages.length, 1);

  const inbox = inboxes(socketFor(18793))[0];
  assert.equal(inbox.unread, 1);
  assert.deepEqual(inbox.senders, ['18791']);
  assert.equal(inboxes(socketFor(18791)).length, 0, 'a broadcast is not unread for its sender');

  await commandOn(18793, 'b-read', 'messages', {});
  const read = resultOf(socketFor(18793), 'b-read').result;
  assert.deepEqual(read.messages.map(message => message.text), ['hello from A']);
  assert.equal(read.cursor, sent.id);
  assert.equal(read.unread, 0);
  assert.equal(stored.agentCursors['18793'], sent.id);

  await commandOn(18793, 'b-read-again', 'messages', {});
  const again = resultOf(socketFor(18793), 'b-read-again').result;
  assert.deepEqual(again.messages, []);
  assert.equal(again.cursor, sent.id);
});

test('direct messages reach only the target port and broadcasts never echo to the sender', async t => {
  const { commandOn, socketFor } = await threeHarnesses(t);
  await commandOn(18791, 'a-broadcast', 'send_message', { text: 'hello-all' });
  await commandOn(18793, 'b-direct', 'send_message', { to: '18795', text: 'only-c' });
  assert.deepEqual(resultOf(socketFor(18793), 'b-direct').result.delivered, ['18795']);

  const lastInbox = socket => inboxes(socket).at(-1);
  assert.deepEqual({ unread: lastInbox(socketFor(18795)).unread, senders: lastInbox(socketFor(18795)).senders }, { unread: 2, senders: ['18791', '18793'] });
  assert.equal(inboxes(socketFor(18791)).length, 0, 'A gets no hint for its own broadcast or for a message to C');
  assert.equal(inboxes(socketFor(18793)).length, 1, 'B does not get an extra hint for its own direct message');
  assert.deepEqual(inboxes(socketFor(18793))[0].senders, ['18791'], 'B only has the earlier broadcast pending');

  await commandOn(18791, 'a-read', 'messages', {});
  assert.deepEqual(resultOf(socketFor(18791), 'a-read').result.messages, [], 'A cannot read its own broadcast');
  await commandOn(18793, 'b-read', 'messages', {});
  assert.deepEqual(resultOf(socketFor(18793), 'b-read').result.messages.map(message => message.text), ['hello-all']);
  await commandOn(18795, 'c-read', 'messages', {});
  assert.deepEqual(resultOf(socketFor(18795), 'c-read').result.messages.map(message => message.text), ['hello-all', 'only-c']);
});

test('after replays from an explicit id and limit caps each read', async t => {
  const { commandOn, socketFor } = await twoHarnesses(t);
  const ids = [];
  for (const text of ['first', 'second', 'third']) {
    await commandOn(18791, `send-${text}`, 'send_message', { text });
    ids.push(resultOf(socketFor(18791), `send-${text}`).result.id);
  }
  await commandOn(18793, 'replay', 'messages', { after: ids[0], limit: 1 });
  const replay = resultOf(socketFor(18793), 'replay').result;
  assert.deepEqual(replay.messages.map(message => message.text), ['second']);
  assert.equal(replay.cursor, ids[1]);

  await commandOn(18793, 'next', 'messages', {});
  assert.deepEqual(resultOf(socketFor(18793), 'next').result.messages.map(message => message.text), ['third']);
  await commandOn(18793, 'done', 'messages', {});
  assert.deepEqual(resultOf(socketFor(18793), 'done').result.messages, []);
});

test('expired messages are pruned on read and dropped from storage', async t => {
  const now = Date.now();
  const { commandOn, socketFor, stored } = await fixture(t, {
    connections: [{ port: 18791, token: 'a'.repeat(64) }],
    enabled: true,
    foregroundMode: false,
    agentMessages: [
      { id: 1, at: now - 11 * 60000, from: '18793', to: 'all', text: 'expired' },
      { id: 2, at: now, from: '18793', to: 'all', text: 'fresh' },
    ],
    agentSeq: 2,
  });
  await until(() => socketFor(18791));
  await commandOn(18791, 'read', 'messages', {});
  assert.deepEqual(resultOf(socketFor(18791), 'read').result.messages.map(message => message.text), ['fresh']);
  assert.deepEqual(stored.agentMessages.map(message => message.text), ['fresh']);
});

test('storage keeps only the newest 100 messages', async t => {
  const now = Date.now();
  const history = Array.from({ length: 99 }, (_, index) => ({ id: index + 1, at: now, from: '18795', to: 'all', text: `m${index + 1}` }));
  const { commandOn, socketFor, stored } = await fixture(t, {
    connections: [{ port: 18791, token: 'a'.repeat(64) }, { port: 18793, token: 'b'.repeat(64) }],
    enabled: true,
    foregroundMode: false,
    agentMessages: history,
    agentSeq: 99,
  });
  await until(() => socketFor(18791) && socketFor(18793));
  for (let index = 0; index < 6; index += 1) await commandOn(18791, `send-${index}`, 'send_message', { text: `new-${index}` });
  assert.equal(stored.agentMessages.length, 100);
  assert.equal(stored.agentMessages[0].id, 6);
  assert.equal(stored.agentMessages.at(-1).id, 105);
  assert.equal(stored.agentSeq, 105);
});

test('the twenty-first message in a minute is rate limited', async t => {
  const { commandOn, socketFor } = await twoHarnesses(t);
  for (let index = 0; index < 20; index += 1) {
    await commandOn(18791, `send-${index}`, 'send_message', { text: `m${index}` });
    assert.ok(resultOf(socketFor(18791), `send-${index}`).result, `message ${index + 1} should be accepted`);
  }
  await commandOn(18791, 'send-21', 'send_message', { text: 'too many' });
  assert.match(resultOf(socketFor(18791), 'send-21').error, /^MESSAGE_RATE_LIMITED: at most 20 messages per minute per Harness$/);
});

test('a fresh pairing starts at the current message head instead of replaying history', async t => {
  const now = Date.now();
  const { stored, message, commandOn, socketFor } = await fixture(t, {
    connections: [{ port: 18791, token: 'a'.repeat(64) }],
    enabled: true,
    foregroundMode: false,
    agentMessages: [
      { id: 1, at: now, from: '18793', to: 'all', text: 'old one' },
      { id: 2, at: now, from: '18793', to: 'all', text: 'old two' },
    ],
    agentSeq: 2,
  });
  await until(() => socketFor(18791));
  await message('connect', { port: 18793, code: '12345678' });
  assert.equal(stored.agentCursors['18793'], 2);
  await commandOn(18793, 'new-read', 'messages', {});
  assert.deepEqual(resultOf(socketFor(18793), 'new-read').result.messages, []);
  assert.equal(resultOf(socketFor(18793), 'new-read').result.cursor, 2);
});

test('a reconnect keeps its saved cursor so messages sent while offline are read', async t => {
  const now = Date.now();
  const { commandOn, socketFor } = await fixture(t, {
    connections: [{ port: 18791, token: 'a'.repeat(64) }],
    enabled: true,
    foregroundMode: false,
    agentMessages: [{ id: 6, at: now, from: '18793', to: 'all', text: 'while away' }],
    agentSeq: 6,
    agentCursors: { 18791: 5, 18793: 5 },
  });
  await until(() => socketFor(18791));
  await commandOn(18791, 'offline-read', 'messages', {});
  const result = resultOf(socketFor(18791), 'offline-read').result;
  assert.deepEqual(result.messages.map(message => message.text), ['while away']);
  assert.equal(result.cursor, 6);
  assert.equal(result.unread, 0);
});

test('invalid targets and blank text are rejected without storing anything', async t => {
  const { commandOn, socketFor, stored } = await twoHarnesses(t);
  for (const [index, to] of ['abc', '80', '1023', '65536'].entries()) {
    await commandOn(18791, `bad-${index}`, 'send_message', { to, text: 'hi' });
    assert.match(resultOf(socketFor(18791), `bad-${index}`).error, /^MESSAGE_TARGET: to must be a port between 1024 and 65535$/);
  }
  await commandOn(18791, 'blank', 'send_message', { text: '   ' });
  assert.match(resultOf(socketFor(18791), 'blank').error, /^MESSAGE_TEXT: text must not be blank$/);
  assert.equal(stored.agentMessages, undefined);
});

test('message text drops control characters but keeps newlines', async t => {
  const { commandOn, socketFor, stored } = await twoHarnesses(t);
  await commandOn(18791, 'controls', 'send_message', { text: 'line1\u001b[31mred\u0000x\nline2\tend' });
  assert.equal(resultOf(socketFor(18791), 'controls').result.text, 'line1[31mredx\nline2\tend');
  assert.equal(stored.agentMessages.at(-1).text, 'line1[31mredx\nline2\tend');
});

test('an inbox over the unread cap returns only the newest fifty messages', async t => {
  const now = Date.now();
  const messages = Array.from({ length: 60 }, (_, index) => ({ id: index + 1, at: now, from: '18793', to: 'all', text: `m${index + 1}` }));
  const { commandOn, socketFor, stored } = await fixture(t, {
    connections: [{ port: 18791, token: 'a'.repeat(64) }],
    enabled: true,
    foregroundMode: false,
    agentMessages: messages,
    agentSeq: 60,
  });
  await until(() => socketFor(18791));
  await commandOn(18791, 'read', 'messages', {});
  const result = resultOf(socketFor(18791), 'read').result;
  assert.equal(result.messages.length, 50);
  assert.equal(result.messages[0].id, 11);
  assert.equal(result.messages.at(-1).id, 60);
  assert.equal(result.cursor, 60);
  assert.equal(result.unread, 0);
  assert.equal(stored.agentCursors['18791'], 60);
});

test('an unread hint above the cap reports the cap instead of a count the bridge rejects', async t => {
  const now = Date.now();
  const messages = Array.from({ length: 60 }, (_, index) => ({ id: index + 1, at: now, from: '18795', to: 'all', text: `m${index + 1}` }));
  const { commandOn, socketFor } = await fixture(t, {
    connections: [{ port: 18791, token: 'a'.repeat(64) }, { port: 18793, token: 'b'.repeat(64) }],
    enabled: true,
    foregroundMode: false,
    agentMessages: messages,
    agentSeq: 60,
  });
  await until(() => socketFor(18791) && socketFor(18793));
  await commandOn(18793, 'ping', 'send_message', { text: 'ping' });
  const inbox = inboxes(socketFor(18791)).at(-1);
  assert.equal(inbox.unread, 50);
  assert.deepEqual(inbox.senders, ['18795', '18793']);
});
