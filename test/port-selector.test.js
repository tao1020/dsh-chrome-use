import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Bridge } from '../src/bridge.js';
import { bridgeOptions } from '../src/index.js';
import { candidatePorts, isValidAutoPort, portStateDir, probePort, readPreferredPort, writePreferredPort, preferencePath } from '../src/port-selector.js';

async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function occupy(t, port = 0) {
  const server = createServer();
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return server.address().port;
}

test('candidate order prefers the saved port, then 18791 and 18793..18799, skipping 18792', () => {
  assert.deepEqual(candidatePorts(), [18791, 18793, 18794, 18795, 18796, 18797, 18798, 18799]);
  assert.deepEqual(candidatePorts(18795).slice(0, 3), [18795, 18791, 18793]);
  assert.equal(candidatePorts(18792).includes(18792), false);
  assert.equal(new Set(candidatePorts()).size, candidatePorts().length);
  assert.equal(isValidAutoPort(1024), true);
  assert.equal(isValidAutoPort(18792), false);
  assert.equal(isValidAutoPort(1023), false);
  assert.equal(isValidAutoPort(65536), false);
});

test('the effective port selects the pairing directory; 18791 keeps the legacy path', () => {
  assert.equal(portStateDir(join('/base'), 18791), join('/base'));
  assert.equal(portStateDir(join('/base'), 18793), join('/base', 'port-18793'));
});

test('port.json round-trips, ignores invalid content, and validates the port', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-chrome-use-port-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = preferencePath(dir);
  assert.equal(await readPreferredPort(file), undefined);
  await writePreferredPort(file, 18793);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { port: 18793 });
  assert.equal(await readPreferredPort(file), 18793);
  await writeFile(file, '{bad json');
  assert.equal(await readPreferredPort(file), undefined);
  await writeFile(file, JSON.stringify({ port: 18792 }));
  assert.equal(await readPreferredPort(file), undefined);
  await writeFile(file, JSON.stringify({ port: 80 }));
  assert.equal(await readPreferredPort(file), undefined);
  await assert.rejects(writePreferredPort(file, 18792), /INVALID_PORT/);
});

test('probe is loopback-only and reports an occupied port as unavailable', async t => {
  const port = await occupy(t);
  assert.equal(await probePort(port), false);
  const free = await freePort();
  assert.equal(await probePort(free), true);
});

test('auto mode probes, falls back after an occupied candidate, and persists the effective port', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-chrome-use-auto-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const blocked = await occupy(t);
  const free = await freePort();
  const bridge = new Bridge({ auto: true, baseStateDir: dir, portCandidates: [blocked, free] });
  await bridge.start();
  t.after(() => bridge.stop());
  assert.equal(bridge.port, free);
  assert.equal(bridge.status().port, free);
  assert.equal(bridge.status().requestedPort, blocked);
  assert.deepEqual(JSON.parse(await readFile(preferencePath(dir), 'utf8')), { port: free });
  const paired = bridge.pair();
  assert.equal(paired.port, free);
  assert.equal(paired.pairingCode.length, 8);
  assert.equal(bridge.stateDir, join(dir, `port-${free}`));
});

test('a bind race after a successful probe retries the next candidate', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-chrome-use-race-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const blocked = await occupy(t);
  const free = await freePort();
  const bridge = new Bridge({ auto: true, baseStateDir: dir, portCandidates: [blocked, free], probe: async () => true });
  await bridge.start();
  t.after(() => bridge.stop());
  assert.equal(bridge.port, free);
});

test('auto mode fails with the tried candidate list when every port is occupied', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-chrome-use-none-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const first = await occupy(t);
  const second = await occupy(t);
  const bridge = new Bridge({ auto: true, baseStateDir: dir, portCandidates: [first, second] });
  await assert.rejects(bridge.start(), new RegExp(`no free loopback port among ${first}, ${second}`));
});

test('explicit port options stay strict and do not select a preferred fallback', () => {
  assert.deepEqual(bridgeOptions({}, '/base'), { auto: true, baseStateDir: '/base' });
  assert.deepEqual(bridgeOptions({ DSH_CHROME_USE_PORT: '18793' }, '/base'), { port: 18793, baseStateDir: '/base' });
  assert.deepEqual(bridgeOptions({ DSH_CHROME_USE_PORT: '  ' }, '/base'), { auto: true, baseStateDir: '/base' });
  assert.throws(() => bridgeOptions({ DSH_CHROME_USE_PORT: '0' }, '/base'), /INVALID_PORT/);
});

test('auto mode tries the remembered port before the default sequence', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-chrome-use-pref-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const preferred = await freePort();
  await writePreferredPort(preferencePath(dir), preferred);
  const bridge = new Bridge({ auto: true, baseStateDir: dir });
  await bridge.start();
  t.after(() => bridge.stop());
  assert.equal(bridge.port, preferred);
  assert.equal(bridge.status().port, preferred);
});

test('an explicit port uses the effective port directory and does not write port.json', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-chrome-use-explicit-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const port = await freePort();
  const bridge = new Bridge({ port, baseStateDir: dir });
  await bridge.start();
  t.after(() => bridge.stop());
  assert.equal(bridge.port, port);
  assert.equal(bridge.stateDir, join(dir, `port-${port}`));
  await assert.rejects(readFile(preferencePath(dir), 'utf8'), /ENOENT/);
});
