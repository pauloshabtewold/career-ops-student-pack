// M-007 fix round 7: the shared application-form qualification rule v3. Signup wording counts on the submit candidate
// only, toggles are never candidates, a bare "Join" is a signup, a form's own talent-community tokens and a footer
// disqualify it even with a file or password field (rules 1-5, N6-2, N6-5); a page with a visible password input and no
// qualifying form stops as a sign-in, not an empty read (rule 6, N6-3); an upload outside the chosen form saves no submit
// (rule 7, N6-1); "submitted X of N" leaves finish-yourself items out of N (N5-4). Fake DOM, fake CDP client and fake
// runner; no browser, network or model call. Fake data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import * as cdp from '../../lib/cdp.mjs';
import * as chrome from '../../scripts/chrome.mjs';
import * as fillPlan from '../../scripts/fill-plan.mjs';
import * as ap from '../../scripts/autopilot.mjs';
import * as atsFields from '../../lib/ats-fields.mjs';
import { addFinishYourself, updateBatch } from '../../lib/batch-file.mjs';
import { appendTsv } from '../../lib/tsv.mjs';
import { LOG_HEADER, row as logRow } from '../helpers/budget-harness.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const TODAY = '2026-11-20';
const GH = 'https://boards.greenhouse.io/examplerobotics/jobs/7601';
const GH2 = 'https://boards.greenhouse.io/examplerobotics/jobs/7602';
const words = (n, w = 'robotics') => Array.from({ length: n }, (_, i) => `${w}${i}`).join(' ');
const POSTING = `Example Robotics hires a Software Engineering Intern. Requirements: Python, SQL, testing. ${words(90)}`;
const FIELDS = [{ selector: '#email', id: 'email', name: 'email', type: 'email', label: 'Email' }];
const noWait = async () => {};

