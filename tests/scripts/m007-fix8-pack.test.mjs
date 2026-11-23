// M-007 fix round 8: a read whose saved submit is null is never batch-ready and goes to finish these yourself with a
// true reason (N7-2); inside a chosen form a nested header, nav, footer or contentinfo region that holds its own
// submit-worded control (not the form's chosen submit, not a helper button) is a separate small form: its non-checkbox,
// non-file inputs are not read and its controls are never the submit (N7-3, N7-4); a type=search input in a nested
// header or nav no longer excludes the form (N7-4); a file input of the chosen form is always read. Fake DOM, fake CDP
// client and fake runner; no browser, network or model call. Fake data only.
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
import * as atsFields from '../../lib/ats-fields.mjs';
import { readBatch, updateBatch } from '../../lib/batch-file.mjs';
import { appendTsv } from '../../lib/tsv.mjs';
import { LOG_HEADER, row as logRow } from '../helpers/budget-harness.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const TODAY = '2026-11-23';
const GH = 'https://boards.greenhouse.io/examplerobotics/jobs/7801';
const GH2 = 'https://boards.greenhouse.io/examplerobotics/jobs/7802';
const words = (n, w = 'robotics') => Array.from({ length: n }, (_, i) => `${w}${i}`).join(' ');
const POSTING = `Example Robotics hires a Software Engineering Intern. Requirements: Python, SQL, testing. ${words(90)}`;
const FIELDS = [{ selector: '#email', id: 'email', name: 'email', type: 'email', label: 'Email' }];
const UPLOAD_REASON = 'the resume upload sits outside the form; attach your resume and cover letter and submit it yourself';
const NO_SUBMIT_REASON = 'no safe submit button found in the form read';

