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
  assert.deepEqual(registrations[0].invocations.map(descriptor => descriptor.method), ['read', 'pair']);
});

test('host settings reports a runtime without a service provider instead of throwing', () => {
  const ctx = { inject(deps, callback) { callback({ typert: { register() { return () => {}; } } }); } };
  assert.doesNotThrow(() => registerSettings(ctx, { status: () => ({ connected: false, extensionVersion: null, claimedTabs: [] }), pair: () => ({ code: '12345678', port: 18791, expiresInSeconds: 120, instructions: '' }) }));
});
