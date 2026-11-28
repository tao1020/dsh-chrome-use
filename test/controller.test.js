import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserController, POINT_FN, frameCollect, keyDescriptor, pageUrl, tabLocation } from '../extension/controller.js';
import { TOOLS, validateArgs } from '../extension/protocol.js';

function fixture(overrides = {}) {
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
      update: async (id, info) => { calls.push(['tabs.update', { id, ...info }]); return { id, ...info }; },
      remove: async id => { calls.push(['tabs.remove', id]); },
    },
    windows: { update: async (id, info) => { calls.push(['windows.update', { id, ...info }]); return { id, ...info }; } },
    downloads: { search: async options => { calls.push(['downloads.search', options]); return overrides['downloads.search'] ? overrides['downloads.search'](options) : []; } },
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
        if (overrides[method]) return overrides[method](params);
        if (method === 'Accessibility.getFullAXTree') return { nodes: [{ role: { value: 'button' }, name: { value: 'Go' }, backendDOMNodeId: 42 }, { role: { value: 'textbox' }, name: { value: 'Password' }, value: { value: 'secret' }, backendDOMNodeId: 43 }, { role: { value: 'StaticText' }, name: { value: 'Go label' }, backendDOMNodeId: 44 }] };
        if (method === 'DOM.resolveNode') return { object: { objectId: 'object' } };
        if (method === 'Runtime.callFunctionOn') {
          if (params.functionDeclaration.includes('HTMLSelectElement')) return { result: { value: { value: 'b', label: 'B' } } };
          if (params.functionDeclaration.includes('window.scrollX')) return { result: { value: { x: 10, y: 20, top: 120, left: 30, width: 100, height: 50, pageHeight: 3000 } } };
          return { result: { value: params.functionDeclaration.includes('getBoundingClientRect') ? { x: 20, y: 30, tag: 'INPUT', type: 'text' } : true } };
        }
        if (method === 'Runtime.evaluate') return { result: { value: true } };
        return {};
      },
    },
  };
  return { controller: new BrowserController(api), api, calls, listeners, groups };
}
// Emulates a same-site subframe for the isolated-world path: the count query,
// the paged collector and the action guard all run through Runtime.evaluate.
function frameWorld(names, options = {}) {
  return params => {
    const expression = String(params.expression);
    if (expression.includes('node.click()')) return { result: { value: 'OK' } };
    if (expression.includes('const label =')) return { result: { value: JSON.stringify(options.guard ?? { label: names[0] ?? '', role: 'button' }) } };
    if (/\.length\s*$/.test(expression.trim())) return { result: { value: names.length } };
    const slice = expression.match(/nodes\.slice\((\d+),\s*(\d+)\)/);
    const offset = slice ? Number(slice[1]) : 0;
    const end = slice ? Number(slice[2]) : names.length;
    return { result: { value: JSON.stringify(names.slice(offset, end).map((name, position) => ({ index: offset + position, role: 'button', name }))) } };
  };
}

