// Chrome DevTools protocol client on Node's global WebSocket, so the automation profile is driven with no package.
// Only a loopback endpoint is accepted: the debugging port grants full control of a signed-in browser, and a remote host
// would mean someone else's browser or a forwarded port.
const LOOPBACK = '127.0.0.1';
export const COMMAND_TIMEOUT_MS = 15 * 1000;
export const LOAD_TIMEOUT_MS = 30 * 1000;

// Raised for every CDP failure: refused endpoint, command error, timeout, page script exception.
export class CdpError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CdpError';
  }
}

// Returns url unchanged when its host is 127.0.0.1; throws CdpError otherwise.
export function assertLoopback(url) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new CdpError(`cdp: not a url: ${url}`);
  }
  if (host !== LOOPBACK) throw new CdpError(`cdp: refusing endpoint host ${host}; only ${LOOPBACK} is allowed`);
  return url;
}

const httpBase = (port) => `http://${LOOPBACK}:${port}`;

// The browser-level endpoint (webSocketDebuggerUrl) from /json/version.
export async function discoverEndpoint(port, { fetchFn = fetch } = {}) {
  const res = await fetchFn(assertLoopback(`${httpBase(port)}/json/version`), { signal: AbortSignal.timeout(COMMAND_TIMEOUT_MS) });
  if (!res.ok) throw new CdpError(`cdp: /json/version answered ${res.status}`);
  const info = await res.json();
  return { browser: info.Browser ?? '', wsUrl: assertLoopback(info.webSocketDebuggerUrl) };
}

// Routes each frame: a reply settles its pending command, anything else goes to the event listeners. A frame that is not
// JSON is dropped, because a throw inside a WebSocket listener would surface as an uncaught exception and end the run.
function makeDispatcher(pending, listeners) {
  return (ev) => {
    let msg;
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    if (msg?.id && pending.has(msg.id)) {
      const { resolve, reject, timer, method } = pending.get(msg.id);
      clearTimeout(timer);
      pending.delete(msg.id);
      if (msg.error) reject(new CdpError(`cdp: ${method} failed: ${msg.error.message}`));
      else resolve(msg.result ?? {});
      return;
    }
    for (const fn of listeners) fn(msg);
  };
}

