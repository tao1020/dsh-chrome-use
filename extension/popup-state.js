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
    pairedHintHidden: !pairedOnly,
  };
}
