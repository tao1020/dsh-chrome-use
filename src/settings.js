import { remote, parseStatus, parsePairing } from './settings-contract.js';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';

// Diagnostics are best effort: a missing or read-only state directory must never
// change what the settings page reports.
function reporter(stateDir) {
  const file = stateDir ? join(stateDir, 'settings.log') : undefined;
  return (phase, error) => {
    if (!file) return;
    const detail = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error);
    appendFile(file, `${new Date().toISOString()} ${phase} ${detail}\n`).catch(() => {});
  };
}

export function registerSettings(ctx, bridge) {
  const report = reporter(bridge.stateDir);
  ctx.inject(['typert'], async (scope) => {
    const { TypertRemoteService } = await import('@deepseek-ai/dsh-typert-protocol');
    class ChromeUseStatus extends TypertRemoteService {
      constructor(child) { super(child, 'chromeUseStatus'); }
      async read() {
        try {
          const status = bridge.status();
          return parseStatus({ connected: status.connected, extensionVersion: status.extensionVersion, tabCount: status.claimedTabs.length });
        } catch (error) { report('read', error); throw error; }
      }
      async pair() {
        try {
          // A live Chrome connection blocks new pairing; the browser must disconnect first.
          return parsePairing(bridge.pair());
        } catch (error) { report('pair', error); throw error; }
      }
    }
    try {
      scope.plugin(ChromeUseStatus);
      scope.effect(() => scope.typert.register({ package: remote.package, face: 'host', schemas: [], model: { services: [], events: [], objects: [] }, invocations: remote.descriptors }));
      report('register-ok', `${remote.descriptors.length} invocations: ${remote.descriptors.map(descriptor => descriptor.id).join(', ')}`);
    } catch (error) {
      report('register', error);
      throw error;
    }
  });
}
