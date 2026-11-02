import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserController, keyDescriptor, pageUrl } from '../extension/controller.js';
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
  assert.throws(() => validateArgs('chrome_upload', { tabId: 1, ref: 'r', paths: '/tmp/a.txt' }), /INVALID_ARGUMENT/);
  assert.throws(() => validateArgs('chrome_dialog', { tabId: 1, accept: 'yes' }), /INVALID_ARGUMENT/);
  assert.doesNotThrow(() => validateArgs('chrome_dialog', { tabId: 1, accept: false, promptText: '' }));
  assert.doesNotThrow(() => validateArgs('chrome_wait', { tabId: 1, selector: '#ready', gone: true, timeoutMs: 12000 }));
  assert.doesNotThrow(() => validateArgs('chrome_drag', { tabId: 1, fromRef: 'r1', toText: 'Drop here', steps: 20 }));
  assert.doesNotThrow(() => validateArgs('chrome_history', { tabId: 1, action: 'back' }));
  assert.throws(() => validateArgs('chrome_history', { tabId: 1, action: 'undo' }), /INVALID_ARGUMENT/);
  assert.doesNotThrow(() => validateArgs('chrome_scroll_to', { tabId: 1, ref: 'r' }));
  assert.throws(() => validateArgs('chrome_scroll_to', { tabId: 1, ref: 'r', block: 'top' }), /INVALID_ARGUMENT/);
  assert.doesNotThrow(() => validateArgs('chrome_screenshot', { tabId: 1, fullPage: true }));
  assert.doesNotThrow(() => validateArgs('chrome_pdf', { tabId: 1, landscape: true }));
  assert.doesNotThrow(() => validateArgs('chrome_activate', { tabId: 1 }));
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
test('closing a tab removes it and forgets its debugger state', async () => {
  const { controller, calls } = fixture();
  await controller.execute('claim', { tabId: 7 });
  assert.equal(controller.attached.has(7), true);
  assert.deepEqual(await controller.execute('close', { tabId: 7 }), { tabId: 7, closed: true });
  assert.deepEqual(calls.find(([method]) => method === 'tabs.remove'), ['tabs.remove', 7]);
  assert.equal(controller.attached.has(7), false);
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
  const expression = calls.find(([method]) => method === 'Runtime.evaluate')[1].expression;
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
