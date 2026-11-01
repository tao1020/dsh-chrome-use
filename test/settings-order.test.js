import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Render the real settings bundle with a tiny React-shaped stub so section
// order is checked without a browser.
function headingsFor(status) {
  let hook = 0;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
    useState: (initial) => {
      const index = hook++;
      if (index === 0) return [{ loading: false, value: status }, () => {}];
      return [typeof initial === 'function' ? initial() : initial, () => {}];
    },
    useEffect: () => {},
    useRef: (initial) => ({ current: initial }),
  };
  let entry;
  vm.runInNewContext(readFileSync(new URL('../src/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: value => { entry = value; } } },
  });
  const plugin = entry.factory(() => React);
  let Component;
  const ctx = {
    effect(fn) { fn(); },
    remote: {
      $mount: () => Promise.resolve(() => {}),
      chromeUseStatus: {
        read: async () => ({ ok: true, value: status }),
        pair: async () => ({ ok: true, value: { code: '12345678', port: 18791, expiresInSeconds: 120, instructions: '' } }),
      },
    },
    inject: (deps, fn) => fn(ctx),
    slots: { inject: (name, fn) => fn(), register: (spec, component) => { Component = component; } },
  };
  plugin.apply(ctx);
  const tree = Component({ read: () => Promise.resolve(), pair: () => Promise.resolve() });
  const headings = [];
  (function visit(node) {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== 'object') return;
    if (node.type === 'h3') headings.push(node.children.join(''));
    node.children.forEach(visit);
  })(tree);
  return headings;
}

test('settings lead with install and pairing until Chrome is connected', () => {
  assert.deepEqual(headingsFor({ connected: false, extensionVersion: null, tabCount: 0 }),
    ['安装 Chrome 扩展', '配对 Chrome 扩展', '连接状态', '版本更新']);
});

test('settings put the connection status first after Chrome connects', () => {
  assert.deepEqual(headingsFor({ connected: true, extensionVersion: '0.1.7', tabCount: 2 }),
    ['连接状态', '安装 Chrome 扩展', '版本更新']);
});
