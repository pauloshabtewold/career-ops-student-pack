// W-027: closes=YYYY-MM-DD is a deadline. A row closing today through 7 days out wins ties on score, says so in why,
// and a row whose date has passed is skipped and counted as closed. Dates come from the row note or the feed sidecar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRoot, runScript, line, pipelineText, jobUrl } from '../helpers/script-harness.mjs';

const CONFIG = 'daily_target: 10\nscore_floor: 3.0\nrank:\n  weights:\n    triage: 1\n';
const row = (n, company, score, extra = '') => line(jobUrl(n), company, `Intern ${n}`, 'Remote', `triage=${score}${extra ? `; ${extra}` : ''}`);
// The harness pins today to 2026-10-27.
function run(pending, { sidecar } = {}) {
  const r = makeRoot({ config: CONFIG });
  r.write('data/pipeline.md', pipelineText({ pending }));
  if (sidecar) r.write('data/student-rows.tsv', sidecar);
  try {
    const json = runScript('rank-queue', ['--json'], r);
    assert.equal(json.code, 0, json.stderr);
    const text = runScript('rank-queue', [], r);
    return { picks: JSON.parse(json.stdout), header: text.stdout.split('\n')[0] };
  } finally {
    r.cleanup();
  }
}
const urls = (picks) => picks.map((p) => p.url);

test('W-027-C1 a row closing within 7 days wins a score tie over a row with no deadline', () => {
  const { picks } = run([row(1, 'Alpha Co', '4.0'), row(2, 'Beta Co', '4.0', 'closes=2026-10-30')]);
  assert.deepEqual(urls(picks), [jobUrl(2), jobUrl(1)]);
  assert.match(picks[0].why, /closes in 3 days/);
  assert.equal(picks[1].why, '');
});

test('W-027-C2 the window is today through today+7; day 8 and a far date do not count', () => {
  const { picks } = run([
    row(1, 'A Co', '4.0', 'closes=2026-11-03'),
    row(2, 'B Co', '4.0', 'closes=2026-11-04'),
    row(3, 'C Co', '4.0', 'closes=2026-10-27'),
    row(4, 'D Co', '4.0', 'closes=2027-03-01'),
  ]);
  const why = Object.fromEntries(picks.map((p) => [p.url, p.why]));
  assert.equal(why[jobUrl(3)], 'closes today');
  assert.equal(why[jobUrl(1)], 'closes in 7 days');
  assert.equal(why[jobUrl(2)], '');
  assert.equal(why[jobUrl(4)], '');
  assert.deepEqual(urls(picks), [jobUrl(3), jobUrl(1), jobUrl(2), jobUrl(4)]);
});

test('W-027-C3 the deadline never beats a higher score and comes before the triage tie-break', () => {
  const { picks } = run([row(1, 'A Co', '4.5'), row(2, 'B Co', '4.5', 'closes=2026-10-28')]);
  assert.deepEqual(urls(picks), [jobUrl(2), jobUrl(1)]);
  const higher = run([row(3, 'C Co', '4.6'), row(4, 'D Co', '4.5', 'closes=2026-10-28')]);
  assert.deepEqual(urls(higher.picks), [jobUrl(3), jobUrl(4)]);
});

test('W-027-C4 a passed close date is skipped and counted as closed; today is still open', () => {
  const { picks, header } = run([row(1, 'A Co', '4.0', 'closes=2026-10-26'), row(2, 'B Co', '4.0', 'closes=2026-10-27'), row(3, 'C Co', '4.0')]);
  assert.deepEqual(urls(picks), [jobUrl(2), jobUrl(3)]);
  assert.match(header, /^Top 2 of 2 eligible \(0 waiting on referral timing\), 1 closed$/);
});

test('W-027-C5 free text after the date is allowed; a value that is not a real date is ignored', () => {
  const { picks } = run([row(1, 'A Co', '4.0', 'closes=2026-10-29 (rolling)'), row(2, 'B Co', '4.0', 'closes=2026-02-30'), row(3, 'C Co', '4.0', 'closes=soon')]);
  assert.equal(picks.find((p) => p.url === jobUrl(1)).why, 'closes in 2 days');
  assert.deepEqual(urls(picks), [jobUrl(1), jobUrl(2), jobUrl(3)]);
});

test('W-027-C6 the feed sidecar supplies a date when the row has none, and the row note wins when both exist', () => {
  const sidecar = ['url_key\turl\tsrc\timported\textid\tnotes', `${jobUrl(1)}\t${jobUrl(1)}\t\t\t\tcloses=2026-10-28`, `${jobUrl(2)}\t${jobUrl(2)}\t\t\t\tsrc=x; closes=2026-10-20`, `${jobUrl(3)}\t${jobUrl(3)}\t\t\t\tcloses=2026-10-20`, ''].join('\n');
  const { picks, header } = run([row(1, 'A Co', '4.0'), row(2, 'B Co', '4.0'), row(3, 'C Co', '4.0', 'closes=2026-10-29')], { sidecar });
  assert.deepEqual(urls(picks), [jobUrl(1), jobUrl(3)]);
  assert.match(header, /, 1 closed$/);
});

test('W-027-C7 a header with no closed rows does not mention closed', () => {
  assert.doesNotMatch(run([row(1, 'A Co', '4.0')]).header, /closed/);
});
