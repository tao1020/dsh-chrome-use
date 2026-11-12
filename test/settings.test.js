import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { parseStatus, parsePairing, remote } from '../src/settings-contract.js';
test('settings exposes only connection metadata and rejects invalid status', () => {
  assert.deepEqual(parseStatus({connected:false,tabCount:0,extensionVersion:null,token:'secret'}),{connected:false,tabCount:0,extensionVersion:null});
  for(const value of [null,{}, {connected:true,tabCount:-1,extensionVersion:null}]) assert.throws(()=>parseStatus(value));
});
test('status preserves the effective port only when the host provides it', () => {
  assert.deepEqual(parseStatus({connected:false,tabCount:0,extensionVersion:null}),{connected:false,tabCount:0,extensionVersion:null});
  assert.deepEqual(parseStatus({connected:true,tabCount:1,extensionVersion:'0.6.7',port:18793,requestedPort:18791}),{connected:true,tabCount:1,extensionVersion:'0.6.7',port:18793,requestedPort:18791});
  assert.throws(()=>parseStatus({connected:true,tabCount:0,extensionVersion:null,port:0}),/Invalid Chrome connection port/);
  assert.throws(()=>parseStatus({connected:true,tabCount:0,extensionVersion:null,requestedPort:65536}),/Invalid Chrome connection requestedPort/);
});
test('pairing responses keep the legacy code and add an optional encoded code', () => {
  const legacy=parsePairing({code:'12345678',port:18791,expiresInSeconds:120,instructions:'enter it',token:'secret'});
  assert.deepEqual(legacy,{code:'12345678',port:18791,expiresInSeconds:120,instructions:'enter it'});
  const encoded=parsePairing({code:'12345678',pairingCode:'7K3M9QAX',port:18793,expiresInSeconds:120,instructions:'enter it'});
  assert.deepEqual(encoded,{code:'12345678',pairingCode:'7K3M9QAX',port:18793,expiresInSeconds:120,instructions:'enter it'});
  for(const value of [null, [], {code:'1234567',port:18791,expiresInSeconds:120,instructions:''}, {code:'12345678',port:0,expiresInSeconds:120,instructions:''}, {code:'12345678',port:18791,expiresInSeconds:0,instructions:''}, {code:'12345678',port:18791,expiresInSeconds:120,instructions:7}, {code:'12345678',pairingCode:'12345678',port:18791,expiresInSeconds:120,instructions:''}, {code:'12345678',pairingCode:'7K3M9QAI',port:18791,expiresInSeconds:120,instructions:''}]) assert.throws(()=>parsePairing(value));
});
test('remote contract publishes read and pair on one namespace', () => {
  assert.deepEqual(remote.descriptors.map(descriptor=>descriptor.id),['dsh-chrome-use#chromeUseStatus/read','dsh-chrome-use#chromeUseStatus/pair']);
  assert.deepEqual(remote.descriptors.map(descriptor=>descriptor.method),['read','pair']);
  for(const descriptor of remote.descriptors) {
    assert.equal(descriptor.service,'chromeUseStatus');
    assert.equal(descriptor.namespace,'chromeUseStatus');
    assert.deepEqual(descriptor.parameters,[]);
    assert.equal(descriptor.invocation.kind,'direct');
    assert.equal(descriptor.result.mode,'strict');
    assert.equal(typeof descriptor.result.create, 'function');
  }
  assert.equal(remote.descriptors[1].result.create().parse({code:'12345678',port:18791,expiresInSeconds:120,instructions:''}).code,'12345678');
});
test('browser entry mounts the native settings slot and remote contract', async () => {
  let entry, registered, mounted;
  vm.runInNewContext(await readFile(new URL('../src/client.js',import.meta.url),'utf8'),{window:{__ModuleLoader__:{load(value){entry=value;}}}});
  const plugin=entry.factory(()=>({}));
  const ctx={effect(fn){fn();},remote:{$mount(contract){mounted=contract;return Promise.resolve(()=>{});},chromeUseStatus:{read:async()=>({ok:true,value:{connected:true,tabCount:1,extensionVersion:'0.1.1'}}),pair:async()=>({ok:true,value:{code:'12345678',port:18791,expiresInSeconds:120,instructions:''}})}},inject(deps,fn){fn(ctx);},slots:{inject(name,fn){fn();},register(spec){registered=spec;}}};
  plugin.apply(ctx);
  assert.equal(registered.id,'dsh-chrome-use');
  assert.equal(mounted.descriptors[0].method,'read');
  const injected=registered.inject();
  assert.equal((await injected.read()).value.connected,true);
  assert.equal((await injected.pair()).value.code,'12345678');
});
