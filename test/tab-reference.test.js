import test from 'node:test';
import assert from 'node:assert/strict';
import { mentionSerializeText } from '../src/mention.js';
import { TAB_REFERENCE_MENU_ID, TAB_REFERENCE_MENU_TITLE, tabReferenceText } from '../extension/tab-reference.js';

test('the copied reference matches what the @ tab source serializes', () => {
  const cases = [
    { id: 7, title: '订单列表', url: 'https://shop.test/orders' },
    { id: 8, title: '  Inbox\n  unread  ', url: 'https://mail.test/inbox' },
    { id: 9, title: '', url: '' },
    { id: 10, title: 'x'.repeat(200), url: `https://a.test/${'y'.repeat(400)}` },
  ];
  for (const tab of cases) {
    assert.equal(tabReferenceText(tab), mentionSerializeText(tab.id, { tabId: tab.id, title: tab.title, url: tab.url }));
  }
  assert.equal(tabReferenceText({ id: 7, title: '订单列表', url: 'https://shop.test/orders' }), '[Chrome 标签页 #7] 《订单列表》 https://shop.test/orders\n\n---\n\n');
  assert.equal(tabReferenceText({ id: 7 }), '[Chrome 标签页 #7] 《未命名页面》\n\n---\n\n');
});

test('a reference without a usable tab id is rejected instead of copied', () => {
  for (const tab of [undefined, null, {}, { id: 0 }, { id: -1 }, { id: 1.5 }, { id: '7' }]) {
    assert.throws(() => tabReferenceText(tab), /TAB_ID_INVALID/);
  }
});

test('the menu entry names the extension and the copy action', () => {
  assert.equal(TAB_REFERENCE_MENU_ID, 'dsh-chrome-use-copy-reference');
  assert.equal(TAB_REFERENCE_MENU_TITLE, '复制 DSH Chrome Use 引用');
});
