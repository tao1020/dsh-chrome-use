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

export function connectionRow({ port, connected = false, version = null, error = '' } = {}) {
  const state = connected ? 'connected' : error ? 'error' : 'saved';
  return {
    port,
    state,
    connected: Boolean(connected),
    text: connected
      ? `端口 ${port} · 已连接${version ? ` · ${version}` : ''}`
      : error
        ? `端口 ${port} · 未连接：${error}`
        : `端口 ${port} · 已保存，未连接`,
    canConnect: !connected,
    canForget: true,
  };
}
