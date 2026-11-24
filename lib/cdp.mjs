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

// Button wording that names another action than sending the application: a sign-in or job-board apply, saving, sharing
// or a job alert. Such a button is never the submit.
export const LINK_STYLE = /apply with|linkedin|indeed|\bsave( this)? job\b|\bshare\b|bookmark|subscribe|sign in|log in|job alert/i;
// Application-submit wording: inside the application form a type=button or untyped button reading so is its submit.
export const APPLY_SUBMIT = /\bsubmit\b|\bapply\b|send application|finish application|complete application/i;
// Shared application-form rule v3 (both repos). A form whose submit candidate is worded as a signup (newsletter, alert,
// notify, talent community, contact sales, demo, or a bare "Join" / "Join now" / "Join us") is never the application
// form, whatever fields it holds.
export const SIGNUP_BUTTON = /\b(subscribe|sign me up|sign up|notify me|get notified|get (job )?(updates|alerts)|create (an? )?(job )?alerts?|keep me (updated|posted)|stay in touch|text me|join (our |the )?(talent|community|network|newsletter|mailing|waitlist)|contact sales|talk to (sales|us)|request a demo)\b/i;
export const JOIN_ONLY = /^\s*join( now| us)?\s*$/i;
// Attribute marketing check: whole lowercase tokens of an id, class or name (split on non-alphanumerics, and also on
// camelCase boundaries), one of MARKETING_TOKENS or two adjacent tokens forming a MARKETING_PAIRS entry. Never bare
// substrings, and never "footer", "marketing" or "updates".
export const MARKETING_TOKENS = Object.freeze(['newsletter', 'subscribe', 'subscription', 'signup', 'mailing', 'hubspot', 'hsform', 'mktoform']);
export const MARKETING_PAIRS = Object.freeze([['talent', 'community'], ['talent', 'communities'], ['talent', 'network'], ['talent', 'networks'], ['job', 'alert'], ['job', 'alerts'], ['sign', 'up'], ['mailing', 'list']]);
// Talent-community tokens of a form's own id, class or name: both words of a pair, or one joined token, disqualify it.
export const TALENT_WORDS = Object.freeze(['community', 'communities', 'network', 'networks']);
export const TALENT_JOINED = Object.freeze(['talentcommunity', 'talentcommunities', 'talentnetwork', 'talentnetworks']);
// A control of a nested header, nav, footer or contentinfo region that submits something of its own: an explicit
// type=submit or this wording, unless it reads as a helper (autofill, upload, browse), which is never one.
export const REGION_SUBMIT = /\b(submit|send|go|search|find|subscribe|sign ?up|join|apply|register|notify)\b/i;
export const HELPER_BUTTON = /auto-?fill|upload|browse|attach|choose file|select file|\bremove\b|add another|\bclear\b|\bclose\b|show more/i;
// Search wording: a typed control so worded inside a nested region is the pick only when nothing else qualifies.
export const SEARCH_WORDED = /\b(search|find|go)\b/i;
// Submit-pick rule v4 item A: wording that never names an application submit, unless it is also APPLY_SUBMIT-worded.
export const NON_SUBMIT = /\b(sign ?in|log ?in|accept|agree|cookies?|consent|language|english|espa[nñ]ol|save( as)? draft|save for later|save|back|previous|prev|cancel|reset|clear|close|search|go)\b/i;
// Submit-pick rule v5 item 1: submit wording beyond APPLY_SUBMIT (a), and step wording of a multi-step form (c).
export const SEND_WORDS = /\b(send|finish|complete)\b/i;
export const STEP_WORDS = /\b(next|continue|review|preview|edit|delete)\b/i;

