// scripts/fresh-scan.mjs end to end over several scan dates, M-003 third fix round: one company plus title reposted under a
// new id each month (old id closed) stays out of the queue by title dedupe, but every repost is recorded in
// data/fresh-seen.tsv and refreshes the queued row's reposts= and title_since= notes, so the ghost rule fires on that row
// once the title has more than 3 reposts over more than 60 days. No hand-built history: a fake board and the real scan.
// No network, no browser, no agent. Fake company and job ids only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePaths } from '../../lib/paths.mjs';
import { makeRoot, pipelineText, rowsOf } from '../helpers/script-harness.mjs';
import { freshScan } from '../../scripts/fresh-scan.mjs';
import { preModel, rowHistory } from '../../scripts/daily-triage.mjs';

const GH = (n) => `https://boards.greenhouse.io/examplerobotics/jobs/${n}`;
const PORTALS = 'tracked_companies:\n  - name: Example Robotics\n    careers_url: https://boards.greenhouse.io/examplerobotics\n    enabled: true\n';
const board = (jobs) => ({ jobs: jobs.map(([id, title, day]) => ({ id, title, absolute_url: GH(id), location: { name: 'Remote' }, updated_at: `${day}T09:00:00Z` })) });
const fakeFetch = (body) => async (input) => {
  const url = String(input?.url ?? input);
  if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
  if (url.startsWith('https://boards-api.greenhouse.io/')) return new Response(JSON.stringify(body), { status: 200 });
  throw new Error(`unexpected fetch ${url}`);
};
const allowAll = { check: async () => ({ allowed: true, reason: '', crawlDelay: null }) };
const DAYS = ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01'];

test('a title reposted monthly is recorded each scan and the queued row fails the ghost rule after more than 3 reposts over 60 days', async () => {
  const r = makeRoot();
  r.write('portals.yml', PORTALS);
  r.write('data/pipeline.md', pipelineText());
  try {
    const paths = resolvePaths({ root: r.root, dataDir: r.data });
    const history = [];
    for (const [i, day] of DAYS.entries()) {
      const jobs = [[100 + i, 'Data Intern', day], [200, 'Lab Intern', '2026-06-01']];
      await freshScan({ paths, today: day, deps: { fetchFn: fakeFetch(board(jobs)), robots: allowAll, sleep: async () => {}, runner: () => '' } });
      const pending = rowsOf(r.read('data/pipeline.md'), 'Pending');
      assert.equal(pending.filter((x) => x.title === 'Data Intern').length, 1, `${day}: reposts stay out of the queue`);
      history.push(rowHistory(pending.find((x) => x.url === GH(100)), day));
    }
    assert.equal(r.read('data/fresh-seen.tsv').trim().split('\n').length - 1, 7, 'six Data Intern ids and one Lab Intern id');
    assert.deepEqual(history.map((h) => h.repostCount), [0, 1, 2, 3, 4, 5]);
    assert.deepEqual(history.at(-1), { repostCount: 5, ageDays: 153 });

    const rows = rowsOf(r.read('data/pipeline.md'), 'Pending');
    const ghostRow = rows.find((x) => x.url === GH(100));
    const steady = rows.find((x) => x.url === GH(200));
    assert.equal(steady.notes.get('reposts'), undefined, 'a title never reposted gets no repost note');
    const text = 'Data Intern at Example Robotics. Build dashboards in Python.';
    const pre = preModel([{ row: ghostRow, text }, { row: steady, text }], { student: {}, cache: new Map(), t1On: false, t16On: true, today: DAYS.at(-1) });
    assert.equal(pre.decided.length, 1);
    assert.match(pre.decided[0], /ghost-stale-repost/);
    assert.match(pre.decided[0], /jobs\/100 /);
  } finally {
    r.cleanup();
  }
});
