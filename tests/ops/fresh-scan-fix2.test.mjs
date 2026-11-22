// scripts/fresh-scan.mjs, second fix round: same-title openings seen in one scan are not reposts (one scan date counts
// once), a new posting keeps its own board date, the hourly jitter stays inside the run's clock hour and the window is
// asked again after it, and the result names prefilter failures and board failures apart. No network, no browser, no
// agent: fake seen rows, a fake runner and a fake clock. Fake companies only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basename } from 'node:path';
import { resolvePaths } from '../../lib/paths.mjs';
import { makeRoot, pipelineText } from '../helpers/script-harness.mjs';
import { jitterRoom, rowLine, withHistory } from '../../scripts/fresh-scan.mjs';
import { rowHistory } from '../../scripts/daily-triage.mjs';
import { parseRow } from '../../lib/pipeline-md.mjs';
import { riskRules } from '../../lib/posting-risk.mjs';

const TK = 'example bigco|software engineer, new grad';
const seenRow = (n, day) => ({ url_key: `boards.greenhouse.io/examplebigco/jobs/${n}`, first_seen: day, title_key: TK, board: 'greenhouse:examplebigco' });
const job = { company: 'Example BigCo', title: 'Software Engineer, New Grad', url: 'https://boards.greenhouse.io/examplebigco/jobs/2001', location: 'Austin, TX', posted: '2026-11-20', src: 'fresh-scan' };
const historyOf = (seen, today) => {
  const [h] = withHistory([job], seen, today);
  return { h, hist: rowHistory(parseRow(rowLine(h, today)), today) };
};

test('five same-title reqs seeded in one scan are one scan date, and the new req keeps its own board date', () => {
  const { h, hist } = historyOf([1, 2, 3, 4, 5].map((n) => seenRow(1000 + n, '2026-09-01')), '2026-11-21');
  assert.equal(h.reposts, 1);
  assert.equal(h.posted, '2026-11-20', 'never backdated past its own board date');
  assert.equal(h.titleSince, '2026-09-01');
  assert.deepEqual(hist, { repostCount: 1, ageDays: 81 });
  assert.deepEqual(riskRules({ text: 'A normal new grad posting.', company: 'Example BigCo', ...hist }), []);
});

test('same-title rows first seen today are concurrent, not reposts; a posting with no board date gets today', () => {
  const { h } = historyOf([seenRow(1001, '2026-11-21'), seenRow(1002, '2026-11-21')], '2026-11-21');
  assert.equal(h.reposts, 0);
  const [bare] = withHistory([{ ...job, posted: '' }], [], '2026-11-21');
  assert.equal(bare.posted, '2026-11-21');
});

test('a title reposted on more than three later scan dates over two months still reaches the ghost rule', () => {
  const seen = ['2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01'].map((d, i) => seenRow(1100 + i, d));
  const { hist } = historyOf(seen, '2026-11-21');
  assert.deepEqual(hist, { repostCount: 4, ageDays: 143 });
  assert.ok(riskRules({ text: 'Intern.', company: 'Example BigCo', ...hist }).includes('ghost-stale-repost'));
});

test('the jitter never crosses into the next local clock hour', () => {
  const cfg = { timezone: 'UTC' };
  assert.equal(jitterRoom(cfg, new Date('2026-11-21T14:00:00Z')), 10 * 60000);
  assert.equal(jitterRoom(cfg, new Date('2026-11-21T14:55:00Z')), 4 * 60000);
  assert.equal(jitterRoom(cfg, new Date('2026-11-21T14:59:30Z')), 0);
});

test('a run whose jitter ends at 22:00 asks no budget and writes no refusal', () => {
  const r = makeRoot({ config: 'chrome_in_schedule: yes\n' });
  r.write('data/pipeline.md', pipelineText());
  return (async () => {
    const { freshScan } = await import('../../scripts/fresh-scan.mjs');
    let t = Date.parse('2026-11-22T03:58:30Z'); // 21:58:30 in America/Chicago
    const calls = [];
    const runner = (cmd, args) => {
      calls.push(basename(String(args[0])));
      return 'ok';
    };
    const res = await freshScan({
      paths: resolvePaths({ root: r.root, dataDir: r.data }),
      today: '2026-11-21',
      deps: { sleep: async () => { t += 2 * 60000; }, now: () => new Date(t), runner, rng: () => 0.99, fetchFn: async () => new Response('', { status: 404 }) },
    });
    assert.deepEqual(calls, [], 'budget.mjs and chrome.mjs never ran');
    assert.equal(res.linkedinPages, 0);
    assert.equal(res.failed, 0);
    assert.equal(res.boardFailures, 0);
  })().finally(() => r.cleanup());
});
