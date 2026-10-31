// W-022: the usajobs plugin reads one keyed USAJOBS search and maps results to feed jobs. All fetches are injected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import plugin, { queryUrl } from '../../plugins/usajobs/index.mjs';
import { presetFeedPlugins } from '../../lib/ingest.mjs';
import { loadPreset, mergePresets, validatePreset } from '../../lib/presets.mjs';
import * as H from '../helpers/feed-harness.mjs';

const FIXTURE = readFileSync(new URL('../fixtures/usajobs/search.json', import.meta.url), 'utf8');
const ENDPOINT = 'https://data.usajobs.gov/api/search';
const KEY = 'test-key-not-real';
const EMAIL = 'student@example.edu';
const ctxWith = (handlers, extra = {}) => {
  const stub = H.stubFetch(handlers);
  const logs = [];
  const env = { USAJOBS_API_KEY: KEY, USAJOBS_EMAIL: EMAIL };
  return { stub, logs, ctx: { fetch: stub.fetch, env, log: (m) => logs.push(m), ...extra } };
};
const ok = [(u) => u.startsWith(ENDPOINT), () => H.text(FIXTURE)];

test('W-022-U1 manifest declares the ingest hook, both env vars and only the USAJOBS host', () => {
  const m = JSON.parse(readFileSync(new URL('../../plugins/usajobs/manifest.json', import.meta.url), 'utf8'));
  assert.equal(m.id, 'usajobs');
  assert.equal(m.version, '1.0.0');
  assert.equal(m.apiVersion, 1);
  assert.deepEqual(m.hooks, ['ingest']);
  assert.equal(m.jobPostings, true);
  assert.equal(m.humanInTheLoop, true);
  assert.deepEqual(m.requiredEnv, ['USAJOBS_API_KEY', 'USAJOBS_EMAIL']);
  assert.deepEqual(m.allowedHosts, ['data.usajobs.gov']);
});

test('W-022-U2 one request asks for student and graduates paths in the last 14 days', async () => {
  const { stub, ctx } = ctxWith([ok]);
  await plugin.ingest(ctx);
  assert.equal(stub.calls.length, 1);
  const url = new URL(stub.calls[0].url);
  assert.equal(url.origin + url.pathname, ENDPOINT);
  assert.equal(url.searchParams.get('HiringPath'), 'student;graduates');
  assert.equal(url.searchParams.get('DatePosted'), '14');
  assert.equal(url.searchParams.get('ResultsPerPage'), '500');
  assert.equal(url.searchParams.get('SortField'), 'opendate');
  assert.equal(queryUrl(7).includes('DatePosted=7'), true);
});

test('W-022-U3 the request sends User-Agent and Authorization-Key from ctx.env and a bound abort signal', async () => {
  const { stub, ctx } = ctxWith([ok], { budgetMs: 50 });
  await plugin.ingest(ctx);
  const { headers, signal } = stub.calls[0].init;
  assert.equal(headers['User-Agent'], EMAIL);
  assert.equal(headers['Authorization-Key'], KEY);
  assert.ok(signal instanceof AbortSignal);
  assert.equal(stub.calls[0].init.timeoutMs, 50);
});

test('W-022-U4 results map to title, url, company and location; duplicates and bad rows are dropped', async () => {
  const { ctx } = ctxWith([ok]);
  assert.deepEqual(await plugin.ingest(ctx), [
    { title: 'Student Trainee (Policy Analyst)', url: 'https://www.usajobs.gov/job/900001', company: 'Example Bureau of Data', location: 'Washington, District of Columbia' },
    { title: 'Recent Graduate Program Analyst', url: 'https://www.usajobs.gov/job/900002', company: 'Department of Examples', location: 'Multiple Locations' },
  ]);
});

test('W-022-U5 HTTP 401, HTTP 500, bad JSON, a wrong shape and a thrown fetch return no rows and log neither key nor email', async () => {
  const echo = `bad ${KEY} ${EMAIL}`;
  const cases = [
    [[(u) => u.startsWith(ENDPOINT), () => H.text(echo, 401)], /HTTP 401/],
    [[(u) => u.startsWith(ENDPOINT), () => H.text(echo, 500)], /HTTP 500/],
    [[(u) => u.startsWith(ENDPOINT), () => H.text(`<html>${echo}`)], /usajobs:/],
    [[(u) => u.startsWith(ENDPOINT), () => H.text('{"SearchResult":{}}')], /unexpected response shape/],
    [[(u) => u.startsWith(ENDPOINT), () => { throw new Error(`socket ${KEY} ${EMAIL}`); }], /usajobs:/],
  ];
  for (const [handler, pattern] of cases) {
    const { stub, ctx, logs } = ctxWith([handler]);
    assert.deepEqual(await plugin.ingest(ctx), []);
    assert.equal(stub.calls.length, 1, 'no retry loop');
    const log = logs.join('\n');
    assert.match(log, pattern);
    assert.ok(!log.includes(KEY) && !log.includes(EMAIL), 'log leaks a credential');
  }
});

test('W-022-U6 a missing key or email makes no request', async () => {
  for (const env of [{}, { USAJOBS_API_KEY: KEY }, { USAJOBS_EMAIL: EMAIL }]) {
    const { stub, ctx, logs } = ctxWith([ok], { env });
    assert.deepEqual(await plugin.ingest(ctx), []);
    assert.equal(stub.calls.length, 0);
    assert.match(logs.join('\n'), /key or email missing/);
  }
});

test('W-022-U7 the plugin writes nothing under dataRoot', async () => {
  const s = H.scratch();
  try {
    const { ctx } = ctxWith([ok], { dataRoot: s.data });
    await plugin.ingest(ctx);
    assert.deepEqual(H.listDir(s.data), []);
  } finally {
    s.cleanup();
  }
});

test('W-022-U8 policy-government enables the source; the schema accepts only a boolean; merging keeps it', () => {
  const p = loadPreset('policy-government');
  assert.equal(p.sources.usajobs, true);
  assert.throws(() => validatePreset({ ...p, sources: { ...p.sources, usajobs: 'yes' } }), /sources\.usajobs/);
  const other = loadPreset('software-cs');
  assert.equal(other.sources.usajobs, undefined);
  assert.equal(mergePresets(other, [p]).sources.usajobs, true);
  assert.equal(mergePresets(other).sources.usajobs, false);
});

test('W-022-U9 the feed joins the ingest steps only for a preset that asks for it and a student who enabled it', () => {
  const s = H.scratch();
  try {
    mkdirSync(join(s.dir, 'config'), { recursive: true });
    const plugins = (body) => writeFileSync(join(s.dir, 'config', 'plugins.yml'), body);
    const feeds = (presets) => presetFeedPlugins({ root: s.dir, presets });
    assert.deepEqual(feeds(['policy-government']), [], 'no plugins.yml');
    plugins('plugins:\n  github-lists:\n    enabled: true\n');
    assert.deepEqual(feeds(['policy-government']), []);
    plugins('plugins:\n  usajobs:\n    enabled: false\n');
    assert.deepEqual(feeds(['policy-government']), []);
    plugins('plugins:\n  usajobs:\n    enabled: true\n');
    assert.deepEqual(feeds(['policy-government']), ['usajobs']);
    assert.deepEqual(feeds(['software-cs']), []);
    plugins('plugins:\n  nyc-jobs:\n    enabled: true\n  usajobs:\n    enabled: true\n');
    assert.deepEqual(feeds(['policy-government']), ['nyc-jobs', 'usajobs']);
  } finally {
    s.cleanup();
  }
});
