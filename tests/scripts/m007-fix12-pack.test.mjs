// M-007 fix round 12, submit-pick rule v6 amendments: every passing label names the application in every form (1c
// universal), read time and click time count passing controls with one function, a form holding an input type=image or
// a javascript: link saves no submit and is refused at click time (2d), and the 2c step and near-miss checks run over
// every control of the form, nested header, footer and nav regions and links included (2c scope). Null cases never
// reach a batch: submit null, finish these yourself with the link, 0 clicks, 0 budget calls. Fake DOM, fake CDP client
// and fake runner through the real read path, fill-plan and clickSubmit; no browser, network or model call. Fake data only.
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

function scratch() {
  const root = mkdtempSync(join(tmpdir(), 'pack-m007-fix12-'));
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

// A small DOM for the page scripts (as in the fix11 tests), with clicks recorded and textContent when a test sets it.
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
// A fake CDP client over holder.cur (so a test can swap the page mid-run).
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
const link = (id, href, text, extra = {}) => el('a', { id, href, text, ...extra });
const postBack = (id) => `javascript:__doPostBack('${id}','')`;
const body = () => [inp('first_name'), inp('a_email', 'email'), inp('cv', 'file')];
const noResume = () => [inp('full_name'), inp('a_email', 'email'), inp('a_phone', 'tel')];
const iframeApp = () => el('div', { id: 'grnhse_app' }, [el('iframe', { id: 'grnhse_iframe' })]);
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

// Read on kids, then the real clickSubmit on the same DOM (or drift(ctx)'s DOM) with a budget-runner spy.
async function readAndClick(kids, { drift } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pack-m007-fix12-click-'));
  try {
    const holder = { cur: domCtx(kids) };
    const res = await cdp.readApplicationForm(vmClient(holder), 'S1');
    const plan = { batchId: 'b1', item: 1, url: GH, link: GH, company: 'Example Robotics', role: 'Intern', score: 4, ...savedPlan(dir, res), tab: { targetId: 'T1', url: GH, sentinel: null }, planFile: join(dir, '1.json') };
    if (drift) holder.cur = drift(holder.cur);
    clicks.length = 0;
    const budget = [];
    const runner = (cmd, args) => {
      budget.push(args.slice(1, 3).join(' '));
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

// Each KEEP shape: saved with its label, not a finish-yourself plan, clicked after the apply.pending row only.
async function assertKeep(shapes) {
  for (const [name, [kids, id, label]] of Object.entries(shapes)) {
    const out = await readAndClick(kids);
    assert.deepEqual([out.res.submit, out.res.submitText], [`#${id}`, label], `${name}: ${show(out.res)}`);
    assert.equal(planFinishReason(out.plan), null, `${name}: the plan is not a finish-yourself plan`);
    assert.equal(out.clicked.state, 'clicked', `${name}: ${JSON.stringify(out.clicked)}`);
    assert.deepEqual([out.clicks, out.budget], [[id], ['log apply.pending']], name);
  }
}

// M-007-fix12-N11-1
test('M-007-fix12-N11-1 a no-resume form with a bare Submit or Send in a nested header, nav or footer saves no submit, and read and click count one set', async () => {
  await assertNull({
    'A1 no-resume page-wrapping form, footer newsletter typed Submit': [el('form', { id: 'a1' }, [el('main', {}, [...noResume(), btn('go', 'submit', 'Submit application')]), el('footer', {}, [inp('nl_email', 'email'), btn('nl_go', 'submit', 'Submit')])])],
    'A2 no-resume form, header typeless feedback Send + Apply now': [el('form', { id: 'a2' }, [el('header', {}, [inp('fb_text'), btn('fb_send', undefined, 'Send')]), ...noResume(), btn('ap', 'submit', 'Apply now')])],
    'A3 no-resume form, nav input Submit + Submit application': [el('form', { id: 'a3' }, [el('nav', {}, [inp('nav_q'), el('input', { id: 'nav_go', type: 'submit', value: 'Submit' })]), ...noResume(), btn('go', 'submit', 'Submit application')])],
  });
  // Read and click decide alike (rule v7 F3 re-runs the decision at click time): a bare footer Submit or a footer
  // control passing item 1, added before the click, is refused before apply.pending.
  const kids = () => [el('form', { id: 'a4' }, [el('main', {}, [...noResume(), btn('go', 'submit', 'Submit application')])])];
  const addFooter = (label) => (ctx) => { const f = ctx.document.querySelector('#a4'); const foot = el('footer', {}, [btn('ft_go', 'submit', label)]); foot.parentElement = f; f.children.push(foot); return ctx; };
  const plain = await readAndClick(kids(), { drift: addFooter('Submit') });
  assert.equal(plain.res.submit, '#go', show(plain.res));
  assert.equal(plain.clicked.state, 'no-button', JSON.stringify(plain.clicked));
  assert.deepEqual([plain.clicks, plain.budget], [[], []], 'refused before apply.pending');
  const out = await readAndClick(kids(), { drift: addFooter('Apply now') });
  assert.equal(out.res.submit, '#go', show(out.res));
  assert.equal(out.clicked.state, 'no-button', JSON.stringify(out.clicked));
  assert.deepEqual([out.clicks, out.budget], [[], []], 'refused before apply.pending');
});

// M-007-fix12-N11-2
test('M-007-fix12-N11-2 a form holding a javascript: link (LinkButton) or an input type=image (ImageButton) saves no submit, and a click-time one refuses', async () => {
  await assertNull({
    'G1 aspnetForm: aside Email this job input Send + LinkButton Submit application': [el('form', { id: 'aspnetForm' }, [el('aside', {}, [inp('friend_email', 'email'), el('input', { id: 'ej_send', type: 'submit', value: 'Send' })]), el('main', {}, [...body(), link('lb', postBack('lb'), 'Submit application')])])],
    'G2 aspnetForm: aside newsletter typed Submit + LinkButton Apply': [el('form', { id: 'aspnetForm' }, [el('aside', {}, [inp('nl_email', 'email'), btn('nl_go', 'submit', 'Submit')]), el('main', {}, [...body(), link('lb', postBack('lb'), 'Apply')])])],
    'G3 aspnetForm: body OTP typed Send + LinkButton Next': [el('form', { id: 'aspnetForm' }, [...body(), inp('otp_phone', 'tel'), btn('otp_send', 'submit', 'Send'), link('lb', postBack('lb'), 'Next')])],
    'G4 aspnetForm: aside newsletter typed Submit + input type=image': [el('form', { id: 'aspnetForm' }, [el('aside', {}, [inp('nl_email', 'email'), btn('nl_go', 'submit', 'Submit')]), el('main', {}, [...body(), el('input', { id: 'img_go', type: 'image', alt: 'Submit application' })])])],
    'G6 aspnetForm: footer newsletter typed Send + LinkButton Submit application': [el('form', { id: 'aspnetForm' }, [el('main', {}, [...body(), link('lb', postBack('lb'), 'Submit application')]), el('footer', {}, [inp('nl_email', 'email'), btn('nl_go', 'submit', 'Send')])])],
    'typed Submit application + a javascript: link Cancel': [el('form', { id: 'aspnetForm' }, [...body(), btn('go', 'submit', 'Submit application'), link('lb', 'JavaScript:void(0)', 'Cancel')])],
    'typed Submit application + an input type=image': [el('form', { id: 'aspnetForm' }, [...body(), btn('go', 'submit', 'Submit application'), el('input', { id: 'img', type: 'image', alt: 'Go' })])],
  });
  const kids = () => [el('form', { id: 'aspnetForm' }, [...body(), btn('go', 'submit', 'Submit application')])];
  const addImage = (ctx) => { const f = ctx.document.querySelector('#aspnetForm'); const im = el('input', { id: 'img', type: 'image' }); im.parentElement = f; f.children.push(im); return ctx; };
  const out = await readAndClick(kids(), { drift: addImage });
  assert.equal(out.res.submit, '#go', show(out.res));
  assert.equal(out.clicked.state, 'no-button', `an input type=image at click time: ${JSON.stringify(out.clicked)}`);
  assert.deepEqual([out.clicks, out.budget], [[], []]);
});

// M-007-fix12-N11-3
test('M-007-fix12-N11-3 a share, referral or contact form with a file input or resume field and a plain Submit or Send saves no submit', async () => {
  await assertNull({
    'C1 refer a friend with a friend resume file, typed Submit': [iframeApp(), el('aside', {}, [el('form', { id: 'refer' }, [inp('your_name'), inp('your_email', 'email'), inp('friend_name'), inp('friend_resume', 'file'), btn('go', 'submit', 'Submit')])])],
    'C2 contact form with an Attachment file, typed Send': [iframeApp(), el('section', {}, [el('form', { id: 'contact' }, [inp('full_name'), inp('email', 'email'), el('textarea', { id: 'message', name: 'message' }), inp('attachment', 'file'), btn('go', 'submit', 'Send')])])],
    'C3 refer form with friend_resume_link, typed Submit': [iframeApp(), el('aside', {}, [el('form', { id: 'refer3' }, [inp('your_name'), inp('your_email', 'email'), inp('friend_resume_link'), btn('go', 'submit', 'Submit')])])],
    'resume form with a plain typed Submit': [el('form', { id: 'app' }, [...body(), btn('go', 'submit', 'Submit')])],
  });
});

// M-007-fix12-M08
test('M-007-fix12-M08 a step or near-miss control in a nested footer or header region, or a step link, makes the form save no submit', async () => {
  await assertNull({
    'X1 body typed Apply (promo) + footer typed Submit for review': [el('form', { id: 'x1' }, [...body(), inp('x1_promo'), btn('x1_ap', 'submit', 'Apply'), el('footer', {}, [btn('x1_go', 'submit', 'Submit for review')])])],
    'X2 body typed Send (OTP) + footer typed Apply for this job': [el('form', { id: 'x2' }, [...body(), inp('x2_phone', 'tel'), btn('x2_send', 'submit', 'Send'), el('footer', {}, [btn('x2_go', 'submit', 'Apply for this job')])])],
    'X2 apply variant: body typed Apply + footer typed Apply for this job': [el('form', { id: 'x2a' }, [...body(), inp('x2a_promo'), btn('x2a_ap', 'submit', 'Apply'), el('footer', {}, [btn('x2a_go', 'submit', 'Apply for this job')])])],
    'X2b body typed Submit (verify) + footer input Submit and continue': [el('form', { id: 'x2b' }, [...body(), btn('x2b_sub', 'submit', 'Submit'), el('footer', {}, [el('input', { id: 'x2b_go', type: 'submit', value: 'Submit and continue' })])])],
    'X2b apply variant: body typed Apply + footer input Submit and continue': [el('form', { id: 'x2ba' }, [...body(), btn('x2ba_ap', 'submit', 'Apply'), el('footer', {}, [el('input', { id: 'x2ba_go', type: 'submit', value: 'Submit and continue' })])])],
    'X2c body typed Send + footer typeless Apply for this role': [el('form', { id: 'x2c' }, [...body(), btn('x2c_send', 'submit', 'Send'), el('footer', {}, [btn('x2c_go', undefined, 'Apply for this role')])])],
    'X2c apply variant: body typed Apply + footer typeless Apply for this role': [el('form', { id: 'x2ca' }, [...body(), btn('x2ca_ap', 'submit', 'Apply'), el('footer', {}, [btn('x2ca_go', undefined, 'Apply for this role')])])],
    'X3b body typed Send + footer typed Next and typed Search': [el('form', { id: 'x3b' }, [...body(), btn('x3b_send', 'submit', 'Send'), el('footer', {}, [btn('x3b_nx', 'submit', 'Next'), btn('x3b_s', 'submit', 'Search')])])],
    'X3b apply variant: body typed Apply + footer typed Next and typed Search': [el('form', { id: 'x3ba' }, [...body(), btn('x3ba_ap', 'submit', 'Apply'), el('footer', {}, [btn('x3ba_nx', 'submit', 'Next'), btn('x3ba_s', 'submit', 'Search')])])],
    'header typed Edit + body Submit application': [el('form', { id: 'he' }, [el('header', {}, [btn('he_ed', 'submit', 'Edit'), btn('he_s', 'submit', 'Search')]), ...body(), btn('he_go', 'submit', 'Submit application')])],
    'Y1 body typed Send (OTP) + link Next': [el('form', { id: 'y1' }, [...body(), inp('y1_phone', 'tel'), btn('y1_send', 'submit', 'Send'), link('y1_nx', '/apply/step-2', 'Next')])],
    'Y1 apply variant: body typed Apply + link Next': [el('form', { id: 'y1a' }, [...body(), btn('y1a_ap', 'submit', 'Apply'), link('y1a_nx', '/apply/step-2', 'Next')])],
    'body typed Apply + link Continue to application': [el('form', { id: 'y1c' }, [...body(), btn('y1c_ap', 'submit', 'Apply'), link('y1c_nx', '/apply/step-2', 'Continue application')])],
    'body typed Apply + footer link Apply for this job': [el('form', { id: 'yl' }, [...body(), btn('yl_ap', 'submit', 'Apply'), el('footer', {}, [link('yl_go', '/apply', 'Apply for this job')])])],
    'body typed Apply + role=link Apply for this job': [el('form', { id: 'yr' }, [...body(), btn('yr_ap', 'submit', 'Apply'), el('span', { id: 'yr_go', role: 'link', text: 'Apply for this job' })])],
  });
});

// M-007-fix12-keep
test('M-007-fix12-keep Greenhouse new board, Lever type=button, Ashby, ASP.NET wrapper, Send application, Apply, Apply now, icon-only, live-mock, a privacy link and a footer Back keep their submit and click it', async () => {
  await assertKeep({
    'Greenhouse new board': [[el('main', {}, [el('div', { 'aria-label': 'Apply' }, [el('form', { id: 'application-form' }, [inp('first_name'), inp('email', 'email'), inp('resume', 'file'), btn('attach', 'button', 'Attach'), btn('gh_submit', 'submit', 'Submit application')])])])], 'gh_submit', 'submit application'],
    Ashby: [[el('main', {}, [el('form', { id: 'ashby_application' }, [inp('_systemfield_name'), inp('_systemfield_email', 'email'), inp('_systemfield_resume', 'file'), btn('up', 'button', 'Upload File'), btn('ashby_submit', 'submit', 'Submit Application')])])], 'ashby_submit', 'submit application'],
    'X4 ASP.NET wrapper with a footer Subscribe': [[el('form', { id: 'aspnetForm' }, [el('main', {}, [inp('first_name'), inp('a_email', 'email'), inp('cv', 'file'), el('input', { id: 'btnSubmit', type: 'submit', value: 'Submit application' })]), el('footer', {}, [inp('nl_email2', 'email'), el('input', { id: 'nl', type: 'submit', value: 'Subscribe' })])])], 'btnSubmit', 'submit application'],
    'a lone typed Send application': [[el('form', { id: 'app' }, [...body(), btn('send', 'submit', 'Send application')])], 'send', 'send application'],
    'icon-only typed button with aria-label Submit application': [[el('form', { id: 'app' }, [...body(), btn('icon', 'submit', '', { 'aria-label': 'Submit application' })])], 'icon', 'submit application'],
    'Apply alone': [[el('form', { id: 'app' }, [...body(), btn('ap', 'submit', 'Apply')])], 'ap', 'apply'],
    'Apply now alone': [[el('form', { id: 'app' }, [...body(), btn('ap', 'submit', 'Apply now')])], 'ap', 'apply now'],
    'Apply now alone, no resume field': [[el('form', { id: 'app' }, [inp('full_name'), inp('a_email', 'email'), btn('ap', 'submit', 'Apply now')])], 'ap', 'apply now'],
    'live-mock typed Submit Application': [[el('form', { id: 'application_form' }, [inp('first_name'), inp('email', 'email'), inp('resume', 'file'), btn('submit_app', 'submit', 'Submit Application')])], 'submit_app', 'submit application'],
    'Y2 a link Review our privacy policy': [[el('form', { id: 'app' }, [...body(), link('pp', '/privacy', 'Review our privacy policy'), btn('go', 'submit', 'Submit application')])], 'go', 'submit application'],
    'X4c footer action bar with Back': [[el('form', { id: 'app' }, [...body(), el('footer', {}, [btn('bk', 'button', 'Back'), btn('go', 'submit', 'Submit application')])])], 'go', 'submit application'],
  });
  // Rule v7 F1b: Lever's Apply with LinkedIn is a submit-worded control beside the pick, so Lever now saves no submit.
  await assertNull({
    'Lever type=button Submit application beside Apply with LinkedIn': [el('form', { id: 'application-form' }, [inp('resume-upload-input', 'file', { name: 'resume' }), inp('n', 'text', { name: 'name' }), inp('e', 'email', { name: 'email' }), btn('li', 'button', 'Apply with LinkedIn'), btn('btn-submit', 'button', 'Submit application')])],
  });
});
