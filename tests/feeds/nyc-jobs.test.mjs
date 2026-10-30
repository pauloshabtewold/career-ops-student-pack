// W-021: the nyc-jobs plugin reads one Socrata query and maps rows to feed jobs. All fetches are injected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import plugin, { cutoffDate, queryUrl } from '../../plugins/nyc-jobs/index.mjs';
import { ingestSteps, ingestStepNames, presetFeedPlugins } from '../../lib/ingest.mjs';
import { loadPreset, mergePresets, validatePreset } from '../../lib/presets.mjs';
import * as H from '../helpers/feed-harness.mjs';

const FIXTURE = readFileSync(new URL('../fixtures/nyc-jobs/postings.json', import.meta.url), 'utf8');
const ENDPOINT = 'https://data.cityofnewyork.us/resource/kpav-sd4t.json';
const ctxWith = (handlers, extra = {}) => {
  const stub = H.stubFetch(handlers);
  const logs = [];
  return { stub, logs, ctx: { fetch: stub.fetch, today: '2026-10-30', log: (m) => logs.push(m), ...extra } };
};
const ok = [(u) => u.startsWith(ENDPOINT), () => H.text(FIXTURE)];

test('W-021-S1 manifest declares the ingest hook, no env and only the Open Data host', () => {
  const m = JSON.parse(readFileSync(new URL('../../plugins/nyc-jobs/manifest.json', import.meta.url), 'utf8'));
  assert.equal(m.id, 'nyc-jobs');
  assert.match(m.version, /^[1-9]\d*\.\d+\.\d+$/);
  assert.deepEqual(m.hooks, ['ingest']);
  assert.equal(m.jobPostings, true);
  assert.deepEqual(m.requiredEnv, []);
  assert.deepEqual(m.allowedHosts, ['data.cityofnewyork.us']);
});

test('W-021-S2 one request filters to external student and entry-level postings of the last 14 days', async () => {
  const { stub, ctx } = ctxWith([ok]);
  await plugin.ingest(ctx);
  assert.equal(stub.calls.length, 1);
  const url = new URL(stub.calls[0].url);
  assert.equal(url.origin + url.pathname, ENDPOINT);
  const where = url.searchParams.get('$where');
  assert.match(where, /posting_type='External'/);
  assert.match(where, /career_level in\('Student','Entry-Level'\)/);
  assert.match(where, /posting_date >= '2026-10-16T00:00:00'/);
  assert.match(stub.calls[0].init.headers['User-Agent'], /career-ops-student-pack/);
  assert.ok(![...url.searchParams.keys()].some((k) => /token/i.test(k)));
  assert.ok(!Object.keys(stub.calls[0].init.headers).some((k) => /token/i.test(k)));
});

test('W-021-S3 rows map to title, url, company and location; duplicates and bad rows are dropped', async () => {
  const { ctx } = ctxWith([ok]);
  const jobs = await plugin.ingest(ctx);
  assert.deepEqual(jobs, [
    { title: 'College Aide', url: 'https://cityjobs.nyc.gov/job/900001', company: 'DEPT OF EXAMPLE SERVICES', location: '100 Example Plaza, New York, NY' },
    { title: 'Policy Analyst Trainee', url: 'https://cityjobs.nyc.gov/job/900002', company: 'EXAMPLE OFFICE OF DATA', location: 'New York, NY' },
  ]);
});

test('W-021-S4 HTTP errors, bad JSON, a wrong shape and a thrown fetch each log and return no rows', async () => {
  const cases = [
    [[[(u) => u.startsWith(ENDPOINT), () => H.text('boom', 503)]], /HTTP 503/],
    [[[(u) => u.startsWith(ENDPOINT), () => H.text('<html>')]], /nyc-jobs:/],
    [[[(u) => u.startsWith(ENDPOINT), () => H.text('{"error":true}')]], /unexpected response shape/],
    [[[(u) => u.startsWith(ENDPOINT), () => { throw new Error('socket hang up'); }]], /socket hang up/],
  ];
  for (const [handlers, pattern] of cases) {
    const { stub, ctx, logs } = ctxWith(handlers);
    assert.deepEqual(await plugin.ingest(ctx), []);
    assert.equal(stub.calls.length, 1, 'no retry loop');
    assert.match(logs.join('\n'), pattern);
  }
});

