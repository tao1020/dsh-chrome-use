window.__ModuleLoader__.load({ id: 'dsh-chrome-use', factory: (require) => { const module = { exports: {} };
function parseStatus(value) {
  if (!value || typeof value.connected !== 'boolean' || !Number.isSafeInteger(value.tabCount) || value.tabCount < 0 || !(value.extensionVersion === null || typeof value.extensionVersion === 'string')) throw new Error('Invalid Chrome connection status');
  const status = { connected: value.connected, tabCount: value.tabCount, extensionVersion: value.extensionVersion };
  for (const field of ['port', 'requestedPort']) {
    if (value[field] === undefined) continue;
    if (!Number.isSafeInteger(value[field]) || value[field] < 1024 || value[field] > 65535) throw new Error(`Invalid Chrome connection ${field}`);
    status[field] = value[field];
  }
  return status;
}
// The @ menu lists tabs, so the payload is bounded: a page can set an arbitrary
// title, and a busy profile can hold hundreds of tabs.
const TAB_LIST_LIMIT = 200;
function parseTabs(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Chrome tab list');
  if (typeof value.connected !== 'boolean' || !Array.isArray(value.tabs)) throw new Error('Invalid Chrome tab list');
  if (value.reason !== undefined && value.reason !== null && (typeof value.reason !== 'string' || value.reason.length > 300)) throw new Error('Invalid Chrome tab list reason');
  if (value.tabs.length > TAB_LIST_LIMIT) throw new Error('Chrome returned too many tabs');
  const tabs = value.tabs.map((tab) => {
    if (!tab || typeof tab !== 'object' || Array.isArray(tab)) throw new Error('Invalid Chrome tab');
    if (!Number.isSafeInteger(tab.tabId) || tab.tabId < 1) throw new Error('Invalid Chrome tab id');
    if (typeof tab.title !== 'string' || tab.title.length > 300) throw new Error('Invalid Chrome tab title');
    if (typeof tab.url !== 'string' || !/^https?:\/\//.test(tab.url) || tab.url.length > 4096) throw new Error('Invalid Chrome tab url');
    if (typeof tab.attached !== 'boolean') throw new Error('Invalid Chrome tab state');
    return { tabId: tab.tabId, title: tab.title, url: tab.url, attached: tab.attached };
  });
  return { connected: value.connected, tabs, reason: typeof value.reason === 'string' ? value.reason : null };
}
const PAIRING_CODE_RE = /^[0-9A-HJKMNP-TV-Z]{8}$/;
function parsePairing(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid pairing response');
  if (typeof value.code !== 'string' || !/^[0-9]{8}$/.test(value.code)) throw new Error('Invalid pairing code');
  if (value.pairingCode !== undefined) {
    if (typeof value.pairingCode !== 'string' || !PAIRING_CODE_RE.test(value.pairingCode) || !/[A-Z]/.test(value.pairingCode)) throw new Error('Invalid pairing code');
  }
  if (!Number.isSafeInteger(value.port) || value.port < 1 || value.port > 65535) throw new Error('Invalid pairing port');
  if (!Number.isSafeInteger(value.expiresInSeconds) || value.expiresInSeconds < 1 || value.expiresInSeconds > 3600) throw new Error('Invalid pairing lifetime');
  if (typeof value.instructions !== 'string' || value.instructions.length > 2000) throw new Error('Invalid pairing instructions');
  return { code: value.code, ...(value.pairingCode === undefined ? {} : { pairingCode: value.pairingCode }), port: value.port, expiresInSeconds: value.expiresInSeconds, instructions: value.instructions };
}
const statusCodec = { mode: 'strict', typeSymbol: 'dsh-chrome-use#ConnectionStatus', schema: { parse: parseStatus }, create: () => ({ parse: parseStatus }) };
const pairingCodec = { mode: 'strict', typeSymbol: 'dsh-chrome-use#PairingCode', schema: { parse: parsePairing }, create: () => ({ parse: parsePairing }) };
const tabListCodec = { mode: 'strict', typeSymbol: 'dsh-chrome-use#TabList', schema: { parse: parseTabs }, create: () => ({ parse: parseTabs }) };
const remote = {
  package: 'dsh-chrome-use',
  descriptors: [
    { id: 'dsh-chrome-use#chromeUseStatus/read', service: 'chromeUseStatus', namespace: 'chromeUseStatus', method: 'read', invocation: { kind: 'direct' }, parameters: [], result: statusCodec },
    { id: 'dsh-chrome-use#chromeUseStatus/pair', service: 'chromeUseStatus', namespace: 'chromeUseStatus', method: 'pair', invocation: { kind: 'direct' }, parameters: [], result: pairingCodec },
    { id: 'dsh-chrome-use#chromeUseStatus/list', service: 'chromeUseStatus', namespace: 'chromeUseStatus', method: 'list', invocation: { kind: 'direct' }, parameters: [], result: tabListCodec },
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

// Pure helpers for the @ tab source. scripts/build-client.mjs concatenates this
// file into the browser bundle, so it must not import anything.

// The menu calls candidates() on every keystroke and the bridge is single-flight,
// so one listing serves a short burst of keys instead of competing with tools.
const MENTION_TTL_MS = 2000;
const MENTION_LIMIT = 50;
const MENTION_PREFIX = 'dsh-chrome-use:';

// The input-trigger routes the chip's serializer by the source *name*, not by a
// separate id: `serializeReference` looks the owner up with `name === source`,
// so the value we insert MUST be this same string. Renaming it invalidates chips
// sitting in a saved draft.
const MENTION_SOURCE = 'Chrome 标签页';

function shorten(value, limit) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function mentionRef(tabId) {
  return `${MENTION_PREFIX}${tabId}`;
}

function parseMentionRef(ref) {
  const match = /^dsh-chrome-use:([1-9][0-9]{0,15})$/.exec(String(ref ?? ''));
  return match ? Number(match[1]) : undefined;
}

function mentionLabel(tab) {
  return shorten(tab.title || tab.url || `标签页 #${tab.tabId}`, 80);
}

// One row per tab, plus a single explanatory row when there is nothing to pick.
// `value` is opaque to the menu; onPick parses it back. A hint row carries the
// text to insert, because picking it must not leave a dangling @ token.
function hintRow(name, description, hint, text) {
  return { name: shorten(name, 80), description, icon: 'session', value: JSON.stringify({ hint, text }) };
}

function mentionCandidates(value, query) {
  if (!value) return [];
  if (!value.connected) {
    return [hintRow('Chrome 扩展没有连接', '在 dsh-chrome-use 设置页生成配对码，再在扩展弹窗里连接', 'disconnected', mentionHintText('disconnected'))];
  }
  const needle = String(query ?? '').trim().toLowerCase();
  const matched = value.tabs.filter(tab => !needle || tab.title.toLowerCase().includes(needle) || tab.url.toLowerCase().includes(needle));
  if (!matched.length) {
    if (!value.tabs.length) {
      if (value.reason) return [hintRow(value.reason, '稍等一下再打开 @ 菜单', 'busy', `${value.reason}。稍等一下再试。`)];
      return [hintRow('Chrome 里没有可操作的标签页', '先在 Chrome 里打开要操作的网页', 'empty', mentionHintText('empty'))];
    }
    return [hintRow('没有匹配的标签页', '换个关键词再试', 'nomatch', mentionHintText('nomatch'))];
  }
  const rows = matched.slice(0, MENTION_LIMIT).map(tab => ({
    name: mentionLabel(tab),
    description: tab.attached ? `${tab.url} · 正在调试` : tab.url,
    icon: 'session',
    value: JSON.stringify({ tabId: tab.tabId, title: tab.title, url: tab.url }),
  }));
  if (matched.length > MENTION_LIMIT) rows.push(hintRow(`还有 ${matched.length - MENTION_LIMIT} 个标签页没显示`, '继续输入可以缩小范围', 'more'));
  return rows;
}

// Fallback text for a hint row that carries none.
function mentionHintText(hint) {
  if (hint === 'disconnected') return 'Chrome 扩展没有连接：请先在 dsh-chrome-use 设置页生成配对码，再在 Chrome 工具栏打开扩展粘贴并连接。';
  if (hint === 'nomatch') return '没有匹配这个关键词的 Chrome 标签页：换个关键词再试，或者先在 Chrome 里切到要操作的页面。';
  if (hint === 'busy') return '浏览器正忙，稍等一下再打开 @ 菜单。';
  return '没有可以 @ 的 Chrome 标签页：先在 Chrome 里打开要操作的网页，或换个关键词再试。';
}

// This text replaces the chip in the sent message. It stays terse — the tab id
// the tools need, plus the title and URL for orientation — and ends with a
// Markdown rule so the user's own words sit in their own paragraph instead of
// running into a generated sentence. The blank line before `---` matters: a
// paragraph directly above a rule line becomes a setext heading. The rules this
// used to spell out live in the skill and the tool descriptions.
function mentionSerializeText(tabId, tab) {
  const line = tab
    ? `[Chrome 标签页 #${tabId}] 《${shorten(tab.title, 120) || '未命名页面'}》${clipUrl(tab.url)}`
    : `[Chrome 标签页 #${tabId}]`;
  return `${line}\n\n---\n\n`;
}

function clipUrl(value) {
  const url = String(value ?? '');
  if (url === '') return '';
  return ` ${url.length > 300 ? `${url.slice(0, 299)}…` : url}`;
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

const packageVersion = "0.16.0";
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
      setPairing({ code: value.pairingCode ?? value.code, pairingCode: value.pairingCode, legacyCode: value.code, port: value.port, expiresAt: stamp + value.expiresInSeconds * 1000 });
    } catch (error) {
      if (!alive.current) return;
      const message = String(error && error.message ? error.message : error);
      setPairing({ error: message.includes('ALREADY_CONNECTED') ? 'Chrome 已连接，无需新的配对码。如需重新配对，请先在扩展弹窗中点击“断开全部连接”。' : message.includes('BRIDGE_STOPPED') ? 'Harness 插件已停止，请重启 Harness 后再试。' : `生成配对码失败：${message}` });
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
    value?.port && h('p', { role: 'status' }, value.requestedPort && value.requestedPort !== value.port ? `本机端口 ${value.port}（${value.requestedPort} 被占用，已自动改用）` : `本机端口 ${value.port}`),
    value && !connected && h('p', null, '请生成配对码，在 Chrome 工具栏的扩展弹窗中粘贴并点击“连接”。'),
    connected && h('p', null, '如需重新配对，请先在扩展弹窗中点击“断开全部连接”，再回到这里生成新的配对码。'),
    h('button', { onClick: refresh, disabled: state.loading, style: buttonStyle }, state.loading ? '刷新中…' : '刷新状态'));
  const pairBlock = h('div', { key: 'pair' },
    h('h3', null, '配对 Chrome 扩展'),
    h('p', null, '点击下面的按钮生成 8 位配对码，然后在 Chrome 工具栏打开 dsh-chrome-use 扩展，粘贴配对码并点击“连接”。新配对码已经包含端口，扩展会自动识别，不需要手填端口。配对码 10 分钟内有效，生成新码会让旧码立即失效。'),
    h('button', { onClick: requestPairing, disabled: pairing.loading, style: buttonStyle }, pairing.loading ? '正在生成…' : pairing.code || expired ? '重新生成配对码' : '生成配对码'),
    pairing.error && h('p', { role: 'alert', style: { color: 'var(--dsh-danger, #d9534f)' } }, pairing.error),
    pairing.code && !expired && h('div', { style: { marginTop: 12 } },
      h('code', { style: codeStyle, 'aria-label': '配对码' }, pairing.code),
      h('p', { role: 'status' }, `剩余有效时间：${countdown}（本机端口 ${pairing.port}）`),
      h('button', { onClick: copyCode, style: buttonStyle }, pairing.copied ? '已复制' : '复制配对码'),
      pairing.pairingCode && pairing.port === 18791 && h('details', null,
        h('summary', null, '旧版扩展（仅 18791）'),
        h('p', null, `旧版扩展只认纯数字兼容码，并且在 18791 上使用：${pairing.legacyCode}`))),
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
    h('p', null, link(repositoryUrl, '喜欢这个插件？点个 Star，让更多人发现它 ⭐')),
    settingsSectionOrder(connected).map(key => blocks[key]));
}
// The @ source remembers what the menu showed so serialize() still has the
// title and URL after the pick, and can recover them after a draft reload.
const knownTabs = new Map();
let mentionCache = { at: 0, value: undefined };
let mentionInflight;

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('查询超时，请确认 Harness 服务正常后重试。')), ms); }),
  ]).finally(() => clearTimeout(timer));
}