// The label of a control (rule v5 "Label"): the non-empty, distinct parts of its textContent (whitespace collapsed),
// value attribute and aria-label, lowercased and joined by one space, at most 80 characters. The same functions run in
// the page at read time (BUTTON_JS) and at click time (submitButton). A page without textContent falls back to innerText.
export const controlParts = (el) => {
  const get = (k) => (el && typeof el.getAttribute === 'function' ? el.getAttribute(k) : null);
  const out = [];
  for (const raw of [el.textContent ?? el.innerText, get('value'), get('aria-label')]) {
    const t = String(raw ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
};
// Rule v6 item 1b: cut to 80 characters, then trimmed again, identically at read and click time.
export const controlLabel = (el) => controlParts(el).join(' ').slice(0, 80).trimEnd();
// Rule v5 items 1b-d (kept by v6): not link-style, helper, non-submit or step wording, and not empty.
export const allowedLabel = (l) => Boolean(l) && (APPLY_SUBMIT.test(l) || SEND_WORDS.test(l)) && !LINK_STYLE.test(l)
  && !HELPER_BUTTON.test(l) && !NON_SUBMIT.test(l) && !STEP_WORDS.test(l);
// Rule v6 item 1: every non-empty label part, with each run of non-letters made one space, must fully match STRICT_PART.
// Item 1c (universal since the 2026-11-24 amendment): in every form each part must also name the application
// (NAMED_PART), so a plain "submit", "send", "finish" or "complete" never passes.
export const STRICT_PART = /^(submit|apply|send|finish|complete)( (my|your|the|this))?( (job )?application)?( now)?$/;
export const NAMED_PART = /^((submit|send|finish|complete)( (my|your|the|this))? (job )?application|apply( now)?)$/;
// The controls rule v6 item 2 counts in a form: any type.
export const COUNTED = 'button, input[type=submit], input[type=button], [role=button]';
export const strictParts = (el) => controlParts(el).map((t) => t.replace(/[^a-z]+/g, ' ').trim()).filter(Boolean);
export const passesItem1 = (el) => {
  const parts = strictParts(el);
  return parts.length > 0 && parts.every((p) => STRICT_PART.test(p) && NAMED_PART.test(p)) && allowedLabel(controlLabel(el));
};
// The one counting function of rule v6 item 2, used at read time and at click time: the controls of form passing item 1.
export const passingControls = (form) => [...form.querySelectorAll(COUNTED)].filter((o) => passesItem1(o));
// Rule v6 item 2d: a form holding an input type=image or an <a> whose href starts with javascript: (ASP.NET ImageButton
// or LinkButton) has a submit that is never picked or verified, so it saves none and is never clicked.
export const unverifiable = (form) => [...form.querySelectorAll('input[type=image]')].some((el) => el.tagName === 'INPUT' && String(el.type || '').toLowerCase() === 'image')
  || [...form.querySelectorAll('a')].some((a) => a.tagName === 'A' && /^\s*javascript:/i.test(String((typeof a.getAttribute === 'function' ? a.getAttribute('href') : null) ?? '')));
// Rule v6 item 3 on the live element el inside form: why it must not be clicked, or null. The form must hold no
// unverifiable control (2d), and el must be a typed submit or an APPLY_SUBMIT-worded control (the pack's accepted
// type=button), pass item 1, carry the saved label, and be the only control of the form passing item 1.
export const clickProblem = (el, form, saved) => {
  const get = (k) => (typeof el.getAttribute === 'function' ? el.getAttribute(k) : null);
  const type = String(el.type || '').toLowerCase();
  const typedEl = (el.tagName === 'BUTTON' && get('type') !== null && type === 'submit') || (el.tagName === 'INPUT' && type === 'submit');
  const label = controlLabel(el);
  if (unverifiable(form)) return 'shares its form with an image button or a javascript: link';
  if (!passesItem1(el)) return `reads "${label}", which is no application submit`;
  if (!typedEl && !APPLY_SUBMIT.test(label)) return 'is no typed or application-worded submit';
  if (label !== saved) return `now reads "${label}", the read saved "${saved}"`;
  const passing = passingControls(form);
  if (passing.length !== 1 || passing[0] !== el) return `is not the only application submit of its form (${passing.length} pass)`;
  return null;
};
// The shared page-script prelude: the label and rule v6 check functions above, by source, so read time (BUTTON_JS) and
// click time (submitButton, checkedClick) run the same code.
const LABEL_JS = `
  const APPLY_SUBMIT = ${APPLY_SUBMIT};
  const LINK_STYLE = ${LINK_STYLE};
  const HELPER_BUTTON = ${HELPER_BUTTON};
  const NON_SUBMIT = ${NON_SUBMIT};
  const SEND_WORDS = ${SEND_WORDS};
  const STEP_WORDS = ${STEP_WORDS};
  const STRICT_PART = ${STRICT_PART};
  const NAMED_PART = ${NAMED_PART};
  const COUNTED = ${JSON.stringify(COUNTED)};
  const controlParts = ${controlParts};
  const controlLabel = ${controlLabel};
  const allowedLabel = ${allowedLabel};
  const strictParts = ${strictParts};
  const passesItem1 = ${passesItem1};
  const passingControls = ${passingControls};
  const unverifiable = ${unverifiable};
  const clickProblem = ${clickProblem};`;

// Page-script helpers of FORM_SCRIPT: one submit pick per form, the signup check on it, and a stable selector path.
// Toggles (role=switch, checkbox or radio, or aria-pressed) are never buttons here. pick: a typed submit always beats a
// type=button or typeless control; within each tier (typed, then APPLY_SUBMIT-worded type=button or typeless, then
// typeless) the first control outside the form's nested header, nav, footer or contentinfo regions that is not a helper
// (HELPER_BUTTON) wins, else the first non-helper, non-search one anywhere; LINK_STYLE controls are skipped inside a
// tier, and a form whose typed submits are all link-style or helpers has no pick (never a lower tier).
// The signup check (rule v3 item 1) tests that pick (every button when there is none). finalSubmit applies rule v6: the
// pick is saved only when it is a typed submit or APPLY_SUBMIT-worded (the click-time check accepts no other) and it is
// the one and only control of the form (COUNTED, any type) passing item 1 with 1c (passingControls), the form holds no
// image button or javascript: link (2d), no control or link anywhere in the form is a step or an application-worded
// control failing item 1 (2c (i), (ii); a link counts as a step only when its whole label is one), and no later
// non-secondary control outside a separate region follows it (2c (iii)). A region holding a REGION_SUBMIT control is a separate small form unless
// it holds finalSubmit's button (the form's action bar); with no final submit, only a region holding a NON_SUBMIT
// control is separate.
const BUTTON_JS = `${LABEL_JS}
  const typeOf = (el) => String(el.type || '').toLowerCase();
  const attr = (el, k) => (el && typeof el.getAttribute === 'function' ? el.getAttribute(k) : null);
  const BUTTONS = 'button, input[type=submit], input[type=button]';
  const textOf = controlLabel;
  const typed = (el) => (el.tagName === 'BUTTON' && typeOf(el) === 'submit' && attr(el, 'type') !== null) || (el.tagName === 'INPUT' && typeOf(el) === 'submit');
  const untyped = (el) => el.tagName === 'BUTTON' && attr(el, 'type') === null;
  const plain = (el) => typeOf(el) === 'button' || untyped(el);
  const SIGNUP_BUTTON = ${SIGNUP_BUTTON};
  const JOIN_ONLY = ${JOIN_ONLY};
  const toggle = (b) => ['switch', 'checkbox', 'radio'].includes(String(attr(b, 'role') || '').toLowerCase()) || attr(b, 'aria-pressed') !== null;
  const REGION_SUBMIT = ${REGION_SUBMIT};
  const SEARCH_WORDED = ${SEARCH_WORDED};
  const controls = (f) => (typeof f.querySelectorAll === 'function' ? [...(f.querySelectorAll(BUTTONS) || [])] : []);
  const rawButtons = (f) => controls(f).filter((b) => !toggle(b));
  const helper = (b) => HELPER_BUTTON.test(textOf(b));
  const linkStyle = (b) => LINK_STYLE.test(textOf(b));
  const applyWorded = (b) => APPLY_SUBMIT.test(textOf(b)) && !linkStyle(b);
  const regionsOf = (f) => (typeof f.querySelectorAll === 'function' ? [...f.querySelectorAll('header, nav, footer, [role=contentinfo]')] : [])
    .filter((r) => ['HEADER', 'NAV', 'FOOTER'].includes(r.tagName) || String(attr(r, 'role') || '').toLowerCase() === 'contentinfo');
  const pick = (f) => {
    const regions = regionsOf(f);
    const inRegion = (b) => regions.some((r) => r.contains(b));
    const tier = (l) => l.find((b) => !inRegion(b) && !helper(b)) || l.find((b) => !helper(b) && !SEARCH_WORDED.test(textOf(b))) || null;
    const all = rawButtons(f);
    const typedList = all.filter(typed);
    if (typedList.length) return tier(typedList.filter((b) => !linkStyle(b)));
    return tier(all.filter((b) => plain(b) && applyWorded(b))) || tier(all.filter((b) => untyped(b) && !linkStyle(b)));
  };
  const LINK_STEP = /^(next|continue|review|preview)( (step|page|application))?$/;
  const isLink = (o) => String(attr(o, 'role') || '').toLowerCase() === 'link' || (o.tagName === 'A' && String(attr(o, 'role') || '').toLowerCase() !== 'button');
  const finalSubmit = (f) => {
    const b = pick(f);
    if (!b) return null;
    if (!typed(b) && !APPLY_SUBMIT.test(controlLabel(b))) return null;
    if (unverifiable(f)) return null;
    const passing = passingControls(f);
    if (passing.length !== 1 || passing[0] !== b) return null;
    // 2c (i) and (ii) run over every control and link of the form, regions included; only (iii) skips separate regions.
    const stepOrNearMiss = (o) => {
      const t = controlLabel(o);
      const step = isLink(o) ? LINK_STEP.test(t.replace(/[^a-z]+/g, ' ').trim()) : STEP_WORDS.test(t);
      return step || (/\\b(submit|apply|send|finish|complete)\\b/.test(t) && !linkStyle(o) && !helper(o));
    };
    if ([...f.querySelectorAll(COUNTED + ', a, [role=link]')].some((o) => o !== b && stepOrNearMiss(o))) return null;
    const all = [...f.querySelectorAll(COUNTED)];
    const regions = regionsOf(f);
    const own = regions.filter((r) => r.contains(b));
    const separate = (o) => regions.some((r) => r.contains(o) && !own.includes(r));
    return all.some((o, i) => o !== b && !separate(o) && i > all.indexOf(b) && !secondary(o)) ? null : b;
  };
  const secondary = (o) => toggle(o) || nonSubmit(o) || linkStyle(o) || helper(o) || signupText(o);
  // Fail-safe rule v7 F1: the one submit decision, run at read time (FORM_SCRIPT) and at click time (submitGate,
  // checkedClick). It returns { pick, signature } or { pick: null, reason } with a fixed reason code.
  const SCOPE = COUNTED + ', a, [role=link]';
  const ACTION_PART = /submit|apply|send|finish|complete/;
  const submitWorded = (o) => strictParts(o).some((p) => ACTION_PART.test(p));
  const inScope = (f) => [...f.querySelectorAll(SCOPE)];
  const navigating = (a) => { const h = attr(a, 'href'); return h !== null && !['', '#'].includes(String(h).trim()); };
  const decide = (f) => {
    const no = (reason) => ({ pick: null, reason });
    const b = pick(f);
    if (!b || signupForm(f)) return no('rule-v6');
    if (isLink(b) || (b.tagName === 'A' && navigating(b))) return no('link-submit');
    if ([...f.querySelectorAll('a')].some((a) => a.tagName === 'A' && attr(a, 'onclick') !== null)) return no('link-submit');
    const fid = attr(f, 'id');
    if (fid && [...document.querySelectorAll(SCOPE + ', input, select, textarea')].some((o) => attr(o, 'form') === fid && !f.contains(o))) return no('outside-control');
    const worded = (o) => APPLY_SUBMIT.test(controlLabel(o)) || SEND_WORDS.test(controlLabel(o));
    if (rawButtons(f).filter((o) => !linkStyle(o) && (typed(o) || plain(o)) && worded(o)).length > 1) return no('many-candidates');
    if (inScope(f).some((o) => isLink(o) && /\\b(next|continue)\\b/.test(strictParts(o).join(' ')))) return no('step-link');
    if (inScope(f).some((o) => o !== b && submitWorded(o))) return no('extra-submit-control');
    const bare = strictParts(b).every((p) => /^apply( now)?$/.test(p));
    if (bare && [...f.querySelectorAll(COUNTED)].some((o) => o !== b && (typed(o) || !secondary(o)))) return no('bare-apply');
    if (finalSubmit(f) !== b) return no('rule-v6');
    const controls = inScope(f).filter((o) => o === b || submitWorded(o)).map((o) => [o.tagName.toLowerCase(), typeOf(o), controlLabel(o)]);
    return { pick: b, signature: { controls, path: pathOf(b) } };
  };
  // Rule v7 F3/F4 at click time: re-runs decide on the live form and returns null only when it picks the element at
  // the saved path with a signature equal to the saved one; any error refuses. Without a saved signature (a read made
  // before v7) only the signature comparison is skipped.
  const gate = (formSel, sel, saved) => {
    try {
      const form = document.querySelector(formSel);
      if (!form) return 'changed-since-read';
      const d = decide(form);
      if (!d.pick || d.pick !== document.querySelector(sel)) return 'changed-since-read';
      if (saved !== null && JSON.stringify(d.signature) !== JSON.stringify(saved)) return 'changed-since-read';
      return null;
    } catch {
      return 'changed-since-read';
    }
  };
  const regionSubmit = (b) => !helper(b) && (typed(b) || REGION_SUBMIT.test(textOf(b)));
  const nonSubmit = (b) => NON_SUBMIT.test(textOf(b)) && !applyWorded(b);
  const separateRegions = (f) => {
    const own = regionsOf(f).filter((r) => rawButtons(r).some(regionSubmit));
    if (!own.length) return [];
    const chosen = finalSubmit(f);
    return chosen ? own.filter((r) => !r.contains(chosen)) : own.filter((r) => rawButtons(r).some(nonSubmit));
  };
  const signupText = (b) => SIGNUP_BUTTON.test(textOf(b)) || controlParts(b).some((t) => JOIN_ONLY.test(t));
  const signupForm = (f) => { const b = pick(f); return (b ? [b] : rawButtons(f)).some(signupText); };
  const savedText = controlLabel;
  const pathOf = (el) => {
    const parts = [];
    for (let n = el; n && n.tagName && n.tagName !== 'HTML'; n = n.parentElement) {
      const id = attr(n, 'id');
      if (id) { parts.unshift('#' + CSS.escape(id)); break; }
      const tag = n.tagName.toLowerCase();
      if (tag === 'body') { parts.unshift('body'); break; }
      const same = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : [n];
      parts.unshift(tag + ':nth-of-type(' + (same.indexOf(n) + 1) + ')');
    }
    return parts.join(' > ');
  };`;

// The application form of the page, read-only: { fields, form, submit }. fields are its inputs, selects and textareas
// with their label text, for mapping by lib/ats-fields.mjs. A form inside the page header, nav or footer, a role=search
// form, or one holding a type=search input outside its own nested header or nav is never the application form. Rule v3: a form whose submit candidate has
// signup wording (SIGNUP_BUTTON or JOIN_ONLY), a form whose own id, class or name holds talent-community tokens
// (TALENT_WORDS / TALENT_JOINED), and a form in a <footer> or role=contentinfo never qualify, even with a file, resume or
// password field. Otherwise it qualifies with a file input, or a password input (a sign-in, which readForm then stops
// on), or two kinds of identity field (name, email, phone, resume or CV link; a select never counts) when it is not
// marketing by attribute (MARKETING_TOKENS / MARKETING_PAIRS in the id, class or name of the form or an ancestor below
// body; a resume or CV field overrides only this attribute check). When no form qualifies, account says whether the
// page shows a password input outside header, nav, search and footer (a sign-in or create-account page). When the
// chosen form holds no file input but another form or element outside header, nav, footer and search does (the
// classic Greenhouse upload forms), submit is null, so the item is never submitted without its resume. A form with a
// file input or any button (a <button> with no type is a submit) comes first; forms are
// ranked by answerable fields (hidden, submit, button and search inputs do not count). When no form qualifies, the
// whole page outside every form and outside header, nav, footer and search is read, so an iframe-hosted form next to a
// newsletter reads nothing. Inside the chosen form every answerable input counts except the non-checkbox, non-file
// inputs of a separate region (BUTTON_JS separateRegions: a nested site search or footer newsletter); a consent box and
// any file input are always kept, and a file input of the chosen form that was not read saves no submit. form is the chosen form's selector and submit the button chrome.mjs submit clicks (BUTTON_JS
// decide, rule v7 F1), never a link-style one, with submitSignature (F2) saved beside it; when decide refuses, submit is
// null and submitRefusal holds its reason code. A whole-page read has form and submit null, so
// fields and submit scope always come from the same choice and a page with no real form is never submitted by script.
const FORM_SCRIPT = `(() => {${BUTTON_JS}
  const SKIP = ['hidden', 'submit', 'button', 'reset', 'image', 'search'];
  const OUTSIDE = 'header, nav, footer, [role=search]';
  const near = (el, sel) => (typeof el.closest === 'function' ? el.closest(sel) : null);
  const answerable = (el) => !SKIP.includes(typeOf(el));
  const inputs = (scope) => [...scope.querySelectorAll('input, select, textarea')];
  const nestedIn = (el, f, sel) => { const r = near(el, sel); return Boolean(r && r !== f && f.contains(r)); };
  const excluded = (f) => Boolean(near(f, OUTSIDE)) || [...f.querySelectorAll('input[type=search]')].some((el) => !nestedIn(el, f, 'header, nav'));
  const labelOf = (el) => { const id = el.id; return (id && document.querySelector('label[for="' + CSS.escape(id) + '"]')) || near(el, 'label'); };
  const words = (el) => [el.id, el.name, typeOf(el), el.autocomplete, attr(el, 'aria-label'), el.placeholder, labelOf(el) ? labelOf(el).innerText : ''].join(' ').toLowerCase();
  const identity = (el) => { const t = typeOf(el); const w = words(el);
    if (el.tagName === 'SELECT') return null;
    if (t === 'email' || /e-?mail/.test(w)) return 'email';
    if (t === 'tel' || /phone|mobile/.test(w)) return 'phone';
    if (/resume|\\bcv\\b|linkedin|portfolio/.test(w)) return 'resume';
    if (/name/.test(w) && !/company|employer|school|user/.test(w)) return 'name';
    return null; };
  const MARKETING_TOKENS = ${JSON.stringify(MARKETING_TOKENS)};
  const MARKETING_PAIRS = ${JSON.stringify(MARKETING_PAIRS)};
  const split = (s) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const marketingValue = (v) => {
    const raw = split(String(v));
    const camel = split(String(v).replace(/([a-z0-9])([A-Z])/g, '$1 $2'));
    if ([...raw, ...camel].some((t) => MARKETING_TOKENS.includes(t))) return true;
    return [raw, camel].some((ts) => ts.some((t, i) => MARKETING_PAIRS.some(([a, b]) => t === a && ts[i + 1] === b)));
  };
  const resumeField = (f) => inputs(f).some((el) => typeOf(el) === 'file' || /resume|\\bcv\\b/.test(words(el)));
  const marketingAttr = (f) => {
    for (let n = f; n && n.tagName && n.tagName !== 'BODY' && n.tagName !== 'HTML'; n = n.parentElement) {
      if (['id', 'class', 'name'].some((k) => attr(n, k) && marketingValue(attr(n, k)))) return true;
    }
    return false;
  };
  const TALENT_WORDS = ${JSON.stringify(TALENT_WORDS)};
  const TALENT_JOINED = ${JSON.stringify(TALENT_JOINED)};
  const talentForm = (f) => {
    const ts = ['id', 'class', 'name'].flatMap((k) => { const v = String(attr(f, k) || ''); return [...split(v), ...split(v.replace(/([a-z0-9])([A-Z])/g, '$1 $2'))]; });
    return ts.some((t) => TALENT_JOINED.includes(t)) || (ts.includes('talent') && ts.some((t) => TALENT_WORDS.includes(t)));
  };
  const inFooter = (f) => Boolean(near(f, 'footer, [role=contentinfo]'));
  const formInputs = (f) => { const sep = separateRegions(f);
    return inputs(f).filter((el) => answerable(el) && (['file', 'checkbox'].includes(typeOf(el)) || !sep.some((r) => r.contains(el)))); };
  const kinds = (f) => new Set(formInputs(f).map(identity).filter(Boolean)).size;
  const qualifies = (f) => !signupForm(f) && !talentForm(f) && !inFooter(f) && (Boolean(f.querySelector('input[type=file]')) || Boolean(f.querySelector('input[type=password]'))
    || (kinds(f) >= 2 && (resumeField(f) || !marketingAttr(f))));
  const forms = [...document.querySelectorAll('form')].filter((f) => typeof f.querySelectorAll === 'function' && !excluded(f) && qualifies(f));
  const count = (f) => formInputs(f).length;
  const hasButton = (f) => Boolean(f.querySelector('input[type=file]') || f.querySelector('button') || f.querySelector('input[type=submit]') || f.querySelector('input[type=button]'));
  const best = (list) => list.filter((f) => count(f) > 0).reduce((b, f) => (!b || count(f) > count(b) ? f : b), null);
  const form = best(forms.filter(hasButton)) || best(forms);
  const outside = (el) => Boolean(near(el, OUTSIDE)) || Boolean(near(el, 'form'));
  const list = form ? formInputs(form) : inputs(document).filter((el) => answerable(el) && !outside(el));
  const ownerOk = (el) => { const owner = near(el, 'form'); return !(owner && excluded(owner)); };
  const uploadOutside = Boolean(form) && !form.querySelector('input[type=file]')
    && [...document.querySelectorAll('input[type=file]')].some((el) => !form.contains(el) && !near(el, OUTSIDE) && ownerOk(el));
  // Guard only: formInputs keeps every file input of the form, so this cannot fire today.
  const fileUnread = Boolean(form) && [...form.querySelectorAll('input[type=file]')].some((el) => !list.includes(el));
  const decision = form && !uploadOutside && !fileUnread ? decide(form) : null;
  const button = decision ? decision.pick : null;
  const shown = (el) => {
    if (attr(el, 'hidden') !== null) return false;
    if (typeof el.getBoundingClientRect !== 'function') return true;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    return typeof el.checkVisibility === 'function' ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : true;
  };
  const account = !form && [...document.querySelectorAll('input[type=password]')].some((el) => shown(el) && !near(el, 'header, nav, [role=search], footer, [role=contentinfo]'));
  const fields = list.map((el) => { const id = el.id; const label = labelOf(el);
    return { selector: id ? '#' + CSS.escape(id) : el.name ? '[name="' + CSS.escape(el.name) + '"]' : '', id, name: el.name || '', type: (el.type || el.tagName).toLowerCase(),
      label: (label ? label.innerText : attr(el, 'aria-label') || el.placeholder || '').trim(), required: el.required,
      autocomplete: (el.autocomplete || '').toLowerCase() }; });
  return { fields, form: form ? pathOf(form) : null, submit: button ? pathOf(button) : null, submitText: button ? savedText(button) : null,
    submitSignature: button ? decision.signature : null, submitRefusal: decision && !button ? decision.reason : null, account, uploadOutside };
})()`;

// The read of FORM_SCRIPT as { fields, form, submit }, plus account: true when no form qualifies and the page shows a
// password input (a sign-in or create-account page), and uploadOutside: true when the submit is null because the resume
// upload sits outside the chosen form (rule 7). A page script that returned a bare field list gives { fields }.
export async function readApplicationForm(client, sessionId) {
  const v = await evaluate(client, sessionId, FORM_SCRIPT);
  if (Array.isArray(v)) return { fields: v };
  if (!v || typeof v !== 'object') return { fields: [] };
  return { fields: Array.isArray(v.fields) ? v.fields : [], form: v.form ?? null, submit: v.submit ?? null, ...(v.submit && typeof v.submitText === 'string' ? { submitText: v.submitText } : {}),
    ...(v.submit && v.submitSignature && typeof v.submitSignature === 'object' ? { submitSignature: v.submitSignature } : {}), ...(!v.submit && typeof v.submitRefusal === 'string' ? { submitRefusal: v.submitRefusal } : {}), ...(v.account ? { account: true } : {}), ...(v.uploadOutside ? { uploadOutside: true } : {}) };
}

// Only the fields of the application form (readApplicationForm).
export const readFormFields = async (client, sessionId) => (await readApplicationForm(client, sessionId)).fields;

// True when the element selector names sits inside the form formSelector names.
export const insideForm = (client, sessionId, formSelector, selector) =>
  evaluate(client, sessionId, `(() => { const f = document.querySelector(${js(formSelector)}); const el = document.querySelector(${js(selector)});
    return Boolean(f && el && f.contains(el)); })()`);

// The button selector names, as submit sees it: { typed, text, inForm, formHasField, only }, or null when it is gone.
// typed is an explicit type=submit; text is its label (controlLabel, as the read saved it); formHasField says whether the
// button's own form holds one of fieldSelectors (null outside any form); only says it is the one control of its form
// passing rule v6 item 1 (passingControls, as at read time) and the form holds no unverifiable control (2d).
export const submitButton = (client, sessionId, selector, fieldSelectors) =>
  evaluate(client, sessionId, `(() => { const b = document.querySelector(${js(selector)}); if (!b) return null;${LABEL_JS}
    const attr = (k) => (typeof b.getAttribute === 'function' ? b.getAttribute(k) : null);
    const f = b.form || (typeof b.closest === 'function' ? b.closest('form') : null);
    const type = String(b.type || '').toLowerCase();
    const typed = (b.tagName === 'BUTTON' && attr('type') !== null && type === 'submit') || (b.tagName === 'INPUT' && type === 'submit');
    const text = controlLabel(b);
    const formHasField = f ? ${js(fieldSelectors)}.some((s) => { const el = document.querySelector(s); return Boolean(el && f.contains(el)); }) : null;
    const passing = f ? passingControls(f) : [];
    const only = Boolean(f) && !unverifiable(f) && passing.length === 1 && passing[0] === b;
    return { typed, text, inForm: Boolean(f), formHasField, only }; })()`);

// Rule v7 F3, before the pending row: re-runs the submit decision (BUTTON_JS decide) on the live form. { ok: true } when
// it picks the element at the saved path with the saved signature, else { refused: 'changed-since-read' }.
export const submitGate = (client, sessionId, formSelector, selector, signature) =>
  evaluate(client, sessionId, `(() => {${BUTTON_JS}
    const gated = gate(${js(formSelector)}, ${js(selector)}, ${js(signature ?? null)});
    return gated ? { refused: gated } : { ok: true }; })()`);

// Rule v6 item 3 and v7 F3, the click itself: resolves the saved button inside the saved form once, re-runs the v7 gate
// and clickProblem on that element and clicks that same element. Returns true when clicked, or { refused } with the
// reason (nothing clicked).
export const checkedClick = (client, sessionId, formSelector, selector, saved, signature) =>
  evaluate(client, sessionId, `(() => {${BUTTON_JS}
    const form = document.querySelector(${js(formSelector)}); const el = form ? document.querySelector(${js(selector)}) : null;
    if (!form || !el || !form.contains(el)) return { refused: 'the button is gone or outside the form' };
    const gated = gate(${js(formSelector)}, ${js(selector)}, ${js(signature ?? null)});
    if (gated) return { refused: gated };
    const problem = clickProblem(el, form, ${js(saved)});
    if (problem) return { refused: problem };
    el.click(); return true; })()`);

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
