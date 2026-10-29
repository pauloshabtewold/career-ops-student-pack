// Assumed signature: resolveAggregator(rows, { fetch, sleep, dataRoot, today }) -> Promise<row[]>
// Employer-ATS rows pass through; aggregator rows come back with url replaced by the employer posting;
// forbidden (linkedin) and unresolved rows are not returned and are appended to <dataRoot>/student-agg-unresolved.tsv.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { classifyUrl, resolveAggregator } from '../../plugins/github-lists/_resolve.mjs';
import * as H from '../helpers/feed-harness.mjs';

const AGG = 'https://simplify.jobs/p/abc-123';
const aggRow = (o = {}) => ({ company: 'Example Robotics', title: 'Software Engineer Intern', location: 'Austin, TX', date: '2026-09-15', url: AGG, kind: 'internship', ...o });

const greenhouse = [
  (u) => u.startsWith('https://boards-api.greenhouse.io/v1/boards/examplerobotics/jobs'),
  () => H.json({ jobs: [{ id: 7, title: 'Hardware Engineer Intern', absolute_url: 'https://boards.greenhouse.io/examplerobotics/jobs/7' }, { id: 8, title: 'Software Engineer Intern', absolute_url: 'https://boards.greenhouse.io/examplerobotics/jobs/8' }] }),
];
const lever = [
  (u) => u.startsWith('https://api.lever.co/v0/postings/examplerobotics'),
  () => H.json([{ id: 'x1', text: 'Software Engineer Intern', hostedUrl: 'https://jobs.lever.co/examplerobotics/x1' }]),
];
const ashby = [
  (u) => u.startsWith('https://api.ashbyhq.com/posting-api/job-board/examplerobotics'),
  () => H.json({ jobs: [{ id: 'a1', title: 'Software Engineer Intern', jobUrl: 'https://jobs.ashbyhq.com/examplerobotics/a1' }] }),
];

async function run(rows, handlers, opts = {}) {
  const s = H.scratch();
  try {
    const stub = H.stubFetch(handlers, opts);
    const sl = H.sleeper();
    const out = await resolveAggregator(rows, { fetch: stub.fetch, sleep: sl.sleep, dataRoot: s.data, today: H.TODAY });
    return { out, stub, sl, unresolved: H.tsvLines(join(s.data, 'student-agg-unresolved.tsv')) };
  } finally {
    s.cleanup();
  }
}

// M-003-S4
test('M-003-S4 aggregator row resolves to the Greenhouse posting with the matching title', async () => {
  const { out } = await run([aggRow()], [greenhouse]);
  assert.equal(out.length, 1);
  assert.equal(out[0].url, 'https://boards.greenhouse.io/examplerobotics/jobs/8');
  assert.equal(out[0].company, 'Example Robotics');
});

test('M-003-S4 aggregator row resolves to the Lever posting', async () => {
  const { out } = await run([aggRow()], [lever]);
  assert.equal(out[0].url, 'https://jobs.lever.co/examplerobotics/x1');
});

test('M-003-S4 aggregator row resolves to the Ashby posting', async () => {
  const { out } = await run([aggRow()], [ashby]);
  assert.equal(out[0].url, 'https://jobs.ashbyhq.com/examplerobotics/a1');
});

test('M-003-S4 an employer ATS row passes through without any request', async () => {
  const row = aggRow({ url: 'https://boards.greenhouse.io/examplerobotics/jobs/8' });
  const { out, stub } = await run([row], [greenhouse]);
  assert.equal(out[0].url, row.url);
  assert.equal(stub.calls.length, 0);
});

test('M-003-S4 only hosts on the plugin allow list are requested', async () => {
  const { stub } = await run([aggRow()], [greenhouse, lever, ashby]);
  const allowed = new Set(['raw.githubusercontent.com', 'api.github.com', 'boards-api.greenhouse.io', 'api.lever.co', 'api.ashbyhq.com', 'jobs.ashbyhq.com', 'boards.greenhouse.io', 'jobs.lever.co']);
  for (const u of stub.urls()) assert.ok(allowed.has(new URL(u).hostname), u);
});

