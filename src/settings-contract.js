export function parseStatus(value) {
  if (!value || typeof value.connected !== 'boolean' || !Number.isSafeInteger(value.tabCount) || value.tabCount < 0 || !(value.extensionVersion === null || typeof value.extensionVersion === 'string')) throw new Error('Invalid Chrome connection status');
  return { connected: value.connected, tabCount: value.tabCount, extensionVersion: value.extensionVersion };
}
const codec = { mode: 'strict', typeSymbol: 'dsh-chrome-use#ConnectionStatus', schema: { parse: parseStatus }, create: () => ({ parse: parseStatus }) };
export const remote = { package: 'dsh-chrome-use', descriptors: [{ id: 'dsh-chrome-use#chromeUseStatus/read', service: 'chromeUseStatus', namespace: 'chromeUseStatus', method: 'read', invocation: { kind: 'direct' }, parameters: [], result: codec }] };
