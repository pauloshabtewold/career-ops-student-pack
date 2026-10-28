// Assumed: plugin default export { ingest(ctx) } with ctx = { dataRoot, fetch, sleep, today, dryRun, preset }
// where preset carries { early_career, title_rules }. Sources file is { sources: [{ name, repo, path, format,
// kind, status, field_map? }] }. Sidecar is <dataRoot>/student-rows.tsv, stats is <dataRoot>/student-github-stats.tsv.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import plugin from '../../plugins/github-lists/index.mjs';
import { readTsv } from '../../lib/tsv.mjs';
import * as H from '../helpers/feed-harness.mjs';

const RAW = 'https://raw.githubusercontent.com/example-org/';
const src = (o) => ({ name: 'list-a', repo: 'example-org/list-a', path: 'listings.json', format: 'simplify-json', kind: 'internship', status: 'active', ...o });
const rawHandler = (repo, body, status = 200) => [(u) => u.startsWith(`${RAW}${repo}/`), () => H.text(body, status)];

async function setup(sources, handlers, extra = {}) {
  const s = H.scratch();
  H.writeJson(join(s.data, 'student-github-sources.json'), { sources });
  H.writeJson(join(s.data, 'student-cycle.json'), H.CYCLE);
  const stub = H.stubFetch(handlers);
  const sl = H.sleeper();
  const ctx = { dataRoot: s.data, fetch: stub.fetch, sleep: sl.sleep, today: H.TODAY, dryRun: false, preset: H.PRESET, ...extra };
  return { s, stub, sl, ctx };
}
const sidecar = async (s) => (await readTsv(join(s.data, 'student-rows.tsv'))).rows;
const stats = async (s) => (await readTsv(join(s.data, 'student-github-stats.tsv')))

test('M-003-S7 manifest declares the ingest hook, no env and no LinkedIn host', () => {
  const m = JSON.parse(readFileSync(new URL('../../plugins/github-lists/manifest.json', import.meta.url), 'utf8'));
  assert.equal(m.id, 'github-lists');
  // Any edit to the plugin bumps its version (check-plugin-versions), so only the shape is pinned here.
  assert.match(m.version, /^[1-9]\d*\.\d+\.\d+$/);
  assert.equal(m.apiVersion, 1);
  assert.deepEqual(m.hooks, ['ingest']);
  assert.equal(m.jobPostings, true);
  assert.equal(m.humanInTheLoop, true);
  assert.deepEqual(m.requiredEnv, []);
  for (const h of ['raw.githubusercontent.com', 'api.github.com', 'boards-api.greenhouse.io', 'api.lever.co', 'api.ashbyhq.com', 'jobs.ashbyhq.com', 'boards.greenhouse.io', 'jobs.lever.co']) assert.ok(m.allowedHosts.includes(h), h);
  assert.ok(!m.allowedHosts.some((h) => /linkedin/i.test(h)));
});

// M-003-S7
test('M-003-S7 ingest returns Job objects with only title url company and location', async () => {
  const { s, ctx } = await setup([src()], [rawHandler('list-a', H.SIMPLIFY_JSON)]);
  try {
    const jobs = await plugin.ingest(ctx);
    assert.equal(jobs.length, 2);
    for (const j of jobs) assert.deepEqual(Object.keys(j).sort(), ['company', 'location', 'title', 'url']);
    assert.deepEqual(jobs[0], { title: 'Software Engineer Intern - Summer 2027', url: 'https://boards.greenhouse.io/examplerobotics/jobs/101', company: 'Example Robotics', location: 'Austin, TX' });
  } finally {
    s.cleanup();
  }
});

test('M-003-S7 ingest upserts sidecar rows with src github:<name> and imported today', async () => {
  const { s, ctx } = await setup([src()], [rawHandler('list-a', H.SIMPLIFY_JSON)]);
  try {
    await plugin.ingest(ctx);
    const rows = await sidecar(s);
    assert.equal(rows.length, 2);
    for (const r of rows) {
      assert.equal(r.src, 'github:list-a');
      assert.equal(r.imported, H.TODAY);
    }
    assert.ok(rows.some((r) => r.url === 'https://boards.greenhouse.io/examplerobotics/jobs/101'));
  } finally {
    s.cleanup();
  }
});

test('M-003-S7 dryRun returns rows but writes no sidecar', async () => {
  const { s, ctx } = await setup([src()], [rawHandler('list-a', H.SIMPLIFY_JSON)], { dryRun: true });
  try {
    const jobs = await plugin.ingest(ctx);
    assert.equal(jobs.length, 2);
    assert.ok(!existsSync(join(s.data, 'student-rows.tsv')));
  } finally {
    s.cleanup();
  }
});

