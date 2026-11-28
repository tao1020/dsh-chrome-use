import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_HOST, bridgeUrl, normalizeServerHost } from '../extension/host.js';

test('an empty setting keeps the loopback default', () => {
  assert.equal(normalizeServerHost(undefined), DEFAULT_HOST);
  assert.equal(normalizeServerHost('   '), DEFAULT_HOST);
  assert.equal(DEFAULT_HOST, '127.0.0.1');
});

test('loopback and private IPv4 addresses are accepted', () => {
  for (const host of ['127.0.0.1', '127.5.6.7', 'localhost', '10.0.0.2', '192.168.1.20', '172.16.0.1', '172.31.255.255', '169.254.10.1']) {
    assert.equal(normalizeServerHost(host), host, host);
  }
});

test('public IPv4 addresses and hostnames are refused', () => {
  for (const host of ['8.8.8.8', '172.32.0.1', '192.169.1.1', '1.1.1.1', '256.1.1.1', 'example.com', 'dsh.example.com', '10.0.0']) {
    assert.throws(() => normalizeServerHost(host), /private|hostnames/i, host);
  }
});

test('octal-style and malformed IPv4 spellings are refused instead of dialled elsewhere', () => {
  // Chrome reads a leading zero as octal, so 010.0.0.1 would dial 8.0.0.1.
  for (const host of ['010.0.0.1', '192.168.1.020', '10.0.0.08']) {
    assert.throws(() => normalizeServerHost(host), /Leading zeros/, host);
  }
  for (const host of ['127.0.0.1.5', '0.0.0.0', '255.255.255.255', '::ffff:127.0.0.1', 'localhost.', '100.64.0.1']) {
    assert.throws(() => normalizeServerHost(host), /private|hostnames|IPv6/i, host);
  }
  assert.throws(() => normalizeServerHost('10.0.0.2:18791'), /without a port/);
  assert.equal(normalizeServerHost('LOCALHOST'), 'localhost');
  assert.equal(normalizeServerHost('  192.168.1.20  '), '192.168.1.20');
});

test('accepted IPv4 addresses come back canonical', () => {
  assert.equal(normalizeServerHost('  192.168.1.20 '), '192.168.1.20');
  assert.equal(bridgeUrl('192.168.1.20', 18791), 'ws://192.168.1.20:18791/bridge');
});

test('only loopback, unique-local and link-local IPv6 addresses are accepted', () => {
  assert.equal(normalizeServerHost('::1'), '::1');
  assert.equal(normalizeServerHost('[fd12:3456::10]'), 'fd12:3456::10');
  assert.equal(normalizeServerHost('FE80::1'), 'fe80::1');
  assert.throws(() => normalizeServerHost('2001:db8::1'), /private IPv6/);
  assert.throws(() => normalizeServerHost('[2606:4700::1111]'), /private IPv6/);
});

test('the websocket URL brackets IPv6 addresses and keeps the port', () => {
  assert.equal(bridgeUrl(undefined, 18791), 'ws://127.0.0.1:18791/bridge');
  assert.equal(bridgeUrl('192.168.1.20', 18791), 'ws://192.168.1.20:18791/bridge');
  assert.equal(bridgeUrl('fd12:3456::10', 18791), 'ws://[fd12:3456::10]:18791/bridge');
  assert.throws(() => bridgeUrl('example.com', 18791), /hostnames/i);
});

test('malformed IPv6 is refused and equivalent spellings compare equal', () => {
  for (const value of ['fd00::zz', 'fe80::zz', 'fe80:', 'fe80::1:2:3:4:5:6:7:8', 'fe80::1%eth0']) {
    assert.throws(() => normalizeServerHost(value), /IPv6/, value);
  }
  assert.equal(normalizeServerHost('fe80:0:0:0:0:0:0:1'), 'fe80::1');
  assert.equal(normalizeServerHost('[FE80::1]'), 'fe80::1');
  assert.equal(normalizeServerHost('fe80::1'), normalizeServerHost('fe80:0:0:0:0:0:0:1'));
});

test('the leading-zero error names the address the user typed', () => {
  assert.throws(() => normalizeServerHost('192.168.1.020'), /192\.168\.1\.20 instead of 192\.168\.1\.020/);
  assert.throws(() => normalizeServerHost('010.0.0.1'), /10\.0\.0\.1 instead of 010\.0\.0\.1/);
});
