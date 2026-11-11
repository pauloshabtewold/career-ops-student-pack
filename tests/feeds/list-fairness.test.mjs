// Live run 5 (finance, 2026-11-10), github-lists 1.4.1: both Simplify lists failed once and were never retried (the plugin
// dated in UTC, the pack in local time, and failed lists sorted last), two lists with deferred rows took the whole budget on
// every pass, and a plugin run that overshot the host's 15 s limit had its rows dropped while its lists were marked read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import plugin, { localDate } from '../../plugins/github-lists/index.mjs';
import { createResolver, DEFERRED } from '../../plugins/github-lists/_resolve.mjs';
import { ingestSteps } from '../../lib/ingest.mjs';
import * as H from '../helpers/feed-harness.mjs';

const src = (name, extra = {}) => ({ name, repo: `example-org/${name}`, path: 'listings.json', format: 'simplify-json', kind: 'internship', status: 'trial', ...extra });
const row = (company, url) => ({ company_name: company, title: 'Software Engineer Intern - Summer 2027', locations: ['Austin, TX'], url, date_posted: 1758000000, active: true, is_visible: true });
const OK_BODY = (name) => JSON.stringify([row(`${name} Co`, `https://example.com/${name}`)]);
const AGG_BODY = JSON.stringify(Array.from({ length: 6 }, (_, i) => row(`Nowhere${i} Inc`, `https://simplify.jobs/p/zzz${i}`)));

async function runPlugin(sources, { body = OK_BODY, fetchFor = null, extraCtx = {}, date = H.TODAY } = {}) {
  const s = H.scratch();
  try {
    H.writeJson(join(s.data, 'student-github-sources.json'), { sources });
    H.writeJson(join(s.data, 'student-cycle.json'), H.CYCLE);
    const reads = [];
    const fetch = async (url, init = {}) => {
      if (url.startsWith('https://raw.githubusercontent.com/')) {
        const name = url.split('/')[4];
        reads.push(name);
        return (fetchFor ?? ((n) => H.text(body(n))))(name);
      }
      return new Response('not found', { status: 404 });
    };
    await plugin.ingest({ dataRoot: s.data, fetch, sleep: H.sleeper().sleep, ...(date ? { today: date } : {}), dryRun: false, preset: H.PRESET, log: () => {}, ...extraCtx });
    return { reads, stats: H.tsvLines(join(s.data, 'student-github-stats.tsv')), registry: JSON.parse(H.readText(join(s.data, 'student-github-sources.json'))) };
  } finally {
    s.cleanup();
  }
}

test('bug 1: the plugin dates in local time, and takes the pack date from STUDENT_TODAY', async () => {
  assert.equal(localDate(new Date(2026, 10, 10, 23, 30)), '2026-11-10');
  assert.equal(localDate(new Date(2026, 10, 10, 0, 5)), '2026-11-10');
  const before = process.env.STUDENT_TODAY;
  try {
    process.env.STUDENT_TODAY = '2026-11-10';
    const pinned = await runPlugin([src('a')], { date: null });
    assert.equal(pinned.stats[1][0], '2026-11-10');
    delete process.env.STUDENT_TODAY;
    const local = await runPlugin([src('a')], { date: null });
    assert.equal(local.stats[1][0], localDate());
  } finally {
    if (before === undefined) delete process.env.STUDENT_TODAY;
    else process.env.STUDENT_TODAY = before;
  }
});

test('bug 1: a list that failed is tried before lists that only have deferred rows left, and never-read lists go first', async () => {
  const sources = [
    src('deferred-only', { last_read: H.TODAY }),
    src('failed-today', { last_attempt: H.TODAY, failed_parses: 1 }),
    src('read-ok', { last_read: H.TODAY, last_ingest: H.TODAY }),
    src('never', { notes: 'preset' }),
  ];
  const { reads } = await runPlugin(sources);
  assert.deepEqual(reads, ['never', 'failed-today', 'deferred-only', 'read-ok']);
});

