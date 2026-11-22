// scripts/fresh-scan.mjs fix round: the first scan of a board adds only the newest fresh_first_scan postings, a repost of
// one company plus title under a new id carries reposts= and the earliest posted= date, LinkedIn cards with an unknown
// company dedupe on the job id, a LinkedIn read the budget refuses is named in the digest and the read is logged before it
// starts, and the scan writes data/digest/fresh-<today>.md. daily-triage turns the notes into the ghost rule's inputs.
// No network, no browser, no agent: a fake fetch and a fake runner. Fake companies and LinkedIn job ids only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basename } from 'node:path';
import { resolvePaths } from '../../lib/paths.mjs';
import { parseRow } from '../../lib/pipeline-md.mjs';
import { makeRoot, pipelineText, rowsOf } from '../helpers/script-harness.mjs';
import { linkedinJobs, newRows } from '../../scripts/fresh-scan.mjs';
import { rowHistory, preModel } from '../../scripts/daily-triage.mjs';

const TODAY = '2026-11-04';
const PORTALS = 'tracked_companies:\n  - name: Example Robotics\n    careers_url: https://boards.greenhouse.io/examplerobotics\n    enabled: true\n';
const GH = (n) => `https://boards.greenhouse.io/examplerobotics/jobs/${n}`;
const board = (jobs) => ({ jobs: jobs.map(([id, title, day]) => ({ id, title, absolute_url: GH(id), location: { name: 'Remote' }, updated_at: `${day}T09:00:00Z` })) });
const fakeFetch = (body) => async (input) => {
  const url = String(input?.url ?? input);
  if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
  if (url.startsWith('https://boards-api.greenhouse.io/')) return new Response(JSON.stringify(body), { status: 200 });
  throw new Error(`unexpected fetch ${url}`);
};
const allowAll = { check: async () => ({ allowed: true, reason: '', crawlDelay: null }) };

async function scanWith(r, { body = { jobs: [] }, runner = () => '', linkedinOnly = false, today = TODAY } = {}) {
  const { freshScan } = await import('../../scripts/fresh-scan.mjs');
  const paths = resolvePaths({ root: r.root, dataDir: r.data });
  return freshScan({ paths, today, linkedinOnly, deps: { fetchFn: fakeFetch(body), robots: allowAll, sleep: async () => {}, runner } });
}

function withRoot(config, fn) {
  const r = makeRoot({ config });
  r.write('portals.yml', PORTALS);
  r.write('data/pipeline.md', pipelineText());
  return Promise.resolve(fn(r)).finally(() => r.cleanup());
}

test('the first scan of a board adds only the newest fresh_first_scan postings and marks the rest seen', () =>
  withRoot('fresh_first_scan: 2\n', async (r) => {
    const jobs = [[1, 'Intern A', '2026-10-01'], [2, 'Intern B', '2026-11-03'], [3, 'Intern C', '2026-11-02'], [4, 'Intern D', '2026-09-01']];
    await scanWith(r, { body: board(jobs) });
    assert.deepEqual(rowsOf(r.read('data/pipeline.md'), 'Pending').map((x) => x.url).sort(), [GH(2), GH(3)].sort());
    assert.equal(r.read('data/fresh-seen.tsv').trim().split('\n').length, 5, 'header plus all four postings');
    await scanWith(r, { body: board([...jobs, [5, 'Intern E', '2026-11-04']]) });
    assert.deepEqual(rowsOf(r.read('data/pipeline.md'), 'Pending').map((x) => x.url).sort(), [GH(2), GH(3), GH(5)].sort());
    assert.match(r.read(`data/digest/fresh-${TODAY}.md`), /fresh scan: 1 board\(s\)/);
  }));

test('a repost of one company plus title under a new id carries reposts=, its own posted= date and the title_since= date', () =>
  withRoot('', async (r) => {
    await scanWith(r, { body: board([[10, 'Data Intern', '2026-08-01']]), today: '2026-08-01' });
    r.write('data/pipeline.md', pipelineText());
    await scanWith(r, { body: board([[11, 'Data Intern', '2026-11-03']]) });
    const row = rowsOf(r.read('data/pipeline.md'), 'Pending').find((x) => x.url === GH(11));
    assert.equal(row.notes.get('reposts'), '1');
    assert.equal(row.notes.get('posted'), '2026-11-03');
    assert.equal(row.notes.get('title_since'), '2026-08-01');
    assert.deepEqual(rowHistory(row, TODAY), { repostCount: 1, ageDays: 95 });
  }));

test('daily-triage passes reposts and age to the ghost rule, and 0 when the row has no notes', () => {
  const text = 'Software Engineering Intern at Example Robotics. Build tools in Python.';
  const stale = parseRow(`- [ ] ${GH(20)} | Example Robotics | Intern | Remote | note: posted=2026-07-01; reposts=4`);
  const plain = parseRow(`- [ ] ${GH(21)} | Example Robotics | Intern | Remote`);
  assert.deepEqual(rowHistory(plain, TODAY), { repostCount: 0, ageDays: 0 });
  const opts = { student: {}, cache: new Map(), t1On: false, t16On: true, today: TODAY };
  const pre = preModel([{ row: stale, text }, { row: plain, text }], opts);
  assert.equal(pre.decided.length, 1);
  assert.match(pre.decided[0], /ghost-stale-repost/);
  assert.equal(pre.send.length, 1);
});

test('LinkedIn cards with an unknown company dedupe on the job id, not the title', () => {
  const jobs = linkedinJobs(['[1] Software Engineer Intern -> https://www.linkedin.com/jobs/view/1234567/', '[2] Software Engineer Intern -> https://www.linkedin.com/jobs/view/7654321/'].join('\n'));
  assert.equal(newRows(jobs, { seen: new Set(), pipelineRows: [] }).length, 2);
  const one = linkedinJobs('[1] Data Analyst -> https://www.linkedin.com/jobs/view/9999999/');
  assert.equal(newRows(one, { seen: new Set(), pipelineRows: [{ url: 'https://www.linkedin.com/jobs/view/1111111/', company: 'unknown', title: 'Data Analyst' }] }).length, 1);
});

test('a refused LinkedIn read is named in the digest and stdout notes; the read is logged before chrome runs', () =>
  withRoot('', async (r) => {
    const refusing = (cmd, args) => {
      const err = new Error('exit 4');
      err.status = 4;
      err.stdout = 'wait: fresh search: 1 of 1 this hour; earliest 2026-11-04T16:00:00.000Z\n';
      if (basename(String(args[0])) === 'budget.mjs') throw err;
      throw new Error('chrome must not run');
    };
    const res = await scanWith(r, { runner: refusing, linkedinOnly: true });
    assert.match(res.notes.join('\n'), /LinkedIn read not allowed \(wait: fresh search/);
    assert.match(r.read(`data/digest/fresh-${TODAY}.md`), /LinkedIn read not allowed/);

    const calls = [];
    const failingRead = (cmd, args) => {
      calls.push(args.slice(1, 3).join(' ') || basename(String(args[0])));
      if (basename(String(args[0])) === 'chrome.mjs') {
        const err = new Error('timed out');
        err.status = 1;
        err.stdout = '';
        throw err;
      }
      return 'ok';
    };
    await scanWith(r, { runner: failingRead, linkedinOnly: true });
    assert.deepEqual(calls.map((c) => c.split(' ')[0]), ['check', 'log', 'read'], 'check, then the logged claim, then the read');
  }));
