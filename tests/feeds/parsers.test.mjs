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
