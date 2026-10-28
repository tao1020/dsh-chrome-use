// Wrapped by scripts/build-client.mjs for the Harness browser module loader.
const React = require('react');
const { createElement: h, useState, useEffect, useRef } = React;
function StatusPage({ read }) {
  const [state, setState] = useState({ loading: true });
  const [update, setUpdate] = useState({});
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function checkUpdates() {
    setUpdate({ loading: true });
    try { const result = await checkRelease(packageVersion); if (alive.current) setUpdate(result); }
    catch (error) { if (alive.current) setUpdate({ message: error.message }); }
  }
  const link = (url, text) => h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, text);
  const generation = useRef(0);
  async function refresh() {
    const id = ++generation.current;
    setState({ loading: true });
    let timer;
    try {
      const result = await Promise.race([read(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('查询超时，请确认 Harness 服务正常后重试。')), 5000); })]);
      if (!result.ok) throw new Error('无法读取连接状态，请稍后重试。');
      if (id === generation.current) setState({ value: parseStatus(result.value) });
    } catch (error) {
      if (id === generation.current) setState({ error: error.message });
    } finally { clearTimeout(timer); }
  }
  useEffect(() => { refresh(); return () => { generation.current++; }; }, [read]);
  const value = state.value;
  return h('section', { style: { padding: 24 }, 'aria-label': 'dsh-chrome-use' },
    h('h2', null, 'dsh-chrome-use'),
    h('p', null, `Harness 插件版本：${packageVersion}`),
    h('h3', null, '安装 Chrome 扩展'),
    h('ol', null,
      h('li', null, link('https://github.com/tao1020/dsh-chrome-use', '打开代码仓库'), '，点击 Code → Download ZIP，下载后解压。'),
      h('li', null, '在 Chrome 地址栏输入 chrome://extensions，开启右上角“开发者模式”。'),
      h('li', null, '点击“加载已解压的扩展程序”，选择解压目录里的 extension 文件夹。'),
      h('li', null, '点击 Chrome 右上角拼图 → dsh-chrome-use。让 Harness 获取配对码，输入后连接；首次配对后会自动重连。')),
    h('h3', null, '版本更新'),
    h('button', { onClick: checkUpdates, disabled: update.loading }, update.loading ? '正在检查…' : '检查更新'),
    h('p', { role: 'status' }, update.message || '点击后从 GitHub 查询最新正式 Release，仅发送版本查询请求。'),
    link(releasesUrl, '下载新版 / 查看发布记录'),
    h('p', null, 'Chrome 扩展更新：下载新版扩展 ZIP，解压并替换原 extension 文件夹，再到 chrome://extensions 点击扩展卡片上的刷新按钮。不要删除原文件夹。'),
    h('p', null, 'Harness 插件与 Chrome 扩展分别更新。此处检查的是 Harness 插件版本；Chrome 已连接版本显示在下方。Harness 插件请通过其插件管理入口更新。'),
    h('h3', null, '连接状态'),
    h('p', { role: 'status' }, state.loading ? '正在查询 Chrome 连接…' : state.error || (value.connected ? '已连接 Chrome' : '未连接 Chrome')),
    value && h('p', null, `扩展版本：${value.extensionVersion || '未知'} · 正在调试的标签页：${value.tabCount}`),
    value && !value.connected && h('p', null, '请打开 Chrome 中的 dsh-chrome-use 扩展并连接。首次使用时，让 Harness 调用 chrome_pair 获取配对码。'),
    h('button', { onClick: refresh, disabled: state.loading }, '刷新状态'),
    h('p', null, '此处显示查询时的浏览器连接状态。“插件运行中”只表示 Harness 插件已启动。'));
}
module.exports.inject = ['slots', 'remote'];
module.exports.apply = function(ctx) {
  ctx.effect(async () => await ctx.remote.$mount(remote));
  ctx.inject(['remote.chromeUseStatus'], (scope) => {
    const read = () => scope.remote.chromeUseStatus.read();
    scope.slots.inject('settings.section', () => scope.slots.register({ name: 'settings.section', id: 'dsh-chrome-use', order: 30, label: () => 'dsh-chrome-use', inject: () => ({ read }) }, StatusPage));
  });
};
