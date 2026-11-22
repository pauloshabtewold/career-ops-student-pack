// M-004 review fixes: a nudge needs an earlier message and keeps the one-active-contact rule (M1), due connects and
// contact follow-ups become batch items (M2), outreach drafts or off stops email outreach and drafting (S1), outreach
// sends need --target and --company (S2), gmail.send --followup runs the follow-up rules and skips a declined address
// (S3), an approved item is bound to its target, address and text (S4), sendEmail spends the item before the click and
// reports a failed log (S5), a connect limit of 0 is a valid lowering (S6), and a first message that asks for a
// referral is flagged (S7). Scratch packs, synthetic contacts, example.com addresses, fake browsers and a fake headless
// runner only: no real browser, model, Gmail or LinkedIn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeBatches, listBatches, readBatch } from '../../lib/batch-file.mjs';
import { loadStudentConfig } from '../../lib/config.mjs';
import { sendEmail } from '../../lib/gmail-chrome.mjs';
import { resolvePaths } from '../../lib/paths.mjs';
import { runResult } from '../../lib/run.mjs';
import { appendTsv, serializeTsv } from '../../lib/tsv.mjs';
import { draftJobs, outreachDrafts } from '../../scripts/outreach-drafts.mjs';
import { outreachState } from '../../scripts/outreach-state.mjs';
import { DAY, LOG_HEADER, at, shiftDate, liRow, row, makePack, readLog, run } from '../helpers/budget-harness.mjs';
import { makeRoot } from '../helpers/script-harness.mjs';
import { A, B, C, ACME, GLOBEX, EMAIL, OB, CONTACT_HEADER, approve, contact, emailCheck, nudgeCheck, realToday, out } from '../helpers/outreach-harness.mjs';

const ago = (days, hour = 12, today = DAY) => at(shiftDate(today, -days), hour, 0);
const li = (days, action, target, company = ACME) => liRow({ ts: ago(days), action, target, company });
const CV = '# Sample Student\n\nSynthetic fixture resume.\n\nB.S. in Information Systems, expected May 2027.\n\nSkills: Python, SQL, Excel.\n';
// Fix 10: the model writes the body as prose and a separate verifier call (step outreach-verify) answers
// {"unsupported": [...]}; CLEAN is the body, which code places after the greeting unchanged.
const CLEAN_SLOTS = 'Thanks for connecting. How did you choose your field?';
const CLEAN = 'Thanks for connecting. How did you choose your field?';
const VERDICT_OK = '{"unsupported": []}';
const isVerify = (opts) => opts?.step === 'outreach-verify';

async function withPack(rows, fn, { config = '', items = '1,2,3', today = DAY } = {}) {
  const p = await makePack({ rows, config });
  try {
    approve(p, items, { today });
    return await fn(p);
  } finally {
    p.cleanup();
  }
}

// M1
test('M1 a nudge to a new contact with no earlier message, by email or LinkedIn, at a company with an active one exits 3', async () => {
  await withPack([li(1, 'linkedin.message', A)], async (p) => {
    const email = emailCheck(p, B, ACME, 1, { extra: ['--nudge'] });
    assert.equal(email.code, 3, `gmail.send --nudge to a new contact: ${out(email)}`);
    const nudge = nudgeCheck(p, B, ACME, 2);
    assert.equal(nudge.code, 3, `linkedin.nudge to a new contact: ${out(nudge)}`);
  });
  await withPack([], async (p) => {
    const r = nudgeCheck(p, C, GLOBEX, 1);
    assert.equal(r.code, 3, `a nudge with no first message: ${out(r)}`);
    assert.match(out(r), /no first message/);
  });
  await withPack([li(6, 'linkedin.message', C, GLOBEX)], async (p) => {
    assert.equal(nudgeCheck(p, C, GLOBEX, 1).code, 0, 'a nudge 6 days after the first message still passes');
  });
});

