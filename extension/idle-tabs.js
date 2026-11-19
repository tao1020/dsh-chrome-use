// Tabs opened by an agent are useful while the task runs, but they outlive the
// debugger session. Keep a small activity record in session storage so a
// service-worker restart does not lose the idle timer.
export const IDLE_CLOSE_SECONDS = 30 * 60;
export const MAX_IDLE_CLOSE_SECONDS = 600 * 60;
export const IDLE_CLOSE_MS = IDLE_CLOSE_SECONDS * 1000;
export const IDLE_ALARM = 'idle-tabs';
export const IDLE_CHECK_MINUTES = 1;
export const IDLE_SETTING = 'autoCloseIdleTabs';
export const IDLE_TIMEOUT_SETTING = 'idleCloseSeconds';
export const IDLE_STORAGE_KEY = 'openedTabActivity';

const isPort = value => Number.isSafeInteger(value) && value >= 1024 && value <= 65535;
const isTabId = value => Number.isSafeInteger(value) && value >= 0;
const isTimestamp = value => Number.isFinite(value) && value > 0;

function normalize(value) {
  const rows = Array.isArray(value) ? value : [];
  const byTab = new Map();
  for (const row of rows) {
    if (!row || !isTabId(row.tabId) || !isPort(row.port) || !isTimestamp(row.lastActivityAt)) continue;
    const previous = byTab.get(row.tabId);
    if (!previous || row.lastActivityAt > previous.lastActivityAt) byTab.set(row.tabId, { tabId: row.tabId, port: row.port, lastActivityAt: row.lastActivityAt });
  }
  return [...byTab.values()];
}

export function createIdleTabs(storage, { now = Date.now } = {}) {
  let queue = Promise.resolve();
  const run = operation => {
    const next = queue.then(operation, operation);
    queue = next.then(() => {}, () => {});
    return next;
  };
  const read = async () => {
    const stored = await storage.get(IDLE_STORAGE_KEY);
    return normalize(stored?.[IDLE_STORAGE_KEY]);
  };
  const write = rows => storage.set({ [IDLE_STORAGE_KEY]: rows });

  return {
    note(port, tabId) {
      return run(async () => {
        const rows = await read();
        const at = now();
        const existing = rows.find(row => row.tabId === tabId);
        if (existing) { existing.port = port; existing.lastActivityAt = at; }
        else rows.push({ tabId, port, lastActivityAt: at });
        await write(rows);
      });
    },
    touch(tabId) {
      return run(async () => {
        const rows = await read();
        const existing = rows.find(row => row.tabId === tabId);
        if (!existing) return false;
        existing.lastActivityAt = now();
        await write(rows);
        return true;
      });
    },
    forget(tabId) {
      return run(async () => {
        const rows = await read();
        const kept = rows.filter(row => row.tabId !== tabId);
        if (kept.length === rows.length) return false;
        await write(kept);
        return true;
      });
    },
    due(timeoutMs = IDLE_CLOSE_MS) {
      return run(async () => {
        const rows = await read();
        const at = now();
        return rows.filter(row => at - row.lastActivityAt >= timeoutMs);
      });
    },
    count() {
      return run(async () => (await read()).length);
    },
  };
}
