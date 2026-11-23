// SYNTHETIC FIXTURE: placeholder people, companies and threads only.
// Weekly outreach lessons (decisions 34(b)): the weekly trigger, plain-code rates with no model, one call over only new
// or changed threads (at most 12), no call when nothing is new, the 'outreach-lessons' ledger row, the off switch, and
// lessons read into the drafting prefix only, never into the verifier's prompt or its known-true block. Every model call
// goes through a fake runner; no real agent is reached.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runHeadless } from '../../lib/headless.mjs';
import { LESSONS_FILE, MAX_THREADS, lessonsDue, outreachStats, readLessons, statsLines, weeklyLessons } from '../../lib/outreach-lessons.mjs';
import { archiveMessage } from '../../lib/thread-archive.mjs';
import { read as readLedger } from '../../lib/usage-ledger.mjs';
import { makeRoot } from '../helpers/script-harness.mjs';
import { blockIn, knownIn, roundFor, ALICE, APP } from '../helpers/outreach-verify-harness.mjs';

const SUNDAY = '2026-11-22';
const ts = (date, hh = '15') => `${date}T${hh}:00:00.000Z`;
const act = (action, target, company, date, detail = '') => ({ ts: ts(date), date, session: 's1', action, target, company, approval: '', detail });

// A fake claude runner behind the real runHeadless, so the ledger row is the one runHeadless writes.
function fakeHeadless(reply = '- Short openers with one question got more replies.\n- Follow up once after five days.') {
  const calls = [];
  const headless = (opts) => runHeadless({ ...opts, agentPath: '/fake/claude', platform: 'linux', runner: (cmd, args, o) => {
    calls.push({ prompt: String(o.input ?? ''), step: opts.step });
    return JSON.stringify({ result: reply, usage: { input_tokens: 900, output_tokens: 40 }, modelUsage: { 'claude-sonnet': {} } });
  } });
  return { headless, calls };
}

function threads(r, n, { from = 1 } = {}) {
  for (let i = from; i < from + n; i++) {
    archiveMessage(r.data, { name: `Contact ${i}`, company: `Company ${i} Example`, direction: 'sent', channel: 'linkedin', text: `Hello ${i}, short opener with one question?`, ts: ts('2026-11-10') });
    if (i % 2) archiveMessage(r.data, { name: `Contact ${i}`, company: `Company ${i} Example`, direction: 'received', channel: 'linkedin', text: 'Thanks, happy to chat.', ts: ts('2026-11-11') });
  }
}

const run = (r, opts) => weeklyLessons({ dataDir: r.data, root: r.root, today: SUNDAY, agent: 'claude', ...opts });

test('the lessons run on a Sunday, or on the first run after a missed Sunday, and once only', () => {
  assert.equal(lessonsDue(SUNDAY, null), true, 'a first run is due');
  assert.equal(lessonsDue(SUNDAY, '2026-11-15'), true, 'the Sunday run is due');
  assert.equal(lessonsDue(SUNDAY, SUNDAY), false, 'not twice on one Sunday');
  assert.equal(lessonsDue('2026-11-24', SUNDAY), false, 'not on the Tuesday after a Sunday run');
  assert.equal(lessonsDue('2026-11-24', '2026-11-20'), true, 'the Tuesday after a missed Sunday is due');
  assert.equal(lessonsDue('2026-11-20', '2026-11-15'), false, 'a weekday with no missed Sunday is not due');
});

test('reply and referral rates per opener and follow-up kind come from plain code with no model call', () => {
  const rows = [
    act('linkedin.connect', 'Ann A', 'Acme Example', '2026-11-01', 'note=120'),
    act('linkedin.reply', 'Ann A', 'Acme Example', '2026-11-03'),
    act('linkedin.connect', 'Ben B', 'Globex Example', '2026-11-01'),
    act('linkedin.message', 'Cat C', 'Initech Example', '2026-11-01'),
    act('linkedin.nudge', 'Cat C', 'Initech Example', '2026-11-07'),
    act('linkedin.reply', 'Cat C', 'Initech Example', '2026-11-08'),
    act('gmail.send', 'Hiring team', 'Umbrella Example', '2026-11-02', 'followup=1'),
  ];
  const stats = outreachStats({ actionRows: rows, contactRows: [{ name: 'Ann A', company: 'Acme Example', stage: 'referred' }] });
  assert.deepEqual(stats.openers['connect with note'], { sent: 1, replied: 1, referred: 1 });
  assert.deepEqual(stats.openers['connect without note'], { sent: 1, replied: 0, referred: 0 });
  assert.deepEqual(stats.openers['linkedin message'], { sent: 1, replied: 1, referred: 0 });
  assert.deepEqual(stats.followups['linkedin follow-up'], { sent: 1, replied: 1 });
  assert.equal(stats.openers.email, undefined, 'an application follow-up is apply-side and not counted');
  assert.match(statsLines(stats).join('\n'), /connect with note: 1 sent, 1 replied \(100%\), 1 referral\(s\) \(100%\)/);
});

