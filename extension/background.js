import { BrowserController } from './controller.js';
import { PORT, MAX_MESSAGE, PARALLEL_TABS } from './protocol.js';

let socket;
let connected = false;
let connecting;
let connectionGeneration = 0;
const running = new Map();
// These actions make their tab the current tab of its window, and Chrome only
// delivers synthesized input to the current tab. Queue them across tabs so two
// commands cannot switch the same window underneath each other. They do not
// touch window focus, so the user keeps typing in whichever app is in front.
const inputActions = new Set(['activate', 'close', 'click', 'fill', 'key', 'hover', 'select', 'upload', 'drag', 'scroll_to', 'scroll']);
const inputQueue = [];
let inputBusy = false;
function acquireInput(signal) {
  // A command can now be canceled while the mode is read, so keep one stable
  // error code instead of the DOMException throwIfAborted would use.
  if (signal.aborted) throw new Error('COMMAND_CANCELED');
  return new Promise((resolve, reject) => {
    const start = () => {
      signal.removeEventListener('abort', abort);
      inputBusy = true;
      resolve(() => {
        const next = inputQueue.shift();
        if (next) next(); else inputBusy = false;
      });
    };
    const abort = () => {
      const index = inputQueue.indexOf(start);
      if (index >= 0) inputQueue.splice(index, 1);
      reject(new Error('COMMAND_CANCELED'));
    };
    if (inputBusy) {
      inputQueue.push(start);
      signal.addEventListener('abort', abort, { once: true });
    } else start();
  });
}
// Foreground mode is the default, matching the popup and the extension before
// 0.6.3. Reading it per command keeps a popup change effective immediately.
async function applyMode() {
  const { foregroundMode } = await chrome.storage.local.get('foregroundMode');
  controller.foregroundMode = foregroundMode !== false;
}
let lastError = '';
const controller = new BrowserController(chrome, (tabId, reason) => {
  // Carry Chrome's detach reason so the host can explain a dropped tab instead
  // of only reporting that the claim disappeared.
  if (connected && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'detached', tabId, ...(reason ? { reason: String(reason).slice(0, 40) } : {}) }));
});
const badge = text => { chrome.action.setBadgeText({ text }); chrome.action.setBadgeBackgroundColor({ color: '#185adb' }); };

let resetting = Promise.resolve();
function drainController() {
  const tasks = [...running.values()];
  for (const task of tasks) task.cancellation.abort();
  resetting = resetting.then(async () => {
    await Promise.all(tasks.map(task => task.done));
    await controller.reset();
  });
  return resetting;
}

async function disconnect(forget = false) {
  connectionGeneration++;
  connected = false;
  const client = socket;
  socket = undefined;
  client?.close();
  await drainController();
  if (forget) await chrome.storage.local.remove('token');
  await chrome.storage.local.set({ enabled: false });
  await chrome.alarms.clear('reconnect');
  badge('');
}

