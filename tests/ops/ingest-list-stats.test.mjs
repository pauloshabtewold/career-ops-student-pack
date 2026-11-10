// The digest's github-lists line counts what the plugin read (its stats rows), not upstream's "N found, N new", which is 0
// for lists the pack already merged. Real run: upstream said "0 found, 0 new" while hiderrick-eng had 177 new rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { ingestSteps } from '../../lib/ingest.mjs';

const HEADER = 'date\tname\tfetched\teligible\tunique_new\tparse_errors\tfailed\n';

test('the github-lists step detail reports the rows the plugin read this run, not upstream\'s admitted count', () => {
  const dir = mkdtempSync(join(tmpdir(), 'list-stats-'));
  try {
    writeFileSync(join(dir, 'student-github-stats.tsv'), `${HEADER}2026-11-09\told-list\t10\t5\t5\t0\t0\n`);
    const runner = (cmd, args) => {
      if (basename(args[0]) === 'plugins.mjs') {
        appendFileSync(join(dir, 'student-github-stats.tsv'), '2026-11-10\ttracker-me\t1164\t567\t567\t0\t0\n2026-11-10\thiderrick-eng\t587\t396\t177\t0\t0\n2026-11-10\tgone-list\t0\t0\t0\t0\t1\n');
        return 'github-lists ingest: 0 found, 0 new.\n';
      }
      return '';
    };
    const seen = [];
    ingestSteps({ root: dir, dataDir: dir, packRoot: dir, today: '2026-11-10', runner, step: (name, fn) => { if (name === 'github-lists') seen.push(fn()); } });
    assert.equal(seen[0].trim(), 'github-lists: 2 list(s) read, 963 eligible postings, 744 new rows, 1 failed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('with no stats file yet the step still reports, and keeps the upstream text', () => {
  const dir = mkdtempSync(join(tmpdir(), 'list-stats-'));
  try {
    const seen = [];
    ingestSteps({ root: dir, dataDir: dir, packRoot: dir, today: '2026-11-10', runner: () => 'github-lists ingest: 0 found, 0 new.\n', step: (name, fn) => { if (name === 'github-lists') seen.push(fn()); } });
    assert.match(seen[0], /^github-lists: 0 list\(s\) read, 0 eligible postings, 0 new rows/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
