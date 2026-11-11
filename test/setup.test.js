import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extensionSetup } from '../src/index.js';

test('chrome_setup sends users to the published Chrome Web Store listing', () => {
  const setup = extensionSetup();
  assert.equal(setup.storeUrl, 'https://chromewebstore.google.com/detail/anobmlnjdeahldefeikjdmmnckphpdhc');
  assert.match(setup.steps.join(' '), /Add to Chrome/);
  assert.match(setup.note, /updates store-installed extensions automatically/);
});

test('popup puts the one-sentence usage and the repository link above the status', async () => {
  const html = await readFile(new URL('../extension/popup.html', import.meta.url), 'utf8');
  const intro = html.indexOf('class="intro"');
  assert.ok(intro > html.indexOf('</header>'), 'usage block follows the header');
  assert.ok(intro < html.indexOf('id="status"'), 'usage block is above the status line');
  assert.match(html.slice(intro, html.indexOf('id="status"')), /使用方法：在 Harness 里说/);
  assert.match(html.slice(intro, html.indexOf('id="status"')), /https:\/\/github\.com\/tao1020\/dsh-chrome-use/);
});

test('popup offers the foreground-mode switch with one line per mode', async () => {
  const html = await readFile(new URL('../extension/popup.html', import.meta.url), 'utf8');
  assert.match(html, /id="foreground"/);
  assert.match(html, /前台模式/);
  assert.match(html, /抢走你正在用的应用的焦点/);
  assert.match(html, /不抢焦点/);
});

test('popup and settings invite the user to star the repository', async () => {
  const popup = await readFile(new URL('../extension/popup.html', import.meta.url), 'utf8');
  assert.match(popup, /喜欢这个插件？点个 Star，让更多人发现它 ⭐/);
  assert.match(popup, /https:\/\/github\.com\/tao1020\/dsh-chrome-use/);
  const client = await readFile(new URL('../src/client.js', import.meta.url), 'utf8');
  assert.match(client, /觉得好用？点个 Star ⭐ 这对我们很重要/);
  assert.match(client, /const repositoryUrl = 'https:\/\/github\.com\/tao1020\/dsh-chrome-use'/);
});