function scratch(config = '') {
  const root = mkdtempSync(join(tmpdir(), 'pack-m007-fix7-'));
  const dataDir = join(root, 'data');
  mkdirSync(dataDir);
  mkdirSync(join(root, 'config'));
  writeFileSync(join(root, 'config', 'student.yml'), `timezone: America/Chicago\nonboarding:\n  complete: true\n${config}`);
  writeFileSync(join(root, 'config', 'profile.yml'), 'candidate:\n  full_name: "Jordan Testwell"\n  email: "jordan.testwell@example.com"\n');
  writeFileSync(join(root, 'cv.md'), '# Jordan Testwell\n\njordan.testwell@example.com\n\n## Experience\n- Software Intern, Example Robotics: built a Python tool\n\n## Skills\nPython, SQL\n');
  return { root, dataDir, paths: { root, dataDir, packRoot: PACK_ROOT }, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const planDeps = (r, extra = {}) => ({
  headless: async () => ({ text: '' }),
  writeCover: async () => {
    const path = join(r.dataDir, 'letter.txt');
    writeFileSync(path, 'Dear hiring team at Example Robotics,\n\nI am applying for the Software Engineering Intern role.\n\nJordan Testwell\n');
    return path;
  },
  buildResume: async (o) => {
    mkdirSync(o.outDir, { recursive: true });
    writeFileSync(join(o.outDir, 'resume.html'), '<html><body>Jordan Testwell</body></html>');
    writeFileSync(join(o.outDir, 'resume.pdf'), '%PDF-1.4\n%%EOF\n');
    return { code: 0, html: join(o.outDir, 'resume.html'), pdf: join(o.outDir, 'resume.pdf') };
  },
  atsCheck: async () => ({ ok: true, problems: [] }),
  ...extra,
});

// A small DOM for the page scripts (as in the fix4 to fix6 tests).
function el(tag, attrs = {}, children = []) {
  const node = { tagName: tag.toUpperCase(), attrs, children, parentElement: null, required: false, placeholder: attrs.placeholder ?? '', autocomplete: '' };
  node.id = attrs.id ?? '';
  node.name = attrs.name ?? '';
  node.type = attrs.type ?? (tag === 'input' ? 'text' : tag === 'button' ? 'submit' : tag);
  node.innerText = attrs.text ?? '';
  node.value = attrs.value ?? '';
  for (const c of children) c.parentElement = node;
  node.getAttribute = (k) => (k in attrs ? attrs[k] : null);
  const matches = (x, sel) => sel.split(',').map((s) => s.trim()).some((s) => {
    const m = /^([a-z]*)(?:#([\w-]+))?(?:\[(\w+)=(?:"([^"]*)"|([\w-]+))\])?$/.exec(s);
    if (!m) return false;
    if (m[1] && x.tagName !== m[1].toUpperCase()) return false;
    if (m[2] && x.attrs.id !== m[2]) return false;
    if (!m[3]) return true;
    const want = m[4] ?? m[5];
    return m[3] === 'type' ? x.type === want : x.attrs[m[3]] === want;
  });
  const all = (x) => x.children.flatMap((c) => [c, ...all(c)]);
  node.querySelectorAll = (sel) => all(node).filter((x) => matches(x, sel));
  node.querySelector = (sel) => node.querySelectorAll(sel)[0] ?? null;
  node.closest = (sel) => {
    for (let x = node; x; x = x.parentElement) if (matches(x, sel)) return x;
    return null;
  };
  node.contains = (other) => {
    for (let x = other; x; x = x.parentElement) if (x === node) return true;
    return false;
  };
  return node;
}
function domCtx(bodyChildren) {
  const html = el('html', {}, [el('body', {}, bodyChildren)]);
  const body = html.children[0];
  const document = { body, querySelectorAll: (s) => body.querySelectorAll(s), querySelector: (s) => body.querySelector(s) };
  return { document, CSS: { escape: (s) => String(s) } };
}
const vmClient = (ctx) => ({ send: async (method, params) => ({ result: { value: method === 'Runtime.evaluate' ? runInNewContext(params.expression, ctx) : undefined } }) });
const input = (id, type = 'text', extra = {}) => el('input', { id, name: id, type, ...extra });
const btn = (id, type, text = '', extra = {}) => el('button', type ? { id, type, text, ...extra } : { id, text, ...extra });
const read = (kids) => cdp.readApplicationForm(vmClient(domCtx(kids)), 'S1');
const ids = (res) => Array.from(res.fields, (f) => f.id);
const none = (res, name) => {
  assert.equal(res.form, null, `${name}: ${JSON.stringify(res)}`);
  assert.equal(res.submit, null, `${name}: no submit is saved`);
  assert.deepEqual(ids(res), [], `${name}: no field is read`);
};
const pick = (res, form, submit, name) => assert.deepEqual([res.form, res.submit], [form, submit], `${name}: ${JSON.stringify(res)}`);

// A fake tab client for chrome.readForm: the form script runs in the fake DOM, the CAPTCHA check sees none.
function domTabClient(ctx) {
  const send = async (method, params = {}) => {
    if (method === 'Target.createTarget') return { targetId: 'T1' };
    if (method === 'Target.attachToTarget') return { sessionId: 'S1' };
    if (method !== 'Runtime.evaluate') return {};
    const e = String(params.expression);
    if (/recaptcha/i.test(e)) return { result: { value: null } };
    if (e.includes("querySelectorAll('input, select, textarea')")) return { result: { value: runInNewContext(e, ctx) } };
    return { result: { value: null } };
  };
  return { send, waitFor: () => Object.assign(Promise.resolve({}), { cancel: () => {} }), close: () => {}, opened: Promise.resolve() };
}

// A fake DevTools WebSocket for the read-form command: it answers the CDP calls readForm makes and runs the form
// script in the fake DOM.
function pageSocket(ctx) {
  return class PageSocket extends EventTarget {
    constructor(url) {
      super();
      this.url = url;
      setTimeout(() => this.dispatchEvent(new Event('open')), 0);
    }

    reply(msg) {
      setTimeout(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(msg) })), 0);
    }

    send(raw) {
      const { id, method, params = {}, sessionId } = JSON.parse(raw);
      let result = {};
      if (method === 'Target.createTarget') result = { targetId: 'T1' };
      else if (method === 'Target.attachToTarget') result = { sessionId: 'S1' };
      else if (method === 'Page.navigate') result = { frameId: 'F1' };
      else if (method === 'Runtime.evaluate') {
        const e = String(params.expression);
        result = { result: { value: e.includes("querySelectorAll('input, select, textarea')") && !/recaptcha/i.test(e) ? runInNewContext(e, ctx) : null } };
      }
      this.reply({ id, result });
      if (method === 'Page.navigate') this.reply({ method: 'Page.loadEventFired', sessionId, params: {} });
    }

    close() {}
  };
}