// M2
test('M2 a due connect and a due contact follow-up each become a batch item with action, channel and target', async () => {
  const due = [
    { name: A, company: ACME, action: 'connect' },
    { name: B, company: GLOBEX, action: 'follow-up', channel: 'email', email: EMAIL[B] },
    { name: C, company: 'Initech Example', action: 'follow-up', channel: 'linkedin' },
  ];
  const noted = draftJobs({ due, followups: [], t6On: false, noteSlots: 1, noteChars: 200 });
  assert.deepEqual(noted.map((j) => j.action), ['connect', 'follow-up', 'follow-up']);
  assert.equal(noted[0].noteChars, 200, 'a note under the free tier limit while notes are left');
  assert.equal(noted[1].channel, 'email');
  assert.equal(noted[1].to, EMAIL[B], 'an email follow-up carries the address');
  assert.equal(noted[2].channel, 'linkedin');
  assert.equal(draftJobs({ due, followups: [], t6On: false, noteSlots: 0, noteChars: 200 })[0].noteChars, 0, 'no notes left: an empty note');

  const r = makeRoot();
  try {
    r.write('cv.md', CV);
    r.write('data/contacts.tsv', serializeTsv(CONTACT_HEADER, [contact(shiftDate(DAY, -1), ACME, A, 'new'), contact(shiftDate(DAY, -9), GLOBEX, B, 'accepted')]));
    await appendTsv(r.file('data/action-log.tsv'), LOG_HEADER, [
      li(10, 'linkedin.connect', B, GLOBEX),
      li(9, 'linkedin.accept', B, GLOBEX),
      row({ ts: ago(6), action: 'gmail.send', target: B, company: GLOBEX, detail: `email=${EMAIL[B]};batch=2026-03-04-outreach-1;item=1` }),
      li(2, 'linkedin.connect', 'Contact Delta', 'Hooli Example'),
      li(2, 'linkedin.connect', 'Contact Epsilon', 'Umbrella Example'),
    ].map((x) => (x.action === 'linkedin.connect' && x.target !== B ? { ...x, detail: `note=120;${x.detail}` } : x)));
    let calls = 0;
    const headless = async (opts) => {
      if (isVerify(opts)) return { text: VERDICT_OK, model: 'sonnet', usage: null };
      calls += 1;
      return { text: CLEAN_SLOTS, model: 'sonnet', usage: null };
    };
    const res = await outreachDrafts({ paths: resolvePaths({ root: r.root, dataDir: r.data }), today: DAY, deps: { headless, t6On: false }, say: () => {} });
    const items = res.ids.flatMap((id) => readBatch(r.data, id).items);
    const connect = items.find((it) => it.action === 'connect');
    assert.ok(connect, `a connect item: ${JSON.stringify(items)}`);
    assert.equal(connect.target, A);
    assert.equal(connect.channel, 'linkedin');
    assert.equal(connect.message, '', 'two notes used this week on the free tier: the connect has no note');
    const follow = items.find((it) => it.action === 'follow-up');
    assert.ok(follow, `a follow-up item: ${JSON.stringify(items)}`);
    assert.equal(follow.target, B);
    assert.equal(follow.channel, 'email', 'the follow-up goes out on the channel of the last message');
    assert.equal(follow.to, EMAIL[B]);
    assert.equal(calls, 1, 'the empty-note connect makes no model call');
  } finally {
    r.cleanup();
  }
});

// S1
test('S1 with outreach at drafts or off gmail.send exits 3, an application follow-up email is left alone, and the drafter writes no batch', async () => {
  for (const mode of ['drafts', 'off']) {
    await withPack([], async (p) => {
      const r = emailCheck(p, C, GLOBEX, 1);
      assert.equal(r.code, 3, `${mode}: ${out(r)}`);
      assert.match(out(r), new RegExp(`outreach is ${mode}`));
    }, { config: `switches:\n  outreach: ${mode}\n` });
  }
  const submit = [
    row({ ts: ago(8), action: 'apply.pending', target: 'ex-role-1', company: ACME, detail: 'batch=2026-03-02-apply-1;item=1' }),
    row({ ts: ago(8), action: 'apply.submit', target: 'ex-role-1', company: ACME, detail: 'batch=2026-03-02-apply-1;item=1' }),
  ];
  await withPack(submit, async (p) => {
    const r = run(p, ['check', 'gmail.send', '--target', 'ex-role-1', '--company', ACME, '--email', 'jobs@example.com', '--followup', '--batch-id', OB, '--item', '1']);
    assert.equal(r.code, 0, `an application follow-up with outreach off: ${out(r)}`);
  }, { config: 'switches:\n  outreach: "off"\n' });

  for (const mode of ['drafts', 'off']) {
    const r = makeRoot({ config: `switches:\n  outreach: "${mode}"\n` });
    try {
      r.write('cv.md', CV);
      const state = { due: [{ name: C, company: GLOBEX, action: 'warm-opener' }], followups: [] };
      const headless = async (opts) => ({ text: isVerify(opts) ? VERDICT_OK : CLEAN_SLOTS, model: 'sonnet', usage: null });
      const res = await outreachDrafts({ paths: resolvePaths({ root: r.root, dataDir: r.data }), today: DAY, deps: { headless, state, t6On: false }, say: () => {} });
      assert.deepEqual(listBatches(r.data), [], `${mode}: no batch is written`);
      const file = join(r.data, 'outreach', `drafts-${DAY}.md`);
      if (mode === 'drafts') {
        assert.equal(res.draftsFile, file);
        // Fix 8: code writes the greeting ("Hi <first name>," and a blank line), so the count is of the message as sent.
        const sent = `Hi ${C.split(' ')[0]},\n\n${CLEAN}`;
        assert.match(readFileSync(file, 'utf8'), new RegExp(`1\\. ${C} \\| ${GLOBEX} \\| warm-opener \\| ${sent.length} chars\\n\\n${sent}`));
      } else {
        assert.equal(existsSync(file), false, 'off: nothing drafted');
        assert.equal(res.ready, 0);
      }
    } finally {
      r.cleanup();
    }
  }
});

