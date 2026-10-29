// Assumed signature: parseSource(text, { format, kind, field_map? }) -> { rows, parseErrors }
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '../../plugins/github-lists/_parsers.mjs';
import * as H from '../helpers/feed-harness.mjs';

// M-003-S1
test('M-003-S1 simplify-json parser returns the fixture rows', () => {
  const { rows } = parseSource(H.SIMPLIFY_JSON, { format: 'simplify-json', kind: 'internship' });
  assert.deepEqual(rows, H.SIMPLIFY_JSON_EXPECTED);
});

test('M-003-S1 html-table parser returns the fixture rows', () => {
  const { rows } = parseSource(H.HTML_TABLE, { format: 'html-table', kind: 'internship' });
  assert.deepEqual(rows, H.HTML_TABLE_EXPECTED);
});

test('M-003-S1 markdown-table parser returns the fixture rows', () => {
  const { rows } = parseSource(H.MARKDOWN_TABLE, { format: 'markdown-table', kind: 'newgrad' });
  assert.deepEqual(rows, H.MARKDOWN_TABLE_EXPECTED);
});

test('M-003-S1 json-array parser applies the field map', () => {
  const { rows } = parseSource(H.JSON_ARRAY, { format: 'json-array', kind: 'internship', field_map: H.FIELD_MAP });
  assert.deepEqual(rows, H.JSON_ARRAY_EXPECTED);
});

test('M-003-S1 csv parser handles RFC 4180 quoting and the field map', () => {
  const { rows } = parseSource(H.CSV, { format: 'csv', kind: 'internship', field_map: H.CSV_FIELD_MAP });
  assert.deepEqual(rows, H.CSV_EXPECTED);
});

// M-003-S2
test('M-003-S2 html-table drops locked, closed and urlless rows; continuation rows inherit the company', () => {
  const { rows } = parseSource(H.HTML_TABLE, { format: 'html-table', kind: 'internship' });
  assert.deepEqual(rows.map((r) => r.company), ['Example Robotics', 'Example Robotics', 'Second Co']);
  assert.ok(!rows.some((r) => r.company === 'Sample Labs' || r.company === 'Nourl Co'));
  assert.ok(!rows.some((r) => r.title === 'Platform Intern'), 'closed continuation row dropped');
});

test('M-003-S2 html-table takes the first employer href, not the aggregator link after it', () => {
  const { rows } = parseSource(H.HTML_TABLE, { format: 'html-table', kind: 'internship' });
  assert.equal(rows[0].url, 'https://boards.greenhouse.io/examplerobotics/jobs/201');
});

test('M-003-S2 markdown-table drops locked and urlless rows and inherits the company on arrow rows', () => {
  const { rows } = parseSource(H.MARKDOWN_TABLE, { format: 'markdown-table', kind: 'newgrad' });
  assert.equal(rows[1].company, 'Example Robotics');
  assert.ok(!rows.some((r) => r.company === 'Sample Labs' || r.company === 'Nourl Co'));
});

test('M-003-S2 simplify-json drops inactive, invisible and urlless entries', () => {
  const { rows } = parseSource(H.SIMPLIFY_JSON, { format: 'simplify-json', kind: 'internship' });
  assert.deepEqual(rows.map((r) => r.company), ['Example Robotics', 'Sample Labs']);
});

test('M-003-S2 json-array and csv drop urlless rows', () => {
  const j = parseSource(H.JSON_ARRAY, { format: 'json-array', kind: 'internship', field_map: H.FIELD_MAP }).rows;
  const c = parseSource(H.CSV, { format: 'csv', kind: 'internship', field_map: H.CSV_FIELD_MAP }).rows;
  assert.ok(!j.some((r) => r.company === 'Nourl Co'));
  assert.ok(!c.some((r) => r.company === 'Nourl Co'));
});

// M-003-S1 parse-error counts
test('M-003-S1 a malformed item counts as a parse error and the other rows survive', () => {
  const res = parseSource(H.JSON_ARRAY, { format: 'json-array', kind: 'internship', field_map: H.FIELD_MAP });
  assert.equal(res.parseErrors, 1);
  assert.equal(res.rows.length, 2);
});

test('M-003-S1 a clean fixture reports zero parse errors', () => {
  assert.equal(parseSource(H.SIMPLIFY_JSON, { format: 'simplify-json', kind: 'internship' }).parseErrors, 0);
});

test('M-003-S8 unparseable json text throws so the caller can mark the source failed', () => {
  assert.throws(() => parseSource('not json {', { format: 'simplify-json', kind: 'internship' }));
  assert.throws(() => parseSource('not json {', { format: 'json-array', kind: 'internship', field_map: H.FIELD_MAP }));
});

