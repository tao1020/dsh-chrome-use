// Structured failures shared by the extension and the Harness plugin. Every
// browser-side error arrives as "CODE: message"; the failure object keeps the
// machine-readable parts (code, whether input may already have been sent and
// what to try next) so a model can act on a failure instead of only reading it.
// This module has no Chrome or Node side effects.

// Actions that inject input into the page. For these a timeout means Chrome may
// already have acted, so the code must not say "nothing happened".
export const INPUT_ACTIONS = new Set([
  'click', 'fill', 'key', 'hover', 'select', 'upload', 'drag', 'scroll', 'scroll_to', 'activate', 'close', 'navigate',
]);

// retry: snapshot  - the page must be read again before the next action
//        claim     - the tab session is gone; claim it again
//        other-tab - this tab is busy or owned elsewhere; pick another one
//        wait      - something transient is still running; retry shortly
//        inspect   - the outcome is unknown; read the page before retrying
//        user      - only the user can change the condition (connect, captcha, focus)
//        fix-args  - the call itself was wrong; fix the arguments
//        fix-page  - this element/page cannot do that; use another approach
//        none      - retrying the same call cannot help
const HINTS = {
  // connection and pairing
  BROWSER_NOT_CONNECTED: { retry: 'user', hint: 'Open Chrome with the dsh-chrome-use extension, or call chrome_pair and enter the code in the extension popup.' },
  BROWSER_DISCONNECTED: { retry: 'user', hint: 'The extension closed the connection; reconnect before continuing.' },
  BROWSER_BUSY: { retry: 'wait', hint: 'Another command is still running on this connection; wait for its result.' },
  BRIDGE_STOPPED: { retry: 'user', hint: 'The local bridge stopped; restart the Harness before retrying.' },
  BRIDGE_START_FAILED: { retry: 'user', hint: 'No loopback port is free; stop the other process or set DSH_CHROME_USE_PORT.' },
  AUTH_FAILED: { retry: 'user', hint: 'Request a fresh pairing code with chrome_pair.' },
  ALREADY_CONNECTED: { retry: 'none' },
  BROWSER_ALREADY_CONNECTED: { retry: 'none' },
  PAIRING_RATE_LIMIT: { retry: 'wait' },
  MISSING_CHAT_ID: { retry: 'none' },
  // tab ownership
  TAB_NOT_OWNED: { retry: 'claim', hint: 'Claim the tab first; a detach reason in the message explains the last session loss.' },
  TAB_NOT_LEASED: { retry: 'claim', hint: 'The extension no longer has a lease for this tab; claim it again.' },
  TAB_NOT_ATTACHED: { retry: 'claim', hint: 'The debugger session is gone; claim the tab again.' },
  TAB_IN_USE: { retry: 'other-tab', hint: 'Another chat kept this tab; use a different tab or ask the user to release it.' },
  TAB_OWNED_BY_ANOTHER_HARNESS: { retry: 'other-tab', hint: 'Another Harness owns this tab; it never queues across Harnesses, so use another tab.' },
  TAB_BUSY: { retry: 'wait', hint: 'A command or cancellation cleanup is still running on this tab.' },
  TAB_LEASE_CLOSING: { retry: 'wait', hint: 'Another Harness is cleaning up this tab; wait for cleanup, do not loop.' },
  TAB_LEASE_QUARANTINED: { retry: 'user', hint: 'Chrome native cleanup did not settle; the user must reload the extension.' },
  TAB_CLAIM_PENDING: { retry: 'none', hint: 'This chat is already queued for the tab; await the first claim.' },
  TAB_CLOSED: { retry: 'other-tab', hint: 'The tab was closed; claim another one.' },
  TAB_BUSY_LEASE: { retry: 'wait' },
  OPEN_FAILED: { retry: 'inspect', hint: 'A tab was created but the open failed; check whether it is still open before retrying.' },
  LEASE_CONFLICT: { retry: 'other-tab' },
  // page and element state
  STALE_ELEMENT: { retry: 'snapshot', hint: 'Take a fresh snapshot; references from before the page changed are invalid.' },
  PAGE_CHANGED: { retry: 'snapshot' },
  SELECTOR_NOT_FOUND: { retry: 'snapshot', hint: 'The selector matched no element; inspect the page again.' },
  ELEMENT_NOT_VISIBLE: { retry: 'inspect', hint: 'The element has no visible box; scroll to it or pick a visible target.' },
  ELEMENT_OBSCURED_OR_IN_FRAME: { retry: 'inspect', hint: 'Another element covers the target, or it sits in a cross-origin frame; take a fresh snapshot and pick a reachable control.' },
  ELEMENT_DISABLED: { retry: 'user', hint: 'The control is disabled; the page state must change first.' },
  FRAME_UNSUPPORTED: { retry: 'inspect', hint: 'Cross-origin frames are not supported; ask the user to open that content in its own tab.' },
  PAGE_HIDDEN: { retry: 'user', hint: 'The Chrome window is minimized or covered, so synthetic input would be dropped; ask the user before calling chrome_activate.' },
  NOT_TEXT_INPUT: { retry: 'fix-page', hint: 'Use chrome_click or chrome_select for this control instead of chrome_fill.' },
  NOT_SELECT: { retry: 'fix-page', hint: 'This is not a native select; click the option in a custom dropdown instead.' },
  OPTION_NOT_FOUND: { retry: 'fix-page', hint: 'The option does not exist; read the options in a fresh snapshot.' },
  NO_DIALOG: { retry: 'none', hint: 'No alert/confirm/prompt is open; snapshot reports a pending dialog when there is one.' },
  WAIT_TIMEOUT: { retry: 'snapshot', hint: 'The condition never became true; inspect the page and adjust the condition or timeout.' },
  WAIT_CONDITION: { retry: 'fix-args', hint: 'Give exactly one of ref, selector, text, urlContains, predicate or networkIdle.' },
  WAIT_PREDICATE_ERROR: { retry: 'fix-args' },
  ASSERT_FAILED: { retry: 'inspect', hint: 'The assertion did not hold; the page may not have finished updating.' },
  CHALLENGE_DETECTED: { retry: 'user', hint: 'The page shows a bot/captcha challenge; ask the user to complete it in Chrome, then continue.' },
  NAVIGATION_FAILED: { retry: 'inspect' },
  NO_BACK_HISTORY: { retry: 'none' },
  NO_FORWARD_HISTORY: { retry: 'none' },
  NO_HISTORY: { retry: 'none' },
  UNSUPPORTED_PAGE: { retry: 'other-tab', hint: 'Only normal HTTP(S) pages can be attached; open the page in a normal tab.' },
  ATTACH_FAILED: { retry: 'user', hint: 'Chrome refused the debugger session; a blocked tab or another extension URL can cause it.' },
  // actions that may already have happened
  CHROME_TIMEOUT: { retry: 'inspect', hint: 'Chrome did not acknowledge in time; the action may already have happened, so read the page before retrying.' },
  BROWSER_TIMEOUT: { retry: 'inspect', hint: 'The extension did not answer in time; the action may already have happened.' },
  CANCELED: { retry: 'inspect', hint: 'Cancellation raced the result; inspect the page before retrying.' },
  COMMAND_CANCELED: { retry: 'inspect', hint: 'The command was canceled; inspect the page before retrying.' },
  BROWSER_CLEANUP_PENDING: { retry: 'user', hint: 'Native cleanup did not settle; the user must reload the extension before this tab is usable.' },
  BROWSER_CLEANUP_TIMEOUT: { retry: 'user' },
  RESULT_TOO_LARGE: { retry: 'fix-args', hint: 'Narrow the request (fewer elements, smaller element, or a smaller body).' },
  // arguments and uploads
  INVALID_ARGUMENT: { retry: 'fix-args' },
  INVALID_ARGUMENTS: { retry: 'fix-args' },
  MISSING_ARGUMENT: { retry: 'fix-args' },
  INVALID_URL: { retry: 'fix-args', hint: 'Only HTTP(S) URLs without embedded credentials are supported.' },
  INVALID_KEY: { retry: 'fix-args' },
  INVALID_PORT: { retry: 'fix-args' },
  UNKNOWN_TOOL: { retry: 'fix-args' },
  UNKNOWN_ACTION: { retry: 'fix-args' },
  UPLOAD_TARGET: { retry: 'fix-args' },
  UPLOAD_PATH_NOT_ABSOLUTE: { retry: 'fix-args' },
  UPLOAD_PATH_HIDDEN: { retry: 'fix-args', hint: 'Hidden paths are refused; choose an ordinary file under the home or temporary directory.' },
  UPLOAD_PATH_INVALID: { retry: 'fix-args' },
  UPLOAD_FILE_NOT_FOUND: { retry: 'fix-args' },
  UPLOAD_NOT_A_FILE: { retry: 'fix-args' },
  UPLOAD_FILE_TOO_LARGE: { retry: 'fix-args' },
  UPLOAD_PATH_OUTSIDE_HOME_OR_TEMP: { retry: 'fix-args', hint: 'Only files under the home or temporary directory can be uploaded.' },
  NOT_FILE_INPUT: { retry: 'fix-page' },
  FILE_CHOOSER_NOT_OPEN: { retry: 'inspect', hint: 'Arm the chooser with chrome_click chooser=true first, within 30 seconds.' },
  FILE_CHOOSER_INJECT_FAILED: { retry: 'inspect' },
  SCREENSHOT_TARGET: { retry: 'fix-args' },
  SCREENSHOT_EMPTY: { retry: 'inspect' },
  SCREENSHOT_TOO_LARGE: { retry: 'fix-args' },
  SCREENSHOT_INLINE_UNSUPPORTED: { retry: 'fix-args', hint: 'Call chrome_screenshot without inline=true to get the local path.' },
  SCREENSHOT_INLINE_UNAVAILABLE: { retry: 'fix-args' },
  INVALID_SCREENSHOT: { retry: 'none' },
  INVALID_PDF: { retry: 'none' },
  PDF_TOO_LARGE: { retry: 'fix-args' },
  SCROLL_TARGET: { retry: 'fix-args' },
  DRAG_TARGET: { retry: 'fix-args' },
  DRAG_SOURCE_GONE: { retry: 'snapshot' },
  DRAG_TARGET_NOT_FOUND: { retry: 'snapshot' },
  DRAG_OUT_OF_VIEW: { retry: 'inspect', hint: 'Scroll so both endpoints are visible, then take a fresh snapshot.' },
  DRAG_PLAN_FAILED: { retry: 'inspect' },
  FIND_QUERY: { retry: 'fix-args' },
  REQUEST_NOT_FOUND: { retry: 'none', hint: 'Only the latest 200 requests are kept; list them again.' },
  NETWORK_BODY_UNAVAILABLE: { retry: 'none', hint: 'Chrome may have evicted the body; capture it while the request is fresh.' },
  JAVASCRIPT_ERROR: { retry: 'fix-args', hint: 'The evaluated expression threw; fix the expression.' },
  DOWNLOADS_UNSUPPORTED: { retry: 'user' },
  GROUPING_UNSUPPORTED: { retry: 'none' },
  CONTENT_TARGET: { retry: 'fix-args' },
  CONTENT_FORMAT: { retry: 'fix-args' },
  SCRAPE_FIELDS: { retry: 'fix-args' },
  SCRAPE_TARGET: { retry: 'fix-args' },
  ACTION_NOT_ALLOWED: { retry: 'user', hint: 'This deployment disabled that action; use an allowed tool or ask the operator.' },
  DOCTOR_TARGET: { retry: 'fix-args' },
  PORT_PREFERENCE_WRITE_FAILED: { retry: 'none' },
  INVALID_BROWSER_RESPONSE: { retry: 'none' },
  INVALID_BROWSER_TAB: { retry: 'none' },
  COMMAND_DEADLINE: { retry: 'fix-args' },
};

