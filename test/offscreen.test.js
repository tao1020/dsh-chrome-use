import test from 'node:test';
import assert from 'node:assert/strict';
import { writeClipboard } from '../extension/offscreen.js';

function fakeDocument({ copyResult = true } = {}) {
  const fields = [];
  const body = { children: [], appendChild(field) { this.children.push(field); } };
  const document = {
    body,
    createElement() {
      const field = {
        value: '',
        style: {},
        selected: false,
        removed: false,
        setAttribute() {},
        select() { this.selected = true; },
        remove() { this.removed = true; },
      };
      fields.push(field);
      return field;
    },
    appendChild(field) { body.children.push(field); },
    execCommand(name) {
      assert.equal(name, 'copy');
      return copyResult;
    },
  };
  return { document, fields };
}

test('the offscreen page prefers the async Clipboard API', async () => {
  const { document, fields } = fakeDocument();
  let written;
  const navigator = { clipboard: { async writeText(text) { written = text; } } };
  await writeClipboard('引用文本', { navigator, document });
  assert.equal(written, '引用文本');
  assert.equal(fields.length, 0);
});

test('an unfocused offscreen page falls back to the copy command', async () => {
  const { document, fields } = fakeDocument();
  const navigator = { clipboard: { async writeText() { throw new Error('Document is not focused'); } } };
  await writeClipboard('引用文本', { navigator, document });
  assert.equal(fields.length, 1);
  assert.equal(fields[0].value, '引用文本');
  assert.equal(fields[0].selected, true);
  assert.equal(fields[0].removed, true);
});

test('a rejected copy command surfaces a write failure', async () => {
  const { document, fields } = fakeDocument({ copyResult: false });
  await assert.rejects(writeClipboard('引用文本', { navigator: {}, document }), /CLIPBOARD_WRITE_FAILED/);
  assert.equal(fields[0].removed, true);
});

test('text is not copied when the clipboard API is unavailable and the command rejects', async () => {
  const { document } = fakeDocument({ copyResult: false });
  await assert.rejects(writeClipboard('x', { document }), /CLIPBOARD_WRITE_FAILED/);
});