test('M-003-S7 ineligible rows are filtered before they are returned', async () => {
  const body = JSON.stringify([
    { company_name: 'Example Robotics', title: 'Software Engineer Intern - Summer 2027', locations: ['Austin, TX'], url: 'https://boards.greenhouse.io/examplerobotics/jobs/1', date_posted: 1758000000, active: true, is_visible: true },
    { company_name: 'Example Robotics', title: 'Senior Software Engineer Intern - Summer 2027', locations: ['Austin, TX'], url: 'https://boards.greenhouse.io/examplerobotics/jobs/2', date_posted: 1758000000, active: true, is_visible: true },
    { company_name: 'Example Robotics', title: 'Software Engineer Intern - Fall 2026', locations: ['Austin, TX'], url: 'https://boards.greenhouse.io/examplerobotics/jobs/3', date_posted: 1758000000, active: true, is_visible: true },
  ]);
  const { s, ctx } = await setup([src()], [rawHandler('list-a', body)]);
  try {
    const jobs = await plugin.ingest(ctx);
    assert.deepEqual(jobs.map((j) => j.url), ['https://boards.greenhouse.io/examplerobotics/jobs/1']);
    const st = (await stats(s)).rows[0];
    assert.equal(st.fetched, '3');
    assert.equal(st.eligible, '1');
  } finally {
    s.cleanup();
  }
});

test('M-003-S7 stats row has the documented columns and counts', async () => {
  const { s, ctx } = await setup([src()], [rawHandler('list-a', H.SIMPLIFY_JSON)]);
  try {
    await plugin.ingest(ctx);
    const st = await stats(s);
    assert.deepEqual(st.header, ['date', 'name', 'fetched', 'eligible', 'unique_new', 'parse_errors', 'failed']);
    assert.equal(st.rows.length, 1);
    assert.equal(st.rows[0].date, H.TODAY);
    assert.equal(st.rows[0].name, 'list-a');
    assert.equal(st.rows[0].unique_new, '2');
    assert.ok(['0', '', 'false'].includes(st.rows[0].failed));
  } finally {
    s.cleanup();
  }
});

test('M-003-S7 the same url in two sources is returned once', async () => {
  const sources = [src(), src({ name: 'list-b', repo: 'example-org/list-b' })];
  const { s, ctx } = await setup(sources, [rawHandler('list-a', H.SIMPLIFY_JSON), rawHandler('list-b', H.SIMPLIFY_JSON)]);
  try {
    const jobs = await plugin.ingest(ctx);
    assert.equal(jobs.length, 2);
    const st = (await stats(s)).rows;
    assert.equal(st.find((r) => r.name === 'list-b').unique_new, '0');
  } finally {
    s.cleanup();
  }
});

test('M-003-S7 retired sources are skipped and trial sources are read', async () => {
  const sources = [src({ status: 'retired' }), src({ name: 'list-t', repo: 'example-org/list-t', status: 'trial' })];
  const { s, stub, ctx } = await setup(sources, [rawHandler('list-t', H.SIMPLIFY_JSON)]);
  try {
    await plugin.ingest(ctx);
    assert.ok(stub.urls().every((u) => !u.includes('/list-a/')));
    assert.ok(stub.urls().some((u) => u.includes('/list-t/')));
    assert.ok((await sidecar(s)).every((r) => r.src === 'github:list-t'));
  } finally {
    s.cleanup();
  }
});

test('M-003-S7 requests go through ctx.fetch to allowed hosts with 1200 ms between sources', async () => {
  const sources = [src(), src({ name: 'list-b', repo: 'example-org/list-b' })];
  const { s, stub, sl, ctx } = await setup(sources, [rawHandler('list-a', H.SIMPLIFY_JSON), rawHandler('list-b', H.SIMPLIFY_JSON)]);
  try {
    await plugin.ingest(ctx);
    assert.ok(stub.urls().every((u) => new URL(u).hostname === 'raw.githubusercontent.com'));
    assert.ok(sl.calls.includes(1200));
  } finally {
    s.cleanup();
  }
});

// M-003-S8
test('M-003-S8 a source that fails to parse gets a failed stats row and other sources still return', async () => {
  const sources = [src({ name: 'broken', repo: 'example-org/broken' }), src()];
  const { s, ctx } = await setup(sources, [rawHandler('broken', 'not json {'), rawHandler('list-a', H.SIMPLIFY_JSON)]);
  try {
    const jobs = await plugin.ingest(ctx);
    assert.equal(jobs.length, 2);
    const rows = (await stats(s)).rows;
    const bad = rows.find((r) => r.name === 'broken');
    const good = rows.find((r) => r.name === 'list-a');
    assert.ok(bad.failed && !['0', 'false'].includes(bad.failed));
    assert.ok(['0', '', 'false'].includes(good.failed));
    assert.ok((await sidecar(s)).every((r) => r.src === 'github:list-a'));
  } finally {
    s.cleanup();
  }
});

