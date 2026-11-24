// M-007 fix round 3. N3-1: job text saved by triage is never replaced by read-form, and read-form takes page text only
// from a JSON-LD JobPosting or from the posting page itself (never the form route's labels). N3-2/N3-8: read-form picks
// the application form (no header, nav, footer or search form; a form with a file input or a button first; ranked by
// answerable fields), records which form it read, and submit clicks only that form's button. N3-3: rows kept out for
// "no job text" or a given-up form do not take a rank slot and the digest names them with a guided offer. N3-4: read-form
// polls for a late form, a later read clears the give-up, and replan does not re-read a given-up posting. NITs N3-9 and
// N3-10. Fake DOM, fake CDP client, fake runner and injected resume, letter and model fakes; no browser, network or model
// call. Fake data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import * as atsFields from '../../lib/ats-fields.mjs';
import * as cdp from '../../lib/cdp.mjs';
import * as jd from '../../lib/jd-store.mjs';
import * as chrome from '../../scripts/chrome.mjs';
import * as fillPlan from '../../scripts/fill-plan.mjs';
import { autopilot } from '../../scripts/autopilot.mjs';
import { readBatch } from '../../lib/batch-file.mjs';
import { appendTsv } from '../../lib/tsv.mjs';
import { LOG_HEADER, row as logRow } from '../helpers/budget-harness.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const TODAY = '2026-11-03';
const GH = 'https://boards.greenhouse.io/examplerobotics/jobs/7401';
const LEVER = 'https://jobs.lever.co/examplerobotics/0f1e2d3c-aaaa-bbbb-cccc-000000000001';
const words = (n, w = 'robotics') => Array.from({ length: n }, (_, i) => `${w}${i}`).join(' ');
const POSTING = `Example Robotics hires a Software Engineering Intern. Requirements: Python, SQL, testing. ${words(90)}`;
const TRIAGE_TEXT = `Software Engineering Intern at Example Robotics.\nAbout the team: ${words(200, 'team')}\nRequirements: Python, SQL, testing.`;
const LABELS = `Software Intern | Submit your application Resume/CV Full name Email Phone Current company LinkedIn URL ${words(120, 'label')}`;
const ldOf = (description, title = 'Software Engineering Intern') => JSON.stringify({ '@context': 'https://schema.org', '@type': 'JobPosting', title, description });
const FIELDS = [{ selector: '#email', id: 'email', name: 'email', type: 'email', label: 'Email' }];

