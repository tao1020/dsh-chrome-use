import { remote, parseStatus, parsePairing } from './settings-contract.js';
export function registerSettings(ctx, bridge) {
  ctx.inject(['typert'], async (scope) => {
    const { TypertRemoteService } = await import('@deepseek-ai/dsh-typert-protocol');
    class ChromeUseStatus extends TypertRemoteService {
      constructor(child) { super(child, 'chromeUseStatus'); }
      async read() {
        const status = bridge.status();
        return parseStatus({ connected: status.connected, extensionVersion: status.extensionVersion, tabCount: status.claimedTabs.length });
      }
      async pair() {
        // A live Chrome connection blocks new pairing; the browser must disconnect first.
        return parsePairing(bridge.pair());
      }
    }
    scope.plugin(ChromeUseStatus);
    scope.effect(() => scope.typert.register({ package: remote.package, face: 'host', schemas: [], model: { services: [], events: [], objects: [] }, invocations: remote.descriptors }));
  });
}