// S2
test('S2 outreach send checks without --company or --target exit 2', async () => {
  await withPack([li(2, 'linkedin.message', A)], async (p) => {
    const noCompany = run(p, ['check', 'gmail.send', '--target', B, '--email', EMAIL[B], '--batch-id', OB, '--item', '1']);
    assert.equal(noCompany.code, 2, `gmail.send without --company: ${out(noCompany)}`);
    for (const action of ['linkedin.connect', 'linkedin.message', 'linkedin.nudge']) {
      const noTarget = run(p, ['check', action, '--company', ACME, '--pending', '5', '--batch-id', OB, '--item', '1']);
      assert.equal(noTarget.code, 2, `${action} without --target: ${out(noTarget)}`);
      const bare = run(p, ['check', action, '--target', B, '--pending', '5', '--batch-id', OB, '--item', '1']);
      assert.equal(bare.code, 2, `${action} without --company: ${out(bare)}`);
    }
    const withCompany = emailCheck(p, B, ACME, 1);
    assert.equal(withCompany.code, 3, `with --company the active-company rule refuses: ${out(withCompany)}`);
  });
});

// S3
test('S3 gmail.send --followup needs a logged submit in the 7 to 10 day window and never goes to a declined contact address', async () => {
  const followup = (p, extra = []) => run(p, ['check', 'gmail.send', '--target', 'ex-role-1', '--company', ACME, '--email', 'jobs@example.com', '--followup', '--batch-id', OB, '--item', '1', ...extra]);
  await withPack([], async (p) => {
    const r = followup(p);
    assert.equal(r.code, 3, `no logged submit: ${out(r)}`);
    assert.match(out(r), /no logged submit/);
  });
  const submit = (days) => [row({ ts: ago(days), action: 'apply.submit', target: 'ex-role-1', company: ACME, detail: 'batch=2026-02-20-apply-1;item=1' })];
  await withPack(submit(3), async (p) => assert.equal(followup(p).code, 3, 'day 3 is too early'));
  await withPack(submit(8), async (p) => assert.equal(followup(p).code, 0, 'day 8 passes'));
  const declined = [
    ...submit(8),
    row({ ts: ago(12), action: 'gmail.send', target: B, company: ACME, detail: `email=${EMAIL[B]};batch=2026-02-26-outreach-1;item=1` }),
    li(10, 'linkedin.declined', B),
  ];
  await withPack(declined, async (p) => {
    const r = run(p, ['check', 'gmail.send', '--target', 'ex-role-1', '--company', ACME, '--email', EMAIL[B].toUpperCase(), '--followup', '--batch-id', OB, '--item', '1']);
    assert.equal(r.code, 3, `the address of a contact who declined: ${out(r)}`);
    assert.match(out(r), /declined/);
  });
});

// S4: an outreach batch with one email item, written into a pack and approved.
function emailBatch(p, today, item = {}) {
  const [id] = writeBatches(p.dataDir, {
    date: today,
    kind: 'outreach',
    items: [{ company: GLOBEX, role: `${C} (warm-opener, email to ${EMAIL[C]})`, score: null, preview: CLEAN, link: '', message: CLEAN, action: 'warm-opener', channel: 'email', target: C, to: EMAIL[C], subject: 'Hello', ...item }],
  });
  approve(p, '1', { id, today });
  return id;
}

