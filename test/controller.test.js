import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserController, pageUrl } from '../extension/controller.js';
import { TOOLS, validateArgs } from '../extension/protocol.js';

function fixture() {
  const calls = [];
  const listeners = {};
  const groups = [];
  const api = {
    tabs: {
      onRemoved: { addListener(fn) { listeners.removed = fn; } },
      get: async id => ({ id, url: 'https://example.com/', title: 'Example', windowId: 1 }),
      query: async () => [7, 8].map(id => ({ id, url: 'https://example.com/', title: 'Example' })),
      create: async () => ({ id: 9, url: 'https://example.com/', windowId: 1 }),
      group: async options => { calls.push(['tabs.group', options]); return options.groupId ?? 77; },
    },
    tabGroups: {
      query: async info => { calls.push(['tabGroups.query', info]); return groups; },
      update: async (id, info) => { calls.push(['tabGroups.update', { id, ...info }]); },
    },
    debugger: {
      onDetach: { addListener(fn) { listeners.detach = fn; } },
      onEvent: { addListener(fn) { listeners.event = fn; } },
      attach: async target => calls.push(['attach', target]),
      detach: async target => { calls.push(['detach', target]); listeners.detach(target); },
      sendCommand: async (target, method, params) => {
        calls.push([method, params]);
        if (method === 'Accessibility.getFullAXTree') return { nodes: [{ role: { value: 'button' }, name: { value: 'Go' }, backendDOMNodeId: 42 }, { role: { value: 'textbox' }, name: { value: 'Password' }, value: { value: 'secret' }, backendDOMNodeId: 43 }] };
        if (method === 'DOM.resolveNode') return { object: { objectId: 'object' } };
        if (method === 'Runtime.callFunctionOn') return { result: { value: params.functionDeclaration.includes('getBoundingClientRect') ? { x: 20, y: 30, tag: 'INPUT', type: 'text' } : true } };
        return {};
      },
    },
  };
  return { controller: new BrowserController(api), api, calls, listeners, groups };
}
test('schemas reject unknown fields, invalid URL schemes and boundaries', () => {
  assert.equal(new Set(TOOLS.map(t => t.name)).size, TOOLS.length);
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'https://user:password@example.com']) assert.throws(() => validateArgs('chrome_open', { url, group: 'docs' }));
  assert.throws(() => pageUrl('chrome://extensions'));
  assert.throws(() => validateArgs('chrome_click', { tabId: -1, ref: 'r' }));
  assert.throws(() => validateArgs('chrome_scroll', { tabId: 1, deltaY: 3001 }));
  assert.throws(() => validateArgs('chrome_key', { tabId: 1, key: 'F12' }));
  assert.throws(() => validateArgs('chrome_tabs', { unexpected: 1 }));
  assert.doesNotThrow(() => validateArgs('chrome_fill', { tabId: 1, ref: 'r', text: '' }));
});
test('opening a tab requires a usable tab-group name', () => {
  assert.throws(() => validateArgs('chrome_open', { url: 'https://example.com/' }), /MISSING_ARGUMENT: group/);
  for (const group of ['', '   ', 'x'.repeat(41), 'bad\tname']) assert.throws(() => validateArgs('chrome_open', { url: 'https://example.com/', group }), /INVALID_ARGUMENT/);
  assert.equal(validateArgs('chrome_open', { url: 'https://example.com/', group: 'Office 下载' }).group, 'Office 下载');
});
test('all ordinary tabs are available without per-tab consent; internal pages stay blocked', async () => {
  const { controller, api, calls } = fixture();
  assert.deepEqual((await controller.execute('tabs', {})).tabs.map(t => t.tabId), [7, 8]);
  await controller.execute('claim', { tabId: 7 });
  assert.ok(calls.some(([method]) => method === 'Network.enable'));
  api.tabs.get = async id => ({ id, url: 'chrome://settings/' });
  await assert.rejects(controller.execute('claim', { tabId: 8 }), /UNSUPPORTED_PAGE/);
});
test('opening a tab handles Chrome pending about:blank metadata and joins its tab group', async () => {
  const { controller, api, calls } = fixture();
  api.tabs.get = async id => ({ id, url: '', pendingUrl: 'about:blank', windowId: 1 });
  const result = await controller.execute('open', { url: 'https://example.com/', group: 'MAS 文档' });
  assert.equal(result.tabId, 9);
  assert.deepEqual(result.group, { id: 77, title: 'MAS 文档' });
  assert.ok(calls.some(([method]) => method === 'Page.navigate'));
  assert.deepEqual(calls.find(([method]) => method === 'tabs.group')[1], { tabIds: [9] });
  const update = calls.find(([method]) => method === 'tabGroups.update')[1];
  assert.equal(update.title, 'MAS 文档');
  assert.equal(update.collapsed, false);
});
test('a task series reuses the group already named after it in the same window', async () => {
  const { controller, calls, groups } = fixture();
  groups.push({ id: 55, title: 'MAS 文档' });
  const result = await controller.execute('open', { url: 'https://example.com/two', group: 'MAS 文档' });
  assert.equal(result.group.id, 55);
  assert.deepEqual(calls.find(([method]) => method === 'tabGroups.query')[1], { title: 'MAS 文档', windowId: 1 });
  assert.deepEqual(calls.find(([method]) => method === 'tabs.group')[1], { tabIds: [9], groupId: 55 });
});
test('a grouping failure keeps the new tab usable and reports why', async () => {
  const { controller, api } = fixture();
  api.tabs.group = async () => { throw new Error('TAB_IS_PINNED'); };
  const result = await controller.execute('open', { url: 'https://example.com/', group: 'pinned series' });
  assert.equal(result.tabId, 9);
  assert.equal(result.group, null);
  assert.match(result.groupError, /TAB_IS_PINNED/);
});
test('snapshot omits input values and stale references cannot click after navigation', async () => {
  const { controller, listeners, calls } = fixture();
  await controller.execute('claim', { tabId: 7 });
  const snapshot = await controller.execute('snapshot', { tabId: 7 });
  assert.ok(!JSON.stringify(snapshot).includes('secret'));
  await controller.execute('click', { tabId: 7, ref: snapshot.elements[0].ref });
  assert.deepEqual(calls.filter(([method]) => method === 'Input.dispatchMouseEvent').map(([, p]) => p.type), ['mouseMoved', 'mousePressed', 'mouseReleased']);
  listeners.event({ tabId: 7 }, 'Page.frameNavigated', { frame: { id: 'main' } });
  await assert.rejects(controller.execute('click', { tabId: 7, ref: snapshot.elements[0].ref }), /STALE_ELEMENT/);
});
test('fill uses real input events, supports clearing and releases handles', async () => {
  const { controller, calls } = fixture();
  await controller.execute('claim', { tabId: 7 });
  const snapshot = await controller.execute('snapshot', { tabId: 7 });
  await controller.execute('fill', { tabId: 7, ref: snapshot.elements[1].ref, text: '中文 test' });
  assert.ok(calls.some(([method, params]) => method === 'Input.insertText' && params.text === '中文 test'));
  await controller.execute('fill', { tabId: 7, ref: snapshot.elements[1].ref, text: '' });
  assert.ok(calls.some(([method, params]) => method === 'Input.dispatchKeyEvent' && params.key === 'Backspace'));
  assert.equal(calls.filter(([method]) => method === 'Runtime.releaseObject').length, 2);
});
test('input activates background tabs; activation failure never dispatches input', async () => {
  const { controller, calls, api } = fixture();
  await controller.execute('claim', { tabId: 7 });
  const snapshot = await controller.execute('snapshot', { tabId: 7 });
  for (const [action, args] of [
    ['click', { ref: snapshot.elements[0].ref }],
    ['fill', { ref: snapshot.elements[1].ref, text: 'test' }],
    ['key', { key: 'Tab' }],
    ['scroll', { deltaY: 100 }],
  ]) {
    calls.length = 0;
    await controller.execute(action, { tabId: 7, ...args });
    assert.equal(calls[0][0], 'Page.bringToFront');
    assert.ok(calls.some(([method]) => method.startsWith('Input.')));
  }
  calls.length = 0;
  api.debugger.sendCommand = async () => { throw new Error('Target closed'); };
  await assert.rejects(controller.execute('scroll', { tabId: 7, deltaY: 100 }), /Target closed/);
  assert.equal(calls.length, 0);
});
test('disabled/obscured element failure never sends a click', async () => {
  const { controller, api, calls } = fixture();
  await controller.execute('claim', { tabId: 7 });
  const snapshot = await controller.execute('snapshot', { tabId: 7 });
  const original = api.debugger.sendCommand;
  api.debugger.sendCommand = async (target, method, params) => method === 'Runtime.callFunctionOn' ? { exceptionDetails: { exception: { description: 'ELEMENT_DISABLED' } } } : original(target, method, params);
  await assert.rejects(controller.execute('click', { tabId: 7, ref: snapshot.elements[0].ref }), /ELEMENT_DISABLED/);
  assert.ok(!calls.some(([method]) => method === 'Input.dispatchMouseEvent'));
});
test('logs are bounded and omit network query strings, headers and bodies', async () => {
  const { controller, listeners } = fixture();
  await controller.execute('claim', { tabId: 7 });
  for (let i = 0; i < 110; i++) listeners.event({ tabId: 7 }, 'Network.responseReceived', { type: 'Fetch', response: { status: 500, url: 'https://example.com/error?token=secret#private', headers: { Authorization: 'secret' } } });
  const logs = await controller.execute('logs', { tabId: 7 });
  assert.equal(logs.entries.length, 100);
  assert.equal(logs.entries[0].url, 'https://example.com/error');
  assert.ok(!JSON.stringify(logs).includes('secret'));
});
test('cancellation before execution has no side effect and reset detaches everything', async () => {
  const { controller, calls } = fixture();
  const abort = new AbortController(); abort.abort();
  await assert.rejects(controller.execute('open', { url: 'https://example.com' }, abort.signal));
  assert.equal(calls.length, 0);
  await controller.execute('claim', { tabId: 7 });
  await controller.reset();
  assert.equal(controller.attached.size, 0);
  assert.ok(calls.some(([method]) => method === 'detach'));
});
test('an attachment that completes after its timeout is detached', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { controller, api, calls } = fixture();
  let finishAttach;
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  api.debugger.attach = () => { started(); return new Promise(resolve => { finishAttach = resolve; }); };
  const claim = controller.execute('claim', { tabId: 7 });
  const rejected = assert.rejects(claim, /CHROME_TIMEOUT: attach/);
  await ready;
  t.mock.timers.tick(7001);
  await rejected;
  finishAttach();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(controller.attached.size, 0);
  assert.ok(calls.some(([method]) => method === 'detach'));
});
