import { validateArgs } from './protocol.js';

export function pageUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('UNSUPPORTED_PAGE: use an HTTP(S) web page');
  return url.href;
}
const clip = (value, limit = 1000) => String(value ?? '').slice(0, limit);
function safeUrl(value) {
  try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) ? `${u.origin}${u.pathname}`.slice(0, 2000) : ''; } catch { return ''; }
}

const GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
export function groupColor(title) {
  let hash = 0;
  for (const char of title) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return GROUP_COLORS[hash % GROUP_COLORS.length];
}

async function bounded(promise, signal, label, milliseconds = 7000) {
  signal?.throwIfAborted();
  let timer;
  let cancel;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      cancel = () => reject(new Error('COMMAND_CANCELED'));
      signal?.addEventListener('abort', cancel, { once: true });
      timer = setTimeout(() => reject(new Error(`CHROME_TIMEOUT: ${label}`)), milliseconds);
    })]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

export class BrowserController {
  constructor(api, detached = () => {}) {
    this.api = api;
    this.detached = detached;
    this.attached = new Map();
    api.debugger.onDetach.addListener(({ tabId }) => {
      this.attached.delete(tabId);
      detached(tabId);
    });
    api.tabs.onRemoved.addListener(tabId => {
      this.attached.delete(tabId);
      detached(tabId);
    });
    api.debugger.onEvent.addListener((target, method, params) => this.event(target, method, params));
  }

  async reset() {
    const tabs = [...this.attached.keys()];
    this.attached.clear();
    await Promise.all(tabs.map(tabId => bounded(this.api.debugger.detach({ tabId }), undefined, 'detach', 1000).catch(() => {}))); // Already detached/closed is safe.
  }

  event({ tabId }, method, params) {
    const state = this.attached.get(tabId);
    if (!state) return;
    if (method === 'Page.frameNavigated' && !params.frame.parentId || method === 'DOM.documentUpdated') {
      state.refs.clear();
      state.revision++;
    }
    let entry;
    if (method === 'Runtime.consoleAPICalled') entry = { kind: 'console', level: params.type, text: params.args.map(arg => clip(arg.value ?? arg.description)).join(' ').slice(0, 4000) };
    if (method === 'Runtime.exceptionThrown') entry = { kind: 'exception', text: clip(params.exceptionDetails.exception?.description ?? params.exceptionDetails.text, 4000) };
    if (method === 'Network.responseReceived' && safeUrl(params.response.url)) entry = { kind: 'network', status: params.response.status, url: safeUrl(params.response.url), resourceType: params.type };
    if (method === 'Network.loadingFailed') entry = { kind: 'network-error', text: clip(params.errorText), canceled: Boolean(params.canceled), resourceType: params.type };
    if (entry) {
      state.logs.push({ time: new Date().toISOString(), ...entry });
      if (state.logs.length > 100) state.logs.shift();
    }
  }

  async command(tabId, method, params, signal) {
    signal.throwIfAborted();
    const result = await bounded(this.api.debugger.sendCommand({ tabId }, method, params), signal, method);
    signal.throwIfAborted();
    return result;
  }

  async attach(tabId, signal, newBlankTab = false) {
    const tab = await bounded(this.api.tabs.get(tabId), signal, 'tabs.get');
    const currentUrl = tab.url || tab.pendingUrl || 'about:blank';
    if (!(newBlankTab && currentUrl === 'about:blank')) pageUrl(currentUrl);
    signal.throwIfAborted();
    if (this.attached.has(tabId)) return;
    // Chrome promises cannot be canceled. Clean up even if attach finishes after our timeout.
    let abandoned = false;
    const attachment = this.api.debugger.attach({ tabId }, '1.3');
    attachment.then(() => { if (abandoned || signal.aborted) this.api.debugger.detach({ tabId }).catch(() => {}); }, () => {});
    try { await bounded(attachment, signal, 'attach'); }
    catch (error) { abandoned = true; throw error; }
    this.attached.set(tabId, { refs: new Map(), revision: 0, logs: [] });
    try {
      for (const domain of ['Page', 'DOM', 'Accessibility', 'Runtime', 'Network']) await this.command(tabId, `${domain}.enable`, {}, signal);
    } catch (error) {
      this.attached.delete(tabId);
      await bounded(this.api.debugger.detach({ tabId }), undefined, 'detach', 1000).catch(() => {});
      throw error;
    }
  }

  async element(tabId, ref, signal) {
    const backendNodeId = this.attached.get(tabId)?.refs.get(ref);
    if (!backendNodeId) throw new Error('STALE_ELEMENT: take a fresh snapshot');
    const { object } = await this.command(tabId, 'DOM.resolveNode', { backendNodeId, objectGroup: 'harness-bridge' }, signal);
    if (!object?.objectId) throw new Error('STALE_ELEMENT: element no longer exists');
    return object.objectId;
  }

