import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { Bridge } from '../src/bridge.js';
import { bridgeOptions } from '../src/index.js';

const origin = `chrome-extension://${'a'.repeat(32)}`;

function openRaw(port, hostHeader, address = '127.0.0.1') {
  // A raw upgrade request, so the Host header can differ from the socket address
  // without a WebSocket client rewriting it.
  return new Promise((resolve, reject) => {
    const req = request({
      port,
      host: address,
      path: '/bridge',
      headers: {
        host: hostHeader,
        origin,
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
        'sec-websocket-version': '13',
      },
    });
    req.on('upgrade', (_response, socket) => { socket.destroy(); resolve('open'); });
    req.on('response', response => { response.resume(); resolve(response.statusCode); });
    req.on('error', error => resolve(error.code === 'ECONNREFUSED' ? 'refused' : error.message));
    req.end();
  });
}

test('the bridge binds loopback by default', async t => {
  const bridge = new Bridge({ port: 0 });
  await bridge.start();
  t.after(() => bridge.stop());
  assert.equal(bridge.bindHost, '127.0.0.1');
  assert.equal(await openRaw(bridge.port, `127.0.0.1:${bridge.port}`), 'open');
});

test('a loopback bridge also accepts the localhost spelling', async t => {
  const bridge = new Bridge({ port: 0 });
  await bridge.start();
  t.after(() => bridge.stop());
  assert.equal(await openRaw(bridge.port, `localhost:${bridge.port}`), 'open');
});

test('a foreign Host header is refused', async t => {
  const bridge = new Bridge({ port: 0 });
  await bridge.start();
  t.after(() => bridge.stop());
  assert.notEqual(await openRaw(bridge.port, `evil.example:${bridge.port}`), 'open');
});

test('the bridge listens on the configured address, not on loopback', async t => {
  // ::1 is loopback but a different address, so this fails if listen() ignores
  // bindHost and hardcodes 127.0.0.1.
  const bridge = new Bridge({ port: 0, bindHost: '::1' });
  try {
    await bridge.start();
  } catch {
    t.skip('no IPv6 loopback on this machine');
    return;
  }
  t.after(() => bridge.stop());
  assert.equal(await openRaw(bridge.port, `[::1]:${bridge.port}`, '::1'), 'open');
  assert.equal(await openRaw(bridge.port, `127.0.0.1:${bridge.port}`), 'refused');
});

test('an invalid bind host stops the bridge from starting', () => {
  assert.throws(() => new Bridge({ port: 0, bindHost: 'example.com' }), /private|hostnames/i);
  assert.throws(() => new Bridge({ port: 0, bindHost: '8.8.8.8' }), /private/i);
});

test('the bind host comes from the environment and needs an explicit port', () => {
  assert.equal(bridgeOptions({}, '/tmp/state').bindHost, undefined);
  assert.equal(bridgeOptions({ DSH_CHROME_USE_PORT: '18791' }, '/tmp/state').bindHost, undefined);
  assert.equal(bridgeOptions({ DSH_CHROME_USE_PORT: '18791', DSH_CHROME_USE_BIND_HOST: '192.168.1.20' }, '/tmp/state').bindHost, '192.168.1.20');
  assert.throws(() => bridgeOptions({ DSH_CHROME_USE_BIND_HOST: '192.168.1.20' }, '/tmp/state'), /needs DSH_CHROME_USE_PORT/);
  assert.throws(() => bridgeOptions({ DSH_CHROME_USE_PORT: '18791', DSH_CHROME_USE_BIND_HOST: 'example.com' }, '/tmp/state'), /private|hostnames/i);
});
