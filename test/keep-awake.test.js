import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { CAFFEINATE, createKeepAwake } from '../src/keep-awake.js';
import { TOOLS, validateArgs } from '../extension/protocol.js';

function harness({ platform = 'darwin', exists = true, spawnOverride } = {}) {
  const spawned = [];
  let clock = 1_700_000_000_000;
  const spawn = (command, args, options) => {
    if (spawnOverride) return spawnOverride(command, args, options, spawned);
    const child = new EventEmitter();
    child.pid = 9000 + spawned.length;
    child.killed = false;
    child.kill = () => { child.killed = true; };
    child.unref = () => { child.unrefd = true; };
    spawned.push({ command, args, options, child });
    return child;
  };
  const keepAwake = createKeepAwake({ platform, spawn, exists: () => exists, now: () => clock, pid: 4242 });
  return { spawned, keepAwake };
}

test('keep-awake starts caffeinate with a bounded lifetime tied to this process', () => {
  const { spawned, keepAwake } = harness();
  const state = keepAwake.start(10);
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].command, CAFFEINATE);
  assert.deepEqual(spawned[0].args, ['-dimsu', '-t', '600', '-w', '4242']);
  assert.deepEqual(spawned[0].options, { stdio: 'ignore' });
  assert.equal(spawned[0].child.unrefd, true);
  assert.equal(state.active, true);
  assert.equal(state.minutes, 10);
  assert.equal(state.pid, 9000);
  assert.equal(state.expiresAt, new Date(1_700_000_000_000 + 600_000).toISOString());
});

test('keep-awake defaults to 30 minutes and renews before stopping the old assertion', () => {
  const { spawned, keepAwake } = harness();
  keepAwake.start();
  assert.equal(spawned[0].args[2], '1800');
  keepAwake.start(20);
  assert.equal(spawned.length, 2);
  assert.equal(spawned[0].child.killed, true, 'the old assertion is stopped after the replacement starts');
  assert.equal(spawned[1].child.killed, false);
  assert.deepEqual(spawned[1].args, ['-dimsu', '-t', '1200', '-w', '4242']);
});

test('keep-awake stop is idempotent and a natural caffeinate exit clears local state', () => {
  const { spawned, keepAwake } = harness();
  keepAwake.start(1);
  assert.equal(keepAwake.stop(), true);
  assert.equal(spawned[0].child.killed, true);
  assert.equal(keepAwake.stop(), false);

  keepAwake.start(1);
  spawned[1].child.emit('exit', 0, null);
  assert.equal(keepAwake.stop(), false, 'an exited child is no longer active');
});

test('a failed renewal keeps the previous assertion alive', () => {
  let calls = 0;
  const { spawned, keepAwake } = harness({
    spawnOverride: (command, args, options, list) => {
      calls += 1;
      if (calls === 2) throw new Error('spawn failed');
      const child = new EventEmitter();
      child.pid = 9000 + list.length;
      child.killed = false;
      child.kill = () => { child.killed = true; };
      child.unref = () => {};
      list.push({ command, args, options, child });
      return child;
    },
  });
  keepAwake.start(5);
  assert.throws(() => keepAwake.start(10), /KEEP_AWAKE_FAILED/);
  assert.equal(spawned[0].child.killed, false, 'the old assertion still protects the Mac');
  assert.equal(keepAwake.stop(), true);
});

test('keep-awake refuses unsupported platforms, missing caffeinate and invalid minutes', () => {
  const unsupported = harness({ platform: 'linux' });
  assert.throws(() => unsupported.keepAwake.start(10), /KEEP_AWAKE_UNSUPPORTED/);
  assert.equal(unsupported.spawned.length, 0);

  const missing = harness({ exists: false });
  assert.throws(() => missing.keepAwake.start(10), /KEEP_AWAKE_UNAVAILABLE/);
  assert.equal(missing.spawned.length, 0);

  const invalid = harness();
  for (const value of [0, 1.5, 481]) {
    assert.throws(() => invalid.keepAwake.start(value), /KEEP_AWAKE_MINUTES/);
  }
  assert.equal(invalid.spawned.length, 0);
});

test('chrome_keep_awake is a tabless tool with bounded minutes and an off switch', () => {
  const keep = TOOLS.find(entry => entry.name === 'chrome_keep_awake');
  assert.ok(keep, 'chrome_keep_awake is registered');
  assert.equal('tabId' in keep.parameters.properties, false);
  assert.deepEqual(keep.parameters.required, []);
  assert.equal(keep.parameters.properties.minutes.minimum, 1);
  assert.equal(keep.parameters.properties.minutes.maximum, 480);
  assert.doesNotThrow(() => validateArgs('chrome_keep_awake', {}));
  assert.doesNotThrow(() => validateArgs('chrome_keep_awake', { minutes: 480 }));
  assert.doesNotThrow(() => validateArgs('chrome_keep_awake', { off: true }));
  assert.throws(() => validateArgs('chrome_keep_awake', { minutes: 481 }), /out of range/);
  assert.throws(() => validateArgs('chrome_keep_awake', { tabId: 1 }), /INVALID_ARGUMENT/);
});
