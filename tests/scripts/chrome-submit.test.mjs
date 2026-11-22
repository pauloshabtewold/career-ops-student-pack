// scripts/chrome.mjs submit and fill after the M-002 review fixes, plus the fact-gate ruling, password mapping,
// setup-flow state helpers and the cdp form-field selector. Fake CDP client and fake runner only: no browser, no
// network, fake data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterClick, clickSubmit, checkboxState, fillPlan, outcomeCheck, resolveSubmitPlan, EXIT } from '../../scripts/chrome.mjs';
import { LockTimeoutError } from '../../lib/dir-lock.mjs';
import { writeBatches, updateBatch, addFinishYourself, readBatch } from '../../lib/batch-file.mjs';
import { readFormFields } from '../../lib/cdp.mjs';
import { check } from '../../lib/fact-gate.mjs';
import { mapField, SENSITIVE_KEY } from '../../lib/ats-fields.mjs';
import { pipelineState, readSetupState } from '../../scripts/setup-flow.mjs';
import { PACK_ROOT as W } from '../helpers/script-harness.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'm002-fix-'));
const link = (n) => `https://boards.greenhouse.io/examplerobotics/jobs/${4000 + n}`;

// A batch of n items with plan files written the way fill-plan.mjs writes them.
function batchWithPlans(dataDir, n) {
  const [id] = writeBatches(dataDir, { date: '2026-11-03', kind: 'apply', items: Array.from({ length: n }, (_, i) => ({ company: `Example Co ${i + 1}`, role: 'Data Intern', score: 4.1, preview: 'Fake.', link: link(i + 1) })) });
  updateBatch(dataDir, id, (b) => ({
    ...b,
    items: b.items.map((it, k) => {
      const file = join(dataDir, 'fill-plans', id, `${k + 1}.json`);
      mkdirSync(join(dataDir, 'fill-plans', id), { recursive: true });
      writeFileSync(file, JSON.stringify({ batchId: id, item: k + 1, url: it.link, link: it.link, company: it.company, role: it.role, score: 4.1, fields: [] }));
      return { ...it, plan: file };
    }),
  }));
  return id;
}

