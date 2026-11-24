import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { mentionCandidates, mentionHintText, mentionLabel, mentionRef, mentionSerializeText, parseMentionRef } from '../src/mention.js';

const tabs = [
  { tabId: 7, title: '订单列表', url: 'https://shop.test/orders', attached: false },
  { tabId: 8, title: 'Inbox', url: 'https://mail.test/inbox', attached: true },
];

// Load the real browser bundle with a React-shaped stub and a fake input-trigger
// service, so registration, pick and serialization are exercised as shipped.
async function loadSource(listResult) {
  let entry;
  // The bundle expects browser globals; vm contexts have no timers of their own.
  vm.runInNewContext(await readFile(new URL('../src/client.js', import.meta.url), 'utf8'), { window: { __ModuleLoader__: { load(value) { entry = value; } } }, setTimeout, clearTimeout });
  const React = { createElement: () => null, useState: () => [{}, () => {}], useEffect() {}, useRef: initial => ({ current: initial }) };
  const plugin = entry.factory(() => React);
  const sources = [];
  const list = typeof listResult === 'function' ? listResult : async () => listResult;
  const ctx = {
    effect(fn) { fn(); },
    remote: {
      $mount: () => Promise.resolve(() => {}),
      chromeUseStatus: {
        read: async () => ({ ok: true, value: { connected: true, tabCount: 0, extensionVersion: '0.6.7' } }),
        pair: async () => ({ ok: true, value: { code: '12345678', port: 18791, expiresInSeconds: 120, instructions: '' } }),
        list,
      },
    },
    inject(deps, fn) { fn(ctx); },
    slots: { inject(name, fn) { fn(); }, register() {} },
    inputTriggers: { registerSource(source) { sources.push(source); return () => {}; } },
  };
  plugin.apply(ctx);
  return { source: sources[0], sources };
}

test('mention references round-trip and reject anything else', () => {
  assert.equal(mentionRef(12), 'dsh-chrome-use:12');
  assert.equal(parseMentionRef('dsh-chrome-use:12'), 12);
  for (const ref of ['', 'dsh-chrome-use:', 'dsh-chrome-use:0', 'dsh-chrome-use:12x', 'chrome-use:12', 'dsh-chrome-use:12 ', undefined, null]) assert.equal(parseMentionRef(ref), undefined);
});

test('tab rows show the title, the URL and the attached state', () => {
  const rows = mentionCandidates({ connected: true, tabs, reason: null }, '');
  assert.deepEqual(rows.map(row => row.name), ['订单列表', 'Inbox']);
  assert.equal(rows[0].description, 'https://shop.test/orders');
  assert.equal(rows[1].description, 'https://mail.test/inbox · 正在调试');
  assert.deepEqual(JSON.parse(rows[1].value), { tabId: 8, title: 'Inbox', url: 'https://mail.test/inbox' });
  assert.deepEqual(mentionCandidates({ connected: true, tabs, reason: null }, ' mail ').map(row => row.name), ['Inbox']);
  assert.deepEqual(mentionCandidates({ connected: true, tabs, reason: null }, 'shop').map(row => row.name), ['订单列表']);
});

test('empty and disconnected states become one readable row each', () => {
  const missing = mentionCandidates({ connected: false, tabs: [], reason: 'Chrome 扩展没有连接' }, '');
  assert.equal(missing.length, 1);
  assert.equal(missing[0].name, 'Chrome 扩展没有连接');
  assert.equal(JSON.parse(missing[0].value).hint, 'disconnected');
  assert.match(JSON.parse(missing[0].value).text, /配对码/);
  assert.match(mentionHintText('disconnected'), /配对码/);
  const busy = mentionCandidates({ connected: true, tabs: [], reason: '浏览器正在执行另一条命令，稍等一下再打开 @ 菜单' }, '');
  assert.equal(busy.length, 1);
  assert.equal(busy[0].name, '浏览器正在执行另一条命令，稍等一下再打开 @ 菜单');
  assert.match(JSON.parse(busy[0].value).text, /稍等一下再试/);
  assert.equal(mentionCandidates({ connected: true, tabs, reason: null }, 'nothing-matches')[0].name, '没有匹配的标签页');
  assert.match(mentionHintText('empty'), /没有可以 @ 的 Chrome 标签页/);
});

