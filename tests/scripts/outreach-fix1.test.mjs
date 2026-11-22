// Fix round 1 for P3 outreach: outreachState().due itself holds at most one opener per company, a contact known only
// from a logged linkedin.connect holds its company until the invite is withdrawn or 21 days old, and sortReply sorts
// replies by what they ask (a question wins over a thanks or a no). Scratch packs with placeholder contacts only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outreachState } from '../../scripts/outreach-state.mjs';
import { draftJobs, sortReply } from '../../scripts/outreach-drafts.mjs';
import { DAY, at, shiftDate, liRow, makePack } from '../helpers/budget-harness.mjs';
import { contact, writeContacts } from '../helpers/outreach-harness.mjs';

const Q = 'Quillon Example';
const R = 'Rivet Example';
const P1 = 'Person One';
const P2 = 'Person Two';
const P3 = 'Person Three';
const NOW = at(DAY, 12);
const d = (days) => shiftDate(DAY, -days);
const li = (days, action, target, company, hour = 12) => liRow({ ts: at(d(days), hour, 0), action, target, company });

async function dueOf(contactRows, actionRows, now = NOW) {
  const p = await makePack({ rows: actionRows });
  try {
    writeContacts(p.dataDir, contactRows);
    return (await outreachState(p.dataDir, now)).due;
  } finally {
    p.cleanup();
  }
}
const openersAt = (due, company) => due.filter((x) => /opener/.test(x.action) && x.company === company);

test('outreachState due holds one opener per company: the earliest connect at Q and the contact at R', async () => {
  const contacts = [contact(d(4), Q, P1, 'accepted'), contact(d(3), Q, P2, 'accepted'), contact(d(3), R, P3, 'accepted')];
  const actions = [li(8, 'linkedin.connect', P2, Q), li(9, 'linkedin.connect', P1, Q), li(7, 'linkedin.connect', P3, R)];
  for (const now of [NOW, NOW.getTime()]) {
    const due = await dueOf(contacts, actions, now);
    assert.deepEqual(openersAt(due, Q).map((x) => x.name), [P1], JSON.stringify(due));
    assert.deepEqual(openersAt(due, R).map((x) => x.name), [P3], JSON.stringify(due));
  }
});

test('a connect only in the action log holds its company until it is 21 days old or withdrawn', async () => {
  const other = [contact(d(1), Q, P2, 'accepted')];
  assert.deepEqual(openersAt(await dueOf(other, [li(5, 'linkedin.connect', P1, Q)]), Q), [], 'a 5-day-old pending connect holds Q');
  assert.deepEqual(openersAt(await dueOf(other, [li(21, 'linkedin.connect', P1, Q, 10)]), Q).map((x) => x.name), [P2], '21 days frees Q');
  assert.deepEqual(openersAt(await dueOf(other, [li(5, 'linkedin.connect', P1, Q), li(1, 'linkedin.withdraw', P1, Q)]), Q).map((x) => x.name), [P2], 'a withdraw frees Q');
  // The other contact with its own connect and accept is held too.
  const both = [contact(d(2), Q, P2, 'accepted')];
  assert.deepEqual(openersAt(await dueOf(both, [li(5, 'linkedin.connect', P1, Q), li(3, 'linkedin.connect', P2, Q)]), Q), []);
});

test('sortReply sorts by meaning and a question wins over a thanks or a no', () => {
  const cases = [
    ['Thank you so much, really appreciate you reaching out!', 'thanks'],
    ['Thanks a lot, appreciate it!', 'thanks'],
    ['Unfortunately we are not hiring for that team right now. Sorry about that.', 'no'],
    ['Sorry, we are not hiring interns this year.', 'no'],
    ['Could you send your resume and the team you want?', 'needs-answer'],
    ['Thanks! Can you share your availability next week?', 'needs-answer'],
    ['What role are you targeting and when do you graduate?', 'needs-answer'],
    ['Not hiring now, but please send me your resume for later.', 'needs-answer'],
  ];
  for (const [text, kind] of cases) assert.equal(sortReply(text), kind, text);
});

test('T6 on drafts only needs-answer replies; T6 off drafts every reply', () => {
  const replies = [
    { name: P1, company: Q, text: 'Thanks a lot, appreciate it!' },
    { name: P2, company: Q, text: 'Sorry, we are not hiring interns this year.' },
    { name: P3, company: R, text: 'Thanks! Can you share your availability next week?' },
  ];
  assert.equal(draftJobs({ due: [], followups: [], replies, t6On: false }).length, 3);
  const on = draftJobs({ due: [], followups: [], replies, t6On: true });
  assert.deepEqual(on.map((j) => j.contact.name), [P3]);
});