async function readFormCommand(r, ctx, url) {
  chrome.writeState(r.dataDir, { pid: process.pid, port: 9555 });
  const lines = [];
  const deps = {
    isAlive: () => true,
    fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ Browser: 'Chrome/fake', webSocketDebuggerUrl: 'ws://127.0.0.1:9555/devtools/browser/fake' }) }),
    WebSocketImpl: pageSocket(ctx),
  };
  const code = await chrome.HANDLERS['read-form']({ dataDir: r.dataDir, paths: r.paths, flags: { url }, deps, say: (l) => lines.push(l) });
  return { code, lines };
}

// M-007-fix7-KEEP
test('M-007-fix7-KEEP real application forms still qualify with the right submit (rule v3 KEEP list)', async () => {
  pick(await read([el('main', {}, [el('div', { 'aria-label': 'Apply for Marketing Manager' }, [el('form', { id: 'application-form' }, [input('first_name'), input('last_name'), input('email', 'email'), el('select', { id: 'country' }), input('phone', 'tel'), input('resume', 'file'), btn('attach', 'button', 'Attach'), btn('gh_submit', 'submit', 'Submit application')])])])]), '#application-form', '#gh_submit', 'Greenhouse new board');
  pick(await read([el('form', { id: 'application-form' }, [input('resume-upload-input', 'file', { name: 'resume' }), input('n', 'text', { name: 'name' }), input('e', 'email', { name: 'email' }), btn('li', 'button', 'Apply with LinkedIn'), btn('btn-submit', 'button', 'Submit application')])]), '#application-form', '#btn-submit', 'Lever /apply');
  pick(await read([el('main', {}, [el('form', { id: 'ashby_application' }, [input('_systemfield_name'), input('_systemfield_email', 'email'), input('_systemfield_resume', 'file'), btn('up', 'button', 'Upload File'), btn('ashby_submit', 'submit', 'Submit Application')])])]), '#ashby_application', '#ashby_submit', 'Ashby /application');
  const workday = await read([el('div', { 'data-automation-id': 'applyFlowPage' }, [input('wd_first', 'text', { 'aria-label': 'First Name' }), input('wd_email', 'email'), btn('wd_next', 'button', 'Save and Continue')])]);
  assert.deepEqual(ids(workday), ['wd_first', 'wd_email'], 'Workday-like div app: its fields are read');
  assert.equal(workday.submit, null, 'Workday-like div app: no form, no saved submit');
  pick(await read([
    el('header', {}, [el('form', { id: 'site_search', role: 'search' }, [input('q', 'search'), btn('sgo', 'submit', 'Search')])]),
    el('main', {}, [el('div', { id: 'grnhse_app', 'data-gh-jid': '7601' }, [el('form', { id: 'application_form' }, [input('first_name'), input('email', 'email'), input('resume', 'file'), btn('submit_app', 'submit', 'Submit Application')])])]),
    el('section', {}, [el('form', { id: 'tc' }, [input('full_name'), input('tc_email', 'email'), btn('join', undefined, 'Join our talent community')])]),
    el('footer', {}, [el('form', { id: 'nl' }, [input('nl_email', 'email'), btn('nlgo', 'submit', 'Subscribe')])]),
  ]), '#application_form', '#submit_app', 'embedded gh_jid page');
  pick(await read([el('form', { id: 'a1' }, [input('full_name'), input('a_email', 'email'), input('cv', 'file'), btn('go', undefined, 'Apply')])]), '#a1', '#go', 'Apply button');
  pick(await read([el('form', { id: 'a3' }, [input('first_name'), input('a_email', 'email'), el('input', { id: 'go', type: 'submit', value: 'Submit application' })])]), '#a3', '#go', 'Submit application input');
  pick(await read([el('form', { id: 'aspnetForm' }, [
    el('main', {}, [input('first_name'), input('a_email', 'email'), input('cv', 'file'), el('input', { id: 'btnSubmit', type: 'submit', value: 'Submit application' })]),
    el('footer', {}, [input('nl_email2', 'email'), el('input', { id: 'nl', type: 'submit', value: 'Subscribe' })]),
  ])]), '#aspnetForm', '#btnSubmit', 'page-wrapping server form with a footer Subscribe after the real submit');
  pick(await read([el('main', {}, [el('form', { id: 'app' }, [input('full_name'), input('a_email', 'email'), input('cv', 'file'), btn('tc', 'button', '', { role: 'switch', 'aria-label': 'Join our talent community' }), btn('go', 'submit', 'Submit application')])])]), '#app', '#go', 'role=switch talent-community toggle');
  pick(await read([el('main', {}, [el('form', { id: 'app' }, [input('full_name'), input('a_email', 'email'), input('cv', 'file'), btn('alerts', 'button', 'Get job alerts'), btn('go', 'submit', 'Submit application')])])]), '#app', '#go', 'optional in-form Get job alerts button beside the real submit');
  pick(await read([el('main', {}, [el('form', { id: 'app' }, [input('full_name'), input('a_email', 'email'), input('cv', 'file'), btn('go', 'submit', 'Join our team')])])]), '#app', null, 'Join our team (qualifies; rule v5 item 1a saves no submit)');
});

