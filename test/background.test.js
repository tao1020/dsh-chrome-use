import test from 'node:test';
import assert from 'node:assert/strict';

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
    tabs: { onRemoved: event('removed'), query: async () => [] },
    debugger: { onDetach: event('detach'), onEvent: event('debugEvent') },
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
      this.sent.push(JSON.parse(body));
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ type: 'ready', protocol: 1, token: 'a'.repeat(64) }) }));
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
  return { stored, sockets, alarms, listeners, message, settled };
}

test('worker startup restores saved pairing; disconnect disables automatic reconnect', async t => {
  const { sockets, alarms, stored, message, listeners, settled } = await fixture(t, { token: 'a'.repeat(64), enabled: true });
  assert.equal(sockets.length, 1);
  assert.equal(sockets[0].sent[0].type, 'auth');
  assert.equal(sockets[0].sent[0].code, undefined);
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
