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
