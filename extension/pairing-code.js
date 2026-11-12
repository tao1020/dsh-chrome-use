// Crockford base32, uppercase, no I/L/O/U. Eight characters carry a 16-bit
// port and a 24-bit nonce. Keep this module pure so the bridge, extension and
// tests share exactly one encoder.
export const PAIRING_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const PAIRING_CODE_LENGTH = 8;
const ALPHABET = [...PAIRING_ALPHABET];
const INDEX = new Map(ALPHABET.map((char, index) => [char, index]));
const ENCODED_RE = /^[0-9A-HJKMNP-TV-Z]{8}$/;
const LEGACY_RE = /^\d{8}$/;
const MAX_NONCE = 0xffffff;

export function normalizePairingCode(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim().toUpperCase();
  return text || null;
}

export function isLegacyPairingCode(value) {
  const text = normalizePairingCode(value);
  return text !== null && LEGACY_RE.test(text);
}

export function isEncodedPairingCode(value) {
  const text = normalizePairingCode(value);
  return text !== null && !LEGACY_RE.test(text) && ENCODED_RE.test(text);
}

function assertPort(port) {
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error(`INVALID_PORT: ${port} must be between 1024 and 65535`);
}

export function encodePairingCode(port, nonce) {
  assertPort(port);
  if (!Number.isSafeInteger(nonce) || nonce < 0 || nonce > MAX_NONCE) throw new Error(`INVALID_NONCE: ${nonce}`);
  let value = (BigInt(port) << 24n) | BigInt(nonce);
  let code = '';
  for (let index = 0; index < PAIRING_CODE_LENGTH; index++) {
    code = ALPHABET[Number(value & 31n)] + code;
    value >>= 5n;
  }
  return code;
}

export function decodePairingCode(input) {
  const code = normalizePairingCode(input);
  if (code === null || LEGACY_RE.test(code) || !ENCODED_RE.test(code)) return null;
  let value = 0n;
  for (const char of code) {
    const digit = INDEX.get(char);
    if (digit === undefined) return null;
    value = (value << 5n) | BigInt(digit);
  }
  const port = Number(value >> 24n);
  const nonce = Number(value & 0xffffffn);
  if (port < 1024 || port > 65535) return null;
  return { port, nonce };
}

// Exact eight digits are the legacy alias. An all-digit encoded candidate is
// still a valid internal value, but the generator never returns one.
export function classifyPairingCode(value) {
  const code = normalizePairingCode(value);
  if (code === null) return null;
  if (LEGACY_RE.test(code)) return { kind: 'legacy', code };
  const decoded = decodePairingCode(code);
  if (!decoded) return null;
  return { kind: 'encoded', code, port: decoded.port };
}

export function generatePairingCode(port, nextNonce) {
  assertPort(port);
  for (let attempt = 0; attempt < 64; attempt++) {
    const nonce = nextNonce();
    if (!Number.isSafeInteger(nonce) || nonce < 0 || nonce > MAX_NONCE) throw new Error(`INVALID_NONCE: ${nonce}`);
    const code = encodePairingCode(port, nonce);
    if (!LEGACY_RE.test(code)) return code;
  }
  throw new Error('PAIRING_CODE_GENERATION_FAILED: could not generate a code containing a letter');
}