test('S4 an approved item is spent only on its own target, address and text', async () => {
  const today = realToday();
  const p = await makePack();
  try {
    const id = emailBatch(p, today);
    const other = run(p, ['check', 'gmail.send', '--target', 'Someone Else', '--company', 'Initech Example', '--email', 'else@example.com', '--batch-id', id, '--item', '1'], { today });
    assert.equal(other.code, 3, `budget refuses another target: ${out(other)}`);
    assert.match(out(other), /approved for/);
    assert.equal(run(p, ['check', 'gmail.send', '--target', C, '--company', GLOBEX, '--email', EMAIL[C], '--batch-id', id, '--item', '1'], { today }).code, 0, 'the item target passes');

    let opened = 0;
    const browser = async () => {
      opened += 1;
      return 'sent';
    };
    const paths = resolvePaths({ root: p.root, dataDir: p.dataDir });
    const base = { batchId: id, item: 1, target: C, company: GLOBEX };
    for (const [why, email] of [
      ['another target', { ...base, target: 'Someone Else' }],
      ['another address', { ...base, to: 'else@example.com' }],
      ['another text', { ...base, body: 'A different message.' }],
    ]) {
      const res = await sendEmail({ paths, port: 9, email, date: today, runner: runResult, browser });
      assert.equal(res.code, 3, `${why}: ${JSON.stringify(res)}`);
    }
    assert.equal(opened, 0, 'nothing was opened for a mismatch');

    const sent = await sendEmail({ paths, port: 9, email: base, date: today, runner: runResult, browser });
    assert.equal(sent.code, 0, JSON.stringify(sent));
    assert.equal(opened, 1, 'the matching item opened the browser once');
    const logged = (await readLog(p)).find((r) => r.action === 'gmail.send');
    assert.match(logged.detail, new RegExp(`email=${EMAIL[C]}`), 'the address comes from the item');
    assert.equal(logged.approval, '', 'no approval words are made up');
  } finally {
    p.cleanup();
  }
});

// S5
test('S5 sendEmail logs gmail.pending before the click, reports a failed send log as code 1, and an unconfirmed click as code 5', async () => {
  const today = realToday();
  const p = await makePack();
  try {
    const paths = resolvePaths({ root: p.root, dataDir: p.dataDir });
    const id = emailBatch(p, today);
    const email = { batchId: id, item: 1, target: C, company: GLOBEX };
    const failSendLog = (cmd, args, opts) => (args[1] === 'log' && args[2] === 'gmail.send' ? { code: 1, stdout: '', stderr: 'lock timeout' } : runResult(cmd, args, opts));
    let pendingBeforeClick = false;
    const browser = async () => {
      pendingBeforeClick = (await readLog(p)).some((r) => r.action === 'gmail.pending');
      return 'sent';
    };
    const res = await sendEmail({ paths, port: 9, email, date: today, runner: failSendLog, browser });
    assert.equal(pendingBeforeClick, true, 'the item was spent before the click');
    assert.equal(res.code, 1, JSON.stringify(res));
    assert.equal(res.sent, true);
    assert.match(res.reason, /sent but not logged/);
    const again = run(p, ['check', 'gmail.send', '--target', C, '--company', GLOBEX, '--email', EMAIL[C], '--batch-id', id, '--item', '1'], { today });
    assert.equal(again.code, 3, `the pending row spent the item: ${out(again)}`);
  } finally {
    p.cleanup();
  }

  const q = await makePack();
  try {
    const paths = resolvePaths({ root: q.root, dataDir: q.dataDir });
    const id = emailBatch(q, today);
    const res = await sendEmail({ paths, port: 9, email: { batchId: id, item: 1, target: C, company: GLOBEX }, date: today, runner: runResult, browser: async () => 'unconfirmed' });
    assert.equal(res.code, 5, JSON.stringify(res));
    assert.equal(res.sent, false);
    const rows = await readLog(q);
    assert.ok(rows.some((r) => r.action === 'gmail.pending'), 'the item stays spent');
    assert.ok(!rows.some((r) => r.action === 'gmail.send'), 'an unconfirmed click is not logged as sent');
  } finally {
    q.cleanup();
  }
});

// S6
test('S6 limits.connect_per_day 0 is a valid lowering: status and apply.submit still run and connects are refused', async () => {
  const p = await makePack({ config: 'limits:\n  connect_per_day: 0\n' });
  try {
    approve(p, '1,2');
    assert.equal((await loadStudentConfig({ root: p.root })).limits.connect_per_day, 0);
    const status = run(p, ['status']);
    assert.equal(status.code, 0, out(status));
    const submit = run(p, ['check', 'apply.submit', '--company', ACME, '--score', '4', '--batch', '1', '--batch-id', OB, '--item', '1']);
    assert.equal(submit.code, 0, out(submit));
    const connect = run(p, ['check', 'linkedin.connect', '--target', C, '--company', GLOBEX, '--pending', '5', '--batch-id', OB, '--item', '2']);
    assert.equal(connect.code, 3, out(connect));
  } finally {
    p.cleanup();
  }
});

