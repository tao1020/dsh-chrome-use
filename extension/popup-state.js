// The popup can hold several harness connections, so the pairing form is never
// hidden: a user with one connection may want to add a second. Keep the view
// model pure so the states are testable without a DOM.
export function popupState({ connections = [], reconnecting = false } = {}) {
  const rows = connections.map(connectionRow);
  const connectedCount = rows.filter(row => row.connected).length;
  const connected = connectedCount > 0;
  const paired = rows.length > 0;
  return {
    connected,
    paired,
    connectedCount,
    reconnecting: Boolean(reconnecting) && !connected,
    statusText: connected
      ? `已连接 ${connectedCount} 个 Harness`
      : reconnecting
        ? '已配对，正在等待本机 Harness'
        : paired
          ? '已配对，点击连接即可'
          : '尚未配对',
    connections: rows,
  };
}

export function connectionRow({ port, host = null, connected = false, version = null, name = null, error = '' } = {}) {
  const state = connected ? 'connected' : error ? 'error' : 'saved';
  // A non-default host is the interesting part of the row: without it two
  // connections on the same port look identical.
  const remote = host && host !== '127.0.0.1' && host !== 'localhost';
  const address = remote ? (host.includes(':') ? `[${host}]` : host) : null;
  const endpoint = address ? `${address}:${port}` : String(port);
  return {
    port,
    host: host || null,
    name: name || null,
    state,
    connected: Boolean(connected),
    // A harness may name itself when it connects; the port stays visible so the
    // popup still tells the user exactly which bridge the row refers to.
    title: name ? `${name} · ${endpoint}` : address ? endpoint : `端口 ${port}`,
    meta: connected
      ? `已连接${version ? ` · ${version}` : ''}`
      : error
        ? '未连接'
        : '已保存，未连接',
    error: error || '',
    hint: error ? 'Harness 可能已离线或还没启动。' : '',
    canConnect: !connected,
    canForget: true,
  };
}
