// M-007 fix round 4. N4-1: a whole-page read saves no submit selector, and submit refuses (before any pending row) a plan
// with no saved submit, a button in a form holding none of the filled fields, or an untyped or link-style button. N4-2: a
// form is the application form only with a file input or 2+ identity fields, so a one-email newsletter or job-alert form
// never qualifies. N4-3: the no-button, outside-form and other-form refusals put the item on finish these yourself, and
// the autopilot neither refills nor resubmits it. N4-4: AGENTS.student.md maps the kept-out reply for a fresh session.
// Fake DOM, fake CDP client and fake runner; no browser, network or model call. Fake data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import * as cdp from '../../lib/cdp.mjs';
import * as chrome from '../../scripts/chrome.mjs';
import * as fillPlan from '../../scripts/fill-plan.mjs';
import { autopilot } from '../../scripts/autopilot.mjs';
import { addFinishYourself, readBatch, updateBatch } from '../../lib/batch-file.mjs';
import { KEPT_OUT_OFFER, KEPT_OUT_REPLY } from '../../lib/kept-out.mjs';
import { appendTsv } from '../../lib/tsv.mjs';
import { LOG_HEADER, row as logRow } from '../helpers/budget-harness.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const TODAY = '2026-11-03';
const GH = 'https://boards.greenhouse.io/examplerobotics/jobs/7501';
const words = (n, w = 'robotics') => Array.from({ length: n }, (_, i) => `${w}${i}`).join(' ');
const POSTING = `Example Robotics hires a Software Engineering Intern. Requirements: Python, SQL, testing. ${words(90)}`;
const FIELDS = [{ selector: '#email', id: 'email', name: 'email', type: 'email', label: 'Email' }];
const noWait = async () => {};

