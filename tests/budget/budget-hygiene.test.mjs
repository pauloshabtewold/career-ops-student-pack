// budget.mjs outreach hygiene: one active contact per company, one first message per target, a stop after a decline,
// approved batch items required on every send kind and spent once across kinds, and closed or active contacts by
// withdraw, age, accept, message or reply. Every check runs through the CLI in a scratch pack whose clock is pinned to
// local noon on DAY; each refusal case gets its own pack so a refusal row never decides another case.
// Rulings: a reply from a contact is logged as linkedin.reply and a decline as linkedin.declined; gmail.send names the
// contact with --target and the address with --email.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY, at, shiftDate, liRow, row, makePack, readLog, run } from '../helpers/budget-harness.mjs';
import { A, B, C, ACME, GLOBEX, OB, approve, connectCheck, messageCheck, nudgeCheck, emailCheck, out } from '../helpers/outreach-harness.mjs';

const ago = (days, hour = 12) => at(shiftDate(DAY, -days), hour, 0);
const li = (days, action, target, company = ACME, hour = 12) => liRow({ ts: ago(days, hour), action, target, company });

async function withPack(rows, fn) {
  const p = await makePack({ rows });
  try {
    approve(p);
    return await fn(p);
  } finally {
    p.cleanup();
  }
}

// M-004-S7-osdr
test('M-004-S7-osdr a second first message to one person and a new contact at a company with an active one and a message after a decline each exit 3', async () => {
  await withPack([li(2, 'linkedin.message', A)], async (p) => {
    const r = messageCheck(p, A, ACME, 1);
    assert.equal(r.code, 3, `second first message to the same person: ${out(r)}`);
  });
  await withPack([li(2, 'linkedin.message', A)], async (p) => {
    const r = messageCheck(p, B, ACME, 1);
    assert.equal(r.code, 3, `new contact at a company with an active one: ${out(r)}`);
  });
  await withPack([li(10, 'linkedin.connect', A)], async (p) => {
    const r = messageCheck(p, A, ACME, 1);
    assert.equal(r.code, 0, `the same first message without a decline passes: ${out(r)}`);
  });
  await withPack([li(10, 'linkedin.connect', A), li(3, 'linkedin.declined', A)], async (p) => {
    const r = messageCheck(p, A, ACME, 1);
    assert.equal(r.code, 3, `message after a decline: ${out(r)}`);
  });
});

// M-004-S11-osdr
test('M-004-S11-osdr budget check linkedin.connect and linkedin.message and linkedin.nudge each exit 3 without a logged approved batch item', async () => {
  const history = [li(6, 'linkedin.message', C, GLOBEX)];
  await withPack(history, async (p) => {
    assert.equal(connectCheck(p, B, ACME, 1).code, 0, 'connect with an approved item passes');
    assert.equal(messageCheck(p, B, ACME, 2).code, 0, 'message with an approved item passes');
    assert.equal(nudgeCheck(p, C, GLOBEX, 3).code, 0, 'nudge with an approved item passes');
  });
  await withPack(history, async (p) => {
    const connect = connectCheck(p, B, ACME, null);
    assert.equal(connect.code, 3, `connect without --batch-id and --item: ${out(connect)}`);
    const message = messageCheck(p, B, ACME, null);
    assert.equal(message.code, 3, `message without --batch-id and --item: ${out(message)}`);
    const nudge = nudgeCheck(p, C, GLOBEX, null);
    assert.equal(nudge.code, 3, `nudge without --batch-id and --item: ${out(nudge)}`);
    const unlisted = connectCheck(p, B, ACME, 7);
    assert.equal(unlisted.code, 3, `connect with an item the batch does not list: ${out(unlisted)}`);
    const unlogged = connectCheck(p, B, ACME, 1, { id: '2026-03-10-outreach-9' });
    assert.equal(unlogged.code, 3, `connect with a batch that was never approved: ${out(unlogged)}`);
  });
});

