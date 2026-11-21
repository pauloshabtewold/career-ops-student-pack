// chrome.mjs fill against the local mock ATS (tests/helpers/mock-ats-server.mjs). The two [e2e] tests ask
// tests/helpers/chrome-harness.mjs first and skip when no browser slot is granted; the password and mock-server tests
// never start a browser (the password test drives fillPlan through a fake CDP client). All data is fake.
// Fill plan shape used here (ruling): { batchId, item, url, company, role, fields: [{ selector, label, type, value }] },
// file fields carry a local path as value.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gate, openChrome, runChromeCli, stopAll } from '../helpers/chrome-harness.mjs';
import { FORM_TEXT, startMockAts } from '../helpers/mock-ats-server.mjs';
import { PACK_ROOT, makeRoot } from '../helpers/script-harness.mjs';

const WAIT_BOUND_MS = 15000;
const POLL_MS = 100;

const PERSON = { first: 'Jordan', last: 'Testwell', email: 'jordan.testwell@example.com', phone: '555-0100' };

function planFor(r, formUrl, { batchId = 'b-e2e', item = 1 } = {}) {
  const resume = join(r.root, 'resume-fake.pdf');
  const cover = join(r.root, 'cover-fake.txt');
  writeFileSync(resume, '%PDF-1.4\n% fake resume for the mock form\n%%EOF\n');
  writeFileSync(cover, 'Fake cover letter for the mock form.\n');
  return {
    batchId,
    item,
    url: formUrl,
    company: 'Example Robotics',
    role: 'Software Engineering Intern',
    fields: [
      { selector: '#first_name', label: 'First Name', type: 'text', value: PERSON.first },
      { selector: '#last_name', label: 'Last Name', type: 'text', value: PERSON.last },
      { selector: '#email', label: 'Email', type: 'text', value: PERSON.email },
      { selector: '#phone', label: 'Phone', type: 'text', value: PERSON.phone },
      { selector: '#work_auth', label: 'Are you legally authorized to work in the United States?', type: 'select', value: 'Yes' },
      { selector: '#question_fav', label: 'What is your favorite fake board game?', type: 'text', value: 'Fake Tiles' },
      { selector: '#resume', label: 'Resume/CV', type: 'file', value: resume },
      { selector: '#cover_letter', label: 'Cover Letter', type: 'file', value: cover },
    ],
  };
}

async function waitFor(condition, what) {
  const deadline = Date.now() + WAIT_BOUND_MS;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  assert.fail(`timed out waiting for ${what}`);
}

// Reads every planned field back from the automation Chrome tab that holds the form.
async function readBack(dataDir, url, selectors) {
  const { readState } = await import('../../scripts/chrome.mjs');
  const { withBrowser, readValue, attachTo } = await import('../../lib/cdp.mjs');
  const { port } = readState(dataDir);
  return withBrowser(port, async (client) => {
    const { sessionId } = await attachTo(client, url);
    const out = {};
    for (const s of selectors) out[s] = await readValue(client, sessionId, s);
    return out;
  });
}

// A CDP client stand-in: answers by method, records every command, and reports the page as holding a password field
// (or a CAPTCHA when asked). No socket and no browser.
function fakeClient({ captcha = false } = {}) {
  const calls = [];
  const send = async (method, params = {}, sessionId) => {
    calls.push({ method, params, sessionId });
    if (method === 'Target.getTargets') return { targetInfos: [{ targetId: 'T-fake-1', type: 'page', url: params.url ?? '' }] };
    if (method === 'Target.createTarget') return { targetId: 'T-fake-1' };
    if (method === 'Target.attachToTarget') return { sessionId: 'S-fake-1' };
    if (method === 'Page.navigate') return { frameId: 'F-fake-1' };
    if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
    if (method === 'DOM.querySelector') return { nodeId: 2 };
    if (method === 'Runtime.evaluate') {
      const expr = String(params.expression ?? '');
      if (/captcha/i.test(expr)) return { result: { type: 'boolean', value: captcha } };
      return { result: { type: 'object', value: { tag: 'input', tagName: 'INPUT', type: 'password', autocomplete: 'current-password', value: '' } } };
    }
    return {};
  };
  const waitFor = () => {
    const p = Promise.resolve({});
    p.cancel = () => {};
    return p;
  };
  return { send, waitFor, close: () => {}, opened: Promise.resolve(), calls };
}

