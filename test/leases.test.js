import test from 'node:test';
import assert from 'node:assert/strict';
import { TabLeases } from '../extension/leases.js';

const a = { port: 18791 };
const b = { port: 18793 };

test('a lease is owned by the connection object and rejects another harness', () => {
  const leases = new TabLeases();
  leases.acquire(7, a);
  assert.equal(leases.owner(7), a);
  assert.doesNotThrow(() => leases.acquire(7, a));
  assert.throws(() => leases.acquire(7, b), /TAB_OWNED_BY_ANOTHER_HARNESS/);
  assert.equal(leases.owner(7), a);
});

test('closing blocks acquisition until the lease is released', () => {
  const leases = new TabLeases();
  leases.acquire(7, a);
  leases.beginClose(7, a);
  assert.equal(leases.get(7).state, 'closing');
  assert.throws(() => leases.acquire(7, a), /TAB_LEASE_CLOSING/);
  assert.throws(() => leases.acquire(7, b), /TAB_LEASE_CLOSING/);
  leases.release(7, a);
  assert.equal(leases.get(7), undefined);
});

test('reserve refuses an existing tab without changing its owner', () => {
  const leases = new TabLeases();
  assert.equal(leases.reserve(9, a), true);
  assert.equal(leases.reserve(9, b), false);
  assert.equal(leases.owner(9), a);
});

test('release and quarantine only affect the owner; quarantine blocks until reload', () => {
  const leases = new TabLeases();
  leases.acquire(7, a);
  leases.release(7, b);
  assert.equal(leases.owner(7), a);
  leases.quarantine(7, b);
  assert.equal(leases.get(7).state, 'active');
  leases.quarantine(7, a);
  assert.equal(leases.get(7).state, 'quarantined');
  assert.throws(() => leases.acquire(7, a), /TAB_LEASE_QUARANTINED/);
  assert.deepEqual(leases.ownedBy(a), [7]);
  assert.deepEqual(leases.ownedBy(b), []);
  leases.release(7, a);
  assert.equal(leases.get(7), undefined);
});
