// Page-side extraction source. These strings are evaluated inside the page, so
// they must stay self-contained: no imports and no variables from this module.
// The Markdown form is deliberately approximate; readability-style
// main-content detection and boilerplate removal are out of scope.

export const TEXT_EXPRESSION = "(() => { const body = document.body; return body ? String(body.innerText ?? '').slice(0, 100001) : ''; })()";

export const MARKDOWN_FN = String.raw`function() {
  const skip = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'IFRAME', 'HEAD', 'META', 'LINK']);
  const blocks = new Set(['DIV', 'SECTION', 'ARTICLE', 'MAIN', 'HEADER', 'FOOTER', 'ASIDE', 'FORM', 'FIELDSET', 'FIGURE', 'DETAILS', 'SUMMARY']);
  const clean = value => String(value ?? '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const visible = element => { const style = getComputedStyle(element); return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0; };
  const absolute = value => { try { return new URL(value, location.href).href; } catch { return ''; } };
  let visited = 0;
  const walk = node => {
    if (node.nodeType === 3) return String(node.nodeValue ?? '');
    if (node.nodeType !== 1) return '';
    if (++visited > 20000 || skip.has(node.tagName) || !visible(node)) return '';
    const tag = node.tagName;
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
  const body = document.body;
  return body ? walk(body).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 100001) : '';
}`;
