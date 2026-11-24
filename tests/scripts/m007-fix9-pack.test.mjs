// M-007 fix round 9: one submit pick for the saved submit and for the region logic. A typed submit always beats a
// typeless or type=button control, no skip promotes one over a typed submit, a region holding the form's own typed submit
// is its action bar (never separate), and helper wording is never the submit (N8-1, N8-2). The day-1 digest keeps each
// finish line (N8-3); an approved unread item whose read saves no submit moves to finish these yourself (N8-4); a
// whole-page read says so (N8-5); a plan with no formSelector key is a stale read before any fill (N8-7). Fake DOM, fake
// CDP client and fake runner; no browser, network or model call. Fake data only.
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
import { readBatch, updateBatch } from '../../lib/batch-file.mjs';
import { appendTsv } from '../../lib/tsv.mjs';
import { LOG_HEADER, row as logRow } from '../helpers/budget-harness.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const TODAY = '2026-11-23';
const GH = 'https://boards.greenhouse.io/examplerobotics/jobs/7901';
const words = (n, w = 'robotics') => Array.from({ length: n }, (_, i) => `${w}${i}`).join(' ');
const POSTING = `Example Robotics hires a Software Engineering Intern. Requirements: Python, SQL, testing. ${words(90)}`;
const FIELDS = [{ selector: '#email', id: 'email', name: 'email', type: 'email', label: 'Email' }];
const UPLOAD_REASON = 'the resume upload sits outside the form; attach your resume and cover letter and submit it yourself';
const PAGE_READ_REASON = 'no application form found on the page read; only its fields were read';
const STALE_REASON = 'saved form read is too old; read the form again';

