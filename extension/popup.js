import { popupState } from './popup-state.js';

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
$('pair-form').addEventListener('submit', async event => {
  event.preventDefault();
  const result = await act('connect', { code: $('code').value });
  if (result) $('code').value = '';
});
$('disconnect').addEventListener('click', () => act('disconnect'));
act('status');
