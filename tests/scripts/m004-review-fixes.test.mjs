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
const CLEAN = 'Thanks for connecting. I would like to hear how you chose your field when you have time.';

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
    const headless = async () => {
      calls += 1;
      return { text: CLEAN, model: 'sonnet', usage: null };
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
      const headless = async () => ({ text: CLEAN, model: 'sonnet', usage: null });
      const res = await outreachDrafts({ paths: resolvePaths({ root: r.root, dataDir: r.data }), today: DAY, deps: { headless, state, t6On: false }, say: () => {} });
      assert.deepEqual(listBatches(r.data), [], `${mode}: no batch is written`);
      const file = join(r.data, 'outreach', `drafts-${DAY}.md`);
      if (mode === 'drafts') {
        assert.equal(res.draftsFile, file);
        assert.match(readFileSync(file, 'utf8'), new RegExp(`1\\. ${C} \\| ${GLOBEX} \\| warm-opener \\| ${CLEAN.length} chars`));
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
    const headless = async (opts) => ({ text: String(opts.prompt).includes(GLOBEX) ? 'Thanks for connecting. Would you be open to a referral for the role on your team?' : CLEAN, model: 'sonnet', usage: null });
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
