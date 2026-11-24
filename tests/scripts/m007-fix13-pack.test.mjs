// M-007 fix round 13, submit fail-safe rule v7 (refuse on doubt): one submit decision runs at read time and again at
// click time; any doubt saves no submit (with a reason code), and at click time the live form must give the same pick
// and the same signature as the read, else the click is refused (changed-since-read). A refusal is 0 clicks, 0 budget
// calls and one finish-yourself entry with the link and the reason code. Fake DOM, fake CDP client and fake runner
// through the real read path, fill-plan, clickSubmit and afterClick; no browser, network or model call. Fake data only.
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
const CHANGED = 'the submit button changed since the form was read; read the form again (changed-since-read)';
const words = (n, w = 'robotics') => Array.from({ length: n }, (_, i) => `${w}${i}`).join(' ');
const POSTING = `Example Robotics hires a Software Engineering Intern. Requirements: Python, SQL, testing. ${words(90)}`;

function scratch() {
  const root = mkdtempSync(join(tmpdir(), 'pack-m007-fix13-'));
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

// A small DOM for the page scripts (as in the fix12 tests), with clicks recorded.
const clicks = [];
function el(tag, attrs = {}, children = []) {
  const node = { tagName: tag.toUpperCase(), attrs, children, parentElement: null, required: false, placeholder: attrs.placeholder ?? '', autocomplete: '' };
  node.id = attrs.id ?? '';
  node.name = attrs.name ?? '';
  node.type = attrs.type ?? (tag === 'input' ? 'text' : tag === 'button' ? 'submit' : tag === 'select' ? 'select-one' : '');
  node.innerText = attrs.text ?? '';
  node.value = attrs.value ?? '';
  for (const c of children) c.parentElement = node;
  node.getAttribute = (k) => (k in node.attrs && k !== 'text' ? node.attrs[k] : null);
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
// A fake CDP client over holder.cur (so a test can swap the page mid-run); holder.fail(expr) makes a page script throw.
const vmClient = (holder) => ({ send: async (method, params) => {
  if (method === 'Target.getTargets') return { targetInfos: [{ targetId: 'T1', type: 'page', url: GH }] };
  if (method === 'Target.attachToTarget') return { sessionId: 'S1' };
  if (method === 'Page.captureScreenshot') return { data: '' };
  if (method !== 'Runtime.evaluate') return {};
  if (holder.fail && holder.fail(params.expression)) return { exceptionDetails: { text: 'page script threw' } };
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
const link = (id, href, text, extra = {}) => el('a', { id, href, text, ...extra });
const body = () => [inp('first_name'), inp('a_email', 'email'), inp('cv', 'file')];
const noResume = () => [inp('full_name'), inp('a_email', 'email'), inp('a_phone', 'tel')];
const ids = (res) => Array.from(res.fields, (f) => f.id);
const show = (res) => JSON.stringify({ fields: ids(res), form: res.form, submit: res.submit, submitText: res.submitText, submitRefusal: res.submitRefusal });
const addTo = (formId, node) => (ctx) => { const f = ctx.document.querySelector(`#${formId}`); node.parentElement = f; f.children.push(node); return ctx; };

// The plan fill-plan builds from a saved read (saveFormFields -> readFormDoc), the way scripts/fill-plan.mjs carries it.
function savedPlan(dir, res) {
  chrome.saveFormFields(dir, GH, res.fields, res);
  const doc = readFormDoc(join(dir, FIELDS_DIR), GH);
  return {
    formSelector: doc.form ?? null, submitSelector: doc.submit ?? null, ...(typeof doc.submitText === 'string' ? { submitText: doc.submitText } : {}),
    ...(doc.submitSignature ? { submitSignature: doc.submitSignature } : {}),
    fields: doc.fields.map((f) => ({ selector: f.selector, type: f.type, value: 'x' })),
  };
}

// Read on kids, then the real clickSubmit on the same DOM (or drift(ctx)'s DOM) with a budget-runner spy, then the real
// afterClick with a finish-yourself spy. edit(plan) changes the saved plan before the click.
async function readAndClick(kids, { drift, edit, fail } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pack-m007-fix13-click-'));
  try {
    const holder = { cur: domCtx(kids) };
    const res = await cdp.readApplicationForm(vmClient(holder), 'S1');
    let plan = { batchId: 'b1', item: 1, url: GH, link: GH, company: 'Example Robotics', role: 'Intern', score: 4, ...savedPlan(dir, res), tab: { targetId: 'T1', url: GH, sentinel: null }, planFile: join(dir, '1.json') };
    if (edit) plan = edit(plan);
    if (drift) holder.cur = drift(holder.cur);
    if (fail) holder.fail = fail;
    clicks.length = 0;
    const budget = [];
    const runner = (cmd, args) => {
      budget.push(args.slice(1, 3).join(' '));
      return { code: 0, stdout: '', stderr: '' };
    };
    const paths = { packRoot: PACK_ROOT, root: dir, dataDir: dir };
    const clicked = await chrome.clickSubmit(vmClient(holder), { plan, paths, item: 1, runner, wait: async () => {} });
    const done = { res, plan, clicked, clicks: [...clicks], budget, finish: [] };
    if (clicked.state !== 'clicked') {
      chrome.afterClick({ clicked, plan, paths, flags: { batchId: 'b1', item: 1 }, action: 'apply.submit', dataDir: dir, deps: { runner, addFinishYourself: (d, id, entry) => done.finish.push(entry) }, say: () => {} });
    }
    return done;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Each shape refused at read time: submit null with its reason code, the real clickSubmit refuses (0 clicks, 0 budget
// calls), and fill-plan puts it on finish these yourself with its link and reason code, never on a batch.
async function assertRefusedAtRead(shapes) {
  const reads = {};
  for (const [name, [kids, code]] of Object.entries(shapes)) {
    const out = await readAndClick(kids);
    assert.equal(out.res.submit ?? null, null, `${name}: no submit is saved: ${show(out.res)}`);
    assert.equal(out.res.submitRefusal, code, `${name}: reason code: ${show(out.res)}`);
    assert.equal(out.clicked.state, 'no-button', `${name}: ${JSON.stringify(out.clicked)}`);
    assert.deepEqual([out.clicks, out.budget], [[], []], `${name}: 0 clicks, 0 budget calls`);
    assert.ok(out.res.fields.length, `${name}: the form's fields are read`);
    reads[name] = out.res;
  }
  const r = scratch();
  try {
    const names = Object.keys(reads);
    const urlOf = (i) => `${GH}${i}`;
    const rows = names.map((n, i) => ({ url: urlOf(i), company: 'Example Robotics', title: 'Intern', score: 41, triage: 3.8, jobText: POSTING }));
    const byUrl = new Map(names.map((n, i) => [urlOf(i), reads[n]]));
    const lines = [];
    const made = await fillPlan.fillPlans({ paths: r.paths, rows, today: TODAY, deps: planDeps(r, { fieldsFor: (row) => byUrl.get(row.url) }), say: (l) => lines.push(String(l)) });
    assert.deepEqual(made.ids, [], `never batch-ready, so no approval is asked: ${lines.join('\n')}`);
    names.forEach((n, i) => {
      const hits = lines.filter((l) => l.includes(`(${urlOf(i)})`) && l.includes('finish these yourself') && l.includes(`(${shapes[n][1]})`));
      assert.equal(hits.length, 1, `${n}: one finish line with the link and the reason code: ${lines.join('\n')}`);
    });
  } finally {
    r.cleanup();
  }
}

// A shape saved at read time and refused at click time: 0 clicks, 0 budget calls (refused before apply.pending), one
// finish-yourself entry with the link and changed-since-read.
function assertRefusedAtClick(name, out) {
  assert.ok(out.res.submit, `${name}: saved at read: ${show(out.res)}`);
  assert.equal(out.clicked.state, 'no-button', `${name}: ${JSON.stringify(out.clicked)}`);
  assert.deepEqual([out.clicks, out.budget], [[], []], `${name}: 0 clicks, 0 budget calls`);
  assert.deepEqual(out.finish.map((f) => [f.link, f.reason]), [[GH, CHANGED]], `${name}: one finish entry: ${JSON.stringify(out.finish)}`);
}

// Each KEEP shape: saved with its label and signature, not a finish-yourself plan, clicked once after apply.pending.
async function assertKeep(shapes) {
  for (const [name, [kids, id, label]] of Object.entries(shapes)) {
    const out = await readAndClick(kids);
    assert.deepEqual([out.res.submit, out.res.submitText], [`#${id}`, label], `${name}: ${show(out.res)}`);
    assert.equal(out.res.submitSignature?.path, `#${id}`, `${name}: signature saved with the plan`);
    assert.equal(JSON.stringify(out.plan.submitSignature), JSON.stringify(out.res.submitSignature), `${name}: the plan carries the signature`);
    assert.equal(planFinishReason(out.plan), null, `${name}: the plan is not a finish-yourself plan`);
    assert.equal(out.clicked.state, 'clicked', `${name}: ${JSON.stringify(out.clicked)}`);
    assert.deepEqual([out.clicks, out.budget], [[id], ['log apply.pending']], name);
  }
}

// M-007-fix13-F1-shapes
test('M-007-fix13-F1 personal r16 M-08, nested-region submit wording, link submits, two candidates, r17 M-09 and r12 N12-1 shapes save no submit, with a reason code', async () => {
  await assertRefusedAtRead({
    'X1 body typed Apply (promo) + footer typed Submit for review': [[el('form', { id: 'x1' }, [...body(), inp('x1_promo'), btn('x1_ap', 'submit', 'Apply'), el('footer', {}, [btn('x1_go', 'submit', 'Submit for review')])])], 'many-candidates'],
    'X2 body typed Send (OTP) + footer typed Apply for this job': [[el('form', { id: 'x2' }, [...body(), inp('x2_phone', 'tel'), btn('x2_send', 'submit', 'Send'), el('footer', {}, [btn('x2_go', 'submit', 'Apply for this job')])])], 'many-candidates'],
    'X2 apply variant': [[el('form', { id: 'x2a' }, [...body(), inp('x2a_promo'), btn('x2a_ap', 'submit', 'Apply'), el('footer', {}, [btn('x2a_go', 'submit', 'Apply for this job')])])], 'many-candidates'],
    'X2b body typed Submit + footer input Submit and continue': [[el('form', { id: 'x2b' }, [...body(), btn('x2b_sub', 'submit', 'Submit'), el('footer', {}, [el('input', { id: 'x2b_go', type: 'submit', value: 'Submit and continue' })])])], 'many-candidates'],
    'X2c body typed Send + footer typeless Apply for this role': [[el('form', { id: 'x2c' }, [...body(), btn('x2c_send', 'submit', 'Send'), el('footer', {}, [btn('x2c_go', undefined, 'Apply for this role')])])], 'many-candidates'],
    'X3b body typed Apply + footer typed Next and Search': [[el('form', { id: 'x3b' }, [...body(), btn('x3b_ap', 'submit', 'Apply'), el('footer', {}, [btn('x3b_nx', 'submit', 'Next'), btn('x3b_s', 'submit', 'Search')])])], 'bare-apply'],
    'Y1 body typed Send (OTP) + link Next': [[el('form', { id: 'y1' }, [...body(), inp('y1_phone', 'tel'), btn('y1_send', 'submit', 'Send'), link('y1_nx', '/apply/step-2', 'Next')])], 'step-link'],
    'Y1 apply variant: body typed Apply + link Next': [[el('form', { id: 'y1a' }, [...body(), btn('y1a_ap', 'submit', 'Apply'), link('y1a_nx', '/apply/step-2', 'Next')])], 'step-link'],
    'header typed Submit + body Submit application': [[el('form', { id: 'hd' }, [el('header', {}, [inp('hd_q'), btn('hd_go', 'submit', 'Submit')]), ...body(), btn('hd_app', 'submit', 'Submit application')])], 'many-candidates'],
    'nav link Apply here + body Submit application': [[el('form', { id: 'nv' }, [el('nav', {}, [link('nv_ap', '/jobs', 'Apply here')]), ...body(), btn('nv_app', 'submit', 'Submit application')])], 'extra-submit-control'],
    'footer link Send us feedback + body Submit application': [[el('form', { id: 'ft' }, [...body(), btn('ft_app', 'submit', 'Submit application'), el('footer', {}, [link('ft_fb', '/feedback', 'Send us feedback')])])], 'extra-submit-control'],
    'the only submit is a link Submit application': [[el('form', { id: 'ls' }, [...body(), btn('ls_up', 'button', 'Upload file'), link('ls_go', '#', 'Submit application')])], 'rule-v6'],
    'typed Submit application + a link Submit application': [[el('form', { id: 'l2' }, [...body(), btn('l2_go', 'submit', 'Submit application'), link('l2_ln', '/apply/submit', 'Submit application')])], 'extra-submit-control'],
    'two application-worded candidates: typed Submit application + typeless Send application': [[el('form', { id: 'c2' }, [...body(), btn('c2_go', 'submit', 'Submit application'), btn('c2_send', undefined, 'Send application')])], 'many-candidates'],
    'two application-worded candidates: typed Upload and submit + typed Submit application': [[el('form', { id: 'c3' }, [...body(), btn('c3_up', 'submit', 'Upload and submit'), btn('c3_go', 'submit', 'Submit application')])], 'many-candidates'],
    'M1 typed promo Apply + link Submit application': [[el('form', { id: 'm1' }, [...body(), inp('m1_code'), btn('m1_ap', 'submit', 'Apply'), link('m1_go', '#', 'Submit application')])], 'extra-submit-control'],
    'M1b typeless filter Apply + link Submit application': [[el('form', { id: 'm1b' }, [...body(), btn('m1b_ap', undefined, 'Apply'), link('m1b_go', '#', 'Submit application')])], 'extra-submit-control'],
    'M1c typed Apply + role=link Submit my application': [[el('form', { id: 'm1c' }, [...body(), btn('m1c_ap', 'submit', 'Apply'), el('div', { id: 'm1c_go', role: 'link', text: 'Submit my application' })])], 'extra-submit-control'],
    'M1d typed Apply + link Apply now': [[el('form', { id: 'm1d' }, [...body(), btn('m1d_ap', 'submit', 'Apply'), link('m1d_go', '#', 'Apply now')])], 'extra-submit-control'],
    'M2 typed Apply + link Save and continue': [[el('form', { id: 'm2' }, [...body(), btn('m2_ap', 'submit', 'Apply'), link('m2_go', '#', 'Save and continue')])], 'step-link'],
    'M2b typed Apply + link Continue to questions': [[el('form', { id: 'm2b' }, [...body(), btn('m2b_ap', 'submit', 'Apply'), link('m2b_go', '/questions', 'Continue to questions')])], 'step-link'],
    'R1 resume form, typed promo Apply + footer typed Confirm': [[el('form', { id: 'r1' }, [...body(), inp('r1_promo'), btn('r1_ap', 'submit', 'Apply'), el('footer', {}, [btn('r1_go', 'submit', 'Confirm')])])], 'bare-apply'],
    'R1b resume form, typed promo Apply + footer typed Register': [[el('form', { id: 'r1b' }, [...body(), inp('r1b_promo'), btn('r1b_ap', 'submit', 'Apply'), el('footer', {}, [btn('r1b_go', 'submit', 'Register')])])], 'bare-apply'],
    'E2d-3 typed Apply + icon-only link with onclick': [[el('form', { id: 'e3' }, [...body(), btn('e3_ap', 'submit', 'Apply'), link('e3_go', '#', '', { onclick: 'sendForm()' })])], 'link-submit'],
    'R3 typed Apply + an outside button with form=app': [[el('form', { id: 'app' }, [...body(), btn('r3_ap', 'submit', 'Apply')]), btn('r3_go', 'submit', 'Confirm', { form: 'app' })], 'outside-control'],
  });
});

// M-007-fix13-F3-click
test('M-007-fix13-F3 a form that changed between read and click is refused before apply.pending with changed-since-read', async () => {
  const kids = () => [el('form', { id: 'a4' }, [el('main', {}, [...noResume(), btn('go', 'submit', 'Submit application'), btn('up', 'button', 'Upload resume')])])];
  // pack r11 N11-1 (read and click count one set) and fix12 RULING 4: a bare Submit added after the read now refuses.
  assertRefusedAtClick('a bare footer Submit added after the read', await readAndClick(kids(), { drift: addTo('a4', el('footer', {}, [btn('ft_go', 'submit', 'Submit')])) }));
  assertRefusedAtClick('a footer Apply now added after the read', await readAndClick(kids(), { drift: addTo('a4', el('footer', {}, [btn('ft_go', 'submit', 'Apply now')])) }));
  assertRefusedAtClick('a link Continue added after the read', await readAndClick(kids(), { drift: addTo('a4', link('nx', '/step-2', 'Continue')) }));
  // A label changed between read and click: the pick's own label, or another control's label that now names a submit.
  assertRefusedAtClick('the pick now reads Submit my application', await readAndClick(kids(), { drift: (ctx) => { ctx.document.querySelector('#go').innerText = 'Submit my application'; return ctx; } }));
  assertRefusedAtClick('Upload resume now reads Upload and submit', await readAndClick(kids(), { drift: (ctx) => { ctx.document.querySelector('#up').innerText = 'Upload and submit'; return ctx; } }));
  // A saved signature that differs from the live one (same pick, same label) refuses.
  assertRefusedAtClick('a saved signature that differs', await readAndClick(kids(), { edit: (p) => ({ ...p, submitSignature: { ...p.submitSignature, controls: [...p.submitSignature.controls, ['a', '', 'apply']] } }) }));
  // A plan made before v7 (no saved signature) still re-runs the decision at click time.
  assertRefusedAtClick('a pre-v7 plan whose form gained a bare Submit', await readAndClick(kids(), { edit: (p) => { const { submitSignature, ...rest } = p; return rest; }, drift: addTo('a4', el('footer', {}, [btn('ft_go', 'submit', 'Submit')])) }));
  // F4: an error in the click-time decision refuses.
  assertRefusedAtClick('the click-time decision throws', await readAndClick(kids(), { fail: (expr) => expr.includes('{ ok: true }') }));
  // The unchanged form is clicked once after apply.pending.
  const same = await readAndClick(kids());
  assert.equal(JSON.stringify(same.res.submitSignature), JSON.stringify({ controls: [['button', 'submit', 'submit application']], path: '#go' }));
  assert.deepEqual([same.clicked.state, same.clicks, same.budget], ['clicked', ['go'], ['log apply.pending']], JSON.stringify(same.clicked));
});

// M-007-fix13-keep
test('M-007-fix13-keep Greenhouse new board, Ashby, ASP.NET wrapper, Send application, Apply, Apply now, icon-only, live-mock and a privacy link still click once; Lever type=button beside Apply with LinkedIn now refuses (extra-submit-control)', async () => {
  await assertKeep({
    'Greenhouse new board': [[el('main', {}, [el('div', { 'aria-label': 'Apply' }, [el('form', { id: 'application-form' }, [inp('first_name'), inp('email', 'email'), inp('resume', 'file'), btn('attach', 'button', 'Attach'), btn('dropbox', 'button', 'Dropbox'), btn('manual', 'button', 'Enter manually'), btn('gh_submit', 'submit', 'Submit application')])])])], 'gh_submit', 'submit application'],
    Ashby: [[el('main', {}, [el('form', { id: 'ashby_application' }, [inp('_systemfield_name'), inp('_systemfield_email', 'email'), inp('_systemfield_resume', 'file'), btn('up', 'button', 'Upload File'), btn('yes', undefined, 'Yes', { 'aria-pressed': 'false' }), btn('no', undefined, 'No', { 'aria-pressed': 'false' }), btn('ashby_submit', 'submit', 'Submit Application')])])], 'ashby_submit', 'submit application'],
    'X4 ASP.NET wrapper with a footer Subscribe': [[el('form', { id: 'aspnetForm' }, [el('main', {}, [inp('first_name'), inp('a_email', 'email'), inp('cv', 'file'), el('input', { id: 'btnSubmit', type: 'submit', value: 'Submit application' })]), el('footer', {}, [inp('nl_email2', 'email'), el('input', { id: 'nl', type: 'submit', value: 'Subscribe' })])])], 'btnSubmit', 'submit application'],
    'ASP.NET wrapper with a button Submit application': [[el('form', { id: 'aspnetForm' }, [el('main', {}, [inp('first_name'), inp('a_email', 'email'), inp('cv', 'file'), btn('btnApp', 'submit', 'Submit application')])])], 'btnApp', 'submit application'],
    'a lone typed Send application': [[el('form', { id: 'app' }, [...body(), btn('send', 'submit', 'Send application')])], 'send', 'send application'],
    'icon-only typed button with aria-label Submit application': [[el('form', { id: 'app' }, [...body(), btn('icon', 'submit', '', { 'aria-label': 'Submit application' })])], 'icon', 'submit application'],
    'Apply alone': [[el('form', { id: 'app' }, [...body(), btn('ap', 'submit', 'Apply')])], 'ap', 'apply'],
    'Apply now alone': [[el('form', { id: 'app' }, [...body(), btn('ap', 'submit', 'Apply now')])], 'ap', 'apply now'],
    'Apply now alone, no resume field': [[el('form', { id: 'app' }, [inp('full_name'), inp('a_email', 'email'), btn('ap', 'submit', 'Apply now')])], 'ap', 'apply now'],
    'live-mock typed Submit Application (locked fixture submitText at tests/e2e/live-mock.test.mjs:88)': [[el('form', { id: 'application_form' }, [inp('first_name'), inp('last_name'), inp('email', 'email'), inp('phone', 'tel'), inp('resume', 'file'), inp('cover_letter', 'file'), inp('question_fav'), btn('submit_app', 'submit', 'Submit Application')])], 'submit_app', 'submit application'],
    'Y2 a link Review our privacy policy beside Submit application': [[el('form', { id: 'app' }, [...body(), link('pp', '/privacy', 'Review our privacy policy'), btn('go', 'submit', 'Submit application')])], 'go', 'submit application'],
  });
  // F5 KEEP shape that v7 now refuses (accepted, listed in the report): Lever's Apply with LinkedIn is a submit-worded
  // control beside the pick (F1b).
  await assertRefusedAtRead({
    'Lever type=button Submit application beside Apply with LinkedIn': [[el('form', { id: 'application-form' }, [inp('resume-upload-input', 'file', { name: 'resume' }), inp('n', 'text', { name: 'name' }), inp('e', 'email', { name: 'email' }), btn('li', 'button', 'Apply with LinkedIn'), btn('btn-submit', 'button', 'Submit application')])], 'extra-submit-control'],
  });
});
