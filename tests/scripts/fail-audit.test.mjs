// Assumed CLI: node scripts/fail-audit.mjs pick [--n N] | apply <results-file>, with --root --data-dir --today.
// pick prints JSON (an array of rows, or an object with rows) where each row has url. Newness comes from the
// triaged= and imported= tokens (given the same date here); ties break by url ascending. Config supplies
// judgment_keywords. Audit rows go to data/triage-audit.tsv.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRoot, runScript, line, pipelineText, urlsOf, rowsOf, jobUrl, TODAY } from '../helpers/script-harness.mjs';
import { shiftDate } from '../helpers/budget-harness.mjs';
import { readTsv } from '../../lib/tsv.mjs';

const CONFIG = 'judgment_keywords:\n  - grad window\n  - clearance\n  - experience\n';
const urlFor = (i) => jobUrl(1000 + i);
const dateFor = (i) => shiftDate('2026-08-01', Math.min(i, 23));
const judged = (i) => line(urlFor(i), 'Example Robotics', `Role ${i}`, 'Remote', `triage=1.0; reason=grad window mismatch; triaged=${dateFor(i)}; imported=${dateFor(i)}`);

// File order is scrambled so only the date decides which rows are newest.
const order = Array.from({ length: 25 }, (_, k) => (k * 7) % 25);
const skipped = [
  ...order.map(judged),
  line(jobUrl(2001), 'Example Robotics', 'Sales Role', 'Remote', 'triage=1.0; reason=sales role; triaged=2026-10-20'),
  line(jobUrl(2002), 'Example Robotics', 'Audited Role', 'Remote', 'triage=1.0; reason=clearance needed; triaged=2026-10-21; audited=2026-10-22'),
];

function setup() {
  const r = makeRoot({ config: CONFIG });
  r.write('data/pipeline.md', pipelineText({ pending: [line(jobUrl(1), 'Example Robotics', 'Pending role')], skipped }));
  return r;
}
const picked = (stdout) => {
  const v = JSON.parse(stdout);
  return (Array.isArray(v) ? v : v.rows).map((x) => x.url);
};

// M-004-S8
test('M-004-S8 pick returns at most 20 unaudited judgment FAILs, newest first, ties by url', () => {
  const r = setup();
  try {
    const out = runScript('fail-audit', ['pick'], r);
    assert.equal(out.code, 0, out.stderr);
    const urls = picked(out.stdout);
    const expected = [23, 24, ...Array.from({ length: 18 }, (_, k) => 22 - k)].map(urlFor);
    assert.equal(urls.length, 20);
    assert.deepEqual(urls, expected);
    assert.ok(!urls.includes(jobUrl(2001)) && !urls.includes(jobUrl(2002)));
  } finally {
    r.cleanup();
  }
});

// M-004-S8
test('M-004-S8 pick --n limits the count', () => {
  const r = setup();
  try {
    assert.deepEqual(picked(runScript('fail-audit', ['pick', '--n', '3'], r).stdout), [urlFor(23), urlFor(24), urlFor(22)]);
  } finally {
    r.cleanup();
  }
});

// M-004-S8
test('M-004-S8 apply appends one audit row per verdict, marks audited and restores WRONG rows to Pending', async () => {
  const r = setup();
  try {
    r.write('data/audit-results.txt', [`AUDIT: KEEP | ${urlFor(24)} | 1.0/5 | fair`, `AUDIT: WRONG | ${urlFor(23)} | 4.2/5 | actually fits`, `AUDIT: WRONG | ${urlFor(22)} | 3.8/5 | window ok`, ''].join('\n'));
    const out = runScript('fail-audit', ['apply', r.file('data/audit-results.txt')], r);
    assert.equal(out.code, 0, out.stderr);
    const audit = await readTsv(r.file('data/triage-audit.tsv'));
    assert.equal(audit.rows.length, 3);
    for (const u of [urlFor(24), urlFor(23), urlFor(22)]) assert.ok(audit.rows.some((row) => Object.values(row).includes(u)), u);
    const text = r.read('data/pipeline.md');
    const pending = rowsOf(text, 'Pending');
    for (const [u, score] of [[urlFor(23), 4.2], [urlFor(22), 3.8]]) {
      const back = pending.find((x) => x.url === u);
      assert.ok(back, `${u} back in Pending`);
      assert.equal(parseFloat(back.notes.get('triage')), score);
      assert.ok(!urlsOf(text, 'Skipped').includes(u));
    }
    const kept = rowsOf(text, 'Skipped').find((x) => x.url === urlFor(24));
    assert.equal(kept.notes.get('audited'), TODAY);
  } finally {
    r.cleanup();
  }
});

// M-004-S8
test('M-004-S8 audited rows drop out of the next pick', () => {
  const r = setup();
  try {
    r.write('data/audit-results.txt', `AUDIT: KEEP | ${urlFor(24)} | 1.0/5 | fair\n`);
    runScript('fail-audit', ['apply', r.file('data/audit-results.txt')], r);
    assert.ok(!picked(runScript('fail-audit', ['pick'], r).stdout).includes(urlFor(24)));
  } finally {
    r.cleanup();
  }
});
