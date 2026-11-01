window.__ModuleLoader__.load({ id: 'dsh-chrome-use', factory: (require) => { const module = { exports: {} };
function parseStatus(value) {
  if (!value || typeof value.connected !== 'boolean' || !Number.isSafeInteger(value.tabCount) || value.tabCount < 0 || !(value.extensionVersion === null || typeof value.extensionVersion === 'string')) throw new Error('Invalid Chrome connection status');
  return { connected: value.connected, tabCount: value.tabCount, extensionVersion: value.extensionVersion };
}
function parsePairing(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid pairing response');
  if (typeof value.code !== 'string' || !/^[0-9]{8}$/.test(value.code)) throw new Error('Invalid pairing code');
  if (!Number.isSafeInteger(value.port) || value.port < 1 || value.port > 65535) throw new Error('Invalid pairing port');
  if (!Number.isSafeInteger(value.expiresInSeconds) || value.expiresInSeconds < 1 || value.expiresInSeconds > 600) throw new Error('Invalid pairing lifetime');
  if (typeof value.instructions !== 'string' || value.instructions.length > 2000) throw new Error('Invalid pairing instructions');
  return { code: value.code, port: value.port, expiresInSeconds: value.expiresInSeconds, instructions: value.instructions };
}
const statusCodec = { mode: 'strict', typeSymbol: 'dsh-chrome-use#ConnectionStatus', schema: { parse: parseStatus }, create: () => ({ parse: parseStatus }) };
const pairingCodec = { mode: 'strict', typeSymbol: 'dsh-chrome-use#PairingCode', schema: { parse: parsePairing }, create: () => ({ parse: parsePairing }) };
const remote = {
  package: 'dsh-chrome-use',
  descriptors: [
    { id: 'dsh-chrome-use#chromeUseStatus/read', service: 'chromeUseStatus', namespace: 'chromeUseStatus', method: 'read', invocation: { kind: 'direct' }, parameters: [], result: statusCodec },
    { id: 'dsh-chrome-use#chromeUseStatus/pair', service: 'chromeUseStatus', namespace: 'chromeUseStatus', method: 'pair', invocation: { kind: 'direct' }, parameters: [], result: pairingCodec },
  ],
};

const repositoryUrl = 'https://github.com/tao1020/dsh-chrome-use';
const storeUrl = 'https://chromewebstore.google.com/detail/anobmlnjdeahldefeikjdmmnckphpdhc';
const releasesUrl = `${repositoryUrl}/releases`;

// Section order for the settings page. A user who is not connected needs the
// install and pairing steps before any status text; a connected user needs the
// status first. Keeping the order in one place makes the two cases testable.
function settingsSectionOrder(connected) {
  return connected ? ['status', 'install', 'update'] : ['install', 'pair', 'status', 'update'];
}

function newerVersion(latest, current) {
  const parse = value => /^\d+\.\d+\.\d+$/.test(value) ? value.split('.').map(Number) : null;
  const a = parse(latest), b = parse(current);
  if (!a || !b) throw new Error('无法识别版本号');
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
async function checkRelease(current, fetcher = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetcher('https://api.github.com/repos/tao1020/dsh-chrome-use/releases/latest', { signal: controller.signal, credentials: 'omit', redirect: 'error', headers: { Accept: 'application/vnd.github+json' } });
    if (response.status === 404) return { message: '暂时没有正式发布的版本。' };
    if (!response.ok) throw new Error(`检查失败（HTTP ${response.status}），请稍后重试或查看发布页面。`);
    const text = await response.text();
    if (text.length > 262144) throw new Error('版本信息过大，请查看发布页面。');
    const release = JSON.parse(text);
    const version = String(release.tag_name).replace(/^release-v/, '');
    if (release.draft || release.prerelease) throw new Error('未找到稳定版本');
    return { message: newerVersion(version, current) ? `发现新版本 ${version}` : `当前已是最新版本（${current}）`, version };
  } catch (error) {
    if (controller.signal.aborted) throw new Error('检查更新超时，请重试。');
    throw error;
  } finally { clearTimeout(timer); }
}

const packageVersion = "0.1.9";
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
      if (!result.ok) {
        const failure = result.error ?? {};
        throw new Error(`无法读取连接状态：[${failure.code ?? 'unknown'}] ${failure.message ?? 'Harness 拒绝了查询'}`);
      }
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
      if (!result) throw new Error('Harness 没有返回配对结果');
      if (!result.ok) {
        const failure = result.error ?? {};
        throw new Error(`[${failure.code ?? 'unknown'}] ${failure.message ?? 'Harness 拒绝了配对请求'}`);
      }
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
  const statusBlock = h('div', { key: 'status' },
    h('h3', null, '连接状态'),
    h('p', { role: 'status' }, state.loading && !value ? '正在查询 Chrome 连接…' : state.error && !value ? state.error : connected ? '已连接 Chrome' : '未连接 Chrome'),
    value && h('p', null, `扩展版本：${value.extensionVersion || '未知'} · 正在调试的标签页：${value.tabCount}`),
    value && !connected && h('p', null, '请生成配对码，在 Chrome 工具栏的扩展弹窗中输入并点击“连接”。'),
    connected && h('p', null, '如需重新配对，请先在扩展弹窗中点击“断开连接”，再回到这里生成新的配对码。'),
    h('button', { onClick: refresh, disabled: state.loading, style: buttonStyle }, state.loading ? '刷新中…' : '刷新状态'));
  const pairBlock = h('div', { key: 'pair' },
    h('h3', null, '配对 Chrome 扩展'),
    h('p', null, '点击下面的按钮生成 8 位配对码，然后在 Chrome 工具栏打开 dsh-chrome-use 扩展，输入配对码并点击“连接”。配对码 2 分钟内有效，生成新码会让旧码立即失效。'),
    h('button', { onClick: requestPairing, disabled: pairing.loading, style: buttonStyle }, pairing.loading ? '正在生成…' : pairing.code || expired ? '重新生成配对码' : '生成配对码'),
    pairing.error && h('p', { role: 'alert', style: { color: 'var(--dsh-danger, #d9534f)' } }, pairing.error),
    pairing.code && !expired && h('div', { style: { marginTop: 12 } },
      h('code', { style: codeStyle, 'aria-label': '配对码' }, pairing.code),
      h('p', { role: 'status' }, `剩余有效时间：${countdown}（本机端口 ${pairing.port}）`),
      h('button', { onClick: copyCode, style: buttonStyle }, pairing.copied ? '已复制' : '复制配对码')),
    expired && h('p', { role: 'status' }, '配对码已过期，请点击“重新生成配对码”。'),
    h('p', null, '如果按钮不可用，也可以在对话中让 Harness 调用 chrome_pair，拿到的是同一种临时码。'));
  const installBlock = h('div', { key: 'install' },
    h('h3', null, '安装 Chrome 扩展'),
    h('p', null, link(storeUrl, '在 Chrome 应用商店安装 dsh-chrome-use'), '，点击“添加至 Chrome”。Chrome 会自动更新商店安装的扩展，不需要下载或手动加载文件夹。'),
    h('p', null, '装好后回到本页生成配对码，在 Chrome 工具栏打开扩展，输入配对码并点击“连接”。首次配对成功后，重启 Harness、Chrome 或扩展自动更新都会自动重连。'));
  const updateBlock = h('div', { key: 'update' },
    h('h3', null, '版本更新'),
    h('button', { onClick: checkUpdates, disabled: update.loading, style: buttonStyle }, update.loading ? '正在检查…' : '检查更新'),
    h('p', { role: 'status' }, update.message || '点击后从 GitHub 查询最新正式 Release，仅发送版本查询请求。'),
    link(releasesUrl, '查看发布记录'),
    h('p', null, 'Chrome 扩展由 Chrome 应用商店自动更新，也可以在 chrome://extensions 点击扩展卡片的“更新”手动检查。'),
    h('p', null, 'Harness 插件与 Chrome 扩展分别更新。此处检查的是 Harness 插件版本；Chrome 已连接版本显示在“连接状态”。Harness 插件请通过其插件管理入口更新。'));
  const blocks = { status: statusBlock, pair: pairBlock, install: installBlock, update: updateBlock };
  return h('section', { style: { padding: 24 }, 'aria-label': 'dsh-chrome-use' },
    h('h2', null, 'dsh-chrome-use'),
    h('p', null, `Harness 插件版本：${packageVersion}`),
    settingsSectionOrder(connected).map(key => blocks[key]));
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

return module.exports; } });