// S7
test('S7 a warm opener that asks for a referral is flagged and kept out of the batch', async () => {
  const r = makeRoot();
  try {
    r.write('cv.md', CV);
    const state = { due: [{ name: C, company: GLOBEX, action: 'warm-opener' }, { name: A, company: ACME, action: 'warm-opener' }], followups: [] };
    const referral = 'Thanks for connecting. Would you be open to a referral for the role on your team?';
    const headless = async (opts) => ({ text: isVerify(opts) ? VERDICT_OK : String(opts.prompt).includes(GLOBEX) ? referral : CLEAN_SLOTS, model: 'sonnet', usage: null });
    const said = [];
    const res = await outreachDrafts({ paths: resolvePaths({ root: r.root, dataDir: r.data }), today: DAY, deps: { headless, state, t6On: false }, say: (s) => said.push(s) });
    const batches = JSON.stringify(listBatches(r.data).map((id) => readBatch(r.data, id)));
    assert.ok(!batches.includes(GLOBEX), `the referral ask is kept out: ${batches}`);
    assert.ok(batches.includes(ACME), 'the clean opener is batched');
    assert.match(JSON.stringify(res.flagged), /asks for a referral in a first message/);
    assert.ok(said.some((s) => s.includes(C) && /flagged/.test(s)));
  } finally {
    r.cleanup();
  }
});

// The outreach-state due list gives a contact follow-up the channel and address of the last message.
test('M2 outreach-state due carries the channel of the last message on a contact follow-up', async () => {
  const p = await makePack({
    rows: [li(10, 'linkedin.connect', B, GLOBEX), li(9, 'linkedin.accept', B, GLOBEX), row({ ts: ago(6), action: 'gmail.send', target: B, company: GLOBEX, detail: `email=${EMAIL[B]};batch=b;item=1` })],
  });
  try {
    const st = await outreachState(p.dataDir, at(DAY, 12).getTime());
    const f = st.due.find((d) => d.action === 'follow-up');
    assert.deepEqual({ name: f?.name, channel: f?.channel, email: f?.email }, { name: B, channel: 'email', email: EMAIL[B] });
  } finally {
    p.cleanup();
  }
});

// Fix round 2b: an application follow-up reaches a batch only with an address.
const FOLLOW_STATE = { due: [], followups: [{ target: 'https://jobs.example.com/acme/1', company: ACME, submitted: shiftDate(DAY, -8) }] };
// An application follow-up gets its prose body; any contact draft in the same round gets CLEAN_SLOTS; the verifier passes.
const followHeadless = async (opts) => ({ text: isVerify(opts) ? VERDICT_OK : String(opts.prompt).includes('\nApplication: ') ? 'The role looks like a great match for practical work.' : CLEAN_SLOTS, model: 'sonnet', usage: null });

test('2b a recruiter email in contacts.tsv lands on the application follow-up item', async () => {
  const r = makeRoot();
  try {
    r.write('cv.md', CV);
    r.write('data/contacts.tsv', serializeTsv(['date', 'company', 'name', 'stage', 'role', 'email'], [
      { date: shiftDate(DAY, -5), company: ACME, name: 'Contact Recruiter', stage: 'accepted', role: 'Campus Recruiter', email: 'recruiter@example.com' },
      { date: shiftDate(DAY, -5), company: ACME, name: 'Contact No', stage: 'declined', role: 'Hiring Manager', email: 'no@example.com' },
    ]));
    const res = await outreachDrafts({ paths: resolvePaths({ root: r.root, dataDir: r.data }), today: DAY, deps: { headless: followHeadless, state: FOLLOW_STATE, t6On: false }, say: () => {} });
    const items = res.ids.flatMap((id) => readBatch(r.data, id).items);
    assert.equal(items.length, 1, JSON.stringify(items));
    assert.equal(items[0].action, 'application-follow-up');
    assert.equal(items[0].to, 'recruiter@example.com');
    assert.match(items[0].role, /email to recruiter@example\.com/, 'the student sees the address on the batch line');
    assert.deepEqual(res.needsAddress, []);
  } finally {
    r.cleanup();
  }
});

