// Assumed signatures: readJson(file) -> object | null when missing; appendStats(file, header, rows) async;
// upsertSidecar(file, rows) async. The plugin cannot import lib/, so this asserts the layouts agree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { readJson, appendStats, upsertSidecar } from '../../plugins/github-lists/_io.mjs';
import { upsertRows, SIDECAR_HEADER } from '../../lib/sidecar.mjs';
import * as H from '../helpers/feed-harness.mjs';

const ROWS = [
  { url: 'https://boards.greenhouse.io/examplerobotics/jobs/1?utm_source=x', src: 'github:list-a', imported: '2026-10-27', extid: 'gh-1' },
  { url: 'https://jobs.lever.co/samplelabs/aaa', src: 'github:list-a', imported: '2026-10-27' },
];

// M-003-S7
test('M-003-S7 plugin sidecar upsert writes the same bytes as lib/sidecar.mjs', async () => {
  const s = H.scratch();
  try {
    const a = join(s.data, 'lib-side.tsv');
    const b = join(s.data, 'plugin-side.tsv');
    await upsertRows(a, ROWS);
    await upsertSidecar(b, ROWS);
    assert.equal(readFileSync(b, 'utf8'), readFileSync(a, 'utf8'));
    assert.equal(readFileSync(b, 'utf8').split('\n')[0], SIDECAR_HEADER.join('\t'));
  } finally {
    s.cleanup();
  }
});

test('M-003-S7 plugin sidecar keeps the first imported date on re-upsert', async () => {
  const s = H.scratch();
  try {
    const f = join(s.data, 'side.tsv');
    await upsertSidecar(f, ROWS);
    await upsertSidecar(f, [{ ...ROWS[0], imported: '2026-12-01' }]);
    const a = join(s.data, 'lib.tsv');
    await upsertRows(a, ROWS);
    await upsertRows(a, [{ ...ROWS[0], imported: '2026-12-01' }]);
    assert.equal(readFileSync(f, 'utf8'), readFileSync(a, 'utf8'));
  } finally {
    s.cleanup();
  }
});

test('M-003-S7 appendStats writes the header once and escapes formula cells', async () => {
  const s = H.scratch();
  try {
    const f = join(s.data, 'stats.tsv');
    const header = ['date', 'name', 'fetched'];
    await appendStats(f, header, [{ date: H.TODAY, name: '=cmd()', fetched: 3 }]);
    await appendStats(f, header, [{ date: H.TODAY, name: 'ok', fetched: 1 }]);
    const lines = H.tsvLines(f);
    assert.deepEqual(lines[0], header);
    assert.equal(lines.length, 3);
    assert.equal(lines[1][1], "'=cmd()");
  } finally {
    s.cleanup();
  }
});

test('M-003-S7 readJson parses a file and returns null when it is missing', () => {
  const s = H.scratch();
  try {
    const f = join(s.data, 'x.json');
    H.writeJson(f, { a: 1 });
    assert.deepEqual(readJson(f), { a: 1 });
    assert.equal(readJson(join(s.data, 'missing.json')), null);
  } finally {
    s.cleanup();
  }
});