test('W-021-S5 the request carries an abort signal bound to the host time budget', async () => {
  const { stub, ctx } = ctxWith([ok], { budgetMs: 50 });
  await plugin.ingest(ctx);
  assert.ok(stub.calls[0].init.signal instanceof AbortSignal);
});

test('W-021-S6 the plugin writes nothing under dataRoot', async () => {
  const s = H.scratch();
  try {
    const { ctx } = ctxWith([ok], { dataRoot: s.data });
    await plugin.ingest(ctx);
    assert.deepEqual(H.listDir(s.data), []);
  } finally {
    s.cleanup();
  }
});

test('W-021-S7 the cutoff date rolls across a month boundary', () => {
  assert.equal(cutoffDate('2026-11-05'), '2026-10-22');
  assert.match(queryUrl('2026-03-03'), /2026-02-17T00%3A00%3A00/);
});

test('W-021-S8 policy-government enables the source; the schema accepts only a boolean; merging keeps it', () => {
  const p = loadPreset('policy-government');
  assert.equal(p.sources.nyc_jobs, true);
  assert.throws(() => validatePreset({ ...p, sources: { ...p.sources, nyc_jobs: 'yes' } }), /sources\.nyc_jobs/);
  const other = loadPreset('software-cs');
  assert.equal(other.sources.nyc_jobs, undefined);
  assert.equal(mergePresets(other, [p]).sources.nyc_jobs, true);
  assert.equal(mergePresets(other).sources.nyc_jobs, false);
});

test('W-021-S9 the feed joins the ingest steps only for a preset that asks for it and a student who enabled it', () => {
  const s = H.scratch();
  try {
    mkdirSync(join(s.dir, 'config'), { recursive: true });
    assert.deepEqual(presetFeedPlugins({ root: s.dir, presets: ['policy-government'] }), [], 'no plugins.yml');
    writeFileSync(join(s.dir, 'config', 'plugins.yml'), 'plugins:\n  github-lists:\n    enabled: true\n');
    assert.deepEqual(presetFeedPlugins({ root: s.dir, presets: ['policy-government'] }), []);
    writeFileSync(join(s.dir, 'config', 'plugins.yml'), 'plugins:\n  nyc-jobs:\n    enabled: true\n');
    assert.deepEqual(presetFeedPlugins({ root: s.dir, presets: ['policy-government'] }), ['nyc-jobs']);
    assert.deepEqual(presetFeedPlugins({ root: s.dir, presets: ['software-cs'] }), []);
    assert.deepEqual(presetFeedPlugins({ root: s.dir, presets: [] }), []);
  } finally {
    s.cleanup();
  }
});

test('W-021-S10 ingestSteps runs the feed plugin right after github-lists and before the scan', () => {
  const calls = [];
  const runner = (_c, args) => { calls.push(args.slice(0, 2).map((a) => a.split('/').pop()).join(':')); return ''; };
  ingestSteps({ root: '/r', dataDir: '/r/data', packRoot: '/p', today: '2026-10-30', runner, step: (_n, fn) => fn(), feeds: ['nyc-jobs'] });
  assert.deepEqual(calls.slice(0, 3), ['plugins.mjs:run', 'plugins.mjs:run', 'scan.mjs']);
  assert.deepEqual(ingestStepNames({ feeds: ['nyc-jobs'] }).slice(0, 3), ['github-lists', 'nyc-jobs', 'scan']);
  assert.deepEqual(ingestStepNames().slice(0, 2), ['github-lists', 'scan']);
});