const SUFFIX = ' (clearance required)';
const jrec = (o) => ({ org: 'Example Robotics', position: 'Systems Engineer Intern', where: 'Austin, TX', link: 'https://example.com/jobs/1', posted: '2026-09-15', ...o });
const jsonOf = (recs, map) => parseSource(JSON.stringify(recs), { format: 'json-array', kind: 'internship', field_map: map });
const csvOf = (lines, map) => parseSource(lines.join('\n'), { format: 'csv', kind: 'internship', field_map: map });
const CSV_HEAD = 'Employer,Position,Place,Link,Posted,Clear,Shut';
const csvLine = (clear, shut, n = 1) => `Example Robotics,Systems Engineer Intern ${n},Austin TX,https://example.com/jobs/${n},2026-09-15,${clear},${shut}`;

// M-001-S1
test('M-001-S1 a json-array record with clearance true gets the title suffix', () => {
  const { rows, parseErrors } = jsonOf([jrec({ cl: true })], { ...H.FIELD_MAP, clearance: 'cl' });
  assert.equal(parseErrors, 0);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, `Systems Engineer Intern${SUFFIX}`);
});

test('M-001-S1 string forms yes, y, true, required and 1 also count, trimmed and case-insensitive', () => {
  for (const v of ['yes', ' YES ', 'Y', 'True', 'required', 'Required', '1']) {
    const { rows } = jsonOf([jrec({ cl: v })], { ...H.FIELD_MAP, clearance: 'cl' });
    assert.equal(rows[0].title, `Systems Engineer Intern${SUFFIX}`, JSON.stringify(v));
  }
});

// M-001-S2
test('M-001-S2 a csv record whose clearance column reads Yes gets the title suffix', () => {
  const { rows, parseErrors } = csvOf([CSV_HEAD, csvLine('Yes', '')], { ...H.CSV_FIELD_MAP, clearance: 'Clear' });
  assert.equal(parseErrors, 0);
  assert.equal(rows[0].title, `Systems Engineer Intern 1${SUFFIX}`);
});

// M-001-S3
test('M-001-S3 clearance false, empty, absent or unmapped leaves the title unchanged', () => {
  const map = { ...H.FIELD_MAP, clearance: 'cl' };
  const j = jsonOf([jrec({ cl: false }), jrec({ cl: '' }), jrec({}), jrec({ cl: 'No' }), jrec({ cl: 'maybe' })], map).rows;
  assert.equal(j.length, 5);
  for (const r of j) assert.equal(r.title, 'Systems Engineer Intern');
  const unmapped = jsonOf([jrec({ cl: true })], H.FIELD_MAP).rows;
  assert.equal(unmapped[0].title, 'Systems Engineer Intern');
  const c = csvOf([CSV_HEAD, csvLine('No', ''), csvLine('', '', 2)], { ...H.CSV_FIELD_MAP, clearance: 'Clear' }).rows;
  assert.deepEqual(c.map((r) => r.title), ['Systems Engineer Intern 1', 'Systems Engineer Intern 2']);
  const cUnmapped = csvOf([CSV_HEAD, csvLine('Yes', '')], H.CSV_FIELD_MAP).rows;
  assert.equal(cUnmapped[0].title, 'Systems Engineer Intern 1');
});

// M-001-S9
test('M-001-S9 json-array records with closed true or Yes are skipped with zero parse errors', () => {
  const map = { ...H.FIELD_MAP, closed: 'shut' };
  const recs = [jrec({ position: 'A', link: 'https://example.com/a', shut: true }), jrec({ position: 'B', link: 'https://example.com/b', shut: 'Yes' }), jrec({ position: 'C', link: 'https://example.com/c', shut: false }), jrec({ position: 'D', link: 'https://example.com/d' })];
  const { rows, parseErrors } = jsonOf(recs, map);
  assert.deepEqual(rows.map((r) => r.title), ['C', 'D']);
  assert.equal(parseErrors, 0);
});

test('M-001-S9 a csv closed column reading TRUE is skipped and open rows stay', () => {
  const { rows, parseErrors } = csvOf([CSV_HEAD, csvLine('', 'TRUE', 1), csvLine('', '', 2)], { ...H.CSV_FIELD_MAP, closed: 'Shut' });
  assert.deepEqual(rows.map((r) => r.title), ['Systems Engineer Intern 2']);
  assert.equal(parseErrors, 0);
});

test('M-001-S9 a source with no closed mapping keeps the row', () => {
  const j = jsonOf([jrec({ shut: true })], H.FIELD_MAP);
  assert.equal(j.rows.length, 1);
  const c = csvOf([CSV_HEAD, csvLine('', 'TRUE')], H.CSV_FIELD_MAP);
  assert.equal(c.rows.length, 1);
});
