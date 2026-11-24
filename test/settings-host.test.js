import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerSettings } from '../src/settings.js';

test('host settings never imports packages that only the Harness install provides', async () => {
  const source = await readFile(new URL('../src/settings.js', import.meta.url), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.equal(/from\s+['"]@deepseek-ai\//.test(code) || /import\(\s*['"]@deepseek-ai\//.test(code), false, 'settings.js must load from the plugin folder alone');
});

test('host settings publishes the plain service and registers both invocations', async () => {
  const provided = new Map();
  const registrations = [];
  const ctx = {
    reflect: { provide(name, value) { provided.set(name, value); } },
    inject(deps, callback) {
      assert.deepEqual(deps, ['typert']);
      callback({ typert: { register(contribution) { registrations.push(contribution); return () => {}; } } });
    },
  };
  const bridge = {
    status: () => ({ connected: false, extensionVersion: null, claimedTabs: [] }),
    pair: () => ({ code: '12345678', port: 18791, expiresInSeconds: 120, instructions: 'enter it', token: 'secret' }),
  };
  registerSettings(ctx, bridge);
  const service = provided.get('chromeUseStatus');
  assert.ok(service, 'service is published under chromeUseStatus');
  assert.equal(service.typertRemote.service, service);
  assert.equal(service.typertRemote.serviceKey, 'chromeUseStatus');
  assert.equal(service.typertRemote.namespace, 'chromeUseStatus');
  assert.deepEqual(await service.read(), { connected: false, tabCount: 0, extensionVersion: null });
  assert.deepEqual(await service.pair(), { code: '12345678', port: 18791, expiresInSeconds: 120, instructions: 'enter it' });
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].package, 'dsh-chrome-use');
  assert.equal(registrations[0].face, 'host');
  assert.deepEqual(registrations[0].invocations.map(descriptor => descriptor.method), ['read', 'pair', 'list']);
});

test('host settings lists tabs for the @ menu without taking a lease', async () => {
  const calls = [];
  const provided = new Map();
  const ctx = {
    reflect: { provide(name, value) { provided.set(name, value); } },
    inject(deps, callback) { callback({ typert: { register() { return () => {}; } } }); },
  };
  const bridge = {
    status: () => ({ connected: true, extensionVersion: '0.6.7', claimedTabs: [7] }),
    call: async (action, args, owner) => { calls.push({ action, args, owner }); return { tabs: [{ tabId: 7, title: 'Orders', url: 'https://shop.test/orders', attached: true }] }; },
  };
  registerSettings(ctx, bridge);
  const service = provided.get('chromeUseStatus');
  assert.deepEqual(await service.list(), { connected: true, tabs: [{ tabId: 7, title: 'Orders', url: 'https://shop.test/orders', attached: true }], reason: null });
  assert.equal(calls[0].action, 'tabs');
  assert.deepEqual(calls[0].args, {});
  assert.equal(typeof calls[0].owner, 'string', 'the bridge requires an owner id even for a read');
  assert.ok(calls[0].owner.length > 0);
});

test('host settings turns a disconnected or busy browser into a hint instead of an error', async () => {
  const provided = new Map();
  const ctx = {
    reflect: { provide(name, value) { provided.set(name, value); } },
    inject(deps, callback) { callback({ typert: { register() { return () => {}; } } }); },
  };
  registerSettings(ctx, { status: () => ({ connected: false, extensionVersion: null, claimedTabs: [] }), call: async () => { throw new Error('should not be called'); } });
  assert.deepEqual(await provided.get('chromeUseStatus').list(), { connected: false, tabs: [], reason: 'Chrome 扩展没有连接' });

  const busy = new Map();
  registerSettings({
    reflect: { provide(name, value) { busy.set(name, value); } },
    inject(deps, callback) { callback({ typert: { register() { return () => {}; } } }); },
  }, { status: () => ({ connected: true, extensionVersion: null, claimedTabs: [] }), call: async () => { throw new Error('BROWSER_BUSY: another command is running'); } });
  const value = await busy.get('chromeUseStatus').list();
  assert.equal(value.connected, true);
  assert.deepEqual(value.tabs, []);
  assert.match(value.reason, /浏览器正在执行另一条命令/);
});

test('host settings reports a runtime without a service provider instead of throwing', () => {
  const ctx = { inject(deps, callback) { callback({ typert: { register() { return () => {}; } } }); } };
  assert.doesNotThrow(() => registerSettings(ctx, { status: () => ({ connected: false, extensionVersion: null, claimedTabs: [] }), pair: () => ({ code: '12345678', port: 18791, expiresInSeconds: 120, instructions: '' }) }));
});
