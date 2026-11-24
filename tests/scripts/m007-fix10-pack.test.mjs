// M-007 fix round 10, submit-pick rule v5: a submit is saved only when it is positively an application submit (rule 1
// a-d allowlist, one label from textContent, value and aria-label), a pick in a nested region or in doubt beside another
// allowlisted control saves none (items 2, 2b), the click re-checks the live element against the same rule and label
// (item 4), and a saved read with a submit but no text is a stale read at plan time (item 5). Null cases never reach a
// batch: submit null, finish these yourself with the link, 0 clicks, 0 budget calls. Fake DOM, fake CDP client and fake
// runner through the real read path, fill-plan and clickSubmit; no browser, network or model call. Fake data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import * as cdp from '../../lib/cdp.mjs';
import * as chrome from '../../scripts/chrome.mjs';
import * as fillPlan from '../../scripts/fill-plan.mjs';
import * as ap from '../../scripts/autopilot.mjs';
import { readFormDoc, FIELDS_DIR } from '../../lib/ats-fields.mjs';
import { planFinishReason } from '../../lib/kept-out.mjs';
import { readBatch, updateBatch } from '../../lib/batch-file.mjs';
import { appendTsv } from '../../lib/tsv.mjs';
import { LOG_HEADER, row as logRow } from '../helpers/budget-harness.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const TODAY = '2026-11-24';
const GH = 'https://boards.greenhouse.io/examplerobotics/jobs/8001';
const words = (n, w = 'robotics') => Array.from({ length: n }, (_, i) => `${w}${i}`).join(' ');
const POSTING = `Example Robotics hires a Software Engineering Intern. Requirements: Python, SQL, testing. ${words(90)}`;
const STALE_REASON = 'saved form read is too old; read the form again';