function makeSend({ ws, pending, opened, isClosed, timeoutMs }) {
  let nextId = 1;
  return async (method, params = {}, sessionId) => {
    await opened;
    if (isClosed()) throw new CdpError('cdp: socket closed');
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new CdpError(`cdp: ${method} timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer, method });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  };
}

// The returned promise carries cancel(), which stops the wait and its timer without settling the promise.
const makeWaitFor = (listeners) => (method, sessionId, ms = LOAD_TIMEOUT_MS) => {
  let fn;
  let timer;
  const done = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      listeners.delete(fn);
      reject(new CdpError(`cdp: no ${method} within ${ms} ms`));
    }, ms);
    fn = (msg) => {
      if (msg.method !== method || (sessionId && msg.sessionId !== sessionId)) return;
      clearTimeout(timer);
      listeners.delete(fn);
      resolve(msg.params ?? {});
    };
    listeners.add(fn);
  });
  done.cancel = () => {
    clearTimeout(timer);
    listeners.delete(fn);
  };
  return done;
};

// Opens one socket; send() numbers each command and resolves with its result or rejects on error or timeout.
export function connect(wsUrl, { WebSocketImpl = globalThis.WebSocket, timeoutMs = COMMAND_TIMEOUT_MS } = {}) {
  assertLoopback(wsUrl);
  if (!WebSocketImpl) throw new CdpError('cdp: this Node has no global WebSocket; Node 22 or newer is needed');
  const ws = new WebSocketImpl(wsUrl);
  const pending = new Map();
  const listeners = new Set();
  let closed = false;
  const failAll = (err) => {
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(err);
    }
    pending.clear();
  };
  ws.addEventListener('message', makeDispatcher(pending, listeners));
  ws.addEventListener('close', () => {
    closed = true;
    failAll(new CdpError('cdp: socket closed'));
  });
  const opened = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true });
    ws.addEventListener('error', () => reject(new CdpError(`cdp: cannot open ${wsUrl}`)), { once: true });
  });
  const send = makeSend({ ws, pending, opened, isClosed: () => closed, timeoutMs });
  const close = () => {
    if (!closed) ws.close();
    closed = true;
    failAll(new CdpError('cdp: socket closed'));
  };
  return { send, waitFor: makeWaitFor(listeners), close, opened };
}

// Opens a page target, attaches a flat session and navigates it; returns the session id and target id. The tab is closed
// again when any later step fails, since the caller never receives its id to clean up.
export async function openPage(client, url) {
  const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' });
  try {
    const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });
    await client.send('Page.enable', {}, sessionId);
    if (url) await navigate(client, sessionId, url);
    return { targetId, sessionId };
  } catch (err) {
    await client.send('Target.closeTarget', { targetId }).catch(() => {});
    throw err;
  }
}

// Registers the load listener before sending Page.navigate so a fast load event is not missed.
export async function navigate(client, sessionId, url) {
  const loaded = client.waitFor('Page.loadEventFired', sessionId);
  let res;
  try {
    res = await client.send('Page.navigate', { url }, sessionId);
  } catch (err) {
    loaded.cancel?.();
    throw err;
  }
  if (res.errorText) {
    loaded.cancel?.();
    throw new CdpError(`cdp: cannot load ${url}: ${res.errorText}`);
  }
  // Chrome omits loaderId for a same-document navigation, which fires no load event.
  if (!res.loaderId) {
    loaded.cancel?.();
    return;
  }
  await loaded;
}

// Runs expression in the page and returns its value; a page exception becomes a CdpError.
export async function evaluate(client, sessionId, expression) {
  const res = await client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (res.exceptionDetails) {
    const d = res.exceptionDetails;
    throw new CdpError(`cdp: page script failed: ${d.exception?.description ?? d.text ?? 'exception'}`);
  }
  return res.result?.value;
}

export const readText = (client, sessionId) => evaluate(client, sessionId, 'document.body ? document.body.innerText : ""');

// Accessibility nodes trimmed to role, name and value; ignored nodes and nodes with neither name nor value are dropped.
export async function readAxTree(client, sessionId) {
  await client.send('Accessibility.enable', {}, sessionId);
  const { nodes = [] } = await client.send('Accessibility.getFullAXTree', {}, sessionId);
  return nodes
    .filter((n) => !n.ignored)
    .map((n) => ({ role: n.role?.value ?? '', name: n.name?.value ?? '', value: n.value?.value ?? '' }))
    .filter((n) => n.name || n.value);
}

// Runs fn with a connected browser client and closes the socket on every exit path.
export async function withBrowser(port, fn, deps = {}) {
  const { wsUrl } = await discoverEndpoint(port, deps);
  const client = connect(wsUrl, deps);
  try {
    await client.opened;
    return await fn(client);
  } finally {
    client.close();
  }
}

// Form helpers. Values go through the element's native value setter plus input and change events, because ATS forms
// built on React or Vue ignore a bare .value assignment.
const js = (v) => JSON.stringify(v);

export const describeField = (client, sessionId, selector) =>
  evaluate(client, sessionId, `(() => { const el = document.querySelector(${js(selector)}); if (!el) return null;
    return { tag: el.tagName.toLowerCase(), type: (el.type || '').toLowerCase(), autocomplete: (el.autocomplete || '').toLowerCase() }; })()`);

export const setValue = (client, sessionId, selector, value) =>
  evaluate(client, sessionId, `(() => { const el = document.querySelector(${js(selector)}); if (!el) return false;
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${js(String(value))});
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);

export const selectOption = (client, sessionId, selector, value) =>
  evaluate(client, sessionId, `(() => { const el = document.querySelector(${js(selector)}); if (!el) return false;
    const want = ${js(String(value).toLowerCase())};
    const opt = [...el.options].find((o) => o.value.toLowerCase() === want || o.text.trim().toLowerCase() === want);
    if (!opt) return false; el.value = opt.value; el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);

export const setChecked = (client, sessionId, selector, checked) =>
  evaluate(client, sessionId, `(() => { const el = document.querySelector(${js(selector)}); if (!el) return false;
    if (el.checked !== ${checked ? 'true' : 'false'}) el.click(); return true; })()`);

export const readValue = (client, sessionId, selector) =>
  evaluate(client, sessionId, `(() => { const el = document.querySelector(${js(selector)}); if (!el) return null;
    return el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.type === 'file' ? [...el.files].map((f) => f.name) : el.value; })()`);

// Attaches files to the file input matched by selector through the DOM domain.
export async function setFileInputFiles(client, sessionId, selector, files) {
  const { root } = await client.send('DOM.getDocument', { depth: 0 }, sessionId);
  const { nodeId } = await client.send('DOM.querySelector', { nodeId: root.nodeId, selector }, sessionId);
  if (!nodeId) throw new CdpError(`cdp: no file input ${selector}`);
  await client.send('DOM.setFileInputFiles', { nodeId, files }, sessionId);
}

// The inputs, selects and textareas of the application form with their label text, for mapping by lib/ats-fields.mjs.
// The form is the one that holds a file input or a submit button, else the largest form, else the whole page; a search
// box (type=search, inside role=search) and any input in the page header or nav are never application fields.
export const readFormFields = (client, sessionId) =>
  evaluate(client, sessionId, `(() => { const forms = [...document.querySelectorAll('form')].filter((f) => typeof f.querySelectorAll === 'function');
    const size = (f) => f.querySelectorAll('input, select, textarea').length;
    const apply = forms.filter((f) => f.querySelector('input[type=file], button[type=submit], input[type=submit]'));
    const pick = (list) => list.reduce((best, f) => (!best || size(f) > size(best) ? f : best), null);
    const scope = pick(apply) || pick(forms) || document;
    return [...scope.querySelectorAll('input, select, textarea')]
    .filter((el) => el.type !== 'hidden' && el.type !== 'submit' && el.type !== 'search' && !(typeof el.closest === 'function' && el.closest('header, nav, [role=search]')))
    .map((el, i) => { const id = el.id; const label = (id && document.querySelector('label[for="' + CSS.escape(id) + '"]')) || el.closest('label');
      return { selector: id ? '#' + CSS.escape(id) : el.name ? '[name="' + CSS.escape(el.name) + '"]' : '', id, name: el.name || '', type: (el.type || el.tagName).toLowerCase(),
        label: (label ? label.innerText : el.getAttribute('aria-label') || el.placeholder || '').trim(), required: el.required,
        autocomplete: (el.autocomplete || '').toLowerCase() }; }); })()`);

export const click = (client, sessionId, selector) =>
  evaluate(client, sessionId, `(() => { const el = document.querySelector(${js(selector)}); if (!el) return false; el.click(); return true; })()`);

// PNG of the page as a Buffer.
export async function screenshot(client, sessionId) {
  const { data } = await client.send('Page.captureScreenshot', { format: 'png' }, sessionId);
  return Buffer.from(data, 'base64');
}

// Same page address after URL parsing (so a trailing slash on a bare origin compares equal); exact text otherwise.
const sameUrl = (a, b) => {
  try {
    return new URL(a).href === new URL(b).href;
  } catch {
    return a === b;
  }
};

async function attachTarget(client, targetId) {
  const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });
  await client.send('Page.enable', {}, sessionId);
  return { targetId, sessionId };
}

// Attaches to an open page target whose url is exactly the given url; a prefix match could be another job's form.
export async function attachTo(client, url) {
  const { targetInfos = [] } = await client.send('Target.getTargets');
  const target = targetInfos.find((t) => t.type === 'page' && sameUrl(t.url, url));
  return target ? attachTarget(client, target.targetId) : null;
}

// Attaches to the page target with this id, or null when that tab is gone.
export async function attachById(client, targetId) {
  if (!targetId) return null;
  const { targetInfos = [] } = await client.send('Target.getTargets');
  return targetInfos.some((t) => t.type === 'page' && t.targetId === targetId) ? attachTarget(client, targetId) : null;
}

// Picks the radio button of the group selector names whose value or label equals value (case-insensitive). "decline"
// also matches a decline or prefer-not-to-say option. False when no option matches.
export const chooseRadio = (client, sessionId, selector, value) =>
  evaluate(client, sessionId, `(() => { const first = document.querySelector(${js(selector)}); if (!first) return false;
    const group = first.name ? [...document.querySelectorAll('input[type=radio]')].filter((el) => el.name === first.name && el.form === first.form) : [first];
    const want = ${js(String(value).trim().toLowerCase())};
    const labelOf = (el) => { const l = (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]')) || el.closest('label'); return (l ? l.innerText : '').trim().toLowerCase(); };
    const decline = /decline|prefer not|do not wish|don.t wish|choose not/;
    const pick = group.find((el) => el.value.toLowerCase() === want || labelOf(el) === want) || (want === 'decline' ? group.find((el) => decline.test(labelOf(el)) || decline.test(el.value.toLowerCase())) : null);
    if (!pick) return false; if (!pick.checked) pick.click(); return true; })()`);
