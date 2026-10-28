// Manual smoke runner, independent of a model/API key. Input is newline-delimited JSON.
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Bridge } from '../src/bridge.js';
import { validateArgs } from '../extension/protocol.js';
const bridge = new Bridge({ stateDir: join(homedir(), '.dsh', 'dsh-chrome-use') });
await bridge.start();
console.log(JSON.stringify({ status: bridge.status(), instructions: 'Saved pairing reconnects automatically. For first-time pairing, enter {"action":"pair"}.' }));
let stopped = false;
async function stop() { if (!stopped) { stopped = true; await bridge.stop(); process.exit(0); } }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
const lines = createInterface({ input: process.stdin });
try {
  for await (const line of lines) {
    try {
      const { action, args = {}, owner = 'smoke-test' } = JSON.parse(line);
      validateArgs(`chrome_${action}`, args);
      const result = action === 'status' ? bridge.status() : action === 'pair' ? bridge.pair() : await bridge.call(action, args, owner);
      console.log(JSON.stringify({ action, result }));
    } catch (error) { console.log(JSON.stringify({ error: error.message })); }
  }
} finally { await stop(); }
