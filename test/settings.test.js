import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { parseStatus } from '../src/settings-contract.js';
test('settings exposes only connection metadata and rejects invalid status', () => {
  assert.deepEqual(parseStatus({connected:false,tabCount:0,extensionVersion:null,token:'secret'}),{connected:false,tabCount:0,extensionVersion:null});
  for(const value of [null,{}, {connected:true,tabCount:-1,extensionVersion:null}]) assert.throws(()=>parseStatus(value));
});
test('browser entry mounts the native settings slot and remote contract', async () => {
  let entry, registered, mounted;
  vm.runInNewContext(await readFile(new URL('../src/client.js',import.meta.url),'utf8'),{window:{__ModuleLoader__:{load(value){entry=value;}}}});
  const plugin=entry.factory(()=>({}));
  const ctx={effect(fn){fn();},remote:{$mount(contract){mounted=contract;return Promise.resolve(()=>{});},chromeUseStatus:{read:async()=>({ok:true,value:{connected:true,tabCount:1,extensionVersion:'0.1.1'}})}},inject(deps,fn){fn(ctx);},slots:{inject(name,fn){fn();},register(spec){registered=spec;}}};
  plugin.apply(ctx);
  assert.equal(registered.id,'dsh-chrome-use');
  assert.equal(mounted.descriptors[0].method,'read');
  assert.equal((await registered.inject().read()).value.connected,true);
});
