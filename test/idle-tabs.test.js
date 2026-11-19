import test from 'node:test';
import assert from 'node:assert/strict';
import { createIdleTabs, IDLE_CLOSE_MS, IDLE_STORAGE_KEY } from '../extension/idle-tabs.js';

function storage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    get: async key => ({ [key]: data[key] }),
    set: async value => { Object.assign(data, value); },
    remove: async key => { delete data[key]; },
  };
}

test('idle tabs record one activity time per tab and expire after thirty minutes', async () => {
  let now = 1_000_000;
  const fake = storage();
  const idle = createIdleTabs(fake, { now: () => now });
  await idle.note(18791, 9);
  await idle.note(18791, 9);
  assert.equal(await idle.count(), 1);
  assert.deepEqual(fake.data[IDLE_STORAGE_KEY], [{ tabId: 9, port: 18791, lastActivityAt: now }]);
  assert.deepEqual(await idle.due(), []);

  now += IDLE_CLOSE_MS - 1;
  assert.deepEqual(await idle.due(), []);
  now += 1;
  assert.deepEqual(await idle.due(), [{ tabId: 9, port: 18791, lastActivityAt: 1_000_000 }]);
});

test('due accepts a custom timeout for configurable idle closing', async () => {
  let now = 1_000_000;
  const idle = createIdleTabs(storage(), { now: () => now });
  await idle.note(18791, 9);
  now += 999;
  assert.deepEqual(await idle.due(1000), []);
  now += 1;
  assert.deepEqual(await idle.due(1000), [{ tabId: 9, port: 18791, lastActivityAt: 1_000_000 }]);
});

test('activity extends the deadline, but only for a tracked tab', async () => {
  let now = 1_000_000;
  const idle = createIdleTabs(storage(), { now: () => now });
  await idle.note(18791, 9);
  now += IDLE_CLOSE_MS - 1;
  assert.equal(await idle.touch(9), true);
  assert.equal(await idle.touch(10), false);
  now += IDLE_CLOSE_MS - 1;
  assert.deepEqual(await idle.due(), []);
  now += 1;
  assert.equal((await idle.due()).length, 1);
});

test('forget removes only the requested tab and ignores malformed records', async () => {
  const fake = storage({
    [IDLE_STORAGE_KEY]: [
      { tabId: 9, port: 18791, lastActivityAt: 10 },
      { tabId: 9, port: 18791, lastActivityAt: 20 },
      { tabId: 10, port: 18793, lastActivityAt: 15 },
      { tabId: 'bad', port: 18791, lastActivityAt: 20 },
    ],
  });
  const idle = createIdleTabs(fake, { now: () => 20 });
  assert.equal(await idle.count(), 2);
  assert.equal(await idle.forget(9), true);
  assert.equal(await idle.forget(9), false);
  assert.deepEqual(fake.data[IDLE_STORAGE_KEY], [{ tabId: 10, port: 18793, lastActivityAt: 15 }]);
});

test('concurrent notes are serialized instead of losing a tab', async () => {
  const idle = createIdleTabs(storage());
  await Promise.all([idle.note(18791, 9), idle.note(18793, 10), idle.note(18791, 11)]);
  assert.equal(await idle.count(), 3);
});