// The outcome of a fill call: its exit code and a text to search, whether it returns or throws.
async function outcome(fn) {
  try {
    const r = await fn();
    if (typeof r === 'number') return { code: r, text: '' };
    return { code: r?.code ?? r?.exit, text: JSON.stringify(r ?? null) };
  } catch (err) {
    return { code: Number.isInteger(err?.exitCode) ? err.exitCode : 1, text: String(err?.message ?? err) };
  }
}

const typed = (calls, values) =>
  calls.filter(
    (c) =>
      c.method.startsWith('Input.') ||
      c.method === 'DOM.setFileInputFiles' ||
      (c.method === 'Runtime.evaluate' && values.some((v) => String(c.params.expression ?? '').includes(v))),
  );

// M-002-S5-osdr
test('M-002-S5-osdr [e2e] chrome.mjs fills the mock ATS form', async (t) => {
  const reason = await gate();
  if (reason) return t.skip(reason);
  const r = makeRoot();
  const ats = await startMockAts();
  try {
    const open = await openChrome({ root: r.root, dataDir: r.data });
    if (open.skip) return t.skip(open.skip);
    assert.equal(open.code, 0, open.stdout + open.stderr);

    const formUrl = `${ats.url}/greenhouse/form?job=5`;
    const plan = planFor(r, formUrl);
    const planFile = join(r.root, 'plan-5.json');
    writeFileSync(planFile, JSON.stringify(plan, null, 2));

    const fill = await runChromeCli(['fill', '--plan', planFile], { root: r.root, dataDir: r.data });
    assert.equal(fill.code, 0, fill.stdout + fill.stderr);

    const selectors = plan.fields.map((f) => f.selector);
    let values = {};
    await waitFor(async () => {
      values = await readBack(r.data, formUrl, selectors);
      return values['#email'] === PERSON.email;
    }, 'the email field to hold its planned value');
    assert.equal(values['#first_name'], PERSON.first);
    assert.equal(values['#last_name'], PERSON.last);
    assert.equal(values['#email'], PERSON.email);
    assert.equal(values['#phone'], PERSON.phone);
    assert.equal(values['#work_auth'], 'Yes');
    assert.equal(values['#question_fav'], 'Fake Tiles');
    assert.match(String(values['#resume']), /resume-fake\.pdf$/);
    assert.match(String(values['#cover_letter']), /cover-fake\.txt$/);
    assert.deepEqual(ats.submissions(), [], 'fill sends no submit');
  } finally {
    await stopAll({ root: r.root, dataDir: r.data });
    await ats.close();
    r.cleanup();
  }
});

// M-002-S21-osdr
test('M-002-S21-osdr chrome.mjs refuses to type into a password field and exits non-zero naming the refusal', async () => {
  const { isPasswordField, fillPlan, EXIT } = await import('../../scripts/chrome.mjs');
  assert.equal(typeof isPasswordField, 'function', 'chrome.mjs exports isPasswordField');
  assert.equal(isPasswordField({ type: 'password' }), true);
  assert.equal(isPasswordField({ type: 'text', autocomplete: 'new-password' }), true);
  assert.equal(isPasswordField({ type: 'text', autocomplete: 'current-password' }), true);
  assert.equal(isPasswordField({ type: 'email', autocomplete: 'email' }), false);

  const r = makeRoot();
  try {
    const secret = 'fake-value-never-typed-9Z';
    const plan = {
      batchId: 'b-pw',
      item: 1,
      url: 'http://127.0.0.1:9/greenhouse/form?job=1',
      company: 'Example Robotics',
      role: 'Software Engineering Intern',
      fields: [{ selector: '#account_pw', label: 'Password', type: 'text', value: secret }],
    };
    const client = fakeClient();
    const res = await outcome(() => fillPlan(client, plan, { dataDir: r.data }));
    assert.ok(Number.isInteger(res.code) && res.code !== 0, `fill exits non-zero, got ${res.code}`);
    assert.notEqual(res.code, EXIT?.captcha ?? 6, 'a password refusal is not a CAPTCHA stop');
    assert.match(res.text, /password/i, `the refusal names the password field: ${res.text}`);
    assert.deepEqual(typed(client.calls, [secret]), [], 'nothing was typed into the page');
  } finally {
    r.cleanup();
  }
});