test('one call reads only the new threads, at most 12, and writes the lessons file and an outreach-lessons ledger row', async () => {
  const r = makeRoot();
  try {
    threads(r, 15);
    const { headless, calls } = fakeHeadless();
    const res = await run(r, { headless });
    assert.equal(calls.length, 1, 'one model call');
    assert.equal(res.threads, MAX_THREADS);
    assert.equal((calls[0].prompt.match(/<<<THREAD-[0-9a-f]+>>>/g) ?? []).length, MAX_THREADS, 'at most 12 threads in the call');
    assert.ok(!calls[0].prompt.includes('# Thread:'), 'threads are trimmed to the messages');
    const ledger = await readLedger(r.data);
    assert.deepEqual(ledger.filter((row) => row.step === 'outreach-lessons').map((row) => [row.feature, row.input, row.output]), [['G4', '900', '40']]);
    assert.match(readFileSync(join(r.data, LESSONS_FILE), 'utf8'), /## Rates[\s\S]*## Lessons\n- Short openers/);
    assert.match(readLessons(r.data), /^- Short openers with one question got more replies\.\n- Follow up once/);

    // The next week reads only the 3 threads left over plus one already read that changed.
    const read = Number(/Hello (\d+),/.exec(calls[0].prompt)[1]);
    archiveMessage(r.data, { name: `Contact ${read}`, company: `Company ${read} Example`, direction: 'received', channel: 'linkedin', text: 'Can you send your resume?', ts: ts('2026-11-25') });
    const next = fakeHeadless();
    await weeklyLessons({ dataDir: r.data, root: r.root, today: '2026-11-29', headless: next.headless });
    assert.equal(next.calls.length, 1);
    assert.equal((next.calls[0].prompt.match(/<<<THREAD-[0-9a-f]+>>>/g) ?? []).length, 4, 'only the new and changed threads');
  } finally {
    r.cleanup();
  }
});

test('with no new or changed thread there is no call; the rates are still updated', async () => {
  const r = makeRoot();
  try {
    threads(r, 2);
    const first = fakeHeadless();
    await run(r, { headless: first.headless });
    assert.equal(first.calls.length, 1);
    const again = fakeHeadless();
    const res = await weeklyLessons({ dataDir: r.data, root: r.root, today: '2026-11-29', headless: again.headless });
    assert.equal(again.calls.length, 0, 'nothing new: no model call');
    assert.equal(res.called, false);
    assert.match(res.line, /no model call/);
    assert.match(readLessons(r.data), /Short openers/, 'the earlier lessons stay');
    const empty = makeRoot();
    try {
      const none = fakeHeadless();
      await run(empty, { headless: none.headless });
      assert.equal(none.calls.length, 0, 'no threads at all: no call');
    } finally {
      empty.cleanup();
    }
  } finally {
    r.cleanup();
  }
});

test('outreach_lessons: off in config/levers.yml makes no call and writes no lessons', async () => {
  const r = makeRoot();
  try {
    threads(r, 3);
    r.write('config/levers.yml', 'outreach_lessons: off\n');
    const { headless, calls } = fakeHeadless();
    const res = await run(r, { headless });
    assert.equal(calls.length, 0);
    assert.equal(res.ran, false);
    assert.equal(existsSync(join(r.data, LESSONS_FILE)), false);
  } finally {
    r.cleanup();
  }
});

test('the lessons reach the drafting prompt prefix only, never the verifier prompt or its known-true block', async () => {
  const lessons = '## Lessons\n- Keep openers under three sentences and ask one question.\n';
  for (const job of [ALICE, APP]) {
    const out = await roundFor(job, { drafts: ['I would like to hear how your team works.'], extraFiles: { [`data/${LESSONS_FILE}`]: `# Outreach lessons\n\n${lessons}` } });
    assert.ok(out.drafting.length >= 1 && out.verifies.length >= 1, `${job.action}: drafted and verified`);
    for (const d of out.drafting) {
      const block = blockIn(d.prompt, 'LESSONS');
      assert.match(block ?? '', /Keep openers under three sentences/, `${job.action}: the drafting prompt holds the lessons`);
      assert.ok(d.prompt.indexOf('<<<LESSONS-') < d.prompt.indexOf('RESUME (cv.md'), 'the lessons sit in the fixed prefix, before the resume');
    }
    for (const v of out.verifies) {
      assert.ok(!/Keep openers under three sentences|STYLE LESSONS/.test(v.prompt), `${job.action}: the verifier never sees the lessons`);
      assert.ok(!/Keep openers/.test(knownIn(v.prompt) ?? ''), 'the known-true block never holds a lesson');
    }
  }
});
