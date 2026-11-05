// Interaction patterns (drag, hover, select, upload, wait, dialogs) are adapted
// from dsh-chrome-bridge (MIT, Copyright (c) 2026 OrderG-X). See THIRD_PARTY_NOTICES.md.
import { validateArgs } from './protocol.js';
import { MARKDOWN_FN, TEXT_EXPRESSION } from './page-content.js';

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

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(new Error('COMMAND_CANCELED'));
  const abort = () => { clearTimeout(timer); reject(new Error('COMMAND_CANCELED')); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
  signal?.addEventListener('abort', abort, { once: true });
});

const MODIFIERS = { alt: 1, ctrl: 2, control: 2, meta: 4, cmd: 4, command: 4, shift: 8 };
const NAMED_KEYS = {
  enter: ['Enter', 'Enter', 13, '\r'], tab: ['Tab', 'Tab', 9], escape: ['Escape', 'Escape', 27], esc: ['Escape', 'Escape', 27],
  backspace: ['Backspace', 'Backspace', 8], delete: ['Delete', 'Delete', 46], space: [' ', 'Space', 32, ' '],
  arrowup: ['ArrowUp', 'ArrowUp', 38], arrowdown: ['ArrowDown', 'ArrowDown', 40],
  arrowleft: ['ArrowLeft', 'ArrowLeft', 37], arrowright: ['ArrowRight', 'ArrowRight', 39],
  home: ['Home', 'Home', 36], end: ['End', 'End', 35], pageup: ['PageUp', 'PageUp', 33], pagedown: ['PageDown', 'PageDown', 34],
};

const POINT_FN = `function() {
  if (window !== window.top) throw new Error('FRAME_UNSUPPORTED: only top-level page elements are supported');
  if (!this.isConnected) throw new Error('STALE_ELEMENT');
  this.scrollIntoView({block:'center', inline:'center', behavior:'instant'});
  const r = this.getBoundingClientRect();
  const s = getComputedStyle(this);
  if (!r.width || !r.height || s.visibility !== 'visible' || s.display === 'none' || Number(s.opacity) === 0) throw new Error('ELEMENT_NOT_VISIBLE');
  return {x:r.x + r.width / 2, y:r.y + r.height / 2, tag:this.tagName};
}`;
const VISIBLE_FN = `function() {
  if (!this.isConnected) return false;
  const r = this.getBoundingClientRect();
  const s = getComputedStyle(this);
  return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) !== 0;
}`;

