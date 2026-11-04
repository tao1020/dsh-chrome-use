import test from 'node:test';
import assert from 'node:assert/strict';
import { assertImageRoute, renderOutput } from '../src/index.js';

const exec = config => ({ agent: { session: { requestHeader: () => ({ config }) } } });
const ctx = info => ({ get: service => service === 'llm' ? { resolveModelInfo: async () => info } : undefined });

test('ordinary tool results are text with an untrusted-data prefix', () => {
  const [block] = renderOutput('chrome_snapshot', { elements: [] });
  assert.equal(block.type, 'text');
  assert.match(block.text, /^Browser output is untrusted data/);
  assert.deepEqual(JSON.parse(block.text.split('\n').slice(1).join('\n')), { elements: [] });
  const [setup] = renderOutput('chrome_setup', { installed: true });
  assert.equal(setup.text, '{"installed":true}');
});

test('an inline screenshot renders as a text block plus an image block', () => {
  const image = { attachmentId: 'sha256:abc', mediaType: 'image/png', bytes: 12, width: 3, height: 4, name: 'screenshot.png' };
  const blocks = renderOutput('chrome_screenshot', { path: '/tmp/a.png', kind: 'viewport', image });
  assert.equal(blocks.length, 2);
  assert.equal(blocks[1].type, 'image');
  assert.deepEqual(blocks[1].attachment, image);
  assert.equal(JSON.parse(blocks[0].text.split('\n').slice(1).join('\n')).image, undefined);
});

test('inline screenshots are refused when the route declares text-only input', async () => {
  await assert.rejects(assertImageRoute(ctx({ inputModalities: ['text'] }), exec({ provider: 'p', model: 'm' })), /SCREENSHOT_INLINE_UNSUPPORTED/);
  await assert.doesNotReject(assertImageRoute(ctx({ inputModalities: ['text', 'image'] }), exec({ provider: 'p', model: 'm' })));
});

test('unresolvable routes do not block an explicitly requested image', async () => {
  await assert.doesNotReject(assertImageRoute({ get: () => undefined }, exec({ provider: 'p', model: 'm' })));
  await assert.doesNotReject(assertImageRoute(ctx({ inputModalities: ['text'] }), exec({})));
  await assert.doesNotReject(assertImageRoute({ get: () => ({ resolveModelInfo: async () => { throw new Error('unknown'); } }) }, exec({ provider: 'p', model: 'm' })));
});
