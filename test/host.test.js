import test from 'node:test';
import assert from 'node:assert/strict';
import { hostDoctor, parseAllowedActions, toToolError } from '../src/index.js';

test('an unset allow-list keeps every tool; a set one is fail-closed', () => {
  assert.equal(parseAllowedActions(undefined), null);
  assert.equal(parseAllowedActions('   '), null);
  const allowed = parseAllowedActions('snapshot, chrome_click ,Content');
  assert.deepEqual([...allowed].sort(), ['click', 'content', 'snapshot']);
  // Unknown names never widen the surface and an all-typo list blocks everything.
  assert.deepEqual([...parseAllowedActions('nope, chrome_nope')], []);
  assert.equal(parseAllowedActions('nope').has('snapshot'), false);
});

test('host doctor exposes only host-side facts', () => {
  const host = hostDoctor({
    stateDir: '/tmp/state',
    pluginVersion: '0.10.0',
    status: { connected: true, port: 18791, extensionVersion: '0.10.0', claimedTabs: [7], lastError: null },
    allowed: parseAllowedActions('snapshot'),
  });
  assert.equal(host.pluginVersion, '0.10.0');
  assert.equal(host.connected, true);
  assert.equal(host.port, 18791);
  assert.deepEqual(host.claimedTabs, [7]);
  assert.deepEqual(host.allowedActions, ['snapshot']);
  assert.equal(hostDoctor({ stateDir: '/tmp/state', pluginVersion: '0.10.0', status: {}, allowed: null }).allowedActions, null);
});

test('a tool error carries the machine-readable failure line', () => {
  const error = new Error('STALE_ELEMENT: take a fresh snapshot');
  const wrapped = toToolError(error, 'click');
  assert.match(wrapped.message, /^STALE_ELEMENT/);
  assert.match(wrapped.message, /\nFailure: /);
  const fields = JSON.parse(wrapped.message.split('\nFailure: ')[1]);
  assert.equal(fields.code, 'STALE_ELEMENT');
  assert.equal(fields.actionSent, false);
  assert.equal(fields.retry, 'snapshot');
  assert.equal(wrapped.failure.code, fields.code);
  assert.equal(wrapped.failure.retry, fields.retry);
});