function scratch(config = '') {
  const root = mkdtempSync(join(tmpdir(), 'pack-m007-fix10-'));
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

// A small DOM for the page scripts (as in the fix9 tests), with clicks recorded and textContent when a test sets it.
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
  node.click = () => clicks.push(node.id || node.tagName.toLowerCase());
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
const vmClient = (ctx) => ({ send: async (method, params) => {
  if (method === 'Target.getTargets') return { targetInfos: [{ targetId: 'T1', type: 'page', url: GH }] };
  if (method === 'Target.attachToTarget') return { sessionId: 'S1' };
  if (method === 'Page.captureScreenshot') return { data: '' };
  if (method !== 'Runtime.evaluate') return {};
  let value;
  try {
    value = runInNewContext(params.expression, ctx);
  } catch {
    value = null;
  }
  return { result: { value } };
} });
const inp = (id, type = 'text', extra = {}) => el('input', { id, name: id, type, ...extra });
const btn = (id, type, text = '', extra = {}) => el('button', type ? { id, type, text, ...extra } : { id, text, ...extra });
const body = () => [inp('first_name'), inp('a_email', 'email'), inp('cv', 'file')];
const iframeApp = () => el('div', { id: 'grnhse_app' }, [el('iframe', { id: 'grnhse_iframe' })]);
const read = (kids) => cdp.readApplicationForm(vmClient(domCtx(kids)), 'S1');
const ids = (res) => Array.from(res.fields, (f) => f.id);
const show = (res) => JSON.stringify({ fields: ids(res), form: res.form, submit: res.submit, submitText: res.submitText });
const budgetRunner = (calls) => (cmd, args) => (calls.push(args.slice(1, 3).join(' ')), { code: 0, stdout: '', stderr: '' });

// The plan fill-plan builds from a saved read (readFormDoc), the way scripts/fill-plan.mjs carries it.
function savedPlan(dir, res) {
  chrome.saveFormFields(dir, GH, res.fields, res);
  const doc = readFormDoc(join(dir, FIELDS_DIR), GH);
  return {
    formSelector: doc.form ?? null, submitSelector: doc.submit ?? null, ...(typeof doc.submitText === 'string' ? { submitText: doc.submitText } : {}),
    fields: doc.fields.map((f) => ({ selector: f.selector, type: f.type, value: 'x' })),
  };
}

// Read on kids, then the real clickSubmit on the same DOM (or on drift(ctx)'s DOM) with a budget-runner spy.
async function readAndClick(kids, drift) {
  const dir = mkdtempSync(join(tmpdir(), 'pack-m007-fix10-click-'));
  try {
    const ctx = domCtx(kids);
    const res = await cdp.readApplicationForm(vmClient(ctx), 'S1');
    const plan = { batchId: 'b1', item: 1, url: GH, link: GH, company: 'Example Robotics', role: 'Intern', score: 4, ...savedPlan(dir, res), tab: { targetId: 'T1', url: GH, sentinel: null }, planFile: join(dir, '1.json') };
    const clickCtx = drift ? drift(ctx) : ctx;
    clicks.length = 0;
    const budget = [];
    const clicked = await chrome.clickSubmit(vmClient(clickCtx), { plan, paths: { packRoot: PACK_ROOT, root: dir, dataDir: dir }, item: 1, runner: budgetRunner(budget), wait: async () => {} });
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

// M-007-fix10-N9-1
test('M-007-fix10-N9-1 a form whose only typed control is link-style (a), unlabelled (b) or a helper (c) saves no submit', async () => {
  await assertNull({
    'a N3 only typed Apply with LinkedIn': [el('form', { id: 'app' }, [...body(), btn('li', 'submit', 'Apply with LinkedIn')])],
    'a N3c only typed Share': [el('form', { id: 'app' }, [...body(), btn('sh', 'submit', 'Share')])],
    'a N3d share-this-job form beside an iframe app': [iframeApp(), el('form', { id: 'share' }, [inp('your_name'), inp('your_email', 'email'), inp('friend_email', 'email'), btn('sh', 'submit', 'Share')])],
    'a N3f only typed Apply with Indeed': [el('form', { id: 'app' }, [...body(), btn('in', 'submit', 'Apply with Indeed')])],
    'b N1 valueless input submit': [el('form', { id: 'app' }, [...body(), el('input', { id: 'go', type: 'submit' })])],
    'b N1b icon-only typed button with no label': [el('form', { id: 'app' }, [...body(), btn('go', 'submit', '')])],
    'c N2 only typed Upload resume': [el('form', { id: 'app' }, [...body(), btn('up', 'submit', 'Upload resume')])],
    'c N2b only typed Autofill from resume': [el('form', { id: 'app' }, [...body(), btn('af', 'submit', 'Autofill from resume')])],
    'c N2c resume-parse pre-form beside an iframe app': [iframeApp(), el('form', { id: 'parse' }, [inp('resume', 'file'), btn('up', 'submit', 'Upload')])],
  });
});

// M-007-fix10-N9-2
test('M-007-fix10-N9-2 a body Apply or Submit code beside a footer Submit application, or a Send beside a filter Apply, is doubt: no submit, footer questions kept', async () => {
  await assertNull({
    'p5 N4 body type=button Apply + typeless footer Submit application': [el('form', { id: 'app' }, [...body(), inp('promo'), btn('ap', 'button', 'Apply'), el('footer', {}, [btn('go', undefined, 'Submit application')])])],
    'p5 N4b body typeless Submit code + typeless Submit application': [el('form', { id: 'app' }, [...body(), inp('code'), btn('sc', undefined, 'Submit code'), btn('go', undefined, 'Submit application')])],
    'p6 N4 body type=button Apply + footer select and typeless Submit application': [el('form', { id: 'app' }, [...body(), btn('ap', 'button', 'Apply'), el('footer', {}, [el('select', { id: 'how_heard' }), btn('go', undefined, 'Submit application')])])],
    'R7 typed Send + typeless filter Apply': [el('form', { id: 'app' }, [...body(), btn('flt', undefined, 'Apply'), btn('go', 'submit', 'Send')])],
  });
  const p6 = await read([el('form', { id: 'app' }, [...body(), btn('ap', 'button', 'Apply'), el('footer', {}, [el('select', { id: 'how_heard' }), btn('go', undefined, 'Submit application')])])]);
  assert.ok(ids(p6).includes('how_heard'), `the footer question is kept for the finish row: ${show(p6)}`);
});

// M-007-fix10-M05
test('M-007-fix10-M05 R1, R2, R3, R4, R4b, R4d and Review and submit save no submit', async () => {
  await assertNull({
    'R1 header typed Apply now + typeless body Submit application': [el('form', { id: 'r1' }, [el('header', {}, [btn('r1_apply', 'submit', 'Apply now')]), ...body(), btn('r1_go', undefined, 'Submit application')])],
    'R2 typeless Add another then typeless Send': [el('form', { id: 'r2' }, [...body(), btn('r2_add', undefined, 'Add another'), btn('r2_send', undefined, 'Send')])],
    'R3 only a typeless Upload resume, real submit an a role=button': [el('form', { id: 'r3' }, [...body(), btn('r3_up', undefined, 'Upload resume'), el('a', { id: 'r3_go', role: 'button', text: 'Submit application' })])],
    'R4 typed Next': [el('form', { id: 'r4' }, [...body(), btn('r4_next', 'submit', 'Next')])],
    'R4b typed Continue': [el('form', { id: 'r4b' }, [...body(), btn('r4b_go', 'submit', 'Continue')])],
    'R4d typed Review application': [el('form', { id: 'r4d' }, [...body(), btn('r4d_go', 'submit', 'Review application')])],
    'typed Review and submit': [el('form', { id: 'rs' }, [...body(), btn('rs_go', 'submit', 'Review and submit')])],
  });
});

// M-007-fix10-S19
test('M-007-fix10-S19 D2: an icon-only aria-label submit whose path drifts onto an icon-only Remove file is refused before apply.pending; D3: a valueless input submit is never saved', async () => {
  const formA = () => [el('form', { id: 'd' }, [el('div', {}, body()), el('div', {}, [el('button', { type: 'submit', 'aria-label': 'Submit application' })])])];
  const drift = () => domCtx([el('form', { id: 'd' }, [el('div', {}, body()), el('div', {}, [el('button', { 'aria-label': 'Remove file' })]), el('div', {}, [el('button', { type: 'submit', 'aria-label': 'Submit application' })])])]);
  const kept = await readAndClick(formA());
  assert.equal(kept.res.submitText, 'submit application', show(kept.res));
  assert.ok(String(kept.res.submit).startsWith('#d > '), `the saved path has no id of its own: ${show(kept.res)}`);
  assert.equal(kept.clicked.state, 'clicked', `KEEP: the icon-only submit is clicked when it does not drift: ${JSON.stringify(kept.clicked)}`);
  assert.equal(kept.clicks.length, 1);
  const d2 = await readAndClick(formA(), drift);
  assert.equal(d2.clicked.state, 'no-button', JSON.stringify(d2.clicked));
  assert.deepEqual([d2.clicks, d2.budget], [[], []], 'D2: 0 clicks, no apply.pending');
  const d3 = await readAndClick([el('form', { id: 'd3' }, [el('div', {}, body()), el('div', {}, [el('input', { type: 'submit' })]), el('div', {}, [el('input', { type: 'submit' })])])]);
  assert.equal(d3.res.submit ?? null, null, show(d3.res));
  assert.deepEqual([d3.clicked.state, d3.clicks, d3.budget], ['no-button', [], []]);
});

// M-007-fix10-click
test('M-007-fix10-click the click re-checks rule 1 and the label on the live element: a drift onto a Next or a renamed button is refused before apply.pending', async () => {
  const good = () => [el('form', { id: 'app' }, [...body(), btn('go', 'submit', 'Submit application')])];
  const toNext = await readAndClick(good(), (c) => { c.document.querySelector('#go').innerText = 'Next'; return c; });
  assert.equal(toNext.clicked.state, 'no-button', JSON.stringify(toNext.clicked));
  assert.deepEqual([toNext.clicks, toNext.budget], [[], []]);
  const caseOnly = await readAndClick(good(), (c) => { c.document.querySelector('#go').innerText = '  SUBMIT   Application '; return c; });
  assert.equal(caseOnly.clicked.state, 'clicked', `case and spaces only still click: ${JSON.stringify(caseOnly.clicked)}`);
  const lever = await readAndClick([el('form', { id: 'application-form' }, [inp('resume-upload-input', 'file', { name: 'resume' }), inp('n', 'text', { name: 'name' }), inp('e', 'email', { name: 'email' }), btn('li', 'button', 'Apply with LinkedIn'), btn('btn-submit', 'button', 'Submit application')])],
    (c) => { c.document.querySelector('#btn-submit').innerText = 'Upload resume'; return c; });
  assert.equal(lever.clicked.state, 'no-button', JSON.stringify(lever.clicked));
  assert.deepEqual([lever.clicks, lever.budget], [[], []]);
});

// M-007-fix10-keep
test('M-007-fix10-keep Greenhouse new board, Lever type=button, Ashby, ASP.NET wrapper, Send application, icon-only aria-label and the live-mock form keep their submit and click it', async () => {
  const shapes = {
    'Greenhouse new board': [[el('main', {}, [el('div', { 'aria-label': 'Apply' }, [el('form', { id: 'application-form' }, [inp('first_name'), inp('email', 'email'), inp('resume', 'file'), btn('attach', 'button', 'Attach'), btn('gh_submit', 'submit', 'Submit application')])])])], 'gh_submit', 'submit application'],
    Ashby: [[el('main', {}, [el('form', { id: 'ashby_application' }, [inp('_systemfield_name'), inp('_systemfield_email', 'email'), inp('_systemfield_resume', 'file'), btn('up', 'button', 'Upload File'), btn('ashby_submit', 'submit', 'Submit Application')])])], 'ashby_submit', 'submit application'],
    'ASP.NET wrapper with a footer Subscribe': [[el('form', { id: 'aspnetForm' }, [el('main', {}, [inp('first_name'), inp('a_email', 'email'), inp('cv', 'file'), el('input', { id: 'btnSubmit', type: 'submit', value: 'Submit application' })]), el('footer', {}, [inp('nl_email2', 'email'), el('input', { id: 'nl', type: 'submit', value: 'Subscribe' })])])], 'btnSubmit', 'submit application'],
    'a lone typed Send application': [[el('form', { id: 'app' }, [...body(), btn('send', 'submit', 'Send application')])], 'send', 'send application'],
    'icon-only typed button with aria-label Submit application': [[el('form', { id: 'app' }, [...body(), btn('icon', 'submit', '', { 'aria-label': 'Submit application' })])], 'icon', 'submit application'],
    'live-mock typed Submit Application': [[el('form', { id: 'application_form' }, [inp('first_name'), inp('email', 'email'), btn('submit_app', 'submit', 'Submit Application')])], 'submit_app', 'submit application'],
    'textContent beats innerText (a hidden span)': [[el('form', { id: 'app' }, [...body(), btn('tc', 'submit', 'Submit', { textContent: '\n  Submit\n   application ' })])], 'tc', 'submit application'],
  };
  for (const [name, [kids, id, label]] of Object.entries(shapes)) {
    const out = await readAndClick(kids);
    assert.deepEqual([out.res.submit, out.res.submitText], [`#${id}`, label], `${name}: ${show(out.res)}`);
    assert.equal(planFinishReason(out.plan), null, `${name}: the plan is not a finish-yourself plan`);
    assert.equal(out.clicked.state, 'clicked', `${name}: ${JSON.stringify(out.clicked)}`);
    assert.deepEqual([out.clicks, out.budget], [[id], ['log apply.pending']], name);
  }
  // Rule v7 F1b: Lever's Apply with LinkedIn is a submit-worded control beside the pick, so Lever now saves no submit.
  await assertNull({
    'Lever type=button Submit application beside Apply with LinkedIn': [el('form', { id: 'application-form' }, [inp('resume-upload-input', 'file', { name: 'resume' }), inp('n', 'text', { name: 'name' }), inp('e', 'email', { name: 'email' }), btn('li', 'button', 'Apply with LinkedIn'), btn('btn-submit', 'button', 'Submit application')])],
  });
});

// M-007-fix10-N9-3
test('M-007-fix10-N9-3 a saved read or plan with a submit and no submit text is a stale read at plan time: never batch-ready, never filled', async () => {
  const legacy = { fields: [{ selector: '#email', type: 'email', value: 'x' }], formSelector: '#app', submitSelector: '#go' };
  assert.equal(planFinishReason(legacy), STALE_REASON);
  assert.equal(planFinishReason({ ...legacy, submitText: '' }), STALE_REASON);
  assert.ok(String(ap.planWait(legacy)).includes(STALE_REASON), String(ap.planWait(legacy)));
  const FIELDS = [{ selector: '#email', id: 'email', name: 'email', type: 'email', label: 'Email' }];
  const r = scratch('chrome_in_schedule: yes\ndaily_target: 5\nscore_floor: 3.0\n');
  try {
    const lines = [];
    const row = { url: GH, company: 'Example Robotics', title: 'Software Engineering Intern', score: 41, triage: 3.8, jobText: POSTING };
    const made = await fillPlan.fillPlans({ paths: r.paths, rows: [row], today: TODAY, deps: planDeps(r, { fieldsFor: () => ({ fields: FIELDS, form: '#app', submit: '#go' }) }), say: (l) => lines.push(String(l)) });
    assert.deepEqual(made.ids, [], lines.join('\n'));
    assert.ok(lines.some((l) => l.includes(GH) && l.includes('finish these yourself') && l.includes(STALE_REASON)), lines.join('\n'));

    // An approved plan written before submit text was saved moves to finish these yourself before any fill.
    const good = await fillPlan.fillPlans({ paths: r.paths, rows: [row], today: TODAY, deps: planDeps(r, { fieldsFor: () => ({ fields: FIELDS, form: '#app', submit: '#go', submitText: 'submit application' }) }), say: () => {} });
    const id = good.ids[0];
    const planFile = readBatch(r.dataDir, id).items[0].plan;
    const { submitText, ...old } = JSON.parse(readFileSync(planFile, 'utf8'));
    assert.equal(submitText, 'submit application');
    writeFileSync(planFile, JSON.stringify(old));
    await appendTsv(join(r.dataDir, 'action-log.tsv'), LOG_HEADER, [logRow({ ts: `${TODAY}T18:00:00.000Z`, action: 'batch.approve', approval: 'approve all', detail: `batch=${id};items=1` })]);
    updateBatch(r.dataDir, id, (b) => ({ ...b, approved: { items: [1], words: 'approve all' } }));
    const calls = [];
    const runner = (cmd, args) => {
      calls.push([basename(String(args[0])), args[1]]);
      return basename(String(args[0])) === 'rank-queue.mjs' ? '[]' : '';
    };
    const res = await ap.autopilot({ paths: r.paths, today: TODAY, deps: { runner, chromeOpen: () => true, out: () => {} } });
    assert.ok(!calls.some((c) => c[0] === 'chrome.mjs' && ['fill', 'submit'].includes(c[1])), JSON.stringify(calls));
    const finish = readBatch(r.dataDir, id).finishYourself ?? [];
    assert.ok(finish.some((f) => f.link === GH && f.reason === STALE_REASON), JSON.stringify(finish));
    assert.ok(res.lines.some((l) => l.includes(GH) && l.includes(STALE_REASON)), res.lines.join('\n'));
  } finally {
    r.cleanup();
  }
});
