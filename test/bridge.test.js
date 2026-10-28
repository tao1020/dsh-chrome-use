import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { Bridge } from '../src/bridge.js';

const origin = `chrome-extension://${'a'.repeat(32)}`;
async function fixture(t, options = {}) {
  const bridge = new Bridge({ port: 0, ...options });
  await bridge.start();
  t.after(() => bridge.stop());
  return bridge;
}
async function socket(bridge, auth, customOrigin = origin) {
  const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}/bridge`, { origin: customOrigin });
  await once(ws, 'open');
  const result = once(ws, 'message');
  ws.send(JSON.stringify(auth));
  return { ws, response: JSON.parse((await result)[0].toString()) };
}
async function pair(bridge) { return socket(bridge, { type: 'pair', code: bridge.pair().code }); }
function respond(ws, handler = command => ({ tabId: command.args.tabId ?? 7, ok: true })) {
  ws.on('message', bytes => {
    const request = JSON.parse(bytes);
    if (request.type === 'command') ws.send(JSON.stringify({ type: 'result', id: request.id, result: handler(request) }));
  });
}

test('binds loopback and rejects ordinary website origins and HTTP access', async t => {
  const bridge = await fixture(t);
  assert.equal(bridge.http.address().address, '127.0.0.1');
  const res = await fetch(`http://127.0.0.1:${bridge.port}/`, { signal: AbortSignal.timeout(2000) });
  assert.equal(res.status, 404);
  await assert.rejects(socket(bridge, { type: 'pair', code: bridge.pair().code }, 'https://example.com'), /403/);
});
test('requires authentication and consumes the pairing code once', async t => {
  const bridge = await fixture(t);
  const bad = await socket(bridge, { type: 'pair', code: '00000000' });
  assert.match(bad.response.error, /AUTH_FAILED/);
  const { ws, response } = await pair(bridge);
  assert.equal(response.type, 'ready');
  assert.equal(response.token.length, 64);
  assert.throws(() => bridge.pair(), /ALREADY_CONNECTED/);
  const denied = await socket(bridge, { type: 'auth', token: response.token });
  assert.match(denied.response.error, /ALREADY_CONNECTED/);
  assert.equal(bridge.status().connected, true);
  ws.close();
});
test('reports the connected extension version and clears old authentication errors', async t => {
  const bridge = await fixture(t);
  await socket(bridge, { type: 'pair', code: '00000000' });
  assert.match(bridge.status().lastError, /AUTH_FAILED/);
  await socket(bridge, { type: 'pair', code: bridge.pair().code, version: '0.1.1' });
  assert.equal(bridge.status().extensionVersion, '0.1.1');
  assert.equal(bridge.status().lastError, undefined);
});
test('limits incorrect codes and rejects expired pairing', async t => {
  const bridge = await fixture(t);
  const { code } = bridge.pair();
  bridge.pairing.expires = Date.now() - 1;
  assert.match((await socket(bridge, { type: 'pair', code })).response.error, /AUTH_FAILED/);
  bridge.pair();
  for (let i = 0; i < 5; i++) assert.match((await socket(bridge, { type: 'pair', code: '00000000' })).response.error, /AUTH_FAILED/);
  assert.match((await socket(bridge, { type: 'pair', code: bridge.pairing.code })).response.error, /AUTH_FAILED/);
});
test('persists exact extension identity and rejects a different extension', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-chrome-use-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bridge = await fixture(t, { stateDir: directory });
  const { ws, response } = await pair(bridge);
  const saved = JSON.parse(await readFile(join(directory, 'pairing.json')));
  assert.equal(saved.token, response.token);
  const serverClosed = once(bridge.peer, 'close');
  ws.close();
  await Promise.all([once(ws, 'close'), serverClosed]);
  const denied = await socket(bridge, { type: 'auth', token: response.token }, `chrome-extension://${'b'.repeat(32)}`);
  assert.match(denied.response.error, /AUTH_FAILED/);
  const accepted = await socket(bridge, { type: 'auth', token: response.token });
  assert.equal(accepted.response.type, 'ready');
});
test('saved pairing reconnects after the Harness bridge is restarted without a new code', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-chrome-use-restart-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const first = await fixture(t, { stateDir: directory });
  const { ws, response } = await pair(first);
  const closed = once(ws, 'close');
  await first.stop();
  await closed;
  const restarted = await fixture(t, { stateDir: directory });
  assert.equal(restarted.pairing, undefined);
  const reconnected = await socket(restarted, { type: 'auth', token: response.token });
  assert.equal(reconnected.response.type, 'ready');
  assert.equal(restarted.status().connected, true);
  assert.equal(restarted.pairing, undefined);
});
test('claims are chat scoped, release does not permit another chat to act without claim', async t => {
  const bridge = await fixture(t);
  const { ws } = await pair(bridge);
  respond(ws);
  await assert.rejects(bridge.call('snapshot', { tabId: 7 }, 'a'), /TAB_NOT_OWNED/);
  await bridge.call('claim', { tabId: 7 }, 'a');
  await assert.rejects(bridge.call('claim', { tabId: 7 }, 'b'), /TAB_IN_USE/);
  await assert.rejects(bridge.call('click', { tabId: 7 }, 'b'), /TAB_NOT_OWNED/);
  await bridge.call('snapshot', { tabId: 7 }, 'a');
  await bridge.call('release', { tabId: 7 }, 'a');
  await assert.rejects(bridge.call('snapshot', { tabId: 7 }, 'b'), /TAB_NOT_OWNED/);
});
test('serializes commands and timeout closes connection without replay', async t => {
  const bridge = await fixture(t, { deadlineMs: 30 });
  const { ws } = await pair(bridge);
  let count = 0;
  ws.on('message', () => count++);
  const pending = bridge.call('tabs', {}, 'a');
  await assert.rejects(bridge.call('tabs', {}, 'b'), /BROWSER_BUSY/);
  await assert.rejects(pending, /BROWSER_TIMEOUT/);
  assert.equal(count, 1);
  await once(ws, 'close');
  assert.equal(bridge.status().connected, false);
});
test('cancellation and shutdown reject pending work and release ownership', async t => {
  const bridge = await fixture(t);
  const { ws } = await pair(bridge);
  const controller = new AbortController();
  const serverClosed = once(bridge.peer, 'close');
  const pending = bridge.call('tabs', {}, 'a', controller.signal);
  controller.abort();
  await assert.rejects(pending, /CANCELED/);
  await Promise.all([once(ws, 'close'), serverClosed]);
  assert.equal(bridge.claims.size, 0);
  const { ws: again } = await pair(bridge);
  const shutdown = bridge.call('tabs', {}, 'a');
  const rejected = assert.rejects(shutdown, /BRIDGE_STOPPED/);
  const disconnected = once(again, 'close');
  await bridge.stop();
  await rejected;
  await disconnected;
  assert.notEqual(again.readyState, WebSocket.OPEN);
});
test('disconnect rejects in-flight work, detached event removes ownership', async t => {
  const bridge = await fixture(t);
  const { ws } = await pair(bridge);
  respond(ws);
  await bridge.call('claim', { tabId: 7 }, 'a');
  ws.send(JSON.stringify({ type: 'detached', tabId: 7 }));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(bridge.claims.size, 0);
  ws.removeAllListeners('message');
  const pending = bridge.call('tabs', {}, 'a');
  ws.close();
  await assert.rejects(pending, /BROWSER_DISCONNECTED/);
});