test('long result sets are capped and say so', () => {
  const many = Array.from({ length: 51 }, (_, index) => ({ tabId: index + 1, title: `Tab ${index + 1}`, url: `https://t${index + 1}.test/`, attached: false }));
  const rows = mentionCandidates({ connected: true, tabs: many, reason: null }, '');
  assert.equal(rows.length, 51);
  assert.equal(rows.at(-1).name, '还有 1 个标签页没显示');
  assert.deepEqual(JSON.parse(rows.at(-1).value), { hint: 'more' });
});

test('labels fall back from title to URL to tab id', () => {
  assert.equal(mentionLabel({ tabId: 3, title: 'A', url: 'https://a.test/' }), 'A');
  assert.equal(mentionLabel({ tabId: 3, title: '', url: 'https://a.test/' }), 'https://a.test/');
  assert.equal(mentionLabel({ tabId: 3, title: '', url: '' }), '标签页 #3');
});

test('serialization stays one line: the tab id, its title and its URL', () => {
  // Everything else the model needs is stated once, in the skill and in the
  // tool descriptions, so the user does not get a paragraph in their transcript.
  const text = mentionSerializeText(7, { tabId: 7, title: '订单列表', url: 'https://shop.test/orders' });
  assert.equal(text, '[Chrome 标签页 #7] 《订单列表》 https://shop.test/orders\n\n---\n\n');
  assert.equal(mentionSerializeText(7, { tabId: 7, title: '', url: '' }), '[Chrome 标签页 #7] 《未命名页面》\n\n---\n\n');
  assert.equal(mentionSerializeText(7, undefined), '[Chrome 标签页 #7]\n\n---\n\n');
  const long = mentionSerializeText(9, { tabId: 9, title: 'x'.repeat(200), url: `https://a.test/${'y'.repeat(400)}` });
  assert.ok(long.length < 480, `text stayed bounded, got ${long.length}`);
  // A rule needs its own paragraph above it, otherwise Markdown reads the
  // reference line as a setext heading instead of drawing a divider.
  assert.match(text, /https:\/\/shop\.test\/orders\n\n---\n\n$/);
});

test('the browser entry registers one @ source for Chrome tabs', async () => {
  const { source, sources } = await loadSource({ ok: true, value: { connected: true, tabs, reason: null } });
  assert.equal(sources.length, 1);
  assert.equal(source.trigger, '@');
  assert.equal(source.name, 'Chrome 标签页');
  assert.equal(typeof source.codec.serialize, 'function');
  const rows = await source.candidates({ sessionId: 's1' }, { query: '', position: 'inline', drilled: false });
  assert.equal(rows.length, 2);
});

test('picking a tab inserts a reference and serializes it with title and URL', async () => {
  const { source } = await loadSource({ ok: true, value: { connected: true, tabs, reason: null } });
  const [row] = await source.candidates({ sessionId: 's1' }, { query: '订单', position: 'inline', drilled: false });
  const outcome = source.onPick({ candidate: row, session: { sessionId: 's1' }, position: 'inline', via: 'menu', action: 'settle', span: { from: 0, to: 1 } });
  // The bundle runs in its own realm, so compare structurally rather than by prototype.
  assert.deepEqual(JSON.parse(JSON.stringify(outcome)), { insert: { source: 'Chrome 标签页', ref: 'dsh-chrome-use:7', label: '订单列表', appearance: 'session', clipboardText: 'https://shop.test/orders' } });
  assert.equal(source.codec.clipboardText('dsh-chrome-use:7'), 'https://shop.test/orders');
  const text = await source.codec.serialize('dsh-chrome-use:7', new AbortController().signal);
  assert.match(text, /Chrome 标签页 #7/);
  assert.match(text, /https:\/\/shop\.test\/orders/);
});

test('the inserted reference names the source, because the serializer routes by name', async () => {
  // dsh-client-ui-input-trigger resolves a chip's codec with
  // `roster.all().find(s => s.name === source)`, so a mismatched source string
  // fails the send with `slash: no serializer for reference source "..."`.
  const { source } = await loadSource({ ok: true, value: { connected: true, tabs, reason: null } });
  const [row] = await source.candidates({ sessionId: 's1' }, { query: '订单', position: 'inline', drilled: false });
  const outcome = source.onPick({ candidate: row, session: { sessionId: 's1' }, position: 'inline', via: 'menu', action: 'settle', span: { from: 0, to: 1 } });
  assert.equal(outcome.insert.source, source.name);
});

test('picking a hint inserts an explanation instead of a dangling mention', async () => {
  const { source } = await loadSource({ ok: true, value: { connected: false, tabs: [], reason: 'Chrome 扩展没有连接' } });
  const [row] = await source.candidates({ sessionId: 's1' }, { query: '', position: 'inline', drilled: false });
  const outcome = source.onPick({ candidate: row, session: { sessionId: 's1' }, position: 'inline', via: 'menu', action: 'settle', span: { from: 0, to: 1 } });
  assert.match(outcome.text, /配对码/);
});

test('serialization never throws when the host is unreachable or the tab is unknown', async () => {
  const offline = await loadSource({ ok: false, error: { code: 'BROWSER_BUSY', message: 'busy' } });
  const text = await offline.source.codec.serialize('dsh-chrome-use:42', new AbortController().signal);
  assert.equal(text, '[Chrome 标签页 #42]\n\n---\n\n');

  const broken = await loadSource({ ok: true, value: { connected: true, tabs: 'not-an-array' } });
  const rows = await broken.source.candidates({ sessionId: 's1' }, { query: '', position: 'inline', drilled: false });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, '无法读取 Chrome 标签页');
  const fallback = await broken.source.codec.serialize('dsh-chrome-use:42', new AbortController().signal);
  assert.equal(fallback, '[Chrome 标签页 #42]\n\n---\n\n');
});

