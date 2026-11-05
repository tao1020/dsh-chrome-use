import test from 'node:test';
import assert from 'node:assert/strict';
import { PARALLEL_TABS } from '../extension/protocol.js';

async function until(predicate, timeout = 2000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error('condition not reached in time');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

async function fixture(t, initial) {
  const stored = { ...initial };
  const listeners = {};
  const sockets = [];
  const alarms = new Set();
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
  globalThis.chrome = {
    runtime,
    storage: { local: {
      get: async () => ({ ...stored }),
      set: async value => { Object.assign(stored, value); },
      remove: async key => { delete stored[key]; },
    } },
    action: { setBadgeText() {}, setBadgeBackgroundColor() {} },
    alarms: { onAlarm: event('alarm'), create: async name => alarms.add(name), clear: async name => alarms.delete(name) },
    tabs: { onRemoved: event('removed'), query: async () => [], get: async id => ({ id, url: 'https://example.com/' }) },
    debugger: { onDetach: event('detach'), onEvent: event('debugEvent'), attach: async () => {}, detach: async () => {}, sendCommand: async () => ({}) },
  };
  globalThis.WebSocket = class {
    static OPEN = 1;
    readyState = 1;
    sent = [];
    constructor() {
      sockets.push(this);
      queueMicrotask(() => this.onopen?.());
    }
    send(body) {
      const message = JSON.parse(body);
      this.sent.push(message);
      if (message.type === 'auth' || message.type === 'pair') {
        queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ type: 'ready', protocol: 1, token: 'a'.repeat(64) }) }));
      }
    }
    close() { this.readyState = 3; this.onclose?.(); }
  };
  // Separate module instances model a newly started extension worker. No browser or network is used.
  await import(`../extension/background.js?test=${crypto.randomUUID()}`);
  const message = action => new Promise(resolve => listeners.message({ action }, { id: runtime.id, url: runtime.getURL('popup.html') }, resolve));
  const settled = () => new Promise(resolve => setImmediate(resolve));
  t.after(async () => {
    await message('disconnect');
    globalThis.chrome = originalChrome;
    globalThis.WebSocket = originalSocket;
  });
  await settled();
  const command = (id, action, args = {}) => sockets.at(-1).onmessage({ data: JSON.stringify({ type: 'command', id, action, args, deadline: Date.now() + 5000 }) });
  return { stored, sockets, alarms, listeners, message, settled, command, api: globalThis.chrome };
}

test('worker startup restores saved pairing; disconnect disables automatic reconnect', async t => {
  const { sockets, alarms, stored, message, listeners, settled } = await fixture(t, { token: 'a'.repeat(64), enabled: true });
  assert.equal(sockets.length, 1);
  assert.equal(sockets[0].sent[0].type, 'auth');
  assert.equal(sockets[0].sent[0].code, undefined);
  assert.deepEqual(sockets[0].sent[0].features, [PARALLEL_TABS]);
  assert.equal((await message('status')).connected, true);
  assert.equal(alarms.has('reconnect'), true);
  await message('disconnect');
  assert.equal(stored.enabled, false);
  assert.equal(stored.token.length, 64);
  listeners.alarm({ name: 'reconnect' });
  await settled();
  assert.equal(sockets.length, 1);
  assert.equal(alarms.has('reconnect'), false);
});

test('a disconnected saved pair waits for Connect, then authenticates without a code', async t => {
  const { sockets, message, listeners, settled } = await fixture(t, { token: 'a'.repeat(64), enabled: false });
  assert.equal(sockets.length, 0);
  assert.equal((await message('status')).paired, true);
  assert.equal((await message('connect')).connected, true);
  assert.equal(sockets[0].sent[0].type, 'auth');
  // A restarted Harness drops the old socket. The scheduled retry must reuse the token.
  sockets[0].close();
  listeners.alarm({ name: 'reconnect' });
  await settled();
  assert.equal(sockets.length, 2);
  assert.equal(sockets[1].sent[0].type, 'auth');
  assert.equal((await message('status')).connected, true);
});

test('Disconnect cancels a Connect that has not created its socket yet', async t => {
  const { api, message, sockets } = await fixture(t, { token: 'a'.repeat(64), enabled: false });
  const get = api.storage.local.get;
  let finishRead;
  api.storage.local.get = key => key === 'token' ? new Promise(resolve => { finishRead = () => resolve({ token: 'a'.repeat(64) }); }) : get(key);
  const connecting = message('connect');
  await message('disconnect');
  finishRead();
  const result = await connecting;
  assert.equal(result.ok, false);
  assert.equal(sockets.length, 0);
});