test('bug 1: a list with many deferred rows does not take the whole budget; the lists behind it are read in the same run', async () => {
  const realNow = Date.now;
  const sources = [src('big', { notes: 'research' }), src('next', { notes: 'research' }), src('third', { notes: 'preset' })];
  const slow = async (extraCtx) => {
    let clock = 1000;
    Date.now = () => clock;
    const s = H.scratch();
    try {
      H.writeJson(join(s.data, 'student-github-sources.json'), { sources: sources.map((x) => ({ ...x })) });
      H.writeJson(join(s.data, 'student-cycle.json'), H.CYCLE);
      const reads = [];
      const fetch = async (url) => {
        if (url.startsWith('https://raw.githubusercontent.com/')) {
          const name = url.split('/')[4];
          reads.push(name);
          return H.text(name === 'big' ? AGG_BODY : OK_BODY(name));
        }
        clock += 4000;
        return new Response('not found', { status: 404 });
      };
      await plugin.ingest({ dataRoot: s.data, fetch, sleep: H.sleeper().sleep, today: H.TODAY, dryRun: false, preset: H.PRESET, log: () => {}, budgetMs: 11000, ...extraCtx });
      return reads;
    } finally {
      Date.now = realNow;
      s.cleanup();
    }
  };
  assert.deepEqual(await slow({ resolveCapMs: 3000 }), ['big', 'next', 'third']);
  // The control: with the cap lifted, the same fixture lets the first list use up the budget.
  assert.deepEqual(await slow({ resolveCapMs: 10 ** 9 }), ['big']);
});

test('bug 1: the step line names lists still unread or failed, in the daily run as well as the interview', () => {
  const dir = mkdtempSync(join(tmpdir(), 'list-fair-'));
  try {
    const registry = { sources: [
      { name: 'ok', status: 'trial', last_read: '2026-11-10', last_ingest: '2026-11-10' },
      { name: 'simplify-intern', status: 'trial', last_attempt: '2026-11-10', failed_parses: 1 },
      { name: 'never', status: 'trial' },
      { name: 'off', status: 'retired' },
    ] };
    writeFileSync(join(dir, 'student-github-sources.json'), JSON.stringify(registry));
    writeFileSync(join(dir, 'student-github-stats.tsv'), 'date\tname\tfetched\teligible\tunique_new\tparse_errors\tfailed\tdeferred\talready_queued\n');
    let runs = 0;
    const runner = (cmd, args, opts) => {
      if (basename(args[0]) !== 'plugins.mjs') return '';
      runs++;
      assert.equal(opts.env.STUDENT_TODAY, '2026-11-10');
      appendFileSync(join(dir, 'student-github-stats.tsv'), '2026-11-10\tsimplify-intern\t0\t0\t0\t0\t1\t0\t0\n');
      return 'github-lists ingest: 0 found, 0 new.\n';
    };
    let out = '';
    ingestSteps({ root: dir, dataDir: dir, packRoot: dir, today: '2026-11-10', runner, listPasses: 6, step: (name, fn) => { if (name === 'github-lists') out = fn(); } });
    // The failed list is not retried within the step; the never-read list makes no progress, so the loop stops after one more run.
    assert.equal(runs, 2);
    assert.match(out, /\n2 list\(s\) still unread or failed \(simplify-intern, never\), left to the daily run$/);
    runs = 0;
    out = '';
    ingestSteps({ root: dir, dataDir: dir, packRoot: dir, today: '2026-11-10', runner, step: (name, fn) => { if (name === 'github-lists') out = fn(); } });
    assert.equal(runs, 1);
    assert.match(out, /still unread or failed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('bug 2: the resolver never waits for a request slot that falls after the deadline, and defers the row', async () => {
  const waits = [];
  const fetch = async () => new Response('not found', { status: 404 });
  const resolver = createResolver({ fetch, sleep: async (ms) => { waits.push(ms); }, deadline: Date.now() + 500 });
  const verdicts = await Promise.all(['A Corp', 'B Corp', 'C Corp'].map((company) => resolver.resolve({ company, title: 'Analyst Intern', url: 'https://simplify.jobs/p/x' })));
  assert.ok(waits.every((ms) => ms < 1200), `a request waited a full gap past the deadline: ${waits.join(',')}`);
  assert.ok(verdicts.every((v) => v.how === DEFERRED), JSON.stringify(verdicts));
});

test('bug 1: a successful read clears last_attempt, so the list is not retried again as failed', async () => {
  const { registry, reads } = await runPlugin([src('was-failed', { last_attempt: '2026-11-11', failed_parses: 1 })]);
  assert.deepEqual(reads, ['was-failed']);
  assert.equal(registry.sources[0].last_attempt, undefined);
  assert.equal(registry.sources[0].failed_parses, 0);
});