async function listTabs(scope) {
  if (mentionCache.value && Date.now() - mentionCache.at < MENTION_TTL_MS) return mentionCache.value;
  if (mentionInflight) return mentionInflight;
  mentionInflight = (async () => {
    try {
      const result = await scope.remote.chromeUseStatus.list();
      if (!result) throw new Error('Harness 没有返回标签页列表');
      if (!result.ok) {
        const failure = result.error ?? {};
        throw new Error(`[${failure.code ?? 'unknown'}] ${failure.message ?? 'Harness 拒绝了标签页查询'}`);
      }
      const value = parseTabs(result.value);
      mentionCache = { at: Date.now(), value };
      for (const tab of value.tabs) knownTabs.set(tab.tabId, { tabId: tab.tabId, title: tab.title, url: tab.url });
      return value;
    } finally { mentionInflight = undefined; }
  })();
  return mentionInflight;
}

function createMentionSource(scope) {
  return {
    trigger: '@',
    name: MENTION_SOURCE,
    order: 50,
    async candidates(_session, req) {
      try {
        return mentionCandidates(await withTimeout(listTabs(scope), 6000), req?.query ?? '');
      } catch (error) {
        // The menu is not the place for a thrown error: one readable row instead.
        return [{ name: '无法读取 Chrome 标签页', description: String(error?.message ?? error), icon: 'session', value: JSON.stringify({ hint: 'disconnected' }) }];
      }
    },
    onPick(pick) {
      let payload = {};
      try { payload = JSON.parse(String(pick?.candidate?.value ?? '{}')) ?? {}; } catch {}
      if (payload && typeof payload.hint === 'string') {
        if (payload.hint === 'more') return 'handled';
        return { text: typeof payload.text === 'string' && payload.text ? payload.text : mentionHintText(payload.hint) };
      }
      const tabId = Number(payload?.tabId);
      if (!Number.isSafeInteger(tabId) || tabId < 1) return undefined;
      const tab = { tabId, title: String(payload.title ?? ''), url: String(payload.url ?? '') };
      knownTabs.set(tabId, tab);
      return { insert: { source: MENTION_SOURCE, ref: mentionRef(tabId), label: mentionLabel(tab), appearance: 'session', clipboardText: tab.url || mentionRef(tabId) } };
    },
    codec: {
      clipboardText(ref) {
        const tabId = parseMentionRef(ref);
        return (tabId === undefined ? undefined : knownTabs.get(tabId)?.url) || String(ref);
      },
      // The contract blocks the send when this rejects, so it always resolves.
      async serialize(ref) {
        const tabId = parseMentionRef(ref);
        if (tabId === undefined) return `[Chrome 标签页] ${String(ref)}`;
        try {
          let tab = knownTabs.get(tabId);
          if (!tab) {
            const value = await withTimeout(listTabs(scope), 4000);
            const found = value.tabs.find(candidate => candidate.tabId === tabId);
            if (found) {
              tab = { tabId: found.tabId, title: found.title, url: found.url };
              knownTabs.set(tabId, tab);
            }
          }
          return mentionSerializeText(tabId, tab);
        } catch {
          return mentionSerializeText(tabId, knownTabs.get(tabId));
        }
      },
    },
  };
}