function scratch(config = '') {
  const root = mkdtempSync(join(tmpdir(), 'pack-m007-fix9-'));
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

// A small DOM for the page scripts (as in the fix4 to fix8 tests).
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
const inp = (id, type = 'text', extra = {}) => el('input', { id, name: id, type, ...extra });
const btn = (id, type, text = '', extra = {}) => el('button', type ? { id, type, text, ...extra } : { id, text, ...extra });
const read = (kids) => cdp.readApplicationForm(vmClient(domCtx(kids)), 'S1');
const ids = (res) => Array.from(res.fields, (f) => f.id);
const show = (res) => JSON.stringify({ fields: ids(res), form: res.form, submit: res.submit });
const body = () => [inp('first_name'), inp('a_email', 'email'), inp('cv', 'file')];
const iframeApp = () => el('div', { id: 'grnhse_app' }, [el('iframe', { id: 'grnhse_iframe' })]);
const none = (res, name) => assert.deepEqual([ids(res), res.form, res.submit], [[], null, null], `${name}: ${show(res)}`);
const expect = (res, form, submit, fields, name) => assert.deepEqual([res.form, res.submit, ids(res)], [form, submit, fields], `${name}: ${show(res)}`);
const modal = (sub) => [iframeApp(), el('div', { role: 'dialog' }, [el('form', { id: 'updates' }, [
  el('header', {}, [el('h2', { text: 'Stay in the loop' }), el('button', { id: 'x', text: '', 'aria-label': 'Close' })]),
  inp('first_name'), inp('u_email', 'email'), el('footer', {}, [sub])])])];

// M-007-fix9-N8-1-reject
test('M-007-fix9-N8-1-reject a newsletter or job-alert form whose typed Subscribe sits in a nested footer or header never qualifies, even with a body Close (modal markup too)', async () => {
  const shapes = {
    'body Close, nested footer typed Subscribe': [iframeApp(), el('section', {}, [el('form', { id: 'nl' }, [inp('full_name'), inp('n_email', 'email'), btn('x', undefined, 'Close'), el('footer', {}, [btn('sub', 'submit', 'Subscribe')])])])],
    'nested footer input Subscribe only': [iframeApp(), el('section', {}, [el('form', { id: 'nl' }, [inp('full_name'), inp('n_email', 'email'), el('footer', {}, [el('input', { id: 'sub', type: 'submit', value: 'Subscribe' })])])])],
    'body No thanks, nested footer typed Get job alerts': [iframeApp(), el('section', {}, [el('form', { id: 'nl' }, [inp('full_name'), inp('n_email', 'email'), btn('x', undefined, 'No thanks'), el('footer', {}, [btn('sub', 'submit', 'Get job alerts')])])])],
    'nested header typed Subscribe, body Close': [iframeApp(), el('section', {}, [el('form', { id: 'nl' }, [el('header', {}, [btn('sub', 'submit', 'Subscribe')]), inp('full_name'), inp('n_email', 'email'), btn('x', undefined, 'Close')])])],
    'Subscribe in the body': [iframeApp(), el('section', {}, [el('form', { id: 'nl' }, [inp('full_name'), inp('n_email', 'email'), btn('x', undefined, 'Close'), btn('sub', 'submit', 'Subscribe')])])],
    'typed Sign up in a nested footer, body Close': [iframeApp(), el('section', {}, [el('form', { id: 'nl' }, [inp('full_name'), inp('n_email', 'email'), btn('x', undefined, 'Close'), el('footer', {}, [btn('sub', 'submit', 'Sign up')])])])],
    'modal: header Close, footer typed Subscribe': modal(el('button', { id: 'sub', type: 'submit', text: 'Subscribe' })),
    'modal: header Close, footer input Subscribe': modal(el('input', { id: 'sub', type: 'submit', value: 'Subscribe' })),
    'modal: header Close, footer typed Get job alerts': modal(el('button', { id: 'sub', type: 'submit', text: 'Get job alerts' })),
  };
  for (const [name, kids] of Object.entries(shapes)) none(await read(kids), name);
  const signIn = await read(modal(el('button', { id: 'sub', type: 'submit', text: 'Sign in' })));
  assert.equal(signIn.submit, null, `a modal whose typed submit reads Sign in never saves its Close button: ${show(signIn)}`);
});

// M-007-fix9-N8-1-typed
test('M-007-fix9-N8-1-typed a typed submit beats a body type=button or typeless control, wherever it sits; r7 and r8 KEEP shapes keep their submit', async () => {
  const a1 = (extra, footer = true) => [el('main', {}, [el('form', { id: 'app' }, [...body(), ...extra, ...(footer ? [el('footer', {}, [btn('go', 'submit', 'Submit application')])] : [])])])];
  // Rule v6 item 2: a body Apply beside the footer submit makes two passing controls; item 2c: a body "Submit code" looks
  // like the real submit but fails item 1, which is doubt. Neither saves a submit.
  expect(await read([el('main', {}, [el('form', { id: 'app' }, [...body(), inp('promo'), btn('ap', 'button', 'Apply'), el('footer', {}, [btn('go', 'submit', 'Submit application')])])])]), '#app', null, ['first_name', 'a_email', 'cv', 'promo'], 'A2 body type=button Apply vs typed footer submit');
  expect(await read([el('main', {}, [el('form', { id: 'app' }, [...body(), inp('code'), btn('sc', undefined, 'Submit code'), el('footer', {}, [btn('go', 'submit', 'Submit application')])])])]), '#app', null, ['first_name', 'a_email', 'cv', 'code'], 'A2 body typeless Submit code vs typed footer submit');
  expect(await read([el('main', {}, [el('form', { id: 'app' }, [...body(), inp('promo'), btn('ap', 'button', 'Apply'), btn('go', 'submit', 'Submit application')])])]), '#app', null, ['first_name', 'a_email', 'cv', 'promo'], 'A2 control without a footer (rule v6 item 2: two passing controls)');
  for (const [id, text] of [['add', 'Add another'], ['rm', 'Remove'], ['x', 'Close'], ['more', 'Show more']]) {
    expect(await read(a1([btn(id, undefined, text)])), '#app', '#go', ['first_name', 'a_email', 'cv'], `A1 body typeless ${text}`);
  }
  expect(await read([el('main', {}, [el('form', { id: 'app' }, [el('header', {}, [btn('go', 'submit', 'Submit')]), ...body(), btn('x', undefined, 'Close')])])]), '#app', null, ['first_name', 'a_email', 'cv'], 'A1 header typed Submit (rule v6 1c universal: a plain Submit never passes)');
  expect(await read([el('main', {}, [el('form', { id: 'app' }, [...body(), btn('add', undefined, 'Add another'), el('nav', {}, [btn('back', 'button', 'Back'), el('input', { id: 'go', type: 'submit', value: 'Submit' })])])])]), '#app', null, ['first_name', 'a_email', 'cv'], 'A1 nav typed input Submit (rule v6 1c universal)');
  expect(await read([el('form', { id: 'aspnetForm' }, [
    el('main', {}, [inp('first_name'), inp('a_email', 'email'), inp('cv', 'file'), el('input', { id: 'btnSubmit', type: 'submit', value: 'Submit application' })]),
    el('footer', {}, [inp('nl_email2', 'email'), el('input', { id: 'nl', type: 'submit', value: 'Subscribe' })]),
  ])]), '#aspnetForm', '#btnSubmit', ['first_name', 'a_email', 'cv'], 'ASP.NET wrapper with a footer Subscribe');
  expect(await read([el('form', { id: 'wrap' }, [
    el('header', {}, [inp('nl_email', 'email'), btn('nlsub', 'submit', 'Subscribe')]),
    el('main', {}, [inp('first_name'), inp('w_email', 'email'), inp('cv', 'file'), btn('apply', 'submit', 'Submit application')]),
  ])]), '#wrap', '#apply', ['first_name', 'w_email', 'cv'], 'wrapper with a header newsletter Subscribe first');
  expect(await read([el('form', { id: 'wrap' }, [
    el('header', {}, [inp('q', 'text', { 'aria-label': 'Search jobs' }), el('input', { id: 'go', type: 'submit', value: 'Go' })]),
    el('main', {}, [inp('first_name'), inp('w_email', 'email'), inp('cv', 'file'), btn('apply_btn', 'submit', 'Submit application')]),
  ])]), '#wrap', '#apply_btn', ['first_name', 'w_email', 'cv'], 'N7-4 header text search with typed Go');
  expect(await read([el('main', {}, [el('form', { id: 'app' }, [...body(), el('footer', {}, [el('select', { id: 'how_heard' }), inp('why_us'), btn('li', 'button', 'Apply with LinkedIn'), btn('draft', 'button', 'Save draft'), btn('go', 'submit', 'Submit application')])])])]), '#app', null, ['first_name', 'a_email', 'cv', 'how_heard', 'why_us'], 'B1 action bar (rule v7 F1b: Apply with LinkedIn, no submit)');
  expect(await read([el('main', {}, [el('form', { id: 'app' }, [...body(), el('footer', {}, [el('select', { id: 'how_heard' }), inp('why_us'), btn('draft', 'button', 'Save draft'), btn('go', 'submit', 'Submit application')])])])]), '#app', '#go', ['first_name', 'a_email', 'cv', 'how_heard', 'why_us'], 'B1 action bar without Apply with LinkedIn');
  expect(await read([el('main', {}, [el('form', { id: 'app' }, [...body(), btn('add', undefined, 'Add another'), el('footer', {}, [btn('li', 'button', 'Apply with LinkedIn'), el('select', { id: 'how_heard' }), inp('why_us'), btn('go', 'submit', 'Submit application')])])])]), '#app', null, ['first_name', 'a_email', 'cv', 'how_heard', 'why_us'], 'B2 LinkedIn first (rule v7 F1b: Apply with LinkedIn, no submit)');
  expect(await read([el('main', {}, [el('form', { id: 'app' }, [...body(), btn('add', undefined, 'Add another'), el('footer', {}, [el('select', { id: 'how_heard' }), inp('why_us'), btn('go', 'submit', 'Submit application')])])])]), '#app', '#go', ['first_name', 'a_email', 'cv', 'how_heard', 'why_us'], 'B2 without Apply with LinkedIn');
  expect(await read([el('main', {}, [el('form', { id: 'app' }, [...body(), el('footer', {}, [el('select', { id: 'how_heard' }), btn('draft', undefined, 'Save draft'), btn('go', undefined, 'Submit application')])])])]), '#app', '#go', ['first_name', 'a_email', 'cv', 'how_heard'], 'B3 untyped Submit application');
  expect(await read([el('main', {}, [el('form', { id: 'app' }, [...body(), el('div', { role: 'contentinfo' }, [inp('why_us'), btn('li', 'button', 'Apply with LinkedIn'), btn('go', 'submit', 'Submit')])])])]), '#app', null, ['first_name', 'a_email', 'cv', 'why_us'], 'B4 contentinfo action bar (rule v6 1c universal)');
  expect(await read([el('main', {}, [el('form', { id: 'app' }, [inp('first_name'), inp('o_email', 'email'), el('footer', {}, [inp('resume', 'file'), el('select', { id: 'how_heard' }), inp('eeo_a', 'radio', { name: 'eeo' }), inp('signature'), btn('go', 'submit', 'Submit')])])])]), '#app', null, ['first_name', 'o_email', 'resume', 'how_heard', 'eeo_a', 'signature'], 'C1 own footer (rule v6 1c universal)');
  expect(await read([el('main', {}, [el('form', { id: 'app' }, [...body(), btn('x', undefined, 'Close'), el('footer', {}, [inp('eeo_a', 'radio', { name: 'eeo' }), inp('signature'), btn('go', 'submit', 'Submit')])])])]), '#app', null, ['first_name', 'a_email', 'cv', 'eeo_a', 'signature'], 'C6 body Close (rule v6 1c universal)');
});

// M-007-fix9-N8-2
test('M-007-fix9-N8-2 A4, A5 and B5 read their footer fields; Add another and Upload resume are never the submit', async () => {
  expect(await read([el('form', { id: 'wrap' }, [el('header', {}, [inp('q', 'text', { placeholder: 'Search jobs' }), btn('sgo', 'submit', 'Search')]), el('main', {}, [...body(), btn('add', undefined, 'Add another'), el('footer', {}, [el('select', { id: 'how_heard' }), inp('signature'), btn('go', 'submit', 'Submit application')])])])]), '#wrap', '#go', ['first_name', 'a_email', 'cv', 'how_heard', 'signature'], 'A4 wrapper header Search + own footer Submit');
  // v4 item D accepts only a typed or application-worded submit at click time, so an untyped "Send" is not saved.
  expect(await read([el('main', {}, [el('form', { id: 'app' }, [...body(), btn('add', undefined, 'Add another'), el('footer', {}, [inp('signature'), btn('go', undefined, 'Send')])])])]), '#app', null, ['first_name', 'a_email', 'cv', 'signature'], 'A5 footer untyped Send + body Add another');
  expect(await read([el('main', {}, [el('form', { id: 'app' }, [inp('first_name'), inp('a_email', 'email'), inp('cv', 'file'), btn('up', 'submit', 'Upload resume'), el('footer', {}, [el('select', { id: 'how_heard' }), inp('signature'), btn('li', 'button', 'Apply with LinkedIn'), btn('go', 'submit', 'Submit application')])])])]), '#app', null, ['first_name', 'a_email', 'cv', 'how_heard', 'signature'], 'B5 body typed Upload resume (rule v7 F1b: Apply with LinkedIn, no submit)');
  expect(await read([el('main', {}, [el('form', { id: 'app' }, [inp('first_name'), inp('a_email', 'email'), inp('cv', 'file'), btn('up', 'submit', 'Upload resume'), el('footer', {}, [el('select', { id: 'how_heard' }), inp('signature'), btn('go', 'submit', 'Submit application')])])])]), '#app', '#go', ['first_name', 'a_email', 'cv', 'how_heard', 'signature'], 'B5 body typed Upload resume without Apply with LinkedIn');
  const helpers = await read([el('main', {}, [el('form', { id: 'app' }, [...body(), btn('add', undefined, 'Add another'), btn('up', undefined, 'Upload resume')])])]);
  assert.equal(helpers.submit, null, `a helper is never the submit: ${show(helpers)}`);
});

const finishLine = (lines, link, reason) => lines.find((l) => l.includes(link) && l.includes('finish these yourself') && l.includes(reason));

// M-007-fix9-N8-3
test('M-007-fix9-N8-3 the day-1 digest keeps each fill-plan finish line with its link', async () => {
  const r = scratch('chrome_in_schedule: yes\ndaily_target: 5\nscore_floor: 3.0\n');
  try {
    const finish = `fill-plan: Example Robotics | Intern: kept out: finish these yourself: Example Robotics (${GH}): ${UPLOAD_REASON}. Next: open the link and finish the application there yourself. Type: read my kept-out postings. Why: a submit from here would send the application without your resume and cover letter.`;
    const runner = (cmd, args) => {
      const script = basename(String(args[0]));
      if (script === 'rank-queue.mjs') return JSON.stringify([{ url: GH, company: 'Example Robotics', title: 'Intern', score: 41, triage: 3.8 }]);
      if (script === 'chrome.mjs' && args[1] === 'read-form') {
        chrome.saveFormFields(r.dataDir, GH, FIELDS, { form: '#application_form', submit: null, uploadOutside: true });
        return '';
      }
      if (script === 'fill-plan.mjs') return `${finish}\nfill-plan: 0 of 1 ready in 0 batch(es)\n`;
      return '';
    };
    const res = await ap.autopilot({ paths: r.paths, today: TODAY, deps: { runner, chromeOpen: () => true, out: () => {} } });
    const line = finishLine(res.lines, GH, UPLOAD_REASON);
    assert.ok(line && line.startsWith('prepare applications: finish these yourself: Example Robotics'), res.lines.join('\n'));
    assert.ok(res.lines.includes('prepare applications: fill-plan: 0 of 1 ready in 0 batch(es)'), res.lines.join('\n'));
  } finally {
    r.cleanup();
  }
});

// An approved single-item batch whose plan is fieldsFor's read, rewritten by over.
async function approvedItem(r, fieldsFor, over = null) {
  const made = await fillPlan.fillPlans({ paths: r.paths, rows: [{ url: GH, company: 'Example Robotics', title: 'Software Engineering Intern', score: 41, triage: 3.8, jobText: POSTING }], today: TODAY, deps: planDeps(r, { fieldsFor }), say: () => {} });
  const id = made.ids[0];
  const planFile = readBatch(r.dataDir, id).items[0].plan;
  if (over) writeFileSync(planFile, JSON.stringify(over(JSON.parse(readFileSync(planFile, 'utf8')))));
  await appendTsv(join(r.dataDir, 'action-log.tsv'), LOG_HEADER, [logRow({ ts: `${TODAY}T18:00:00.000Z`, action: 'batch.approve', approval: 'approve all', detail: `batch=${id};items=1` })]);
  updateBatch(r.dataDir, id, (b) => ({ ...b, approved: { items: [1], words: 'approve all' } }));
  return id;
}

// M-007-fix9-N8-4
test('M-007-fix9-N8-4 an approved unread item whose read saves no submit moves to finish these yourself with the true reason and link, and does not wait', async () => {
  const r = scratch('chrome_in_schedule: yes\ndaily_target: 5\nscore_floor: 3.0\n');
  try {
    const id = await approvedItem(r, () => []);
    const calls = [];
    const runner = (cmd, args) => {
      const script = basename(String(args[0]));
      calls.push([script, args[1]]);
      if (script === 'rank-queue.mjs') return '[]';
      if (script === 'chrome.mjs' && args[1] === 'read-form') chrome.saveFormFields(r.dataDir, GH, FIELDS, { form: '#application_form', submit: null, uploadOutside: true });
      return '';
    };
    const res = await ap.autopilot({ paths: r.paths, today: TODAY, deps: { runner, chromeOpen: () => true, out: () => {} } });
    const text = res.lines.join('\n');
    const finish = readBatch(r.dataDir, id).finishYourself ?? [];
    assert.ok(finish.some((f) => f.link === GH && f.reason === UPLOAD_REASON), `finish these yourself: ${JSON.stringify(finish)}`);
    assert.ok(finishLine(res.lines, GH, UPLOAD_REASON), text);
    assert.ok(!calls.some((c) => c[0] === 'fill-plan.mjs' || (c[0] === 'chrome.mjs' && ['fill', 'submit'].includes(c[1]))), JSON.stringify(calls));
    assert.ok(res.lines.includes('submit approved: submitted 0 of 0 approved item(s)'), text);
    assert.ok(!/waits/.test(text), text);
  } finally {
    r.cleanup();
  }
});

// M-007-fix9-N8-5
test('M-007-fix9-N8-5 a whole-page read (no form) is named as such on finish these yourself', async () => {
  const r = scratch();
  try {
    const lines = [];
    const made = await fillPlan.fillPlans({ paths: r.paths, rows: [{ url: GH, company: 'Example Robotics', title: 'Intern', score: 41, triage: 3.8, jobText: POSTING }], today: TODAY, deps: planDeps(r, { fieldsFor: () => ({ fields: FIELDS, form: null, submit: null }) }), say: (l) => lines.push(l) });
    assert.equal(made.ready, 0);
    assert.ok(finishLine(lines, GH, PAGE_READ_REASON), lines.join('\n'));
  } finally {
    r.cleanup();
  }
});

// M-007-fix9-V4-AB
test('M-007-fix9-V4-AB a sign-in, cookie, language, Save draft or Back pick, or a pick in doubt, saves no submit; KEEP shapes keep theirs', async () => {
  const app = () => [inp('first_name'), inp('a_email', 'email'), inp('cv', 'file')];
  const shapes = {
    'Q1 header typed Sign in + typeless body Submit application': [el('form', { id: 'q1' }, [el('header', {}, [btn('q1_login', 'submit', 'Sign in')]), el('main', {}, [...app(), btn('q1_go', undefined, 'Submit application')])])],
    'Q2 footer typed Accept cookie bar + typeless body Submit application': [el('form', { id: 'q2' }, [el('main', {}, [...app(), btn('q2_go', undefined, 'Submit application')]), el('footer', {}, [btn('q2_ok', 'submit', 'Accept')])])],
    'P8 footer typed Save draft then typed Submit application': [el('main', {}, [el('form', { id: 'p8' }, [...app(), el('footer', {}, [el('select', { id: 'p8_hear' }), btn('p8_save', 'submit', 'Save draft'), btn('p8_go', 'submit', 'Submit application')])])])],
    'Q4 body typed Save draft then typed Submit application': [el('main', {}, [el('form', { id: 'q4' }, [...app(), btn('q4_save', 'submit', 'Save draft'), btn('q4_go', 'submit', 'Submit application')])])],
    'Q5 footer typed input Back then typed Submit': [el('main', {}, [el('form', { id: 'q5' }, [...app(), el('footer', {}, [el('input', { id: 'q5_back', type: 'submit', value: 'Back' }), btn('q5_go', 'submit', 'Submit')])])])],
    'doubt: typed Next with a type=button Submit application elsewhere': [el('main', {}, [el('form', { id: 'dn' }, [...app(), btn('dn_next', 'submit', 'Next'), btn('dn_go', 'button', 'Submit application')])])],
  };
  for (const [name, kids] of Object.entries(shapes)) {
    const res = await read(kids);
    assert.ok(res.form, `${name}: the form is still read: ${show(res)}`);
    assert.equal(res.submit, null, `${name}: no submit is saved: ${show(res)}`);
  }
  const q10 = await read([el('form', { id: 'q10' }, [el('nav', {}, [el('select', { id: 'q10_lang' }), btn('q10_en', 'submit', 'Change language')]), el('main', {}, [...app(), btn('q10_go', undefined, 'Submit application')])])]);
  assert.equal(q10.submit, null, show(q10));
  assert.ok(!ids(q10).includes('q10_lang'), `the nav language select is not an application field: ${show(q10)}`);
  expect(await read([el('main', {}, [el('div', { 'aria-label': 'Apply' }, [el('form', { id: 'application-form' }, [inp('first_name'), inp('email', 'email'), inp('resume', 'file'), btn('attach', 'button', 'Attach'), btn('gh_submit', 'submit', 'Submit application')])])])]), '#application-form', '#gh_submit', ['first_name', 'email', 'resume'], 'Greenhouse new board');
  expect(await read([el('form', { id: 'application-form' }, [inp('resume-upload-input', 'file', { name: 'resume' }), inp('n', 'text', { name: 'name' }), inp('e', 'email', { name: 'email' }), btn('li', 'button', 'Apply with LinkedIn'), btn('btn-submit', 'button', 'Submit application')])]), '#application-form', null, ['resume-upload-input', 'n', 'e'], 'Lever type=button Submit application (rule v7 F1b: Apply with LinkedIn beside it, no submit)');
  expect(await read([el('main', {}, [el('form', { id: 'ashby_application' }, [inp('_systemfield_name'), inp('_systemfield_email', 'email'), inp('_systemfield_resume', 'file'), btn('up', 'button', 'Upload File'), btn('ashby_submit', 'submit', 'Submit Application')])])]), '#ashby_application', '#ashby_submit', ['_systemfield_name', '_systemfield_email', '_systemfield_resume'], 'Ashby');
  const saved = await read([el('main', {}, [el('form', { id: 'application-form' }, [inp('first_name'), inp('email', 'email'), btn('gh_submit', 'submit', 'Submit application')])])]);
  assert.equal(saved.submitText, 'submit application', `the read saves the submit's text: ${JSON.stringify(saved)}`);
  const r = scratch();
  try {
    const lines = [];
    const q1 = await read(shapes['Q1 header typed Sign in + typeless body Submit application']);
    const made = await fillPlan.fillPlans({ paths: r.paths, rows: [{ url: GH, company: 'Example Robotics', title: 'Intern', score: 41, triage: 3.8, jobText: POSTING }], today: TODAY, deps: planDeps(r, { fieldsFor: () => q1 }), say: (l) => lines.push(l) });
    assert.deepEqual(made.ids, [], 'never batch-ready, so no approval is spent');
    assert.ok(lines.some((l) => l.includes(GH) && l.includes('finish these yourself')), lines.join('\n'));
  } finally {
    r.cleanup();
  }
});

// A filled tab for clickSubmit over a fake DOM (as in the fix5 tests): page scripts run in the DOM, clicks are recorded.
function submitTab(ctx) {
  const clicked = [];
  for (const b of [...ctx.document.querySelectorAll('button'), ...ctx.document.querySelectorAll('input')]) b.click = () => clicked.push(b.id);
  const send = async (method, params = {}) => {
    if (method === 'Target.getTargets') return { targetInfos: [{ targetId: 'T1', type: 'page', url: GH }] };
    if (method === 'Target.attachToTarget') return { sessionId: 'S1' };
    if (method !== 'Runtime.evaluate') return {};
    const e = String(params.expression);
    if (e === 'location.href') return { result: { value: GH } };
    if (e.includes('signin:') && e.includes('confirm:')) return { result: { value: { confirm: 0, signin: 0, password: 0 } } };
    if (e.includes('el.click()') || e.includes('formHasField') || e.includes('.contains(')) return { result: { value: runInNewContext(e, ctx) } };
    if (e.includes('autocomplete') && e.includes('tagName')) return { result: { value: { tag: 'button', type: 'submit', autocomplete: '' } } };
    return { result: { value: null } };
  };
  return { client: { send }, clicked };
}

// M-007-fix9-V4-D
test('M-007-fix9-V4-D a saved submit whose text changed since the read is refused before apply.pending and goes to finish these yourself', async () => {
  const kids = () => [el('main', {}, [el('form', { id: 'app' }, [inp('first_name'), inp('email', 'email'), btn('go', 'submit', 'Submit application')])])];
  const ctx = domCtx(kids());
  const res = await cdp.readApplicationForm(vmClient(ctx), 'S1');
  assert.deepEqual([res.submit, res.submitText], ['#go', 'submit application']);
  ctx.document.querySelector('#go').innerText = 'Save draft';
  const tab = submitTab(ctx);
  const r = scratch();
  try {
    const made = await fillPlan.fillPlans({ paths: r.paths, rows: [{ url: GH, company: 'Example Robotics', title: 'Intern', score: 41, triage: 3.8, jobText: POSTING }], today: TODAY, deps: planDeps(r, { fieldsFor: () => ({ fields: FIELDS, form: res.form, submit: res.submit, submitText: res.submitText }) }), say: () => {} });
    const id = made.ids[0];
    const planFile = readBatch(r.dataDir, id).items[0].plan;
    const plan = { ...JSON.parse(readFileSync(planFile, 'utf8')), planFile, tab: { targetId: 'T1', url: GH } };
    assert.equal(plan.submitText, 'submit application', 'the plan carries the saved text');
    const budget = [];
    const clicked = await chrome.clickSubmit(tab.client, { plan, paths: r.paths, item: 1, runner: (cmd, args) => (budget.push(args[2]), { code: 0, stdout: '', stderr: '' }), wait: async () => {} });
    assert.equal(clicked.state, 'no-button', JSON.stringify(clicked));
    assert.deepEqual(tab.clicked, [], 'nothing clicked');
    assert.deepEqual(budget, [], 'no apply.pending row');
    const lines = [];
    const code = chrome.afterClick({ clicked, plan, paths: r.paths, flags: { batchId: id, item: 1 }, action: 'apply.submit', dataDir: r.dataDir, deps: {}, say: (l) => lines.push(l) });
    assert.equal(code, chrome.EXIT.refused);
    const finish = readBatch(r.dataDir, id).finishYourself ?? [];
    assert.ok(finish.some((f) => f.link === GH && f.reason === 'the submit button changed since the form was read; read the form again (changed-since-read)'), JSON.stringify(finish));
  } finally {
    r.cleanup();
  }
});

// M-007-fix9-N8-7
test('M-007-fix9-N8-7 a plan with fields and no formSelector key is a stale read before any fill', async () => {
  assert.ok(String(ap.planWait({ fields: FIELDS })).includes(STALE_REASON), String(ap.planWait({ fields: FIELDS })));
  const r = scratch('chrome_in_schedule: yes\ndaily_target: 5\nscore_floor: 3.0\n');
  try {
    const id = await approvedItem(r, () => FIELDS, (p) => { const { formSelector, submitSelector, ...rest } = p; return rest; });
    const calls = [];
    const runner = (cmd, args) => {
      calls.push([basename(String(args[0])), args[1]]);
      return basename(String(args[0])) === 'rank-queue.mjs' ? '[]' : '';
    };
    const res = await ap.autopilot({ paths: r.paths, today: TODAY, deps: { runner, chromeOpen: () => true, out: () => {} } });
    assert.ok(!calls.some((c) => c[0] === 'chrome.mjs' && ['fill', 'submit'].includes(c[1])), JSON.stringify(calls));
    const finish = readBatch(r.dataDir, id).finishYourself ?? [];
    assert.ok(finish.some((f) => f.link === GH && f.reason === STALE_REASON), JSON.stringify(finish));
    assert.ok(finishLine(res.lines, GH, STALE_REASON), res.lines.join('\n'));
  } finally {
    r.cleanup();
  }
});
