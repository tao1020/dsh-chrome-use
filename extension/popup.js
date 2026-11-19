import { popupState } from './popup-state.js';
import { IDLE_CLOSE_SECONDS, MAX_IDLE_CLOSE_SECONDS, IDLE_TIMEOUT_SETTING } from './idle-tabs.js';

const $ = id => document.getElementById(id);
function connectionItem(row) {
  const li = document.createElement('li');
  li.className = `conn ${row.state}`;
  const info = document.createElement('div');
  info.className = 'conn-info';
  const title = document.createElement('span');
  title.className = 'conn-title';
  title.textContent = row.title;
  const meta = document.createElement('span');
  meta.className = 'conn-meta';
  meta.textContent = row.meta;
  info.append(title);
  let detail;
  if (row.error) {
    // The full reason lives behind the icon: a long browser error in the row
    // wraps and makes every card unreadable.
    const icon = document.createElement('button');
    icon.type = 'button';
    icon.className = 'conn-warn';
    icon.textContent = '!';
    icon.title = row.error;
    icon.setAttribute('aria-label', `连接问题：${row.error}`);
    detail = document.createElement('p');
    detail.className = 'conn-error';
    detail.textContent = `${row.error} ${row.hint}`;
    detail.hidden = true;
    icon.addEventListener('click', () => { detail.hidden = !detail.hidden; });
    meta.append(icon);
    info.append(meta);
  } else {
    info.append(meta);
  }
  const actions = document.createElement('span');
  actions.className = 'conn-actions';
  if (row.canConnect) {
    const connect = document.createElement('button');
    connect.type = 'button';
    connect.className = 'link';
    connect.textContent = '连接';
    connect.addEventListener('click', () => act('connect', { port: row.port }));
    actions.append(connect);
  }
  if (row.canForget) {
    const forget = document.createElement('button');
    forget.type = 'button';
    forget.className = 'link';
    forget.textContent = '忘记';
    forget.addEventListener('click', () => act('forget', { port: row.port }));
    actions.append(forget);
  }
  li.append(info, actions);
  if (detail) li.append(detail);
  return li;
}
async function act(action, extra = {}) {
  $('error').textContent = '';
  try {
    const result = await chrome.runtime.sendMessage({ action, ...extra });
    if (!result?.ok) throw new Error(result?.error ?? '扩展没有响应，请重新打开。');
    const show = popupState(result);
    $('status').textContent = show.statusText;
    $('status').classList.toggle('connected', show.connected);
    $('connections').replaceChildren(...show.connections.map(connectionItem));
    $('tabs').replaceChildren();
    for (const tab of result.tabs.length ? result.tabs : [{ title: '当前没有调试中的标签页' }]) {
      const li = document.createElement('li');
      li.textContent = `${tab.attached ? '正在调试 · ' : ''}${tab.title || `标签页 ${tab.id}`}`;
      $('tabs').append(li);
    }
    if (result.error && !result.connected) $('error').textContent = result.error;
    return result;
  } catch (error) {
    $('error').textContent = error.message;
    return undefined;
  }
}
const foreground = $('foreground');
chrome.storage.local.get('foregroundMode').then(
  ({ foregroundMode }) => { foreground.checked = foregroundMode !== false; },
  () => {}, // Keep the default (foreground on) when settings cannot be read.
);
foreground.addEventListener('change', () => { chrome.storage.local.set({ foregroundMode: foreground.checked }); });
const forceClose = $('force-close');
chrome.storage.local.get('forceCloseBeforeUnload').then(
  ({ forceCloseBeforeUnload }) => { forceClose.checked = forceCloseBeforeUnload !== false; },
  () => {}, // Keep the default (forced close on) when settings cannot be read.
);
forceClose.addEventListener('change', () => { chrome.storage.local.set({ forceCloseBeforeUnload: forceClose.checked }); });
const idleClose = $('idle-close');
const idleMinutes = $('idle-minutes');
const idleSeconds = $('idle-seconds');
const idleError = $('idle-error');
function showIdleTimeout(seconds) {
  const total = Number.isInteger(seconds) && seconds >= 1 && seconds <= MAX_IDLE_CLOSE_SECONDS ? seconds : IDLE_CLOSE_SECONDS;
  idleMinutes.value = String(Math.floor(total / 60));
  idleSeconds.value = String(total % 60);
}
function readIdleTimeout() {
  const minutes = Number(idleMinutes.value);
  const seconds = Number(idleSeconds.value);
  if (!Number.isInteger(minutes) || !Number.isInteger(seconds) || minutes < 0 || minutes > 600 || seconds < 0 || seconds > 59) return null;
  const total = minutes * 60 + seconds;
  return total >= 1 && total <= MAX_IDLE_CLOSE_SECONDS ? total : null;
}
function saveIdleTimeout() {
  const total = readIdleTimeout();
  if (total === null) {
    idleError.textContent = '请输入 1 秒到 600 分钟之间的时间。';
    return;
  }
  idleError.textContent = '';
  chrome.storage.local.set({ [IDLE_TIMEOUT_SETTING]: total });
}
chrome.storage.local.get(IDLE_TIMEOUT_SETTING).then(
  ({ [IDLE_TIMEOUT_SETTING]: stored }) => { showIdleTimeout(Number(stored)); },
  () => { showIdleTimeout(IDLE_CLOSE_SECONDS); },
);
for (const input of [idleMinutes, idleSeconds]) input.addEventListener('change', saveIdleTimeout);
chrome.storage.local.get('autoCloseIdleTabs').then(
  ({ autoCloseIdleTabs }) => { idleClose.checked = autoCloseIdleTabs === true; },
  () => {}, // Keep the default (idle cleanup off) when settings cannot be read.
);
idleClose.addEventListener('change', () => { chrome.storage.local.set({ autoCloseIdleTabs: idleClose.checked }); });
$('pair-form').addEventListener('submit', async event => {
  event.preventDefault();
  const result = await act('connect', { code: $('code').value });
  if (result) $('code').value = '';
});
$('disconnect').addEventListener('click', () => act('disconnect'));
act('status');
