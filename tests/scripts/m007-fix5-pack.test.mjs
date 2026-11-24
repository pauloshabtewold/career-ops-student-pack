// M-007 fix round 5. N5-1: a marketing form (newsletter, talent community, SMS signup, job updates) never qualifies as
// the application form, even with two identity fields. N5-2: a plan with no saved form never clicks the page's first
// submit blindly. S-12: an in-form sign-in still stops as a sign-in. N5-5: inside the application form a type=button or
// untyped button with application-submit wording is the submit. N5-3: the outside-form message names finish these
// yourself. N5-4: the digest folds finish-yourself items older than 7 days into one count line.
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
import * as ap from '../../scripts/autopilot.mjs';
import { addFinishYourself, readBatch, updateBatch } from '../../lib/batch-file.mjs';
import { appendTsv } from '../../lib/tsv.mjs';
import { LOG_HEADER, row as logRow } from '../helpers/budget-harness.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const TODAY = '2026-11-20';
const GH = 'https://boards.greenhouse.io/examplerobotics/jobs/7501';
const GH2 = 'https://boards.greenhouse.io/examplerobotics/jobs/7502';
const words = (n, w = 'robotics') => Array.from({ length: n }, (_, i) => `${w}${i}`).join(' ');
const POSTING = `Example Robotics hires a Software Engineering Intern. Requirements: Python, SQL, testing. ${words(90)}`;
const FIELDS = [{ selector: '#email', id: 'email', name: 'email', type: 'email', label: 'Email' }];
const noWait = async () => {};
const { autopilot } = ap;
const FINISH_REPLY = 'read my finish-yourself list';

