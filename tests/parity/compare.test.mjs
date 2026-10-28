import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareStage, compareFeed, formatReport } from '../../tools/parity-compare.mjs';
import { FIXTURE_URL, FIXTURE_COMPANY, FIXTURE_TITLE } from './_source.mjs';

const row = (n, extra = '') => `- [ ] https://jobs.example.com/openings/r-${n} | Example Co ${n} | Role ${n} | Remote${extra}`;
const doc = (...rows) => `# Pipeline\n\n## Pending\n\n${rows.join('\n')}\n\n## Flagged\n\n## Skipped\n`;

// M-007-S1
test('M-007-S1 identical stage outputs report pass with both counts', () => {
  const text = doc(row(1), row(2), row(3));
  const r = compareStage('prefilter', text, text);
  assert.equal(r.stage, 'prefilter');
  assert.equal(r.verdict, 'pass');
  assert.equal(r.baseline_count, 3);
  assert.equal(r.pack_count, 3);
  assert.equal(r.added, 0);
  assert.equal(r.missing, 0);
});

// M-007-S1
test('M-007-S1 formatReport renders counts and verdicts without row content', () => {
  const text = doc(`- [ ] ${FIXTURE_URL} | ${FIXTURE_COMPANY} | ${FIXTURE_TITLE} | Remote`);
  const out = formatReport([compareStage('prefilter', text, text), compareStage('rank-queue', doc(row(1)), doc(row(1), row(2)))]);
  assert.match(out, /prefilter/);
  assert.match(out, /rank-queue/);
  assert.match(out, /pass/);
  assert.match(out, /fail/);
  assert.match(out, /\|/);
  for (const secret of [FIXTURE_URL, FIXTURE_COMPANY, FIXTURE_TITLE, 'example.com', 'Example Co']) {
    assert.ok(!out.includes(secret), `report leaked ${secret}`);
  }
});

// M-007-S2
test('M-007-S2 row order within a section does not change the verdict', () => {
  const a = doc(row(1), row(2), row(3));
  const b = doc(row(3), row(1), row(2));
  const r = compareStage('merge', a, b);
  assert.equal(r.verdict, 'pass');
  assert.equal(r.added, 0);
  assert.equal(r.missing, 0);
});

// M-007-S2
test('M-007-S2 whitespace differences are normalized', () => {
  const a = doc(row(1));
  const b = doc(row(1).replace(/ \| /g, '  |   '));
  assert.equal(compareStage('merge', a, b).verdict, 'pass');
});

// M-007-S2
test('M-007-S2 differing rows report added and missing counts and a fail verdict', () => {
  const baseline = doc(row(1), row(2), row(3));
  const pack = doc(row(1), row(4), row(5), row(6));
  const r = compareStage('merge', baseline, pack);
  assert.equal(r.baseline_count, 3);
  assert.equal(r.pack_count, 4);
  assert.equal(r.added, 3);
  assert.equal(r.missing, 2);
  assert.equal(r.verdict, 'fail');
});

// M-007-S2
test('M-007-S2 a row moved to another section counts as a difference', () => {
  const a = `# Pipeline\n\n## Pending\n\n${row(1)}\n\n## Skipped\n`;
  const b = `# Pipeline\n\n## Pending\n\n## Skipped\n\n${row(1)}\n`;
  assert.notEqual(compareStage('triage', a, b).verdict, 'pass');
});

// M-007-S3
test('M-007-S3 feed mismatch counts URLs in both pack fetches and absent locally', () => {
  const fetchA = doc(row(1), row(2), row(3));
  const fetchB = doc(row(1), row(2), row(4));
  const local = doc(row(1));
  const r = compareFeed(fetchA, fetchB, local);
  // r-2 is in both fetches and missing locally; r-3 and r-4 are in only one fetch each.
  assert.equal(r.mismatches, 1);
});

// M-007-S3
test('M-007-S3 URLs present in only one pack fetch are never counted', () => {
  const fetchA = doc(row(1), row(2));
  const fetchB = doc(row(3), row(4));
  assert.equal(compareFeed(fetchA, fetchB, doc()).mismatches, 0);
});

// M-007-S3
test('M-007-S3 URLs in both fetches and present locally are not mismatches', () => {
  const fetchA = doc(row(1), row(2));
  const fetchB = doc(row(1), row(2));
  assert.equal(compareFeed(fetchA, fetchB, doc(row(1), row(2))).mismatches, 0);
});
