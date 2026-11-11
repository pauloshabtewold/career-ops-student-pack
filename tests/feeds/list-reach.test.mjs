// Live run 5 (finance, 2026-11-10): the Simplify listings.json (13 MB) was refused by the upstream 10 MiB plugin body cap,
// research-added lists stayed unread behind older lists, and lists with 0 new rows looked broken.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import plugin from '../../plugins/github-lists/index.mjs';
import { LIMITS } from '../../plugins/github-lists/_limits.mjs';
import { ingestSteps, openLists } from '../../lib/ingest.mjs';
import * as H from '../helpers/feed-harness.mjs';

const src = (name, extra = {}) => ({ name, repo: `example-org/${name}`, path: 'listings.json', format: 'simplify-json', kind: 'internship', status: 'trial', ...extra });
const BODY = (name, url = `https://example.com/${name}`) => JSON.stringify([{ company_name: `${name} Co`, title: 'Software Engineer Intern - Summer 2027', locations: ['Austin, TX'], url, date_posted: 1758000000, active: true, is_visible: true }]);

async function runPlugin(sources, body = (n) => BODY(n), extraCtx = {}) {
  const s = H.scratch();
  try {
    H.writeJson(join(s.data, 'student-github-sources.json'), { sources });
    H.writeJson(join(s.data, 'student-cycle.json'), H.CYCLE);
    const calls = [];
    const fetch = async (url, init = {}) => {
      calls.push({ name: url.split('/')[4], init });
      return H.text(body(url.split('/')[4]));
    };
    await plugin.ingest({ dataRoot: s.data, fetch, sleep: H.sleeper().sleep, today: H.TODAY, dryRun: false, preset: H.PRESET, log: () => {}, ...extraCtx });
    return { calls, stats: H.tsvLines(join(s.data, 'student-github-stats.tsv')), header: H.readText(join(s.data, 'student-github-stats.tsv')).split('\n')[0] };
  } finally {
    s.cleanup();
  }
}

test('fix 1: a list fetch asks the upstream engine for a body cap above the 13 MB Simplify file', async () => {
  assert.ok(LIMITS.max_list_bytes >= 40 * 1024 * 1024 && LIMITS.max_list_bytes <= 64 * 1024 * 1024);
  const { calls } = await runPlugin([src('a')]);
  assert.equal(calls[0].init.maxBytes, LIMITS.max_list_bytes);
});

test('fix 2: research-added lists never read go first, then other never-read lists, then least recently read', async () => {
  const sources = [
    src('read-old', { last_read: '2026-10-01' }),
    src('preset-new', { notes: 'preset' }),
    src('read-recent', { last_read: '2026-10-20' }),
    src('research-new', { notes: 'research' }),
  ];
  const { calls } = await runPlugin(sources);
  assert.deepEqual(calls.map((c) => c.name), ['research-new', 'preset-new', 'read-old', 'read-recent']);
});

test('fix 3: stats say how many rows another list already queued and how many the time budget deferred', async () => {
  const { stats, header } = await runPlugin([src('first'), src('second')], (n) => BODY(n, 'https://example.com/same-posting'));
  assert.match(header, /\tdeferred\talready_queued$/);
  const [, first, second] = stats;
  assert.deepEqual(first.slice(1, 5), ['first', '1', '1', '1']);
  assert.deepEqual(second.slice(1, 5), ['second', '1', '1', '0']);
  assert.equal(second[8], '1');
});

test('fix 3: the step line explains 0 new rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'list-reach-'));
  try {
    writeFileSync(join(dir, 'student-github-stats.tsv'), 'date\tname\tfetched\teligible\tunique_new\tparse_errors\tfailed\n');
    const runner = (cmd, args) => {
      if (basename(args[0]) === 'plugins.mjs') {
        appendFileSync(join(dir, 'student-github-stats.tsv'), '2026-11-10\ta\t10\t5\t5\t0\t0\t0\t0\n2026-11-10\tb\t10\t5\t0\t0\t0\t0\t5\n2026-11-10\tc\t10\t7\t0\t0\t0\t7\t0\n');
        return 'github-lists ingest: 0 found, 0 new.\n';
      }
      return '';
    };
    let out = '';
    ingestSteps({ root: dir, dataDir: dir, packRoot: dir, today: '2026-11-10', runner, step: (name, fn) => { if (name === 'github-lists') out = fn(); } });
    assert.equal(out.trim(), 'github-lists: 3 list(s) read, 17 eligible postings, 5 new rows, 5 already in queue from another list, 7 waiting for the next run (time budget)');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('fix 2: the interview step runs github-lists again until no list is unread, bounded, and states the run count', () => {
  const dir = mkdtempSync(join(tmpdir(), 'list-reach-'));
  try {
    const names = ['a', 'b', 'c', 'd', 'e'];
    const registry = { sources: names.map((name) => ({ name, status: 'trial' })) };
    writeFileSync(join(dir, 'student-github-stats.tsv'), 'date\tname\tfetched\teligible\tunique_new\tparse_errors\tfailed\n');
    let runs = 0;
    const runner = (cmd, args) => {
      if (basename(args[0]) !== 'plugins.mjs') return '';
      for (const s of registry.sources.slice(runs * 2, runs * 2 + 2)) {
        s.last_read = '2026-11-10';
        appendFileSync(join(dir, 'student-github-stats.tsv'), `2026-11-10\t${s.name}\t1\t1\t1\t0\t0\n`);
      }
      runs++;
      writeFileSync(join(dir, 'student-github-sources.json'), JSON.stringify(registry));
      return 'github-lists ingest: 0 found, 0 new.\n';
    };
    writeFileSync(join(dir, 'student-github-sources.json'), JSON.stringify(registry));
    assert.equal(openLists(dir).length, 5);
    let out = '';
    ingestSteps({ root: dir, dataDir: dir, packRoot: dir, today: '2026-11-10', runner, listPasses: 6, step: (name, fn) => { if (name === 'github-lists') out = fn(); } });
    assert.equal(runs, 3);
    assert.match(out, /^github-lists: 5 list\(s\) read in 3 runs, /);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('fix 2: a stuck unread list stops the loop after the first run with no progress and is reported', () => {
  const dir = mkdtempSync(join(tmpdir(), 'list-reach-'));
  try {
    writeFileSync(join(dir, 'student-github-sources.json'), JSON.stringify({ sources: [{ name: 'a', status: 'trial' }] }));
    let runs = 0;
    let out = '';
    ingestSteps({ root: dir, dataDir: dir, packRoot: dir, today: '2026-11-10', runner: (c, args) => (basename(args[0]) === 'plugins.mjs' ? (runs++, 'github-lists ingest: 0 found, 0 new.\n') : ''), listPasses: 6, step: (name, fn) => { if (name === 'github-lists') out = fn(); } });
    assert.equal(runs, 2);
    assert.match(out, /1 list\(s\) still unread or failed \(a\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('fix 4: the session rules defer the update offer until the interview is complete and stay under 8192 bytes', async () => {
  const { readFileSync } = await import('node:fs');
  const text = readFileSync(new URL('../../AGENTS.student.md', import.meta.url), 'utf8');
  assert.match(text, /offer no update[^\n]*until it is done/);
  assert.match(text, /but never while the interview is pending/);
  assert.ok(Buffer.byteLength(text) < 8192);
});
