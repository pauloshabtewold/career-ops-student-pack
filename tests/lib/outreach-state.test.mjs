// lib/outreach-state.mjs and `scripts/outreach-state.mjs due`: contact stages from data/contacts.tsv (columns date,
// company, name, stage; the latest row per contact wins) plus the action log, the next action per contact, contacts keyed
// by name and company across LinkedIn and email, and one opener per company while another contact there is active.
// Single-contact fixtures read contactRecords as a list of one record, whatever container it returns.
// Rulings: `due` takes --root, --data-dir and --today like the other pack scripts and prints one line per action that
// names the contact and the company, with "opener" on an opener line and "reply" on a reply line; openPostings holds
// company names (the company key is added too); a reply from a contact is logged as linkedin.reply.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contactRecords, inviteAccepted, closedStage, stageOf, nextAction } from '../../lib/outreach-state.mjs';
import { companyKey } from '../../lib/company-key.mjs';
import { DAY, at, shiftDate, liRow, row, makePack } from '../helpers/budget-harness.mjs';
import { A, B, C, ACME, GLOBEX, contact, writeContacts, due, linesFor, openerLines, asList, kindOf, out } from '../helpers/outreach-harness.mjs';

const NOW = at(DAY, 12).getTime();
const d = (days) => shiftDate(DAY, -days);
const ago = (days, hour = 12) => at(d(days), hour, 0);
const li = (days, action, target, company = ACME, hour = 12) => liRow({ ts: ago(days, hour), action, target, company });

function only(contactRows, actionRows) {
  const list = asList(contactRecords(contactRows, actionRows));
  assert.equal(list.length, 1, 'one contact record');
  return list[0];
}
const next = (c, openPostings = new Set()) => kindOf(nextAction(c, { nowMs: NOW, openPostings }));

async function duePack(contactRows, actionRows) {
  const p = await makePack({ rows: actionRows });
  writeContacts(p.dataDir, contactRows);
  try {
    const r = due(p);
    assert.equal(r.code, 0, out(r));
    return r.stdout;
  } finally {
    p.cleanup();
  }
}

// M-004-S1-osdr
test('M-004-S1-osdr the first draft for a new contact has no referral ask and a referral is recommended after two exchanges while a posting is open', () => {
  const posting = new Set([ACME, companyKey(ACME)]);
  const fresh = only([contact(d(3), ACME, A, 'accepted')], [li(6, 'linkedin.connect', A), li(3, 'linkedin.accept', A)]);
  assert.match(next(fresh, posting), /opener/i, 'a new contact gets a warm opener');
  assert.doesNotMatch(next(fresh, posting), /referral/i, 'the opener carries no referral ask');

  const oneExchange = [li(20, 'linkedin.connect', A), li(19, 'linkedin.accept', A), li(15, 'linkedin.message', A), li(14, 'linkedin.reply', A)];
  const twoExchanges = [...oneExchange, li(10, 'linkedin.message', A), li(9, 'linkedin.reply', A)];
  const contacts = [contact(d(19), ACME, A, 'accepted')];
  assert.doesNotMatch(next(only(contacts, oneExchange), posting), /referral/i, 'one exchange is too early for a referral');
  assert.match(next(only(contacts, twoExchanges), posting), /referral/i, 'two exchanges and an open posting recommend a referral ask');
  assert.doesNotMatch(next(only(contacts, twoExchanges), new Set()), /referral/i, 'no open posting, no referral ask');
});

// M-004-S18-osdr
test('M-004-S18-osdr an emailed contact is keyed by name and company so outreach-state drafts no second opener for them', async () => {
  const emailed = row({ ts: ago(1), action: 'gmail.send', target: A, company: ACME, detail: 'email=alpha@example.com;batch=2026-03-09-outreach-1;item=1' });
  const c = only([contact(d(5), ACME, A, 'accepted')], [li(6, 'linkedin.connect', A), li(5, 'linkedin.accept', A), emailed]);
  assert.doesNotMatch(next(c), /opener/i, 'the email was the opener');

  const text = await duePack([contact(d(5), ACME, A, 'accepted'), contact(d(5), GLOBEX, A, 'accepted')], [emailed]);
  assert.ok(openerLines(text, A, GLOBEX).length === 1, `the same name at another company is another contact with an opener:\n${text}`);
  assert.deepEqual(openerLines(text, A, ACME), [], `no second opener for the emailed contact:\n${text}`);
});

// M-004-S19-osdr
test('M-004-S19-osdr outreach-state due lists one opener per company while another contact there is active', async () => {
  const chatting = await duePack(
    [contact(d(10), ACME, A, 'accepted'), contact(d(2), ACME, B, 'accepted'), contact(d(2), GLOBEX, C, 'accepted')],
    [li(3, 'linkedin.message', A), li(1, 'linkedin.reply', A)],
  );
  assert.equal(openerLines(chatting, C, GLOBEX).length, 1, `a company with no active contact gets its opener:\n${chatting}`);
  assert.deepEqual(openerLines(chatting, B, ACME), [], `no opener for B while A is chatting at Acme:\n${chatting}`);

  const bothNew = await duePack([contact(d(4), ACME, A, 'accepted'), contact(d(2), ACME, B, 'accepted'), contact(d(2), GLOBEX, C, 'accepted')], []);
  const acmeOpeners = [...openerLines(bothNew, A, ACME), ...openerLines(bothNew, B, ACME)];
  assert.equal(acmeOpeners.length, 1, `one opener at Acme:\n${bothNew}`);
  assert.equal(openerLines(bothNew, C, GLOBEX).length, 1, `Globex keeps its own opener:\n${bothNew}`);
});

