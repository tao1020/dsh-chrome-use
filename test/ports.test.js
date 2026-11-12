import test from 'node:test';
import assert from 'node:assert/strict';
import { PORT, parsePort } from '../extension/protocol.js';

test('parsePort keeps the default and accepts a trimmed unprivileged port', () => {
  assert.equal(parsePort(undefined), PORT);
  assert.equal(parsePort(''), PORT);
  assert.equal(parsePort(' 18793 '), 18793);
  assert.equal(parsePort(18794), 18794);
});

test('parsePort rejects privileged, out-of-range and non-numeric values', () => {
  for (const value of ['0', '1023', '65536', '-1', '18x', '1e4', '  ']) {
    assert.throws(() => parsePort(value), /INVALID_PORT/, String(value));
  }
});