function scratch(config = '') {
  const root = mkdtempSync(join(tmpdir(), 'pack-m007-fix3-'));
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

// A fake CDP client with one page per tab. pages(url) gives { fields, job } for the url a tab navigated to; fields may be
// a list or a function of the read count. Records navigations and evaluated scripts.
function tabClient(pages) {
  const tabs = new Map();
  const log = { navigated: [], scripts: [], formReads: 0 };
  let n = 0;
  const send = async (method, params = {}, sessionId) => {
    if (method === 'Target.createTarget') return { targetId: `T${++n}` };
    if (method === 'Target.attachToTarget') return { sessionId: `S-${params.targetId}` };
    if (method === 'Page.navigate') {
      tabs.set(sessionId, params.url);
      log.navigated.push(params.url);
      return {};
    }
    if (method !== 'Runtime.evaluate') return {};
    const expr = String(params.expression);
    const page = pages(tabs.get(sessionId) ?? '');
    if (/recaptcha/i.test(expr)) return { result: { value: null } };
    if (expr.includes("querySelectorAll('input, select, textarea')")) {
      log.formReads++;
      log.scripts.push('form');
      const f = typeof page.fields === 'function' ? page.fields(log.formReads) : page.fields;
      return { result: { value: f ?? [] } };
    }
    if (expr.includes('application/ld+json')) {
      log.scripts.push(`job ${tabs.get(sessionId)}`);
      return { result: { value: page.job ?? { ld: [], main: '' } } };
    }
    return { result: { value: null } };
  };
  return { client: { send, waitFor: () => Object.assign(Promise.resolve({}), { cancel: () => {} }), close: () => {}, opened: Promise.resolve() }, log };
}
const noWait = async () => {};

// A small DOM for the page scripts: elements know tag, attributes, parent and children; querySelector(All) and closest
// understand tag, #id, [attr=value], tag[attr=value], [attr="value"] and comma lists.
function el(tag, attrs = {}, children = []) {
  const node = { tagName: tag.toUpperCase(), attrs, children, parentElement: null, required: false, placeholder: '', autocomplete: '' };
  node.id = attrs.id ?? '';
  node.name = attrs.name ?? '';
  node.type = attrs.type ?? (tag === 'input' ? 'text' : tag === 'button' ? 'submit' : tag);
  node.innerText = attrs.text ?? '';
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

// M-007-fix3-N3-1a
test('M-007-fix3-N3-1a jd-store saveIfAbsent never replaces saved job text and saves when none is saved', () => {
  const r = scratch();
  try {
    assert.equal(typeof jd.saveIfAbsent, 'function', 'jd-store has saveIfAbsent');
    jd.save(r.dataDir, GH, TRIAGE_TEXT);
    jd.saveIfAbsent(r.dataDir, GH, POSTING);
    assert.equal(jd.load(r.dataDir, GH), TRIAGE_TEXT, 'the triage text stays');
    const other = 'https://boards.greenhouse.io/examplerobotics/jobs/7402';
    jd.saveIfAbsent(r.dataDir, other, POSTING);
    assert.equal(jd.load(r.dataDir, other), POSTING);
  } finally {
    r.cleanup();
  }
});

// M-007-fix3-N3-1b
test('M-007-fix3-N3-1b read-form keeps the text triage saved: the page text it read does not replace it', () => {
  const r = scratch();
  try {
    assert.equal(typeof chrome.keepRead, 'function', 'chrome.mjs exports keepRead');
    jd.save(r.dataDir, GH, TRIAGE_TEXT);
    chrome.keepRead({ dataDir: r.dataDir, url: GH, res: { fields: FIELDS, jobText: POSTING }, say: () => {} });
    assert.equal(jd.load(r.dataDir, GH), TRIAGE_TEXT);
    assert.equal(chrome.needsJobText(r.dataDir, GH), false, 'a posting with saved text needs no page text');
  } finally {
    r.cleanup();
  }
});

// M-007-fix3-N3-1c
test('M-007-fix3-N3-1c on a Lever form route the job text comes from the posting page JSON-LD, never the form labels', async () => {
  const { client, log } = tabClient((url) => (url.endsWith('/apply')
    ? { fields: FIELDS, job: { ld: [], main: LABELS } }
    : { fields: [], job: { ld: [ldOf(`<p>${POSTING}</p>`)], main: 'Apply for this job' } }));
  const res = await chrome.readForm(client, LEVER, { wait: noWait });
  assert.equal(res.fields.length, 1);
  assert.ok(log.navigated.includes(`${LEVER}/apply`), 'the form was read on /apply');
  assert.ok(log.navigated.includes(LEVER), `the posting page was read for its text: ${log.navigated.join(', ')}`);
  assert.match(String(res.jobText), /^Software Engineering Intern\n\nExample Robotics hires/);
  assert.ok(!String(res.jobText).includes('label0'), 'no form label is job text');
});

// M-007-fix3-N3-1d
test('M-007-fix3-N3-1d a form route whose posting page has no text saves no job text: the form route visible text never counts', async () => {
  const { client } = tabClient((url) => (url.endsWith('/apply') ? { fields: FIELDS, job: { ld: [], main: LABELS } } : { fields: [], job: { ld: [], main: 'Apply' } }));
  const res = await chrome.readForm(client, LEVER, { wait: noWait });
  assert.equal(res.fields.length, 1);
  assert.equal(res.jobText, undefined, `no job text: ${res.jobText}`);
});

// M-007-fix3-N3-1e
test('M-007-fix3-N3-1e read-form reads no page text when saved text exists (jobText: false)', async () => {
  const { client, log } = tabClient(() => ({ fields: FIELDS, job: { ld: [ldOf(`<p>${POSTING}</p>`)], main: '' } }));
  const res = await chrome.readForm(client, LEVER, { jobText: false, wait: noWait });
  assert.deepEqual(res, { fields: FIELDS });
  assert.ok(!log.scripts.some((s) => s.startsWith('job')), log.scripts.join(', '));
  assert.deepEqual(log.navigated, [`${LEVER}/apply`], 'only the form page was opened');
});

// M-007-fix3-N3-1f
test('M-007-fix3-N3-1f the page job script leaves out the text of the forms in main, so a form-only page has no job text', () => {
  const formText = LABELS;
  const ctx = { document: { querySelectorAll: () => [], querySelector: (s) => (s === 'main' ? { innerText: `${formText}\n`, querySelectorAll: (q) => (q === 'form' ? [{ innerText: formText }] : []) } : null), body: null } };
  const raw = runInNewContext(chrome.PAGE_JOB_SCRIPT, ctx);
  assert.equal(String(raw.main).trim(), '', `form labels left: ${raw.main}`);
  assert.equal(chrome.pageJobText(raw), '');
});

// M-007-fix3-N3-9
test('M-007-fix3-N3-9 an entity-encoded JSON-LD description loses its tags, and the main fallback follows the words budget', () => {
  const text = chrome.pageJobText({ ld: [ldOf(`&lt;p&gt;${POSTING}&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Python&lt;/li&gt;&lt;/ul&gt;`)], main: '' });
  assert.ok(text.includes('Requirements: Python'), text);
  assert.ok(!/<\/?(p|ul|li)>/.test(text), `tags left: ${text}`);
  const main = `Requirements\n${words(400, 'req')}`;
  const cut = chrome.pageJobText({ ld: [], main }, { words: 20 });
  assert.ok(cut.split(/\s+/).filter(Boolean).length <= 22, `cut to the words budget: ${cut.split(/\s+/).length} words`);
});

// M-007-fix3-N3-2a
test('M-007-fix3-N3-2a the application form is read, not a header search or footer newsletter form; a consent box in its own footer counts', async () => {
  assert.equal(typeof cdp.readApplicationForm, 'function', 'cdp exports readApplicationForm');
  const ctx = domCtx([
    el('header', {}, [el('form', { id: 'site_search' }, [input('q'), el('button', { id: 'go', type: 'submit' })])]),
    el('main', {}, [
      el('form', { id: 'apply_form' }, [
        input('first_name'), input('email', 'email'), input('token', 'hidden'), input('resume', 'file'),
        el('footer', {}, [input('consent', 'checkbox')]),
        el('button', { id: 'apply_btn', text: 'Submit application' }),
      ]),
    ]),
    el('footer', {}, [el('form', { id: 'newsletter' }, [input('news_email', 'email'), el('button', { id: 'join', type: 'submit' })])]),
  ]);
  const read = await cdp.readApplicationForm(vmClient(ctx), 'S1');
  assert.deepEqual(Array.from(read.fields, (f) => f.id), ['first_name', 'email', 'resume', 'consent']);
  assert.equal(read.form, '#apply_form');
  assert.equal(read.submit, '#apply_btn');
});

// M-007-fix3-N3-2b
test('M-007-fix3-N3-2b a page whose form is in an iframe and whose only form is a footer newsletter reads nothing', async () => {
  const ctx = domCtx([
    el('main', {}, [el('iframe', { id: 'grnhse_iframe' })]),
    el('footer', {}, [el('form', { id: 'newsletter' }, [input('news_email', 'email', { 'aria-label': 'Email address' }), el('button', { id: 'join', type: 'submit' })])]),
  ]);
  const fields = await cdp.readFormFields(vmClient(ctx), 'S1');
  assert.deepEqual(Array.from(fields), []);
});

// M-007-fix3-N3-2c
test('M-007-fix3-N3-2c forms are ranked by answerable fields: hidden, submit and button inputs do not count', async () => {
  const ctx = domCtx([
    el('main', {}, [
      el('form', { id: 'small' }, [input('a', 'hidden'), input('b', 'hidden'), input('c', 'hidden'), input('d', 'button'), input('mail', 'email'), el('button', { id: 'small_btn', type: 'submit' })]),
      el('form', { id: 'apply_form' }, [input('first_name'), input('last_name'), input('email', 'email'), el('button', { id: 'apply_btn', type: 'button' })]),
    ]),
  ]);
  assert.equal(typeof cdp.readApplicationForm, 'function', 'cdp exports readApplicationForm');
  const read = await cdp.readApplicationForm(vmClient(ctx), 'S1');
  assert.equal(read.form, '#apply_form');
  assert.deepEqual(Array.from(read.fields, (f) => f.id), ['first_name', 'last_name', 'email']);
});

// M-007-fix3-N3-2d
test('M-007-fix3-N3-2d a chosen form with no answerable field falls back to the page, with header, nav and footer inputs left out', async () => {
  const ctx = domCtx([
    el('nav', {}, [input('nav_q')]),
    el('main', {}, [el('form', { id: 'shell' }, [input('t', 'hidden'), el('button', { id: 'shell_btn', type: 'submit' })]), el('div', {}, [input('first_name'), input('email', 'email')])]),
    el('footer', {}, [input('news_email', 'email')]),
  ]);
  assert.equal(typeof cdp.readApplicationForm, 'function', 'cdp exports readApplicationForm');
  const read = await cdp.readApplicationForm(vmClient(ctx), 'S1');
  assert.deepEqual(Array.from(read.fields, (f) => f.id), ['first_name', 'email']);
  assert.equal(read.form, null);
  assert.equal(read.submit, null, 'a whole-page read saves no submit, never the shell form button');
});

// A fake filled tab for clickSubmit: inForm answers the inside-the-read-form check.
function submitTab({ inForm }) {
  const calls = [];
  const send = async (method, params = {}) => {
    calls.push(method);
    if (method === 'Target.getTargets') return { targetInfos: [{ targetId: 'T1', type: 'page', url: GH }] };
    if (method === 'Target.attachToTarget') return { sessionId: 'S1' };
    if (method !== 'Runtime.evaluate') return {};
    const expr = String(params.expression);
    calls.push(expr.slice(0, 60));
    if (expr === 'location.href') return { result: { value: GH } };
    if (expr.includes('.contains(')) return { result: { value: inForm } };
    if (expr.includes('autocomplete') && expr.includes('tagName')) return { result: { value: { tag: 'button', type: 'submit', autocomplete: '' } } };
    if (expr.includes('el.click()')) {
      calls.push('CLICK');
      return { result: { value: true } };
    }
    return { result: { value: null } };
  };
  return { client: { send }, calls };
}

// M-007-fix3-N3-8
test('M-007-fix3-N3-8 submit clicks only the read form\'s button: a submit outside it, or none recorded, is refused before any pending row', async () => {
  const d = mkdtempSync(join(tmpdir(), 'pack-m007-fix3-submit-'));
  try {
    const budget = [];
    const runner = (cmd, args) => (budget.push(args[2]), { code: 0, stdout: 'ok', stderr: '' });
    const base = { url: GH, link: GH, company: 'Example Robotics', batchId: 'b1', item: 1, planFile: join(d, '1.json'), tab: { targetId: 'T1', url: GH } };
    const outside = submitTab({ inForm: false });
    const res = await chrome.clickSubmit(outside.client, { plan: { ...base, formSelector: '#apply_form', submitSelector: '#go' }, paths: { packRoot: PACK_ROOT, root: d, dataDir: d }, item: 1, runner, wait: noWait });
    assert.equal(res.state, 'outside-form');
    assert.ok(!outside.calls.includes('CLICK'), 'nothing clicked');
    const none = submitTab({ inForm: true });
    const res2 = await chrome.clickSubmit(none.client, { plan: { ...base, formSelector: '#apply_form', submitSelector: null }, paths: { packRoot: PACK_ROOT, root: d, dataDir: d }, item: 1, runner, wait: noWait });
    assert.equal(res2.state, 'no-button');
    assert.deepEqual(budget, [], 'no pending row');
    const lines = [];
    const code = chrome.afterClick({ clicked: res, plan: base, paths: { packRoot: PACK_ROOT, root: d, dataDir: d }, flags: { batchId: 'b1', item: 1 }, action: 'apply.submit', dataDir: d, deps: { runner }, say: (l) => lines.push(l) });
    assert.equal(code, chrome.EXIT.refused);
    assert.match(lines.join('\n'), /outside the form that was read; .*finish it by hand .*; nothing was clicked/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// M-007-fix3-N3-2e
test('M-007-fix3-N3-2e the read form and its submit are saved with the fields and carried into the fill plan', async () => {
  const r = scratch();
  try {
    chrome.saveFormFields(r.dataDir, GH, FIELDS, { form: '#apply_form', submit: '#apply_btn', submitText: 'submit application' });
    assert.equal(typeof atsFields.readFormDoc, 'function', 'ats-fields exports readFormDoc');
    const doc = atsFields.readFormDoc(join(r.dataDir, atsFields.FIELDS_DIR), GH);
    assert.equal(doc.form, '#apply_form');
    assert.equal(doc.submit, '#apply_btn');
    assert.deepEqual(atsFields.readFields(join(r.dataDir, atsFields.FIELDS_DIR), GH), FIELDS, 'readFields still gives the list');
    jd.save(r.dataDir, GH, POSTING);
    const row = { url: GH, company: 'Example Robotics', title: 'Software Engineering Intern', score: 41, triage: 3.8 };
    const res = await fillPlan.fillPlans({ paths: r.paths, rows: [row], today: TODAY, deps: planDeps(r, { fieldsFor: (x) => atsFields.readFormDoc(join(r.dataDir, atsFields.FIELDS_DIR), x.url), fetchJob: async () => jd.load(r.dataDir, GH) }), say: () => {} });
    assert.equal(res.ready, 1);
    const plan = JSON.parse(readFileSync(readBatch(r.dataDir, res.ids[0]).items[0].plan, 'utf8'));
    assert.equal(plan.formSelector, '#apply_form');
    assert.equal(plan.submitSelector, '#apply_btn');
    assert.equal(plan.fields.length, 1);
  } finally {
    r.cleanup();
  }
});

// The autopilot's runner: rank-queue gives ranked; fill-plan's --rows file is captured.
function rankRunner(ranked, seen) {
  return (cmd, args) => {
    const script = basename(String(args[0]));
    if (script === 'rank-queue.mjs') return JSON.stringify(ranked);
    if (script === 'fill-plan.mjs' && args[1] === '--rows') {
      seen.rows = JSON.parse(readFileSync(args[2], 'utf8')).map((x) => x.url);
      return `fill-plan: 0 of ${seen.rows.length} ready in 0 batch(es)`;
    }
    if (script === 'chrome.mjs') seen.chrome.push(args.slice(1).join(' '));
    return '';
  };
}

// M-007-fix3-N3-3a
test('M-007-fix3-N3-3a rows kept out for no job text or a given-up form take no rank slot, and the digest names them with a guided offer', async () => {
  const r = scratch('chrome_in_schedule: no\nscore_floor: 3.0\nlimits:\n  submit_per_day: 2\n');
  try {
    const job = (n) => `https://boards.greenhouse.io/examplerobotics/jobs/75${n}`;
    const ranked = [1, 2, 3, 4].map((n) => ({ url: job(n), company: `Example Co ${n}`, title: 'Intern', score: 50 - n, triage: 4.5 }));
    // Row 1: fill-plan kept it out for no job text; row 2: its form was given up after 3 empty reads.
    const kept = await fillPlan.fillPlans({ paths: r.paths, rows: [ranked[0]], today: TODAY, deps: planDeps(r, { fieldsFor: () => FIELDS }), say: () => {} });
    assert.equal(kept.ready, 0);
    for (let k = 0; k < 3; k++) atsFields.recordEmptyRead(join(r.dataDir, atsFields.FIELDS_DIR), job(2));
    const seen = { chrome: [] };
    const res = await autopilot({ paths: r.paths, today: TODAY, deps: { runner: rankRunner(ranked, seen), out: () => {} } });
    assert.deepEqual(seen.rows, [job(3), job(4)], 'the cap is filled from the next rows');
    const text = res.lines.join('\n');
    assert.match(text, new RegExp(`Example Co 1 \\(${job(1).replace(/[.?/]/g, '\\$&')}\\): no job text`));
    assert.match(text, new RegExp(`Example Co 2 \\(${job(2).replace(/[.?/]/g, '\\$&')}\\): no application form found`));
    assert.match(text, /approve\? Type: read my kept-out postings/);
    // Once job text is saved for row 1 it is ranked again.
    jd.save(r.dataDir, job(1), POSTING);
    const seen2 = { chrome: [] };
    await autopilot({ paths: r.paths, today: '2026-11-04', deps: { runner: rankRunner(ranked, seen2), out: () => {} } });
    assert.deepEqual(seen2.rows, [job(1), job(3)]);
  } finally {
    r.cleanup();
  }
});

// M-007-fix3-N3-3b
test('M-007-fix3-N3-3b modes/apply-loop.md maps "read my kept-out postings" to chrome.mjs read-form', () => {
  const text = readFileSync(join(PACK_ROOT, 'modes', 'apply-loop.md'), 'utf8');
  assert.match(text, /read my kept-out postings[^\n]*chrome\.mjs read-form/);
});

// M-007-fix3-N3-4a
test('M-007-fix3-N3-4a read-form waits for a form that renders after load', async () => {
  const { client, log } = tabClient(() => ({ fields: (n) => (n < 3 ? [] : FIELDS), job: { ld: [], main: '' } }));
  const waits = [];
  const res = await chrome.readForm(client, GH, { wait: async (ms) => waits.push(ms) });
  assert.equal(res.fields?.length, 1, JSON.stringify(res));
  assert.equal(log.formReads, 3);
  assert.ok(waits.length >= 2);
  const empty = tabClient(() => ({ fields: [], job: { ld: [], main: '' } }));
  const spent = [];
  assert.deepEqual(await chrome.readForm(empty.client, GH, { wait: async (ms) => spent.push(ms) }), { stop: 'empty' });
  const total = spent.reduce((a, b) => a + b, 0);
  assert.ok(total > 0 && total <= 6000, `bounded wait: ${total} ms`);
});

// M-007-fix3-N3-4b
test('M-007-fix3-N3-4b a later successful read clears the give-up, and fill-plan plans a posting whose form was saved after 3 empty reads', async () => {
  const r = scratch();
  try {
    const dir = join(r.dataDir, atsFields.FIELDS_DIR);
    for (let k = 0; k < 3; k++) atsFields.recordEmptyRead(dir, GH);
    assert.equal(atsFields.formGaveUp(dir, GH), true);
    assert.equal(typeof chrome.keepRead, 'function', 'chrome.mjs exports keepRead');
    chrome.keepRead({ dataDir: r.dataDir, url: GH, res: { fields: FIELDS }, say: () => {} });
    assert.equal(atsFields.formGaveUp(dir, GH), false, 'a saved read clears the give-up');
    const other = 'https://boards.greenhouse.io/examplerobotics/jobs/7403';
    for (let k = 0; k < 3; k++) atsFields.recordEmptyRead(dir, other);
    chrome.saveFormFields(r.dataDir, other, FIELDS);
    const said = [];
    await fillPlan.fillPlans({ paths: r.paths, rows: [{ url: other, company: 'Example Robotics', role: 'Intern', score: 3.5, jobText: POSTING }], today: TODAY, deps: planDeps(r, { fieldsFor: (x) => atsFields.readFields(dir, x.url) }), say: (l) => said.push(l) });
    assert.ok(!said.some((l) => /no application form found/.test(l)), said.join('\n'));
  } finally {
    r.cleanup();
  }
});

// M-007-fix3-N3-4c
test('M-007-fix3-N3-4c the autopilot does not re-read a given-up posting for an approved unread item; it waits as finish these yourself', async () => {
  const r = scratch('chrome_in_schedule: yes\ndaily_target: 5\nscore_floor: 3.0\n');
  try {
    const row = { url: GH, company: 'Example Robotics', title: 'Software Engineering Intern', score: 41, triage: 3.8, jobText: POSTING };
    const made = await fillPlan.fillPlans({ paths: r.paths, rows: [row], today: TODAY, deps: planDeps(r, { fieldsFor: () => [] }), say: () => {} });
    const id = made.ids[0];
    await appendTsv(join(r.dataDir, 'action-log.tsv'), LOG_HEADER, [logRow({ ts: '2026-11-03T18:00:00.000Z', action: 'batch.approve', approval: 'approve all', detail: `batch=${id};items=1` })]);
    for (let k = 0; k < 3; k++) atsFields.recordEmptyRead(join(r.dataDir, atsFields.FIELDS_DIR), GH);
    const seen = { chrome: [] };
    const res = await autopilot({ paths: r.paths, today: TODAY, deps: { runner: rankRunner([], seen), chromeOpen: () => true, out: () => {} } });
    assert.ok(!seen.chrome.some((c) => c.startsWith('read-form')), seen.chrome.join('\n'));
    assert.ok(res.lines.some((l) => l.includes(`item 1 of ${id}`) && l.includes('finish these yourself')), res.lines.join('\n'));
  } finally {
    r.cleanup();
  }
});

// M-007-fix3-N3-10
test('M-007-fix3-N3-10 fill-plan --replan is handled before the rank-queue rows are read', () => {
  const src = readFileSync(join(PACK_ROOT, 'scripts', 'fill-plan.mjs'), 'utf8');
  const main = src.slice(src.indexOf('async function main()'));
  assert.ok(main.indexOf('if (flags.replan)') >= 0 && main.indexOf('if (flags.replan)') < main.indexOf('defaultRows(paths'), 'the replan branch comes first');
  assert.ok(existsSync(join(PACK_ROOT, 'scripts', 'fill-plan.mjs')));
});
