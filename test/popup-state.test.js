import test from 'node:test';
import assert from 'node:assert/strict';
import { popupState, connectionRow } from '../extension/popup-state.js';

test('connected popup lists each connected port', () => {
  const show = popupState({ connections: [{ port: 18791, connected: true, version: '0.6.7' }, { port: 18793, connected: false }] });
  assert.equal(show.connected, true);
  assert.equal(show.paired, true);
  assert.equal(show.connectedCount, 1);
  assert.equal(show.statusText, '已连接 1 个 Harness');
  assert.deepEqual(show.connections.map(row => row.port), [18791, 18793]);
  assert.equal(show.connections[0].canConnect, false);
  assert.equal(show.connections[1].canConnect, true);
  assert.equal(show.connections[0].title, '端口 18791');
  assert.equal(show.connections[0].meta, '已连接 · 0.6.7');
});

test('saved but disconnected popup keeps the pairing form and offers Connect', () => {
  const show = popupState({ connections: [{ port: 18793, connected: false }], reconnecting: true });
  assert.equal(show.connected, false);
  assert.equal(show.paired, true);
  assert.equal(show.reconnecting, true);
  assert.equal(show.statusText, '已配对，正在等待本机 Harness');
  assert.equal(show.connections[0].canConnect, true);
});

test('unpaired popup starts from an empty connection list', () => {
  const show = popupState({ connections: [] });
  assert.equal(show.connected, false);
  assert.equal(show.paired, false);
  assert.equal(show.statusText, '尚未配对');
  assert.deepEqual(show.connections, []);
});

test('a named harness replaces the bare port in the row title', () => {
  const row = connectionRow({ port: 18793, connected: true, version: '0.9.0', name: 'Codex' });
  assert.equal(row.title, 'Codex · 18793');
  assert.equal(row.meta, '已连接 · 0.9.0');
  assert.equal(row.error, '');
});

test('a failed connection keeps the error behind the icon without hiding Connect', () => {
  const row = connectionRow({ port: 18793, connected: false, error: 'Connection to port 18793 timed out.' });
  assert.equal(row.state, 'error');
  assert.equal(row.canConnect, true);
  assert.equal(row.title, '端口 18793');
  assert.equal(row.meta, '未连接');
  assert.match(row.error, /timed out/);
  assert.match(row.hint, /Harness 可能已离线/);
});

test('a remote host is visible even when the harness has no name', () => {
  assert.equal(connectionRow({ port: 18791, host: '192.168.1.20', name: null }).title, '192.168.1.20:18791');
  assert.equal(connectionRow({ port: 18791, host: '192.168.1.20', name: 'mac' }).title, 'mac · 192.168.1.20:18791');
  assert.equal(connectionRow({ port: 18791, host: '::1', name: 'mac' }).title, 'mac · [::1]:18791');
  assert.equal(connectionRow({ port: 18791, host: 'fd12::10' }).title, '[fd12::10]:18791');
  assert.equal(connectionRow({ port: 18791, host: 'localhost' }).title, '端口 18791');
  // The row hands its address to the Connect button, so that button dials the
  // machine this row was paired with instead of the global default.
  assert.equal(connectionRow({ port: 18791, host: '192.168.1.20' }).host, '192.168.1.20');
  assert.equal(connectionRow({ port: 18791 }).host, null);
});
