// SYNTHETIC FIXTURE: placeholder companies, example.com addresses and fake mail only.
// M-005 review r3 fixes: R3-M1 the outcome search excludes no phrase, so a rejection that opens "Thank you for applying"
// is read; R3-S1 after the REAL chrome.mjs fill (fake Chrome, tests/helpers/fake-chrome-child.mjs) a partial or
// upload-only fill is held and only a full fill reaches the REAL chrome.mjs submit and budget.mjs check; R3-S2 a plan with
// a field only the student fills is not filled; N-r3-3 a full Gmail page makes the unread count a lower bound.
// No browser, model, network, Gmail or launchctl is reached.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { readBatch, updateBatch, writeBatches } from '../../lib/batch-file.mjs';
import { resolvePaths } from '../../lib/paths.mjs';
import { appendTsv, readTsv } from '../../lib/tsv.mjs';
import { OUTCOME_QUERY, autopilot, readOutcomeMail } from '../../scripts/autopilot.mjs';
import { STATE_FILE } from '../../scripts/chrome.mjs';
import { main as inboxMain } from '../../scripts/inbox.mjs';
import { LOG_HEADER, row } from '../helpers/budget-harness.mjs';
import { makeRoot, PACK_ROOT, TODAY } from '../helpers/script-harness.mjs';

const YESTERDAY = '2026-10-26';
const BASE = 'daily_target: 5\nscore_floor: 3.0\nchrome_in_schedule: yes\n';
const LINK = 'https://boards.example.com/fake/jobs?gh_jid=7001';
const FAKE_CHILD = join(PACK_ROOT, 'tests', 'helpers', 'fake-chrome-child.mjs');
const scriptOf = (args) => basename(String(args?.[0] ?? ''));
const addr = (local, host) => [local, host].join('@');
const F = (selector, label, value) => ({ selector, key: selector.slice(1), label, type: 'text', value });