test('2b a follow-up with no address is not batched and is listed under needs an address with the guided prompt', async () => {
  const r = makeRoot();
  try {
    r.write('cv.md', CV);
    const said = [];
    const res = await outreachDrafts({ paths: resolvePaths({ root: r.root, dataDir: r.data }), today: DAY, deps: { headless: followHeadless, state: FOLLOW_STATE, t6On: false }, say: (s) => said.push(s) });
    assert.deepEqual(listBatches(r.data), [], 'no batch holds an item with no address');
    assert.equal(res.needsAddress.length, 1);
    const text = said.join('\n');
    assert.match(text, /needs an address/);
    assert.match(text, new RegExp(`Type: follow up with ${ACME} at <email>`));
    assert.match(text, /^Next: /m);
    assert.match(text, /^Why: /m);
  } finally {
    r.cleanup();
  }
});

test('2b --followup-to adds the follow-up to today\'s batch with that address, and the CLI rejects a bad address', async () => {
  const { addFollowupTo } = await import('../../scripts/outreach-drafts.mjs');
  const r = makeRoot();
  try {
    r.write('cv.md', CV);
    const paths = resolvePaths({ root: r.root, dataDir: r.data });
    const [open] = writeBatches(r.data, { date: DAY, kind: 'outreach', items: [{ company: GLOBEX, role: `${C} (warm-opener)`, score: null, preview: CLEAN, link: '', message: CLEAN, action: 'warm-opener', channel: 'linkedin', target: C }] });
    const res = await addFollowupTo({ paths, today: DAY, which: ACME, email: 'jobs@example.com', deps: { headless: followHeadless, state: FOLLOW_STATE }, say: () => {} });
    assert.deepEqual(res, { id: open, item: 2 });
    const item = readBatch(r.data, open).items[1];
    assert.equal(item.to, 'jobs@example.com');
    assert.equal(item.target, FOLLOW_STATE.followups[0].target);
    assert.equal(readBatch(r.data, open).approved, null, 'still waits for approval');
    await assert.rejects(addFollowupTo({ paths, today: DAY, which: 'Nobody Example', email: 'x@example.com', deps: { headless: followHeadless, state: FOLLOW_STATE }, say: () => {} }), /no application follow-up is due/);
    await assert.rejects(addFollowupTo({ paths, today: DAY, which: ACME, email: 'not-an-address', deps: { headless: followHeadless, state: FOLLOW_STATE }, say: () => {} }), /email address/);
  } finally {
    r.cleanup();
  }
});

// Fix round 2c: the budget check runs before the batch item is read, even when the batch file is missing.
test('2c sendEmail runs budget check gmail.send first with the caller fields when the batch file is missing', async () => {
  const p = await makePack();
  try {
    const paths = resolvePaths({ root: p.root, dataDir: p.dataDir });
    const email = { batchId: 'hb9', item: 4, target: C, company: GLOBEX, to: EMAIL[C], subject: 'Hello', body: CLEAN };
    let opened = 0;
    const browser = async () => {
      opened += 1;
      return 'sent';
    };
    const calls = [];
    const refuseAll = (cmd, args) => {
      calls.push(args.slice(1));
      return { code: 3, stdout: 'refused: synthetic', stderr: '' };
    };
    const refused = await sendEmail({ paths, port: 9, email, date: DAY, runner: refuseAll, browser });
    assert.equal(refused.code, 3, JSON.stringify(refused));
    assert.equal(calls.length, 1);
    const [first] = calls;
    assert.deepEqual(first.slice(0, 2), ['check', 'gmail.send']);
    assert.equal(first[first.indexOf('--batch-id') + 1], 'hb9');
    assert.equal(first[first.indexOf('--item') + 1], '4');
    assert.equal(first[first.indexOf('--email') + 1], EMAIL[C], 'the caller address is used when the batch cannot be read');
    assert.equal(opened, 0, 'a refused check opens nothing');

    const passAll = (cmd, args) => {
      calls.push(args.slice(1));
      return { code: 0, stdout: 'ok', stderr: '' };
    };
    calls.length = 0;
    const missing = await sendEmail({ paths, port: 9, email, date: DAY, runner: passAll, browser });
    assert.equal(missing.code, 3, `a passing check with no batch file is still refused: ${JSON.stringify(missing)}`);
    assert.match(missing.reason, /no such batch item/);
    assert.deepEqual(calls.map((c) => c.slice(0, 2).join(' ')), ['check gmail.send'], 'no pending row before the item binding');
    assert.equal(opened, 0);
  } finally {
    p.cleanup();
  }
});

