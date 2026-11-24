// M-007 fix round 1, S-5: the guided template names counts and items, shows the second pending thing as an Also line and
// words every step as "I'll ..., approve?" with the exact reply on the Type line; the Next, Type and Why line starts stay.
// T14 is not re-run here (it needs Opus judge calls); its verdict stays as recorded. Pure functions, no files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guidedFooter, nextStep, pendingSteps } from '../../lib/next-step.mjs';
import { footerLines, waitingCounts } from '../../lib/digest.mjs';

const DONE = { installed: true, interview: true, resume: true, chrome: true, signins: { LinkedIn: true, Gmail: true, Handshake: true }, schedule: true };

test('S-5 the first pending step names its count and item, and the second one is an Also line', () => {
  const next = nextStep({ setup: DONE, pipeline: { unknownQuestions: 2, questions: ['Why do you want to work here?', 'Earliest start?'], batchesWaiting: 2, jobsWaiting: 3, messagesWaiting: 2 } });
  assert.equal(next.step, 'answer 2 new application questions, first: "Why do you want to work here?"');
  assert.equal(next.also, 'approve 3 jobs and 2 messages in 2 waiting batches');
  const lines = guidedFooter(next);
  assert.deepEqual(lines.slice(0, 4).map((l) => l.split(':')[0]), ['Next', 'Type', 'Why', 'Also']);
  assert.equal(lines[1], 'Type: show my unanswered questions');
});

test('S-5 every step is worded as an offer, "I\'ll ..., approve?"', () => {
  const states = [
    { setup: {} },
    { setup: { ...DONE, schedule: false, signins: {} } },
    { setup: DONE, pipeline: { unknownQuestions: 1, batchesWaiting: 1, finishYourself: 2, repliesToAnswer: 3 } },
  ];
  const steps = states.flatMap((s) => pendingSteps(s));
  assert.ok(steps.length >= 10, `${steps.length} steps`);
  for (const s of [...steps, nextStep({ setup: DONE })]) assert.match(s.why, /I'll [^?]*, approve\?/, `${s.step}: ${s.why}`);
});

test('S-5 one waiting item reads in the singular, and the digest footer counts jobs and messages', () => {
  assert.equal(nextStep({ setup: DONE, pipeline: { batchesWaiting: 1, jobsWaiting: 1 } }).step, 'approve 1 job in the waiting batch');
  const counts = waitingCounts([
    { kind: 'apply', approved: null, items: [{}, {}, {}] },
    { kind: 'outreach', approved: null, items: [{}, {}] },
    { kind: 'apply', approved: { items: [1] }, items: [{}] },
  ]);
  assert.deepEqual(counts, { batchesWaiting: 2, jobsWaiting: 3, messagesWaiting: 2 });
  const footer = footerLines({ ...counts, replies: 1 });
  assert.equal(footer[0], 'Next: approve 3 jobs and 2 messages in 2 waiting batches');
  assert.ok(footer.includes('Also: answer 1 outreach reply'), footer.join('\n'));
});
