import { popupState } from './popup-state.js';

const $ = id => document.getElementById(id);
async function act(action, extra = {}) {
  $('error').textContent = '';
  try {
    const result = await chrome.runtime.sendMessage({ action, ...extra });
    if (!result?.ok) throw new Error(result?.error ?? '扩展没有响应，请重新打开。');
    $('status').textContent = result.connected ? '已连接到本机 Harness' : result.reconnecting ? '已配对，正在等待本机 Harness' : result.paired ? '已配对，点击连接即可' : '尚未配对';
    $('status').classList.toggle('connected', result.connected);
    const show = popupState(result);
    $('pair-form').hidden = show.formHidden;
    $('pair-label').hidden = show.labelHidden;
    $('code').hidden = show.codeHidden;
    $('permission-help').hidden = show.permissionHidden;
    $('pair-help').hidden = show.helpHidden;
    $('paired-hint').hidden = show.pairedHintHidden;
    $('tabs').replaceChildren();
    for (const tab of result.tabs.length ? result.tabs : [{ title: '当前没有调试中的标签页' }]) {
      const li = document.createElement('li');
      li.textContent = `${tab.attached ? '正在调试 · ' : ''}${tab.title || `标签页 ${tab.id}`}`;
      $('tabs').append(li);
    }
    if (result.error && !result.connected) $('error').textContent = result.error;
  } catch (error) { $('error').textContent = error.message; }
}
$('pair-form').addEventListener('submit', async event => { event.preventDefault(); await act('connect', { code: $('code').value }); $('code').value = ''; });
$('disconnect').addEventListener('click', () => act('disconnect'));
act('status');