// Round 3 R1: an unconfirmed gmail.pending counts as the email it may have sent.
test('R1 an unconfirmed pending first email holds the contact: no second opener is due and a second first message exits 3', async () => {
  const today = realToday();
  const nowMs = at(today, 12).getTime();
  const p = await makePack({ rows: [liRow({ ts: ago(9, 12, today), action: 'linkedin.connect', target: C, company: GLOBEX }), liRow({ ts: ago(8, 12, today), action: 'linkedin.accept', target: C, company: GLOBEX })] });
  try {
    const paths = resolvePaths({ root: p.root, dataDir: p.dataDir });
    assert.ok((await outreachState(p.dataDir, nowMs)).due.some((d) => d.name === C && d.action === 'warm-opener'), 'an opener is due before any send');
    const id = emailBatch(p, today);
    const res = await sendEmail({ paths, port: 9, email: { batchId: id, item: 1, target: C, company: GLOBEX }, date: today, runner: runResult, browser: async () => 'unconfirmed' });
    assert.equal(res.code, 5, JSON.stringify(res));
    const st = await outreachState(p.dataDir, nowMs);
    assert.ok(!st.due.some((d) => d.name === C && d.action === 'warm-opener'), `no second opener: ${JSON.stringify(st.due)}`);
    const [id2] = writeBatches(p.dataDir, { date: today, kind: 'outreach', items: [{ company: GLOBEX, role: C, preview: 'Hi again', link: '', message: 'Hi again', action: 'warm-opener', channel: 'email', target: C, to: EMAIL[C], subject: 'Hello' }] });
    approve(p, '1', { id: id2, today });
    const again = run(p, ['check', 'gmail.send', '--target', C, '--company', GLOBEX, '--email', EMAIL[C], '--batch-id', id2, '--item', '1'], { today });
    assert.equal(again.code, 3, `second first message to the same person: ${out(again)}`);
    assert.match(out(again), /already has a first message/);
    approve(p, '1', { id: OB, today });
    const other = run(p, ['check', 'linkedin.connect', '--target', 'Contact Zeta', '--company', GLOBEX, '--pending', '5', '--batch-id', OB, '--item', '1'], { today });
    assert.equal(other.code, 3, `a new contact at the same company: ${out(other)}`);
    assert.match(out(other), /already has an active contact/);
  } finally {
    p.cleanup();
  }
});

test('R1 a confirmed send logs cleanly over its own pending row', async () => {
  const today = realToday();
  const p = await makePack();
  try {
    const id = emailBatch(p, today);
    const res = await sendEmail({ paths: resolvePaths({ root: p.root, dataDir: p.dataDir }), port: 9, email: { batchId: id, item: 1, target: C, company: GLOBEX }, date: today, runner: runResult, browser: async () => 'sent' });
    assert.equal(res.code, 0, JSON.stringify(res));
    assert.deepEqual((await readLog(p)).filter((r) => r.action.startsWith('gmail.')).map((r) => r.action), ['gmail.pending', 'gmail.send']);
  } finally {
    p.cleanup();
  }
});

// Round 3 R2: one linkedin.reply row per distinct reply.
test('R2 readReply logs a reply once however often it is read, and a new reply adds a row', async () => {
  const { readReply } = await import('../../lib/gmail-chrome.mjs');
  const p = await makePack({ rows: [row({ ts: ago(7), action: 'gmail.send', target: C, company: GLOBEX, detail: `email=${EMAIL[C]};batch=X;item=1` })] });
  try {
    const paths = resolvePaths({ root: p.root, dataDir: p.dataDir });
    const read = (text, url = 'https://mail.example.com/x') => readReply({ dataDir: p.dataDir, paths, port: 9, url, contact: { name: C, company: GLOBEX }, date: DAY, runner: runResult, browser: async () => ({ text, hrefs: [] }) });
    await read('Happy to chat. I work on the data team.');
    await read('Happy to chat. I work on the data team.');
    const replies = async () => (await readLog(p)).filter((r) => r.action === 'linkedin.reply').length;
    assert.equal(await replies(), 1, 'the same reply read twice is one row');
    await read('One more thing: we post roles on Mondays.');
    assert.equal(await replies(), 2, 'a different reply adds a row');
    await read('Any text', 'https://mail.google.com/mail/u/0/#inbox/FMfcgzSample0002');
    await read('Any text, read again later', 'https://mail.google.com/mail/u/0/#inbox/FMfcgzSample0002');
    assert.equal(await replies(), 3, 'a Gmail message id keys the reply');
  } finally {
    p.cleanup();
  }
});

