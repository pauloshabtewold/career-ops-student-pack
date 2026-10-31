import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTsv, appendTsv, escapeCell } from '../../lib/tsv.mjs';

const HEADER = ['a', 'b', 'c', 'd'];

// M-001-S6
test('M-001-S6 appendTsv prefixes formula cells and flattens tabs and newlines', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pack-tsv-'));
  try {
    const file = join(dir, 'rows.tsv');
    await appendTsv(file, HEADER, [{ a: '=SUM(1)', b: '+1', c: '-2', d: '@x' }, { a: 'p\tq\nr\r\ns', b: 'plain', c: '', d: 'x' }]);
    const lines = readFileSync(file, 'utf8').split('\n');
    assert.equal(lines[0], HEADER.join('\t'));
    assert.deepEqual(lines[1].split('\t'), ["'=SUM(1)", "'+1", "'-2", "'@x"]);
    const second = lines[2].split('\t');
    assert.equal(second.length, 4);
    assert.match(second[0], /^p q\s*r\s*s$/);
    assert.ok(!second[0].includes('\r'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('M-001-S6 escapeCell', () => {
  assert.equal(escapeCell('=1+1'), "'=1+1");
  assert.equal(escapeCell('+1'), "'+1");
  assert.equal(escapeCell('-1'), "'-1");
  assert.equal(escapeCell('@a'), "'@a");
  assert.equal(escapeCell('a=b'), 'a=b');
  assert.equal(escapeCell('a\tb\nc'), 'a b c');
});

test('header is written once across appends and readTsv returns row objects', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pack-tsv-'));
  try {
    const file = join(dir, 'rows.tsv');
    await appendTsv(file, HEADER, [{ a: '1', b: '2', c: '3', d: '4' }]);
    await appendTsv(file, HEADER, [{ a: '5', b: '6', c: '7', d: '8' }]);
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 3);
    const t = await readTsv(file);
    assert.deepEqual(t.header, HEADER);
    assert.equal(t.rows.length, 2);
    assert.equal(t.rows[1].c, '7');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readTsv on an empty file returns no rows', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pack-tsv-'));
  try {
    const file = join(dir, 'empty.tsv');
    writeFileSync(file, '');
    const t = await readTsv(file);
    assert.equal(t.rows.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('W-023-A1-5 appendTsv writes the header into an existing empty file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pack-tsv-'));
  try {
    const file = join(dir, 'rows.tsv');
    writeFileSync(file, '');
    await appendTsv(file, HEADER, [{ a: '1', b: '2', c: '3', d: '4' }]);
    assert.equal(readFileSync(file, 'utf8'), `${HEADER.join('\t')}\n1\t2\t3\t4\n`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
