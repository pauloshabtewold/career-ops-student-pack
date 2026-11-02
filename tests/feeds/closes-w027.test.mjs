// W-027: the usajobs and nyc-jobs plugins record each posting's close date as a closes=YYYY-MM-DD token in the notes
// column of student-rows.tsv, which rank-queue reads. Job rows themselves keep their four fields.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import usajobs from '../../plugins/usajobs/index.mjs';
import nyc, { closeDate } from '../../plugins/nyc-jobs/index.mjs';
import * as H from '../helpers/feed-harness.mjs';

const SIDECAR = 'student-rows.tsv';
const USA = JSON.stringify({
  SearchResult: {
    SearchResultItems: [
      { MatchedObjectId: '1', MatchedObjectDescriptor: { PositionTitle: 'Student Trainee', PositionURI: 'https://www.usajobs.gov/job/1', OrganizationName: 'Example Bureau', ApplicationCloseDate: '2026-11-20T23:59:59.9300' } },
      { MatchedObjectId: '2', MatchedObjectDescriptor: { PositionTitle: 'No Date', PositionURI: 'https://www.usajobs.gov/job/2', OrganizationName: 'Example Bureau' } },
      { MatchedObjectId: '3', MatchedObjectDescriptor: { PositionTitle: 'Bad Date', PositionURI: 'https://www.usajobs.gov/job/3', OrganizationName: 'Example Bureau', ApplicationCloseDate: '2026-02-30T00:00:00' } },
    ],
  },
});
const NYC = JSON.stringify([
  { job_id: '11', agency: 'EXAMPLE', business_title: 'Aide', work_location: '1 Example St', posting_date: '2026-10-28T00:00:00.000', post_until: '2026-11-25T00:00:00.000' },
  { job_id: '12', agency: 'EXAMPLE', business_title: 'Clerk', work_location: '', posting_date: '2026-10-28T00:00:00.000', post_until: '30-Nov-2026' },
  { job_id: '13', agency: 'EXAMPLE', business_title: 'Open', work_location: '', posting_date: '2026-10-28T00:00:00.000' },
]);
const ctx = (body, startsWith, extra) => {
  const stub = H.stubFetch([[(u) => u.startsWith(startsWith), () => H.text(body)]]);
  return { fetch: stub.fetch, today: '2026-10-30', log: () => {}, env: { USAJOBS_API_KEY: 'k', USAJOBS_EMAIL: 'student@example.edu' }, ...extra };
};
const rows = (file) => readFileSync(file, 'utf8').trim().split('\n').slice(1).map((l) => l.split('\t'));

test('W-027-P1 usajobs writes closes= from ApplicationCloseDate and skips missing or impossible dates', async () => {
  const s = H.scratch();
  try {
    const jobs = await usajobs.ingest(ctx(USA, 'https://data.usajobs.gov/api/search', { dataRoot: s.data }));
    assert.deepEqual(Object.keys(jobs[0]), ['title', 'url', 'company', 'location']);
    assert.equal(jobs.length, 3);
    const out = rows(join(s.data, SIDECAR));
    assert.deepEqual(out.map((r) => [r[1], r[5]]), [['https://www.usajobs.gov/job/1', 'closes=2026-11-20']]);
  } finally {
    s.cleanup();
  }
});

test('W-027-P2 nyc-jobs writes closes= from post_until in timestamp and DD-Mon-YYYY form', async () => {
  const s = H.scratch();
  try {
    const jobs = await nyc.ingest(ctx(NYC, 'https://data.cityofnewyork.us/resource/kpav-sd4t.json', { dataRoot: s.data }));
    assert.equal(jobs.length, 3);
    assert.deepEqual(rows(join(s.data, SIDECAR)).map((r) => [r[1], r[5]]), [
      ['https://cityjobs.nyc.gov/job/11', 'closes=2026-11-25'],
      ['https://cityjobs.nyc.gov/job/12', 'closes=2026-11-30'],
    ]);
  } finally {
    s.cleanup();
  }
});

test('W-027-P3 the query asks for post_until', async () => {
  const stub = H.stubFetch([[(u) => u.startsWith('https://data.cityofnewyork.us/'), () => H.text('[]')]]);
  await nyc.ingest({ fetch: stub.fetch, today: '2026-10-30', log: () => {} });
  assert.match(new URL(stub.calls[0].url).searchParams.get('$select'), /post_until/);
});

test('W-027-P4 existing sidecar rows and columns survive, and a second run replaces only the closes token', async () => {
  const s = H.scratch();
  try {
    const file = join(s.data, SIDECAR);
    writeFileSync(file, ['url_key\turl\tsrc\timported\textid\tnotes', 'https://cityjobs.nyc.gov/job/11\thttps://cityjobs.nyc.gov/job/11\tnyc\t2026-10-28\tX1\tfoo=bar; closes=2026-01-01', 'https://other.example.com/a\thttps://other.example.com/a\tgithub:x\t2026-10-01\t\t', ''].join('\n'));
    await nyc.ingest(ctx(NYC, 'https://data.cityofnewyork.us/resource/kpav-sd4t.json', { dataRoot: s.data }));
    const byUrl = Object.fromEntries(rows(file).map((r) => [r[1], r]));
    assert.deepEqual(byUrl['https://cityjobs.nyc.gov/job/11'].slice(2), ['nyc', '2026-10-28', 'X1', 'foo=bar; closes=2026-11-25']);
    assert.deepEqual(byUrl['https://other.example.com/a'].slice(2), ['github:x', '2026-10-01', '', '']);
  } finally {
    s.cleanup();
  }
});

test('W-027-P5 a dry run writes nothing, and the nested data folder is used when the registry is there', async () => {
  const s = H.scratch();
  try {
    await nyc.ingest(ctx(NYC, 'https://data.cityofnewyork.us/resource/kpav-sd4t.json', { dataRoot: s.data, dryRun: true }));
    assert.deepEqual(H.listDir(s.data), []);
    writeFileSync(join(s.data, 'student-github-sources.json'), '{}');
    await nyc.ingest(ctx(NYC, 'https://data.cityofnewyork.us/resource/kpav-sd4t.json', { dataRoot: s.dir }));
    assert.ok(H.listDir(s.data).includes(SIDECAR));
  } finally {
    s.cleanup();
  }
});

test('W-027-P6 closeDate reads the two shapes and rejects the rest', () => {
  assert.deepEqual(['2026-11-25T00:00:00.000', '5-Jan-2027', '05 January 2027', '31-Feb-2026', 'soon', '', null].map(closeDate), ['2026-11-25', '2027-01-05', '2027-01-05', '', '', '', '']);
});
