import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { Bridge } from '../src/bridge.js';
import { decodePairingCode, encodePairingCode } from '../extension/pairing-code.js';
import { PARALLEL_TABS } from '../extension/protocol.js';

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
async function pair(bridge) { return socket(bridge, { type: 'pair', code: bridge.pair().code, features: [PARALLEL_TABS] }); }
function respond(ws, handler = command => ({ tabId: command.args.tabId ?? 7, ok: true })) {
  ws.on('message', bytes => {
    const request = JSON.parse(bytes);
    if (request.type === 'command') ws.send(JSON.stringify({ type: 'result', id: request.id, result: handler(request) }));
  });
}
async function until(predicate, timeout = 2000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error('condition not reached in time');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
function hold(ws, shouldHold = () => true) {
  const held = [];
  const sent = [];
  ws.on('message', bytes => {
    const message = JSON.parse(bytes);
    sent.push(message);
    if (message.type !== 'command') return;
    if (shouldHold(message)) { held.push(message); return; }
    ws.send(JSON.stringify({ type: 'result', id: message.id, result: { tabId: message.args.tabId ?? 7 } }));
  });
  return { held, sent };
}

test('reports the occupied port with the environment override hint', async t => {
  const blocker = createServer();
  await new Promise(resolve => blocker.listen(0, '127.0.0.1', resolve));
  const port = blocker.address().port;
  t.after(() => new Promise(resolve => blocker.close(resolve)));
  const bridge = new Bridge({ port });
  await assert.rejects(bridge.start(), new RegExp(`Port ${port} is unavailable`));
});

test('pair returns both the legacy numeric alias and an encoded port code', async t => {
  const bridge = await fixture(t);
  const pairing = bridge.pair();
  assert.match(pairing.code, /^\d{8}$/);
  assert.equal(pairing.code.length, 8);
  assert.equal(pairing.pairingCode.length, 8);
  assert.match(pairing.pairingCode, /^[0-9A-HJKMNP-TV-Z]{8}$/);
  assert.ok(/[A-Z]/.test(pairing.pairingCode));
  const decoded = decodePairingCode(pairing.pairingCode);
  assert.equal(decoded.port, bridge.port);
  assert.ok(Number.isSafeInteger(decoded.nonce));
  assert.equal(pairing.port, bridge.port);
});

test('encoded and legacy codes authenticate, and one success consumes both', async t => {
  const bridge = await fixture(t);
  const { pairingCode, code } = bridge.pair();
  const encoded = await socket(bridge, { type: 'pair', code: pairingCode });
  assert.equal(encoded.response.type, 'ready');
  assert.equal(bridge.status().connected, true);
  const closed = once(encoded.ws, 'close');
  encoded.ws.close();
  await closed;
  const legacy = await socket(bridge, { type: 'pair', code });
  assert.match(legacy.response.error, /AUTH_FAILED/);
});

test('a code encoded for another port is rejected', async t => {
  const bridge = await fixture(t);
  bridge.pair();
  const wrong = encodePairingCode(18793, 1);
  const result = await socket(bridge, { type: 'pair', code: wrong });
  assert.match(result.response.error, /AUTH_FAILED/);
  assert.equal(bridge.status().connected, false);
});

test('encoded and legacy forms share the five-attempt budget', async t => {
  const bridge = await fixture(t);
  const pairing = bridge.pair();
  const wrongEncoded = encodePairingCode(18793, 2);
  for (const code of [wrongEncoded, '00000000', wrongEncoded, '00000000', wrongEncoded]) {
    const result = await socket(bridge, { type: 'pair', code });
    assert.match(result.response.error, /AUTH_FAILED/);
  }
  const correct = await socket(bridge, { type: 'pair', code: pairing.pairingCode });
  assert.match(correct.response.error, /AUTH_FAILED/);
});

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
  const bridge = await fixture(t, { claimWaitMs: 30 });
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
test('release hands ownership to queued chats in FIFO order without a detach event', async t => {
  const bridge = await fixture(t, { claimWaitMs: 100 });
  const { ws } = await pair(bridge);
  respond(ws);
  await bridge.call('claim', { tabId: 7 }, 'a');
  const b = bridge.call('claim', { tabId: 7 }, 'b');
  const c = bridge.call('claim', { tabId: 7 }, 'c');
  const results = Promise.allSettled([b, c]);
  await bridge.call('release', { tabId: 7 }, 'a');
  await b;
  assert.equal(bridge.claims.get(7), 'b');
  await bridge.call('release', { tabId: 7 }, 'b');
  await c;
  assert.equal(bridge.claims.get(7), 'c');
  assert.equal(bridge.claimWaiters.size, 0);
  await results;
});

test('canceled tab stays locked until extension cleanup acknowledges completion', async t => {
  const bridge = await fixture(t, { claimWaitMs: 300 });
  const { ws } = await pair(bridge);
  const { held } = hold(ws, command => command.action === 'snapshot');
  await bridge.call('claim', { tabId: 7 }, 'a');
  const abort = new AbortController();
  const work = bridge.call('snapshot', { tabId: 7 }, 'a', abort.signal);
  await until(() => held.length === 1);
  abort.abort();
  await assert.rejects(work, /CANCELED/);
  await assert.rejects(bridge.call('snapshot', { tabId: 7 }, 'a'), /TAB_BUSY/);
  ws.send(JSON.stringify({ type: 'detached', tabId: 7 }));
  await until(() => !bridge.claims.has(7));
  const next = bridge.call('claim', { tabId: 7 }, 'b');
  const result = Promise.allSettled([next]);
  assert.equal(bridge.claims.has(7), false);
  ws.send(JSON.stringify({ type: 'result', id: held[0].id, error: 'COMMAND_CANCELED' }));
  await next;
  assert.equal(bridge.claims.get(7), 'b');
  await result;
});

test('duplicate queued claims cannot reacquire a tab after their chat releases it', async t => {
  const bridge = await fixture(t);
  const { ws } = await pair(bridge);
  respond(ws);
  await bridge.call('claim', { tabId: 7 }, 'a');
  const b = bridge.call('claim', { tabId: 7 }, 'b');
  await assert.rejects(bridge.call('claim', { tabId: 7 }, 'b'), /TAB_CLAIM_PENDING/);
  const c = bridge.call('claim', { tabId: 7 }, 'c');
  await bridge.call('release', { tabId: 7 }, 'a');
  await b;
  await bridge.call('release', { tabId: 7 }, 'b');
  await c;
  assert.equal(bridge.claims.get(7), 'c');
  assert.equal(bridge.claimWaiters.size, 0);
});

test('canceling a queued claim removes it without blocking the next waiter', async t => {
  const bridge = await fixture(t);
  const { ws } = await pair(bridge);
  respond(ws);
  await bridge.call('claim', { tabId: 7 }, 'a');
  const abort = new AbortController();
  const canceled = bridge.call('claim', { tabId: 7 }, 'b', abort.signal);
  const next = bridge.call('claim', { tabId: 7 }, 'c');
  abort.abort();
  await assert.rejects(canceled, /CANCELED/);
  await bridge.call('release', { tabId: 7 }, 'a');
  await next;
  assert.equal(bridge.claims.get(7), 'c');
  assert.equal(bridge.claimWaiters.size, 0);
});

test('claim timeout and shutdown remove queued waiters', async t => {
  const bridge = await fixture(t, { claimWaitMs: 20 });
  const { ws } = await pair(bridge);
  respond(ws);
  await bridge.call('claim', { tabId: 7 }, 'a');
  await assert.rejects(bridge.call('claim', { tabId: 7 }, 'b'), /TAB_IN_USE/);
  assert.equal(bridge.claimWaiters.size, 0);
  const queued = bridge.call('claim', { tabId: 7 }, 'c');
  const rejected = assert.rejects(queued, /BRIDGE_STOPPED/);
  await bridge.stop();
  await rejected;
  assert.equal(bridge.claimWaiters.size, 0);
});

test('missing cancellation acknowledgment disconnects rather than unlocking unsafe work', async t => {
  const bridge = await fixture(t);
  const { ws } = await pair(bridge);
  hold(ws);
  const abort = new AbortController();
  const received = once(ws, 'message');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const work = bridge.call('tabs', {}, 'a', abort.signal);
  await received;
  abort.abort();
  await assert.rejects(work, /CANCELED/);
  // The tab stays locked while extension cleanup is unknown.
  assert.equal(bridge.pending.size, 1);
  const closed = once(ws, 'close');
  t.mock.timers.tick(8000);
  t.mock.timers.reset();
  await closed;
  assert.match(bridge.lastError, /BROWSER_CLEANUP_TIMEOUT/);
  // The close event can reach the client before the server clears its map.
  await until(() => bridge.pending.size === 0);
});

test('late successful open after cancellation disconnects to clean its unowned attachment', async t => {
  const bridge = await fixture(t);
  const { ws } = await pair(bridge);
  const { held } = hold(ws);
  const abort = new AbortController();
  const work = bridge.call('open', { url: 'https://example.com', group: 'test' }, 'a', abort.signal);
  await until(() => held.length === 1);
  abort.abort();
  await assert.rejects(work, /CANCELED/);
  const closed = once(ws, 'close', { signal: AbortSignal.timeout(500) });
  ws.send(JSON.stringify({ type: 'result', id: held[0].id, result: { tabId: 99 } }));
  await closed;
  assert.match(bridge.lastError, /CANCELED_OPEN/);
  await until(() => bridge.pending.size === 0);
});

test('a successful open result wins cancellation before its caller resumes', async t => {
  const bridge = await fixture(t);
  const { ws } = await pair(bridge);
  respond(ws);
  const abort = new AbortController();
  // The bridge listener resolves first; this listener aborts before promise continuations.
  bridge.peer.on('message', () => abort.abort());
  const result = await bridge.call('open', { url: 'https://example.com', group: 'test' }, 'a', abort.signal);
  assert.equal(result.tabId, 7);
  assert.equal(bridge.claims.get(7), 'a');
});

test('closing a tab drops its claim', async t => {
  const bridge = await fixture(t);
  const { ws } = await pair(bridge);
  respond(ws);
  await bridge.call('claim', { tabId: 7 }, 'a');
  assert.equal(bridge.claims.has(7), true);
  await bridge.call('close', { tabId: 7 }, 'a');
  assert.equal(bridge.claims.has(7), false);
});
test('runs commands on different tabs together and keeps each tab exclusive', async t => {
  const bridge = await fixture(t);
  const { ws } = await pair(bridge);
  const { held, sent } = hold(ws, command => command.action === 'snapshot');
  await bridge.call('claim', { tabId: 7 }, 'a');
  await bridge.call('claim', { tabId: 8 }, 'b');
  const first = bridge.call('snapshot', { tabId: 7 }, 'a');
  const second = bridge.call('snapshot', { tabId: 8 }, 'b');
  await until(() => held.length === 2);
  assert.deepEqual(held.map(command => command.args.tabId).sort(), [7, 8]);
  await assert.rejects(bridge.call('snapshot', { tabId: 7 }, 'a'), /TAB_BUSY/);
  assert.equal(sent.filter(message => message.type === 'command' && message.action === 'snapshot').length, 2);
  for (const command of held) ws.send(JSON.stringify({ type: 'result', id: command.id, result: { tabId: command.args.tabId } }));
  assert.deepEqual(await Promise.all([first, second]), [{ tabId: 7 }, { tabId: 8 }]);
});
test('an extension without the parallel capability keeps one command at a time', async t => {
  const bridge = await fixture(t, { deadlineMs: 100 });
  const { ws } = await socket(bridge, { type: 'pair', code: bridge.pair().code });
  const { held } = hold(ws);
  const first = bridge.call('snapshot', {}, 'a');
  await until(() => held.length === 1);
  await assert.rejects(bridge.call('snapshot', {}, 'b'), /BROWSER_BUSY/);
  const closed = once(ws, 'close');
  await assert.rejects(first, /BROWSER_TIMEOUT: the connection was closed/);
  await closed;
  assert.equal(bridge.status().connected, false);
});
test('a timeout stops only that command and leaves the connection usable', async t => {
  const bridge = await fixture(t, { deadlineMs: 100 });
  const { ws } = await pair(bridge);
  const { held, sent } = hold(ws, command => command.action === 'snapshot' && command.args.tabId === 7);
  await bridge.call('claim', { tabId: 7 }, 'a');
  await bridge.call('claim', { tabId: 8 }, 'b');
  const slow = bridge.call('snapshot', { tabId: 7 }, 'a');
  const fast = bridge.call('snapshot', { tabId: 8 }, 'b');
  assert.deepEqual(await fast, { tabId: 8 });
  await assert.rejects(slow, /BROWSER_TIMEOUT/);
  await until(() => sent.some(message => message.type === 'cancel' && message.id === held[0].id));
  assert.equal(bridge.status().connected, true);
  // The claim stays until the extension confirms that the tab was detached.
  assert.equal(bridge.claims.get(7), 'a');
  ws.send(JSON.stringify({ type: 'detached', tabId: 7 }));
  await until(() => !bridge.claims.has(7));
  ws.removeAllListeners('message');
  respond(ws);
  assert.deepEqual(await bridge.call('snapshot', { tabId: 8 }, 'b'), { tabId: 8, ok: true });
});
test('canceling one command does not disconnect another session', async t => {
  const bridge = await fixture(t);
  const { ws } = await pair(bridge);
  const { held, sent } = hold(ws, command => command.action === 'snapshot');
  await bridge.call('claim', { tabId: 7 }, 'a');
  await bridge.call('claim', { tabId: 8 }, 'b');
  const controller = new AbortController();
  const canceled = bridge.call('snapshot', { tabId: 7 }, 'a', controller.signal);
  const other = bridge.call('snapshot', { tabId: 8 }, 'b');
  await until(() => held.length === 2);
  controller.abort();
  await assert.rejects(canceled, /CANCELED/);
  await until(() => sent.some(message => message.type === 'cancel'));
  assert.equal(sent.find(message => message.type === 'cancel').id, held.find(command => command.args.tabId === 7).id);
  ws.send(JSON.stringify({ type: 'result', id: held.find(command => command.args.tabId === 8).id, result: { tabId: 8 } }));
  assert.deepEqual(await other, { tabId: 8 });
  assert.equal(bridge.status().connected, true);
});
test('shutdown rejects pending work and releases ownership', async t => {
  const bridge = await fixture(t);
  await pair(bridge);
  const pending = bridge.call('tabs', {}, 'a');
  const rejected = assert.rejects(pending, /BRIDGE_STOPPED/);
  await bridge.stop();
  await rejected;
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

test('a Chrome detach explains a later claim requirement with its reason', async t => {
  const bridge = await fixture(t);
  const { ws } = await pair(bridge);
  respond(ws);
  await bridge.call('claim', { tabId: 7 }, 'a');
  ws.send(JSON.stringify({ type: 'detached', tabId: 7, reason: 'replaced_with_devtools' }));
  await until(() => bridge.claims.size === 0);
  await assert.rejects(
    bridge.call('snapshot', { tabId: 7 }, 'a'),
    /TAB_NOT_OWNED: claim the tab first \(Chrome detached this tab \d+s ago: replaced_with_devtools\)/,
  );
});

test('a fresh claim clears the remembered detach reason', async t => {
  const bridge = await fixture(t);
  const { ws } = await pair(bridge);
  respond(ws);
  await bridge.call('claim', { tabId: 7 }, 'a');
  ws.send(JSON.stringify({ type: 'detached', tabId: 7, reason: 'target_closed' }));
  await until(() => bridge.claims.size === 0);
  await bridge.call('claim', { tabId: 7 }, 'a');
  await bridge.call('release', { tabId: 7 }, 'a');
  await assert.rejects(bridge.call('snapshot', { tabId: 7 }, 'a'), error => /TAB_NOT_OWNED: claim the tab first$/.test(error.message));
});

test('two bridges with separate state dirs keep independent pairing identities', async t => {
  const roots = await Promise.all([
    mkdtemp(join(tmpdir(), 'dsh-chrome-use-bridge-a-')),
    mkdtemp(join(tmpdir(), 'dsh-chrome-use-bridge-b-')),
  ]);
  t.after(() => Promise.all(roots.map(root => rm(root, { recursive: true, force: true }))));
  const first = new Bridge({ port: 0, stateDir: roots[0] });
  const second = new Bridge({ port: 0, stateDir: roots[1] });
  await Promise.all([first.start(), second.start()]);
  t.after(() => Promise.all([first.stop(), second.stop()]));
  const pairedFirst = await pair(first);
  const pairedSecond = await pair(second);
  const firstToken = pairedFirst.response.token;
  const secondToken = pairedSecond.response.token;
  assert.notEqual(firstToken, secondToken);
  assert.equal(JSON.parse(await readFile(join(roots[0], 'pairing.json'))).token, firstToken);
  assert.equal(JSON.parse(await readFile(join(roots[1], 'pairing.json'))).token, secondToken);
  const wrongOnSecond = await socket(second, { type: 'auth', token: firstToken });
  assert.match(wrongOnSecond.response.error, /AUTH_FAILED/);
  const wrongOnFirst = await socket(first, { type: 'auth', token: secondToken });
  assert.match(wrongOnFirst.response.error, /AUTH_FAILED/);
});
