const $ = id => document.getElementById(id);
async function act(action, extra = {}) {
  $('error').textContent = '';
  try {
    const result = await chrome.runtime.sendMessage({ action, ...extra });
    if (!result?.ok) throw new Error(result?.error ?? '扩展没有响应，请重新打开。');
    $('status').textContent = result.connected ? '已连接到本机 Harness' : result.reconnecting ? '已配对，正在等待本机 Harness' : result.paired ? '已配对，点击连接即可' : '尚未配对';
    $('pair-label').textContent = result.paired ? '已保存配对：留空即可连接' : '首次连接：输入 Harness 给出的配对码';
    $('code').placeholder = result.paired ? '无需再次输入配对码' : '8 位配对码';
    $('status').classList.toggle('connected', result.connected);
    $('pair-form').hidden = result.connected;
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