// M-007-fix7-REJECT
test('M-007-fix7-REJECT signup, talent-community and footer forms never qualify, even with a file or password field (rule v3 REJECT list)', async () => {
  const shapes = {
    'talent community, resume file, Join': [el('main', {}, [el('form', { id: 'tc' }, [input('full_name'), input('tc_email', 'email'), input('tc_resume', 'file'), btn('join', 'submit', 'Join')])])],
    'resume file, Join now': [el('main', {}, [el('form', { id: 'f1' }, [input('full_name'), input('f_email', 'email'), input('cv', 'file'), btn('join', 'submit', 'Join now')])])],
    'resume file, Join us (input value)': [el('main', {}, [el('form', { id: 'f2' }, [input('full_name'), input('f_email', 'email'), input('cv', 'file'), el('input', { id: 'join', type: 'submit', value: 'Join us' })])])],
    'class talentCommunityForm, resume file, Submit': [el('main', {}, [el('form', { id: 'f3', class: 'talentCommunityForm' }, [input('full_name'), input('f_email', 'email'), input('cv', 'file'), btn('go', 'submit', 'Submit')])])],
    'id talent-networks, resume file, Submit': [el('main', {}, [el('form', { id: 'talent-networks' }, [input('full_name'), input('f_email', 'email'), input('cv', 'file'), btn('go', 'submit', 'Submit')])])],
    'name talentcommunities, password, Continue': [el('main', {}, [el('form', { id: 'f4', name: 'talentcommunities' }, [input('f_email', 'email'), input('pw', 'password'), btn('go', 'submit', 'Continue')])])],
    'role=contentinfo, file input, Send': [el('div', { role: 'contentinfo' }, [el('form', { id: 'ci' }, [input('first_name'), input('ci_email', 'email'), input('ci_cv', 'file'), btn('go', 'submit', 'Send')])])],
    '<footer>, file input, Submit': [el('footer', {}, [el('div', {}, [el('form', { id: 'ft' }, [input('first_name'), input('ft_email', 'email'), input('ft_cv', 'file'), btn('go', 'submit', 'Submit')])])])],
    'Create a job alert': [el('main', {}, [el('form', { id: 'ca' }, [input('full_name'), input('ca_email', 'email'), btn('go', 'submit', 'Create a job alert')])])],
    'Create alerts': [el('main', {}, [el('form', { id: 'ca' }, [input('full_name'), input('ca_email', 'email'), btn('go', 'submit', 'Create alerts')])])],
    'Create an alert': [el('main', {}, [el('form', { id: 'ca' }, [input('full_name'), input('ca_email', 'email'), btn('go', 'submit', 'Create an alert')])])],
    'talent-communities wrapper, 2 identity fields': [el('div', { class: 'talent-communities' }, [el('form', { id: 'w' }, [input('full_name'), input('w_email', 'email'), btn('go', 'submit', 'Submit')])])],
    'Create alert': [el('main', {}, [el('form', { id: 'v2a' }, [input('first_name'), input('a_email', 'email'), btn('go', 'submit', 'Create alert')])])],
    'Get notified': [el('main', {}, [el('form', { id: 'v2b' }, [input('full_name'), input('b_email', 'email'), btn('go', 'submit', 'Get notified')])])],
    'Contact sales': [el('main', {}, [el('form', { id: 'v2c' }, [input('full_name'), input('c_email', 'email'), input('c_phone', 'tel'), btn('go', 'submit', 'Contact sales')])])],
    'password + Subscribe in a <footer>': [el('footer', {}, [el('form', { id: 'v2d' }, [input('d_email', 'email'), input('pw', 'password'), btn('go', 'submit', 'Subscribe')])])],
    'no candidate: the only button is a type=button Join our talent community': [el('main', {}, [el('form', { id: 'nc' }, [input('full_name'), input('n_email', 'email'), input('cv', 'file'), btn('go', 'button', 'Join our talent community')])])],
  };
  for (const [name, kids] of Object.entries(shapes)) {
    const res = await read(kids);
    none(res, name);
    if (!/password/.test(name)) assert.equal(res.account, undefined, `${name}: no sign-in stop`);
  }
  const subscribe = await read([el('main', {}, [el('form', { id: 'v2e' }, [input('e_email', 'email'), input('pw', 'password'), btn('go', 'submit', 'Subscribe')])])]);
  assert.equal(subscribe.form, null, `password + Subscribe never qualifies: ${JSON.stringify(subscribe)}`);
  assert.equal(subscribe.submit, null);
});