test('M-003-S4 no board match leaves the row unresolved and out of the result', async () => {
  const { out, unresolved } = await run([aggRow({ title: 'Quantum Intern' })], [greenhouse, lever, ashby]);
  assert.equal(out.length, 0);
  assert.equal(unresolved.length, 2, 'header plus one row');
});

// M-003-S5
test('M-003-S5 a direct linkedin.com url is never requested and lands in the unresolved file', async () => {
  const row = aggRow({ url: 'https://www.linkedin.com/jobs/view/12345' });
  const { out, stub, unresolved } = await run([row], [greenhouse, lever, ashby]);
  assert.equal(out.length, 0);
  assert.ok(!stub.urls().some((u) => /linkedin/i.test(u)));
  assert.deepEqual(unresolved[0], ['date', 'company', 'title', 'source']);
  assert.equal(unresolved.length, 2);
  assert.equal(unresolved[1][0], H.TODAY);
  assert.equal(unresolved[1][1], 'Example Robotics');
  assert.equal(unresolved[1][2], 'Software Engineer Intern');
  assert.ok(unresolved[1][3]);
});

test('M-003-S5 every linkedin.com subdomain is forbidden', async () => {
  const rows = ['https://linkedin.com/jobs/1', 'https://uk.linkedin.com/jobs/2', 'https://jobs.linkedin.com/3'].map((url) => aggRow({ url }));
  const { out, stub, unresolved } = await run(rows, [greenhouse]);
  assert.equal(out.length, 0);
  assert.ok(!stub.urls().some((u) => /linkedin/i.test(u)));
  assert.equal(unresolved.length, 4);
});

test('M-003-S5 a lookalike host such as notlinkedin.com is not treated as linkedin', async () => {
  const { unresolved } = await run([aggRow({ url: 'https://notlinkedin.example.com/x' })], [greenhouse]);
  assert.ok(unresolved.length <= 2);
});

test('M-003-S5 unresolved rows are written with formula escaping', async () => {
  const row = aggRow({ company: '=HYPERLINK("x")', url: 'https://www.linkedin.com/jobs/view/9' });
  const { unresolved } = await run([row], []);
  assert.ok(unresolved[1][1].startsWith("'="));
});

// M-003-S6
test('M-003-S6 the resolver never has more than 4 requests in flight', async () => {
  const rows = Array.from({ length: 12 }, (_, i) => aggRow({ title: `Software Engineer Intern ${i}`, url: `https://simplify.jobs/p/job-${i}` }));
  const { stub } = await run(rows, [greenhouse, lever, ashby], { delayMs: 8 });
  assert.ok(stub.calls.length >= 12, 'requests were issued');
  assert.ok(stub.state.maxInFlight <= 4, `max in flight ${stub.state.maxInFlight}`);
  assert.ok(stub.state.maxInFlight >= 2, 'the gate allows parallelism');
});

// M-001-S4
test('M-001-S4 classifyUrl treats trylitos.com and its subdomains as aggregator', () => {
  assert.equal(classifyUrl('https://trylitos.com/jobs/abc'), 'aggregator');
  assert.equal(classifyUrl('https://www.trylitos.com/jobs/abc'), 'aggregator');
});

test('M-001-S4 a trylitos row resolves through the Greenhouse board by company slug and trylitos is never requested', async () => {
  const row = aggRow({ url: 'https://trylitos.com/jobs/abc' });
  const { out, stub, unresolved } = await run([row], [greenhouse]);
  assert.equal(out.length, 1);
  assert.equal(out[0].url, 'https://boards.greenhouse.io/examplerobotics/jobs/8');
  assert.equal(unresolved.length, 0);
  assert.ok(stub.calls.length > 0);
  assert.ok(!stub.urls().some((u) => /trylitos/i.test(u)));
});

test('M-001-S4 an unmatched trylitos row is recorded as unresolved without requesting trylitos.com', async () => {
  const row = aggRow({ title: 'Quantum Intern', url: 'https://trylitos.com/jobs/zzz' });
  const { out, stub, unresolved } = await run([row], [greenhouse, lever, ashby]);
  assert.equal(out.length, 0);
  assert.equal(unresolved.length, 2, 'header plus one row');
  assert.ok(!stub.urls().some((u) => /trylitos/i.test(u)));
});
