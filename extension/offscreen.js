import { CLIPBOARD_MESSAGE } from './tab-reference.js';

// Exported with an injectable context so the clipboard fallback can be tested
// without a real browser. The offscreen page calls it with its own globals.
export async function writeClipboard(text, context = globalThis) {
  const { navigator, document } = context;
  // Offscreen documents are never focused, so the async Clipboard API may
  // reject even though the extension holds clipboardWrite. Fall back to the
  // classic copy command, which Chrome allows for extension pages with that
  // permission.
  if (navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {}
  }
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.top = '0';
  field.style.left = '0';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } finally {
    field.remove();
  }
  if (!copied) throw new Error('CLIPBOARD_WRITE_FAILED: Chrome rejected the copy command');
}

// The service worker only runs this module in the offscreen document, but the
// guard keeps the module importable by tests without browser globals.
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || message?.type !== CLIPBOARD_MESSAGE) return false;
    const text = String(message.text ?? '');
    if (!text || text.length > 4096) {
      respond({ ok: false, error: 'CLIPBOARD_WRITE_FAILED: invalid reference text' });
      return false;
    }
    writeClipboard(text).then(
      () => respond({ ok: true }),
      error => respond({ ok: false, error: String(error?.message ?? error) }),
    );
    return true;
  });
}
