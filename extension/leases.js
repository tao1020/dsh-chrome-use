// Cross-harness tab leases. The bridge keeps chat-level claims; this table is
// the extension's authority over which connection may touch a tab. A lease is
// owned by the client object (one socket/generation), not by a port number, so
// a stale connection can never inherit a newer connection's tab.
export class TabLeases {
  constructor() {
    this.entries = new Map();
  }

  get(tabId) {
    return this.entries.get(tabId);
  }

  owner(tabId) {
    return this.entries.get(tabId)?.client;
  }

  // A claim may re-enter for the same connection. A quarantined tab stays
  // blocked until the worker reloads because native cleanup never finished.
  acquire(tabId, client) {
    const current = this.entries.get(tabId);
    if (!current) {
      this.entries.set(tabId, { client, state: 'active' });
      return;
    }
    if (current.state === 'quarantined') throw new Error('TAB_LEASE_QUARANTINED: this tab did not finish native cleanup; reload the extension to clear it');
    if (current.state === 'closing') throw new Error('TAB_LEASE_CLOSING: this tab is being cleaned up; retry after cleanup settles');
    if (current.client === client) return;
    throw new Error('TAB_OWNED_BY_ANOTHER_HARNESS: another Harness has claimed this tab; use another tab or release it there');
  }

  // Used for a tab that Chrome just created. Returning false tells the caller
  // to fail closed without detaching a tab owned by someone else.
  reserve(tabId, client) {
    if (this.entries.has(tabId)) return false;
    this.entries.set(tabId, { client, state: 'active' });
    return true;
  }

  release(tabId, client) {
    const current = this.entries.get(tabId);
    if (current && (!client || current.client === client)) this.entries.delete(tabId);
  }

  // A connection that is closing owns no new commands. Mark it before any
  // await so a command accepted in the same turn cannot slip through.
  beginClose(tabId, client) {
    const current = this.entries.get(tabId);
    if (current && current.client === client && current.state === 'active') current.state = 'closing';
  }

  quarantine(tabId, client) {
    const current = this.entries.get(tabId);
    if (current && (!client || current.client === client)) current.state = 'quarantined';
  }

  ownedBy(client) {
    return [...this.entries].filter(([, entry]) => entry.client === client).map(([tabId]) => tabId);
  }

  clear() {
    this.entries.clear();
  }
}