async function connect(code) {
  if (connected) return;
  if (connecting) return connecting;
  const generation = connectionGeneration;
  connecting = (async () => {
    const { token } = await chrome.storage.local.get('token');
    if (!code && !token) throw new Error('Ask Harness for a pairing code first.');
    await resetting;
    await controller.reset();
    if (generation !== connectionGeneration) throw new Error('COMMAND_CANCELED: connection was canceled');
    const client = new WebSocket(`ws://127.0.0.1:${PORT}/bridge`);
    socket = client;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { client.close(); reject(new Error('Connection timed out. Check that the Harness plugin is running.')); }, 6000);
      client.onopen = () => client.send(JSON.stringify({ ...(code ? { type: 'pair', code } : { type: 'auth', token }), version: chrome.runtime.getManifest().version, features: [PARALLEL_TABS] }));
      client.onmessage = async event => {
        if (socket !== client) return;
        try {
          if (typeof event.data !== 'string' || event.data.length > MAX_MESSAGE) throw new Error('Invalid bridge message');
          const message = JSON.parse(event.data);
          if (message.type === 'ready') {
            if (message.protocol !== 1 || !/^[a-f0-9]{64}$/.test(message.token)) throw new Error('Unsupported bridge protocol');
            await chrome.storage.local.set({ token: message.token, enabled: true });
            if (socket !== client || client.readyState !== WebSocket.OPEN) return;
            connected = true;
            lastError = '';
            clearTimeout(timer);
            await chrome.alarms.create('reconnect', { periodInMinutes: 0.5 });
            badge('ON');
            resolve();
          } else if (message.type === 'error') {
            lastError = String(message.error).slice(0, 2000);
            reject(new Error(lastError));
          } else if (message.type === 'command' && connected) {
            if (typeof message.id !== 'string' || !Number.isFinite(message.deadline) || message.deadline <= Date.now() || message.deadline > Date.now() + 20000) throw new Error('Invalid command deadline');
            const tabId = Number.isSafeInteger(message.args?.tabId) ? message.args.tabId : undefined;
            if (running.has(message.id)) {
              if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: 'result', id: message.id, error: 'DUPLICATE_COMMAND_ID' }));
              return;
            }
            if (tabId !== undefined && [...running.values()].some(task => task.tabId === tabId)) {
              if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: 'result', id: message.id, error: 'TAB_BUSY: another command is already running on this tab' }));
              return;
            }
            const cancellation = new AbortController();
            let finish;
            const done = new Promise(resolve => { finish = resolve; });
            running.set(message.id, { cancellation, tabId, done });
            const deadline = setTimeout(() => cancellation.abort(), message.deadline - Date.now());
            let response;
            let releaseInput;
            try {
              if (inputActions.has(message.action)) {
                // A settings read failure keeps the last known mode rather than
                // failing the action; lastError still surfaces it in the popup.
                try { await applyMode(); }
                catch (error) { lastError = error.message; }
                releaseInput = await acquireInput(cancellation.signal);
              }
              response = { result: await controller.execute(message.action, message.args, cancellation.signal) };
            }
            catch (error) { response = { error: String(error.message).slice(0, 2000) }; }
            finally {
              clearTimeout(deadline);
              // Keep both locks through cleanup. The result acknowledges that it
              // is safe for the bridge to hand this tab to the next command.
              try {
                if (tabId !== undefined && (cancellation.signal.aborted || controller.pendingCleanup.has(tabId))) await controller.detachTab(tabId);
              } finally {
                running.delete(message.id);
                releaseInput?.();
                finish();
              }
            }
            if (socket === client && client.readyState === WebSocket.OPEN) {
              const body = JSON.stringify({ type: 'result', id: message.id, ...response });
              client.send(body.length <= MAX_MESSAGE ? body : JSON.stringify({ type: 'result', id: message.id, error: 'RESULT_TOO_LARGE' }));
            }
          } else if (message.type === 'cancel') {
            const task = typeof message.id === 'string' ? running.get(message.id) : undefined;
            task?.cancellation.abort();
          }
        } catch (error) {
          lastError = String(error.message);
          client.close();
          reject(error);
        }
      };
      client.onerror = () => { lastError = 'Cannot reach Harness on this computer. Start Harness with dsh-chrome-use installed.'; };
      client.onclose = () => {
        clearTimeout(timer);
        if (socket === client) {
          connected = false;
          socket = undefined;
          drainController().catch(error => { lastError = error.message; });
          badge('');
        }
        reject(new Error(lastError || 'Connection closed. Reconnect to continue.'));
      };
    });
  })();
  try { await connecting; } finally { connecting = undefined; }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('popup.html')) return false;
  (async () => {
    if (message.action === 'connect') {
      const code = String(message.code ?? '').trim();
      if (code && !/^\d{8}$/.test(code)) throw new Error('Enter the 8-digit code from Harness.');
      await connect(code || undefined);
    } else if (message.action === 'disconnect') await disconnect();
    else if (message.action !== 'status') throw new Error('Unknown action');
    const { token, enabled } = await chrome.storage.local.get(['token', 'enabled']);
    return { connected, paired: Boolean(token), reconnecting: Boolean(enabled) && !connected, error: lastError, tabs: (await chrome.tabs.query({})).filter(tab => controller.attached.has(tab.id)).map(tab => ({ id: tab.id, title: tab.title, attached: true })) };
  })().then(result => respond({ ok: true, ...result }), error => respond({ ok: false, error: error.message }));
  return true;
});

async function restoreConnection() {
  if (connected || connecting) return;
  const { enabled } = await chrome.storage.local.get('enabled');
  if (enabled) {
    // Keep retrying if Harness is started after Chrome or the extension is reloaded.
    await chrome.alarms.create('reconnect', { periodInMinutes: 0.5 });
    await connect().catch(error => { lastError = error.message; });
  }
}
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'reconnect') restoreConnection().catch(error => { lastError = error.message; });
});
chrome.runtime.onStartup.addListener(() => restoreConnection().catch(error => { lastError = error.message; }));
restoreConnection().catch(error => { lastError = error.message; });