function scratch(config = '') {
  const root = mkdtempSync(join(tmpdir(), 'pack-m007-fix8-'));
  const dataDir = join(root, 'data');
  mkdirSync(dataDir);
  mkdirSync(join(root, 'config'));
  writeFileSync(join(root, 'config', 'student.yml'), `timezone: America/Chicago\nonboarding:\n  complete: true\n${config}`);
  writeFileSync(join(root, 'config', 'profile.yml'), 'candidate:\n  full_name: "Jordan Testwell"\n  email: "jordan.testwell@example.com"\n');
  writeFileSync(join(root, 'cv.md'), '# Jordan Testwell\n\njordan.testwell@example.com\n\n## Experience\n- Software Intern, Example Robotics: built a Python tool\n\n## Skills\nPython, SQL\n');
  return { root, dataDir, paths: { root, dataDir, packRoot: PACK_ROOT }, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const planDeps = (r, calls = [], extra = {}) => ({
  headless: async () => ({ text: '' }),
  writeCover: async () => {
    calls.push('writeCover');
    const path = join(r.dataDir, 'letter.txt');
    writeFileSync(path, 'Dear hiring team at Example Robotics,\n\nI am applying for the Software Engineering Intern role.\n\nJordan Testwell\n');
    return path;
  },
  buildResume: async (o) => {
    calls.push('buildResume');
    mkdirSync(o.outDir, { recursive: true });
    writeFileSync(join(o.outDir, 'resume.html'), '<html><body>Jordan Testwell</body></html>');
    writeFileSync(join(o.outDir, 'resume.pdf'), '%PDF-1.4\n%%EOF\n');
    return { code: 0, html: join(o.outDir, 'resume.html'), pdf: join(o.outDir, 'resume.pdf') };
  },
  atsCheck: async () => ({ ok: true, problems: [] }),
  ...extra,
});

// A small DOM for the page scripts (as in the fix4 to fix7 tests).
function el(tag, attrs = {}, children = []) {
  const node = { tagName: tag.toUpperCase(), attrs, children, parentElement: null, required: false, placeholder: attrs.placeholder ?? '', autocomplete: '' };
  node.id = attrs.id ?? '';
  node.name = attrs.name ?? '';
  node.type = attrs.type ?? (tag === 'input' ? 'text' : tag === 'button' ? 'submit' : tag === 'select' ? 'select-one' : tag);
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
const pick = (res, form, submit, name) => assert.deepEqual([res.form, res.submit], [form, submit], `${name}: ${JSON.stringify(res)}`);

const classicGh = () => [
  el('form', { id: 's3_upload_for_resume' }, [input('key', 'hidden'), input('file', 'file')]),
  el('form', { id: 's3_upload_for_cover_letter' }, [input('key2', 'hidden'), input('file2', 'file')]),
  el('form', { id: 'application_form' }, [input('first_name'), input('last_name'), input('email', 'email'), input('phone', 'tel'), el('input', { id: 'submit_app', type: 'button', value: 'Submit Application' })]),
];
const guided = (text) => ['Next:', 'Type:', 'Why:'].every((w) => text.includes(w));

// M-007-fix8-N7-2-read
test('M-007-fix8-N7-2-read a rule 7 read says uploadOutside, and the saved read keeps it', async () => {
  const res = await read(classicGh());
  assert.equal(res.submit, null, JSON.stringify(res));
  assert.equal(res.uploadOutside, true, `the read says the upload sits outside the form: ${JSON.stringify(res)}`);
  const toggleOnly = await read([el('main', {}, [el('form', { id: 'app' }, [input('full_name'), input('a_email', 'email'), input('cv', 'file'), btn('t', 'button', '', { role: 'switch', 'aria-label': 'Send me updates' })])])]);
  assert.equal(toggleOnly.submit, null);
  assert.equal(toggleOnly.uploadOutside, undefined, 'a toggle-only form is not an upload-outside read');
  const r = scratch();
  try {
    chrome.saveFormFields(r.dataDir, GH, res.fields, res);
    const doc = atsFields.readFormDoc(join(r.dataDir, atsFields.FIELDS_DIR), GH);
    assert.equal(doc.form, '#application_form');
    assert.equal(doc.submit, null);
    assert.equal(doc.uploadOutside, true, `readFormDoc keeps uploadOutside: ${JSON.stringify(doc)}`);
  } finally {
    r.cleanup();
  }
});

// M-007-fix8-N7-2-plan
test('M-007-fix8-N7-2-plan fill-plan keeps a null-submit read out of the batch and names it on finish these yourself with a true, guided reason', async () => {
  const r = scratch();
  try {
    const calls = [];
    const lines = [];
    const reads = {
      [GH]: { fields: FIELDS, form: '#application_form', submit: null, uploadOutside: true },
      [GH2]: { fields: FIELDS, form: '#app', submit: null },
    };
    const rows = [GH, GH2].map((url) => ({ url, company: 'Example Robotics', title: 'Software Engineering Intern', score: 41, triage: 3.8, jobText: POSTING }));
    const made = await fillPlan.fillPlans({ paths: r.paths, rows, today: TODAY, deps: planDeps(r, calls, { fieldsFor: (row) => reads[row.url] }), say: (l) => lines.push(l) });
    const text = lines.join('\n');
    assert.equal(made.ready, 0, text);
    assert.deepEqual(made.ids, [], 'no batch: the student is never asked to approve an item that cannot be submitted');
    const upload = lines.find((l) => l.includes(GH) && l.includes('finish these yourself'));
    assert.ok(upload && upload.includes(UPLOAD_REASON), text);
    assert.ok(guided(upload), `guided next step on the line: ${upload}`);
    const other = lines.find((l) => l.includes(GH2) && l.includes('finish these yourself'));
    assert.ok(other && other.includes(NO_SUBMIT_REASON), text);
    assert.ok(guided(other), other);
    assert.deepEqual(calls, [], 'no resume render or letter for an item that is never submitted');
  } finally {
    r.cleanup();
  }
});

// M-007-fix8-N7-2-wait
test('M-007-fix8-N7-2-wait planWait never calls a null-submit plan ready; a plan with a saved submit is unchanged', () => {
  const r = scratch();
  try {
    const up = join(r.dataDir, 'r.pdf');
    writeFileSync(up, '%PDF-1.4\n');
    const base = { fields: FIELDS, uploads: [{ selector: '#cv', path: up }] };
    const upload = ap.planWait({ ...base, formSelector: '#application_form', submitSelector: null, uploadOutside: true });
    assert.ok(upload && upload.includes('finish these yourself') && upload.includes(UPLOAD_REASON), String(upload));
    const none = ap.planWait({ ...base, formSelector: null, submitSelector: null });
    assert.ok(none && none.includes(NO_SUBMIT_REASON), String(none));
    assert.equal(ap.planWait({ ...base, formSelector: '#app', submitSelector: '#go' }), null);
  } finally {
    r.cleanup();
  }
});

// M-007-fix8-N7-2-autopilot
test('M-007-fix8-N7-2-autopilot a saved null-submit read takes no rank slot and is named on finish these yourself; an approved null-submit plan is moved there unfilled', async () => {
  const r = scratch('chrome_in_schedule: yes\ndaily_target: 5\nscore_floor: 3.0\n');
  try {
    const made = await fillPlan.fillPlans({ paths: r.paths, rows: [{ url: GH2, company: 'Example Robotics', title: 'Software Engineering Intern', score: 41, triage: 3.8, jobText: POSTING }], today: TODAY, deps: planDeps(r, [], { fieldsFor: () => FIELDS }), say: () => {} });
    const id = made.ids[0];
    const planFile = readBatch(r.dataDir, id).items[0].plan;
    writeFileSync(planFile, JSON.stringify({ ...JSON.parse(readFileSync(planFile, 'utf8')), formSelector: '#app', submitSelector: null }));
    await appendTsv(join(r.dataDir, 'action-log.tsv'), LOG_HEADER, [logRow({ ts: `${TODAY}T18:00:00.000Z`, action: 'batch.approve', approval: 'approve all', detail: `batch=${id};items=1` })]);
    updateBatch(r.dataDir, id, (b) => ({ ...b, approved: { items: [1], words: 'approve all' } }));
    chrome.saveFormFields(r.dataDir, GH, FIELDS, { form: '#application_form', submit: null, uploadOutside: true });
    const calls = [];
    const runner = (cmd, args) => {
      const script = basename(String(args[0]));
      calls.push([script, ...args.slice(1)]);
      if (script === 'rank-queue.mjs') return JSON.stringify([{ url: GH, company: 'Example Robotics', title: 'Software Engineering Intern', score: 41, triage: 3.8 }]);
      return '';
    };
    const res = await ap.autopilot({ paths: r.paths, today: TODAY, deps: { runner, chromeOpen: () => true, out: () => {} } });
    const text = res.lines.join('\n');
    const named = res.lines.find((l) => l.includes(GH) && l.includes('finish these yourself'));
    assert.ok(named && named.includes(UPLOAD_REASON), text);
    assert.ok(guided(named), named);
    assert.ok(!calls.some((c) => c[0] === 'fill-plan.mjs'), `the row is not planned again: ${JSON.stringify(calls)}`);
    assert.ok(!calls.some((c) => c[0] === 'chrome.mjs' && ['fill', 'submit'].includes(c[1])), `nothing is filled or submitted: ${JSON.stringify(calls)}`);
    const finish = readBatch(r.dataDir, id).finishYourself ?? [];
    assert.ok(finish.some((f) => f.link === GH2 && f.reason === NO_SUBMIT_REASON), `the approved null-submit item is on finish these yourself: ${JSON.stringify(finish)}`);
    assert.ok(res.lines.some((l) => l.includes('submitted 0 of 0 approved item(s)')), text);
  } finally {
    r.cleanup();
  }
});

// M-007-fix8-N7-3
test('M-007-fix8-N7-3 a page-wrapping form reads its application fields, not the footer newsletter email; a consent box in that footer is kept', async () => {
  const res = await read([el('form', { id: 'aspnetForm' }, [
    el('main', {}, [input('first_name'), input('a_email', 'email'), input('cv', 'file'), el('input', { id: 'btnSubmit', type: 'submit', value: 'Submit application' })]),
    el('footer', {}, [input('nl_email2', 'email', { 'aria-label': 'Email' }), input('consent', 'checkbox'), el('input', { id: 'nl', type: 'submit', value: 'Subscribe' })]),
  ])]);
  pick(res, '#aspnetForm', '#btnSubmit', 'ASP.NET-style wrapper');
  assert.deepEqual(ids(res), ['first_name', 'a_email', 'cv', 'consent'], JSON.stringify(res));
});

// M-007-fix8-N7-4
test('M-007-fix8-N7-4 a wrapper with a header search: the application button is the submit, the search box is not a field; a header type=search still qualifies', async () => {
  const text = await read([el('form', { id: 'wrap' }, [
    el('header', {}, [input('q', 'text', { 'aria-label': 'Search jobs' }), el('input', { id: 'go', type: 'submit', value: 'Go' })]),
    el('main', {}, [input('first_name'), input('w_email', 'email'), input('cv', 'file'), btn('apply_btn', 'submit', 'Submit application')]),
  ])]);
  pick(text, '#wrap', '#apply_btn', 'header text search with a typed Go first');
  assert.ok(!ids(text).includes('q'), `the search box is not a field: ${JSON.stringify(text)}`);
  const typeSearch = await read([el('form', { id: 'wrap2' }, [
    el('header', {}, [el('nav', {}, [input('s', 'search'), btn('sgo', 'submit', 'Search')])]),
    el('main', {}, [input('first_name'), input('w_email', 'email'), input('cv', 'file'), btn('apply_btn', 'submit', 'Submit application')]),
  ])]);
  pick(typeSearch, '#wrap2', '#apply_btn', 'header type=search');
  assert.deepEqual(ids(typeSearch), ['first_name', 'w_email', 'cv']);
  const searchInMain = await read([el('form', { id: 'sf' }, [input('first_name'), input('s_email', 'email'), input('s', 'search'), btn('go', 'submit', 'Submit')])]);
  assert.equal(searchInMain.form, null, 'a type=search input outside a nested header or nav still excludes the form');
});

// M-007-fix8-OWN-FOOTER
test('M-007-fix8-OWN-FOOTER a form whose own footer holds the resume, a select and the real Submit reads every field and keeps the submit; a resume beside a typeless Autofill is read', async () => {
  const own = await read([el('main', {}, [el('form', { id: 'app' }, [
    input('first_name'), input('o_email', 'email'),
    el('footer', {}, [input('resume', 'file'), el('select', { id: 'how_heard' }), input('eeo_a', 'radio', { name: 'eeo' }), input('signature'), btn('go', 'submit', 'Submit application')]),
  ])])]);
  pick(own, '#app', '#go', 'own footer with the real Submit');
  assert.deepEqual(ids(own), ['first_name', 'o_email', 'resume', 'how_heard', 'eeo_a', 'signature'], JSON.stringify(own));
  const autofill = await read([el('main', {}, [el('form', { id: 'app2' }, [
    input('first_name'), input('a_email', 'email'), btn('go', 'submit', 'Submit application'),
    el('footer', {}, [input('resume', 'file'), btn('af', undefined, 'Autofill with resume')]),
  ])])]);
  pick(autofill, '#app2', '#go', 'resume beside a typeless Autofill');
  assert.ok(ids(autofill).includes('resume'), `the resume file input is read: ${JSON.stringify(autofill)}`);
  const fileInSmall = await read([el('form', { id: 'wrap3' }, [
    el('main', {}, [input('first_name'), input('w_email', 'email'), btn('apply_btn', 'submit', 'Submit application')]),
    el('footer', {}, [input('nl_email', 'email'), input('cv', 'file'), el('input', { id: 'nl', type: 'submit', value: 'Subscribe' })]),
  ])]);
  assert.ok(ids(fileInSmall).includes('cv'), `a file input of the chosen form is read wherever it sits: ${JSON.stringify(fileInSmall)}`);
  assert.ok(!ids(fileInSmall).includes('nl_email'), JSON.stringify(fileInSmall));
});
