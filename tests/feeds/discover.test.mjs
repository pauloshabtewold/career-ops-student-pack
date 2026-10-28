// Assumed signature: main(argv, { fetch, sleep, preset }) -> Promise<number> (exit code).
// data/student-github-sources.json is { sources: [{ name, repo, path, format, kind, status, added,
// last_push, last_unique, failed_parses, field_map? }] } with status active | trial | retired.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { main } from '../../scripts/discover-github-lists.mjs';
import { CEILINGS } from '../../scripts/budget.mjs';
import * as L from '../../plugins/github-lists/_limits.mjs';
import * as H from '../helpers/feed-harness.mjs';

const LIMITS = L.LIMITS ?? L.default;
const SOURCES = 'student-github-sources.json';

// M-003-S9 constants
test('M-003-S9 discovery constants equal the budget ceilings', () => {
  assert.equal(CEILINGS.github_new_trials_per_run.value, 3);
  assert.equal(CEILINGS.github_push_window_days.value, 14);
  assert.equal(CEILINGS.github_retire_days.value, 30);
  assert.equal(CEILINGS.github_failed_parses.value, 3);
  assert.equal(CEILINGS.github_min_active_per_kind.value, 2);
});

test('M-003-S9 plugin-local limits equal the budget ceilings', () => {
  assert.equal(LIMITS.request_gap_ms, CEILINGS.request_gap_ms.value);
  assert.equal(LIMITS.backoff_ms_per_attempt, CEILINGS.backoff_ms_per_attempt.value);
  assert.equal(LIMITS.aggregator_in_flight, CEILINGS.aggregator_in_flight.value);
  assert.deepEqual(LIMITS.never_fetch_hosts, CEILINGS.never_fetch_hosts.value);
});

const mdList = (n) => `| Company | Role | Location | Application | Date Posted |
| --- | --- | --- | --- | --- |
| [Example Robotics](https://example.com/r) | Software Engineer Intern - Summer 2027 | Austin, TX | [Apply](https://boards.greenhouse.io/examplerobotics/jobs/${n}) | 2026-10-20 |
`;
const repo = (i, pushed) => ({ full_name: `example-org/list-${i}`, default_branch: 'main', pushed_at: pushed, html_url: `https://github.com/example-org/list-${i}` });

