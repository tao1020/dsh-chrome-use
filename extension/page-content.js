// Page-side extraction source. These strings are evaluated inside the page, so
// they must stay self-contained: no imports and no variables from this module.
// The Markdown form is deliberately approximate; readability-style
// main-content detection and boilerplate removal are out of scope.

export const TEXT_EXPRESSION = `(() => {
  const parts = [];
  const walk = (doc, depth) => {
    if (!doc || depth > 2) return;
    const body = doc.body;
    if (body) parts.push(String(body.innerText ?? ''));
    for (const frame of doc.querySelectorAll('iframe')) {
      try { const inner = frame.contentDocument; if (inner) walk(inner, depth + 1); } catch {}
    }
  };
  walk(document, 0);
  return parts.join('\\n').slice(0, 100001);
})()`;

export const MARKDOWN_FN = String.raw`function(root) {
  const skip = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'IFRAME', 'HEAD', 'META', 'LINK']);
  const blocks = new Set(['DIV', 'SECTION', 'ARTICLE', 'MAIN', 'HEADER', 'FOOTER', 'ASIDE', 'FORM', 'FIELDSET', 'FIGURE', 'DETAILS', 'SUMMARY']);
  const clean = value => String(value ?? '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const visible = element => {
    // Per-frame documents carry their own view; fall back to the global view
    // when a detached tree has none, and assume visible when it cannot be read.
    const view = (element.ownerDocument && element.ownerDocument.defaultView) || (typeof getComputedStyle === 'function' ? globalThis : null);
    if (!view || typeof view.getComputedStyle !== 'function') return true;
    const style = view.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
  };
  const absolute = value => { try { return new URL(value, location.href).href; } catch { return ''; } };
  let visited = 0;
  const walk = node => {
    if (node.nodeType === 3) return String(node.nodeValue ?? '');
    if (node.nodeType !== 1) return '';
    if (++visited > 20000) return '';
    const tag = node.tagName;
    if (tag === 'IFRAME') {
      try { const doc = node.contentDocument; return doc && doc.body ? walk(doc.body) : ''; } catch { return ''; }
    }
    if (skip.has(tag) || !visible(node)) return '';
    const inner = () => Array.from(node.childNodes, walk).join('');
    if (/^H[1-6]$/.test(tag)) return '\n\n' + '#'.repeat(Number(tag[1])) + ' ' + clean(inner()) + '\n\n';
    if (tag === 'PRE') return '\n\n~~~\n' + String(node.innerText ?? '').slice(0, 5000) + '\n~~~\n\n';
    if (blocks.has(tag) || tag === 'P' || tag === 'BLOCKQUOTE' || tag === 'TABLE' || tag === 'UL' || tag === 'OL' || tag === 'DL') return '\n\n' + inner() + '\n\n';
    if (tag === 'BR') return '\n';
    if (tag === 'HR') return '\n\n---\n\n';
    if (tag === 'LI') return '\n- ' + clean(inner());
    if (tag === 'DT') return '\n\n**' + clean(inner()) + '**\n';
    if (tag === 'DD') return ': ' + clean(inner());
    if (tag === 'A') {
      const text = clean(inner());
      const href = absolute(node.getAttribute('href') || '');
      return text && href && !href.startsWith('javascript:') ? '[' + text + '](' + href + ')' : text;
    }
    if (tag === 'IMG') {
      const alt = clean(node.getAttribute('alt') || '');
      const src = node.getAttribute('src') || '';
      return src && !src.startsWith('data:') ? '![' + alt + '](' + absolute(src) + ')' : alt ? '[' + alt + ']' : '';
    }
    if (tag === 'BUTTON') return ' [button: ' + (clean(inner()) || clean(node.getAttribute('aria-label') || '')) + '] ';
    if (tag === 'INPUT') {
      const label = clean(node.getAttribute('aria-label') || node.getAttribute('placeholder') || node.value || '');
      return label ? ' [input(' + (node.type || 'text') + '): ' + label + '] ' : '';
    }
    if (tag === 'TEXTAREA') {
      const label = clean(node.getAttribute('aria-label') || node.getAttribute('placeholder') || '');
      return ' [textarea' + (label ? ': ' + label : '') + '] ';
    }
    if (tag === 'TR') return '\n|' + inner();
    if (tag === 'TD' || tag === 'TH') return ' ' + clean(inner()) + ' |';
    if (tag === 'STRONG' || tag === 'B') return '**' + clean(inner()) + '**';
    if (tag === 'EM' || tag === 'I') return '_' + clean(inner()) + '_';
    return inner();
  };
  const body = root || document.body;
  return body ? walk(body).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 100001) : '';
}`;

// Bot checks and captchas are a user-only step: synthesized input would not
// solve them, so report the condition instead of retrying.
export const CHALLENGE_FN = String.raw`function() {
  const title = String(document.title || '');
  const text = String((document.body && document.body.innerText) || '').slice(0, 20000);
  const signals = [];
  const has = selector => { try { return Boolean(document.querySelector(selector)); } catch { return false; } };
  let type = '';
  if (/just a moment|attention required/i.test(title) || /checking your browser before accessing|enable javascript and cookies to continue|cf_chl_opt/i.test(text) || has('#challenge-form')) {
    type = 'cloudflare-challenge';
    signals.push('Cloudflare interstitial');
  }
  if (has('.g-recaptcha') || has('iframe[src*="recaptcha"]') || has('script[src*="recaptcha"]')) { type = type || 'recaptcha'; signals.push('reCAPTCHA'); }
  if (has('.h-captcha') || has('iframe[src*="hcaptcha"]')) { type = type || 'hcaptcha'; signals.push('hCaptcha'); }
  if (has('.cf-turnstile') || has('iframe[src*="challenges.cloudflare.com"]')) { type = type || 'turnstile'; signals.push('Turnstile'); }
  if (!type && /verify you are human|are you a robot|complete the captcha|solve the challenge/i.test(text)) { type = 'unknown-check'; signals.push('human verification text'); }
  return type ? { type, signals, title: title.slice(0, 200) } : null;
}`;

// A selector lookup that also walks open shadow roots, so pages built from web
// components can be read and scraped without a special mode.
export const DEEP_SELECTOR_HELPER = String.raw`const queryDeep = (root, selector) => {
  try { const direct = root.querySelector(selector); if (direct) return direct; } catch { return null; }
  let seen = 0;
  for (const element of root.querySelectorAll('*')) {
    if (++seen > 20000) break;
    const shadow = element.shadowRoot;
    if (!shadow) continue;
    try { const hit = shadow.querySelector(selector); if (hit) return hit; } catch { return null; }
  }
  return null;
};
const queryDeepAll = (root, selector, limit = 200) => {
  const found = [];
  const push = node => { if (found.length >= limit) return; if (!found.includes(node)) found.push(node); };
  try { for (const node of root.querySelectorAll(selector)) push(node); } catch { return []; }
  let seen = 0;
  for (const element of root.querySelectorAll('*')) {
    if (++seen > 20000 || found.length >= limit) break;
    const shadow = element.shadowRoot;
    if (!shadow) continue;
    try { for (const node of shadow.querySelectorAll(selector)) push(node); } catch { return found; }
  }
  return found;
};`;
