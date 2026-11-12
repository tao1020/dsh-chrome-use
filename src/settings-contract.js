export function parseStatus(value) {
  if (!value || typeof value.connected !== 'boolean' || !Number.isSafeInteger(value.tabCount) || value.tabCount < 0 || !(value.extensionVersion === null || typeof value.extensionVersion === 'string')) throw new Error('Invalid Chrome connection status');
  const status = { connected: value.connected, tabCount: value.tabCount, extensionVersion: value.extensionVersion };
  for (const field of ['port', 'requestedPort']) {
    if (value[field] === undefined) continue;
    if (!Number.isSafeInteger(value[field]) || value[field] < 1024 || value[field] > 65535) throw new Error(`Invalid Chrome connection ${field}`);
    status[field] = value[field];
  }
  return status;
}
const PAIRING_CODE_RE = /^[0-9A-HJKMNP-TV-Z]{8}$/;
export function parsePairing(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid pairing response');
  if (typeof value.code !== 'string' || !/^[0-9]{8}$/.test(value.code)) throw new Error('Invalid pairing code');
  if (value.pairingCode !== undefined) {
    if (typeof value.pairingCode !== 'string' || !PAIRING_CODE_RE.test(value.pairingCode) || !/[A-Z]/.test(value.pairingCode)) throw new Error('Invalid pairing code');
  }
  if (!Number.isSafeInteger(value.port) || value.port < 1 || value.port > 65535) throw new Error('Invalid pairing port');
  if (!Number.isSafeInteger(value.expiresInSeconds) || value.expiresInSeconds < 1 || value.expiresInSeconds > 3600) throw new Error('Invalid pairing lifetime');
  if (typeof value.instructions !== 'string' || value.instructions.length > 2000) throw new Error('Invalid pairing instructions');
  return { code: value.code, ...(value.pairingCode === undefined ? {} : { pairingCode: value.pairingCode }), port: value.port, expiresInSeconds: value.expiresInSeconds, instructions: value.instructions };
}
const statusCodec = { mode: 'strict', typeSymbol: 'dsh-chrome-use#ConnectionStatus', schema: { parse: parseStatus }, create: () => ({ parse: parseStatus }) };
const pairingCodec = { mode: 'strict', typeSymbol: 'dsh-chrome-use#PairingCode', schema: { parse: parsePairing }, create: () => ({ parse: parsePairing }) };
export const remote = {
  package: 'dsh-chrome-use',
  descriptors: [
    { id: 'dsh-chrome-use#chromeUseStatus/read', service: 'chromeUseStatus', namespace: 'chromeUseStatus', method: 'read', invocation: { kind: 'direct' }, parameters: [], result: statusCodec },
    { id: 'dsh-chrome-use#chromeUseStatus/pair', service: 'chromeUseStatus', namespace: 'chromeUseStatus', method: 'pair', invocation: { kind: 'direct' }, parameters: [], result: pairingCodec },
  ],
};
