window.__ModuleLoader__.load({ id: 'dsh-chrome-use', factory: (require) => { const module = { exports: {} };
function parseStatus(value) {
  if (!value || typeof value.connected !== 'boolean' || !Number.isSafeInteger(value.tabCount) || value.tabCount < 0 || !(value.extensionVersion === null || typeof value.extensionVersion === 'string')) throw new Error('Invalid Chrome connection status');
  return { connected: value.connected, tabCount: value.tabCount, extensionVersion: value.extensionVersion };
}
const codec = { mode: 'strict', typeSymbol: 'dsh-chrome-use#ConnectionStatus', schema: { parse: parseStatus }, create: () => ({ parse: parseStatus }) };
const remote = { package: 'dsh-chrome-use', descriptors: [{ id: 'dsh-chrome-use#chromeUseStatus/read', service: 'chromeUseStatus', namespace: 'chromeUseStatus', method: 'read', invocation: { kind: 'direct' }, parameters: [], result: codec }] };

// Wrapped by scripts/build-client.mjs for the Harness browser module loader.
const React = require('react');
const { createElement: h, useState, useEffect, useRef } = React;
function StatusPage({ read }) {
  const [state, setState] = useState({ loading: true });
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

return module.exports; } });