// M-004-S21-osdr
test('M-004-S21-osdr a withdrawn or 21-day-old unaccepted connect to A closes A so outreach-state due offers B an opener while a 5-day-old pending connect holds B back', async () => {
  const withdrawn = only([contact(d(22), ACME, A, 'connect')], [li(22, 'linkedin.connect', A, ACME, 10), li(1, 'linkedin.withdraw', A, ACME, 10)]);
  assert.equal(inviteAccepted(withdrawn), false);
  assert.ok(closedStage(withdrawn, NOW), 'a withdraw with no accept closes the contact');
  const old = only([contact(d(21), ACME, A, 'connect')], [li(21, 'linkedin.connect', A, ACME, 10)]);
  assert.ok(closedStage(old, NOW), 'a connect past invite_withdraw_days with no accept closes the contact');
  const pending = only([contact(d(5), ACME, A, 'connect')], [li(5, 'linkedin.connect', A, ACME, 10)]);
  assert.ok(!closedStage(pending, NOW), 'a 5-day-old pending connect stays open');

  const afterWithdraw = await duePack(
    [contact(d(22), ACME, A, 'connect'), contact(d(1), ACME, B, 'accepted')],
    [li(22, 'linkedin.connect', A, ACME, 10), li(1, 'linkedin.withdraw', A, ACME, 10)],
  );
  assert.equal(openerLines(afterWithdraw, B, ACME).length, 1, `B is offered an opener after the withdraw:\n${afterWithdraw}`);
  const afterAge = await duePack([contact(d(21), ACME, A, 'connect'), contact(d(1), ACME, B, 'accepted')], [li(21, 'linkedin.connect', A, ACME, 10)]);
  assert.equal(openerLines(afterAge, B, ACME).length, 1, `B is offered an opener once the connect is 21 days old:\n${afterAge}`);
  const held = await duePack([contact(d(5), ACME, A, 'connect'), contact(d(1), ACME, B, 'accepted')], [li(5, 'linkedin.connect', A, ACME, 10)]);
  assert.deepEqual(openerLines(held, B, ACME), [], `a 5-day-old pending connect to A holds B back:\n${held}`);
});

// M-004-S22-osdr
test('M-004-S22-osdr a reply from A or a message to A after a 25-day-old connect keeps A active so due lists the reply to A and no opener for B', async () => {
  const replied = only([contact(d(25), ACME, A, 'connect')], [li(25, 'linkedin.connect', A), li(20, 'linkedin.reply', A)]);
  assert.ok(!closedStage(replied, NOW), 'a reply after the connect keeps A open however old the connect is');

  const withReply = await duePack([contact(d(25), ACME, A, 'connect'), contact(d(1), ACME, B, 'accepted')], [li(25, 'linkedin.connect', A), li(20, 'linkedin.reply', A)]);
  assert.ok(linesFor(withReply, A).some((l) => /reply/i.test(l)), `the reply to A is listed:\n${withReply}`);
  assert.deepEqual(openerLines(withReply, B, ACME), [], `no opener for B:\n${withReply}`);

  const withMessage = await duePack([contact(d(25), ACME, A, 'connect'), contact(d(1), ACME, B, 'accepted')], [li(25, 'linkedin.connect', A), li(20, 'linkedin.message', A)]);
  assert.deepEqual(openerLines(withMessage, B, ACME), [], `a message to A after the connect holds B back:\n${withMessage}`);
});

// M-004-S23-osdr
test('M-004-S23-osdr contacts.tsv rows connect then accepted make A connected with a warm opener due and outreach-state due holds B at Acme', async () => {
  const rows = [contact(d(25), ACME, A, 'connect'), contact(d(24), ACME, A, 'accepted')];
  const a = only(rows, [li(25, 'linkedin.connect', A)]);
  assert.equal(stageOf(a, NOW), 'connected', 'the stage comes from the latest contacts.tsv row');
  assert.equal(inviteAccepted(a), true);
  assert.ok(!closedStage(a, NOW), 'an accepted contact is not closed by the age of the connect');
  assert.match(next(a), /opener/i);

  const text = await duePack([...rows, contact(d(1), ACME, B, 'accepted')], [li(25, 'linkedin.connect', A)]);
  assert.equal(openerLines(text, A, ACME).length, 1, `A has a warm opener due:\n${text}`);
  assert.deepEqual(openerLines(text, B, ACME), [], `B is held at Acme:\n${text}`);
});
