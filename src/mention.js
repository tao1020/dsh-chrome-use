// Pure helpers for the @ tab source. scripts/build-client.mjs concatenates this
// file into the browser bundle, so it must not import anything.

// The menu calls candidates() on every keystroke and the bridge is single-flight,
// so one listing serves a short burst of keys instead of competing with tools.
export const MENTION_TTL_MS = 2000;
const MENTION_LIMIT = 50;
const MENTION_PREFIX = 'dsh-chrome-use:';

// The input-trigger routes the chip's serializer by the source *name*, not by a
// separate id: `serializeReference` looks the owner up with `name === source`,
// so the value we insert MUST be this same string. Renaming it invalidates chips
// sitting in a saved draft.
export const MENTION_SOURCE = 'Chrome 标签页';

export function shorten(value, limit) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

export function mentionRef(tabId) {
  return `${MENTION_PREFIX}${tabId}`;
}

export function parseMentionRef(ref) {
  const match = /^dsh-chrome-use:([1-9][0-9]{0,15})$/.exec(String(ref ?? ''));
  return match ? Number(match[1]) : undefined;
}

export function mentionLabel(tab) {
  return shorten(tab.title || tab.url || `标签页 #${tab.tabId}`, 80);
}

// One row per tab, plus a single explanatory row when there is nothing to pick.
// `value` is opaque to the menu; onPick parses it back. A hint row carries the
// text to insert, because picking it must not leave a dangling @ token.
function hintRow(name, description, hint, text) {
  return { name: shorten(name, 80), description, icon: 'session', value: JSON.stringify({ hint, text }) };
}

export function mentionCandidates(value, query) {
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
export function mentionHintText(hint) {
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
export function mentionSerializeText(tabId, tab) {
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
