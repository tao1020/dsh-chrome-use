import { remote, parseStatus, parsePairing } from './settings-contract.js';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';

// The plugin is loaded from outside the Harness install, so it must not import
// @deepseek-ai/* host packages: they are not resolvable from the plugin folder.
// The settings service is therefore a plain object published through the Cordis
// reflection registry, plus the wire descriptors registered with ctx.typert.
const SERVICE = 'chromeUseStatus';

// Diagnostics are best effort: a missing or read-only state directory must never
// change what the settings page reports.
function reporter(stateDir) {
  const file = stateDir ? join(stateDir, 'settings.log') : undefined;
  return (phase, detail) => {
    if (!file) return;
    const text = detail instanceof Error ? `${detail.name}: ${detail.message}\n${detail.stack ?? ''}` : String(detail);
    appendFile(file, `${new Date().toISOString()} ${phase} ${text}\n`).catch(() => {});
  };
}

export function registerSettings(ctx, bridge) {
  const report = reporter(bridge.stateDir);
  const service = {
    async read() {
      try {
        const status = bridge.status();
        return parseStatus({ connected: status.connected, extensionVersion: status.extensionVersion, tabCount: status.claimedTabs.length });
      } catch (error) { report('read', error); throw error; }
    },
    async pair() {
      try {
        // A live Chrome connection blocks new pairing; the browser must disconnect first.
        return parsePairing(bridge.pair());
      } catch (error) { report('pair', error); throw error; }
    },
  };
  // The gateway validates this binding before every dispatch: service must be the
  // published instance, and the namespace must match the registered descriptors.
  service.typertRemote = Object.freeze({ service, serviceKey: SERVICE, namespace: SERVICE });
  try {
    const provide = ctx.reflect && typeof ctx.reflect.provide === 'function'
      ? ctx.reflect.provide.bind(ctx.reflect)
      : typeof ctx.provide === 'function' ? ctx.provide.bind(ctx) : undefined;
    if (!provide) throw new Error('this Cordis runtime exposes no service provider');
    provide(SERVICE, service);
    report('provide-ok', SERVICE);
  } catch (error) {
    report('provide', error);
  }
  ctx.inject(['typert'], (scope) => {
    try {
      scope.typert.register({ package: remote.package, face: 'host', schemas: [], model: { services: [], events: [], objects: [] }, invocations: remote.descriptors });
      report('register-ok', `${remote.descriptors.length} invocations: ${remote.descriptors.map(descriptor => descriptor.id).join(', ')}`);
    } catch (error) {
      report('register', error);
    }
  });
}