export function keyDescriptor(spec) {
  const parts = String(spec).split('+').map(part => part.trim()).filter(Boolean);
  const name = parts.pop();
  if (!name) throw new Error('INVALID_KEY: give a key such as Enter or meta+a');
  let modifiers = 0;
  for (const part of parts) {
    const modifier = MODIFIERS[part.toLowerCase()];
    if (!modifier) throw new Error(`INVALID_KEY: unknown modifier ${part} (use alt, ctrl, meta or shift)`);
    modifiers |= modifier;
  }
  const lower = name.toLowerCase();
  let key, code, keyCode, text;
  if (NAMED_KEYS[lower]) [key, code, keyCode, text] = NAMED_KEYS[lower];
  else if ([...name].length === 1) {
    key = name;
    text = name;
    keyCode = name.toUpperCase().charCodeAt(0);
    code = /[a-z]/i.test(name) ? `Key${name.toUpperCase()}` : /[0-9]/.test(name) ? `Digit${name}` : '';
  } else throw new Error(`INVALID_KEY: unknown key ${name}`);
  return { key, code, keyCode, text: modifiers ? undefined : text, modifiers };
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
    // Native Chrome promises outlive our timeouts. Do not attach a new session
    // while a previous native cleanup can still detach it.
    this.pendingCleanup = new Map();
    api.debugger.onDetach.addListener(({ tabId }) => {
      if (this.attached.delete(tabId)) detached(tabId);
    });
    api.tabs.onRemoved.addListener(tabId => {
      if (this.attached.delete(tabId)) detached(tabId);
    });
    api.debugger.onEvent.addListener((target, method, params) => this.event(target, method, params));
  }

  trackCleanup(tabId, promise) {
    this.pendingCleanup.set(tabId, promise);
    promise.then(() => {
      if (this.pendingCleanup.get(tabId) === promise) this.pendingCleanup.delete(tabId);
    }, () => {}); // A failed cleanup stays quarantined until the worker is reloaded.
    return promise;
  }

  async reset() {
    // Keep unresolved native cleanup quarantined, but never hang reconnection.
    const tabs = new Set([...this.attached.keys(), ...this.pendingCleanup.keys()]);
    await Promise.all([...tabs].map(tabId => this.detachTab(tabId).catch(() => {})));
  }

  async detachTab(tabId) {
    const attached = this.attached.delete(tabId);
    const cleanup = attached
      ? this.trackCleanup(tabId, this.api.debugger.detach({ tabId }))
      : this.pendingCleanup.get(tabId);
    if (!cleanup) return;
    // Explicit detach need not emit onDetach. Removing state first suppresses
    // duplicate events; notify only after native cleanup, before the result.
    await bounded(cleanup, undefined, 'detach', 1000);
    if (attached) this.detached(tabId);
  }

  event({ tabId }, method, params) {
    const state = this.attached.get(tabId);
    if (!state) return;
    if (method.startsWith('Network.')) state.lastNetworkActivity = Date.now();
    if (method === 'Network.requestWillBeSent') {
      state.networkRequests.set(params.requestId, params.request?.url ?? '');
      state.networkInFlight = state.networkRequests.size;
      // A redirect reuses the requestId, so update the existing entry instead of listing it twice.
      const record = { requestId: params.requestId, method: clip(params.request?.method, 16), url: safeUrl(params.request?.url ?? ''), status: null, type: params.type ?? '', mimeType: '', failed: false, errorText: '', at: Date.now() };
      const existing = state.requests.find(item => item.requestId === params.requestId);
      if (existing) Object.assign(existing, record);
      else {
        state.requests.push(record);
        if (state.requests.length > 200) state.requests.shift();
      }
    }
    if (method === 'Network.responseReceived') {
      const request = state.requests.find(item => item.requestId === params.requestId);
      if (request) { request.status = params.response?.status ?? null; request.type = params.type ?? request.type; request.mimeType = clip(params.response?.mimeType, 200); }
    }
    if (method === 'Network.loadingFailed') {
      const request = state.requests.find(item => item.requestId === params.requestId);
      if (request) { request.failed = true; request.errorText = clip(params.errorText, 300); }
    }
    if (method === 'Network.loadingFinished' || method === 'Network.loadingFailed') { state.networkRequests.delete(params.requestId); state.networkInFlight = state.networkRequests.size; }
    if (method === 'Page.loadEventFired' && state.loadResolve) { const resolve = state.loadResolve; state.loadResolve = null; resolve(true); }
    if (method === 'Page.javascriptDialogOpening') state.dialog = { type: params.type, message: clip(params.message, 2000), defaultPrompt: clip(params.defaultPrompt, 1000) };
    if (method === 'Page.javascriptDialogClosed') state.dialog = null;
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
      state.logs.push({ seq: ++state.logSeq, time: new Date().toISOString(), ...entry });
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
    const cleanup = this.pendingCleanup.get(tabId);
    if (cleanup) await bounded(cleanup, signal, 'previous tab cleanup');
    const tab = await bounded(this.api.tabs.get(tabId), signal, 'tabs.get');
    const currentUrl = tab.url || tab.pendingUrl || 'about:blank';
    if (!(newBlankTab && currentUrl === 'about:blank')) pageUrl(currentUrl);
    signal.throwIfAborted();
    if (this.attached.has(tabId)) return;
    // Chrome promises cannot be canceled. Quarantine the entire late-attach
    // cleanup so it cannot detach a later claim on the same tab.
    const attachment = this.api.debugger.attach({ tabId }, '1.3');
    try { await bounded(attachment, signal, 'attach'); }
    catch (error) {
      this.trackCleanup(tabId, attachment.then(() => this.api.debugger.detach({ tabId }), () => {}));
      throw error;
    }
    this.attached.set(tabId, { refs: new Map(), revision: 0, logs: [], logSeq: 0, requests: [], dialog: null, loadResolve: null, lastNetworkActivity: Date.now(), networkInFlight: 0, networkRequests: new Map() });
    try {
      for (const domain of ['Page', 'DOM', 'Accessibility', 'Runtime', 'Network']) await this.command(tabId, `${domain}.enable`, {}, signal);
    } catch (error) {
      await this.detachTab(tabId);
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

  async drag(tabId, args, cdp, signal) {
    await cdp('Page.bringToFront');
    const marker = crypto.randomUUID().slice(0, 12);
    const srcSelector = `[data-dsh-drag-src="${marker}"]`;
    const dstSelector = `[data-dsh-drag-dst="${marker}"]`;
    const hasDst = Boolean(args.toRef || args.toText);
    if (!hasDst && (args.toX === undefined || args.toY === undefined)) throw new Error('DRAG_TARGET: give toRef, toText or toX and toY');
    const textFinder = args.toText === undefined ? 'null' : `((text) => {
      let best = null, area = Infinity;
      const root = document.body;
      if (!root) return null;
      for (const el of root.querySelectorAll('*')) {
        if (!(el.innerText || '').includes(text)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1 || r.width * r.height >= area) continue;
        best = el;
        area = r.width * r.height;
      }
      return best;
    })(${JSON.stringify(args.toText)})`;
    const dstExpr = args.toRef ? `document.querySelector(${JSON.stringify(dstSelector)})` : textFinder;
    const objectIds = [];
    try {
      const fromObject = await this.element(tabId, args.fromRef, signal);
      objectIds.push(fromObject);
      await cdp('Runtime.callFunctionOn', {
        objectId: fromObject, returnByValue: true, arguments: [{ value: marker }],
        functionDeclaration: `function(marker) {
          if (window !== window.top) throw new Error('FRAME_UNSUPPORTED: only top-level page elements are supported');
          if (!this.isConnected) throw new Error('STALE_ELEMENT');
          this.scrollIntoView({block:'center', inline:'center', behavior:'instant'});
          this.setAttribute('data-dsh-drag-src', marker);
          return true;
        }`,
      });
      if (args.toRef) {
        const toObject = await this.element(tabId, args.toRef, signal);
        objectIds.push(toObject);
        await cdp('Runtime.callFunctionOn', {
          objectId: toObject, returnByValue: true, arguments: [{ value: marker }],
          functionDeclaration: `function(marker) {
            if (!this.isConnected) throw new Error('STALE_ELEMENT');
            this.setAttribute('data-dsh-drag-dst', marker);
            return true;
          }`,
        });
      }
      const planExpression = `(() => {
        const src = document.querySelector(${JSON.stringify(srcSelector)});
        if (!src) return { error: 'DRAG_SOURCE_GONE: take a fresh snapshot' };
        const dst = ${dstExpr};
        if (${hasDst} && !dst) return { error: 'DRAG_TARGET_NOT_FOUND: scroll the target into view and retry' };
        const center = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
        src.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        const a = center(src);
        const b = dst ? center(dst) : { x: ${args.toX ?? 0}, y: ${args.toY ?? 0} };
        const inView = (p) => p.x >= 0 && p.y >= 0 && p.x <= innerWidth && p.y <= innerHeight;
        return { a, b, native: Boolean(src.closest && src.closest('[draggable="true"]')), aIn: inView(a), bIn: inView(b) };
      })()`;
      const planned = await cdp('Runtime.evaluate', { expression: planExpression, returnByValue: true });
      if (planned.exceptionDetails) throw new Error(clip(planned.exceptionDetails.exception?.description ?? 'DRAG_PLAN_FAILED'));
      const plan = planned.result.value;
      if (!plan || plan.error) throw new Error(plan?.error ?? 'DRAG_PLAN_FAILED');
      if (!plan.aIn || !plan.bIn) throw new Error('DRAG_OUT_OF_VIEW: scroll so both endpoints are visible, then take a fresh snapshot');
      if (plan.native) {
        const nativeExpression = `(() => {
          const node = document.querySelector(${JSON.stringify(srcSelector)});
          const src = (node && node.closest('[draggable="true"]')) || node;
          const dst = ${dstExpr};
          if (!src) return { error: 'DRAG_SOURCE_GONE' };
          const target = dst || document.elementFromPoint(${plan.b.x}, ${plan.b.y});
          if (!target) return { error: 'DRAG_TARGET_NOT_FOUND' };
          const transfer = new DataTransfer();
          const fire = (el, type, point) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: point.x, clientY: point.y, dataTransfer: transfer }));
          fire(src, 'dragstart', ${JSON.stringify(plan.a)});
          fire(target, 'dragenter', ${JSON.stringify(plan.b)});
          const accepted = !fire(target, 'dragover', ${JSON.stringify(plan.b)});
          fire(target, 'drop', ${JSON.stringify(plan.b)});
          fire(src, 'dragend', ${JSON.stringify(plan.b)});
          return { accepted };
        })()`;
        const result = await cdp('Runtime.evaluate', { expression: nativeExpression, returnByValue: true });
        if (result.exceptionDetails) throw new Error(clip(result.exceptionDetails.exception?.description ?? 'DRAG_FAILED'));
        if (result.result.value?.error) throw new Error(result.result.value.error);
        return { tabId, native: true, accepted: Boolean(result.result.value?.accepted), from: plan.a, to: plan.b };
      }
      await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: plan.a.x, y: plan.a.y, buttons: 0 });
      await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: plan.a.x, y: plan.a.y, button: 'left', buttons: 1, clickCount: 1 });
      const steps = args.steps ?? 12;
      for (let step = 1; step <= steps; step++) {
        signal.throwIfAborted();
        await cdp('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: plan.a.x + ((plan.b.x - plan.a.x) * step) / steps,
          y: plan.a.y + ((plan.b.y - plan.a.y) * step) / steps,
          button: 'left', buttons: 1,
        });
        await sleep(16, signal);
      }
      await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: plan.b.x, y: plan.b.y, button: 'left', buttons: 0, clickCount: 1 });
      return { tabId, native: false, from: plan.a, to: plan.b };
    } finally {
      for (const objectId of objectIds) await this.command(tabId, 'Runtime.releaseObject', { objectId }, AbortSignal.timeout(1000)).catch(() => {});
      await this.command(tabId, 'Runtime.evaluate', {
        expression: `document.querySelectorAll('[data-dsh-drag-src="${marker}"],[data-dsh-drag-dst="${marker}"]').forEach(el => { el.removeAttribute('data-dsh-drag-src'); el.removeAttribute('data-dsh-drag-dst'); })`,
        returnByValue: true,
      }, AbortSignal.timeout(1000)).catch(() => {});
    }
  }

  async waitForLoad(state, signal, milliseconds = 5000) {
    let resolveLoad;
    const loaded = new Promise(resolve => { resolveLoad = resolve; state.loadResolve = resolve; });
    let timer;
    const timedOut = new Promise(resolve => { timer = setTimeout(() => resolve(false), milliseconds); });
    try { return await Promise.race([loaded, timedOut]); }
    finally { clearTimeout(timer); if (state.loadResolve === resolveLoad) state.loadResolve = null; }
  }

  async execute(action, raw, signal = new AbortController().signal) {
    const args = validateArgs(`chrome_${action}`, raw);
    signal.throwIfAborted();
    const tabId = args.tabId;
    const cdp = (method, params = {}) => this.command(tabId, method, params, signal);
    const bindRef = (state, node, prefix, index) => {
      if (!node.backendDOMNodeId) return undefined;
      const ref = `${prefix}-${index}`;
      state.refs.set(ref, node.backendDOMNodeId);
      return ref;
    };
    const axEntry = (node, ref) => {
      const entry = { role: clip(node.role?.value, 80), name: clip(node.name?.value, 1000) };
      if (ref) entry.ref = ref;
      // Input values are intentionally omitted; names and roles suffice for targeting.
      const properties = (node.properties ?? []).filter(p => ['checked', 'disabled', 'expanded', 'selected', 'required'].includes(p.name));
      for (const p of properties) entry[p.name] = p.value.value;
      return entry;
    };
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
        await this.detachTab(tab.id);
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
    if (action === 'downloads') {
      if (typeof this.api.downloads?.search !== 'function') throw new Error('DOWNLOADS_UNSUPPORTED: this Chrome exposes no downloads API; update the extension and grant the downloads permission');
      const limit = args.limit ?? 10;
      const search = async () => {
        const items = await bounded(this.api.downloads.search({ orderBy: ['-startTime'], limit: 100 }), signal, 'downloads.search');
        return Array.isArray(items) ? items : [];
      };
      const map = item => ({
        id: item.id,
        filename: clip(item.filename, 4096),
        url: safeUrl(item.url) || clip(item.url, 2000),
        state: item.state,
        bytesReceived: item.bytesReceived,
        totalBytes: item.totalBytes,
        ...(item.error ? { error: clip(item.error, 300) } : {}),
        ...(typeof item.exists === 'boolean' ? { exists: item.exists } : {}),
        startTime: Number.isFinite(item.startTime) ? new Date(item.startTime).toISOString() : null,
      });
      const note = 'Filenames are local paths; URLs omit query strings. Download history can reveal private activity.';
      if (!args.wait) return { downloads: (await search()).slice(0, limit).map(map), note };
      const started = Date.now();
      const deadline = started + (args.timeoutMs ?? 5000);
      while (true) {
        const items = await search();
        // Tolerate a small clock gap between the click and the first poll.
        const recent = items.filter(item => (item.startTime ?? 0) >= started - 500);
        if (recent.length && recent.every(item => item.state !== 'in_progress')) return { downloads: items.slice(0, limit).map(map), waitedMs: Date.now() - started, timedOut: false, note };
        if (Date.now() >= deadline) return { downloads: items.slice(0, limit).map(map), waitedMs: Date.now() - started, timedOut: true, note: `${note} No download started after this call, or it is still running.` };
        await sleep(Math.min(250, deadline - Date.now()), signal);
      }
    }
    if (!this.attached.has(tabId)) throw new Error('TAB_NOT_ATTACHED: claim the tab again');
    if (action === 'release') {
      await this.detachTab(tabId);
      return { tabId, released: true };
    }
    const tabInfo = await bounded(this.api.tabs.get(tabId), signal, 'tabs.get');
    pageUrl(tabInfo.url);
    signal.throwIfAborted();
    if (action === 'activate') {
      await bounded(this.api.tabs.update(tabId, { active: true }), signal, 'tabs.update');
      let windowFocused = false;
      if (tabInfo.windowId !== undefined && typeof this.api.windows?.update === 'function') {
        try { await bounded(this.api.windows.update(tabInfo.windowId, { focused: true }), signal, 'windows.update'); windowFocused = true; }
        catch { /* The tab is already active; a denied window focus must not fail the call. */ }
      }
      return { tabId, active: true, windowId: tabInfo.windowId ?? null, windowFocused };
    }
    if (action === 'navigate') {
      this.attached.get(tabId).refs.clear();
      const result = await cdp('Page.navigate', { url: pageUrl(args.url) });
      if (result.errorText) throw new Error(`NAVIGATION_FAILED: ${result.errorText}`);
      return { tabId, navigationStarted: true, note: 'Loading may still be in progress. Take a fresh snapshot to inspect the result.' };
    }
    if (action === 'history') {
      const state = this.attached.get(tabId);
      state.refs.clear();
      const { currentIndex, entries } = await cdp('Page.getNavigationHistory');
      if (args.action === 'reload') {
        const loaded = this.waitForLoad(state, signal);
        await cdp('Page.reload', { ignoreCache: false });
        return { tabId, action: 'reload', loaded: await loaded, note: 'Take a fresh snapshot; references from before the reload are stale.' };
      }
      const targetIndex = args.action === 'back' ? currentIndex - 1 : currentIndex + 1;
      const target = entries?.[targetIndex];
      if (!target) throw new Error(args.action === 'back' ? 'NO_BACK_HISTORY: this tab has no earlier page' : 'NO_FORWARD_HISTORY: this tab has no later page');
      const loaded = this.waitForLoad(state, signal);
      await cdp('Page.navigateToHistoryEntry', { entryId: target.id });
      const tab = await bounded(this.api.tabs.get(tabId), signal, 'tabs.get');
      return { tabId, action: args.action, url: clip(tab.url, 4096), title: clip(tab.title, 300), loaded: await loaded, note: 'Take a fresh snapshot; references from before the navigation are stale.' };
    }
    if (action === 'snapshot') {
      const state = this.attached.get(tabId);
      const tab = await bounded(this.api.tabs.get(tabId), signal, 'tabs.get');
      const page = { tabId, url: clip(tab.url, 4096), title: clip(tab.title, 300) };
      if (args.format === 'text' || args.format === 'markdown') {
        const revision = state.revision;
        const result = await cdp('Runtime.evaluate', { expression: args.format === 'text' ? TEXT_EXPRESSION : `(${MARKDOWN_FN})()`, returnByValue: true });
        if (state.revision !== revision) throw new Error('PAGE_CHANGED: take a fresh snapshot');
        if (result.exceptionDetails) throw new Error(`SNAPSHOT_${args.format.toUpperCase()}_FAILED: ${clip(result.exceptionDetails.exception?.description ?? 'page error', 2000)}`);
        const content = String(result.result?.value ?? '');
        return { ...page, dialog: state.dialog ?? null, format: args.format, content: content.slice(0, 100000), truncated: content.length > 100000 };
      }
      state.refs.clear();
      if (state.dialog) return { ...page, dialog: state.dialog, elements: [], truncated: false };
      const revision = state.revision;
      const { nodes } = await cdp('Accessibility.getFullAXTree');
      if (state.revision !== revision) throw new Error('PAGE_CHANGED: take a fresh snapshot');
      const prefix = crypto.randomUUID().slice(0, 8);
      const visible = nodes.filter(node => !node.ignored && !['none', 'generic', 'InlineTextBox', 'StaticText'].includes(node.role?.value));
      const entries = visible.slice(0, 500).map((node, index) => axEntry(node, bindRef(state, node, prefix, index)));
      return { ...page, dialog: state.dialog ?? null, elements: entries, truncated: visible.length > 500 };
    }
    if (action === 'find') {
      if (!args.name && !args.role) throw new Error('FIND_QUERY: give name or role');
      const state = this.attached.get(tabId);
      const revision = state.revision;
      const { nodes } = await cdp('Accessibility.getFullAXTree');
      if (state.revision !== revision) throw new Error('PAGE_CHANGED: take a fresh snapshot');
      const name = args.name?.toLowerCase();
      const role = args.role?.toLowerCase();
      const matched = nodes.filter(node => !node.ignored && node.backendDOMNodeId && !['none', 'generic', 'InlineTextBox', 'StaticText'].includes(node.role?.value))
        .filter(node => (!role || String(node.role?.value ?? '').toLowerCase() === role) && (!name || String(node.name?.value ?? '').toLowerCase().includes(name)));
      const max = args.maxResults ?? 20;
      // Find adds refs without clearing the map, so a long session must not grow it forever.
      if (state.refs.size > 5000) state.refs.clear();
      const prefix = crypto.randomUUID().slice(0, 8);
      const elements = matched.slice(0, max).map((node, index) => axEntry(node, bindRef(state, node, prefix, index)));
      const tab = await bounded(this.api.tabs.get(tabId), signal, 'tabs.get');
      return { tabId, url: clip(tab.url, 4096), title: clip(tab.title, 300), matched: matched.length, elements, truncated: matched.length > max };
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
            const host = this.getRootNode && this.getRootNode().host;
            const reachable = hit && (hit === this || this.contains(hit) || (host && (hit === host || host.contains(hit))));
            if (!reachable) throw new Error('ELEMENT_OBSCURED_OR_IN_FRAME');
            const marker = document.createElement('div');
            marker.setAttribute('aria-hidden', 'true');
            marker.textContent = '➤';
            Object.assign(marker.style, {position:'fixed',left:x+'px',top:y+'px',color:'#185adb',font:'24px sans-serif',zIndex:'2147483647',pointerEvents:'none',transform:'rotate(-30deg)',textShadow:'0 0 3px white'});
            document.documentElement.append(marker);
            setTimeout(() => marker.remove(), 650);
            return {x,y,tag:this.tagName,type:this.type,readOnly:Boolean(this.readOnly),editable:Boolean(this.isContentEditable)};
          }`,
        });
        if (location.exceptionDetails) throw new Error(clip(location.exceptionDetails.exception?.description ?? 'ELEMENT_ERROR'));
        const position = location.result.value;
        if (action === 'fill') {
          const textField = ['INPUT', 'TEXTAREA'].includes(position.tag) && !position.readOnly && !['file', 'checkbox', 'radio', 'submit', 'button', 'hidden'].includes(position.type);
          if (!textField && !position.editable) throw new Error('NOT_TEXT_INPUT');
        }
        const button = action === 'fill' ? 'left' : (args.button ?? 'left');
        const count = action === 'fill' ? 1 : (args.count ?? 1);
        const buttons = button === 'left' ? 1 : button === 'right' ? 2 : 4;
        const state = this.attached.get(tabId);
        const dispatched = Promise.all([
          cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: position.x, y: position.y, buttons: 0 }),
          cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: position.x, y: position.y, button, buttons, clickCount: count }),
          cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: position.x, y: position.y, button, buttons: 0, clickCount: count }),
        ]);
        // A click that opens alert/confirm/prompt blocks the renderer, so the
        // mouse command may never acknowledge. The dialog event still arrives;
        // return control to the caller so chrome_dialog can dismiss it.
        dispatched.catch(() => {});
        const opened = (async () => {
          const end = Date.now() + 2500;
          while (Date.now() < end) {
            if (state.dialog) return true;
            await sleep(25);
          }
          return false;
        })();
        if (await Promise.race([dispatched.then(() => false), opened])) return { tabId, action, button, count, completed: true, dialog: state.dialog ?? null };
        await dispatched;
        if (action === 'fill') {
          const selected = await cdp('Runtime.callFunctionOn', {
            objectId, returnByValue: true,
            functionDeclaration: `function() {
              if (!this.isConnected) throw new Error('STALE_ELEMENT');
              this.focus();
              if (this.isContentEditable) {
                const range = document.createRange();
                range.selectNodeContents(this);
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
              } else if (typeof this.select === 'function') this.select();
              else throw new Error('NOT_TEXT_INPUT');
              return true;
            }`,
          });
          if (selected.exceptionDetails) throw new Error(`INPUT_SELECTION_FAILED: ${clip(selected.exceptionDetails.exception?.description ?? 'page error', 1000)}`);
          if (args.text) await cdp('Input.insertText', { text: args.text });
          else {
            await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
            await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
          }
        }
        return { tabId, action, button, count, completed: true };
      } finally {
        // Release remotely allocated handles even after a failed action. Detach also releases them on disconnect.
        await this.command(tabId, 'Runtime.releaseObject', { objectId }, AbortSignal.timeout(1000)).catch(() => {});
      }
    }
    if (action === 'key') {
      await cdp('Page.bringToFront');
      const { key, code, keyCode, text, modifiers } = keyDescriptor(args.key);
      const base = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers };
      await cdp('Input.dispatchKeyEvent', { ...base, type: text === undefined ? 'rawKeyDown' : 'keyDown', ...(text === undefined ? {} : { text, unmodifiedText: text }) });
      await cdp('Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
      return { pressed: args.key, modifiers };
    }
    if (action === 'hover') {
      await cdp('Page.bringToFront');
      let point;
      if (args.ref) {
        const objectId = await this.element(tabId, args.ref, signal);
        try {
          const located = await cdp('Runtime.callFunctionOn', { objectId, returnByValue: true, functionDeclaration: POINT_FN });
          if (located.exceptionDetails) throw new Error(clip(located.exceptionDetails.exception?.description ?? 'ELEMENT_ERROR'));
          point = located.result.value;
        } finally {
          await this.command(tabId, 'Runtime.releaseObject', { objectId }, AbortSignal.timeout(1000)).catch(() => {});
        }
      } else {
        if (args.x === undefined || args.y === undefined) throw new Error('HOVER_TARGET: give ref or x and y');
        point = { x: args.x, y: args.y };
      }
      await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, buttons: 0 });
      return { tabId, x: point.x, y: point.y, hovered: true };
    }
    if (action === 'select') {
      await cdp('Page.bringToFront');
      const objectId = await this.element(tabId, args.ref, signal);
      try {
        const selected = await cdp('Runtime.callFunctionOn', {
          objectId, returnByValue: true,
          arguments: [{ value: args.value }],
          functionDeclaration: `function(value) {
            if (this.tagName !== 'SELECT') throw new Error('NOT_SELECT: use chrome_click for custom dropdowns');
            const options = [...this.options];
            const hit = options.find(option => option.value === value) || options.find(option => (option.textContent || '').trim() === value);
            if (!hit) throw new Error('OPTION_NOT_FOUND: ' + options.slice(0, 10).map(option => option.value).join(', '));
            const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
            setter.call(this, hit.value);
            this.dispatchEvent(new Event('input', { bubbles: true }));
            this.dispatchEvent(new Event('change', { bubbles: true }));
            return { value: hit.value, label: (hit.textContent || '').trim() };
          }`,
        });
        if (selected.exceptionDetails) throw new Error(clip(selected.exceptionDetails.exception?.description ?? 'SELECT_FAILED'));
        return { tabId, ...selected.result.value };
      } finally {
        await this.command(tabId, 'Runtime.releaseObject', { objectId }, AbortSignal.timeout(1000)).catch(() => {});
      }
    }
    if (action === 'upload') {
      const files = args.paths ?? (args.path ? [args.path] : []);
      if (!files.length) throw new Error('UPLOAD_TARGET: give path or paths');
      if (args.path && args.paths) throw new Error('UPLOAD_TARGET: give path or paths, not both');
      const backendNodeId = this.attached.get(tabId)?.refs.get(args.ref);
      if (!backendNodeId) throw new Error('STALE_ELEMENT: take a fresh snapshot');
      const objectId = await this.element(tabId, args.ref, signal);
      try {
        const checked = await cdp('Runtime.callFunctionOn', {
          objectId, returnByValue: true,
          functionDeclaration: 'function() { if (this.tagName !== "INPUT" || this.type !== "file") throw new Error("NOT_FILE_INPUT"); return true; }',
        });
        if (checked.exceptionDetails) throw new Error(clip(checked.exceptionDetails.exception?.description ?? 'NOT_FILE_INPUT'));
      } finally {
        await this.command(tabId, 'Runtime.releaseObject', { objectId }, AbortSignal.timeout(1000)).catch(() => {});
      }
      await cdp('Page.bringToFront');
      await cdp('DOM.setFileInputFiles', { files, backendNodeId });
      return { tabId, files: files.map(file => file.split(/[\\/]/).pop()) };
    }
    if (action === 'dialog') {
      const state = this.attached.get(tabId);
      if (!state.dialog) throw new Error('NO_DIALOG: no alert, confirm or prompt is open');
      const dialog = state.dialog;
      await cdp('Page.handleJavaScriptDialog', { accept: args.accept, ...(args.promptText === undefined ? {} : { promptText: args.promptText }) });
      state.dialog = null;
      return { tabId, type: dialog.type, accepted: args.accept };
    }
    if (action === 'wait') {
      const conditions = [args.ref, args.selector, args.text, args.urlContains, args.predicate, args.networkIdle ? 'network' : undefined].filter(value => value !== undefined);
      if (conditions.length !== 1) throw new Error('WAIT_CONDITION: give exactly one of ref, selector, text, urlContains, predicate or networkIdle');
      const timeout = args.timeoutMs ?? 5000;
      const started = Date.now();
      const deadline = started + timeout;
      const gone = Boolean(args.gone);
      let objectId;
      try {
        if (args.ref) {
          try { objectId = await this.element(tabId, args.ref, signal); }
          catch (error) {
            if (gone && /STALE_ELEMENT/.test(error.message)) return { tabId, waitedMs: 0, gone: true };
            throw error;
          }
        }
        while (true) {
          signal.throwIfAborted();
          let matched;
          if (args.urlContains) {
            const tab = await bounded(this.api.tabs.get(tabId), signal, 'tabs.get');
            matched = String(tab.url ?? '').includes(args.urlContains);
          } else if (args.selector) {
            const result = await cdp('Runtime.evaluate', {
              returnByValue: true,
              expression: `(() => { const el = document.querySelector(${JSON.stringify(args.selector)}); if (!el) return false; const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) !== 0; })()`,
            });
            matched = Boolean(result.result?.value);
          } else if (args.text) {
            const result = await cdp('Runtime.evaluate', {
              returnByValue: true,
              expression: `(() => { const body = document.body; return Boolean(body && body.innerText && body.innerText.includes(${JSON.stringify(args.text)})); })()`,
            });
            matched = Boolean(result.result?.value);
          } else if (args.networkIdle) {
            const state = this.attached.get(tabId);
            matched = (state?.networkInFlight ?? 0) === 0 && Date.now() - (state?.lastNetworkActivity ?? 0) >= 500;
          } else if (args.predicate) {
            const result = await cdp('Runtime.evaluate', { expression: `Boolean(${args.predicate})`, returnByValue: true, timeout: 2000 });
            if (result.exceptionDetails) throw new Error(`WAIT_PREDICATE_ERROR: ${clip(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text, 2000)}`);
            matched = Boolean(result.result?.value);
          } else {
            const result = await cdp('Runtime.callFunctionOn', { objectId, returnByValue: true, functionDeclaration: VISIBLE_FN });
            if (result.exceptionDetails) {
              if (!gone) throw new Error(clip(result.exceptionDetails.exception?.description ?? 'WAIT_FAILED'));
              matched = false;
            } else matched = Boolean(result.result.value);
          }
          if (matched !== gone) return { tabId, waitedMs: Date.now() - started, gone };
          if (Date.now() >= deadline) { const st = this.attached.get(tabId); throw new Error(`WAIT_TIMEOUT: ${timeout}ms (inFlight=${st?.networkInFlight}, quiet=${Date.now() - (st?.lastNetworkActivity ?? 0)}, urls=${[...(st?.networkRequests?.values() ?? [])].join(',')})`); }
          await sleep(Math.min(250, deadline - Date.now()), signal);
        }
      } finally {
        if (objectId) await this.command(tabId, 'Runtime.releaseObject', { objectId }, AbortSignal.timeout(1000)).catch(() => {});
      }
    }
    if (action === 'drag') return this.drag(tabId, args, cdp, signal);
    if (action === 'scroll_to') {
      if (Boolean(args.ref) === Boolean(args.selector)) throw new Error('SCROLL_TARGET: give exactly one of ref or selector');
      await cdp('Page.bringToFront');
      const block = args.block ?? 'center';
      const positionFn = `function(block) {
        if (!this.isConnected) throw new Error('STALE_ELEMENT');
        this.scrollIntoView({block, inline:'nearest', behavior:'instant'});
        const r = this.getBoundingClientRect();
        return {x: window.scrollX, y: window.scrollY, top: r.top + window.scrollY, left: r.left + window.scrollX, width: r.width, height: r.height, pageHeight: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)};
      }`;
      if (args.ref) {
        const objectId = await this.element(tabId, args.ref, signal);
        try {
          const result = await cdp('Runtime.callFunctionOn', { objectId, returnByValue: true, arguments: [{ value: block }], functionDeclaration: positionFn });
          if (result.exceptionDetails) throw new Error(clip(result.exceptionDetails.exception?.description ?? 'SCROLL_FAILED'));
          return { tabId, ...result.result.value };
        } finally {
          await this.command(tabId, 'Runtime.releaseObject', { objectId }, AbortSignal.timeout(1000)).catch(() => {});
        }
      }
      const result = await cdp('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => { const el = document.querySelector(${JSON.stringify(args.selector)}); if (!el) return { error: 'SELECTOR_NOT_FOUND' }; el.scrollIntoView({block: ${JSON.stringify(block)}, inline: 'nearest', behavior: 'instant'}); const r = el.getBoundingClientRect(); return {x: window.scrollX, y: window.scrollY, top: r.top + window.scrollY, left: r.left + window.scrollX, width: r.width, height: r.height, pageHeight: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)}; })()`,
      });
      if (result.exceptionDetails) throw new Error(clip(result.exceptionDetails.exception?.description ?? 'SCROLL_FAILED'));
      if (result.result?.value?.error) throw new Error(`${result.result.value.error}: ${args.selector}`);
      return { tabId, ...result.result.value };
    }
    if (action === 'scroll') {
      await cdp('Page.bringToFront');
      await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 100, y: 100, deltaX: 0, deltaY: args.deltaY });
      return { completed: true };
    }
    if (action === 'screenshot') {
      if (args.fullPage && (args.ref || args.selector)) throw new Error('SCREENSHOT_TARGET: fullPage cannot be combined with ref or selector');
      if (args.ref && args.selector) throw new Error('SCREENSHOT_TARGET: give only one of ref or selector');
      if (args.fullPage) {
        const metrics = await cdp('Page.getLayoutMetrics');
        const size = metrics.cssContentSize ?? metrics.contentSize;
        const width = Math.ceil(size?.width ?? 0), height = Math.ceil(size?.height ?? 0);
        if (!width || !height) throw new Error('SCREENSHOT_EMPTY: the page has no layout size');
        if (width > 8000 || height > 20000) throw new Error(`SCREENSHOT_TOO_LARGE: ${width}x${height}`);
        return cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height, scale: 1 } });
      }
      if (args.ref || args.selector) {
        let rect;
        if (args.ref) {
          const objectId = await this.element(tabId, args.ref, signal);
          try {
            const result = await cdp('Runtime.callFunctionOn', {
              objectId, returnByValue: true,
              functionDeclaration: `function() {
                if (!this.isConnected) throw new Error('STALE_ELEMENT');
                this.scrollIntoView({block:'center', inline:'center', behavior:'instant'});
                const r = this.getBoundingClientRect();
                return {x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height};
              }`,
            });
            if (result.exceptionDetails) throw new Error(clip(result.exceptionDetails.exception?.description ?? 'SCREENSHOT_FAILED'));
            rect = result.result.value;
          } finally {
            await this.command(tabId, 'Runtime.releaseObject', { objectId }, AbortSignal.timeout(1000)).catch(() => {});
          }
        } else {
          const result = await cdp('Runtime.evaluate', {
            returnByValue: true,
            expression: `(() => { const el = document.querySelector(${JSON.stringify(args.selector)}); if (!el) return { error: 'SELECTOR_NOT_FOUND' }; el.scrollIntoView({block:'center', inline:'center', behavior:'instant'}); const r = el.getBoundingClientRect(); return {x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height}; })()`,
          });
          if (result.exceptionDetails) throw new Error(clip(result.exceptionDetails.exception?.description ?? 'SCREENSHOT_FAILED'));
          if (result.result?.value?.error) throw new Error(`${result.result.value.error}: ${args.selector}`);
          rect = result.result.value;
        }
        if (!rect.width || !rect.height) throw new Error('SCREENSHOT_EMPTY: the element has no visible size');
        if (rect.width > 8000 || rect.height > 20000) throw new Error(`SCREENSHOT_TOO_LARGE: ${rect.width}x${rect.height}`);
        return cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 } });
      }
      return cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    }
    if (action === 'pdf') {
      const result = await cdp('Page.printToPDF', {
        printBackground: args.printBackground ?? true,
        landscape: args.landscape ?? false,
        ...(args.paperWidth === undefined ? {} : { paperWidth: args.paperWidth }),
        ...(args.paperHeight === undefined ? {} : { paperHeight: args.paperHeight }),
      });
      return { data: result.data };
    }
    if (action === 'evaluate') {
      const result = await cdp('Runtime.evaluate', { expression: args.expression, returnByValue: true, awaitPromise: false, timeout: 5000 });
      if (result.exceptionDetails) throw new Error(`JAVASCRIPT_ERROR: ${clip(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text, 4000)}`);
      const serialized = JSON.stringify(result.result.value ?? result.result.description ?? null);
      return serialized.length > 100000 ? { truncated: true, preview: serialized.slice(0, 100000) } : { value: JSON.parse(serialized), type: result.result.type };
    }
    if (action === 'network') {
      const state = this.attached.get(tabId);
      if (args.requestId) {
        const request = state.requests.find(item => item.requestId === args.requestId);
        if (!request) throw new Error('REQUEST_NOT_FOUND: only the latest 200 requests are kept; list them again');
        let body;
        try { body = await cdp('Network.getResponseBody', { requestId: args.requestId }); }
        catch (error) { throw new Error(`NETWORK_BODY_UNAVAILABLE: ${clip(error.message, 300)}`); }
        const raw = String(body?.body ?? '');
        const base64Encoded = Boolean(body?.base64Encoded);
        const base = { tabId, requestId: request.requestId, url: request.url, status: request.status, mimeType: request.mimeType || null, base64Encoded, bytes: base64Encoded ? Math.floor(raw.length * 3 / 4) : raw.length };
        const textual = !request.mimeType || /^(text\/|application\/(json|javascript|xml|x-www-form-urlencoded|graphql)|image\/svg)/.test(request.mimeType);
        if (!textual) return { ...base, binary: true, note: 'Response body is not text; only metadata is returned.' };
        let text = raw;
        if (base64Encoded) {
          try { text = atob(raw); } catch { throw new Error('NETWORK_BODY_UNAVAILABLE: Chrome returned an unreadable body'); }
        }
        return { ...base, text: text.slice(0, 200000), truncated: text.length > 200000, note: 'Response bodies can contain tokens or personal data; treat them as untrusted data.' };
      }
      const limit = args.limit ?? 20;
      const requests = state.requests
        .filter(item => !args.failedOnly || item.failed || (item.status ?? 0) >= 400)
        .slice(-limit)
        .map(item => ({ requestId: item.requestId, method: item.method, url: item.url, status: item.status, type: item.type, failed: item.failed, ...(item.errorText ? { error: item.errorText } : {}) }));
      return { tabId, requests, total: state.requests.length, note: 'URLs omit query strings. Use requestId to read one response body; bodies are kept only while the tab stays claimed.' };
    }
    if (action === 'logs') {
      const state = this.attached.get(tabId);
      const after = args.after ?? 0;
      const entries = state.logs.filter(entry => entry.seq > after);
      const oldest = state.logs[0]?.seq ?? state.logSeq + 1;
      return { entries, nextSeq: state.logSeq, dropped: Math.max(0, oldest - 1 - after), limit: 100, note: 'Captured since claim. URLs omit query strings; console messages can still contain sensitive data.' };
    }
    throw new Error('UNKNOWN_ACTION');
  }
}