function searchHandlers(items) {
  return [
    [(u) => u.startsWith('https://api.github.com/search/repositories'), () => H.json({ items })],
    [(u) => /^https:\/\/raw\.githubusercontent\.com\/example-org\/list-(\d+)\//.test(u), (u) => H.text(mdList(u.match(/list-(\d+)/)[1] * 11 + 1000))],
  ];
}

const reg = (s, sources) => H.writeJson(join(s.data, SOURCES), { sources });
const entry = (o) => ({ name: 'seed', repo: 'example-org/seed', path: 'README.md', format: 'markdown-table', kind: 'internship', status: 'active', added: '2026-01-01', last_push: H.TODAY, last_unique: H.TODAY, failed_parses: 0, ...o });
const readReg = (s) => JSON.parse(readFileSync(join(s.data, SOURCES), 'utf8')).sources;

async function discover(s, argv, stub, preset = H.PRESET) {
  const sl = H.sleeper();
  H.writeJson(join(s.data, 'student-cycle.json'), H.CYCLE);
  const code = await main(['--data-dir', s.data, '--today', H.TODAY, ...argv], { fetch: stub.fetch, sleep: sl.sleep, preset });
  return { code, sl };
}

// M-003-S9
test('M-003-S9 at most 3 trial lists are added per run', async () => {
  const s = H.scratch();
  try {
    reg(s, [entry({ name: 'a1' }), entry({ name: 'a2', repo: 'example-org/seed2' })]);
    const items = [1, 2, 3, 4, 5].map((i) => repo(i, '2026-10-25T10:00:00Z'));
    const stub = H.stubFetch(searchHandlers(items));
    await discover(s, ['--max-add', '9'], stub);
    const trials = readReg(s).filter((e) => e.status === 'trial');
    assert.equal(trials.length, 3);
    for (const t of trials) assert.equal(t.added, H.TODAY);
  } finally {
    s.cleanup();
  }
});

test('M-003-S9 only repos pushed within 14 days become trials', async () => {
  const s = H.scratch();
  try {
    reg(s, [entry()]);
    const items = [repo(1, '2026-10-20T00:00:00Z'), repo(2, '2026-09-01T00:00:00Z'), repo(3, '2026-10-12T00:00:00Z')];
    const stub = H.stubFetch(searchHandlers(items));
    await discover(s, [], stub);
    const trials = readReg(s).filter((e) => e.status === 'trial').map((e) => e.repo);
    assert.deepEqual(trials, ['example-org/list-1']);
  } finally {
    s.cleanup();
  }
});

test('M-003-S9 the search query carries the pushed cutoff, the user agent and the merged search terms', async () => {
  const s = H.scratch();
  try {
    reg(s, [entry()]);
    const stub = H.stubFetch(searchHandlers([]));
    await discover(s, [], stub);
    const searches = stub.calls.filter((c) => c.url.startsWith('https://api.github.com/search/repositories'));
    assert.ok(searches.length >= 1 && searches.length <= 10);
    const q = decodeURIComponent(searches[0].url);
    assert.match(q, /pushed:>=2026-10-13/);
    assert.match(q, /2027/);
    const ua = Object.entries(searches[0].init.headers ?? {}).find(([k]) => k.toLowerCase() === 'user-agent');
    assert.equal(ua?.[1], 'career-ops-student-pack');
  } finally {
    s.cleanup();
  }
});

test('M-003-S9 search calls are paced 6 seconds apart and capped at 10', async () => {
  const s = H.scratch();
  try {
    reg(s, [entry()]);
    const preset = { ...H.PRESET, search_terms: Array.from({ length: 15 }, (_, i) => `term${i} 2027`) };
    const stub = H.stubFetch(searchHandlers([]));
    const { sl } = await discover(s, [], stub, preset);
    const n = stub.calls.filter((c) => c.url.startsWith('https://api.github.com/search/')).length;
    assert.ok(n <= 10, `search calls ${n}`);
    if (n > 1) assert.ok(sl.calls.filter((ms) => ms === 6000).length >= n - 1);
  } finally {
    s.cleanup();
  }
});

test('M-003-S9 a successful search writes the monthly digest', async () => {
  const s = H.scratch();
  try {
    reg(s, [entry()]);
    const stub = H.stubFetch(searchHandlers([repo(1, '2026-10-25T10:00:00Z')]));
    await discover(s, [], stub);
    assert.ok(existsSync(join(s.data, 'digest-github-sources-2026-10.md')));
  } finally {
    s.cleanup();
  }
});

// M-003-S10
test('M-003-S10 a list with no push or unique rows for 30 days is retired when enough stay active', async () => {
  const s = H.scratch();
  try {
    reg(s, [
      entry({ name: 'stale', repo: 'example-org/stale', last_push: '2026-09-01', last_unique: '2026-09-01' }),
      entry({ name: 'ok1', repo: 'example-org/ok1' }),
      entry({ name: 'ok2', repo: 'example-org/ok2' }),
    ]);
    await discover(s, ['--no-search'], H.stubFetch([]));
    const by = Object.fromEntries(readReg(s).map((e) => [e.name, e.status]));
    assert.equal(by.stale, 'retired');
    assert.equal(by.ok1, 'active');
    assert.equal(by.ok2, 'active');
  } finally {
    s.cleanup();
  }
});

test('M-003-S10 a list with 3 failed parses is retired', async () => {
  const s = H.scratch();
  try {
    reg(s, [entry({ name: 'broken', repo: 'example-org/broken', failed_parses: 3 }), entry({ name: 'ok1', repo: 'example-org/ok1' }), entry({ name: 'ok2', repo: 'example-org/ok2' })]);
    await discover(s, ['--no-search'], H.stubFetch([]));
    assert.equal(readReg(s).find((e) => e.name === 'broken').status, 'retired');
  } finally {
    s.cleanup();
  }
});

test('M-003-S10 retirement never leaves fewer than 2 active lists of a kind', async () => {
  const s = H.scratch();
  try {
    reg(s, [
      entry({ name: 'stale-a', repo: 'example-org/sa', last_push: '2026-09-01', last_unique: '2026-09-01' }),
      entry({ name: 'ok-a', repo: 'example-org/oa' }),
      entry({ name: 'ng-stale', repo: 'example-org/ns', kind: 'newgrad', last_push: '2026-09-01', last_unique: '2026-09-01' }),
      entry({ name: 'ng-ok1', repo: 'example-org/n1', kind: 'newgrad' }),
      entry({ name: 'ng-ok2', repo: 'example-org/n2', kind: 'newgrad' }),
    ]);
    await discover(s, ['--no-search'], H.stubFetch([]));
    const by = Object.fromEntries(readReg(s).map((e) => [e.name, e.status]));
    assert.equal(by['stale-a'], 'active', 'internship kind has only 2 active, so the stale one stays');
    assert.equal(by['ng-stale'], 'retired', 'newgrad kind keeps 2 after retiring');
  } finally {
    s.cleanup();
  }
});

test('M-003-S10 a trial with unique rows after 30 days is promoted to active', async () => {
  const s = H.scratch();
  try {
    reg(s, [
      entry({ name: 'ok1', repo: 'example-org/ok1' }),
      entry({ name: 'ok2', repo: 'example-org/ok2' }),
      entry({ name: 'good-trial', repo: 'example-org/gt', status: 'trial', added: '2026-09-20', last_unique: '2026-10-20' }),
    ]);
    await discover(s, ['--no-search'], H.stubFetch([]));
    assert.equal(readReg(s).find((e) => e.name === 'good-trial').status, 'active');
  } finally {
    s.cleanup();
  }
});

test('M-003-S10 a young trial is not promoted before 30 days', async () => {
  const s = H.scratch();
  try {
    reg(s, [entry({ name: 'ok1', repo: 'example-org/ok1' }), entry({ name: 'ok2', repo: 'example-org/ok2' }), entry({ name: 'new-trial', repo: 'example-org/nt', status: 'trial', added: '2026-10-20', last_unique: '2026-10-25' })]);
    await discover(s, ['--no-search'], H.stubFetch([]));
    assert.equal(readReg(s).find((e) => e.name === 'new-trial').status, 'trial');
  } finally {
    s.cleanup();
  }
});

// M-003-S11
function snapshot(dir) {
  return H.listDir(dir).map((f) => [f, readFileSync(join(dir, f), 'utf8')]);
}

test('M-003-S11 --no-search --dry-run makes no fetch and writes no file', async () => {
  const s = H.scratch();
  try {
    reg(s, [entry({ name: 'stale', repo: 'example-org/stale', last_push: '2026-09-01', last_unique: '2026-09-01' }), entry({ name: 'ok1', repo: 'example-org/ok1' }), entry({ name: 'ok2', repo: 'example-org/ok2' })]);
    H.writeJson(join(s.data, 'student-cycle.json'), H.CYCLE);
    const before = snapshot(s.data);
    const stub = H.stubFetch([]);
    const sl = H.sleeper();
    const code = await main(['--data-dir', s.data, '--today', H.TODAY, '--no-search', '--dry-run'], { fetch: stub.fetch, sleep: sl.sleep, preset: H.PRESET });
    assert.equal(code ?? 0, 0);
    assert.equal(stub.calls.length, 0);
    assert.deepEqual(snapshot(s.data), before);
    assert.deepEqual(H.listDir(s.dir), ['data']);
  } finally {
    s.cleanup();
  }
});

test('M-003-S11 --dry-run alone searches but writes no file', async () => {
  const s = H.scratch();
  try {
    reg(s, [entry()]);
    H.writeJson(join(s.data, 'student-cycle.json'), H.CYCLE);
    const before = snapshot(s.data);
    const stub = H.stubFetch(searchHandlers([repo(1, '2026-10-25T10:00:00Z')]));
    await main(['--data-dir', s.data, '--today', H.TODAY, '--dry-run'], { fetch: stub.fetch, sleep: H.sleeper().sleep, preset: H.PRESET });
    assert.deepEqual(snapshot(s.data), before);
  } finally {
    s.cleanup();
  }
});
