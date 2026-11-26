// The tab reference copied from Chrome's tab context menu. The @ source in
// src/mention.js serializes the same line, so a pasted reference and a picked
// chip reach the model in the same shape; test/tab-reference.test.js keeps the
// two formatters in sync.

export const TAB_REFERENCE_MENU_ID = 'dsh-chrome-use-copy-reference';
export const TAB_REFERENCE_MENU_TITLE = '复制 DSH Chrome Use 引用';

// The offscreen document is the only MV3 context that can write to the system
// clipboard without a page or a user gesture of its own.
export const CLIPBOARD_MESSAGE = 'dsh-chrome-use:clipboard-write';
const OFFSCREEN_PAGE = 'offscreen.html';

function shorten(value, limit) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function clipUrl(value) {
  const url = String(value ?? '');
  if (url === '') return '';
  return ` ${url.length > 300 ? `${url.slice(0, 299)}…` : url}`;
}

// Keep in sync with mentionSerializeText() in src/mention.js: tab id, title and
// URL on one line, then a Markdown rule that separates the reference from the
// user's own words.
export function tabReferenceText(tab) {
  const tabId = tab?.id;
  if (!Number.isSafeInteger(tabId) || tabId < 1) throw new Error('TAB_ID_INVALID: cannot copy a reference without a tab id');
  const title = shorten(tab.title, 120) || '未命名页面';
  return `[Chrome 标签页 #${tabId}] 《${title}》${clipUrl(tab.url)}\n\n---\n\n`;
}

let creatingOffscreen;

async function ensureOffscreenDocument() {
  const url = chrome.runtime.getURL(OFFSCREEN_PAGE);
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });
  if (contexts.length) return;
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: OFFSCREEN_PAGE,
      reasons: ['CLIPBOARD'],
      justification: 'Write the "copy DSH Chrome Use reference" text to the clipboard.',
    }).finally(() => { creatingOffscreen = undefined; });
  }
  await creatingOffscreen;
}

export async function copyTabReference(tab) {
  const text = tabReferenceText(tab);
  await ensureOffscreenDocument();
  // createDocument() resolves when the document exists, which can be a tick
  // before offscreen.js has registered its listener. Retry the transport error
  // instead of failing a copy the user already asked for.
  let lastError;
  for (let attempt = 0; attempt < 8; attempt++) {
    let response;
    try {
      response = await chrome.runtime.sendMessage({ type: CLIPBOARD_MESSAGE, text });
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 50));
      continue;
    }
    if (!response) {
      lastError = new Error('CLIPBOARD_WRITE_FAILED: no response from the offscreen page');
      await new Promise(resolve => setTimeout(resolve, 50));
      continue;
    }
    if (response.ok !== true) throw new Error(response.error || 'CLIPBOARD_WRITE_FAILED');
    return text;
  }
  throw lastError;
}

export function createTabReferenceMenu() {
  chrome.contextMenus.create({
    id: TAB_REFERENCE_MENU_ID,
    title: TAB_REFERENCE_MENU_TITLE,
    contexts: ['tab'],
  }, () => {
    // The item survives service-worker restarts, so creating it again is
    // expected; reading lastError keeps that out of the extension console.
    void chrome.runtime.lastError;
  });
}