function scratch(config = '') {
  const root = mkdtempSync(join(tmpdir(), 'pack-m007-fix5-'));
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

// A small DOM for the page scripts (as in the fix4 test): tag, attributes, parent and children; querySelector(All) and
// closest understand tag, #id, [attr=value], tag[attr=value], [attr="value"] and comma lists.
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
const label = (f, text) => el('label', { for: f, text });
const btn = (id, type, text = '') => el('button', type ? { id, type, text } : { id, text });
const read = (kids) => cdp.readApplicationForm(vmClient(domCtx(kids)), 'S1');
const ids = (res) => Array.from(res.fields, (f) => f.id);
const iframe = () => el('div', { id: 'grnhse_app' }, []);

// M-007-fix5-N5-1a
test('M-007-fix5-N5-1a a marketing form with two identity fields is never the application form (r5 shapes)', async () => {
  const shapes = {
    'HubSpot name+email in a footer-styled div': [iframe(), el('div', { class: 'footer' }, [el('form', { id: 'hsForm_1' }, [label('firstname', 'First name'), input('firstname'), label('hs_email', 'Email'), input('hs_email', 'email'), el('input', { id: 'hs_submit', type: 'submit', value: 'Submit' })])])],
    'join our talent community': [iframe(), el('section', {}, [el('form', { id: 'tc' }, [input('full_name', 'text', { placeholder: 'Full name' }), input('tc_email', 'email'), btn('join', undefined, 'Join our talent community')])])],
    'email+phone SMS signup': [iframe(), el('section', {}, [el('form', { id: 'sms' }, [input('em', 'email'), input('mob', 'tel'), btn('su', 'submit', 'Sign up')])])],
    'email beside a category_name select': [el('form', { id: 'jc' }, [input('jc_email', 'email'), el('select', { id: 'category_name', name: 'category_name' }), btn('g', 'submit', 'Get updates')])],
    'newsletter by its form class with a plain Submit': [el('form', { id: 'nl', class: 'newsletter-form' }, [input('first_name'), input('nl_email', 'email'), btn('nl_go', 'submit', 'Submit')])],
  };
  for (const [name, kids] of Object.entries(shapes)) {
    const res = await read(kids);
    assert.equal(res.form, null, `${name}: ${JSON.stringify(res)}`);
    assert.equal(res.submit, null, name);
    assert.deepEqual(ids(res), [], `${name}: no marketing field is read`);
  }
});

// M-007-fix5-N5-1b
test('M-007-fix5-N5-1b Greenhouse, Lever and Ashby application forms still qualify, and a resume field is never marketing', async () => {
  const gh = await read([el('main', {}, [el('form', { id: 'application-form' }, [input('first_name'), input('last_name'), input('email', 'email'), input('phone', 'tel'), input('resume', 'file'), btn('gh_submit', 'submit', 'Submit application')])])]);
  assert.equal(gh.form, '#application-form');
  assert.equal(gh.submit, '#gh_submit');
  const lever = await read([el('form', { id: 'lever' }, [input('resume-upload-input', 'file', { name: 'resume' }), input('n', 'text', { name: 'name' }), label('n', 'Full name'), input('e', 'email', { name: 'email' }), input('p', 'tel', { name: 'phone' }), btn('btn-submit', 'submit', 'Submit application')])]);
  assert.equal(lever.form, '#lever');
  assert.equal(lever.submit, '#btn-submit');
  const ashby = await read([el('main', {}, [el('form', { id: 'ashby_application' }, [input('_systemfield_name'), input('_systemfield_email', 'email'), input('_systemfield_resume', 'file'), btn('ashby_submit', 'submit', 'Submit Application')])])]);
  assert.equal(ashby.form, '#ashby_application');
  assert.equal(ashby.submit, '#ashby_submit');
  const resumeLink = await read([el('div', { class: 'signup-section' }, [el('form', { id: 'apply_short' }, [input('full_name'), input('a_email', 'email'), label('resume_url', 'Resume link'), input('resume_url', 'url'), btn('send', 'submit', 'Submit')])])]);
  assert.equal(resumeLink.form, '#apply_short', 'a resume link field is never marketing');
});

// A filled tab for clickSubmit over a fake DOM: the button, scope and pick scripts run in the DOM; the page wording before
// the click is readable, so a passing check goes on to the pending row and the click.
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
    if (e.includes('el.click()') || e.includes('formHasField') || e.includes('.contains(') || e.includes('forFields')) return { result: { value: runInNewContext(e, ctx) } };
    if (e.includes('autocomplete') && e.includes('tagName')) return { result: { value: { tag: 'button', type: 'submit', autocomplete: '' } } };
    return { result: { value: null } };
  };
  return { client: { send }, clicked };
}
const PLAN_FIELDS = [{ selector: '#first_name', type: 'text' }, { selector: '#email', type: 'email' }];
async function clickWith(ctx, extra) {
  const d = mkdtempSync(join(tmpdir(), 'pack-m007-fix5-submit-'));
  try {
    const budget = [];
    const runner = (cmd, args) => (budget.push(args[2]), { code: 0, stdout: 'ok', stderr: '' });
    const tab = submitTab(ctx);
    const plan = { url: GH, link: GH, company: 'Example Robotics', batchId: 'b1', item: 1, planFile: join(d, '1.json'), tab: { targetId: 'T1', url: GH }, fields: PLAN_FIELDS, ...extra };
    const res = await chrome.clickSubmit(tab.client, { plan, paths: { packRoot: PACK_ROOT, root: d, dataDir: d }, item: 1, runner, wait: noWait });
    return { state: res.state, clicked: tab.clicked, budget };
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
}
const searchHeader = () => el('header', {}, [el('form', { id: 'search' }, [input('q'), btn('go', 'submit', 'Search')])]);

// M-007-fix5-N5-2a
test('M-007-fix5-N5-2a the header Search button is never clicked: a plan with no saved form is a stale read (fix8 N7-1), and a plan with its saved form clicks that form\'s submit', async () => {
  const ctx = () => domCtx([searchHeader(), el('main', {}, [el('form', { id: 'app' }, [input('first_name'), input('email', 'email'), btn('send', 'submit', 'Submit application')])])]);
  const legacy = await clickWith(ctx(), {});
  assert.equal(legacy.state, 'stale-read', JSON.stringify(legacy));
  assert.deepEqual(legacy.clicked, [], `nothing is clicked: ${JSON.stringify(legacy)}`);
  const scoped = await clickWith(ctx(), { formSelector: '#app', submitSelector: '#send', submitText: 'submit application' });
  assert.ok(!scoped.clicked.includes('go'), `the header Search button is never clicked: ${JSON.stringify(scoped)}`);
  assert.deepEqual(scoped.clicked, ['send']);
});

// M-007-fix5-N5-2b
test('M-007-fix5-N5-2b a plan with no saved form whose fields sit in no form with a safe button refuses before any pending row and goes to finish these yourself', async () => {
  const ctx = domCtx([searchHeader(), el('main', {}, [el('div', {}, [input('first_name'), input('email', 'email'), btn('apply', 'submit', 'Submit application')])])]);
  const res = await clickWith(ctx, {});
  assert.deepEqual(res.clicked, [], JSON.stringify(res));
  assert.deepEqual(res.budget, [], 'no pending row, so the approval is not spent');
  assert.equal(res.state, 'stale-read');
  const r = scratch();
  try {
    const id = await approvedBatch(r, [GH]);
    const lines = [];
    const code = chrome.afterClick({ clicked: { state: res.state }, plan: { url: GH, link: GH, company: 'Example Robotics', role: 'Software Engineering Intern', batchId: id, item: 1 }, paths: r.paths, flags: { batchId: id, item: 1 }, action: 'apply.submit', dataDir: r.dataDir, deps: {}, say: (l) => lines.push(l) });
    assert.equal(code, chrome.EXIT.refused);
    const finish = readBatch(r.dataDir, id).finishYourself ?? [];
    assert.equal(finish.length, 1);
    assert.equal(finish[0].link, GH);
    assert.equal(finish[0].reason, 'saved form read is too old; read the form again');
    assert.match(lines.join('\n'), /nothing was clicked/);
  } finally {
    r.cleanup();
  }
});

// A tab client for chrome.readForm whose page scripts run in a fake DOM (the CAPTCHA check finds nothing).
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

// M-007-fix5-S12
test('M-007-fix5-S12 an in-form sign-in (email or username plus password in a form) stops read-form as a sign-in, never as no form', async () => {
  const email = domCtx([el('main', {}, [el('form', { id: 'login' }, [input('login_email', 'email'), input('pw', 'password'), btn('li', 'submit', 'Continue')])])]);
  assert.deepEqual(await chrome.readForm(domTabClient(email), GH, { jobText: false, wait: noWait }), { stop: 'password' });
  const user = domCtx([el('main', {}, [el('form', { id: 'login' }, [input('username'), input('pw', 'password'), btn('li', 'submit', 'Sign in')])])]);
  assert.deepEqual(await chrome.readForm(domTabClient(user), GH, { jobText: false, wait: noWait }), { stop: 'password' });
});

// M-007-fix5-N5-5a
test('M-007-fix5-N5-5a inside the application form a type=button or untyped button with submit wording is the submit; outside a form it is not', async () => {
  const lever = await read([el('form', { id: 'lever' }, [input('resume-upload-input', 'file', { name: 'resume' }), input('n', 'text', { name: 'name' }), input('e', 'email', { name: 'email' }), btn('attach', 'button', 'Attach'), btn('btn-submit', 'button', 'Submit application')])]);
  assert.equal(lever.form, '#lever');
  assert.equal(lever.submit, '#btn-submit');
  const classic = await read([
    el('form', { id: 's3_upload_for_resume' }, [input('key', 'hidden'), input('file', 'file')]),
    el('form', { id: 'application_form' }, [input('first_name'), input('last_name'), input('email', 'email'), input('phone', 'tel'), el('input', { id: 'submit_app', type: 'button', value: 'Submit Application' })]),
  ]);
  assert.equal(classic.form, '#application_form', JSON.stringify(classic));
  assert.equal(classic.submit, null, 'rule v3 item 7: the resume upload sits outside the form read, so no submit is saved');
  const typed = await read([el('form', { id: 'gh' }, [input('first_name'), input('email', 'email'), input('resume', 'file'), btn('apply_btn', 'button', 'Apply'), btn('real', 'submit', 'Submit application')])]);
  assert.equal(typed.submit, null, 'rule v6 item 2: an Apply beside Submit application makes two passing controls, so none is saved');
  const linky = await read([el('form', { id: 'gh' }, [input('first_name'), input('email', 'email'), input('resume', 'file'), btn('li', 'button', 'Apply with LinkedIn')])]);
  assert.equal(linky.submit, null, 'link-style wording never counts');
  const page = await read([el('main', {}, [el('div', {}, [input('first_name'), input('email', 'email'), btn('apply', 'button', 'Submit application')])])]);
  assert.equal(page.submit, null, 'outside a form no button is saved');
});

// M-007-fix5-N5-5b
test('M-007-fix5-N5-5b submit clicks a saved type=button submit inside the form read', async () => {
  const ctx = domCtx([el('main', {}, [el('form', { id: 'lever' }, [input('first_name'), input('email', 'email'), btn('btn-submit', 'button', 'Submit application')])])]);
  const res = await clickWith(ctx, { formSelector: '#lever', submitSelector: '#btn-submit', submitText: 'submit application' });
  assert.deepEqual(res.clicked, ['btn-submit'], JSON.stringify(res));
  const outside = domCtx([el('main', {}, [el('div', {}, [input('first_name'), input('email', 'email'), btn('loose', 'button', 'Submit application')])])]);
  const refused = await clickWith(outside, { formSelector: null, submitSelector: '#loose' });
  assert.equal(refused.state, 'no-button', 'a type=button outside any form stays refused');
  assert.deepEqual(refused.clicked, []);
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

// M-007-fix5-N5-3
test('M-007-fix5-N5-3 the outside-form refusal says the item is on finish these yourself with its link, not to read and submit again', async () => {
  const r = scratch();
  try {
    const id = await approvedBatch(r, [GH]);
    const lines = [];
    chrome.afterClick({ clicked: { state: 'outside-form', detail: '#go' }, plan: { url: GH, link: GH, company: 'Example Robotics', role: 'Software Engineering Intern', batchId: id, item: 1 }, paths: r.paths, flags: { batchId: id, item: 1 }, action: 'apply.submit', dataDir: r.dataDir, deps: {}, say: (l) => lines.push(l) });
    const text = lines.join('\n');
    assert.doesNotMatch(text, /read the form again|then submit/, text);
    assert.match(text, /finish these yourself/);
    assert.ok(text.includes(GH), text);
  } finally {
    r.cleanup();
  }
});

// M-007-fix5-N5-4a
test('M-007-fix5-N5-4a the digest lists finish-yourself items added in the last 7 days in full and folds older ones into one count line', async () => {
  const r = scratch('chrome_in_schedule: yes\ndaily_target: 5\nscore_floor: 3.0\n');
  try {
    const id = await approvedBatch(r, [GH, GH2]);
    assert.equal(readBatch(r.dataDir, id).items.length, 2, 'both items in one batch');
    addFinishYourself(r.dataDir, id, { company: 'Example Robotics', role: 'Software Engineering Intern', link: GH, reason: 'no safe submit button in the form read', added: '2026-11-18' });
    addFinishYourself(r.dataDir, id, { company: 'Example Robotics', role: 'Software Engineering Intern', link: GH2, reason: 'CAPTCHA on submit', added: '2026-11-05' });
    assert.equal(readBatch(r.dataDir, id).finishYourself.find((f) => f.link === GH).added, '2026-11-18', 'the date added is saved');
    const runner = (cmd, args) => (basename(String(args[0])) === 'rank-queue.mjs' ? '[]' : '');
    const res = await autopilot({ paths: r.paths, today: TODAY, deps: { runner, chromeOpen: () => true, out: () => {} } });
    const text = res.lines.join('\n');
    assert.ok(res.lines.some((l) => l.includes('finish these yourself') && l.includes(GH) && l.includes('no safe submit button')), text);
    assert.ok(!text.includes(GH2), `the older item is folded: ${text}`);
    assert.ok(res.lines.some((l) => l.includes(`1 older jobs to finish yourself: type ${FINISH_REPLY}`)), text);
  } finally {
    r.cleanup();
  }
});

// M-007-fix5-N5-4b
test('M-007-fix5-N5-4b the finish-yourself reply is mapped in AGENTS.student.md (under its cap), docs/commands.md and apply-loop.md', () => {
  assert.equal(ap.FINISH_REPLY, FINISH_REPLY, 'autopilot.mjs exports the reply its digest offers');
  const agents = readFileSync(join(PACK_ROOT, 'AGENTS.student.md'), 'utf8');
  const row = agents.split('\n').find((l) => l.includes('`modes/apply-loop.md`'));
  assert.ok(row && row.includes(`"${FINISH_REPLY}"`), row);
  assert.ok(Buffer.byteLength(agents, 'utf8') < 8192);
  assert.ok(readFileSync(join(PACK_ROOT, 'docs', 'commands.md'), 'utf8').includes(`"${FINISH_REPLY}"`));
  assert.match(readFileSync(join(PACK_ROOT, 'modes', 'apply-loop.md'), 'utf8'), new RegExp(`${FINISH_REPLY}[^\\n]*batch\\.mjs`));
});