// One approved apply item whose plan is plan(resumePath), a fake page for it, and the autopilot run with the real
// chrome.mjs children against that page and the real budget.mjs.
async function realChildrenRun(plan, present) {
  const r = makeRoot({ config: BASE });
  try {
    const [id] = writeBatches(r.data, { date: YESTERDAY, kind: 'apply', items: [{ company: 'Fake Co', role: 'Analyst', score: 4.5, preview: 'Fake letter preview.', link: LINK }] });
    const planFile = join(r.data, 'fill-plans', id, '1.json');
    mkdirSync(join(r.data, 'fill-plans', id), { recursive: true });
    const resume = join(r.data, 'resume.pdf');
    writeFileSync(resume, 'fake pdf');
    writeFileSync(planFile, JSON.stringify({ company: 'Fake Co', role: 'Analyst', url: LINK, link: LINK, score: 4.5, batchId: id, item: 1, unknown: [], uploads: [], formSelector: '#application_form', submitSelector: '#submit', submitText: 'submit application', ...plan(resume) }));
    updateBatch(r.data, id, (b) => ({ ...b, items: b.items.map((it) => ({ ...it, plan: planFile })) }));
    await appendTsv(join(r.data, 'action-log.tsv'), LOG_HEADER, [row({ ts: `${YESTERDAY}T20:00:00.000Z`, action: 'batch.approve', approval: 'approve all', detail: `batch=${id};items=1` })]);
    writeFileSync(join(r.data, STATE_FILE), JSON.stringify({ pid: process.pid, port: 9 }));
    const pageFile = join(r.root, 'page.json');
    writeFileSync(pageFile, JSON.stringify({ url: LINK, values: {}, targets: [], submitButton: true, present }));
    const calls = [];
    const runner = (cmd, args, opts) => {
      const s = scriptOf(args);
      if (s === 'chrome.mjs') {
        calls.push(args[1]);
        return execFileSync(cmd, [FAKE_CHILD, ...args.slice(1)], { ...opts, encoding: 'utf8', env: { ...process.env, FAKE_PAGE: pageFile }, stdio: ['ignore', 'pipe', 'pipe'] });
      }
      if (s === 'budget.mjs') return execFileSync(cmd, args, { ...opts, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return s === 'rank-queue.mjs' ? '[]' : '';
    };
    const res = await autopilot({ paths: resolvePaths({ root: r.root, dataDir: r.data }), today: TODAY, deps: { runner, chromeOpen: () => true, chromeState: async () => null, out: () => {} } });
    const log = existsSync(join(r.data, 'action-log.tsv')) ? (await readTsv(join(r.data, 'action-log.tsv'))).rows.map((x) => x.action) : [];
    const page = JSON.parse(readFileSync(pageFile, 'utf8'));
    return { id, calls, res, log, clicks: page.clicked ?? 0, batch: readBatch(r.data, id) };
  } finally {
    r.cleanup();
  }
}

const FORM = { '#first_name': { required: true }, '#last_name': { required: true }, '#resume': { type: 'file', required: true } };

test('R3-S1 a full real fill is submitted through the real chrome.mjs submit and budget.mjs check', async () => {
  const run = await realChildrenRun((resume) => ({ fields: [F('#first_name', 'First name', 'Test'), F('#last_name', 'Last name', 'Person')], uploads: [{ selector: '#resume', path: resume }] }), FORM);
  assert.deepEqual(run.calls, ['fill', 'submit']);
  assert.equal(run.clicks, 1);
  assert.ok(run.log.includes('apply.submit'), run.log.join(', '));
  assert.ok(run.res.lines.includes('submit approved: submitted 1 of 1 approved item(s)'), run.res.lines.join('\n'));
});

test('R3-S1 a real fill that could not fill a field is held: no submit call, a waiting line naming the field', async () => {
  const run = await realChildrenRun((resume) => ({ fields: [F('#first_name', 'First name', 'Test'), F('#last_name', 'Last name', 'Person')], uploads: [{ selector: '#resume', path: resume }] }), { '#first_name': { required: true }, '#surname': { required: true }, '#resume': { type: 'file', required: true } });
  assert.deepEqual(run.calls, ['fill'], 'no chrome.mjs submit');
  assert.equal(run.clicks, 0);
  assert.ok(!run.log.some((a) => a.startsWith('apply.')), run.log.join(', '));
  assert.ok(run.res.lines.includes(`submit approved: item 1 of ${run.id} waits for a fill in a session (the fill could not fill Last name)`), run.res.lines.join('\n'));
  assert.equal(run.res.footer[0], 'Next: fill and submit the 1 approved application(s) in a session');
});

test('R3-S1 an upload-only real fill (no text field typed) is held', async () => {
  const run = await realChildrenRun((resume) => ({ fields: [{ selector: '#consent', key: 'consent', label: 'Consent', type: 'checkbox', value: '' }], uploads: [{ selector: '#resume', path: resume }] }), { '#resume': { type: 'file', required: true } });
  assert.deepEqual(run.calls, ['fill'], 'no chrome.mjs submit');
  assert.equal(run.clicks, 0);
  assert.ok(run.res.lines.includes(`submit approved: item 1 of ${run.id} waits for a fill in a session (no text field was filled, so nothing was submitted)`), run.res.lines.join('\n'));
});

test('R3-S2 a plan with a field only the student fills gets no fill and no submit, and the line names the field only', async () => {
  const run = await realChildrenRun(() => ({ fields: [F('#first_name', 'First name', 'Test')], blocked: ['ssn'] }), { '#first_name': { required: true }, '#ssn': { required: true } });
  assert.deepEqual(run.calls, []);
  assert.ok(run.res.lines.includes(`submit approved: item 1 of ${run.id} waits for you: fields only you fill (ssn)`), run.res.lines.join('\n'));
  assert.equal(run.res.footer[0], 'Next: fill and submit the 1 approved application(s) in a session');
});

// A fake CDP client over a Gmail list page and conversation pages (see tests/ops/m005-fix2.test.mjs).
const el = (attrs = {}, text = '', kids = {}) => ({ innerText: text, textContent: text, getAttribute: (n) => attrs[n] ?? null, querySelector: (sel) => (kids[sel] ?? [])[0] ?? null, querySelectorAll: (sel) => kids[sel] ?? [] });
const doc = (bySel) => ({ body: el(), querySelector: (sel) => (bySel[sel] ?? [])[0] ?? null, querySelectorAll: (sel) => bySel[sel] ?? [] });
function fakeGmail(rows, threads) {
  const page = (url) => {
    const m = /#search\/[^/]+\/([^/?#]+)$/.exec(url);
    if (!m) return doc({ '[role="row"]': rows.map((x) => el({}, x.text, { '[data-legacy-thread-id]': [el({ 'data-legacy-thread-id': x.id })] })) });
    const msgs = threads[m[1]] ?? [];
    return doc({ '[data-legacy-message-id]': msgs.map((x) => el({ 'data-legacy-message-id': x.id })), 'span.gD[email]': msgs.map((x) => el({ email: x.from })), 'div.a3s': msgs.map((x) => el({}, x.text)), 'span.g3[title]': [] });
  };
  let document = doc({});
  const send = async (method, params = {}) => {
    if (method === 'Target.createTarget') return { targetId: 'T1' };
    if (method === 'Target.attachToTarget') return { sessionId: 'S1' };
    if (method === 'Page.navigate') {
      document = page(params.url);
      return { frameId: 'F1' };
    }
    if (method === 'Runtime.evaluate') return { result: { value: new Function('document', `return ${params.expression}`)(document) } };
    return {};
  };
  return (port, fn) => fn({ send, waitFor: () => Object.assign(Promise.resolve({}), { cancel: () => {} }) });
}

test('R3-M1 the outcome search excludes no phrase, and a rejection opening "Thank you for applying" reaches set-status', async () => {
  assert.ok(!/(^|\s)-"/.test(OUTCOME_QUERY) && !/(^|\s)-\w/.test(OUTCOME_QUERY), OUTCOME_QUERY);
  const r = makeRoot({ config: 'presets: []\n' });
  try {
    const text = 'Thank you for applying to the Data Analyst role. After careful review we have decided to move forward with other candidates. We wish you the best.';
    const browser = fakeGmail([{ id: 'abc9', text: 'Northwind Robotics Your application 9:14 AM' }], { abc9: [{ id: 'rej9', from: addr('recruiting', 'northwindrobotics.example.com'), text }] });
    const { mails } = await readOutcomeMail({ dataDir: r.data, port: 9, query: OUTCOME_QUERY, date: TODAY, browser });
    r.write('data/applications.md', ['# Applications', '', '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |', '|---|---|---|---|---|---|---|---|---|', '| 1 | 2026-10-10 | Northwind Robotics | Data Analyst | 4.2/5 | Applied | no | none | |', ''].join('\n'));
    r.write('data/m.json', JSON.stringify(mails.map((m) => ({ date: '2026-10-26T15:00:00.000Z', ...m }))));
    const calls = [];
    await inboxMain(['--backend', 'connector', '--input', r.file('data/m.json'), '--root', r.root, '--data-dir', r.data, '--today', TODAY], {
      runner: async (a) => (calls.push(a.join(' ')), { code: 0, stdout: '' }),
      t7On: false,
      classify: async () => 'rejection',
      out: () => {},
    });
    assert.deepEqual(calls.filter((c) => c.startsWith('set-status')), ['set-status.mjs 1 Rejected --note prior status Applied; from mail id-rej9']);
  } finally {
    r.cleanup();
  }
});

test('N-r3-3 a full Gmail list page makes the unread count a lower bound', async () => {
  const r = makeRoot();
  try {
    const rows = Array.from({ length: 50 }, (_, i) => ({ id: `e${i}`, text: `Fake Co ${i} interview` }));
    const got = await readOutcomeMail({ dataDir: r.data, port: 9, query: OUTCOME_QUERY, date: TODAY, browser: fakeGmail(rows, {}) });
    assert.equal(got.more, 40);
    assert.equal(got.fullPage, true);
    const c = makeRoot({ config: BASE });
    try {
      const runner = (cmd, args) => (scriptOf(args) === 'inbox.mjs' ? 'inbox: 10 read, 0 proposal(s), 0 set\n' : scriptOf(args) === 'rank-queue.mjs' ? '[]' : '');
      const res = await autopilot({ paths: resolvePaths({ root: c.root, dataDir: c.data }), today: TODAY, deps: { runner, chromeOpen: () => true, chromeState: async () => ({ port: 9 }), readOutcomeMail: async () => got, out: () => {} } });
      assert.ok(res.lines.includes('outcome mail: at least 40 more matching conversation(s) not read yet; the next scheduled run reads them'), res.lines.join('\n'));
    } finally {
      c.cleanup();
    }
  } finally {
    r.cleanup();
  }
});
