// SYNTHETIC FIXTURE: placeholder companies, example.com addresses and fake mail only.
// M-005 review r2 fixes: R2-M1 the autopilot fills and submits only approved items whose plan carries read form fields,
// no unknown question and its uploads, and submits only after the fill reported a filled field; R2-S1 outcome mail takes
// the newest message's id, sender and date; R2-S2 relay-sent outcome mail naming a tracked company is a proposal with T7
// on and no classifier; R2-S3 the same-URL guard keys postings with lib/url-key.mjs; R2-S4 conversations already handled
// do not use the 10-conversation cap and the unread rest is named; N-r2-1 pause and resume footers end with the two
// closing lines. No browser, model, network, Gmail or launchctl is reached: Chrome is a fake CDP client or refuses first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { updateBatch, writeBatches } from '../../lib/batch-file.mjs';
import { resolvePaths } from '../../lib/paths.mjs';
import { appendTsv, readTsv } from '../../lib/tsv.mjs';
import { THREADS_SEEN_FILE, autopilot, linkKey, readOutcomeMail, stableRowText } from '../../scripts/autopilot.mjs';
import { main as inboxMain } from '../../scripts/inbox.mjs';
import { pauseCommand } from '../../scripts/schedule.mjs';
import { LOG_HEADER, row } from '../helpers/budget-harness.mjs';
import { makeRoot, TODAY, jobUrl } from '../helpers/script-harness.mjs';

const YESTERDAY = '2026-10-26';
const BASE = 'daily_target: 5\nscore_floor: 3.0\nchrome_in_schedule: yes\n';
const scriptOf = (args) => basename(String(args?.[0] ?? ''));
const FIELD = { selector: '#first_name', key: 'first_name', label: 'First name', type: 'text', value: 'Test' };
const REGRET = 'We regret to inform you that we decided to move forward with other candidates.';
const addr = (local, host) => [local, host].join('@');
const logRows = async (r) => (existsSync(join(r.data, 'action-log.tsv')) ? (await readTsv(join(r.data, 'action-log.tsv'))).rows : []);

// An approved apply batch from yesterday; plans[k] is the extra plan content of item k + 1 (link defaults to jobUrl).
async function approvedBatch(r, plans) {
  const items = plans.map((p, i) => ({ company: `Fake Co ${i + 1}`, role: `Analyst ${i + 1}`, score: 4.5, preview: 'Fake letter preview.', link: p.link ?? jobUrl(i + 1) }));
  const [id] = writeBatches(r.data, { date: YESTERDAY, kind: 'apply', items });
  updateBatch(r.data, id, (b) => ({
    ...b,
    items: b.items.map((it, k) => {
      const file = join(r.data, 'fill-plans', id, `${k + 1}.json`);
      mkdirSync(join(r.data, 'fill-plans', id), { recursive: true });
      writeFileSync(file, `${JSON.stringify({ company: it.company, role: it.role, url: it.link, link: it.link, score: 4.5, batchId: id, item: k + 1, unknown: [], uploads: [], ...plans[k] })}\n`);
      return { ...it, plan: file };
    }),
  }));
  await appendTsv(join(r.data, 'action-log.tsv'), LOG_HEADER, [row({ ts: `${YESTERDAY}T20:00:00.000Z`, action: 'batch.approve', approval: 'approve all', detail: `batch=${id};items=${plans.map((_, i) => i + 1).join(',')}` })]);
  return id;
}

async function runPilot(r, runner, deps = {}) {
  return autopilot({ paths: resolvePaths({ root: r.root, dataDir: r.data }), today: TODAY, deps: { runner, chromeOpen: () => true, chromeState: async () => null, out: () => {}, ...deps } });
}