// M-004-S16-osdr
test('M-004-S16-osdr gmail.send to a contact who declined or a second first email with no reply or an email to a new contact at a company with an active one each exit 3', async () => {
  const emailed = row({ ts: ago(2), action: 'gmail.send', target: A, company: ACME, detail: 'email=alpha@example.com;batch=2026-03-08-outreach-1;item=1' });
  await withPack([], async (p) => {
    const r = emailCheck(p, C, GLOBEX, 1);
    assert.equal(r.code, 0, `a first email to a fresh contact passes: ${out(r)}`);
  });
  await withPack([li(10, 'linkedin.connect', A), li(3, 'linkedin.declined', A)], async (p) => {
    const r = emailCheck(p, A, ACME, 1);
    assert.equal(r.code, 3, `email to a contact who declined: ${out(r)}`);
  });
  await withPack([emailed], async (p) => {
    const r = emailCheck(p, A, ACME, 1);
    assert.equal(r.code, 3, `second first email with no reply: ${out(r)}`);
  });
  await withPack([emailed], async (p) => {
    const r = emailCheck(p, B, ACME, 1);
    assert.equal(r.code, 3, `email to a new contact at a company with an active one: ${out(r)}`);
  });
});

// M-004-S17-osdr
test('M-004-S17-osdr one approved item used by linkedin.message is refused for gmail.send', async () => {
  await withPack([], async (p) => {
    assert.equal(messageCheck(p, A, ACME, 1).code, 0);
    const logged = run(p, ['log', 'linkedin.message', '--target', A, '--company', ACME, '--length', '120', '--approval', 'send 1', '--batch-id', OB, '--item', '1']);
    assert.equal(logged.code, 0, out(logged));
    const other = emailCheck(p, C, GLOBEX, 2);
    assert.equal(other.code, 0, `an unused approved item still passes for gmail.send: ${out(other)}`);
    const reused = emailCheck(p, C, GLOBEX, 1);
    assert.equal(reused.code, 3, `item 1 was spent by linkedin.message: ${out(reused)}`);
    assert.ok(!(await readLog(p)).some((r) => r.action === 'gmail.send'), 'no email was logged');
  });
});

// M-004-S21-osdr
test('M-004-S21-osdr a withdrawn or 21-day-old unaccepted connect to A frees Acme for a connect to B while a 5-day-old pending connect holds it', async () => {
  await withPack([li(22, 'linkedin.connect', A, ACME, 10), li(1, 'linkedin.withdraw', A, ACME, 10)], async (p) => {
    const r = connectCheck(p, B, ACME, 1);
    assert.equal(r.code, 0, `withdraw logged on day 21: ${out(r)}`);
  });
  await withPack([li(21, 'linkedin.connect', A, ACME, 10)], async (p) => {
    const r = connectCheck(p, B, ACME, 1);
    assert.equal(r.code, 0, `connect 21 days old with no accept and no withdraw row: ${out(r)}`);
  });
  await withPack([li(5, 'linkedin.connect', A, ACME, 10)], async (p) => {
    const r = connectCheck(p, B, ACME, 1);
    assert.equal(r.code, 3, `5-day-old pending connect to A holds Acme: ${out(r)}`);
  });
});

// M-004-S22-osdr
test('M-004-S22-osdr a message to A or a reply from A after a 25-day-old connect keeps A active and holds Acme against a connect to B', async () => {
  await withPack([li(25, 'linkedin.connect', A), li(20, 'linkedin.message', A)], async (p) => {
    const r = connectCheck(p, B, ACME, 1);
    assert.equal(r.code, 3, `message to A after the connect: ${out(r)}`);
  });
  await withPack([li(25, 'linkedin.connect', A), li(20, 'linkedin.reply', A)], async (p) => {
    const r = connectCheck(p, B, ACME, 1);
    assert.equal(r.code, 3, `reply from A after the connect: ${out(r)}`);
  });
});

// M-004-S23-osdr
test('M-004-S23-osdr a linkedin.accept logged after a 25-day-old connect keeps budget check linkedin.connect for B at Acme at exit 3', async () => {
  await withPack([li(25, 'linkedin.connect', A), li(24, 'linkedin.accept', A)], async (p) => {
    const r = connectCheck(p, B, ACME, 1);
    assert.equal(r.code, 3, out(r));
  });
});
