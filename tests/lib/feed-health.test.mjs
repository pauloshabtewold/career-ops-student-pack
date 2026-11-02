// W-027 feed health: zero-yield after a history, empty company, entity titles, quiet first run, failed steps, bad files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { feedHealth, feedOf } from '../../lib/feed-health.mjs';

const TODAY = '2026-10-27';
const HIST_HEAD = 'date\tfeed\trows\n';
const SCAN_HEAD = 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\n';
const ok = (...names) => names.map((name) => ({ name, ok: true, detail: '' }));
const scanRow = (n, o = {}) => [`https://example.com/jobs/${n}`, o.date ?? TODAY, o.portal ?? 'github:list-a', o.title ?? 'Data Intern', o.company ?? 'Example Robotics', o.status ?? 'added', 'Remote'].join('\t');

function setup({ history = null, scan = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'feed-health-'));
  if (history) writeFileSync(join(dir, 'feed-health.tsv'), HIST_HEAD + history.map(([d, f, n]) => `${d}\t${f}\t${n}\n`).join(''));
  writeFileSync(join(dir, 'scan-history.tsv'), SCAN_HEAD + scan.map((l) => `${l}\n`).join(''));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }), history: () => readFileSync(join(dir, 'feed-health.tsv'), 'utf8') };
}

test('first run flags nothing and writes the baseline', () => {
  const s = setup();
  try {
    assert.deepEqual(feedHealth({ dataDir: s.dir, today: TODAY, results: ok('github-lists', 'scan') }), ['- no feed flagged']);
    assert.match(s.history(), /2026-10-27\tgithub-lists\t0/);
  } finally {
    s.cleanup();
  }
});

test('zero rows today after recent runs with rows is flagged with the by-hand command', () => {
  const s = setup({ history: [['2026-10-24', 'github-lists', 5], ['2026-10-25', 'github-lists', 3], ['2026-10-26', 'github-lists', 4]] });
  try {
    const lines = feedHealth({ dataDir: s.dir, today: TODAY, results: ok('github-lists') });
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^- github-lists: 0 new rows today, 3 of the last 3 runs had rows; check by hand .*node plugins\.mjs run github-lists$/);
  } finally {
    s.cleanup();
  }
});

test('zero rows after mostly quiet runs, or a feed with rows today, is not flagged', () => {
  const s = setup({ history: [['2026-10-24', 'usajobs', 0], ['2026-10-25', 'usajobs', 0], ['2026-10-26', 'usajobs', 2], ['2026-10-24', 'nyc-jobs', 4]], scan: [scanRow(1, { portal: 'staging' })] });
  try {
    const lines = feedHealth({ dataDir: s.dir, today: TODAY, results: ok('usajobs', 'nyc-jobs', 'scan') });
    assert.deepEqual(lines, ['- nyc-jobs: 0 new rows today, 1 of the last 1 runs had rows; check by hand in the career-ops folder: node plugins.mjs run nyc-jobs']);
  } finally {
    s.cleanup();
  }
});

test('rows with an empty, null or undefined company are counted', () => {
  const s = setup({ scan: [scanRow(1, { company: '' }), scanRow(2, { company: 'null' }), scanRow(3, { company: 'undefined' }), scanRow(4)] });
  try {
    assert.deepEqual(feedHealth({ dataDir: s.dir, today: TODAY, results: ok('github-lists') }), ['- github-lists: 3 new row(s) with an empty or null company']);
  } finally {
    s.cleanup();
  }
});

test('titles with raw entities or leftover tags are counted, clean titles are not', () => {
  const s = setup({ scan: [scanRow(1, { title: 'R&amp;D Intern' }), scanRow(2, { title: 'Intern &#39;27' }), scanRow(3, { title: 'Intern&nbsp;Role' }), scanRow(4, { title: '<b>Intern</b>' }), scanRow(5, { title: 'R&D Intern' }), scanRow(6, { title: 'Intern a < b' })] });
  try {
    assert.deepEqual(feedHealth({ dataDir: s.dir, today: TODAY, results: ok('github-lists') }), ['- github-lists: 4 new row(s) with HTML entities or tags in the title']);
  } finally {
    s.cleanup();
  }
});

test('rows are credited by portal or host, skipped statuses and other days are ignored', () => {
  assert.equal(feedOf({ url: 'https://cityjobs.nyc.gov/job/1', portal: 'staging' }), 'nyc-jobs');
  assert.equal(feedOf({ url: 'https://www.usajobs.gov/job/9', portal: '' }), 'usajobs');
  assert.equal(feedOf({ url: 'https://example.com/x', portal: 'github:l' }), 'github-lists');
  assert.equal(feedOf({ url: 'https://example.com/x', portal: 'greenhouse' }), 'scan');
  const s = setup({ scan: [scanRow(1, { company: '', status: 'skipped_dup' }), scanRow(2, { company: '', date: '2026-10-20' })] });
  try {
    assert.deepEqual(feedHealth({ dataDir: s.dir, today: TODAY, results: ok('github-lists') }), ['- no feed flagged']);
  } finally {
    s.cleanup();
  }
});

test('a failed feed step is neither judged nor recorded; same-day rerun replaces the day; history is capped', () => {
  const hist = Array.from({ length: 10 }, (_, i) => [`2026-10-${String(10 + i).padStart(2, '0')}`, 'scan', 2]);
  const s = setup({ history: [...hist, [TODAY, 'scan', 9]] });
  try {
    feedHealth({ dataDir: s.dir, today: TODAY, results: [{ name: 'github-lists', ok: false, detail: 'x' }, ...ok('scan')] });
    const text = s.history();
    assert.ok(!text.includes('github-lists'));
    assert.equal((text.match(/\tscan\t/g) ?? []).length, 7);
    assert.match(text, /2026-10-27\tscan\t0/);
    assert.ok(!/2026-10-27\tscan\t9/.test(text));
  } finally {
    s.cleanup();
  }
});

test('no feed step in the results reports it and writes nothing', () => {
  const s = setup();
  try {
    assert.deepEqual(feedHealth({ dataDir: s.dir, today: TODAY, results: ok('snapshot') }), ['- no feed step ran']);
  } finally {
    s.cleanup();
  }
});
