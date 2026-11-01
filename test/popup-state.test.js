import test from 'node:test';
import assert from 'node:assert/strict';
import { popupState } from '../extension/popup-state.js';

test('connected popup hides the whole pairing form', () => {
  const show = popupState({ connected: true, paired: true });
  assert.equal(show.formHidden, true);
  assert.equal(show.pairedHintHidden, true);
});

test('paired but disconnected keeps only the connect button and a short hint', () => {
  const show = popupState({ connected: false, paired: true });
  assert.deepEqual(show, {
    formHidden: false,
    labelHidden: true,
    codeHidden: true,
    permissionHidden: true,
    helpHidden: true,
    pairedHintHidden: false,
  });
});

test('unpaired popup shows the code input and the full explanation', () => {
  const show = popupState({ connected: false, paired: false });
  assert.equal(show.formHidden, false);
  assert.equal(show.codeHidden, false);
  assert.equal(show.permissionHidden, false);
  assert.equal(show.pairedHintHidden, true);
});