test('M1 after a pre-approval CAPTCHA renumbers the page, item 2 resolves to the job now on line 2, never the old 2.json', () => {
  const d = tmp();
  try {
    const id = batchWithPlans(d, 4);
    addFinishYourself(d, id, { company: 'Example Co 2', role: 'Data Intern', link: link(2) });
    const got = resolveSubmitPlan(d, id, 2);
    assert.equal(got.plan.link, link(3), 'line 2 is now job 3');
    assert.equal(resolveSubmitPlan(d, id, 3).plan.link, link(4));
    assert.match(resolveSubmitPlan(d, id, 4).problem, /no item 4/);
    // A plan file whose link differs from the approved line is refused.
    const b = readBatch(d, id);
    writeFileSync(b.items[0].plan, JSON.stringify({ url: link(9), link: link(9), company: 'Other' }));
    assert.match(resolveSubmitPlan(d, id, 1).problem, /not the approved/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// Fake CDP: one page target T1 at url; evaluate answers by expression kind.
function fakeTab({ targets = [{ targetId: 'T1', type: 'page', url: 'https://x.test/form' }], href = 'https://x.test/form', fieldValue = 'Jordan', captcha = null, outcome = { state: 'confirmed', detail: 'confirmation text' }, signs = { confirm: 0, signin: 0, password: 0 } } = {}) {
  const calls = [];
  const send = async (method, params = {}) => {
    calls.push({ method, params });
    if (method === 'Target.getTargets') return { targetInfos: targets };
    if (method === 'Target.attachToTarget') return { sessionId: 'S1' };
    if (method === 'Page.captureScreenshot') return { data: '' };
    if (method !== 'Runtime.evaluate') return {};
    const e = String(params.expression);
    if (e === 'location.href') return { result: { value: href } };
    if (e.includes('confirmation text')) return { result: { value: outcome } };
    if (e.includes('return signs;')) return { result: { value: signs } };
    if (e.includes('grecaptcha-badge')) return { result: { value: captcha } };
    if (e.includes("el.type === 'file'")) return { result: { value: fieldValue } };
    if (e.includes('autocomplete: (el.autocomplete')) return { result: { value: { tag: 'button', type: 'submit', autocomplete: '' } } };
    return { result: { value: true } };
  };
  return { send, calls };
}

const fakeRunner = (codes = {}) => {
  const calls = [];
  const run = (_node, args) => {
    calls.push(args.slice(1, 3).join(' '));
    return { code: codes[args.slice(1, 3).join(' ')] ?? 0, stdout: 'ok', stderr: '' };
  };
  return { run, calls };
};

const plan = (d, tab) => ({ batchId: 'b1', item: 1, url: 'https://x.test/form', link: 'https://x.test/form', company: 'Example Robotics', role: 'Intern', planFile: join(d, '1.json'), tab });
const TAB = { targetId: 'T1', url: 'https://x.test/form', sentinel: { selector: '#first_name', value: 'Jordan' } };
const noWait = async () => {};

test('M2 submit clicks only in the recorded tab: no tab, a gone tab, a moved tab or an emptied form refuses before any pending row', async () => {
  const d = tmp();
  try {
    const cases = [
      [plan(d, undefined), fakeTab(), 'no-tab'],
      [plan(d, TAB), fakeTab({ targets: [{ targetId: 'T9', type: 'page', url: 'https://x.test/form' }] }), 'no-tab'],
      [plan(d, TAB), fakeTab({ href: 'https://x.test/other' }), 'tab-moved'],
      [plan(d, TAB), fakeTab({ fieldValue: '' }), 'not-filled'],
    ];
    for (const [p, client, want] of cases) {
      const r = fakeRunner();
      const res = await clickSubmit(client, { plan: p, paths: { packRoot: W, root: d, dataDir: d }, item: 1, runner: r.run, wait: noWait });
      assert.equal(res.state, want);
      assert.deepEqual(r.calls, [], 'no budget call, so no pending row');
      assert.ok(!client.calls.some((c) => String(c.params.expression ?? '').includes('el.click(); return true')), 'nothing clicked');
      assert.equal(afterClick({ clicked: res, plan: p, paths: {}, flags: { batchId: 'b1', item: 1 }, action: 'apply.submit', dataDir: d, say: () => {} }), EXIT.refused);
    }
    const r = fakeRunner();
    const ok = await clickSubmit(fakeTab(), { plan: plan(d, TAB), paths: { packRoot: W, root: d, dataDir: d }, item: 1, runner: r.run, wait: noWait });
    assert.equal(ok.state, 'clicked');
    assert.deepEqual(r.calls, ['log apply.pending']);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('M5 only a confirmed page logs apply.submit; a CAPTCHA on submit goes to finish-yourself; a form error or no signal is never logged as submitted', async () => {
  const d = tmp();
  try {
    const id = batchWithPlans(d, 1);
    const run = async (outcome) => {
      const r = fakeRunner();
      const p = { ...plan(d, TAB), batchId: id };
      const clicked = await clickSubmit(fakeTab({ outcome }), { plan: p, paths: { packRoot: W, root: d, dataDir: d }, item: 1, runner: r.run, wait: noWait });
      const lines = [];
      const code = afterClick({ clicked, plan: { ...p, link: link(1) }, paths: { packRoot: W, root: d, dataDir: d }, flags: { batchId: id, item: 1 }, action: 'apply.submit', dataDir: d, deps: { runner: r.run }, say: (l) => lines.push(l) });
      return { code, calls: r.calls, text: lines.join('\n') };
    };
    const ok = await run({ state: 'confirmed', detail: 'confirmation text' });
    assert.equal(ok.code, EXIT.ok);
    assert.deepEqual(ok.calls, ['log apply.pending', 'log apply.submit']);
    const cap = await run({ state: 'captcha', detail: 'captcha frame' });
    assert.equal(cap.code, EXIT.captcha);
    assert.deepEqual(cap.calls, ['log apply.pending']);
    assert.ok(readBatch(d, id).finishYourself.some((f) => f.link === link(1)), 'job on finish these yourself with its link');
    const bad = await run({ state: 'invalid', detail: 'School' });
    assert.equal(bad.code, EXIT.needsUser);
    assert.deepEqual(bad.calls, ['log apply.pending']);
    assert.match(bad.text, /not submitted.*School/);
    const none = await run({ state: 'waiting' });
    assert.equal(none.code, EXIT.needsUser, 'no decision within the wait');
    assert.deepEqual(none.calls, ['log apply.pending']);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('S1 checkbox answers map yes/no explicitly; "No" never ticks a box; radios go through option matching', async () => {
  assert.equal(checkboxState('No'), false);
  assert.equal(checkboxState('Yes'), true);
  assert.equal(checkboxState('decline'), false);
  assert.equal(checkboxState(true), true);
  assert.equal(checkboxState('maybe'), null);
  const client = fakeTab({ targets: [{ targetId: 'T1', type: 'page', url: 'https://x.test/form' }] });
  const res = await fillPlan(client, { url: 'https://x.test/form', fields: [{ selector: '#spons', label: 'Do you require sponsorship?', type: 'checkbox', value: 'No' }, { selector: '[name="gender"]', label: 'Gender', type: 'radio', value: 'decline' }] }, { dataDir: tmp() });
  const exprs = client.calls.map((c) => String(c.params.expression ?? ''));
  assert.ok(exprs.some((e) => e.includes('#spons') && e.includes('el.checked !== false')), 'checkbox set to unchecked');
  assert.ok(exprs.some((e) => e.includes('"decline"') && e.includes('prefer not')), 'radio picks the decline option');
  assert.equal(res.filled, 2);
});

test('N3 a password field is skipped as blocked-on-user and the rest of the form is still filled', async () => {
  const calls = [];
  const client = {
    calls,
    send: async (method, params = {}) => {
      calls.push({ method, params });
      if (method === 'Target.getTargets') return { targetInfos: [{ targetId: 'T1', type: 'page', url: 'https://x.test/form' }] };
      if (method === 'Target.attachToTarget') return { sessionId: 'S1' };
      if (method !== 'Runtime.evaluate') return {};
      const e = String(params.expression);
      if (e.includes('grecaptcha-badge')) return { result: { value: null } };
      if (e.includes('autocomplete: (el.autocomplete')) return { result: { value: e.includes('#pw') ? { type: 'password', autocomplete: '' } : { type: 'text', autocomplete: '' } } };
      return { result: { value: true } };
    },
  };
  const res = await fillPlan(client, { url: 'https://x.test/form', fields: [{ selector: '#pw', label: 'Password', type: 'text', value: 'fake-secret-1' }, { selector: '#email', label: 'Email', type: 'text', value: 'jordan.testwell@example.com' }] }, { dataDir: tmp() });
  assert.equal(res.code, EXIT.needsUser);
  assert.equal(res.filled, 1);
  assert.ok(res.problems.some((p) => /blocked-on-user: Password is a password field/.test(p)));
  assert.ok(!calls.some((c) => String(c.params.expression ?? '').includes('fake-secret-1')));
});

test('M6 ruling (r4): a claim grounded only by the posting is flagged, and so is a company statement naming a tool the cv lacks', () => {
  const cv = '# Jordan Testwell\n- Software Intern, Example Robotics: built a Python scheduling tool\nSkills: Python, SQL\n';
  const posting = 'Wingtip Data uses Tableau and wants 3+ years of SQL. The Analytics Platform team ships weekly.';
  const src = { cv, answers: {}, posting, company: 'Wingtip Data', role: 'Data Analyst Intern' };
  assert.deepEqual(check('I built Tableau dashboards.', src).map((x) => x.toLowerCase()), ['tableau']);
  assert.deepEqual(check('Your team uses Tableau.', src), ['Tableau']);
  assert.deepEqual(check('Wingtip Data uses Tableau.', src), ['Tableau']);
  assert.deepEqual(check('Wingtip Data uses Python.', src), []);
  assert.deepEqual(check('I have 3 years of SQL.', src), ['3']);
  assert.deepEqual(check('I joined the Analytics Platform team.', src), ['Analytics Platform']);
  assert.deepEqual(check('I want to join Wingtip Data as a Data Analyst Intern.', src), []);
  assert.deepEqual(check('At Example Robotics I built a Python scheduling tool.', src), []);
});

test('M4 mapField gives a type=password field the sensitive key whatever its label', () => {
  assert.equal(mapField({ label: 'Choose one', name: 'x', type: 'password' }, { ats: 'workday' }).key, SENSITIVE_KEY);
  assert.equal(mapField({ label: 'Verify New Password', name: 'x', type: 'text' }, { ats: 'workday' }).key, SENSITIVE_KEY);
});

test('N6 pipelineState counts unknown questions of waiting batches and drops ones the answer bank now covers', () => {
  const d = tmp();
  try {
    const id = batchWithPlans(d, 2);
    const b = readBatch(d, id);
    writeFileSync(b.items[0].plan, JSON.stringify({ ...JSON.parse(readFileSync(b.items[0].plan, 'utf8')), unknown: ['Favorite board game?', 'Why us?'] }));
    writeFileSync(b.items[1].plan, JSON.stringify({ ...JSON.parse(readFileSync(b.items[1].plan, 'utf8')), unknown: ['Why us?'] }));
    assert.equal(pipelineState(d).unknownQuestions, 2);
    assert.equal(pipelineState(d, { answers: { questions: { 'why us': 'Fake answer.' } } }).unknownQuestions, 1);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('N7 a corrupt setup-state.json reads as nothing done instead of throwing', () => {
  const d = tmp();
  try {
    writeFileSync(join(d, 'setup-state.json'), '{not json');
    assert.deepEqual(readSetupState(d), { signins: {} });
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('N2 readFormFields escapes a name with a quote in the [name=...] selector it builds', async () => {
  const el = { id: '', name: 'answer"1', type: 'text', tagName: 'INPUT', required: false, autocomplete: '', placeholder: '', closest: () => null, getAttribute: () => null };
  const document = { querySelectorAll: () => [el], querySelector: () => null };
  const CSS = { escape: (s) => String(s).replace(/["\\]/g, '\\$&') };
  const client = { send: async (method, params) => ({ result: { value: method === 'Runtime.evaluate' ? runInNewContext(params.expression, { document, CSS }) : undefined } }) };
  const [field] = await readFormFields(client, 'S1');
  assert.equal(field.selector, '[name="answer\\"1"]');
});

// A page whose scripts really run: every Runtime.evaluate executes in a vm against a fake document. The submit button's
// click swaps in the after page. before/after = { text, password: n, href, invalid: [labels] }.
function vmTab({ before, after }) {
  const state = { page: { password: 0, invalid: [], ...before } };
  const location = { get href() {
    return state.page.href ?? 'https://x.test/form';
  } };
  const field = (value) => ({ value, type: 'text', tagName: 'INPUT' });
  const button = { tagName: 'BUTTON', type: 'submit', autocomplete: '', click: () => {
    state.page = { password: 0, invalid: [], ...after };
  } };
  const document = {
    get body() {
      return { innerText: state.page.text };
    },
    querySelector: (sel) => (sel === '#first_name' ? field('Jordan') : sel.includes('[type=submit]') ? (state.page.button === false ? null : button) : null),
    querySelectorAll: (sel) => {
      if (sel === 'input[type=password]') return Array.from({ length: state.page.password }, () => ({}));
      if (sel === 'input, select, textarea') return state.page.invalid.map((name) => ({ name, id: '', disabled: false, type: 'text', matches: () => true, getAttribute: () => null, closest: () => null }));
      return [];
    },
  };
  const CSS = { escape: (s) => String(s) };
  const send = async (method, params = {}) => {
    if (method === 'Target.getTargets') return { targetInfos: [{ targetId: 'T1', type: 'page', url: 'https://x.test/form' }] };
    if (method === 'Target.attachToTarget') return { sessionId: 'S1' };
    if (method === 'Page.captureScreenshot') return { data: '' };
    if (method !== 'Runtime.evaluate') return {};
    return { result: { value: runInNewContext(params.expression, { document, location, CSS, getComputedStyle: () => ({}) }) } };
  };
  return { send };
}

async function submitOn(d, id, pages) {
  const r = fakeRunner();
  const p = { ...plan(d, TAB), batchId: id, link: link(1) };
  const clicked = await clickSubmit(vmTab(pages), { plan: p, paths: { packRoot: W, root: d, dataDir: d }, item: 1, runner: r.run, wait: noWait });
  const lines = [];
  const code = afterClick({ clicked, plan: p, paths: { packRoot: W, root: d, dataDir: d }, flags: { batchId: id, item: 1 }, action: 'apply.submit', dataDir: d, deps: { runner: r.run }, say: (l) => lines.push(l) });
  return { code, clicked, calls: r.calls, text: lines.join('\n'), finish: readBatch(d, id).finishYourself };
}

test('S-A confirmation text already on the page before the click never confirms; only wording the click added does', async () => {
  const d = tmp();
  try {
    const id = batchWithPlans(d, 1);
    const desc = 'Data Intern at Example Robotics. Thank you for applying to Example Robotics! Submit below.';
    const stale = await submitOn(d, id, { before: { text: desc }, after: { text: desc } });
    assert.equal(stale.clicked.outcome.state, 'unconfirmed');
    assert.equal(stale.code, EXIT.needsUser);
    assert.deepEqual(stale.calls, ['log apply.pending'], 'not logged as submitted');
    assert.ok(stale.finish.some((f) => f.link === link(1) && /clicked, not confirmed/.test(f.reason)), 'on finish these yourself');

    const d2 = tmp();
    try {
      const id2 = batchWithPlans(d2, 1);
      const fresh = await submitOn(d2, id2, { before: { text: desc }, after: { text: `${desc}\nThank you for applying. We have received your application.`, href: 'https://x.test/done' } });
      assert.equal(fresh.clicked.outcome.state, 'confirmed');
      assert.equal(fresh.code, EXIT.ok);
      assert.deepEqual(fresh.calls, ['log apply.pending', 'log apply.submit']);
    } finally {
      rmSync(d2, { recursive: true, force: true });
    }
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('S-A a submit that lands on a sign-in or create-account page, or a page with only a new address, is unconfirmed', async () => {
  const cases = [
    { text: 'Sign in to continue. Email Password Forgot your password?', password: 1, href: 'https://x.test/login', button: false },
    { text: 'Create an account to finish your application. Thank you for applying!', password: 1, href: 'https://x.test/signup', button: false },
    { text: 'Welcome. Your dashboard.', href: 'https://x.test/home', button: false },
  ];
  for (const after of cases) {
    const d = tmp();
    try {
      const id = batchWithPlans(d, 1);
      const res = await submitOn(d, id, { before: { text: 'Data Intern application form. First name.' }, after });
      assert.equal(res.clicked.outcome.state, 'unconfirmed', after.text);
      assert.equal(res.code, EXIT.needsUser);
      assert.deepEqual(res.calls, ['log apply.pending'], 'never logged as submitted');
      assert.ok(res.finish.some((f) => f.link === link(1)), 'on finish these yourself');
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  }
});

test('S-A a field error is reported before any confirmation wording; S-B the refused item goes to finish these yourself', async () => {
  const d = tmp();
  try {
    const id = batchWithPlans(d, 1);
    const res = await submitOn(d, id, { before: { text: 'Form.' }, after: { text: 'Thank you for applying! School is required.', invalid: ['school'] } });
    assert.equal(res.clicked.outcome.state, 'invalid');
    assert.equal(res.code, EXIT.needsUser);
    assert.deepEqual(res.calls, ['log apply.pending']);
    assert.ok(res.finish.some((f) => f.link === link(1) && /form refused: school/.test(f.reason)), JSON.stringify(res.finish));
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('NIT a plan for another link exits 3, and a job on finish these yourself is never submitted by automation', async () => {
  const { main } = await import('../../scripts/chrome.mjs');
  const d = tmp();
  try {
    const id = batchWithPlans(d, 2);
    const r = fakeRunner();
    const b = readBatch(d, id);
    writeFileSync(b.items[0].plan, JSON.stringify({ url: link(9), link: link(9), company: 'Other' }));
    const lines = [];
    const argv = (n) => ['submit', '--batch-id', id, '--item', String(n), '--root', d, '--data-dir', d];
    assert.equal(await main(argv(1), { runner: r.run, say: (l) => lines.push(l) }), EXIT.refused);
    // Approved, then a CAPTCHA before the click: the job stays numbered but is the student's now.
    updateBatch(d, id, (x) => ({ ...x, approved: { items: [1, 2], words: 'approve all' } }));
    addFinishYourself(d, id, { company: 'Example Co 2', role: 'Data Intern', link: link(2) });
    assert.equal(await main(argv(2), { runner: r.run, say: (l) => lines.push(l) }), EXIT.refused);
    assert.match(lines.join('\n'), /finish these yourself/);
    assert.deepEqual(r.calls, [], 'no budget call, nothing clicked');
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('NIT "decline" ticks a checkbox that is itself the decline choice and leaves any other box unticked', () => {
  assert.equal(checkboxState('decline', 'I do not wish to self-identify'), true);
  assert.equal(checkboxState('decline', 'I prefer not to answer'), true);
  assert.equal(checkboxState('decline', 'I am a protected veteran'), false);
  assert.equal(checkboxState('No', 'I do not wish to self-identify'), false);
});

test('NIT r2: a missing or partial before-click count makes the outcome unconfirmed, never a confirmation', () => {
  const document = { body: { innerText: 'Thank you for applying. We have received your application.' }, querySelector: () => null, querySelectorAll: () => [] };
  const outcome = (before) => runInNewContext(outcomeCheck(before), { document, CSS: { escape: String }, getComputedStyle: () => ({}) });
  for (const before of [undefined, null, {}, { confirm: 0 }, 'x']) assert.equal(outcome(before).state, 'unconfirmed', JSON.stringify(before));
  assert.equal(outcome({ confirm: 0, signin: 0, password: 0 }).state, 'confirmed', 'control: a read count of zero still lets new wording confirm');
});

test('NIT r2: a held batch lock after the click exits 5 with a clear line instead of throwing', () => {
  const d = tmp();
  try {
    const id = batchWithPlans(d, 1);
    const locked = () => {
      throw new LockTimeoutError(join(d, 'batch.lock'), null);
    };
    for (const outcome of [{ state: 'unconfirmed', detail: 'nothing decisive' }, { state: 'invalid', detail: 'School' }, { state: 'captcha', detail: 'captcha frame' }]) {
      const r = fakeRunner();
      const lines = [];
      const code = afterClick({ clicked: { state: 'clicked', outcome }, plan: { ...plan(d, TAB), batchId: id, link: link(1) }, paths: { packRoot: W, root: d, dataDir: d }, flags: { batchId: id, item: 1 }, action: 'apply.submit', dataDir: d, deps: { runner: r.run, addFinishYourself: locked }, say: (l) => lines.push(l) });
      assert.equal(code, EXIT.needsUser, outcome.state);
      assert.deepEqual(r.calls, [], 'nothing logged as submitted');
      assert.match(lines.join('\n'), /batch file stayed locked.*not logged as submitted.*check the open tab/, outcome.state);
    }
    const other = () => {
      throw new Error('disk full');
    };
    assert.throws(() => afterClick({ clicked: { state: 'clicked', outcome: { state: 'unconfirmed' } }, plan: { ...plan(d, TAB), batchId: id, link: link(1) }, paths: {}, flags: { batchId: id, item: 1 }, action: 'apply.submit', dataDir: d, deps: { addFinishYourself: other }, say: () => {} }), /disk full/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('r4 when the page wording cannot be read before the click, submit refuses (exit 3) before any pending row or click', async () => {
  const d = tmp();
  try {
    const r = fakeRunner();
    const client = fakeTab({ signs: null });
    const res = await clickSubmit(client, { plan: plan(d, TAB), paths: { packRoot: W, root: d, dataDir: d }, item: 1, runner: r.run, wait: noWait });
    assert.equal(res.state, 'no-signs');
    assert.deepEqual(r.calls, [], 'no budget call, so no pending row');
    assert.ok(!client.calls.some((c) => String(c.params.expression ?? '').includes('el.click(); return true')), 'nothing clicked');
    const lines = [];
    assert.equal(afterClick({ clicked: res, plan: plan(d, TAB), paths: {}, flags: { batchId: 'b1', item: 1 }, action: 'apply.submit', dataDir: d, say: (l) => lines.push(l) }), EXIT.refused);
    assert.match(lines.join('\n'), /could not be read before the click.*nothing was clicked/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