test('focus-changing commands are FIFO across tabs while reads remain parallel', async t => {
  const { api, command, settled } = await fixture(t, { token: 'a'.repeat(64), enabled: true });
  for (const tabId of [7, 8, 9, 10]) await command(`claim-${tabId}`, 'claim', { tabId });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const focused = [];
  api.debugger.sendCommand = async ({ tabId }, method) => {
    if (method === 'Page.bringToFront') { focused.push(tabId); if (tabId === 7) await gate; }
    return {};
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

test('cancellation holds tab and focus until detach completes and acknowledges cleanup', async t => {
  const { api, command, sockets, settled } = await fixture(t, { token: 'a'.repeat(64), enabled: true });
  for (const tabId of [7, 8]) await command(`claim-${tabId}`, 'claim', { tabId });
  const socket = sockets[0];
  const focused = [];
  api.debugger.sendCommand = async ({ tabId }, method) => {
    if (method === 'Page.bringToFront') { focused.push(tabId); if (tabId === 7) return new Promise(() => {}); }
    return {};
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
  const { api, command, sockets } = await fixture(t, { token: 'a'.repeat(64), enabled: true });
  await command('claim', 'claim', { tabId: 7 });
  let started = false;
  let finishDetach;
  api.debugger.sendCommand = async (_, method) => {
    if (method === 'Page.bringToFront') { started = true; return new Promise(() => {}); }
    return {};
  };
  api.debugger.detach = () => new Promise(resolve => { finishDetach = resolve; });
  const socket = sockets[0];
  const work = command('canceled', 'key', { tabId: 7, key: 'Enter' });
  await until(() => started);
  await socket.onmessage({ data: JSON.stringify({ type: 'cancel', id: 'canceled' }) });
  try {
    await work;
    assert.equal(socket.readyState, 3);
    assert.equal(socket.sent.some(item => item.type === 'result' && item.id === 'canceled'), false);
  } finally { finishDetach(); }
});

test('canceling a queued focus command removes it without blocking the next tab', async t => {
  const { api, command, sockets } = await fixture(t, { token: 'a'.repeat(64), enabled: true });
  for (const tabId of [7, 8, 9]) await command(`claim-${tabId}`, 'claim', { tabId });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const focused = [];
  api.debugger.sendCommand = async ({ tabId }, method) => {
    if (method === 'Page.bringToFront') { focused.push(tabId); if (tabId === 7) await gate; }
    return {};
  };
  const first = command('first', 'key', { tabId: 7, key: 'Enter' });
  await until(() => focused.length === 1);
  const canceled = command('canceled', 'key', { tabId: 8, key: 'Enter' });
  const third = command('third', 'key', { tabId: 9, key: 'Enter' });
  try {
    await sockets[0].onmessage({ data: JSON.stringify({ type: 'cancel', id: 'canceled' }) });
    await canceled;
    assert.match(sockets[0].sent.find(item => item.id === 'canceled').error, /COMMAND_CANCELED/);
    assert.deepEqual(focused, [7]);
  } finally { release(); await Promise.all([first, third]); }
  assert.deepEqual(focused, [7, 9]);
});

test('reconnect drains old command cleanup before accepting a new socket', async t => {
  const { api, command, sockets, message, settled } = await fixture(t, { token: 'a'.repeat(64), enabled: true });
  await command('claim', 'claim', { tabId: 7 });
  let started = false;
  api.debugger.sendCommand = async (_, method) => {
    if (method === 'Page.bringToFront') { started = true; return new Promise(() => {}); }
    return {};
  };
  let finishDetach;
  let detaching = false;
  const gate = new Promise(resolve => { finishDetach = resolve; });
  api.debugger.detach = async () => { detaching = true; await gate; };
  const oldCommand = command('old', 'key', { tabId: 7, key: 'Enter' });
  await until(() => started);
  sockets[0].close();
  await until(() => detaching);
  const reconnect = message('connect');
  try {
    await settled();
    assert.equal(sockets.length, 1);
  } finally { finishDetach(); await oldCommand; await reconnect; }
  assert.equal(sockets.length, 2);
  await command('new-claim', 'claim', { tabId: 7 });
  assert.equal(sockets[1].sent.find(item => item.id === 'new-claim').result.attached, true);
});

test('commands without a tab run together instead of being rejected as busy', async t => {
  const { sockets } = await fixture(t, { token: 'a'.repeat(64), enabled: true });
  const socket = sockets[0];
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
