// Visibility of the popup's pairing controls for each connection state.
// Kept separate from the DOM code so the three states are testable.
export function popupState({ connected, paired }) {
  const pairedOnly = Boolean(paired) && !connected;
  return {
    formHidden: Boolean(connected),
    labelHidden: pairedOnly,
    codeHidden: pairedOnly,
    permissionHidden: pairedOnly,
    helpHidden: pairedOnly,
    introHidden: Boolean(connected),
    introText: pairedOnly
      ? '已保存配对，点下面的“连接”即可。'
      : '使用方法：在 Harness 里说“请用 chrome_pair 连接浏览器”，把收到的 8 位配对码填到下面，点击“连接”即可让 AI 操作网页。',
  };
}