module.exports.inject = ['slots', 'remote'];
module.exports.apply = function(ctx) {
  ctx.effect(async () => await ctx.remote.$mount(remote));
  ctx.inject(['remote.chromeUseStatus'], (scope) => {
    const read = () => scope.remote.chromeUseStatus.read();
    const pair = () => scope.remote.chromeUseStatus.pair();
    scope.slots.inject('settings.section', () => scope.slots.register({ name: 'settings.section', id: 'dsh-chrome-use', order: 30, label: () => 'dsh-chrome-use', inject: () => ({ read, pair }) }, StatusPage));
  });
  // The @ source is optional on purpose: a Harness without the input-trigger
  // service must still get the settings page, so this is a dynamic inject
  // rather than a module-level dependency.
  ctx.inject(['remote.chromeUseStatus', 'inputTriggers'], (scope) => {
    // Cordis exposes services as properties, and some client builds only answer
    // through ctx.get(); accept either so the menu is not silently empty.
    const triggers = scope.inputTriggers ?? (typeof scope.get === 'function' ? scope.get('inputTriggers') : undefined);
    if (!triggers || typeof triggers.registerSource !== 'function') return;
    ctx.effect(() => {
      try {
        return triggers.registerSource(createMentionSource(scope));
      } catch (error) {
        // A duplicate group name (another plugin already claims it) must not
        // take the settings page down with it.
        console.warn('dsh-chrome-use: @ tab source was not registered', error);
        return undefined;
      }
    }, 'dsh-chrome-use: @ tabs');
  });
};

return module.exports; } });
