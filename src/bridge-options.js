import { normalizeServerHost } from '../extension/host.js';
import { parsePort } from '../extension/protocol.js';

// Environment contract for the bridge. Kept out of the plugin entry so the
// standalone runner can use the same rules without loading the Cordis plugin.
export function bridgeOptions(env, baseStateDir) {
  const configured = env?.DSH_CHROME_USE_PORT?.trim();
  const options = configured ? { port: parsePort(configured), baseStateDir } : { auto: true, baseStateDir };
  const name = env?.DSH_CHROME_USE_NAME?.trim().slice(0, 40);
  const bindHost = env?.DSH_CHROME_USE_BIND_HOST?.trim();
  const withHost = bindHost ? { ...options, bindHost: normalizeServerHost(bindHost) } : options;
  // Auto mode probes candidate ports on loopback, so it cannot describe a
  // network address; require an explicit port instead of guessing.
  if (bindHost && !configured) throw new Error('DSH_CHROME_USE_BIND_HOST needs DSH_CHROME_USE_PORT; automatic port selection only probes 127.0.0.1');
  return name ? { ...withHost, name } : withHost;
}
