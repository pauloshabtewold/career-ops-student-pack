// M-007 fix round 1, S-8: the T6 reply-sort rules (scripts/outreach-drafts.mjs sortReply) catch the declines and the
// thanks the review found sent to the AI as needs-answer. T6 is not re-run and docs/lever-verdicts.json is unchanged
// (T6 stays off). Synthetic reply text only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortReply } from '../../scripts/outreach-drafts.mjs';

test('S-8 the new DECLINE patterns sort a no as no', () => {
  for (const text of [
    'Please remove me from your outreach list.',
    'Please stop messaging me.',
    'Please stop contacting me about roles.',
    'Please do not send further messages.',
    'I am not the right person and cannot pass this along.',
    'I will not be able to help with a referral.',
    'We filled all positions for this season, so I will pass.',
    "Thanks, but I'll pass for now.",
    'We do not take interns this year.',
  ]) assert.equal(sortReply(text), 'no', text);
});

test('S-8 appreciated, appreciation and appreciate are a thanks', () => {
  for (const text of ['Much appreciated', 'Appreciated, good luck!', 'Thanks, I appreciate it.', 'Appreciation for the note.']) assert.equal(sortReply(text), 'thanks', text);
});

test('S-8 a question still wins: the new patterns never sort a reply that asks something away', () => {
  for (const text of ['Can you remove me from the list?', 'I will pass this to our recruiter. Could you send your resume?', 'Much appreciated. When are you free?']) assert.equal(sortReply(text), 'needs-answer', text);
});
