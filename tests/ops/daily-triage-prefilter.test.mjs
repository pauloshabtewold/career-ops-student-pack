// M-003 pre-model rules in scripts/daily-triage.mjs: jd-rules fail a row before any model call, a row without job text
// keeps its title-only prompt line, and with T16 off a payment posting still reaches the model and its verdict becomes
// TRIAGE: FAIL naming rule scam after the call. The runner is injected (fake fetch-jd and claude); no agent starts.
// Rows carry distinct companies and titles so the company+title dedupe (T13) keeps every row. Fake companies only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { args, jobUrl, line, makeRunner, makeTriageRoot, sentUrls } from '../helpers/triage-harness.mjs';
import { rowsOf } from '../helpers/script-harness.mjs';

const withRoot = async (opts, fn) => {
  const r = makeTriageRoot(opts);
  try {
    await fn(r);
  } finally {
    r.cleanup();
  }
};
const allSent = (calls) => sentUrls(calls.claude.map((c) => c.opts.input).join('\n'));
const findRow = (text, section, url) => rowsOf(text, section).find((x) => x.url === url);

const YEARS_TEXT = 'Software Engineering Intern at Example Robotics. Requirements: 5+ years of professional software development experience. Python and C++.';
const PAYMENT_TEXT = 'Data Analyst Intern at Sample Labs. Before onboarding, every applicant must pay a $95 equipment fee by wire transfer. Remote role.';
const PLAIN_TEXT = (title) => `${title}. Work with a small team on internal tools. Open to current students. Python preferred.`;

// M-003-S1-osdr
test('M-003-S1-osdr a row whose job text requires 5 or more years gets a TRIAGE FAIL naming rule years and no model call', () =>
  withRoot(
    {
      pending: [
        line(jobUrl(1), 'Example Robotics', 'Software Engineering Intern', 'Remote', 'src=handshake'),
        line(jobUrl(2), 'Demo Works', 'Data Engineering Intern', 'Remote', 'src=handshake'),
      ],
    },
    async (r) => {
      const { runner, calls } = makeRunner(r, { fetch: (url) => (url === jobUrl(1) ? YEARS_TEXT : PLAIN_TEXT('Data Engineering Intern')) });
      await dailyTriageRun(r, runner);
      const sent = allSent(calls);
      assert.equal(sent.has(jobUrl(1)), false, 'the years row goes to no model');
      assert.equal(sent.has(jobUrl(2)), true, 'the clean row still goes to the model');
      const text = r.read('data/pipeline.md');
      const failed = findRow(text, 'Skipped', jobUrl(1));
      assert.ok(failed, `the years row is failed:\n${text}`);
      assert.match(failed.notes.get('reason') ?? '', /years/i);
    },
  ));

// M-003-S5-osdr
test('M-003-S5-osdr a row without job text keeps the title-only prompt line', () =>
  withRoot(
    {
      pending: [
        line(jobUrl(1), 'Sample Labs', 'Backend Engineering Intern', 'Remote', 'src=handshake'),
        line(jobUrl(2), 'Example Robotics', 'Software Engineering Intern', 'Remote', 'src=handshake'),
      ],
    },
    async (r) => {
      const fetch = (url) => {
        if (url === jobUrl(1)) throw new Error('fetch failed');
        return YEARS_TEXT;
      };
      const { runner, calls } = makeRunner(r, { fetch });
      await dailyTriageRun(r, runner);
      const sent = allSent(calls);
      assert.equal(sent.has(jobUrl(2)), false, 'the jd rules are active in this run: the years row is not sent');
      assert.equal(sent.has(jobUrl(1)), true, 'the row with no job text is not dropped by the rules');
      const prompt = calls.claude.map((c) => c.opts.input).join('\n');
      assert.match(prompt, /### https:\/\/example\.com\/jobs\/1\nCompany: Sample Labs\nTitle: Backend Engineering Intern\n\(posting text unavailable: judge on the title and company only\)\n/);
    },
  ));

// M-003-S10-osdr
test('M-003-S10-osdr with T16 off a posting asking for a payment still reaches the triage model and its verdict becomes a TRIAGE FAIL naming rule scam after the call', () =>
  withRoot(
    {
      pending: [
        line(jobUrl(1), 'Sample Labs', 'Data Analyst Intern', 'Remote', 'src=handshake'),
        line(jobUrl(2), 'Demo Works', 'Software Engineering Intern', 'Remote', 'src=handshake'),
      ],
    },
    async (r) => {
      const { runner, calls } = makeRunner(r, { fetch: (url) => (url === jobUrl(1) ? PAYMENT_TEXT : PLAIN_TEXT('Software Engineering Intern')) });
      await dailyTriageRun(r, runner);
      assert.equal(allSent(calls).has(jobUrl(1)), true, 'with T16 off the payment posting reaches the model');
      const text = r.read('data/pipeline.md');
      const failed = findRow(text, 'Skipped', jobUrl(1));
      assert.ok(failed, `the model PASS became a FAIL:\n${text}`);
      assert.match(failed.notes.get('reason') ?? '', /scam/i);
      assert.ok(findRow(text, 'Pending', jobUrl(2)), 'the clean row keeps its PASS in Pending');
    },
  ));

async function dailyTriageRun(r, runner) {
  const { dailyTriage } = await import('../../scripts/daily-triage.mjs');
  await dailyTriage({ ...args(r), runner });
}
