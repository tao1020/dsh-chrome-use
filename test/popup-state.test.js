import test from 'node:test';
import assert from 'node:assert/strict';
import { popupState } from '../extension/popup-state.js';

test('connected popup hides the pairing form and the intro block', () => {
  const show = popupState({ connected: true, paired: true });
  assert.equal(show.formHidden, true);
  assert.equal(show.introHidden, true);
});

test('paired but disconnected keeps only the connect button', () => {
  const show = popupState({ connected: false, paired: true });
  assert.deepEqual(show, {
    formHidden: false,
    labelHidden: true,
    codeHidden: true,
    permissionHidden: true,
    helpHidden: true,
    introHidden: false,
    introText: '已保存配对，点下面的“连接”即可。',
  });
});

test('unpaired popup shows the code input, the full explanation and the pairing steps', () => {
  const show = popupState({ connected: false, paired: false });
  assert.equal(show.formHidden, false);
  assert.equal(show.codeHidden, false);
  assert.equal(show.permissionHidden, false);
  assert.equal(show.introHidden, false);
  assert.match(show.introText, /8 位配对码/);
});