// M-007-fix7-STOP
test('M-007-fix7-STOP a visible password input with no qualifying form is the sign-in stop; no password stays the empty read (rule 6)', async () => {
  const signUp = () => domCtx([el('main', {}, [el('form', { id: 'acct' }, [input('a_email', 'email'), input('pw', 'password'), btn('su', 'submit', 'Sign up')])])]);
  const raw = await cdp.readApplicationForm(vmClient(signUp()), 'S1');
  assert.deepEqual(ids(raw), [], 'no field of the signup form is read');
  assert.equal(raw.account, true);
  assert.deepEqual(await chrome.readForm(domTabClient(signUp()), GH, { jobText: false, wait: noWait }), { stop: 'password' });
  const signIn = domCtx([el('main', {}, [el('form', { id: 'login' }, [input('l_email', 'email'), input('pw', 'password'), btn('si', 'submit', 'Sign in'), btn('su', 'button', 'New here? Sign up')])])]);
  assert.deepEqual(await chrome.readForm(domTabClient(signIn), GH, { jobText: false, wait: noWait }), { stop: 'password' }, 'a sign-in form with a secondary Sign up button');
  const noForm = domCtx([el('div', {}, [input('wd_email', 'email'), input('wd_pw', 'password'), btn('wd_create', 'button', 'Create Account')])]);
  assert.deepEqual(await chrome.readForm(domTabClient(noForm), GH, { jobText: false, wait: noWait }), { stop: 'password' }, 'an account wall with no form');
  const phone = domCtx([el('main', {}, [el('form', { id: 'sms' }, [input('em', 'email'), input('mob', 'tel'), btn('su', 'submit', 'Sign up')])])]);
  assert.deepEqual(await chrome.readForm(domTabClient(phone), GH, { jobText: false, wait: noWait }), { stop: 'empty' }, 'email + phone + Sign up with no password');
  const header = domCtx([el('header', {}, [el('form', { id: 'hl' }, [input('h_email', 'email'), input('h_pw', 'password'), btn('hgo', 'submit', 'Sign up')])]), el('div', { id: 'grnhse_app' }, [])]);
  assert.deepEqual(await chrome.readForm(domTabClient(header), GH, { jobText: false, wait: noWait }), { stop: 'empty' }, 'a header sign-up form is not the stop');
  const footer = domCtx([el('div', { role: 'contentinfo' }, [el('form', { id: 'fl' }, [input('f_email', 'email'), input('f_pw', 'password'), btn('fgo', 'submit', 'Subscribe')])])]);
  assert.deepEqual(await chrome.readForm(domTabClient(footer), GH, { jobText: false, wait: noWait }), { stop: 'empty' }, 'a contentinfo password form is not the stop');
  const hidden = domCtx([el('main', {}, [el('form', { id: 'acct' }, [input('a_email', 'email'), input('pw', 'password', { hidden: '' }), btn('su', 'submit', 'Sign up')])])]);
  assert.deepEqual(await chrome.readForm(domTabClient(hidden), GH, { jobText: false, wait: noWait }), { stop: 'empty' }, 'a hidden password input is not the stop');
});

