// Where the extension may connect. The default stays loopback; the opt-in
// advanced setting accepts loopback and private addresses only. A hostname is
// rejected on purpose: it can resolve to anything, and this value decides where
// page content, screenshots and cookies travel.
export const DEFAULT_HOST = '127.0.0.1';

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function ipv4Octets(text) {
  const match = IPV4.exec(text);
  if (!match) return undefined;
  // Chrome's URL parser reads a leading zero as octal, so "010.0.0.1" dials
  // 8.0.0.1. Refuse those spellings instead of guessing which base was meant.
  if (match.slice(1).some(part => part.length > 1 && part.startsWith('0'))) return undefined;
  const octets = match.slice(1).map(Number);
  return octets.every(octet => octet <= 255) ? octets : undefined;
}

function ipv4Allowed([a, b]) {
  if (a === 127) return true; // loopback
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // link-local
  return false;
}

// Only the low 16 bits matter for the prefixes we allow, so parsing the text
// form is enough and avoids pulling in a full IPv6 parser.
function ipv6Allowed(lower) {
  if (lower === '::1') return true;
  const first = lower.split(':')[0];
  if (!/^[0-9a-f]{1,4}$/.test(first)) return false;
  const value = parseInt(first, 16);
  if ((value & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((value & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
  return false;
}

/**
 * Returns the canonical host to dial, or throws an Error with a readable
 * message. Empty input means the default.
 */
export function normalizeServerHost(value) {
  const text = String(value ?? '').trim();
  if (!text) return DEFAULT_HOST;
  if (text.toLowerCase() === 'localhost') return 'localhost';
  // The popup has no port field, so a pasted "host:port" is a likely mistake.
  if (text.includes(':') && text.includes('.') && !text.includes('::')) {
    throw new Error('Enter only the host, without a port');
  }
  const unbracketed = text.startsWith('[') && text.endsWith(']') ? text.slice(1, -1) : text;
  const shaped = IPV4.exec(unbracketed);
  if (shaped && shaped.slice(1).some(part => part.length > 1 && part.startsWith('0'))) {
    const canonical = shaped.slice(1).map(part => String(Number(part))).join('.');
    throw new Error(`Leading zeros are not allowed; write ${canonical} instead of ${unbracketed}`);
  }
  const octets = ipv4Octets(unbracketed);
  if (octets) {
    if (!ipv4Allowed(octets)) throw new Error(`${unbracketed} is not a loopback or private address`);
    // Return the canonical dotted form: the validator and the browser must agree
    // on which machine this is.
    return octets.join('.');
  }
  const lower = unbracketed.toLowerCase();
  if (lower.includes(':')) {
    // Parse through the URL parser so a malformed address (fd00::zz, a zone id)
    // is refused here rather than failing later as an unusable WebSocket URL.
    let parsed = '';
    try {
      parsed = new URL(`ws://[${lower}]/`).hostname;
    } catch {
      throw new Error(`${unbracketed} is not a valid IPv6 address`);
    }
    // The parser returns the compressed lowercase form, so the same machine
    // always compares equal to itself.
    const canonical = parsed.startsWith('[') && parsed.endsWith(']') ? parsed.slice(1, -1) : parsed;
    if (!ipv6Allowed(canonical)) throw new Error(`${unbracketed} is not a loopback or private IPv6 address`);
    return canonical;
  }
  throw new Error(`Use 127.0.0.1, a private IP such as 192.168.1.20, or a private IPv6 address; hostnames are not accepted`);
}

/** WebSocket URL for a host and port, bracketing bare IPv6 addresses. */
export function bridgeUrl(host, port) {
  const normalized = normalizeServerHost(host);
  const address = normalized.includes(':') ? `[${normalized}]` : normalized;
  return `ws://${address}:${port}/bridge`;
}