const FALLBACK = { retry: 'inspect' };
const SENT_CODES = new Set(['RESULT_TOO_LARGE', 'OPEN_FAILED']);

function inferActionSent(code, action) {
  if (SENT_CODES.has(code)) return true;
  if (code === 'CHROME_TIMEOUT') return INPUT_ACTIONS.has(action) || action === 'navigate';
  // The extension was interrupted: input may or may not have reached the page.
  if (['BROWSER_TIMEOUT', 'CANCELED', 'BROWSER_DISCONNECTED', 'COMMAND_CANCELED', 'BROWSER_CLEANUP_PENDING', 'BROWSER_CLEANUP_TIMEOUT', 'CANCELED_OPEN'].includes(code)) return null;
  return false;
}

const CODE = /^([A-Z][A-Z0-9_]{2,40})\b/;

// Build the failure object for one error message. `action` is the short tool
// name (click, snapshot, ...) so a timeout can say whether input is involved.
export function classifyFailure(message, action = '') {
  // Page-side throws reach us as CDP descriptions such as "Error: STALE_ELEMENT";
  // strip that wrapper so the code itself is still machine-readable.
  const text = String(message ?? '').slice(0, 4000).replace(/^(?:Uncaught\s+)?(?:Error:\s*)+/, '');
  const match = CODE.exec(text);
  const code = match ? match[1] : 'UNKNOWN_FAILURE';
  const entry = HINTS[code] ?? FALLBACK;
  return {
    code,
    message: text,
    actionSent: inferActionSent(code, action),
    retry: entry.retry,
    ...(entry.hint ? { hint: entry.hint } : {}),
  };
}

// Turn a thrown error into the same shape, keeping a failure the extension or
// the bridge already attached instead of re-classifying it.
export function failureFromError(error, action = '') {
  const raw = error instanceof Error ? error.message : String(error);
  const existing = error && typeof error === 'object' ? error.failure : undefined;
  if (existing && typeof existing === 'object' && existing.code) {
    const stripped = raw.split('\nFailure: ')[0];
    return { ...classifyFailure(stripped, action), ...existing, message: stripped };
  }
  return classifyFailure(raw, action);
}

// One compact, human-readable block. The first line stays the CODE: message so
// existing error-code handling keeps working; the second line carries the
// machine-readable fields so a model can decide what to do next.
export function formatFailure(failure) {
  const fields = { code: failure.code, actionSent: failure.actionSent, retry: failure.retry };
  if (failure.hint) fields.hint = failure.hint;
  return `${failure.message}\nFailure: ${JSON.stringify(fields)}`;
}

export function failureSummary(failure) {
  return { code: failure.code, actionSent: failure.actionSent, retry: failure.retry, ...(failure.hint ? { hint: failure.hint } : {}) };
}