test('M-003-S8 a source that answers 404 is marked failed without aborting ingest', async () => {
  const { s, ctx } = await setup([src({ name: 'gone', repo: 'example-org/gone' }), src()], [rawHandler('list-a', H.SIMPLIFY_JSON)]);
  try {
    const jobs = await plugin.ingest(ctx);
    assert.equal(jobs.length, 2);
    assert.ok((await stats(s)).rows.find((r) => r.name === 'gone').failed);
  } finally {
    s.cleanup();
  }
});

// retry backoff
test('M-003-S7 a 429 is retried after 3000 ms times the attempt number', async () => {
  let n = 0;
  const handler = [(u) => u.startsWith(`${RAW}list-a/`), () => (++n <= 2 ? H.text('slow down', 429) : H.text(H.SIMPLIFY_JSON))];
  const { s, sl, ctx } = await setup([src()], [handler]);
  try {
    const jobs = await plugin.ingest(ctx);
    assert.equal(jobs.length, 2);
    assert.equal(n, 3);
    const waits = sl.calls.filter((ms) => ms >= 3000);
    assert.deepEqual(waits, [3000, 6000]);
  } finally {
    s.cleanup();
  }
});

test('M-003-S8 three consecutive 5xx answers exhaust the attempts and mark the source failed', async () => {
  let n = 0;
  const handler = [(u) => u.startsWith(`${RAW}list-a/`), () => (n++, H.text('boom', 503))];
  const { s, ctx } = await setup([src()], [handler]);
  try {
    const jobs = await plugin.ingest(ctx);
    assert.equal(n, 3);
    assert.equal(jobs.length, 0);
    assert.ok((await stats(s)).rows[0].failed);
  } finally {
    s.cleanup();
  }
});

// aggregator integration
test('M-003-S5 linkedin and unresolved aggregator rows are not returned and are logged', async () => {
  const body = JSON.stringify([
    { company_name: 'Example Robotics', title: 'Software Engineer Intern - Summer 2027', locations: ['Austin, TX'], url: 'https://www.linkedin.com/jobs/view/1', date_posted: 1758000000, active: true, is_visible: true },
    { company_name: 'Nowhere Inc', title: 'Software Engineer Intern - Summer 2027', locations: ['Austin, TX'], url: 'https://simplify.jobs/p/zzz', date_posted: 1758000000, active: true, is_visible: true },
    { company_name: 'Example Robotics', title: 'Data Intern - Summer 2027', locations: ['Austin, TX'], url: 'https://boards.greenhouse.io/examplerobotics/jobs/9', date_posted: 1758000000, active: true, is_visible: true },
  ]);
  const { s, stub, ctx } = await setup([src()], [rawHandler('list-a', body)]);
  try {
    const jobs = await plugin.ingest(ctx);
    assert.deepEqual(jobs.map((j) => j.url), ['https://boards.greenhouse.io/examplerobotics/jobs/9']);
    assert.ok(!stub.urls().some((u) => /linkedin/i.test(u)));
    const lines = H.tsvLines(join(s.data, 'student-agg-unresolved.tsv'));
    assert.equal(lines.length, 3, 'header plus two rows');
  } finally {
    s.cleanup();
  }
});

test('M-003-S7 an aggregator row that resolves is returned with the employer url', async () => {
  const body = JSON.stringify([{ company_name: 'Example Robotics', title: 'Software Engineer Intern - Summer 2027', locations: ['Austin, TX'], url: 'https://simplify.jobs/p/abc', date_posted: 1758000000, active: true, is_visible: true }]);
  const gh = [(u) => u.startsWith('https://boards-api.greenhouse.io/v1/boards/examplerobotics'), () => H.json({ jobs: [{ id: 1, title: 'Software Engineer Intern - Summer 2027', absolute_url: 'https://boards.greenhouse.io/examplerobotics/jobs/1' }] })];
  const { s, ctx } = await setup([src()], [rawHandler('list-a', body), gh]);
  try {
    const jobs = await plugin.ingest(ctx);
    assert.deepEqual(jobs.map((j) => j.url), ['https://boards.greenhouse.io/examplerobotics/jobs/1']);
    assert.equal((await sidecar(s))[0].url, 'https://boards.greenhouse.io/examplerobotics/jobs/1');
  } finally {
    s.cleanup();
  }
});
