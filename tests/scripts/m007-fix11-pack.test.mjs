// M-007 fix round 11, submit-pick rule v6: a control is a submit only when every part of its label IS an application
// submit (item 1), a form with no resume field needs a label that names the application (item 1c), the saved label is
// cut to 80 characters and trimmed again at both ends (item 1b), and the submit is saved only when it is the one and
// only passing control of the form and the pick (item 2). At click time the same check, uniqueness included, runs on
// the live element before apply.pending and again on the element that is clicked (item 3). Null cases never reach a
// batch: submit null, finish these yourself with the link, 0 clicks, 0 budget calls. Fake DOM, fake CDP client and fake
// runner through the real read path, fill-plan and clickSubmit; no browser, network or model call. Fake data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import * as cdp from '../../lib/cdp.mjs';
import * as chrome from '../../scripts/chrome.mjs';
import * as fillPlan from '../../scripts/fill-plan.mjs';
import { readFormDoc, FIELDS_DIR } from '../../lib/ats-fields.mjs';
import { planFinishReason } from '../../lib/kept-out.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const TODAY = '2026-11-24';
const GH = 'https://boards.greenhouse.io/examplerobotics/jobs/8101';
const words = (n, w = 'robotics') => Array.from({ length: n }, (_, i) => `${w}${i}`).join(' ');
const POSTING = `Example Robotics hires a Software Engineering Intern. Requirements: Python, SQL, testing. ${words(90)}`;
const CHANGED = 'the submit button changed since the form was read; read the form again';

