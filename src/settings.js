import { remote, parseStatus, parsePairing, parseTabs, TAB_LIST_LIMIT } from './settings-contract.js';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';

// The plugin is loaded from outside the Harness install, so it must not import
// @deepseek-ai/* host packages: they are not resolvable from the plugin folder.
// The settings service is therefore a plain object published through the Cordis
// reflection registry, plus the wire descriptors registered with ctx.typert.
const SERVICE = 'chromeUseStatus';

// Listing tabs for the @ menu is a read-only bridge call, but the bridge still
// wants an owner id. This synthetic one never claims anything: the `tabs`
// command carries no tabId, so no lease can be taken from a real chat.
const MENTION_OWNER = 'dsh-chrome-use/mention';
const MENTION_TIMEOUT_MS = 5000;

// The @ menu shows this verbatim next to the empty list, so translate the
// states a user can act on instead of echoing a tool error code.
function tabListReason(error) {
  if (error?.name === 'AbortError') return '读取标签页超时，请稍后再试';
  const message = String(error?.message ?? error);
  if (message.startsWith('BROWSER_BUSY')) return '浏览器正在执行另一条命令，稍等一下再打开 @ 菜单';
  if (message.startsWith('BROWSER_NOT_CONNECTED')) return 'Chrome 扩展刚刚断开，请在设置页重新配对';
  if (message.startsWith('BRIDGE_STOPPED')) return 'Harness 插件已停止，请重启 Harness';
  return message.slice(0, 300);
}

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
        return parseStatus({ connected: status.connected, port: status.port, ...(status.requestedPort === undefined ? {} : { requestedPort: status.requestedPort }), extensionVersion: status.extensionVersion, tabCount: status.claimedTabs.length });
      } catch (error) { report('read', error); throw error; }
    },
    async pair() {
      try {
        // A live Chrome connection blocks new pairing; the browser must disconnect first.
        return parsePairing(bridge.pair());
      } catch (error) { report('pair', error); throw error; }
    },
    async list() {
      // Never throws: the @ menu falls back to a one-line hint, and a failed
      // listing must not interrupt typing.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), MENTION_TIMEOUT_MS);
      try {
        if (!bridge.status().connected) return parseTabs({ connected: false, tabs: [], reason: 'Chrome 扩展没有连接' });
        const result = await bridge.call('tabs', {}, MENTION_OWNER, controller.signal);
        // A profile with hundreds of tabs must not turn into an error row: the
        // menu only ever renders the first fifty matches anyway.
        const tabs = Array.isArray(result?.tabs) ? result.tabs.slice(0, TAB_LIST_LIMIT) : [];
        return parseTabs({ connected: true, tabs, reason: null });
      } catch (error) {
        report('list', error);
        const reason = tabListReason(error).slice(0, 300);
        return parseTabs({ connected: bridge.status().connected === true, tabs: [], reason });
      } finally { clearTimeout(timer); }
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