// A runner that records chrome.mjs calls, answers fill with fillText and submit with '' (or runs submit for real).
function chromeRunner({ fillText = 'chrome: filled 1 field(s) on example.com', realSubmit = false } = {}) {
  const calls = [];
  const runner = (cmd, args, opts) => {
    const s = scriptOf(args);
    if (s === 'chrome.mjs') calls.push(args);
    if (s === 'chrome.mjs' && args[1] === 'fill') return fillText;
    if (realSubmit && (s === 'chrome.mjs' || s === 'budget.mjs')) return execFileSync(cmd, args, { ...opts, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return s === 'rank-queue.mjs' ? '[]' : '';
  };
  return { runner, calls, verbs: () => calls.map((a) => `chrome.mjs ${a[1]}`) };
}

test('R2-M1 an approved plan with no read fields gets no fill and no submit, a waiting line and the session footer', async () => {
  const r = makeRoot({ config: BASE });
  try {
    const id = await approvedBatch(r, [{ fields: [] }]);
    const c = chromeRunner();
    const res = await runPilot(r, c.runner);
    assert.deepEqual(c.calls, [], 'no chrome.mjs fill or submit');
    assert.ok(res.lines.includes(`submit approved: item 1 of ${id} waits for a fill in a session (no form was read for it)`), res.lines.join('\n'));
    assert.equal(res.footer[0], 'Next: fill and submit the 1 approved application(s) in a session');
    assert.equal(res.footer[1], 'Type: submit all');
    assert.match(res.footer[2], /^Why: .*I'll fill each form first, approve\?$/);
  } finally {
    r.cleanup();
  }
});

test('R2-M1 a plan with an unknown question or a missing upload waits; a fill that wrote 0 fields is never submitted', async () => {
  const r = makeRoot({ config: BASE });
  try {
    const id = await approvedBatch(r, [{ fields: [FIELD], unknown: ['Why this team?'] }, { fields: [FIELD], uploads: [{ selector: '#resume', path: join(r.data, 'missing.pdf') }] }, { fields: [FIELD] }]);
    const c = chromeRunner({ fillText: 'chrome: filled 0 field(s) on example.com' });
    const res = await runPilot(r, c.runner);
    assert.deepEqual(c.verbs(), ['chrome.mjs fill'], 'only item 3 is filled, and nothing is submitted');
    const waits = res.lines.filter((l) => /waits for a fill in a session/.test(l));
    assert.equal(waits.length, 3, res.lines.join('\n'));
    assert.ok(waits[2].startsWith(`submit approved: item 3 of ${id} waits for a fill in a session (the fill wrote no field`), waits[2]);
    assert.equal(res.footer[0], 'Next: fill and submit the 3 approved application(s) in a session');
  } finally {
    r.cleanup();
  }
});

test('R2-M1 a plan with read fields and its upload on disk is filled, then submitted through the real budget.mjs check', async () => {
  const r = makeRoot({ config: BASE });
  try {
    const resume = join(r.data, 'resume.pdf');
    writeFileSync(resume, 'fake pdf');
    const id = await approvedBatch(r, [{ fields: [FIELD], uploads: [{ selector: '#resume', path: resume }] }]);
    const c = chromeRunner({ fillText: 'chrome: filled 2 field(s) on example.com', realSubmit: true });
    const res = await runPilot(r, c.runner);
    assert.deepEqual(c.verbs(), ['chrome.mjs fill', 'chrome.mjs submit']);
    const note = res.lines.find((l) => l.startsWith(`submit approved: item 1 of ${id}`));
    assert.match(note ?? '', /automation Chrome is not running/, 'the budget check passed and only the missing Chrome stopped the click');
    assert.deepEqual((await logRows(r)).filter((x) => x.action === 'budget.refusal'), []);
  } finally {
    r.cleanup();
  }
});

test('R2-S3 query ids keep postings apart; a tracking parameter does not', async () => {
  const base = 'https://boards.example.com/fake/jobs';
  assert.notEqual(linkKey(`${base}?gh_jid=4001`), linkKey(`${base}?gh_jid=4002`));
  assert.equal(linkKey(`${base}?gh_jid=4001`), linkKey(`${base}?gh_jid=4001&utm_source=feed`));
  assert.equal(linkKey('not a url '), 'not a url');
  const r = makeRoot({ config: BASE });
  try {
    const id = await approvedBatch(r, [{ link: `${base}?gh_jid=4001`, fields: [FIELD] }, { link: `${base}?gh_jid=4002`, fields: [FIELD] }, { link: `${base}?gh_jid=4001&utm_source=feed`, fields: [FIELD] }]);
    const c = chromeRunner();
    const res = await runPilot(r, c.runner);
    const submits = c.calls.filter((a) => a[1] === 'submit').map((a) => a[a.indexOf('--item') + 1]);
    assert.deepEqual(submits, ['1', '2'], 'both gh_jid postings go out; the utm copy does not');
    assert.ok(res.lines.some((l) => l.startsWith(`submit approved: item 3 of ${id} not submitted`) && /was already submitted/.test(l)), res.lines.join('\n'));
  } finally {
    r.cleanup();
  }
});

// A fake element: attributes, text, and child queries by selector.
const el = (attrs = {}, text = '', kids = {}) => ({
  innerText: text,
  textContent: text,
  getAttribute: (n) => attrs[n] ?? null,
  querySelector: (sel) => (kids[sel] ?? [])[0] ?? null,
  querySelectorAll: (sel) => kids[sel] ?? [],
});
const doc = (bySel) => ({ body: el({}, ''), querySelector: (sel) => (bySel[sel] ?? [])[0] ?? null, querySelectorAll: (sel) => bySel[sel] ?? [] });

// A list page from rows [{ id, text }] and thread pages by thread id: [{ id, from, text, date }] per message.
function fakeGmail(rows, threads) {
  const opened = [];
  const page = (url) => {
    const m = /#search\/[^/]+\/([^/?#]+)$/.exec(url);
    if (!m) return doc({ '[role="row"]': rows.map((r) => el({}, r.text, { '[data-legacy-thread-id]': [el({ 'data-legacy-thread-id': r.id })] })) });
    opened.push(m[1]);
    const msgs = threads[m[1]] ?? [];
    return doc({
      '[data-legacy-message-id]': msgs.map((x) => el({ 'data-legacy-message-id': x.id })),
      'span.gD[email]': msgs.map((x) => el({ email: x.from })),
      'div.a3s': msgs.map((x) => el({}, x.text)),
      'span.g3[title]': msgs.map((x) => el({ title: x.date })),
    });
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
  const client = { send, waitFor: () => Object.assign(Promise.resolve({}), { cancel: () => {} }) };
  return { browser: (port, fn) => fn(client), opened };
}

const OWN = addr('recruiting', 'northwindrobotics.example.com');
const STUDENT = addr('student', 'example.org');

test('R2-S1 the newest message gives the id, sender and date, so a seen receipt never hides the reply', async () => {
  const r = makeRoot({ config: 'presets: []\n' });
  try {
    const gmail = fakeGmail([{ id: 'abc1', text: 'Northwind Robotics Update on your application 9:14 AM' }], {
      abc1: [
        { id: 'aaa1', from: STUDENT, text: 'Thanks, I applied yesterday.', date: 'Sun, Oct 25, 2026, 8:00 AM' },
        { id: 'bbb2', from: OWN, text: REGRET, date: 'Mon, Oct 26, 2026, 9:14 AM' },
      ],
    });
    const { mails } = await readOutcomeMail({ dataDir: r.data, port: 9, query: 'q', date: TODAY, browser: gmail.browser });
    assert.equal(mails.length, 1);
    assert.equal(mails[0].id, 'id-bbb2');
    assert.equal(mails[0].from, OWN);
    assert.ok(mails[0].snippet.includes('regret'));
    assert.ok(String(mails[0].date).startsWith('2026-10-26'), `the mail keeps its own date: ${mails[0].date}`);
    r.write('data/applications.md', ['# Applications', '', '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |', '|---|---|---|---|---|---|---|---|---|', '| 1 | 2026-10-10 | Northwind Robotics | Data Intern | 4.2/5 | Applied | no | none | |', ''].join('\n'));
    r.write('data/.student-inbox-seen', 'id-aaa1\n');
    r.write('data/m.json', JSON.stringify(mails));
    const calls = [];
    await inboxMain(['--backend', 'connector', '--input', r.file('data/m.json'), '--root', r.root, '--data-dir', r.data, '--today', TODAY], {
      runner: async (a) => (calls.push(a.join(' ')), { code: 0, stdout: '' }),
      t7On: false,
      classify: async () => 'rejection',
      out: () => {},
    });
    assert.deepEqual(calls.filter((c) => c.startsWith('set-status')), ['set-status.mjs 1 Rejected --note prior status Applied; from mail id-bbb2']);
  } finally {
    r.cleanup();
  }
});

test('R2-S2 with T7 on and no classifier, a relay-sent rejection naming the tracked company is one proposal line', async () => {
  const r = makeRoot({ config: 'presets: []\n' });
  try {
    r.write('data/applications.md', ['# Applications', '', '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |', '|---|---|---|---|---|---|---|---|---|', '| 1 | 2026-10-10 | Northwind Robotics | Data Intern | 4.2/5 | Applied | no | none | |', ''].join('\n'));
    r.write('data/m.json', JSON.stringify([{ id: 'id-r1', from: addr('no-reply', 'greenhouse-mail.io'), subject: 'Northwind Robotics: update on your application', snippet: REGRET, date: '2026-10-26T15:00:00.000Z' }]));
    const calls = [];
    const lines = [];
    await inboxMain(['--backend', 'connector', '--input', r.file('data/m.json'), '--root', r.root, '--data-dir', r.data, '--today', TODAY], {
      runner: async (a) => (calls.push(a.join(' ')), { code: 0, stdout: '' }),
      t7On: true,
      out: (l) => lines.push(String(l)),
    });
    assert.deepEqual(calls.filter((c) => c.startsWith('set-status')), []);
    assert.equal(lines.filter((l) => /^- id-r1 Northwind Robotics: /.test(l)).length, 1, lines.join('\n'));
  } finally {
    r.cleanup();
  }
});

test('R2-S4 handled conversations do not use the cap, the unread rest is counted, and a new message reopens a thread', async () => {
  const r = makeRoot();
  try {
    const rows = Array.from({ length: 12 }, (_, i) => ({ id: `f${String(i).padStart(2, '0')}`, text: `Fake Co ${i} interview invitation ${i + 1}:0${i % 10} PM` }));
    const threads = Object.fromEntries(rows.map((x) => [x.id, [{ id: `m${x.id}`, from: OWN, text: 'Next steps', date: '' }]]));
    const one = fakeGmail(rows, threads);
    const first = await readOutcomeMail({ dataDir: r.data, port: 9, query: 'q', date: TODAY, browser: one.browser });
    assert.equal(one.opened.length, 10);
    assert.equal(first.more, 2);
    writeFileSync(join(r.data, THREADS_SEEN_FILE), `${first.keys.join('\n')}\n`);
    // A day later Gmail shows dates instead of times, and thread f00 has a new message.
    const later = rows.map((x, i) => ({ ...x, text: i === 0 ? 'Fake Co 0 offer letter Oct 27' : x.text.replace(/\d{1,2}:\d{2} PM/, 'Oct 26') }));
    const two = fakeGmail(later, threads);
    const second = await readOutcomeMail({ dataDir: r.data, port: 9, query: 'q', date: TODAY, browser: two.browser });
    assert.deepEqual(two.opened, ['f00', 'f10', 'f11'], 'only the changed thread and the two unread ones are opened');
    assert.equal(second.more, 0);
    assert.equal(stableRowText('Fake Co update 9:14 AM'), stableRowText('Fake Co update Nov 21'));
  } finally {
    r.cleanup();
  }
});

test('R2-S4 the digest names the matching conversations left unread and the read ones are marked handled', async () => {
  const r = makeRoot({ config: BASE });
  try {
    const runner = (cmd, args) => (scriptOf(args) === 'inbox.mjs' ? 'inbox: 1 read, 1 proposal(s), 0 set\n' : scriptOf(args) === 'rank-queue.mjs' ? '[]' : '');
    const mails = [{ id: 'id-x1', from: OWN, subject: 'Fake Co interview', snippet: 'Next steps' }];
    const res = await runPilot(r, runner, { chromeState: async () => ({ port: 9 }), readOutcomeMail: async () => ({ mails, keys: ['f01|abc'], more: 3 }) });
    assert.ok(res.lines.includes('outcome mail: 3 more matching conversation(s) not read; ask me to read them'), res.lines.join('\n'));
    assert.equal(readFileSync(join(r.data, THREADS_SEEN_FILE), 'utf8'), 'f01|abc\n');
  } finally {
    r.cleanup();
  }
});

test('N-r2-1 pause and resume footers end with the two closing lines', () => {
  const r = makeRoot();
  try {
    for (const [cmd, opts] of [['pause', {}], ['resume', { installed: () => false }], ['resume', { installed: () => true }]]) {
      const said = [];
      pauseCommand(cmd, r.data, { ...opts, say: (l) => said.push(l) });
      assert.deepEqual(said.slice(-2), ['You can always ask me for more.', 'Just ask and approve.'], `${cmd}: ${said.join(' / ')}`);
    }
  } finally {
    r.cleanup();
  }
});