// M-007-fix7-STOP-cmd
test('M-007-fix7-STOP-cmd read-form on a Sign up account page exits 5 with the account line and does not count an empty read', async () => {
  const r = scratch();
  try {
    const ctx = domCtx([el('main', {}, [el('form', { id: 'acct' }, [input('a_email', 'email'), input('pw', 'password'), btn('su', 'submit', 'Sign up')])])]);
    const { code, lines } = await readFormCommand(r, ctx, GH);
    const text = lines.join('\n');
    assert.equal(code, chrome.EXIT.needsUser, text);
    assert.match(text, /blocked-on-user: .*asks for a password \(a sign-in or a new account\); signing in and creating the account stay with you, nothing was typed or saved/, text);
    assert.match(text, /Next step: .*then type: apply/, text);
    assert.equal(atsFields.emptyReads(join(r.dataDir, atsFields.FIELDS_DIR), GH), 0, 'not counted as an empty read');
    assert.equal(atsFields.formGaveUp(join(r.dataDir, atsFields.FIELDS_DIR), GH), false);
  } finally {
    r.cleanup();
  }
});

// M-007-fix7-UPLOAD
test('M-007-fix7-UPLOAD an upload outside the chosen form saves no submit (rule 7, classic Greenhouse)', async () => {
  const appForm = () => el('form', { id: 'application_form' }, [input('first_name'), input('last_name'), input('email', 'email'), input('phone', 'tel'), el('input', { id: 'submit_app', type: 'button', value: 'Submit Application' })]);
  const classic = await read([
    el('form', { id: 's3_upload_for_resume' }, [input('key', 'hidden'), input('file', 'file')]),
    el('form', { id: 's3_upload_for_cover_letter' }, [input('key2', 'hidden'), input('file2', 'file')]),
    appForm(),
  ]);
  assert.equal(classic.form, '#application_form', JSON.stringify(classic));
  assert.deepEqual(ids(classic), ['first_name', 'last_name', 'email', 'phone']);
  assert.equal(classic.submit, null, 'classic Greenhouse: the resume upload is outside the form read');
  const loose = await read([el('div', {}, [input('loose_cv', 'file')]), appForm()]);
  assert.equal(loose.submit, null, 'a file input outside any form also counts');
  const headerOnly = await read([el('header', {}, [el('form', { id: 'avatar' }, [input('pic', 'file')])]), appForm()]);
  assert.equal(headerOnly.submit, '#submit_app', 'a file input in the header is not the application upload');
});

// The approved batch of ready items at links, built by fill-plan with saved fields and job text.
async function approvedBatch(r, links) {
  const rows = links.map((url) => ({ url, company: 'Example Robotics', title: 'Software Engineering Intern', score: 41, triage: 3.8, jobText: POSTING }));
  const made = await fillPlan.fillPlans({ paths: r.paths, rows, today: TODAY, deps: planDeps(r, { fieldsFor: () => FIELDS }), say: () => {} });
  const id = made.ids[0];
  const items = links.map((_, i) => i + 1);
  await appendTsv(join(r.dataDir, 'action-log.tsv'), LOG_HEADER, [logRow({ ts: `${TODAY}T18:00:00.000Z`, action: 'batch.approve', approval: 'approve all', detail: `batch=${id};items=${items.join(',')}` })]);
  updateBatch(r.dataDir, id, (b) => ({ ...b, approved: { items, words: 'approve all' } }));
  return id;
}

// M-007-fix7-N5-4
test('M-007-fix7-N5-4 "submitted X of N" leaves finish-yourself items out of N', async () => {
  const r = scratch('chrome_in_schedule: yes\ndaily_target: 5\nscore_floor: 3.0\n');
  try {
    const id = await approvedBatch(r, [GH, GH2]);
    addFinishYourself(r.dataDir, id, { company: 'Example Robotics', role: 'Software Engineering Intern', link: GH, reason: 'no safe submit button in the form read', added: '2026-11-18' });
    addFinishYourself(r.dataDir, id, { company: 'Example Robotics', role: 'Software Engineering Intern', link: GH2, reason: 'CAPTCHA on submit', added: '2026-11-19' });
    const runner = (cmd, args) => (basename(String(args[0])) === 'rank-queue.mjs' ? '[]' : '');
    const res = await ap.autopilot({ paths: r.paths, today: TODAY, deps: { runner, chromeOpen: () => true, out: () => {} } });
    const text = res.lines.join('\n');
    assert.ok(res.lines.some((l) => l.includes('submitted 0 of 0 approved item(s)')), text);
  } finally {
    r.cleanup();
  }
});
