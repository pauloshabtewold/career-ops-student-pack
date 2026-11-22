// Application follow-ups: followupsDue() in lib/outreach-state.mjs, draftJobs() in scripts/outreach-drafts.mjs, budget
// check apply.followup (one per application, 7 to 10 days after apply.submit, only for a logged approved batch item) and
// lib/gmail-chrome.mjs sendEmail refusing to send when the budget refuses. Scratch packs with fake applications only.
// Rulings: an application is named by the --target and --company of its apply.submit row, and apply.followup is checked
// with the same two flags; the gmail-chrome email object carries batchId, item, target, company, to, subject, body and
// followup (with the application's target and company); sendEmail resolves to an exit code or an object with code.
// The sendEmail flow runs the real budget CLI on the real clock, so its pack is dated from the real local date; its
// browser is a fake that records calls and its port is never opened.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { followupsDue } from '../../lib/outreach-state.mjs';
import { draftJobs } from '../../scripts/outreach-drafts.mjs';
import { sendEmail } from '../../lib/gmail-chrome.mjs';
import { resolvePaths } from '../../lib/paths.mjs';
import { runResult } from '../../lib/run.mjs';
import { DAY, at, shiftDate, row, makePack, readLog } from '../helpers/budget-harness.mjs';
import { ACME, GLOBEX, OB, approve, followupCheck, realToday, out } from '../helpers/outreach-harness.mjs';

const ROLE = 'ex-role-1';
const NOW = at(DAY, 12).getTime();
const APPLY_BATCH = '2026-02-28-apply-1';
const SENDS = ['gmail.send', 'apply.followup', 'linkedin.message', 'linkedin.nudge'];

const submitted = (days, { today = DAY, company = ACME, target = ROLE, item = 1 } = {}) => {
  const ts = at(shiftDate(today, -days), 12, 0);
  const detail = `track=swe-intern;batch=${APPLY_BATCH};item=${item}`;
  return [
    row({ ts: new Date(ts.getTime() - 60000), action: 'apply.pending', target, company, detail }),
    row({ ts, action: 'apply.submit', target, company, approval: 'submit 1', detail }),
  ];
};
const followedUp = (days) => row({ ts: at(shiftDate(DAY, -days), 12, 0), action: 'apply.followup', target: ROLE, company: ACME, detail: 'batch=2026-03-08-outreach-1;item=1' });

async function withPack(rows, fn, { today = DAY, items = '1' } = {}) {
  const p = await makePack({ rows });
  try {
    approve(p, items, { today });
    return await fn(p);
  } finally {
    p.cleanup();
  }
}

const noSends = async (p) => assert.deepEqual((await readLog(p)).filter((r) => SENDS.includes(r.action)), [], 'no message was sent or logged');

// M-004-S2-osdr
test('M-004-S2-osdr a follow-up becomes due 8 days after a logged submit and appears once in the next outreach batch', async () => {
  const dueNow = followupsDue(submitted(8), NOW);
  assert.equal(dueNow.length, 1, 'one follow-up for the application, even with its apply.pending row');
  assert.ok(JSON.stringify(dueNow).includes(ACME), 'the follow-up names the application company');
  assert.equal(followupsDue(submitted(5), NOW).length, 0, 'day 5 is too early');
  assert.equal(followupsDue(submitted(11), NOW).length, 0, 'day 11 is past the 7 to 10 day window');
  const both = followupsDue([...submitted(8), ...submitted(9, { company: GLOBEX, target: 'ex-role-2', item: 2 })], NOW);
  assert.equal(both.length, 2, 'each due application gets its own follow-up');

  const jobs = draftJobs({ due: [], followups: dueNow, replies: [], t6On: false });
  assert.equal(jobs.length, 1, 'the next outreach batch holds the follow-up once');

  await withPack(submitted(8), async (p) => {
    const r = followupCheck(p, ROLE, ACME, 1);
    assert.equal(r.code, 0, `day 8 with an approved item passes: ${out(r)}`);
  });
  await withPack(submitted(5), async (p) => {
    const r = followupCheck(p, ROLE, ACME, 1);
    assert.equal(r.code, 3, `day 5 is outside the follow-up window: ${out(r)}`);
  });
});

// M-004-S6-osdr
test('M-004-S6-osdr a second follow-up for the same application exits 3', async () => {
  await withPack([...submitted(9), followedUp(1)], async (p) => {
    const r = followupCheck(p, ROLE, ACME, 1);
    assert.equal(r.code, 3, out(r));
  });
  await withPack([...submitted(9), ...submitted(9, { company: GLOBEX, target: 'ex-role-2', item: 2 }), followedUp(1)], async (p) => {
    const r = followupCheck(p, 'ex-role-2', GLOBEX, 1);
    assert.equal(r.code, 0, `another application with no follow-up still passes: ${out(r)}`);
  });
});

// M-004-S12-osdr
test('M-004-S12-osdr an application follow-up is drafted only as an email and budget check apply.followup outside a logged approved item exits 3 and no message is sent', async () => {
  const followups = followupsDue(submitted(8), NOW);
  const jobs = draftJobs({ due: [], followups, replies: [], t6On: false });
  assert.equal(jobs.length, 1);
  for (const job of jobs) {
    assert.match(JSON.stringify(job), /email/i, 'the follow-up is drafted as an email');
    assert.doesNotMatch(JSON.stringify(job), /linkedin/i, 'never as a LinkedIn message');
  }

  await withPack(submitted(8), async (p) => {
    const unlisted = followupCheck(p, ROLE, ACME, 2);
    assert.equal(unlisted.code, 3, `item 2 is not in the approved batch: ${out(unlisted)}`);
    const bare = followupCheck(p, ROLE, ACME, null);
    assert.equal(bare.code, 3, `no --batch-id and --item: ${out(bare)}`);
    await noSends(p);
  });
});

// M-004-S13-osdr
test('M-004-S13-osdr a due email follow-up checked as apply.followup outside a logged approved item exits 3 and gmail-chrome sends nothing', async () => {
  const today = realToday();
  await withPack(
    submitted(8, { today }),
    async (p) => {
      const r = followupCheck(p, ROLE, ACME, 2, { today });
      assert.equal(r.code, 3, `item 2 is not in the approved batch: ${out(r)}`);

      let browserCalls = 0;
      const browser = async () => {
        browserCalls += 1;
        throw new Error('the browser must not open');
      };
      const email = {
        batchId: OB,
        item: 2,
        target: 'Hiring Team',
        company: ACME,
        to: 'jobs@example.com',
        subject: 'Following up on my application',
        body: 'Thanks for considering my application.',
        followup: { target: ROLE, company: ACME },
      };
      const res = await sendEmail({ paths: resolvePaths({ root: p.root, dataDir: p.dataDir }), port: 9, email, date: today, runner: runResult, browser });
      const code = typeof res === 'number' ? res : res?.code;
      assert.equal(code, 3, `sendEmail stops on the budget refusal: ${JSON.stringify(res)}`);
      assert.equal(browserCalls, 0, 'gmail-chrome never opened the browser');
      await noSends(p);
    },
    { today },
  );
});
