import test from 'node:test';
import assert from 'node:assert/strict';
import { newerVersion, checkRelease } from '../src/release-check.js';
test('release versions compare numerically and reject invalid versions', () => {
  assert.equal(newerVersion('0.1.10', '0.1.2'), true);
  assert.equal(newerVersion('0.1.2', '0.1.2'), false);
  assert.equal(newerVersion('0.1.1', '0.1.2'), false);
  assert.throws(() => newerVersion('main', '0.1.2'));
});
test('release lookup handles new releases, no release and server errors', async () => {
  const fetcher = async (url, options) => {
    assert.equal(new URL(url).hostname, 'api.github.com');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    return {ok:true,text:async()=>JSON.stringify({tag_name:'release-v0.1.3'})};
  };
  assert.match((await checkRelease('0.1.2',fetcher)).message,/新版本/);
  assert.match((await checkRelease('0.1.2',async()=>({status:404}))).message,/没有/);
  await assert.rejects(checkRelease('0.1.2',async()=>({status:403,ok:false})),/403/);
  await assert.rejects(checkRelease('0.1.2',async()=>({ok:true,text:async()=>'invalid'})));
});
