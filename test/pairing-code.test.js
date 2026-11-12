import test from 'node:test';
import assert from 'node:assert/strict';
import { PAIRING_ALPHABET, classifyPairingCode, decodePairingCode, encodePairingCode, generatePairingCode, isEncodedPairingCode, isLegacyPairingCode, normalizePairingCode } from '../extension/pairing-code.js';

const PORTS = [1024, 18791, 65535];
const NONCES = [0, 1, 0x123456, 0xfffffe, 0xffffff];
const ALL_DIGITS = /^\d{8}$/;



test('encodes and decodes 16-bit port plus 24-bit nonce without 32-bit shifts', () => {
  for (const port of PORTS) {
    for (const nonce of NONCES) {
      const code = encodePairingCode(port, nonce);
      assert.equal(code.length, 8);
      assert.match(code, /^[0-9A-HJKMNP-TV-Z]{8}$/);
      assert.deepEqual(decodePairingCode(code), { port, nonce });
      assert.equal(classifyPairingCode(code).kind, 'encoded');
      assert.equal(classifyPairingCode(code).port, port);
    }
  }
  assert.equal(encodePairingCode(65535, 0xffffff), 'ZZZZZZZZ');
  assert.equal(encodePairingCode(1024, 0), '0G000000');
});

test('normalizes case and outer whitespace but rejects separators and ambiguous letters', () => {
  const code = encodePairingCode(18791, 0x123456);
  assert.equal(normalizePairingCode(` ${code.toLowerCase()} `), code);
  assert.equal(classifyPairingCode(` ${code.toLowerCase()} `).code, code);
  assert.equal(isEncodedPairingCode(code), true);
  assert.equal(isLegacyPairingCode('12345678'), true);
  assert.equal(classifyPairingCode('12345678').kind, 'legacy');
  for (const value of ['I'.repeat(8), 'L'.repeat(8), 'O'.repeat(8), 'U'.repeat(8), `${code.slice(0, 7)}-`, 'ABC', '1234567', '123456789']) {
    assert.equal(classifyPairingCode(value), null, value);
  }
});

test('rejects encoded values whose decoded port is outside the loopback range', () => {
  assert.throws(() => encodePairingCode(80, 0), /INVALID_PORT/);
  assert.throws(() => encodePairingCode(65536, 0), /INVALID_PORT/);
  assert.throws(() => encodePairingCode(18791, -1), /INVALID_NONCE/);
  assert.throws(() => encodePairingCode(18791, 0x1000000), /INVALID_NONCE/);
  const raw = (port, nonce) => {
    let value = (BigInt(port) << 24n) | BigInt(nonce);
    let code = '';
    for (let index = 0; index < 8; index++) { code = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'[Number(value & 31n)] + code; value >>= 5n; }
    return code;
  };
  assert.equal(decodePairingCode(raw(80, 0)), null);
});

test('all-digit encoded candidates are classified as legacy, never generated', () => {
  const port = 2048;
  const bad = 0;
  const badCode = encodePairingCode(port, bad);
  assert.equal(badCode, '10000000');
  assert.match(badCode, ALL_DIGITS);
  assert.equal(classifyPairingCode(badCode).kind, 'legacy');
  const good = 10;
  const goodCode = encodePairingCode(port, good);
  assert.equal(goodCode, '1000000A');
  const sequence = [bad, good];
  const generated = generatePairingCode(port, () => sequence.shift());
  assert.equal(generated, goodCode);
  assert.ok(/[A-Z]/.test(generated));
  assert.equal(generated, encodePairingCode(port, good), 'resampling must not alter the encoded bits of the accepted nonce');
});

test('generated codes always contain a letter across ports and nonce ranges', () => {
  for (const port of PORTS) {
    for (const nonce of [...NONCES, 0x7fffff, 0x800000, 0xabcdef]) {
      const code = generatePairingCode(port, () => nonce);
      assert.equal(code.length, 8);
      assert.match(code, /^[0-9A-HJKMNP-TV-Z]{8}$/);
      assert.ok(/[A-Z]/.test(code));
      assert.equal(ALL_DIGITS.test(code), false);
      assert.deepEqual(decodePairingCode(code), { port, nonce });
    }
  }
  assert.equal(PAIRING_ALPHABET.includes('I'), false);
});