function scratch(config = '') {
  const root = mkdtempSync(join(tmpdir(), 'pack-m007-fix4-'));
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
const btn = (id, type, text = '') => el('button', type ? { id, type, text } : { id, text });
const read = (kids) => cdp.readApplicationForm(vmClient(domCtx(kids)), 'S1');

// M-007-fix4-N4-1a
test('M-007-fix4-N4-1a a whole-page read saves no submit: a hidden-only shell form, a save-job form or an untyped page button is never the submit', async () => {
  const shell = await read([
    el('nav', {}, [input('nav_q')]),
    el('main', {}, [el('form', { id: 'shell' }, [input('t', 'hidden'), btn('shell_btn', 'submit')]), el('div', {}, [input('first_name'), input('email', 'email'), btn('apply', 'submit')])]),
    el('footer', {}, [input('news_email', 'email')]),
  ]);
  assert.deepEqual(Array.from(shell.fields, (f) => f.id), ['first_name', 'email']);
  assert.equal(shell.form, null);
  assert.equal(shell.submit, null, 'a whole-page read saves no submit');
  const saveJob = await read([el('main', {}, [el('form', { id: 'save-job' }, [input('csrf', 'hidden'), btn('save')]), el('div', {}, [input('first_name'), input('email', 'email'), input('resume', 'file'), btn('apply', 'submit')])])]);
  assert.equal(saveJob.form, null);
  assert.equal(saveJob.submit, null);
  const untyped = await read([el('main', {}, [el('div', {}, [btn('linkedin', undefined, 'Apply with LinkedIn'), input('first_name'), input('email', 'email'), input('resume', 'file'), btn('apply', 'submit')])])]);
  assert.deepEqual(Array.from(untyped.fields, (f) => f.id), ['first_name', 'email', 'resume']);
  assert.equal(untyped.submit, null);
});

// M-007-fix4-N4-1b
test('M-007-fix4-N4-1b inside the read form an explicit submit button wins over an earlier untyped or link-style button', async () => {
  const res = await read([el('main', {}, [el('form', { id: 'apply_form' }, [
    btn('attach', undefined, 'Attach'), btn('li', 'submit', 'Apply with LinkedIn'), input('first_name'), input('email', 'email'), input('resume', 'file'), btn('send', 'submit', 'Submit application'),
  ])])]);
  assert.equal(res.form, '#apply_form');
  assert.equal(res.submit, '#send');
});

// A filled tab for clickSubmit whose submit-button check runs against a fake DOM; every other script answers like the
// fix3 fake (inside the read form: inForm).
function submitTab(ctx, { inForm = true } = {}) {
  const calls = [];
  const send = async (method, params = {}) => {
    calls.push(method);
    if (method === 'Target.getTargets') return { targetInfos: [{ targetId: 'T1', type: 'page', url: GH }] };
    if (method === 'Target.attachToTarget') return { sessionId: 'S1' };
    if (method !== 'Runtime.evaluate') return {};
    const expr = String(params.expression);
    if (expr === 'location.href') return { result: { value: GH } };
    if (expr.includes('formHasField')) return { result: { value: runInNewContext(expr, ctx) } };
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

const PLAN_FIELDS = [{ selector: '#first_name', type: 'text' }, { selector: '#email', type: 'email' }];
const appDom = (form) => domCtx([el('main', {}, [form])]);

// M-007-fix4-N4-1c
test('M-007-fix4-N4-1c submit refuses before any pending row: no saved submit, a button in a form with none of the filled fields, an untyped or link-style button', async () => {
  const d = mkdtempSync(join(tmpdir(), 'pack-m007-fix4-submit-'));
  try {
    const budget = [];
    const runner = (cmd, args) => (budget.push(args[2]), { code: 0, stdout: 'ok', stderr: '' });
    const base = { url: GH, link: GH, company: 'Example Robotics', batchId: 'b1', item: 1, planFile: join(d, '1.json'), tab: { targetId: 'T1', url: GH }, fields: PLAN_FIELDS };
    const paths = { packRoot: PACK_ROOT, root: d, dataDir: d };
    const run = async (plan, ctx, opts) => {
      const tab = submitTab(ctx, opts);
      const res = await chrome.clickSubmit(tab.client, { plan: { ...base, ...plan }, paths, item: 1, runner, wait: noWait });
      assert.ok(!tab.calls.includes('CLICK'), `nothing clicked (${res.state})`);
      return res.state;
    };
    const page = domCtx([el('main', {}, [
      el('form', { id: 'shell' }, [input('t', 'hidden'), btn('shell_btn', 'submit')]),
      el('div', {}, [btn('linkedin', undefined, 'Apply with LinkedIn'), input('first_name'), input('email', 'email')]),
    ])]);
    assert.equal(await run({ formSelector: null, submitSelector: null }, page), 'no-button', 'a whole-page plan has no saved submit');
    assert.equal(await run({ formSelector: null, submitSelector: '#shell_btn' }, page), 'other-form', 'the shell form holds none of the filled fields');
    assert.equal(await run({ formSelector: null, submitSelector: '#linkedin' }, page), 'no-button', 'an untyped button outside any form');
    const linkStyle = appDom(el('form', { id: 'apply_form' }, [input('first_name'), input('email', 'email'), btn('li', 'submit', 'Apply with LinkedIn')]));
    assert.equal(await run({ formSelector: '#apply_form', submitSelector: '#li' }, linkStyle), 'no-button', 'a link-style button');
    const share = appDom(el('form', { id: 'apply_form' }, [input('first_name'), input('email', 'email'), btn('share', 'submit', 'Share this job')]));
    assert.equal(await run({ formSelector: '#apply_form', submitSelector: '#share' }, share), 'no-button');
    assert.deepEqual(budget, [], 'no pending row, so the item is not spent');
    // A typed submit inside the form holding the filled fields passes the button check (it stops later, at the page
    // wording this fake does not give).
    const good = appDom(el('form', { id: 'apply_form' }, [input('first_name'), input('email', 'email'), btn('send', 'submit', 'Submit application')]));
    assert.equal(await run({ formSelector: '#apply_form', submitSelector: '#send' }, good), 'no-signs');
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// M-007-fix4-N4-2a
test('M-007-fix4-N4-2a a one-email job-alert or newsletter form in the body is never the application form', async () => {
  const alert = await read([el('main', {}, [
    el('section', {}, [el('form', { id: 'alerts' }, [input('alert_email', 'email'), btn('subscribe', undefined, 'Subscribe')])]),
    el('div', {}, [input('first_name'), input('email', 'email'), input('resume', 'file'), btn('apply', 'submit')]),
  ])]);
  assert.deepEqual(Array.from(alert.fields, (f) => f.id), ['first_name', 'email', 'resume']);
  assert.equal(alert.form, null);
  assert.equal(alert.submit, null);
  const iframe = await read([el('main', {}, [el('div', { id: 'grnhse_app' }, []), el('section', {}, [el('form', { id: 'news' }, [input('news_email', 'email'), btn('join', 'submit')])])])]);
  assert.deepEqual(Array.from(iframe.fields), [], 'the newsletter email is not read');
  assert.equal(iframe.submit, null);
  const contact = await read([el('main', {}, [el('form', { id: 'contact' }, [input('email', 'email'), el('textarea', { id: 'message', name: 'message' }), btn('send', 'submit')])])]);
  assert.deepEqual(Array.from(contact.fields), [], 'one identity field and no file input does not qualify');
});

// M-007-fix4-N4-2b
test('M-007-fix4-N4-2b a form with a file input, or with two identity fields (name and email, or a phone), qualifies', async () => {
  const twoIds = await read([el('main', {}, [el('form', { id: 'apply_form' }, [input('full_name'), input('phone', 'tel'), btn('go', 'submit')])])]);
  assert.equal(twoIds.form, '#apply_form');
  assert.equal(twoIds.submit, '#go');
  const file = await read([el('main', {}, [el('form', { id: 'cv_form' }, [input('cv', 'file'), btn('up', 'submit')])])]);
  assert.equal(file.form, '#cv_form');
});

// The approved batch of one ready item at GH, built by fill-plan with saved fields and job text.
async function approvedBatch(r) {
  const row = { url: GH, company: 'Example Robotics', title: 'Software Engineering Intern', score: 41, triage: 3.8, jobText: POSTING };
  const made = await fillPlan.fillPlans({ paths: r.paths, rows: [row], today: TODAY, deps: planDeps(r, { fieldsFor: () => FIELDS }), say: () => {} });
  const id = made.ids[0];
  await appendTsv(join(r.dataDir, 'action-log.tsv'), LOG_HEADER, [logRow({ ts: '2026-11-03T18:00:00.000Z', action: 'batch.approve', approval: 'approve all', detail: `batch=${id};items=1` })]);
  updateBatch(r.dataDir, id, (b) => ({ ...b, approved: { items: [1], words: 'approve all' } }));
  return id;
}

// M-007-fix4-N4-3a
test('M-007-fix4-N4-3a the no-button, outside-form and other-form refusals put the item on finish these yourself with its reason and link', async () => {
  for (const [state, detail] of [['no-button', undefined], ['outside-form', '#go'], ['other-form', '#shell_btn']]) {
    const r = scratch();
    try {
      const id = await approvedBatch(r);
      const plan = { url: GH, link: GH, company: 'Example Robotics', role: 'Software Engineering Intern', batchId: id, item: 1 };
      const lines = [];
      const code = chrome.afterClick({ clicked: { state, detail }, plan, paths: r.paths, flags: { batchId: id, item: 1 }, action: 'apply.submit', dataDir: r.dataDir, deps: {}, say: (l) => lines.push(l) });
      assert.equal(code, chrome.EXIT.refused, state);
      const finish = readBatch(r.dataDir, id).finishYourself ?? [];
      assert.equal(finish.length, 1, `${state}: ${JSON.stringify(finish)}`);
      assert.equal(finish[0].link, GH);
      assert.ok(finish[0].reason && finish[0].reason !== 'CAPTCHA', `${state} reason: ${finish[0].reason}`);
      assert.match(lines.join('\n'), /finish these yourself/);
      assert.match(lines.join('\n'), /nothing was clicked/);
    } finally {
      r.cleanup();
    }
  }
});

// M-007-fix4-N4-3b
test('M-007-fix4-N4-3b the autopilot neither refills nor resubmits an item on finish these yourself, and the digest names the reason', async () => {
  const r = scratch('chrome_in_schedule: yes\ndaily_target: 5\nscore_floor: 3.0\n');
  try {
    const id = await approvedBatch(r);
    addFinishYourself(r.dataDir, id, { company: 'Example Robotics', role: 'Software Engineering Intern', link: GH, reason: 'no safe submit button in the form read' });
    const chromeCalls = [];
    const runner = (cmd, args) => {
      const script = basename(String(args[0]));
      if (script === 'rank-queue.mjs') return '[]';
      if (script === 'chrome.mjs') chromeCalls.push(args.slice(1).join(' '));
      return '';
    };
    const res = await autopilot({ paths: r.paths, today: TODAY, deps: { runner, chromeOpen: () => true, out: () => {} } });
    assert.ok(!chromeCalls.some((c) => c.startsWith('fill') || c.startsWith('submit')), chromeCalls.join('\n'));
    const text = res.lines.join('\n');
    assert.ok(res.lines.some((l) => l.includes(`item 1 of ${id}`) && l.includes('finish these yourself') && l.includes('no safe submit button in the form read') && l.includes(GH)), text);
  } finally {
    r.cleanup();
  }
});

// M-007-fix4-N4-4
test('M-007-fix4-N4-4 every reply the autopilot offers (Type: ...) is mapped in AGENTS.student.md, which stays under its cap', () => {
  const agents = readFileSync(join(PACK_ROOT, 'AGENTS.student.md'), 'utf8');
  const offered = [...KEPT_OUT_OFFER.matchAll(/Type: (.+)$/g)].map((m) => m[1]);
  assert.deepEqual(offered, [KEPT_OUT_REPLY]);
  const row = agents.split('\n').find((l) => l.includes('`modes/apply-loop.md`'));
  for (const phrase of offered) assert.ok(row && row.includes(`"${phrase}"`), `the apply-loop row names "${phrase}": ${row}`);
  assert.ok(Buffer.byteLength(agents, 'utf8') < 8192);
  assert.match(readFileSync(join(PACK_ROOT, 'modes', 'apply-loop.md'), 'utf8'), new RegExp(`${KEPT_OUT_REPLY}[^\\n]*chrome\\.mjs read-form`));
});
