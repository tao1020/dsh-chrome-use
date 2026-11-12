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

test('popup asks only for the pairing code, with no port or usage text', async () => {
  const html = await readFile(new URL('../extension/popup.html', import.meta.url), 'utf8');
  assert.match(html, /id="code"/);
  assert.match(html, /id="pair-form"/);
  assert.doesNotMatch(html, /id="port"/);
  assert.doesNotMatch(html, /使用方法：/);
  assert.doesNotMatch(html, /class="intro"/);
});

test('popup shows connection errors right below the pairing-code row', async () => {
  const html = await readFile(new URL('../extension/popup.html', import.meta.url), 'utf8');
  const row = html.indexOf('class="pair-row"');
  const error = html.indexOf('id="error"');
  const tabs = html.indexOf('id="tabs"');
  assert.ok(row > -1 && error > row && error < tabs, 'error box should follow the code input, above the tab list');
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
  assert.match(client, /喜欢这个插件？去 GitHub 点个 Star/);
  assert.match(client, /const repositoryUrl = 'https:\/\/github\.com\/tao1020\/dsh-chrome-use'/);
});