function scratch() {
  const root = mkdtempSync(join(tmpdir(), 'pack-m007-fix11-'));
  const dataDir = join(root, 'data');
  mkdirSync(dataDir);
  mkdirSync(join(root, 'config'));
  writeFileSync(join(root, 'config', 'student.yml'), 'timezone: America/Chicago\nonboarding:\n  complete: true\n');
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

// A small DOM for the page scripts (as in the fix10 tests), with clicks recorded and textContent when a test sets it.
const clicks = [];
function el(tag, attrs = {}, children = []) {
  const node = { tagName: tag.toUpperCase(), attrs, children, parentElement: null, required: false, placeholder: attrs.placeholder ?? '', autocomplete: '' };
  node.id = attrs.id ?? '';
  node.name = attrs.name ?? '';
  node.type = attrs.type ?? (tag === 'input' ? 'text' : tag === 'button' ? 'submit' : tag === 'select' ? 'select-one' : tag);
  node.innerText = attrs.text ?? '';
  if ('textContent' in attrs) node.textContent = attrs.textContent;
  node.value = attrs.value ?? '';
  for (const c of children) c.parentElement = node;
  node.getAttribute = (k) => (k in node.attrs && !['text', 'textContent'].includes(k) ? node.attrs[k] : null);
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
  node.querySelector = (sel) => (sel.includes('>') ? pathQuery(node, sel) : node.querySelectorAll(sel)[0] ?? null);
  node.closest = (sel) => {
    for (let x = node; x; x = x.parentElement) if (matches(x, sel)) return x;
    return null;
  };
  node.contains = (other) => {
    for (let x = other; x; x = x.parentElement) if (x === node) return true;
    return false;
  };
  node.click = () => clicks.push(node.id || `${node.tagName.toLowerCase()}:${node.attrs['aria-label'] ?? node.innerText}`);
  Object.defineProperty(node, 'form', { get() { return node.tagName === 'FORM' ? null : node.closest('form'); } });
  return node;
}
// The selector paths BUTTON_JS pathOf writes: '#id > tag:nth-of-type(n) > ...' or 'body > ...'.
function pathQuery(root, sel) {
  const [first, ...rest] = sel.split('>').map((s) => s.trim());
  let cur = first === 'body' ? (root.tagName === 'BODY' ? root : root.querySelector('body')) : root.querySelector(first);
  for (const part of rest) {
    if (!cur) return null;
    const m = /^([a-z]+):nth-of-type\((\d+)\)$/.exec(part);
    cur = m ? cur.children.filter((c) => c.tagName === m[1].toUpperCase())[Number(m[2]) - 1] ?? null : null;
  }
  return cur;
}
function domCtx(kids) {
  const html = el('html', {}, [el('body', {}, kids)]);
  const body = html.children[0];
  body.innerText = 'Example careers';
  return {
    body,
    document: { body, title: 'Example', querySelectorAll: (s) => body.querySelectorAll(s), querySelector: (s) => (s.includes('>') ? pathQuery(body, s) : body.querySelector(s)), getElementById: (i) => body.querySelector(`#${i}`) },
    CSS: { escape: (s) => String(s) },
    location: { href: GH },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
  };
}
// A fake CDP client over ctx.cur (so a test can swap the page mid-run).
const vmClient = (holder) => ({ send: async (method, params) => {
  if (method === 'Target.getTargets') return { targetInfos: [{ targetId: 'T1', type: 'page', url: GH }] };
  if (method === 'Target.attachToTarget') return { sessionId: 'S1' };
  if (method === 'Page.captureScreenshot') return { data: '' };
  if (method !== 'Runtime.evaluate') return {};
  let value;
  try {
    value = runInNewContext(params.expression, holder.cur);
  } catch {
    value = null;
  }
  return { result: { value } };
} });
const inp = (id, type = 'text', extra = {}) => el('input', { id, name: id, type, ...extra });
const btn = (id, type, text = '', extra = {}) => el('button', { ...(id ? { id } : {}), ...(type ? { type } : {}), text, ...extra });
const body = () => [inp('first_name'), inp('a_email', 'email'), inp('cv', 'file')];
const iframeApp = () => el('div', { id: 'grnhse_app' }, [el('iframe', { id: 'grnhse_iframe' })]);
const read = (kids) => cdp.readApplicationForm(vmClient({ cur: domCtx(kids) }), 'S1');
const ids = (res) => Array.from(res.fields, (f) => f.id);
const show = (res) => JSON.stringify({ fields: ids(res), form: res.form, submit: res.submit, submitText: res.submitText });

// The plan fill-plan builds from a saved read (readFormDoc), the way scripts/fill-plan.mjs carries it.
function savedPlan(dir, res) {
  chrome.saveFormFields(dir, GH, res.fields, res);
  const doc = readFormDoc(join(dir, FIELDS_DIR), GH);
  return {
    formSelector: doc.form ?? null, submitSelector: doc.submit ?? null, ...(typeof doc.submitText === 'string' ? { submitText: doc.submitText } : {}),
    fields: doc.fields.map((f) => ({ selector: f.selector, type: f.type, value: 'x' })),
  };
}

// Read on kids, then the real clickSubmit on the same DOM (or drift(ctx)'s DOM) with a budget-runner spy. onPending(ctx)
// changes the page right after the apply.pending row is logged (between the check and the click).
async function readAndClick(kids, { drift, onPending } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pack-m007-fix11-click-'));
  try {
    const holder = { cur: domCtx(kids) };
    const res = await cdp.readApplicationForm(vmClient(holder), 'S1');
    const plan = { batchId: 'b1', item: 1, url: GH, link: GH, company: 'Example Robotics', role: 'Intern', score: 4, ...savedPlan(dir, res), tab: { targetId: 'T1', url: GH, sentinel: null }, planFile: join(dir, '1.json') };
    if (drift) holder.cur = drift(holder.cur);
    clicks.length = 0;
    const budget = [];
    const runner = (cmd, args) => {
      budget.push(args.slice(1, 3).join(' '));
      if (onPending && args[2] === 'apply.pending') holder.cur = onPending(holder.cur);
      return { code: 0, stdout: '', stderr: '' };
    };
    const clicked = await chrome.clickSubmit(vmClient(holder), { plan, paths: { packRoot: PACK_ROOT, root: dir, dataDir: dir }, item: 1, runner, wait: async () => {} });
    return { res, plan, clicked, clicks: [...clicks], budget };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Each null shape: submit null, the real clickSubmit refuses with no-button (0 clicks, 0 budget calls), and fill-plan
// puts every shape with fields on finish these yourself with its link, never on a batch.
async function assertNull(shapes) {
  const reads = {};
  for (const [name, kids] of Object.entries(shapes)) {
    const out = await readAndClick(kids);
    assert.equal(out.res.submit ?? null, null, `${name}: no submit is saved: ${show(out.res)}`);
    assert.equal(out.clicked.state, 'no-button', `${name}: ${JSON.stringify(out.clicked)}`);
    assert.deepEqual([out.clicks, out.budget], [[], []], `${name}: 0 clicks, 0 budget calls`);
    reads[name] = out.res;
  }
  const r = scratch();
  try {
    const names = Object.keys(reads).filter((n) => reads[n].fields.length);
    const urlOf = (i) => `${GH}${i}`;
    const rows = names.map((n, i) => ({ url: urlOf(i), company: 'Example Robotics', title: 'Intern', score: 41, triage: 3.8, jobText: POSTING }));
    const byUrl = new Map(names.map((n, i) => [urlOf(i), reads[n]]));
    const lines = [];
    const made = await fillPlan.fillPlans({ paths: r.paths, rows, today: TODAY, deps: planDeps(r, { fieldsFor: (row) => byUrl.get(row.url) }), say: (l) => lines.push(String(l)) });
    assert.deepEqual(made.ids, [], `never batch-ready, so no approval is asked: ${lines.join('\n')}`);
    names.forEach((n, i) => assert.ok(lines.some((l) => l.includes(urlOf(i)) && l.includes('finish these yourself')), `${n}: finish line with the link: ${lines.join('\n')}`));
  } finally {
    r.cleanup();
  }
}

// M-007-fix11-M06
test('M-007-fix11-M06 a label that holds an application word but is not an application submit, or a second passing control, saves no submit', async () => {
  await assertNull({
    'E1 body typed Submit code + footer typed Submit application': [el('form', { id: 'e1' }, [...body(), inp('e1_code'), btn('e1_vc', 'submit', 'Submit code'), el('footer', {}, [el('select', { id: 'e1_hear' }), btn('e1_go', 'submit', 'Submit application')])])],
    'E1b body typeless Submit code + footer typeless Submit application': [el('form', { id: 'e1b' }, [...body(), inp('e1b_code'), btn('e1b_vc', undefined, 'Submit code'), el('footer', {}, [btn('e1b_go', undefined, 'Submit application')])])],
    'E1c body typed Submit referral code before typed Submit application': [el('form', { id: 'e1c' }, [...body(), inp('e1c_ref'), btn('e1c_rc', 'submit', 'Submit referral code'), btn('e1c_go', 'submit', 'Submit application')])],
    'E2 typed Finish later before typed Next': [el('form', { id: 'e2' }, [...body(), btn('e2_fl', 'submit', 'Finish later'), btn('e2_nx', 'submit', 'Next')])],
    'E2b typed Complete later before typed Continue': [el('form', { id: 'e2b' }, [...body(), btn('e2b_cl', 'submit', 'Complete later'), btn('e2b_go', 'submit', 'Continue')])],
    'E3 typed Send code before typed Next': [el('form', { id: 'e3' }, [...body(), btn('e3_sc', 'submit', 'Send code'), btn('e3_nx', 'submit', 'Next')])],
    'E3b typed Send me a copy beside a typeless Review': [el('form', { id: 'e3b' }, [...body(), btn('e3b_cp', 'submit', 'Send me a copy'), btn('e3b_rv', undefined, 'Review')])],
    'E4 page-wrapping form: aside newsletter typed input Submit before typed Submit application': [el('form', { id: 'aspnetForm' }, [el('aside', {}, [inp('e4_nl', 'email'), el('input', { id: 'e4_nlgo', type: 'submit', value: 'Submit' })]), el('main', {}, [...body(), btn('e4_go', 'submit', 'Submit application')])])],
    'filter Apply beside Submit application': [el('form', { id: 'fa' }, [...body(), btn('fa_f', 'button', 'Apply'), btn('fa_go', 'submit', 'Submit application')])],
    'header Apply now + body Submit application': [el('form', { id: 'ha' }, [el('header', {}, [btn('ha_ap', 'submit', 'Apply now')]), ...body(), btn('ha_go', undefined, 'Submit application')])],
    'typed Save draft before typed Submit application': [el('form', { id: 'sd' }, [...body(), btn('sd_s', 'submit', 'Save draft'), btn('sd_go', 'submit', 'Submit application')])],
    'Apply for this job': [el('form', { id: 'aj' }, [...body(), btn('aj_go', 'submit', 'Apply for this job')])],
  });
});

// M-007-fix11-2c
test('M-007-fix11-2c a one-word widget is not saved when another control of the form is a step, looks like the real submit, or is a later forward action', async () => {
  await assertNull({
    'V1 OTP: phone + typed Send + code + typed Next': [el('form', { id: 'v1' }, [...body(), inp('v1_phone', 'tel'), btn('v1_send', 'submit', 'Send'), inp('v1_code'), btn('v1_next', 'submit', 'Next')])],
    'V2 page-wrapping form: aside newsletter input Submit before input Next': [el('form', { id: 'v2' }, [el('aside', {}, [inp('v2_nl', 'email'), el('input', { id: 'v2_nlgo', type: 'submit', value: 'Submit' })]), el('main', {}, [...body(), el('input', { id: 'v2_next', type: 'submit', value: 'Next' })])])],
    'V3 page-wrapping form: aside newsletter input Submit before input Apply for this job': [el('form', { id: 'v3' }, [el('aside', {}, [inp('v3_nl', 'email'), el('input', { id: 'v3_nlgo', type: 'submit', value: 'Submit' })]), el('main', {}, [...body(), el('input', { id: 'v3_go', type: 'submit', value: 'Apply for this job' })])])],
    'V4 typed Apply (promo code) before typed Submit for review': [el('form', { id: 'v4' }, [...body(), inp('v4_promo'), btn('v4_ap', 'submit', 'Apply'), btn('v4_go', 'submit', 'Submit for review')])],
    'V5 typed Submit (email verify) before typed Save and continue': [el('form', { id: 'v5' }, [...body(), btn('v5_sub', 'submit', 'Submit'), btn('v5_go', 'submit', 'Save and continue')])],
    'V6 typed Send + typeless Next': [el('form', { id: 'v6' }, [...body(), btn('v6_send', 'submit', 'Send'), btn('v6_next', undefined, 'Next')])],
    'V12 typed Send + a role=button Next': [el('form', { id: 'v12' }, [...body(), btn('v12_send', 'submit', 'Send'), el('a', { id: 'v12_next', role: 'button', text: 'Next' })])],
    'V13 typeless Send then typeless Next': [el('form', { id: 'v13' }, [...body(), btn('v13_send', undefined, 'Send'), btn('v13_next', undefined, 'Next')])],
    'V14 typed Submit + type=button Continue': [el('form', { id: 'v14' }, [...body(), btn('v14_sub', 'submit', 'Submit'), btn('v14_go', 'button', 'Continue')])],
    'Submit for review next to Submit': [el('form', { id: 'sr' }, [...body(), btn('sr_go', 'submit', 'Submit'), btn('sr_rv', 'button', 'Submit for review')])],
  });
  // Secondary actions after the pick keep it: Save draft, Back, Cancel, a link-style or helper control, a toggle.
  const kept = await read([el('form', { id: 'ok' }, [...body(), btn('ok_go', 'submit', 'Submit application'), btn('ok_sd', 'button', 'Save draft'), btn('ok_bk', 'button', 'Go back'), btn('ok_li', 'button', 'Apply with LinkedIn'), btn('ok_tg', 'button', 'Remote', { role: 'switch' })])]);
  assert.equal(kept.submit, '#ok_go', show(kept));
});

// M-007-fix11-N10-2
test('M-007-fix11-N10-2 an Email this job, Refer a friend or contact form beside an iframe app saves no submit with Send or Submit', async () => {
  await assertNull({
    'F1 email-job form, typed Send': [iframeApp(), el('aside', {}, [el('form', { id: 'email-job' }, [inp('full_name'), inp('email', 'email'), btn('send', 'submit', 'Send')])])],
    'F2 email-job form, typed Send to a friend': [iframeApp(), el('aside', {}, [el('form', { id: 'email-job' }, [inp('full_name'), inp('email', 'email'), btn('send', 'submit', 'Send to a friend')])])],
    'F3 refer form, typed Send referral': [iframeApp(), el('aside', {}, [el('form', { id: 'refer' }, [inp('full_name'), inp('email', 'email'), btn('send', 'submit', 'Send referral')])])],
    'F4 contact form, typed Submit': [iframeApp(), el('section', {}, [el('form', { id: 'contact' }, [inp('full_name'), inp('email', 'email'), el('textarea', { id: 'message', name: 'message' }), btn('go', 'submit', 'Submit')])])],
    'Refer a friend form, typed Submit': [iframeApp(), el('aside', {}, [el('form', { id: 'refer2' }, [inp('friend_name'), inp('friend_email', 'email'), btn('go', 'submit', 'Submit')])])],
    'Email this job form, input Send': [iframeApp(), el('aside', {}, [el('form', { id: 'email-job2' }, [inp('your_name'), inp('your_email', 'email'), el('input', { id: 'go', type: 'submit', value: 'Send' })])])],
  });
});

// M-007-fix11-N10-1
test('M-007-fix11-N10-1 a label over 80 chars with a space at the cut is saved trimmed and clicked after apply.pending', async () => {
  const text = 'Submit my job application now';
  const value = 'Complete your job application now';
  const aria = 'Finish this job application now';
  const joined = [text, value, aria].join(' ').toLowerCase();
  assert.ok(joined.length > 80 && joined[79] === ' ', `fixture: index 79 is a space (${joined.length} chars)`);
  const out = await readAndClick([el('form', { id: 'app' }, [...body(), btn('go', 'submit', text, { value, 'aria-label': aria })])]);
  assert.equal(out.res.submitText, joined.slice(0, 79), show(out.res));
  assert.equal(out.clicked.state, 'clicked', JSON.stringify(out.clicked));
  assert.deepEqual([out.clicks, out.budget], [['go'], ['log apply.pending']]);
});

// M-007-fix11-S20
test('M-007-fix11-S20 the click lands only on the element just checked: a path drift onto Remove file or a second same-label Apply is refused, also after apply.pending', async () => {
  const formG = () => [el('form', { id: 'g' }, [el('div', {}, body()), el('div', {}, [inp('consent', 'checkbox')]), el('div', {}, [btn(null, 'submit', 'Submit application')])])];
  const shifted = () => domCtx([el('form', { id: 'g' }, [el('div', {}, body()), el('div', {}, [inp('consent', 'checkbox', { checked: 'checked' })]), el('div', {}, [btn(null, undefined, '', { 'aria-label': 'Remove file' })]), el('div', {}, [btn(null, 'submit', 'Submit application')])])]);
  const before = await readAndClick(formG(), { drift: shifted });
  assert.ok(String(before.plan.submitSelector).startsWith('#g > '), before.plan.submitSelector);
  assert.equal(before.clicked.state, 'no-button', JSON.stringify(before.clicked));
  assert.deepEqual([before.clicks, before.budget], [[], []], 'T2 drift before the check: 0 clicks, 0 budget calls');
  const after = await readAndClick(formG(), { onPending: shifted });
  assert.equal(after.clicked.state, 'no-button', JSON.stringify(after.clicked));
  assert.equal(after.clicked.reason, CHANGED, JSON.stringify(after.clicked));
  assert.deepEqual(after.clicks, [], 'T2 drift after the pending row: the click re-checks and clicks nothing');
  const steady = await readAndClick(formG());
  assert.equal(steady.clicked.state, 'clicked', `T3 no drift still clicks: ${JSON.stringify(steady.clicked)}`);
  assert.deepEqual(steady.clicks, ['button:Submit application']);

  const formA = () => [el('form', { id: 'h' }, [...body(), btn(null, 'submit', 'Apply')])];
  const filter = (ctx) => { const f = ctx.document.querySelector('#h'); const b = btn(null, undefined, 'Apply'); b.parentElement = f; f.children.splice(3, 0, b); return ctx; };
  const t1 = await readAndClick(formA(), { drift: filter });
  assert.equal(t1.res.submitText, 'apply', show(t1.res));
  assert.equal(t1.clicked.state, 'no-button', `T1 a second same-label Apply: ${JSON.stringify(t1.clicked)}`);
  assert.deepEqual([t1.clicks, t1.budget], [[], []]);
  const extra = (ctx) => { const f = ctx.document.querySelector('#h'); const b = btn('x2', 'button', 'Apply'); b.parentElement = f; f.children.push(b); return ctx; };
  const t1b = await readAndClick(formA(), { drift: extra });
  assert.equal(t1b.clicked.state, 'no-button', `a second passing control after the path: ${JSON.stringify(t1b.clicked)}`);
  assert.deepEqual([t1b.clicks, t1b.budget], [[], []]);
});

// M-007-fix11-keep
test('M-007-fix11-keep Greenhouse new board, Lever type=button, Ashby, ASP.NET wrapper, Send application, icon-only aria-label, Apply now and the live-mock form keep their submit and click it', async () => {
  const shapes = {
    'Greenhouse new board': [[el('main', {}, [el('div', { 'aria-label': 'Apply' }, [el('form', { id: 'application-form' }, [inp('first_name'), inp('email', 'email'), inp('resume', 'file'), btn('attach', 'button', 'Attach'), btn('gh_submit', 'submit', 'Submit application')])])])], 'gh_submit', 'submit application'],
    'Lever type=button Submit application': [[el('form', { id: 'application-form' }, [inp('resume-upload-input', 'file', { name: 'resume' }), inp('n', 'text', { name: 'name' }), inp('e', 'email', { name: 'email' }), btn('li', 'button', 'Apply with LinkedIn'), btn('btn-submit', 'button', 'Submit application')])], 'btn-submit', 'submit application'],
    Ashby: [[el('main', {}, [el('form', { id: 'ashby_application' }, [inp('_systemfield_name'), inp('_systemfield_email', 'email'), inp('_systemfield_resume', 'file'), btn('up', 'button', 'Upload File'), btn('ashby_submit', 'submit', 'Submit Application')])])], 'ashby_submit', 'submit application'],
    'ASP.NET wrapper with a footer Subscribe': [[el('form', { id: 'aspnetForm' }, [el('main', {}, [inp('first_name'), inp('a_email', 'email'), inp('cv', 'file'), el('input', { id: 'btnSubmit', type: 'submit', value: 'Submit application' })]), el('footer', {}, [inp('nl_email2', 'email'), el('input', { id: 'nl', type: 'submit', value: 'Subscribe' })])])], 'btnSubmit', 'submit application'],
    'a lone typed Send application': [[el('form', { id: 'app' }, [...body(), btn('send', 'submit', 'Send application')])], 'send', 'send application'],
    'icon-only typed button with aria-label Submit application': [[el('form', { id: 'app' }, [...body(), btn('icon', 'submit', '', { 'aria-label': 'Submit application' })])], 'icon', 'submit application'],
    'Apply now alone': [[el('form', { id: 'app' }, [...body(), btn('ap', 'submit', 'Apply now')])], 'ap', 'apply now'],
    'Apply now alone, no resume field': [[el('form', { id: 'app' }, [inp('full_name'), inp('a_email', 'email'), btn('ap', 'submit', 'Apply now')])], 'ap', 'apply now'],
    'no resume field, typed Submit application': [[el('form', { id: 'app' }, [inp('full_name'), inp('a_email', 'email'), btn('go', 'submit', 'Submit application')])], 'go', 'submit application'],
    'resume form, plain typed Submit': [[el('form', { id: 'app' }, [...body(), btn('go', 'submit', 'Submit')])], 'go', 'submit'],
    'live-mock typed Submit Application': [[el('form', { id: 'application_form' }, [inp('first_name'), inp('email', 'email'), inp('resume', 'file'), btn('submit_app', 'submit', 'Submit Application')])], 'submit_app', 'submit application'],
  };
  for (const [name, [kids, id, label]] of Object.entries(shapes)) {
    const out = await readAndClick(kids);
    assert.deepEqual([out.res.submit, out.res.submitText], [`#${id}`, label], `${name}: ${show(out.res)}`);
    assert.equal(planFinishReason(out.plan), null, `${name}: the plan is not a finish-yourself plan`);
    assert.equal(out.clicked.state, 'clicked', `${name}: ${JSON.stringify(out.clicked)}`);
    assert.deepEqual([out.clicks, out.budget], [[id], ['log apply.pending']], name);
  }
  const lm = await read([el('form', { id: 'application_form' }, [inp('first_name'), inp('email', 'email'), inp('resume', 'file'), btn('submit_app', 'submit', 'Submit Application')])]);
  assert.equal(lm.submitText, 'submit application', 'the locked live-mock fixture saves submitText "submit application"');
});