// M-002-S22-osdr
test('M-002-S22-osdr [e2e] chrome.mjs stops on the CAPTCHA page', async (t) => {
  const reason = await gate();
  if (reason) return t.skip(reason);
  const r = makeRoot();
  const ats = await startMockAts();
  try {
    const open = await openChrome({ root: r.root, dataDir: r.data });
    if (open.skip) return t.skip(open.skip);
    assert.equal(open.code, 0, open.stdout + open.stderr);

    const { writeBatches, listBatches } = await import('../../lib/batch-file.mjs');
    const link = `${ats.url}/greenhouse/form?job=22&captcha=1`;
    writeBatches(r.data, {
      date: '2026-11-03',
      kind: 'apply',
      items: [{ company: 'Example Robotics', role: 'Software Engineering Intern', score: 4.2, preview: 'Fake letter preview.', link }],
    });
    const ids = listBatches(r.data).map((b) => (typeof b === 'string' ? b : b.id));
    assert.equal(ids.length, 1);
    const plan = planFor(r, link, { batchId: ids[0], item: 1 });
    const planFile = join(r.root, 'plan-22.json');
    writeFileSync(planFile, JSON.stringify(plan, null, 2));

    const fill = await runChromeCli(['fill', '--plan', planFile], { root: r.root, dataDir: r.data });
    assert.equal(fill.code, 6, fill.stdout + fill.stderr);

    const values = await readBack(r.data, link, ['#email', '#first_name']);
    assert.equal(values['#email'], '', 'nothing was typed on the CAPTCHA page');
    assert.equal(values['#first_name'], '');

    const status = spawnSync(process.execPath, [join(PACK_ROOT, 'scripts', 'batch.mjs'), 'status', '--root', r.root, '--data-dir', r.data], { cwd: PACK_ROOT, encoding: 'utf8', timeout: 30000 });
    assert.equal(status.status, 0, status.stdout + status.stderr);
    const lines = status.stdout.split('\n');
    const head = lines.findIndex((l) => /finish these yourself/i.test(l));
    assert.ok(head >= 0, status.stdout);
    assert.ok(lines.slice(head).some((l) => l.includes(link)), `direct link listed under finish these yourself:\n${status.stdout}`);
    assert.deepEqual(ats.submissions(), []);
  } finally {
    await stopAll({ root: r.root, dataDir: r.data });
    await ats.close();
    r.cleanup();
  }
});

// M-002-S47-osdr
test('M-002-S47-osdr mock-ats-server serves the form for job N with its form text and records a POST as one submission for that job', async () => {
  const ats = await startMockAts();
  try {
    assert.match(ats.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(ats.formText, FORM_TEXT);
    const page = await fetch(`${ats.url}/greenhouse/form?job=7`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.ok(html.includes(FORM_TEXT));
    assert.ok(html.includes('Job 7'));
    for (const id of ['first_name', 'last_name', 'email', 'phone', 'resume', 'cover_letter', 'work_auth', 'question_fav', 'submit_app']) {
      assert.ok(html.includes(`id="${id}"`), `form holds #${id}`);
    }
    assert.ok(!/recaptcha/i.test(html), 'no CAPTCHA without captcha=1');
    assert.match(await (await fetch(`${ats.url}/greenhouse/form?job=7&captcha=1`)).text(), /g-recaptcha/);
    assert.deepEqual(ats.submissions(), []);

    const post = await fetch(`${ats.url}/greenhouse/submit?job=7`, { method: 'POST', body: 'first_name=Jordan' });
    assert.equal(post.status, 200);
    assert.match(await post.text(), /Application received/);
    assert.deepEqual(ats.submissions(), [{ job: 7 }]);
  } finally {
    await ats.close();
  }
});
