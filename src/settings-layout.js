// Section order for the settings page. A user who is not connected needs the
// install and pairing steps before any status text; a connected user needs the
// status first. Keeping the order in one place makes the two cases testable.
export function settingsSectionOrder(connected) {
  return connected ? ['status', 'install', 'update'] : ['install', 'pair', 'status', 'update'];
}
