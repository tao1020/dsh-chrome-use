// Wrapped by scripts/build-client.mjs for the Harness browser module loader.
const React = require('react');
const { createElement: h, useState, useEffect, useRef } = React;
const codeStyle = { display: 'inline-block', padding: '10px 18px', borderRadius: 8, border: '1px solid var(--dsh-border, rgba(127,127,127,.45))', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 30, fontWeight: 700, letterSpacing: 8, userSelect: 'all' };
const buttonStyle = { padding: '6px 14px', marginRight: 8, borderRadius: 6, cursor: 'pointer' };
function StatusPage({ read, pair }) {
  const [state, setState] = useState({ loading: true });
  const [pairing, setPairing] = useState({});
  const [update, setUpdate] = useState({});
  const [now, setNow] = useState(() => Date.now());
  const alive = useRef(true);
  const generation = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function checkUpdates() {
    setUpdate({ loading: true });
    try { const result = await checkRelease(packageVersion); if (alive.current) setUpdate(result); }
    catch (error) { if (alive.current) setUpdate({ message: error.message }); }
  }
  const link = (url, text) => h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, text);
  async function refresh() {
    const id = ++generation.current;
    setState(previous => ({ ...previous, loading: true }));
    let timer;
    try {
      const result = await Promise.race([read(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('查询超时，请确认 Harness 服务正常后重试。')), 5000); })]);
      if (!result.ok) throw new Error('无法读取连接状态，请稍后重试。');
      const value = parseStatus(result.value);
      if (id === generation.current) setState({ value });
      if (value.connected && alive.current) setPairing({});
    } catch (error) {
      if (id === generation.current) setState(previous => ({ ...previous, loading: false, error: error.message }));
    } finally { clearTimeout(timer); }
  }
  useEffect(() => { refresh(); return () => { generation.current++; }; }, [read]);
  async function requestPairing() {
    setPairing({ loading: true });
    try {
      const result = await pair();
      if (!result || !result.ok) throw new Error('生成配对码失败，请稍后重试。');
      const value = parsePairing(result.value);
      const stamp = Date.now();
      if (!alive.current) return;
      setNow(stamp);
      setPairing({ code: value.code, port: value.port, expiresAt: stamp + value.expiresInSeconds * 1000 });
    } catch (error) {
      if (!alive.current) return;
      const message = String(error && error.message ? error.message : error);
      setPairing({ error: message.includes('ALREADY_CONNECTED') ? 'Chrome 已连接，无需新的配对码。如需重新配对，请先在扩展弹窗中点击“断开连接”。' : message.includes('BRIDGE_STOPPED') ? 'Harness 插件已停止，请重启 Harness 后再试。' : `生成配对码失败：${message}` });
    }
  }
  async function copyCode() {
    try { await navigator.clipboard.writeText(pairing.code); setPairing(previous => ({ ...previous, copied: true })); }
    catch (error) { setPairing(previous => ({ ...previous, error: '复制失败，请手动抄写配对码。' })); }
  }
  useEffect(() => {
    if (!pairing.expiresAt) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pairing.expiresAt]);
  // Poll the connection while a code is live so the page flips to "connected" without a manual refresh.
  useEffect(() => {
    if (!pairing.expiresAt || state.value && state.value.connected) return;
    const timer = setInterval(() => { if (Date.now() < pairing.expiresAt) refresh(); }, 2500);
    return () => clearInterval(timer);
  }, [pairing.expiresAt, state.value && state.value.connected]);
  const value = state.value;
  const connected = Boolean(value && value.connected);
  const remaining = pairing.expiresAt ? Math.max(0, Math.ceil((pairing.expiresAt - now) / 1000)) : 0;
  const expired = Boolean(pairing.expiresAt) && remaining === 0;
  const countdown = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
  return h('section', { style: { padding: 24 }, 'aria-label': 'dsh-chrome-use' },
    h('h2', null, 'dsh-chrome-use'),
    h('p', null, `Harness 插件版本：${packageVersion}`),
    h('h3', null, '连接状态'),
    h('p', { role: 'status' }, state.loading && !value ? '正在查询 Chrome 连接…' : state.error && !value ? state.error : connected ? '已连接 Chrome' : '未连接 Chrome'),
    value && h('p', null, `扩展版本：${value.extensionVersion || '未知'} · 正在调试的标签页：${value.tabCount}`),
    value && !connected && h('p', null, '请按下方“配对 Chrome 扩展”生成配对码，在 Chrome 工具栏的扩展弹窗中输入并点击“连接”。'),
    h('button', { onClick: refresh, disabled: state.loading, style: buttonStyle }, state.loading ? '刷新中…' : '刷新状态'),
    h('h3', null, '配对 Chrome 扩展'),
    connected
      ? h('p', null, 'Chrome 已连接，无需配对码。如需重新配对，请先在扩展弹窗中点击“断开连接”，再回到这里生成新的配对码。')
      : h('div', null,
        h('p', null, '点击下面的按钮生成 8 位配对码，然后在 Chrome 工具栏打开 dsh-chrome-use 扩展，输入配对码并点击“连接”。配对码 2 分钟内有效，生成新码会让旧码立即失效。'),
        h('button', { onClick: requestPairing, disabled: pairing.loading, style: buttonStyle }, pairing.loading ? '正在生成…' : pairing.code || expired ? '重新生成配对码' : '生成配对码'),
        pairing.error && h('p', { role: 'alert', style: { color: 'var(--dsh-danger, #d9534f)' } }, pairing.error),
        pairing.code && !expired && h('div', { style: { marginTop: 12 } },
          h('code', { style: codeStyle, 'aria-label': '配对码' }, pairing.code),
          h('p', { role: 'status' }, `剩余有效时间：${countdown}（本机端口 ${pairing.port}）`),
          h('button', { onClick: copyCode, style: buttonStyle }, pairing.copied ? '已复制' : '复制配对码')),
        expired && h('p', { role: 'status' }, '配对码已过期，请点击“重新生成配对码”。'),
        h('p', null, '如果按钮不可用，也可以在对话中让 Harness 调用 chrome_pair，拿到的是同一种临时码。')),
    h('h3', null, '安装 Chrome 扩展'),
    h('ol', null,
      h('li', null, link('https://github.com/tao1020/dsh-chrome-use', '打开代码仓库'), '，点击 Code → Download ZIP，下载后解压（或直接使用已克隆仓库中的 extension 文件夹）。'),
      h('li', null, '在 Chrome 地址栏输入 chrome://extensions，开启右上角“开发者模式”。'),
      h('li', null, '点击“加载已解压的扩展程序”，选择解压目录里的 extension 文件夹；这一步只能由你在 Chrome 中手动完成。'),
      h('li', null, '回到本页生成配对码，在扩展弹窗中输入并连接。首次配对成功后，重启 Harness、Chrome 或刷新扩展都会自动重连。')),
    h('h3', null, '版本更新'),
    h('button', { onClick: checkUpdates, disabled: update.loading, style: buttonStyle }, update.loading ? '正在检查…' : '检查更新'),
    h('p', { role: 'status' }, update.message || '点击后从 GitHub 查询最新正式 Release，仅发送版本查询请求。'),
    link(releasesUrl, '下载新版 / 查看发布记录'),
    h('p', null, 'Chrome 扩展更新：下载新版扩展 ZIP，解压并替换原 extension 文件夹，再到 chrome://extensions 点击扩展卡片上的刷新按钮。不要删除原文件夹。'),
    h('p', null, 'Harness 插件与 Chrome 扩展分别更新。此处检查的是 Harness 插件版本；Chrome 已连接版本显示在“连接状态”。Harness 插件请通过其插件管理入口更新。'));
}
module.exports.inject = ['slots', 'remote'];
module.exports.apply = function(ctx) {
  ctx.effect(async () => await ctx.remote.$mount(remote));
  ctx.inject(['remote.chromeUseStatus'], (scope) => {
    const read = () => scope.remote.chromeUseStatus.read();
    const pair = () => scope.remote.chromeUseStatus.pair();
    scope.slots.inject('settings.section', () => scope.slots.register({ name: 'settings.section', id: 'dsh-chrome-use', order: 30, label: () => 'dsh-chrome-use', inject: () => ({ read, pair }) }, StatusPage));
  });
};
