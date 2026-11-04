import test from 'node:test';
import assert from 'node:assert/strict';
import { MARKDOWN_FN, TEXT_EXPRESSION } from '../extension/page-content.js';

test('page expressions parse as standalone JavaScript', () => {
  assert.doesNotThrow(() => new Function(`return (${MARKDOWN_FN})`));
  assert.doesNotThrow(() => new Function(`return ${TEXT_EXPRESSION}`));
});

test('Markdown rendering covers headings, links, lists and buttons', () => {
  const element = (tagName, childNodes = [], attrs = {}) => ({
    nodeType: 1, tagName, childNodes,
    getAttribute: name => attrs[name] ?? null,
    get innerText() { return childNodes.map(node => node.nodeValue ?? '').join(''); },
  });
  const text = value => ({ nodeType: 3, nodeValue: value });
  const body = element('BODY', [
    element('H1', [text('Title')]),
    element('P', [text('Read '), element('A', [text('docs')], { href: '/docs' })]),
    element('UL', [element('LI', [text('one')]), element('LI', [text('two')])]),
    element('BUTTON', [text('Save')]),
    element('SCRIPT', [text('ignored()')]),
  ]);
  globalThis.document = { body };
  globalThis.location = { href: 'https://example.com/page' };
  globalThis.getComputedStyle = () => ({ display: 'block', visibility: 'visible', opacity: '1' });
  try {
    const markdown = new Function(`return (${MARKDOWN_FN})()`)();
    assert.match(markdown, /^# Title/);
    assert.match(markdown, /\[docs\]\(https:\/\/example\.com\/docs\)/);
    assert.match(markdown, /- one/);
    assert.match(markdown, /\[button: Save\]/);
    assert.ok(!markdown.includes('ignored()'));
  } finally {
    delete globalThis.document; delete globalThis.location; delete globalThis.getComputedStyle;
  }
});