  // Grouping is best effort for the caller: an older Chrome or a pinned tab must
  // not fail the open, but the tab still belongs to the named series when it can.
  async group(tabId, title, signal) {
    const api = this.api;
    if (typeof api.tabs?.group !== 'function') throw new Error('GROUPING_UNSUPPORTED: this Chrome exposes no tabs.group API');
    const tab = await bounded(api.tabs.get(tabId), signal, 'tabs.get');
    let groupId;
    if (typeof api.tabGroups?.query === 'function') {
      const existing = await bounded(api.tabGroups.query(tab.windowId === undefined ? { title } : { title, windowId: tab.windowId }), signal, 'tabGroups.query');
      if (Array.isArray(existing) && existing.length) groupId = existing[0].id;
    }
    groupId = await bounded(api.tabs.group(groupId === undefined ? { tabIds: [tabId] } : { tabIds: [tabId], groupId }), signal, 'tabs.group');
    if (typeof api.tabGroups?.update === 'function') await bounded(api.tabGroups.update(groupId, { title, color: groupColor(title), collapsed: false }), signal, 'tabGroups.update');
    return { id: groupId, title };
  }

  async execute(action, raw, signal = new AbortController().signal) {
    const args = validateArgs(`chrome_${action}`, raw);
    signal.throwIfAborted();
    const tabId = args.tabId;
    const cdp = (method, params = {}) => this.command(tabId, method, params, signal);
    if (action === 'tabs') {
      const tabs = await bounded(this.api.tabs.query({}), signal, 'tabs.query');
      return { tabs: tabs.filter(tab => /^https?:\/\//.test(tab.url ?? '')).map(tab => ({ tabId: tab.id, title: clip(tab.title, 300), url: clip(tab.url, 4096), attached: this.attached.has(tab.id) })) };
    }
    if (action === 'open') {
      const url = pageUrl(args.url);
      const title = args.group.trim();
      const tab = await bounded(this.api.tabs.create({ url: 'about:blank', active: false }), signal, 'tabs.create');
      let group;
      let groupError;
      try { group = await this.group(tab.id, title, signal); }
      catch (error) { groupError = String(error.message).slice(0, 300); }
      try {
        await this.attach(tab.id, signal, true);
        const result = await this.command(tab.id, 'Page.navigate', { url }, signal);
        if (result.errorText) throw new Error(result.errorText);
        return { tabId: tab.id, url, navigationStarted: true, group: group ?? null, ...(groupError ? { groupError } : {}) };
      } catch (error) {
        this.attached.delete(tab.id);
        await bounded(this.api.debugger.detach({ tabId: tab.id }), undefined, 'detach', 1000).catch(() => {});
        throw new Error(`OPEN_FAILED (tab ${tab.id} remains open): ${error.message}`);
      }
    }
    if (action === 'claim') {
      await this.attach(tabId, signal);
      return { tabId, attached: true };
    }
    if (action === 'close') {
      // Removing the tab also drops the debugger session; clean local state first
      // so a failed remove cannot leave a claim pointing at a closed tab.
      this.attached.delete(tabId);
      await bounded(this.api.tabs.remove(tabId), signal, 'tabs.remove');
      return { tabId, closed: true };
    }
    if (!this.attached.has(tabId)) throw new Error('TAB_NOT_ATTACHED: claim the tab again');
    if (action === 'release') {
      await bounded(this.api.debugger.detach({ tabId }), signal, 'detach');
      this.attached.delete(tabId);
      return { tabId, released: true };
    }
    pageUrl((await bounded(this.api.tabs.get(tabId), signal, 'tabs.get')).url);
    signal.throwIfAborted();
    if (action === 'navigate') {
      this.attached.get(tabId).refs.clear();
      const result = await cdp('Page.navigate', { url: pageUrl(args.url) });
      if (result.errorText) throw new Error(`NAVIGATION_FAILED: ${result.errorText}`);
      return { tabId, navigationStarted: true, note: 'Loading may still be in progress. Take a fresh snapshot to inspect the result.' };
    }
    if (action === 'snapshot') {
      const state = this.attached.get(tabId);
      state.refs.clear();
      const revision = state.revision;
      const { nodes } = await cdp('Accessibility.getFullAXTree');
      if (state.revision !== revision) throw new Error('PAGE_CHANGED: take a fresh snapshot');
      const prefix = crypto.randomUUID().slice(0, 8);
      const visible = nodes.filter(node => !node.ignored && !['none', 'generic', 'InlineTextBox'].includes(node.role?.value));
      const entries = visible.slice(0, 500).map((node, index) => {
        const entry = { role: clip(node.role?.value, 80), name: clip(node.name?.value, 1000) };
        if (node.backendDOMNodeId) {
          entry.ref = `${prefix}-${index}`;
          state.refs.set(entry.ref, node.backendDOMNodeId);
        }
        // Input values are intentionally omitted; names and roles suffice for targeting.
        const properties = (node.properties ?? []).filter(p => ['checked', 'disabled', 'expanded', 'selected', 'required'].includes(p.name));
        for (const p of properties) entry[p.name] = p.value.value;
        return entry;
      });
      const tab = await bounded(this.api.tabs.get(tabId), signal, 'tabs.get');
      return { tabId, url: clip(tab.url, 4096), title: clip(tab.title, 300), elements: entries, truncated: visible.length > 500 };
    }
    if (action === 'click' || action === 'fill') {
      // Hidden tabs can acknowledge mouse events without delivering them to the page.
      await cdp('Page.bringToFront');
      const objectId = await this.element(tabId, args.ref, signal);
      try {
        const location = await cdp('Runtime.callFunctionOn', {
          objectId, returnByValue: true,
          functionDeclaration: `function() {
            if (window !== window.top) throw new Error('FRAME_UNSUPPORTED: only top-level page elements are supported in this version');
            if (!this.isConnected) throw new Error('STALE_ELEMENT');
            if (this.disabled || this.getAttribute('aria-disabled') === 'true') throw new Error('ELEMENT_DISABLED');
            this.scrollIntoView({block:'center', inline:'center', behavior:'instant'});
            const r = this.getBoundingClientRect();
            const s = getComputedStyle(this);
            if (!r.width || !r.height || s.visibility !== 'visible' || s.display === 'none' || Number(s.opacity) === 0) throw new Error('ELEMENT_NOT_VISIBLE');
            const x = r.x + r.width / 2, y = r.y + r.height / 2;
            const hit = document.elementFromPoint(x, y);
            if (!hit || !(hit === this || this.contains(hit))) throw new Error('ELEMENT_OBSCURED_OR_IN_FRAME');
            const marker = document.createElement('div');
            marker.setAttribute('aria-hidden', 'true');
            marker.textContent = '➤';
            Object.assign(marker.style, {position:'fixed',left:x+'px',top:y+'px',color:'#185adb',font:'24px sans-serif',zIndex:'2147483647',pointerEvents:'none',transform:'rotate(-30deg)',textShadow:'0 0 3px white'});
            document.documentElement.append(marker);
            setTimeout(() => marker.remove(), 650);
            return {x,y,tag:this.tagName,type:this.type,readOnly:Boolean(this.readOnly)};
          }`,
        });
        if (location.exceptionDetails) throw new Error(clip(location.exceptionDetails.exception?.description ?? 'ELEMENT_ERROR'));
        const position = location.result.value;
        if (action === 'fill' && (!['INPUT', 'TEXTAREA'].includes(position.tag) || position.readOnly || ['file', 'checkbox', 'radio', 'submit', 'button', 'hidden'].includes(position.type))) throw new Error('NOT_TEXT_INPUT');
        await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: position.x, y: position.y });
        await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: position.x, y: position.y, button: 'left', clickCount: 1 });
        await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: position.x, y: position.y, button: 'left', clickCount: 1 });
        if (action === 'fill') {
          const selected = await cdp('Runtime.callFunctionOn', { objectId, returnByValue: true, functionDeclaration: 'function() { if (!this.isConnected) throw new Error("STALE_ELEMENT"); this.focus(); this.select(); return true; }' });
          if (selected.exceptionDetails) throw new Error('INPUT_SELECTION_FAILED');
          if (args.text) await cdp('Input.insertText', { text: args.text });
          else {
            await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
            await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
          }
        }
        return { tabId, action, completed: true };
      } finally {
        // Release remotely allocated handles even after a failed action. Detach also releases them on disconnect.
        await this.command(tabId, 'Runtime.releaseObject', { objectId }, AbortSignal.timeout(1000)).catch(() => {});
      }
    }
    if (action === 'key') {
      await cdp('Page.bringToFront');
      const codes = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };
      await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: args.key, code: args.key, windowsVirtualKeyCode: codes[args.key], ...(args.key === 'Enter' ? { text: '\r' } : {}) });
      await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: args.key, code: args.key, windowsVirtualKeyCode: codes[args.key] });
      return { completed: true };
    }
    if (action === 'scroll') {
      await cdp('Page.bringToFront');
      await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 100, y: 100, deltaX: 0, deltaY: args.deltaY });
      return { completed: true };
    }
    if (action === 'screenshot') return cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    if (action === 'evaluate') {
      const result = await cdp('Runtime.evaluate', { expression: args.expression, returnByValue: true, awaitPromise: false, timeout: 5000 });
      if (result.exceptionDetails) throw new Error(`JAVASCRIPT_ERROR: ${clip(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text, 4000)}`);
      const serialized = JSON.stringify(result.result.value ?? result.result.description ?? null);
      return serialized.length > 100000 ? { truncated: true, preview: serialized.slice(0, 100000) } : { value: JSON.parse(serialized), type: result.result.type };
    }
    if (action === 'logs') return { entries: [...this.attached.get(tabId).logs], limit: 100, note: 'Captured since claim. URLs omit query strings; console messages can still contain sensitive data.' };
    throw new Error('UNKNOWN_ACTION');
  }
}