test('schemas reject unknown fields, invalid URL schemes and boundaries', () => {
  assert.equal(new Set(TOOLS.map(t => t.name)).size, TOOLS.length);
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'https://user:password@example.com']) assert.throws(() => validateArgs('chrome_open', { url, group: 'docs' }));
  assert.throws(() => pageUrl('chrome://extensions'));
  assert.throws(() => validateArgs('chrome_click', { tabId: -1, ref: 'r' }));
  assert.throws(() => validateArgs('chrome_scroll', { tabId: 1, deltaY: 3001 }));
  assert.doesNotThrow(() => validateArgs('chrome_key', { tabId: 1, key: 'meta+a' }));
  assert.throws(() => keyDescriptor('F12'), /INVALID_KEY/);
  assert.throws(() => validateArgs('chrome_tabs', { unexpected: 1 }));
  assert.doesNotThrow(() => validateArgs('chrome_fill', { tabId: 1, ref: 'r', text: '' }));
  assert.doesNotThrow(() => validateArgs('chrome_upload', { tabId: 1, ref: 'r', path: '/tmp/a.txt' }));
  assert.doesNotThrow(() => validateArgs('chrome_upload', { tabId: 1, ref: 'r', paths: ['/tmp/a.txt', '/tmp/b.txt'] }));
  assert.doesNotThrow(() => validateArgs('chrome_upload', { tabId: 1, chooser: true, paths: ['/tmp/a.txt'] }));
  assert.doesNotThrow(() => validateArgs('chrome_upload', { tabId: 1, chooser: true, cancel: true }));
  assert.doesNotThrow(() => validateArgs('chrome_click', { tabId: 1, ref: 'r', chooser: true }));
  assert.throws(() => validateArgs('chrome_upload', { tabId: 1, chooser: 'yes' }), /INVALID_ARGUMENT/);
  assert.throws(() => validateArgs('chrome_upload', { tabId: 1, ref: 'r', paths: '/tmp/a.txt' }), /INVALID_ARGUMENT/);
  assert.throws(() => validateArgs('chrome_dialog', { tabId: 1, accept: 'yes' }), /INVALID_ARGUMENT/);
  assert.doesNotThrow(() => validateArgs('chrome_dialog', { tabId: 1, accept: false, promptText: '' }));
  assert.doesNotThrow(() => validateArgs('chrome_wait', { tabId: 1, selector: '#ready', gone: true, timeoutMs: 12000 }));
  assert.doesNotThrow(() => validateArgs('chrome_drag', { tabId: 1, fromRef: 'r1', toText: 'Drop here', steps: 20 }));
  assert.doesNotThrow(() => validateArgs('chrome_history', { tabId: 1, action: 'back' }));
  assert.doesNotThrow(() => validateArgs('chrome_history', { tabId: 1, limit: 10 }));
  assert.doesNotThrow(() => validateArgs('chrome_doctor', {}));
  assert.doesNotThrow(() => validateArgs('chrome_doctor', { tabId: 1 }));
  assert.doesNotThrow(() => validateArgs('chrome_wait_response', { tabId: 1, urlContains: '/api', status: 200 }));
  assert.doesNotThrow(() => validateArgs('chrome_assert', { tabId: 1, selector: '#ok', timeoutMs: 500 }));
  assert.doesNotThrow(() => validateArgs('chrome_content', { tabId: 1, selector: 'main', format: 'json' }));
  assert.doesNotThrow(() => validateArgs('chrome_scrape', { tabId: 1, selector: '.card', fields: ['title: h1', 'link: a@href'] }));
  assert.throws(() => validateArgs('chrome_assert', { tabId: 1, gones: true }), /INVALID_ARGUMENT/);
  assert.throws(() => validateArgs('chrome_history', { tabId: 1, action: 'undo' }), /INVALID_ARGUMENT/);
  assert.doesNotThrow(() => validateArgs('chrome_scroll_to', { tabId: 1, ref: 'r' }));
  assert.throws(() => validateArgs('chrome_scroll_to', { tabId: 1, ref: 'r', block: 'top' }), /INVALID_ARGUMENT/);
  assert.doesNotThrow(() => validateArgs('chrome_screenshot', { tabId: 1, fullPage: true }));
  assert.doesNotThrow(() => validateArgs('chrome_pdf', { tabId: 1, landscape: true }));
  assert.doesNotThrow(() => validateArgs('chrome_activate', { tabId: 1 }));
  assert.doesNotThrow(() => validateArgs('chrome_close', { tabId: 1 }));
  assert.doesNotThrow(() => validateArgs('chrome_close', { tabId: 1, force: false }));
  assert.throws(() => validateArgs('chrome_close', { tabId: 1, force: 'yes' }), /INVALID_ARGUMENT/);
  assert.doesNotThrow(() => validateArgs('chrome_emulate', { tabId: 1, width: 390, height: 844, mobile: true, deviceScaleFactor: 3 }));
  assert.doesNotThrow(() => validateArgs('chrome_emulate', { tabId: 1, colorScheme: 'dark', network: 'offline', reset: true }));
  assert.doesNotThrow(() => validateArgs('chrome_emulate', { tabId: 1, timezone: '', locale: '' }));
  assert.throws(() => validateArgs('chrome_emulate', { tabId: 1, colorScheme: 'sepia' }), /INVALID_ARGUMENT/);
  assert.throws(() => validateArgs('chrome_emulate', { tabId: 1, cpuThrottlingRate: 21 }), /out of range/);
  assert.throws(() => validateArgs('chrome_emulate', { tabId: 1, width: 100, height: 100 }), /out of range/);
});
test('emulation applies viewport, media, network, CPU, timezone and locale', async () => {
  const { controller, calls } = fixture();
  await controller.execute('claim', { tabId: 7 });
  const result = await controller.execute('emulate', { tabId: 7, width: 390, height: 844, mobile: true, deviceScaleFactor: 3, colorScheme: 'dark', reducedMotion: 'reduce', forcedColors: 'active', network: 'slow-3g', cpuThrottlingRate: 4, timezone: 'Asia/Tokyo', locale: 'ja-JP' });
  assert.deepEqual(result.emulation.viewport, { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  const metrics = calls.find(([method]) => method === 'Emulation.setDeviceMetricsOverride');
  assert.equal(metrics[1].width, 390);
  assert.equal(metrics[1].mobile, true);
  assert.deepEqual(metrics[1].screenOrientation, { type: 'portraitPrimary', angle: 0 });
  const media = calls.find(([method]) => method === 'Emulation.setEmulatedMedia');
  assert.deepEqual(media[1].features, [
    { name: 'prefers-color-scheme', value: 'dark' },
    { name: 'prefers-reduced-motion', value: 'reduce' },
    { name: 'forced-colors', value: 'active' },
  ]);
  const network = calls.find(([method]) => method === 'Network.emulateNetworkConditions');
  assert.equal(network[1].latency, 400);
  assert.equal(network[1].offline, false);
  assert.ok(calls.some(([method, params]) => method === 'Emulation.setCPUThrottlingRate' && params.rate === 4));
  assert.ok(calls.some(([method, params]) => method === 'Emulation.setTimezoneOverride' && params.timezone === 'Asia/Tokyo'));
  assert.ok(calls.some(([method, params]) => method === 'Emulation.setLocaleOverride' && params.locale === 'ja-JP'));
});
test('emulation accumulates per tab, is reported by doctor and cleared on release', async () => {
  const { controller, calls } = fixture();
  await controller.execute('claim', { tabId: 7 });
  await controller.execute('emulate', { tabId: 7, width: 1280, height: 800 });
  await controller.execute('emulate', { tabId: 7, colorScheme: 'dark' });
  assert.equal(controller.attached.get(7).emulation.viewport.width, 1280);
  assert.equal(controller.attached.get(7).emulation.colorScheme, 'dark');
  assert.equal(calls.filter(([method]) => method === 'Emulation.setDeviceMetricsOverride').length, 1);
  const doctor = await controller.execute('doctor', { tabId: 7 });
  assert.equal(doctor.emulation.colorScheme, 'dark');
  await controller.execute('release', { tabId: 7 });
  assert.ok(calls.some(([method]) => method === 'Emulation.clearDeviceMetricsOverride'));
  assert.equal(controller.attached.has(7), false);
});
test('emulation reset clears every override', async () => {
  const { controller, calls } = fixture();
  await controller.execute('claim', { tabId: 7 });
  await controller.execute('emulate', { tabId: 7, width: 390, height: 844, network: 'offline' });
  const result = await controller.execute('emulate', { tabId: 7, reset: true });
  assert.equal(result.cleared, true);
  assert.equal(controller.attached.get(7).emulation, null);
  assert.ok(calls.some(([method]) => method === 'Emulation.clearDeviceMetricsOverride'));
  const network = calls.filter(([method]) => method === 'Network.emulateNetworkConditions').at(-1);
  assert.equal(network[1].offline, false);
  assert.equal(network[1].downloadThroughput, -1);
});
test('emulation rejects a half viewport and a viewport-less first call', async () => {
  const { controller } = fixture();
  await controller.execute('claim', { tabId: 7 });
  await assert.rejects(controller.execute('emulate', { tabId: 7, width: 390 }), /EMULATE_ARGS/);
  await assert.rejects(controller.execute('emulate', { tabId: 7, mobile: true }), /EMULATE_ARGS/);
  await assert.rejects(controller.execute('emulate', { tabId: 7 }), /EMULATE_ARGS/);
  await assert.doesNotReject(controller.execute('emulate', { tabId: 7, width: 390, height: 844 }));
});
test('a rejected emulation call clears partial overrides and reports EMULATION_FAILED', async () => {
  const { controller, api } = fixture();
  await controller.execute('claim', { tabId: 7 });
  const original = api.debugger.sendCommand;
  api.debugger.sendCommand = async (target, method, params) => {
    if (method === 'Emulation.setCPUThrottlingRate') throw new Error('method not found');
    return original(target, method, params);
  };
  await assert.rejects(controller.execute('emulate', { tabId: 7, width: 400, height: 400, cpuThrottlingRate: 2 }), /EMULATION_FAILED/);
  assert.equal(controller.attached.get(7).emulation, null);
});
test('a frozen argument object is validated without being mutated', () => {
  const frozen = Object.freeze({ tabId: '183950055', expression: '1' });
  assert.deepEqual(validateArgs('chrome_evaluate', frozen), { tabId: 183950055, expression: '1' });
  assert.equal(frozen.tabId, '183950055');
});
test('a numeric tab id sent as a string is accepted instead of rejected', () => {
  assert.deepEqual(validateArgs('chrome_evaluate', { tabId: '183950055', expression: '1' }).tabId, 183950055);
  assert.deepEqual(validateArgs('chrome_snapshot', { tabId: ' 7 ' }).tabId, 7);
  assert.throws(() => validateArgs('chrome_snapshot', { tabId: 'abc' }), /INVALID_ARGUMENT: tabId \(expected integer, received string\)/);
  assert.throws(() => validateArgs('chrome_snapshot', { tabId: 1.5 }), /INVALID_ARGUMENT: tabId/);
  assert.throws(() => validateArgs('chrome_snapshot', { tabId: 0 }), /out of range/);
  assert.throws(() => validateArgs('chrome_snapshot', { tabId: null }), /received null/);
});
test('opening a tab requires a usable tab-group name', () => {
  assert.throws(() => validateArgs('chrome_open', { url: 'https://example.com/' }), /MISSING_ARGUMENT: group/);
  for (const group of ['', '   ', 'x'.repeat(41), 'bad\tname']) assert.throws(() => validateArgs('chrome_open', { url: 'https://example.com/', group }), /INVALID_ARGUMENT/);
  assert.equal(validateArgs('chrome_open', { url: 'https://example.com/', group: 'Office 下载' }).group, 'Office 下载');
});
test('free-form text keeps newlines while a tab-group name must stay single-line', () => {
  assert.doesNotThrow(() => validateArgs('chrome_evaluate', { tabId: 1, expression: 'a\nb()' }));
  assert.doesNotThrow(() => validateArgs('chrome_fill', { tabId: 1, ref: 'r', text: 'line one\nline two' }));
});
test('all ordinary tabs are available without per-tab consent; internal pages stay blocked', async () => {
  const { controller, api, calls } = fixture();
  assert.deepEqual((await controller.execute('tabs', {})).tabs.map(t => t.tabId), [7, 8]);
  await controller.execute('claim', { tabId: 7 });
  assert.ok(calls.some(([method]) => method === 'Network.enable'));
  api.tabs.get = async id => ({ id, url: 'chrome://settings/' });
  await assert.rejects(controller.execute('claim', { tabId: 8 }), /UNSUPPORTED_PAGE/);
});
test('detaching one tab keeps other attached tabs usable', async () => {
  const { controller, calls } = fixture();
  await controller.execute('claim', { tabId: 7 });
  await controller.execute('claim', { tabId: 8 });
  assert.equal(controller.attached.size, 2);
  await controller.detachTab(7);
  assert.equal(controller.attached.has(7), false);
  assert.equal(controller.attached.has(8), true);
  assert.ok(calls.some(([method, target]) => method === 'detach' && target.tabId === 7));
  assert.equal((await controller.execute('snapshot', { tabId: 8, format: 'markdown' })).format, 'markdown');
});
test('intentional detach notifies once even when Chrome emits no detach event', async () => {
  for (const emitsEvent of [false, true]) {
    const { api, listeners } = fixture();
    const notifications = [];
    const controller = new BrowserController(api, tabId => notifications.push(tabId));
    api.debugger.detach = async target => { if (emitsEvent) listeners.detach(target); };
    await controller.execute('claim', { tabId: 7 });
    await controller.execute('release', { tabId: 7 });
    assert.deepEqual(notifications, [7]);
    listeners.removed(7);
    assert.deepEqual(notifications, [7]);
  }
});
test('a timed-out native detach quarantines the tab until Chrome finishes cleanup', async () => {
  const { controller, api, calls } = fixture();
  await controller.execute('claim', { tabId: 7 });
  let finishDetach;
  api.debugger.detach = () => new Promise(resolve => { finishDetach = resolve; });
  await assert.rejects(controller.detachTab(7), /CHROME_TIMEOUT: detach/);
  const attempts = calls.filter(([method]) => method === 'attach').length;
  await assert.rejects(controller.execute('claim', { tabId: 7 }, AbortSignal.timeout(20)), /COMMAND_CANCELED/);
  assert.equal(calls.filter(([method]) => method === 'attach').length, attempts);
  finishDetach();
  await controller.execute('claim', { tabId: 7 });
  assert.equal(calls.filter(([method]) => method === 'attach').length, attempts + 1);
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
test('open advertises the created tab before grouping and fails closed on a lease collision', async () => {
  const { controller, api, calls } = fixture();
  let reserved;
  const result = await controller.execute('open', { url: 'https://example.com/', group: 'series' }, undefined, { onTabCreated: tabId => { reserved = tabId; assert.deepEqual(calls.find(([method]) => method === 'tabs.group'), undefined); return true; } });
  assert.equal(reserved, 9);
  assert.equal(result.tabId, 9);
  await controller.execute('claim', { tabId: 7 });
  const before = calls.filter(([method]) => method === 'detach').length;
  api.tabs.create = async () => ({ id: 7, url: 'about:blank', windowId: 1 });
  await assert.rejects(controller.execute('open', { url: 'https://example.com/', group: 'series' }, undefined, { onTabCreated: () => false }), /LEASE_CONFLICT/);
  assert.equal(calls.filter(([method]) => method === 'detach').length, before);
});
test('closing a tab removes it and forgets its debugger state', async () => {
  const { controller, calls } = fixture();
  await controller.execute('claim', { tabId: 7 });
  assert.equal(controller.attached.has(7), true);
  assert.deepEqual(await controller.execute('close', { tabId: 7 }), { tabId: 7, closed: true, forcedBeforeUnload: true });
  assert.deepEqual(calls.find(([method]) => method === 'tabs.remove'), ['tabs.remove', 7]);
  assert.equal(controller.attached.has(7), false);
});
test('close skips the beforeunload dialog by closing the target directly', async () => {
  const { controller, calls } = fixture({
    'Target.getTargetInfo': () => ({ targetInfo: { targetId: 'target-7' } }),
  });
  await controller.execute('claim', { tabId: 7 });
  const result = await controller.execute('close', { tabId: 7 });
  assert.equal(result.forcedBeforeUnload, true);
  assert.ok(calls.some(([method, params]) => method === 'Target.closeTarget' && params.targetId === 'target-7'));
  assert.ok(!calls.some(([method]) => method === 'tabs.remove'));
});
test('close auto-accepts a beforeunload prompt by default', async () => {
  const { controller, api, calls, listeners } = fixture();
  await controller.execute('claim', { tabId: 7 });
  api.tabs.remove = async id => {
    calls.push(['tabs.remove', id]);
    listeners.event({ tabId: id }, 'Page.javascriptDialogOpening', { type: 'beforeunload', message: 'Leave?' });
  };
  calls.length = 0;
  const result = await controller.execute('close', { tabId: 7 });
  assert.equal(result.forcedBeforeUnload, true);
  assert.ok(calls.some(([method, params]) => method === 'Page.handleJavaScriptDialog' && params.accept === true));
});
test('close with force=false leaves a beforeunload prompt to the user', async () => {
  const { controller, api, calls, listeners } = fixture();
  await controller.execute('claim', { tabId: 7 });
  api.tabs.remove = async id => {
    calls.push(['tabs.remove', id]);
    listeners.event({ tabId: id }, 'Page.javascriptDialogOpening', { type: 'beforeunload', message: 'Leave?' });
  };
  calls.length = 0;
  const result = await controller.execute('close', { tabId: 7, force: false });
  assert.equal(result.forcedBeforeUnload, false);
  assert.ok(!calls.some(([method]) => method === 'Page.handleJavaScriptDialog'));
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
test('click forwards the requested button and click count', async () => {
  const { controller, calls } = fixture();
  await controller.execute('claim', { tabId: 7 });
  const snapshot = await controller.execute('snapshot', { tabId: 7 });
  await controller.execute('click', { tabId: 7, ref: snapshot.elements[0].ref, button: 'right', count: 2 });
  const pressed = calls.find(([method, params]) => method === 'Input.dispatchMouseEvent' && params.type === 'mousePressed')[1];
  assert.equal(pressed.button, 'right');
  assert.equal(pressed.buttons, 2);
  assert.equal(pressed.clickCount, 2);
});

test('hover moves the pointer without pressing a button', async () => {
  const { controller, calls } = fixture();
  await controller.execute('claim', { tabId: 7 });
  const snapshot = await controller.execute('snapshot', { tabId: 7 });
  const result = await controller.execute('hover', { tabId: 7, ref: snapshot.elements[0].ref });
  assert.deepEqual([result.x, result.y], [20, 30]);
  const mouse = calls.filter(([method]) => method === 'Input.dispatchMouseEvent').map(([, params]) => params.type);
  assert.deepEqual(mouse, ['mouseMoved']);
});

test('hover accepts a selector, matching the schema', async () => {
  const { controller, calls } = fixture({
    'Runtime.evaluate': params => {
      assert.match(params.expression, /querySelector\("#hover"\)/);
      return { result: { value: { x: 100, y: 200 } } };
    },
  });
  await controller.execute('claim', { tabId: 7 });
  const result = await controller.execute('hover', { tabId: 7, selector: '#hover' });
  assert.deepEqual([result.x, result.y], [100, 200]);
  const moved = calls.find(([method, params]) => method === 'Input.dispatchMouseEvent' && params.type === 'mouseMoved')[1];
  assert.deepEqual([moved.x, moved.y], [100, 200]);
});

test('hover still rejects a call with neither ref, selector nor coordinates', async () => {
  const { controller } = fixture();
  await controller.execute('claim', { tabId: 7 });
  await assert.rejects(controller.execute('hover', { tabId: 7 }), /HOVER_TARGET: give ref, selector, or x and y/);
});

test('drag with toText pins the target so a page rewrite cannot break the drop', async () => {
  const plan = { a: { x: 10, y: 20 }, b: { x: 120, y: 160 }, native: true, aIn: true, bIn: true };
  const expressions = [];
  const { controller, calls } = fixture({
    'Runtime.evaluate': params => {
      expressions.push(params.expression);
      if (params.expression.includes('aIn')) return { result: { value: plan } };
      return { result: { value: { accepted: true } } };
    },
  });
  await controller.execute('claim', { tabId: 7 });
  const snapshot = await controller.execute('snapshot', { tabId: 7 });
  await controller.execute('drag', { tabId: 7, fromRef: snapshot.elements[0].ref, toText: '放置区' });
  const planExpression = expressions.find(text => text.includes('aIn'));
  assert.match(planExpression, /setAttribute\('data-dsh-drag-dst'/);
  const dropExpression = expressions.find(text => text.includes('DragEvent'));
  assert.match(dropExpression, /data-dsh-drag-dst/);
  assert.doesNotMatch(dropExpression, /innerText/);
});

test('networkIdle forgets requests that belong to the previous document', async () => {
  const { controller, listeners } = fixture();
  await controller.execute('claim', { tabId: 7 });
  listeners.event({ tabId: 7 }, 'Network.requestWillBeSent', { requestId: 'r1', request: { url: 'https://example.com/slow' } });
  listeners.event({ tabId: 7 }, 'Page.frameNavigated', { frame: { id: 7, parentId: undefined } });
  const quiet = await controller.execute('wait', { tabId: 7, networkIdle: true, timeoutMs: 2000 });
  assert.equal(quiet.gone, false);
  assert.ok(quiet.waitedMs < 2000);
});

test('select sets the option through the page and reports its label', async () => {
  const { controller } = fixture();
  await controller.execute('claim', { tabId: 7 });
  const snapshot = await controller.execute('snapshot', { tabId: 7 });
  const result = await controller.execute('select', { tabId: 7, ref: snapshot.elements[0].ref, value: 'b' });
  assert.deepEqual(result, { tabId: 7, value: 'b', label: 'B' });
});

test('key combinations use modifiers and named keys keep their text', async () => {
  const { controller, calls } = fixture();
  await controller.execute('claim', { tabId: 7 });
  await controller.execute('key', { tabId: 7, key: 'meta+a' });
  let down = calls.filter(([method, params]) => method === 'Input.dispatchKeyEvent' && params.type === 'rawKeyDown').at(-1)[1];
  assert.equal(down.key, 'a');
  assert.equal(down.modifiers, 4);
  assert.equal(down.windowsVirtualKeyCode, 65);
  calls.length = 0;
  await controller.execute('key', { tabId: 7, key: 'Enter' });
  down = calls.find(([method, params]) => method === 'Input.dispatchKeyEvent' && params.type === 'keyDown')[1];
  assert.equal(down.text, '\r');
});

test('a pending dialog is reported in the snapshot and can be accepted', async () => {
  const { controller, calls, listeners } = fixture();
  await controller.execute('claim', { tabId: 7 });
  listeners.event({ tabId: 7 }, 'Page.javascriptDialogOpening', { type: 'confirm', message: 'Sure?' });
  const snapshot = await controller.execute('snapshot', { tabId: 7 });
  assert.deepEqual(snapshot.dialog, { type: 'confirm', message: 'Sure?', defaultPrompt: '' });
  const result = await controller.execute('dialog', { tabId: 7, accept: true });
  assert.equal(result.accepted, true);
  assert.ok(calls.some(([method, params]) => method === 'Page.handleJavaScriptDialog' && params.accept === true));
  assert.equal((await controller.execute('snapshot', { tabId: 7 })).dialog, null);
});

test('wait requires exactly one condition and returns as soon as it is visible', async () => {
  const { controller } = fixture();
  await controller.execute('claim', { tabId: 7 });
  await assert.rejects(controller.execute('wait', { tabId: 7 }), /WAIT_CONDITION/);
  await assert.rejects(controller.execute('wait', { tabId: 7, selector: '#ready', text: 'Ready' }), /WAIT_CONDITION/);
  const result = await controller.execute('wait', { tabId: 7, selector: '#ready', timeoutMs: 1000 });
  assert.equal(result.gone, false);
  assert.ok(result.waitedMs >= 0);
});

test('upload sends the checked file paths to the file input', async () => {
  const { controller, calls } = fixture();
  await controller.execute('claim', { tabId: 7 });
  const snapshot = await controller.execute('snapshot', { tabId: 7 });
  const result = await controller.execute('upload', { tabId: 7, ref: snapshot.elements[0].ref, path: '/tmp/report.txt' });
  assert.deepEqual(result.files, ['report.txt']);
  const call = calls.find(([method]) => method === 'DOM.setFileInputFiles');
  assert.deepEqual(call[1], { files: ['/tmp/report.txt'], backendNodeId: 42 });

  const multiple = await controller.execute('upload', { tabId: 7, ref: snapshot.elements[0].ref, paths: ['/tmp/a.txt', '/tmp/b.txt'] });
  assert.deepEqual(multiple.files, ['a.txt', 'b.txt']);
  assert.deepEqual(calls.filter(([method]) => method === 'DOM.setFileInputFiles').at(-1)[1].files, ['/tmp/a.txt', '/tmp/b.txt']);
  await assert.rejects(controller.execute('upload', { tabId: 7, ref: snapshot.elements[0].ref }), /UPLOAD_TARGET/);
  await assert.rejects(controller.execute('upload', { tabId: 7, ref: snapshot.elements[0].ref, path: '/tmp/a.txt', paths: ['/tmp/b.txt'] }), /UPLOAD_TARGET/);
});

test('click arms file-chooser interception before the mouse events', async () => {
  const { controller, calls } = fixture();
  controller.chooserWaitMs = 20;
  await controller.execute('claim', { tabId: 7 });
  const snapshot = await controller.execute('snapshot', { tabId: 7 });
  calls.length = 0;
  const result = await controller.execute('click', { tabId: 7, ref: snapshot.elements[0].ref, chooser: true });
  const armed = calls.findIndex(([method]) => method === 'Page.setInterceptFileChooserDialog');
  const clicked = calls.findIndex(([method]) => method === 'Input.dispatchMouseEvent');
  assert.ok(armed >= 0 && armed < clicked);
  assert.deepEqual(calls[armed][1], { enabled: true });
  assert.equal(result.chooserArmed, true);
  assert.equal(result.chooserMode, null);
  await controller.detachTab(7);
});

test('upload with chooser injects files into the detached input behind the chooser', async () => {
  const { controller, calls, listeners } = fixture();
  await controller.execute('claim', { tabId: 7 });
  listeners.event({ tabId: 7 }, 'Page.fileChooserOpened', { frameId: 'frame-1', mode: 'selectSingle', backendNodeId: 99 });
  const result = await controller.execute('upload', { tabId: 7, chooser: true, paths: ['/tmp/a.diag'] });
  assert.deepEqual(result, { tabId: 7, files: ['a.diag'], chooserMode: 'selectSingle', frameId: 'frame-1' });
  assert.deepEqual(calls.find(([method]) => method === 'DOM.setFileInputFiles')[1], { files: ['/tmp/a.diag'], backendNodeId: 99 });
  assert.deepEqual(calls.filter(([method]) => method === 'Page.setInterceptFileChooserDialog').at(-1)[1], { enabled: false });
  // The consumed chooser must not linger: a second upload has nothing to consume.
  await assert.rejects(controller.execute('upload', { tabId: 7, chooser: true, paths: ['/tmp/a.diag'], timeoutMs: 100 }), /FILE_CHOOSER_NOT_OPEN/);
});

test('upload with chooser injects every file of a multiple chooser', async () => {
  const { controller, calls, listeners } = fixture();
  await controller.execute('claim', { tabId: 7 });
  listeners.event({ tabId: 7 }, 'Page.fileChooserOpened', { frameId: 'frame-2', mode: 'selectMultiple', backendNodeId: 7 });
  const result = await controller.execute('upload', { tabId: 7, chooser: true, paths: ['/tmp/a.diag', '/tmp/b.diag'] });
  assert.deepEqual(result.files, ['a.diag', 'b.diag']);
  assert.equal(result.chooserMode, 'selectMultiple');
  assert.deepEqual(calls.find(([method]) => method === 'DOM.setFileInputFiles')[1].files, ['/tmp/a.diag', '/tmp/b.diag']);
});

test('upload can cancel a pending chooser without injecting files', async () => {
  const { controller, calls, listeners } = fixture();
  await controller.execute('claim', { tabId: 7 });
  listeners.event({ tabId: 7 }, 'Page.fileChooserOpened', { frameId: 'frame-3', mode: 'selectSingle', backendNodeId: 5 });
  const result = await controller.execute('upload', { tabId: 7, chooser: true, cancel: true });
  assert.deepEqual(result, { tabId: 7, canceled: true, chooserMode: 'selectSingle', frameId: 'frame-3' });
  assert.ok(!calls.some(([method]) => method === 'DOM.setFileInputFiles'));
  assert.deepEqual(calls.filter(([method]) => method === 'Page.setInterceptFileChooserDialog').at(-1)[1], { enabled: false });
});

test('upload without a pending chooser fails fast instead of hanging', async () => {
  const { controller } = fixture();
  await controller.execute('claim', { tabId: 7 });
  await assert.rejects(controller.execute('upload', { tabId: 7, chooser: true, paths: ['/tmp/a.diag'], timeoutMs: 100 }), /FILE_CHOOSER_NOT_OPEN/);
  await assert.rejects(controller.execute('upload', { tabId: 7, chooser: true, paths: ['/tmp/a.diag'], ref: 'r1' }), /UPLOAD_TARGET/);
});

test('a pending chooser nobody consumes is canceled by its timeout', async () => {
  const { controller, calls, listeners } = fixture();
  controller.chooserPendingMs = 20;
  await controller.execute('claim', { tabId: 7 });
  listeners.event({ tabId: 7 }, 'Page.fileChooserOpened', { frameId: 'frame-4', mode: 'selectSingle', backendNodeId: 3 });
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.deepEqual(calls.filter(([method]) => method === 'Page.setInterceptFileChooserDialog').at(-1)[1], { enabled: false });
  await assert.rejects(controller.execute('upload', { tabId: 7, chooser: true, paths: ['/tmp/a.diag'], timeoutMs: 100 }), /FILE_CHOOSER_NOT_OPEN/);
});

test('a chooser this session cannot address reports FILE_CHOOSER_INJECT_FAILED', async () => {
  const { controller, api, listeners } = fixture();
  await controller.execute('claim', { tabId: 7 });
  const original = api.debugger.sendCommand;
  api.debugger.sendCommand = async (target, method, params) => method === 'DOM.setFileInputFiles'
    ? Promise.reject(new Error('No node with given id found'))
    : original(target, method, params);
  listeners.event({ tabId: 7 }, 'Page.fileChooserOpened', { frameId: 'oopif-frame', mode: 'selectSingle', backendNodeId: 8 });
  await assert.rejects(controller.execute('upload', { tabId: 7, chooser: true, paths: ['/tmp/a.diag'] }), /FILE_CHOOSER_INJECT_FAILED.*oopif-frame/);
});

test('wait can pause until the network has been quiet for 500 ms', async () => {
  const { controller } = fixture();
  await controller.execute('claim', { tabId: 7 });
  const started = Date.now();
  const result = await controller.execute('wait', { tabId: 7, networkIdle: true, timeoutMs: 2000 });
  assert.equal(result.gone, false);
  assert.ok(Date.now() - started >= 450);
});

test('pdf prints the page with background and orientation options', async () => {
  const { controller, calls } = fixture({ 'Page.printToPDF': () => ({ data: 'JVBERi0xLjQK' }) });
  await controller.execute('claim', { tabId: 7 });
  const result = await controller.execute('pdf', { tabId: 7, landscape: true, paperWidth: 11 });
  assert.equal(result.data, 'JVBERi0xLjQK');
  const call = calls.find(([method]) => method === 'Page.printToPDF')[1];
  assert.equal(call.printBackground, true);
  assert.equal(call.landscape, true);
  assert.equal(call.paperWidth, 11);
  assert.equal(call.paperHeight, undefined);
});

test('drag sends a full press-move-release sequence for mouse drags', async () => {
  const plan = { a: { x: 10, y: 20 }, b: { x: 110, y: 220 }, native: false, aIn: true, bIn: true };
  const { controller, calls } = fixture({
    'Runtime.evaluate': params => params.expression.includes('aIn') ? { result: { value: plan } } : { result: { value: true } },
  });
  await controller.execute('claim', { tabId: 7 });
  const snapshot = await controller.execute('snapshot', { tabId: 7 });
  await controller.execute('drag', { tabId: 7, fromRef: snapshot.elements[0].ref, toX: 110, toY: 220, steps: 3 });
  const mouse = calls.filter(([method]) => method === 'Input.dispatchMouseEvent').map(([, params]) => params.type);
  assert.deepEqual(mouse, ['mouseMoved', 'mousePressed', 'mouseMoved', 'mouseMoved', 'mouseMoved', 'mouseReleased']);
  assert.equal(calls.find(([method, params]) => method === 'Input.dispatchMouseEvent' && params.type === 'mouseReleased')[1].x, 110);
});

test('background mode makes the tab current without focusing its window and never dispatches after a failed activation', async () => {
  const { controller, calls, api } = fixture();
  controller.foregroundMode = false;
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
    assert.deepEqual(calls.find(([method]) => method === 'tabs.update'), ['tabs.update', { id: 7, active: true }]);
    assert.ok(calls.some(([method, params]) => method === 'Runtime.evaluate' && params.expression === 'document.visibilityState'));
    assert.ok(calls.some(([method]) => method.startsWith('Input.')));
    assert.ok(!calls.some(([method]) => method === 'Page.bringToFront' || method === 'windows.update'));
  }
  calls.length = 0;
  api.tabs.update = async () => { throw new Error('TAB_CLOSED'); };
  await assert.rejects(controller.execute('scroll', { tabId: 7, deltaY: 100 }), /TAB_CLOSED/);
  assert.ok(!calls.some(([method]) => method.startsWith('Input.')));
});
test('foreground mode raises the window instead of switching tabs in place', async () => {
  const { controller, calls } = fixture();
  await controller.execute('claim', { tabId: 7 });
  const snapshot = await controller.execute('snapshot', { tabId: 7 });
  calls.length = 0;
  await controller.execute('click', { tabId: 7, ref: snapshot.elements[0].ref });
  assert.equal(calls[0][0], 'Page.bringToFront');
  assert.ok(!calls.some(([method]) => method === 'tabs.update'));
  assert.ok(calls.some(([method]) => method === 'Input.dispatchMouseEvent'));
});
test('a hidden tab fails with PAGE_HIDDEN instead of clicking into nothing', async () => {
  const { controller, calls } = fixture({
    'Runtime.evaluate': params => params.expression === 'document.visibilityState' ? { result: { value: 'hidden' } } : { result: { value: true } },
  });
  controller.foregroundMode = false;
  await controller.execute('claim', { tabId: 7 });
  const snapshot = await controller.execute('snapshot', { tabId: 7 });
  calls.length = 0;
  await assert.rejects(controller.execute('click', { tabId: 7, ref: snapshot.elements[0].ref }), /PAGE_HIDDEN/);
  assert.ok(!calls.some(([method]) => method.startsWith('Input.')));
  assert.ok(!calls.some(([method]) => method === 'Page.bringToFront' || method === 'windows.update'));
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


test('an abandoned native attach cannot race a later claim', async () => {
  const { controller, api } = fixture();
  let finishAttach;
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  let attempts = 0;
  api.debugger.attach = () => {
    attempts++;
    if (attempts > 1) return Promise.resolve();
    markStarted();
    return new Promise(resolve => { finishAttach = resolve; });
  };
  const cancellation = new AbortController();
  const old = controller.execute('claim', { tabId: 7 }, cancellation.signal);
  await started;
  cancellation.abort();
  await assert.rejects(old, /COMMAND_CANCELED/);
  try {
    await assert.rejects(controller.execute('claim', { tabId: 7 }, AbortSignal.timeout(20)), /COMMAND_CANCELED/);
    assert.equal(attempts, 1);
  } finally { finishAttach(); }
  await controller.execute('claim', { tabId: 7 });
  assert.equal(attempts, 2);
});

test('activate brings the tab forward and focuses its window', async () => {
  const { controller, calls } = fixture();
  await controller.execute('claim', { tabId: 7 });
  const result = await controller.execute('activate', { tabId: 7 });
  assert.deepEqual(result, { tabId: 7, active: true, windowId: 1, windowFocused: true });
  assert.deepEqual(calls.find(([method]) => method === 'tabs.update'), ['tabs.update', { id: 7, active: true }]);
  assert.deepEqual(calls.find(([method]) => method === 'windows.update'), ['windows.update', { id: 1, focused: true }]);
});

test('scroll_to aligns a ref or selector and reports the final position', async () => {
  const { controller, calls } = fixture();
  await controller.execute('claim', { tabId: 7 });
  const snapshot = await controller.execute('snapshot', { tabId: 7 });
  const byRef = await controller.execute('scroll_to', { tabId: 7, ref: snapshot.elements[0].ref, block: 'end' });
  assert.equal(byRef.top, 120);
  assert.equal(byRef.pageHeight, 3000);
  const scrollCall = calls.find(([method, params]) => method === 'Runtime.callFunctionOn' && params.functionDeclaration.includes('scrollIntoView'));
  assert.equal(scrollCall[1].arguments[0].value, 'end');
  await assert.rejects(controller.execute('scroll_to', { tabId: 7 }), /SCROLL_TARGET/);
  await assert.rejects(controller.execute('scroll_to', { tabId: 7, ref: 'r', selector: 'main' }), /SCROLL_TARGET/);
});

test('scroll_to accepts a selector without needing a snapshot ref', async () => {
  const { controller, calls } = fixture({
    'Runtime.evaluate': () => ({ result: { value: { x: 0, y: 400, top: 500, left: 0, width: 20, height: 10, pageHeight: 2000 } } }),
  });
  await controller.execute('claim', { tabId: 7 });
  const result = await controller.execute('scroll_to', { tabId: 7, selector: '#target', block: 'start' });
  assert.equal(result.y, 400);
  const expression = calls.find(([method, params]) => method === 'Runtime.evaluate' && params.expression.includes('scrollIntoView'))[1].expression;
  assert.match(expression, /"start"|'start'/);
  assert.match(expression, /#target/);
});

test('history goes back and forward by entry id and waits for the load event', async () => {
  const history = { currentIndex: 1, entries: [{ id: 10 }, { id: 11 }, { id: 12 }] };
  const { controller, calls, listeners } = fixture({ 'Page.getNavigationHistory': () => history });
  await controller.execute('claim', { tabId: 7 });
  const back = controller.execute('history', { tabId: 7, action: 'back' });
  await new Promise(resolve => setTimeout(resolve, 20));
  listeners.event({ tabId: 7 }, 'Page.loadEventFired', {});
  assert.equal((await back).loaded, true);
  assert.equal(calls.find(([method]) => method === 'Page.navigateToHistoryEntry')[1].entryId, 10);

  history.currentIndex = 0;
  await assert.rejects(controller.execute('history', { tabId: 7, action: 'back' }), /NO_BACK_HISTORY/);
  history.currentIndex = 2;
  await assert.rejects(controller.execute('history', { tabId: 7, action: 'forward' }), /NO_FORWARD_HISTORY/);
});

test('reload waits for load and reports the refreshed tab', async () => {
  const { controller, calls, listeners } = fixture();
  await controller.execute('claim', { tabId: 7 });
  const reload = controller.execute('history', { tabId: 7, action: 'reload' });
  await new Promise(resolve => setTimeout(resolve, 20));
  listeners.event({ tabId: 7 }, 'Page.loadEventFired', {});
  const result = await reload;
  assert.equal(result.action, 'reload');
  assert.equal(result.loaded, true);
  assert.ok(calls.some(([method]) => method === 'Page.reload'));
});

test('screenshot captures the full page or one element with a page clip', async () => {
  const { controller, calls } = fixture({
    'Page.getLayoutMetrics': () => ({ cssContentSize: { width: 1200, height: 3000 } }),
    'Page.captureScreenshot': () => ({ data: 'png' }),
  });
  await controller.execute('claim', { tabId: 7 });
  await controller.execute('screenshot', { tabId: 7, fullPage: true });
  let shot = calls.filter(([method]) => method === 'Page.captureScreenshot').at(-1)[1];
  assert.deepEqual(shot.clip, { x: 0, y: 0, width: 1200, height: 3000, scale: 1 });
  assert.equal(shot.captureBeyondViewport, true);

  const snapshot = await controller.execute('snapshot', { tabId: 7 });
  await controller.execute('screenshot', { tabId: 7, ref: snapshot.elements[0].ref });
  shot = calls.filter(([method]) => method === 'Page.captureScreenshot').at(-1)[1];
  assert.deepEqual(shot.clip, { x: 10, y: 20, width: 100, height: 50, scale: 1 });

  await assert.rejects(controller.execute('screenshot', { tabId: 7, fullPage: true, ref: 'r' }), /SCREENSHOT_TARGET/);
});

test('click hit-testing accepts the shadow host that renders the target', async () => {
  const { controller, calls } = fixture();
  await controller.execute('claim', { tabId: 7 });
  const snapshot = await controller.execute('snapshot', { tabId: 7 });
  await controller.execute('click', { tabId: 7, ref: snapshot.elements[0].ref });
  const locate = calls.find(([method, params]) => method === 'Runtime.callFunctionOn' && params.functionDeclaration.includes('ELEMENT_OBSCURED_OR_IN_FRAME'));
  assert.match(locate[1].functionDeclaration, /getRootNode/);
});

test('snapshot skips static text nodes that cannot be scrolled or clicked', async () => {
  const { controller } = fixture();
  await controller.execute('claim', { tabId: 7 });
  const snapshot = await controller.execute('snapshot', { tabId: 7 });
  assert.deepEqual(snapshot.elements.map(e => e.name), ['Go', 'Password']);
  assert.ok(snapshot.elements.every(e => e.ref));
});

test('click returns once a page dialog opens, even if the mouse command is still blocked', async () => {
  const { controller, api, listeners } = fixture();
  await controller.execute('claim', { tabId: 7 });
  const original = api.debugger.sendCommand;
  api.debugger.sendCommand = async (target, method, params) => {
    if (method === 'Input.dispatchMouseEvent' && params.type === 'mouseReleased') {
      setTimeout(() => listeners.event({ tabId: 7 }, 'Page.javascriptDialogOpening', { type: 'alert', message: 'blocked' }), 20);
      return new Promise(() => {}); // A real renderer blocks until the dialog is handled.
    }
    return original(target, method, params);
  };
  const snapshot = await controller.execute('snapshot', { tabId: 7 });
  const result = await controller.execute('click', { tabId: 7, ref: snapshot.elements[0].ref });
  assert.equal(result.completed, true);
  assert.equal(result.dialog.type, 'alert');
  const during = await controller.execute('snapshot', { tabId: 7 });
  assert.equal(during.dialog.message, 'blocked');
  assert.deepEqual(during.elements, []);
  await controller.execute('dialog', { tabId: 7, accept: true });
});

test('networkIdle waits for in-flight requests instead of relying on a quiet gap', async () => {
  const { controller, listeners } = fixture();
  await controller.execute('claim', { tabId: 7 });
  listeners.event({ tabId: 7 }, 'Network.requestWillBeSent', { requestId: 'r1', request: { url: 'https://example.com/slow' } });
  await assert.rejects(controller.execute('wait', { tabId: 7, networkIdle: true, timeoutMs: 700 }), /WAIT_TIMEOUT: 700ms \(inFlight=1/);
  listeners.event({ tabId: 7 }, 'Network.loadingFinished', { requestId: 'r1' });
  const quiet = await controller.execute('wait', { tabId: 7, networkIdle: true, timeoutMs: 2000 });
  assert.equal(quiet.gone, false);
  assert.ok(quiet.waitedMs >= 450);
});

test('snapshot text and markdown modes return page content and keep refs valid', async () => {
  const view = { 'Runtime.evaluate': params => {
    if (params.expression.startsWith('(() =>')) return { result: { value: 'Hello\nWorld' } };
    if (params.expression.startsWith('(function')) return { result: { value: '# Title\n\nBody [link](https://example.com/a)' } };
    return { result: { value: true } };
  } };
  const { controller, calls } = fixture(view);
  await controller.execute('claim', { tabId: 7 });
  const ax = await controller.execute('snapshot', { tabId: 7 });
  const text = await controller.execute('snapshot', { tabId: 7, format: 'text' });
  assert.equal(text.format, 'text');
  assert.equal(text.content, 'Hello\nWorld');
  assert.equal(text.elements, undefined);
  const markdown = await controller.execute('snapshot', { tabId: 7, format: 'markdown' });
  assert.match(markdown.content, /^# Title/);
  assert.ok(calls.some(([method, params]) => method === 'Runtime.evaluate' && params.expression.startsWith('(function')));
  // A text snapshot does not clear refs: the old ref still clicks.
  await controller.execute('click', { tabId: 7, ref: ax.elements[0].ref });
  assert.ok(calls.some(([method]) => method === 'Input.dispatchMouseEvent'));
  await assert.rejects(controller.execute('snapshot', { tabId: 7, format: 'html' }), /INVALID_ARGUMENT/);
});

test('find searches the whole tree by name and role and returns usable refs', async () => {
  const nodes = [
    { role: { value: 'link' }, name: { value: 'Docs home' }, backendDOMNodeId: 51 },
    { role: { value: 'link' }, name: { value: 'Pricing' }, backendDOMNodeId: 52 },
    { role: { value: 'textbox' }, name: { value: 'Email' }, backendDOMNodeId: 53 },
    { role: { value: 'StaticText' }, name: { value: 'Docs body' }, backendDOMNodeId: 54 },
  ];
  const { controller, calls } = fixture({ 'Accessibility.getFullAXTree': () => ({ nodes }) });
  await controller.execute('claim', { tabId: 7 });
  const byName = await controller.execute('find', { tabId: 7, name: 'docs' });
  assert.equal(byName.matched, 1);
  assert.deepEqual(byName.elements.map(e => [e.role, e.name]), [['link', 'Docs home']]);
  await controller.execute('click', { tabId: 7, ref: byName.elements[0].ref });
  assert.ok(calls.some(([method]) => method === 'Input.dispatchMouseEvent'));
  const byRole = await controller.execute('find', { tabId: 7, role: 'textbox' });
  assert.deepEqual(byRole.elements.map(e => e.name), ['Email']);
  const capped = await controller.execute('find', { tabId: 7, role: 'link', maxResults: 1 });
  assert.deepEqual([capped.matched, capped.elements.length, capped.truncated], [2, 1, true]);
  await assert.rejects(controller.execute('find', { tabId: 7 }), /FIND_QUERY/);
});

test('logs return only entries newer than the cursor', async () => {
  const { controller, listeners } = fixture();
  await controller.execute('claim', { tabId: 7 });
  const consoleEvent = text => listeners.event({ tabId: 7 }, 'Runtime.consoleAPICalled', { type: 'log', args: [{ value: text }] });
  consoleEvent('one');
  consoleEvent('two');
  const first = await controller.execute('logs', { tabId: 7 });
  assert.deepEqual(first.entries.map(e => e.text), ['one', 'two']);
  assert.equal(first.nextSeq, 2);
  consoleEvent('three');
  const next = await controller.execute('logs', { tabId: 7, after: first.nextSeq });
  assert.deepEqual(next.entries.map(e => e.text), ['three']);
  assert.equal(next.nextSeq, 3);
  assert.equal(next.dropped, 0);
  const none = await controller.execute('logs', { tabId: 7, after: next.nextSeq });
  assert.deepEqual(none.entries, []);
});

test('network lists requests and returns a text response body', async () => {
  const { controller, listeners, calls } = fixture({ 'Network.getResponseBody': () => ({ body: '{"ok":true}', base64Encoded: false }) });
  await controller.execute('claim', { tabId: 7 });
  listeners.event({ tabId: 7 }, 'Network.requestWillBeSent', { requestId: 'r1', type: 'XHR', request: { method: 'GET', url: 'https://example.com/api?token=secret' } });
  listeners.event({ tabId: 7 }, 'Network.responseReceived', { requestId: 'r1', type: 'XHR', response: { status: 200, mimeType: 'application/json', url: 'https://example.com/api?token=secret' } });
  listeners.event({ tabId: 7 }, 'Network.requestWillBeSent', { requestId: 'r2', type: 'Fetch', request: { method: 'POST', url: 'https://example.com/fail' } });
  listeners.event({ tabId: 7 }, 'Network.loadingFailed', { requestId: 'r2', errorText: 'net::ERR_FAILED' });
  const list = await controller.execute('network', { tabId: 7 });
  assert.deepEqual(list.requests.map(r => [r.requestId, r.url, r.status]), [['r1', 'https://example.com/api', 200], ['r2', 'https://example.com/fail', null]]);
  assert.equal(list.requests[1].failed, true);
  assert.ok(!JSON.stringify(list).includes('secret'));
  const failed = await controller.execute('network', { tabId: 7, failedOnly: true });
  assert.deepEqual(failed.requests.map(r => r.requestId), ['r2']);
  const body = await controller.execute('network', { tabId: 7, requestId: 'r1' });
  assert.equal(body.text, '{"ok":true}');
  assert.equal(body.mimeType, 'application/json');
  const call = calls.find(([method]) => method === 'Network.getResponseBody');
  assert.deepEqual(call[1], { requestId: 'r1' });
  await assert.rejects(controller.execute('network', { tabId: 7, requestId: 'gone' }), /REQUEST_NOT_FOUND/);
});

test('network bodies that Chrome cannot read fail with a clear error', async () => {
  const { controller, listeners } = fixture({ 'Network.getResponseBody': () => { throw new Error('No resource with given identifier'); } });
  await controller.execute('claim', { tabId: 7 });
  listeners.event({ tabId: 7 }, 'Network.requestWillBeSent', { requestId: 'r1', request: { method: 'GET', url: 'https://example.com/api' } });
  await assert.rejects(controller.execute('network', { tabId: 7, requestId: 'r1' }), /NETWORK_BODY_UNAVAILABLE/);
});

test('wait accepts a page predicate and reports a broken expression', async () => {
  const { controller } = fixture({ 'Runtime.evaluate': params => {
    if (params.expression === 'Boolean(bad())') return { exceptionDetails: { text: 'ReferenceError', exception: { description: 'ReferenceError: bad is not defined' } } };
    return { result: { value: true } };
  } });
  await controller.execute('claim', { tabId: 7 });
  const result = await controller.execute('wait', { tabId: 7, predicate: 'document.readyState === "complete"' });
  assert.equal(result.gone, false);
  await assert.rejects(controller.execute('wait', { tabId: 7, predicate: 'bad()' }), /WAIT_PREDICATE_ERROR/);
  await assert.rejects(controller.execute('wait', { tabId: 7 }), /WAIT_CONDITION/);
});

test('fill types into contenteditable elements', async () => {
  const { controller, calls } = fixture({ 'Runtime.callFunctionOn': params => {
    if (params.functionDeclaration.includes('getBoundingClientRect')) return { result: { value: { x: 5, y: 6, tag: 'DIV', readOnly: false, editable: true } } };
    return { result: { value: true } };
  } });
  await controller.execute('claim', { tabId: 7 });
  const snapshot = await controller.execute('snapshot', { tabId: 7 });
  await controller.execute('fill', { tabId: 7, ref: snapshot.elements[0].ref, text: 'rich text' });
  assert.ok(calls.some(([method, params]) => method === 'Input.insertText' && params.text === 'rich text'));
  const select = calls.find(([method, params]) => method === 'Runtime.callFunctionOn' && params.functionDeclaration.includes('selectNodeContents'));
  assert.ok(select, 'contenteditable selection uses a Range');
});

test('downloads lists recent items and can wait for one to settle', async () => {
  const item = { id: 3, filename: '/Users/me/Downloads/a.pdf', url: 'https://example.com/a.pdf?token=secret', state: 'complete', bytesReceived: 10, totalBytes: 10, exists: true, startTime: Date.now() };
  let callsToSearch = 0;
  const { controller, calls } = fixture({ 'downloads.search': () => { callsToSearch++; return callsToSearch < 2 ? [] : [item]; } });
  const listed = await controller.execute('downloads', {});
  assert.deepEqual(listed.downloads, []);
  const waited = await controller.execute('downloads', { wait: true, timeoutMs: 2000 });
  assert.equal(waited.timedOut, false);
  assert.deepEqual(waited.downloads.map(d => [d.id, d.url, d.state, d.exists]), [[3, 'https://example.com/a.pdf', 'complete', true]]);
  assert.ok(!JSON.stringify(waited).includes('secret'));
  assert.equal(calls.filter(([method]) => method === 'downloads.search').length >= 2, true);
});

test('downloads reports a missing API instead of hanging', async () => {
  const { controller, api } = fixture();
  delete api.downloads;
  await assert.rejects(controller.execute('downloads', {}), /DOWNLOADS_UNSUPPORTED/);
});

test('a redirect updates one network entry instead of duplicating it', async () => {
  const { controller, listeners } = fixture();
  await controller.execute('claim', { tabId: 7 });
  listeners.event({ tabId: 7 }, 'Network.requestWillBeSent', { requestId: 'r1', request: { method: 'GET', url: 'https://example.com/start' } });
  listeners.event({ tabId: 7 }, 'Network.requestWillBeSent', { requestId: 'r1', request: { method: 'GET', url: 'https://example.com/end' } });
  const list = await controller.execute('network', { tabId: 7 });
  assert.deepEqual(list.requests.map(r => [r.requestId, r.url]), [['r1', 'https://example.com/end']]);
});

test('evaluate awaits a promise result instead of returning an empty object', async () => {
  const { controller, calls } = fixture({ 'Runtime.evaluate': () => ({ result: { value: 42, type: 'number' } }) });
  await controller.execute('claim', { tabId: 7 });
  const result = await controller.execute('evaluate', { tabId: 7, expression: '(async () => 42)()' });
  assert.deepEqual(result, { value: 42, type: 'number' });
  const [, params] = calls.find(([method]) => method === 'Runtime.evaluate');
  assert.equal(params.awaitPromise, true);
  assert.equal(params.returnByValue, true);
});

test('a failed attach names the tab and keeps the Chrome reason', async () => {
  const { controller, api } = fixture();
  api.debugger.attach = async () => { throw new Error('Cannot access a chrome-extension:// URL of different extension'); };
  await assert.rejects(
    controller.execute('claim', { tabId: 7 }),
    /ATTACH_FAILED at attach: tab 7 \(https:\/\/example\.com\) Cannot access a chrome-extension:\/\/ URL of different extension; Chrome blocked debugging because the tab exposes another extension's URL/,
  );
  assert.equal(controller.attached.has(7), false);
});

test('attach failures without the extension wording keep the message plain', async () => {
  const { controller, api } = fixture();
  api.debugger.attach = async () => { throw new Error('Another debugger is already attached to the tab with id: 7'); };
  await assert.rejects(
    controller.execute('claim', { tabId: 7 }),
    error => /^ATTACH_FAILED at attach: tab 7 \(https:\/\/example\.com\) Another debugger is already attached/.test(error.message) && !/chrome-extension/.test(error.message),
  );
});

test('a blocked attach names the embedded extension frame when Chrome exposes it', async () => {
  const { controller, api } = fixture();
  api.runtime = { id: 'self' };
  const other = 'b'.repeat(32);
  api.webNavigation = {
    getAllFrames: async () => [
      { frameId: 0, parentFrameId: -1, url: 'https://example.com/' },
      { frameId: 3, parentFrameId: 0, url: `chrome-extension://${other}/inject.html?x=1` },
      { frameId: 4, parentFrameId: 0, url: 'chrome-extension://self/own.html' },
    ],
  };
  api.debugger.attach = async () => { throw new Error('Cannot access a chrome-extension:// URL of different extension'); };
  await assert.rejects(controller.execute('claim', { tabId: 7 }), error => {
    assert.match(error.message, /embedded frame belongs to another extension/);
    assert.match(error.message, new RegExp(`chrome-extension://${other}/inject.html \\(frame 3, parent 0\\)`));
    assert.match(error.message, new RegExp(`chrome://extensions/\\?id=${other}`));
    assert.doesNotMatch(error.message, /own\.html/);
    return true;
  });
});

test('a blocked attach with no frame tree says the frame list could not be read', async () => {
  const { controller, api } = fixture();
  api.webNavigation = { getAllFrames: async () => { throw new Error('No tab with id: 7.'); } };
  api.debugger.attach = async () => { throw new Error('Cannot access a chrome-extension:// URL of different extension'); };
  await assert.rejects(
    controller.execute('claim', { tabId: 7 }),
    /the frame list could not be read, so check chrome:\/\/extensions/,
  );
});


test('a blocked attach with no extension frames in the tree asks for a reload', async () => {
  const { controller, api } = fixture();
  api.webNavigation = { getAllFrames: async () => [{ frameId: 0, parentFrameId: -1, url: 'https://example.com/' }] };
  api.debugger.attach = async () => { throw new Error('Cannot access a chrome-extension:// URL of different extension'); };
  await assert.rejects(
    controller.execute('claim', { tabId: 7 }),
    /no longer shows that frame; it may have navigated away, so reload the page and retry/,
  );
});

test('tabLocation reports only the scheme and host', () => {
  assert.equal(tabLocation('https://dba.example.com/path?token=1#x'), 'https://dba.example.com');
  assert.equal(tabLocation('chrome-extension://abcdefghijklmnop/newtab.html'), 'chrome-extension://abcdefghijklmnop');
  assert.equal(tabLocation('about:blank'), 'about:');
  assert.equal(tabLocation('not a url'), 'unparseable');
});

test('a failing domain enable names the stage instead of the bare attach step', async () => {
  const { controller, calls } = fixture({ 'Page.enable': () => { throw new Error('CDP_NOT_SUPPORTED'); } });
  await assert.rejects(
    controller.execute('claim', { tabId: 7 }),
    error => /^ATTACH_FAILED at Page\.enable: tab 7 \(https:\/\/example\.com\) CDP_NOT_SUPPORTED$/.test(error.message),
  );
  assert.equal(controller.attached.has(7), false);
  assert.ok(calls.some(([method]) => method === 'attach'));
  assert.ok(calls.some(([method]) => method === 'detach'));
});

test('a Chrome initiated detach passes its reason to the listener', async () => {
  const { api, listeners } = fixture();
  const notifications = [];
  const controller = new BrowserController(api, (tabId, reason, details) => notifications.push([tabId, reason, details]));
  await controller.execute('claim', { tabId: 7 });
  listeners.detach({ tabId: 7 }, 'replaced_with_devtools');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(notifications, [[7, 'replaced_with_devtools', { tabExists: true }]]);
  assert.equal(controller.attached.has(7), false);
});

test('a Chrome detach reports a tab that no longer exists', async () => {
  const { api, listeners } = fixture();
  const notifications = [];
  const controller = new BrowserController(api, (tabId, reason, details) => notifications.push([tabId, reason, details]));
  await controller.execute('claim', { tabId: 7 });
  api.tabs.get = async () => { throw new Error('No tab with id: 7.'); };
  listeners.detach({ tabId: 7 }, 'target_closed');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(notifications, [[7, 'target_closed', { tabExists: false }]]);
});

test('wait_response resolves a response that arrives after the call started', async () => {
  const { controller, api, calls, listeners } = fixture();
  await controller.execute('claim', { tabId: 7 });
  api.debugger.sendCommand = async (target, method, params) => {
    calls.push([method, params]);
    if (method === 'Network.getResponseBody') return { body: '{"ok":true}' };
    if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main' } } };
    return {};
  };
  const pending = controller.execute('wait_response', { tabId: 7, urlContains: '/api/items', includeBody: true });
  await new Promise(resolve => setTimeout(resolve, 20));
  listeners.event({ tabId: 7 }, 'Network.requestWillBeSent', { requestId: 'r1', request: { url: 'https://example.com/api/items', method: 'GET' }, type: 'XHR' });
  listeners.event({ tabId: 7 }, 'Network.responseReceived', { requestId: 'r1', response: { status: 200, mimeType: 'application/json' }, type: 'XHR' });
  const response = await pending;
  assert.equal(response.status, 200);
  assert.equal(response.method, 'GET');
  assert.equal(response.text, '{"ok":true}');
  assert.ok(response.waitedMs >= 0);
});

test('wait_response names the recent requests when nothing matches in time', async () => {
  const { controller } = fixture();
  await controller.execute('claim', { tabId: 7 });
  await assert.rejects(controller.execute('wait_response', { tabId: 7, urlContains: '/never', timeoutMs: 100 }), /WAIT_TIMEOUT: no matching response within 100ms/);
});

test('assert passes at once and fails with the page still readable', async () => {
  const { controller, api } = fixture();
  await controller.execute('claim', { tabId: 7 });
  assert.equal((await controller.execute('assert', { tabId: 7, selector: '#ready' })).passed, true);
  api.debugger.sendCommand = async (target, method, params) => {
    if (method === 'Runtime.evaluate') return { result: { value: false } };
    return {};
  };
  await assert.rejects(controller.execute('assert', { tabId: 7, text: 'Saved' }), /ASSERT_FAILED: the condition was false after \d+ms/);
});

test('content reads one region, the body or a JSON outline', async () => {
  const { controller, api, calls } = fixture();
  await controller.execute('claim', { tabId: 7 });
  api.debugger.sendCommand = async (target, method, params) => {
    calls.push([method, params]);
    if (method === 'Runtime.evaluate') {
      assert.match(params.expression, /queryDeep/);
      return { result: { value: params.expression.includes("const format = \"json\"") ? { value: [{ tag: 'h1', text: 'Title' }] } : { value: '# Title\n\nBody' } } };
    }
    return {};
  };
  const markdown = await controller.execute('content', { tabId: 7, selector: 'main' });
  assert.equal(markdown.format, 'markdown');
  assert.equal(markdown.selector, 'main');
  assert.match(markdown.content, /^# Title/);
  const outline = await controller.execute('content', { tabId: 7, format: 'json' });
  assert.deepEqual(outline.content, '[{"tag":"h1","text":"Title"}]');
  api.debugger.sendCommand = async () => ({ result: { value: { error: 'SELECTOR_NOT_FOUND' } } });
  await assert.rejects(controller.execute('content', { tabId: 7, selector: '#missing' }), /SELECTOR_NOT_FOUND/);
});

test('scrape turns field specs into one object or one object per container', async () => {
  const { controller, api, calls } = fixture();
  await controller.execute('claim', { tabId: 7 });
  api.debugger.sendCommand = async (target, method, params) => {
    calls.push([method, params]);
    if (method === 'Runtime.evaluate') {
      const specs = JSON.parse(params.expression.match(/const specs = (\[.*?\]);/)[1]);
      assert.deepEqual(specs[0], { name: 'title', selector: 'h1' });
      assert.deepEqual(specs[1], { name: 'link', selector: 'a', attr: 'href' });
      return { result: { value: { items: [{ title: 'A', link: '/a' }], matched: 1 } } };
    }
    return {};
  };
  const result = await controller.execute('scrape', { tabId: 7, selector: '.card', fields: ['title: h1', 'link: a@href'] });
  assert.deepEqual(result.items, [{ title: 'A', link: '/a' }]);
  assert.equal(result.matched, 1);
});

test('doctor works without a tab and reports page health with one', async () => {
  const { controller } = fixture();
  assert.equal((await controller.execute('doctor', {})).attached, false);
  await controller.execute('claim', { tabId: 7 });
  const report = await controller.execute('doctor', { tabId: 7 });
  assert.equal(report.attached, true);
  assert.equal(report.url, 'https://example.com/');
  assert.equal(report.revision, 0);
  assert.deepEqual(report.network.pending, 0);
});

test('doctor explains an unattached tab and lists blocking extension frames', async () => {
  const { controller, api } = fixture();
  const other = 'c'.repeat(32);
  api.webNavigation = { getAllFrames: async () => [{ frameId: 3, parentFrameId: 0, url: `chrome-extension://${other}/inject.html` }] };
  const report = await controller.execute('doctor', { tabId: 7 });
  assert.equal(report.attached, false);
  assert.equal(report.exists, true);
  assert.equal(report.extensionFrames[0].extensionId, other);
  assert.match(report.note, /Claim it again/);
  api.tabs.get = async () => { throw new Error('No tab with id: 7.'); };
  assert.deepEqual(
    await controller.execute('doctor', { tabId: 7 }),
    { tabId: 7, exists: false, attached: false, note: 'This tab no longer exists. Claim another tab; if the page reopened, Chrome gave it a new tab id.' },
  );
});

test('history lists recorded actions and their failures without typed text', async () => {
  const { controller } = fixture();
  await controller.execute('claim', { tabId: 7 });
  const snapshot = await controller.execute('snapshot', { tabId: 7 });
  await controller.execute('click', { tabId: 7, ref: snapshot.elements[0].ref });
  await assert.rejects(controller.execute('click', { tabId: 7, ref: 'missing' }), /STALE_ELEMENT/);
  const history = await controller.execute('history', { tabId: 7 });
  assert.ok(history.total >= 3);
  assert.equal(history.actions.at(-1).ok, false);
  assert.equal(history.actions.at(-1).failure.code, 'STALE_ELEMENT');
  assert.equal(history.actions.at(-2).action, 'click');
  assert.equal(history.actions.at(-2).ref, snapshot.elements[0].ref);
  assert.ok(!JSON.stringify(history).includes('secret'));
});

test('snapshot flags subframe elements so a model knows where they live', async () => {
  const { controller, api } = fixture();
  api.debugger.sendCommand = async (target, method) => {
    if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main' } } };
    if (method === 'Accessibility.getFullAXTree') return { nodes: [
      { role: { value: 'button' }, name: { value: 'Top' }, backendDOMNodeId: 42, frameId: 'main' },
      { role: { value: 'button' }, name: { value: 'Inner' }, backendDOMNodeId: 43, frameId: 'child' },
    ] };
    if (method === 'DOM.resolveNode') return { object: { objectId: 'object' } };
    if (method === 'Runtime.evaluate') return { result: { value: null } };
    return {};
  };
  await controller.execute('claim', { tabId: 7 });
  const snapshot = await controller.execute('snapshot', { tabId: 7 });
  assert.equal(snapshot.elements.find(element => element.name === 'Inner').frame, true);
  assert.equal(snapshot.elements.find(element => element.name === 'Top').frame, undefined);
  assert.match(snapshot.frameNote, /subframe/);
});

test('the click point is translated from a same-origin frame into top-level coordinates', () => {
  const run = new Function('window', 'document', `return (${POINT_FN}).call(this)`);
  const marker = { setAttribute() {}, style: {}, remove() {}, textContent: '' };
  const topDocument = {
    elementFromPoint: () => null,
    documentElement: { append(target) { target.appended = true; } },
    createElement: () => marker,
  };
  const style = { visibility: 'visible', display: 'block', opacity: '1', paddingLeft: '0px', paddingTop: '0px' };
  const topWindow = { getComputedStyle: () => style };
  topWindow.top = topWindow; topWindow.document = topDocument;

  const element = {
    isConnected: true, disabled: false, tagName: 'BUTTON', type: 'button', readOnly: false, isContentEditable: false,
    ownerDocument: { defaultView: topWindow },
    getAttribute: () => null,
    scrollIntoView() {},
    getBoundingClientRect: () => ({ x: 100, y: 50, left: 100, top: 50, width: 20, height: 10 }),
    getRootNode: () => ({}),
    contains: node => node === element,
  };
  topDocument.elementFromPoint = () => element;
  const top = run.call(element, topWindow, topDocument);
  assert.deepEqual([top.x, top.y], [110, 55]);
  assert.equal(top.frame, false);
  assert.equal(marker.appended, true);

  const frameElement = {
    ownerDocument: { defaultView: topWindow },
    getBoundingClientRect: () => ({ left: 200, top: 100 }),
    clientLeft: 1, clientTop: 2, scrollIntoView() {},
  };
  const childWindow = { getComputedStyle: () => style, frameElement };
  childWindow.top = topWindow;
  topDocument.elementFromPoint = () => frameElement;
  const child = { ...element, ownerDocument: { defaultView: childWindow } };
  const inner = run.call(child, topWindow, topDocument);
  assert.deepEqual([inner.x, inner.y], [311, 157]);
  assert.equal(inner.frame, true);
});

test('snapshot pages through the accessibility tree', async () => {
  const nodes = [
    { role: { value: 'button' }, name: { value: 'One' }, backendDOMNodeId: 1 },
    { role: { value: 'button' }, name: { value: 'Two' }, backendDOMNodeId: 2 },
    { role: { value: 'button' }, name: { value: 'Three' }, backendDOMNodeId: 3 },
  ];
  const { controller } = fixture({ 'Accessibility.getFullAXTree': () => ({ nodes }) });
  await controller.execute('claim', { tabId: 7 });
  const first = await controller.execute('snapshot', { tabId: 7, maxElements: 2 });
  assert.deepEqual(first.elements.map(entry => entry.name), ['One', 'Two']);
  assert.equal(first.truncated, true);
  assert.equal(first.nextOffset, 2);
  const second = await controller.execute('snapshot', { tabId: 7, maxElements: 2, offset: 2 });
  assert.deepEqual(second.elements.map(entry => entry.name), ['Three']);
  assert.equal(second.truncated, false);
  assert.equal(second.nextOffset, undefined);
});

test('snapshot region lists only the accessibility nodes inside one element', async () => {
  const nodes = [
    { nodeId: 'a', role: { value: 'form' }, name: { value: '' }, backendDOMNodeId: 100, childIds: ['b'] },
    { nodeId: 'b', role: { value: 'button' }, name: { value: 'Inside' }, backendDOMNodeId: 2, childIds: [] },
    { nodeId: 'c', role: { value: 'button' }, name: { value: 'Outside' }, backendDOMNodeId: 3, childIds: [] },
  ];
  const { controller } = fixture({
    'Accessibility.getFullAXTree': () => ({ nodes }),
    'DOM.getDocument': () => ({ root: { nodeId: 1 } }),
    'DOM.querySelector': () => ({ nodeId: 10 }),
    'DOM.describeNode': () => ({ node: { backendNodeId: 100 } }),
  });
  await controller.execute('claim', { tabId: 7 });
  const result = await controller.execute('snapshot', { tabId: 7, region: '#checkout' });
  assert.deepEqual(result.elements.map(entry => entry.name), ['Inside']);
  assert.match(result.regionNote, /#checkout/);
  const missing = fixture({ 'Accessibility.getFullAXTree': () => ({ nodes }), 'DOM.getDocument': () => ({ root: { nodeId: 1 } }), 'DOM.querySelector': () => ({ nodeId: 0 }) });
  await missing.controller.execute('claim', { tabId: 7 });
  await assert.rejects(missing.controller.execute('snapshot', { tabId: 7, region: '#gone' }), /REGION_NOT_FOUND/);
});

test('a ref invalidated by a re-render is rebound when role and name stay unique', async () => {
  let tree = [{ role: { value: 'button' }, name: { value: 'Submit' }, backendDOMNodeId: 42 }];
  const { controller, calls } = fixture({
    'Accessibility.getFullAXTree': () => ({ nodes: tree }),
    'DOM.resolveNode': params => {
      if (params.backendNodeId === 42) throw new Error('No node with given id found');
      return { object: { objectId: 'object' } };
    },
  });
  await controller.execute('claim', { tabId: 7 });
  const snapshot = await controller.execute('snapshot', { tabId: 7 });
  const ref = snapshot.elements[0].ref;
  // The page re-rendered: the old node is gone, the same button has a new id.
  tree = [{ role: { value: 'button' }, name: { value: 'Submit' }, backendDOMNodeId: 77 }];
  await controller.execute('click', { tabId: 7, ref });
  assert.ok(calls.some(([method]) => method === 'Input.dispatchMouseEvent'));
  const after = await controller.execute('snapshot', { tabId: 7 });
  assert.equal(after.healed, 1);

  const ambiguous = fixture({
    'Accessibility.getFullAXTree': () => ({ nodes: tree }),
    'DOM.resolveNode': params => {
      if (params.backendNodeId === 77) throw new Error('No node with given id found');
      return { object: { objectId: 'object' } };
    },
  });
  await ambiguous.controller.execute('claim', { tabId: 7 });
  const saved = await ambiguous.controller.execute('snapshot', { tabId: 7 });
  const tree2 = [
    { role: { value: 'button' }, name: { value: 'Submit' }, backendDOMNodeId: 90 },
    { role: { value: 'button' }, name: { value: 'Submit' }, backendDOMNodeId: 91 },
  ];
  ambiguous.calls.length = 0;
  await assert.rejects(ambiguous.controller.execute('click', { tabId: 7, ref: saved.elements[0].ref }), /STALE_ELEMENT/);
});

test('network lists can be filtered by method, status and URL text', async () => {
  const { controller, listeners } = fixture();
  await controller.execute('claim', { tabId: 7 });
  const send = (method, url, status) => {
    listeners.event({ tabId: 7 }, 'Network.requestWillBeSent', { requestId: `${method}-${url}`, request: { method, url }, type: 'Fetch' });
    listeners.event({ tabId: 7 }, 'Network.responseReceived', { requestId: `${method}-${url}`, response: { status }, type: 'Fetch' });
  };
  send('GET', 'https://example.com/api/users', 200);
  send('POST', 'https://example.com/api/users', 500);
  send('GET', 'https://example.com/static/app.js', 200);
  assert.equal((await controller.execute('network', { tabId: 7 })).requests.length, 3);
  const posts = await controller.execute('network', { tabId: 7, method: 'post' });
  assert.deepEqual(posts.requests.map(item => item.method), ['POST']);
  const failing = await controller.execute('network', { tabId: 7, status: 500 });
  assert.deepEqual(failing.requests.map(item => item.status), [500]);
  const api = await controller.execute('network', { tabId: 7, urlContains: '/api/' });
  assert.equal(api.requests.length, 2);
  assert.equal((await controller.execute('network', { tabId: 7, urlContains: '/api/', method: 'GET' })).requests.length, 1);
});

test('storage defaults to cookies for the tab origin and refuses another origin', async () => {
  const built = fixture({
    'Network.getCookies': params => ({ cookies: [{ name: 'sid', value: 'x', domain: 'example.com', path: '/', httpOnly: true, secure: true, session: true, size: 3 }].filter(() => String(params.urls[0]).startsWith('https://example.com')) }),
  });
  const { controller } = built;
  await controller.execute('claim', { tabId: 7 });
  const listed = await controller.execute('storage', { tabId: 7 });
  assert.equal(listed.kind, 'cookies');
  assert.equal(listed.cookies[0].name, 'sid');
  await assert.rejects(controller.execute('storage', { tabId: 7, kind: 'cookies', url: 'https://evil.test/' }), /tab origin/);
});

test('storage reads localStorage and sessionStorage without writing', async () => {
  const { controller, calls } = fixture({
    'Runtime.evaluate': () => ({ result: { value: '{"theme":"dark","token":"abc"}' } }),
  });
  await controller.execute('claim', { tabId: 7 });
  const local = await controller.execute('storage', { tabId: 7, kind: 'local' });
  assert.deepEqual(local.entries, { theme: 'dark', token: 'abc' });
  assert.equal(local.total, 2);
  assert.match(local.note, /untrusted/);
  const evaluate = calls.find(([method]) => method === 'Runtime.evaluate');
  assert.match(evaluate[1].expression, /localStorage/);
  assert.doesNotMatch(evaluate[1].expression, /setItem|removeItem|clear\(/);
});

test('paging walks the main document and subframes without repeating or losing elements', async () => {
  const built = fixture({
    'Accessibility.getFullAXTree': () => ({ nodes: ['Alpha', 'Beta', 'Gamma'].map((name, index) => ({ role: { value: 'button' }, name: { value: name }, backendDOMNodeId: 700 + index })) }),
    'Page.getFrameTree': () => ({ frameTree: { frame: { id: 'main', url: 'https://example.com/' }, childFrames: [{ frame: { id: 'child', url: 'https://widget.example/embed' } }] } }),
    'Page.createIsolatedWorld': () => ({ executionContextId: 7 }),
    'Runtime.evaluate': frameWorld(['Pay Now', 'Terms', 'Cancel']),
  });
  const { controller } = built;
  await controller.execute('claim', { tabId: 7 });
  const seen = [];
  let offset = 0;
  for (let page = 0; page < 6; page += 1) {
    const snapshot = await controller.execute('snapshot', { tabId: 7, maxElements: 2, offset });
    seen.push(...snapshot.elements.map(entry => entry.name));
    if (!snapshot.truncated) break;
    offset = snapshot.nextOffset;
  }
  assert.deepEqual(seen, ['Alpha', 'Beta', 'Gamma', 'Pay Now', 'Terms', 'Cancel']);
});

test('a long subframe list is paged like the main document, never capped or mislabelled', async () => {
  const names = Array.from({ length: 301 }, (_, index) => `Item ${index}`);
  const built = fixture({
    'Accessibility.getFullAXTree': () => ({ nodes: [] }),
    'Page.getFrameTree': () => ({ frameTree: { frame: { id: 'main', url: 'https://example.com/' }, childFrames: [{ frame: { id: 'child', url: 'https://widget.example/list' } }] } }),
    'Page.createIsolatedWorld': () => ({ executionContextId: 7 }),
    'Runtime.evaluate': frameWorld(names),
  });
  const { controller } = built;
  await controller.execute('claim', { tabId: 7 });
  const first = await controller.execute('snapshot', { tabId: 7, maxElements: 500 });
  assert.equal(first.elements.length, 301);
  assert.equal(first.truncated, false);
  assert.equal(first.elements.at(-1).name, 'Item 300');
  const seen = [];
  let offset = 0;
  for (let page = 0; page < 10; page += 1) {
    const snapshot = await controller.execute('snapshot', { tabId: 7, maxElements: 100, offset });
    seen.push(...snapshot.elements.map(entry => entry.name));
    if (!snapshot.truncated) break;
    assert.ok(snapshot.nextOffset > offset);
    offset = snapshot.nextOffset;
  }
  assert.deepEqual(seen, names);
});

test('a subframe label keeps every character, including s', () => {
  const expression = frameCollect(0, 5);
  const node = { tagName: 'BUTTON', innerText: 'save changes', value: '', getAttribute: () => null };
  const document = { querySelectorAll: () => [node] };
  const collected = JSON.parse(new Function('document', `return ${expression}`)(document));
  assert.deepEqual(collected, [{ index: 0, role: 'button', name: 'save changes' }]);
});

test('a subframe that cannot be read is reported instead of silently missing', async () => {
  const built = fixture({
    'Accessibility.getFullAXTree': () => ({ nodes: [] }),
    'Page.getFrameTree': () => ({ frameTree: { frame: { id: 'main' }, childFrames: [{ frame: { id: 'child', url: 'https://widget.example/embed' } }] } }),
    'Page.createIsolatedWorld': () => { throw new Error('Target closed'); },
  });
  const { controller } = built;
  await controller.execute('claim', { tabId: 7 });
  const snapshot = await controller.execute('snapshot', { tabId: 7 });
  assert.equal(snapshot.skippedFrames, 1);
  assert.match(snapshot.skippedNote, /could not be read/);
  assert.equal(snapshot.elements.length, 0);
});

test('a subframe control that changes role between snapshot and click is refused', async () => {
  const built = fixture({
    'Accessibility.getFullAXTree': () => ({ nodes: [] }),
    'Page.getFrameTree': () => ({ frameTree: { frame: { id: 'main' }, childFrames: [{ frame: { id: 'child', url: 'https://widget.example/embed' } }] } }),
    'Page.createIsolatedWorld': () => ({ executionContextId: 7 }),
    'Runtime.evaluate': frameWorld(['Save'], { guard: { label: 'Save', role: 'link' } }),
  });
  const { controller } = built;
  await controller.execute('claim', { tabId: 7 });
  const snapshot = await controller.execute('snapshot', { tabId: 7 });
  const framed = snapshot.elements.find(entry => entry.frame);
  await assert.rejects(controller.execute('click', { tabId: 7, ref: framed.ref }), /STALE_ELEMENT/);
});

test('a mock body that cannot be encoded is refused before interception starts', async () => {
  const built = fixture({ 'Fetch.enable': {}, 'Fetch.continueRequest': {} });
  const { controller } = built;
  await controller.execute('claim', { tabId: 7 });
  await assert.rejects(controller.execute('mock', { tabId: 7, rules: [{ urlContains: '/api', body: '\ud800' }] }), /cannot be sent/);
  assert.ok(!built.calls.some(([method]) => method === 'Fetch.enable'), 'interception never starts for a refused rule');
});

test('a cross-origin frame is read into the snapshot and clicked through its own world', async () => {
  const sent = [];
  const built = fixture({
    'Page.getFrameTree': () => ({ frameTree: { frame: { id: 'main', url: 'http://127.0.0.1:9101/' }, childFrames: [{ frame: { id: 'child', url: 'http://127.0.0.1:9102/inner' } }] } }),
    'Page.createIsolatedWorld': () => ({ executionContextId: 7 }),
    'Runtime.evaluate': params => {
      sent.push(params);
      if (String(params.expression).includes('node.click()')) return { result: { value: 'OK' } };
      if (String(params.expression).includes('const label =')) return { result: { value: JSON.stringify({ label: 'Inner Button', role: 'button' }) } };
      return frameWorld(['Inner Button'])(params);
    },
  });
  const { controller } = built;
  await controller.execute('claim', { tabId: 7 });
  const snapshot = await controller.execute('snapshot', { tabId: 7 });
  const framed = snapshot.elements.find(entry => entry.name === 'Inner Button');
  assert.equal(framed.frame, true);
  assert.equal(framed.frameUrl, 'http://127.0.0.1:9102/inner');
  await controller.execute('click', { tabId: 7, ref: framed.ref });
  const click = sent.find(params => params.contextId === 7 && String(params.expression).includes("node.click()"));
  assert.ok(click, 'the click runs inside the frame world');
  // Synthetic mouse events cannot reach the frame, and healing a frame ref
  // against the main document would silently act on the wrong node.
  await assert.rejects(controller.execute('hover', { tabId: 7, ref: framed.ref }), /FRAME_UNSUPPORTED/);
});