test('the @ source keeps working without a cached pick, and older harnesses still get settings', async () => {
  let entry;
  // The bundle expects browser globals; vm contexts have no timers of their own.
  vm.runInNewContext(await readFile(new URL('../src/client.js', import.meta.url), 'utf8'), { window: { __ModuleLoader__: { load(value) { entry = value; } } }, setTimeout, clearTimeout });
  const plugin = entry.factory(() => ({ createElement: () => null, useState: () => [{}, () => {}], useEffect() {}, useRef: () => ({}) }));
  let registered;
  // No inputTriggers service at all: this is a Harness older than the trigger API.
  const ctx = {
    effect(fn) { fn(); },
    remote: { $mount: () => Promise.resolve(() => {}), chromeUseStatus: { read: async () => ({ ok: true, value: { connected: false, tabCount: 0, extensionVersion: null } }) } },
    inject(deps, fn) { fn(ctx); },
    slots: { inject(name, fn) { fn(); }, register(spec) { registered = spec; } },
  };
  assert.doesNotThrow(() => plugin.apply(ctx));
  assert.equal(registered.id, 'dsh-chrome-use');
});

test('a harness that only exposes services through ctx.get still gets the @ source', async () => {
  let entry;
  vm.runInNewContext(await readFile(new URL('../src/client.js', import.meta.url), 'utf8'), { window: { __ModuleLoader__: { load(value) { entry = value; } } }, setTimeout, clearTimeout, console });
  const plugin = entry.factory(() => ({ createElement: () => null, useState: () => [{}, () => {}], useEffect() {}, useRef: () => ({}) }));
  const sources = [];
  const services = { inputTriggers: { registerSource(source) { sources.push(source); return () => {}; } } };
  const ctx = {
    effect(fn) { fn(); },
    get(name) { return services[name]; },
    remote: { $mount: () => Promise.resolve(() => {}), chromeUseStatus: { list: async () => ({ ok: true, value: { connected: true, tabs, reason: null } }) } },
    inject(deps, fn) { fn(ctx); },
    slots: { inject(name, fn) { fn(); }, register() {} },
  };
  plugin.apply(ctx);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].trigger, '@');
});

test('a duplicate group name from another plugin does not break the settings page', async () => {
  let entry;
  vm.runInNewContext(await readFile(new URL('../src/client.js', import.meta.url), 'utf8'), { window: { __ModuleLoader__: { load(value) { entry = value; } } }, setTimeout, clearTimeout, console });
  const plugin = entry.factory(() => ({ createElement: () => null, useState: () => [{}, () => {}], useEffect() {}, useRef: () => ({}) }));
  let registered;
  const ctx = {
    effect(fn) { fn(); },
    remote: { $mount: () => Promise.resolve(() => {}), chromeUseStatus: { list: async () => ({ ok: true, value: { connected: true, tabs, reason: null } }) } },
    inject(deps, fn) { fn(ctx); },
    slots: { inject(name, fn) { fn(); }, register(spec) { registered = spec; } },
    inputTriggers: { registerSource() { throw new Error('duplicate source name'); } },
  };
  assert.doesNotThrow(() => plugin.apply(ctx));
  assert.equal(registered.id, 'dsh-chrome-use');
});
