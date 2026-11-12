import { popupState } from './popup-state.js';

const $ = id => document.getElementById(id);
async function act(action, extra = {}) {
  $('error').textContent = '';
  try {
    const result = await chrome.runtime.sendMessage({ action, ...extra });
    if (!result?.ok) throw new Error(result?.error ?? '扩展没有响应，请重新打开。');
    const show = popupState(result);
    $('status').textContent = show.statusText;
    $('status').classList.toggle('connected', show.connected);
    $('connections').replaceChildren();
    for (const row of show.connections) {
      const li = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = row.text;
      li.append(label);
      const buttons = document.createElement('span');
      if (row.canConnect) {
        const connect = document.createElement('button');
        connect.type = 'button';
        connect.className = 'link';
        connect.textContent = '连接';
        connect.addEventListener('click', () => act('connect', { port: row.port }));
        buttons.append(connect);
      }
      if (row.canForget) {
        const forget = document.createElement('button');
        forget.type = 'button';
        forget.className = 'link';
        forget.textContent = '忘记';
        forget.addEventListener('click', () => act('forget', { port: row.port }));
        buttons.append(forget);
      }
      li.append(buttons);
      $('connections').append(li);
    }
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
