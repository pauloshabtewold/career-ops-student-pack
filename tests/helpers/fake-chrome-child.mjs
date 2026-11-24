// SYNTHETIC FIXTURE: runs the real scripts/chrome.mjs main (fill or submit) as a child process against a fake Chrome, so
// the autopilot's submit step can be tested with the real fill and submit code and the real budget.mjs check. The fake
// page is a JSON file named by FAKE_PAGE: { url, present: { selector: { required, type } }, values, targets, submitButton,
// clicked }. Each page script chrome.mjs evaluates is answered from that file; no browser, network or model is reached.
// Usage: FAKE_PAGE=<file> node fake-chrome-child.mjs <chrome.mjs args>
import { readFileSync, writeFileSync } from 'node:fs';
import { main } from '../../scripts/chrome.mjs';

const pageFile = process.env.FAKE_PAGE;
const SUBMIT = '#submit';
const load = () => JSON.parse(readFileSync(pageFile, 'utf8'));
const save = (s) => writeFileSync(pageFile, JSON.stringify(s));
const selectorOf = (expr) => {
  const m = /document\.querySelector\(("(?:[^"\\]|\\.)*")\)/.exec(expr);
  return m ? JSON.parse(m[1]) : null;
};

function evaluatePage(expr) {
  const s = load();
  const sel = selectorOf(expr);
  if (expr === 'location.href') return s.url;
  if (expr.includes("state: 'invalid'")) {
    const empty = Object.entries(s.present).filter(([k, v]) => v.required && !s.values[k]).map(([k]) => k);
    return empty.length ? { state: 'invalid', detail: empty.join('; ') } : { state: 'confirmed', detail: 'confirmation text' };
  }
  if (expr.includes('return signs; })()')) return { confirm: 0, signin: 0, password: 0 };
  // The saved form #application_form holds the typed submit #submit and the filled fields.
  if (expr.includes('f.contains(el)') && expr.includes('#application_form')) return s.submitButton && sel === '#application_form';
  if (expr.includes('formHasField')) return s.submitButton && sel === SUBMIT ? { typed: true, text: 'Submit application', inForm: true, formHasField: true, only: true } : null;
  if (expr.includes("'captcha frame'")) return null;
  if (expr.includes('getOwnPropertyDescriptor')) {
    if (!s.present[sel]) return false;
    s.values[sel] = JSON.parse(/\.set\.call\(el, ("(?:[^"\\]|\\.)*")\)/.exec(expr)[1]);
    save(s);
    return true;
  }
  if (expr.includes('el.files')) return s.present[sel] ? (s.values[sel] ?? '') : null;
  if (expr.includes('autocomplete: (el.autocomplete')) {
    if (sel === SUBMIT) return s.submitButton ? { tag: 'button', type: 'submit', autocomplete: '' } : null;
    return s.present[sel] ? { tag: 'input', type: s.present[sel].type ?? 'text', autocomplete: '' } : null;
  }
  if (expr.includes('el.click(); return true;') && !expr.includes('el.checked')) {
    s.clicked = (s.clicked ?? 0) + 1;
    save(s);
    return true;
  }
  return null;
}

// A WebSocket stand-in that answers each CDP command from the fake page file.
class FakeSocket {
  constructor() {
    this.listeners = { open: [], message: [], close: [], error: [] };
    setTimeout(() => this.listeners.open.forEach((f) => f({})), 0);
  }

  addEventListener(event, fn) {
    this.listeners[event]?.push(fn);
  }

  close() {}

  send(raw) {
    const { id, method, params } = JSON.parse(raw);
    const s = load();
    let result = {};
    if (method === 'Target.getTargets') result = { targetInfos: (s.targets ?? []).map((t) => ({ ...t, type: 'page' })) };
    else if (method === 'Target.createTarget') {
      s.targets = [...(s.targets ?? []), { targetId: 't1', url: s.url }];
      save(s);
      result = { targetId: 't1' };
    } else if (method === 'Target.attachToTarget') result = { sessionId: 's1' };
    else if (method === 'Runtime.evaluate') result = { result: { value: evaluatePage(params.expression) } };
    else if (method === 'DOM.getDocument') result = { root: { nodeId: 1 } };
    else if (method === 'DOM.querySelector') result = { nodeId: s.present[params.selector] ? 2 : 0 };
    else if (method === 'DOM.setFileInputFiles') {
      const key = Object.keys(s.present).find((k) => s.present[k].type === 'file');
      s.values[key] = params.files;
      save(s);
    }
    setTimeout(() => this.listeners.message.forEach((f) => f({ data: JSON.stringify({ id, result }) })), 0);
  }
}

const deps = {
  isAlive: () => true,
  fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ Browser: 'Fake', webSocketDebuggerUrl: 'ws://127.0.0.1:9/devtools/browser/fake' }) }),
  WebSocketImpl: FakeSocket,
  wait: async () => {},
};
process.exitCode = (await main(process.argv.slice(2), deps)) ?? 0;