// Round 3 R3: application follow-ups are batched under every outreach switch value.
test('R3 with outreach at drafts or off the application follow-up is still batched and --followup-to still adds one', async () => {
  const { addFollowupTo } = await import('../../scripts/outreach-drafts.mjs');
  for (const mode of ['drafts', 'off']) {
    const r = makeRoot({ config: `switches:\n  outreach: "${mode}"\n` });
    try {
      r.write('cv.md', CV);
      r.write('data/contacts.tsv', serializeTsv(['date', 'company', 'name', 'stage', 'role', 'email'], [{ date: shiftDate(DAY, -5), company: ACME, name: 'Contact Recruiter', stage: 'accepted', role: 'Technical Recruiter', email: 'recruiter@example.com' }]));
      const state = { due: [{ name: C, company: GLOBEX, action: 'warm-opener' }], followups: FOLLOW_STATE.followups };
      const res = await outreachDrafts({ paths: resolvePaths({ root: r.root, dataDir: r.data }), today: DAY, deps: { headless: followHeadless, state, t6On: false }, say: () => {} });
      const items = res.ids.flatMap((id) => readBatch(r.data, id).items);
      assert.deepEqual(items.map((it) => it.action), ['application-follow-up'], `${mode}: only the follow-up is batched: ${JSON.stringify(items)}`);
      assert.equal(items[0].to, 'recruiter@example.com');
      const file = join(r.data, 'outreach', `drafts-${DAY}.md`);
      if (mode === 'drafts') assert.match(readFileSync(file, 'utf8'), new RegExp(`${C} \\| ${GLOBEX} \\| warm-opener`), 'contact drafts go to the file');
      else assert.equal(existsSync(file), false, 'off: no contact outreach drafted');
      const added = await addFollowupTo({ paths: resolvePaths({ root: r.root, dataDir: r.data }), today: DAY, which: ACME, email: 'jobs@example.com', deps: { headless: followHeadless, state: FOLLOW_STATE }, say: () => {} });
      assert.ok(added.id, `${mode}: --followup-to adds an item`);
    } finally {
      r.cleanup();
    }
  }
});

// Round 3b R2b: one reply key however and whenever the reply is read.
test('R2b the same reply read under inbox, search and label urls on two days logs once; two replies under one search url log twice', async () => {
  const { readReply, replyKey } = await import('../../lib/gmail-chrome.mjs');
  const p = await makePack({ rows: [row({ ts: ago(7), action: 'gmail.send', target: C, company: GLOBEX, detail: `email=${EMAIL[C]};batch=X;item=1` })] });
  try {
    const paths = resolvePaths({ root: p.root, dataDir: p.dataDir });
    const read = (url, text, date, page = {}) => readReply({ dataDir: p.dataDir, paths, port: 9, url, contact: { name: C, company: GLOBEX }, date, runner: runResult, browser: async () => ({ text, hrefs: [], ...page }) });
    const replies = async () => (await readLog(p)).filter((r) => r.action === 'linkedin.reply').length;
    const G = 'https://mail.google.com/mail/u/0/';
    const ID = '18c2f0a9b3d4e5f6';
    const TEXT = 'Happy to chat. I work on the data team.';
    for (const date of [DAY, shiftDate(DAY, 1)]) {
      await read(`${G}#inbox/${ID}`, TEXT, date);
      await read(`${G}#search/from%3Agamma/${ID}`, TEXT, date);
      await read(`${G}#label/Recruiting/${ID}`, TEXT, date);
    }
    assert.equal(await replies(), 1, 'one reply, one row');

    const searchUrl = `${G}#search/deadbeefdeadbeefdeadbeef`;
    assert.equal(replyKey({ url: searchUrl, text: 'a' }).startsWith('h-'), true, 'a search query is never taken as a message id');
    await read(searchUrl, 'First distinct reply about the team.', DAY, { from: EMAIL[C] });
    await read(searchUrl, 'Second distinct reply about the schedule.', DAY, { from: EMAIL[C] });
    assert.equal(await replies(), 3, 'two different replies under one search url log twice');
    await read(searchUrl, '  first distinct REPLY about the team. ', shiftDate(DAY, 2), { from: EMAIL[C] });
    assert.equal(await replies(), 3, 'the text hash has no read date and ignores spacing and case');

    await read(`${G}#search/anything`, 'Text that differs from the page id read.', DAY, { id: 'FMfcgzPageId0001' });
    await read(`${G}#inbox/FMfcgzPageId0001`, 'Text that differs again.', shiftDate(DAY, 3));
    assert.equal(await replies(), 4, 'a message id from the page keys the reply like one from the url');
  } finally {
    p.cleanup();
  }
});
