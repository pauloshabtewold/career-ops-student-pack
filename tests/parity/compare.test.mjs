import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareStage,
  compareFeed,
  formatParityReport,
  overallVerdict,
  stageError,
  skippedStage,
  exitNote,
  NOTES,
  normalizeCycle,
  compareCycle,
  compareRankQueue,
  compareFailAudit,
  mergeAllowance,
  comparePrefilter,
  REPORT_HEADER,
} from '../../tools/parity-compare.mjs';
import { judgmentPattern, DEFAULT_JUDGMENT_KEYWORDS } from '../../scripts/fail-audit.mjs';
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
test('M-004-S12 M-007-S1 formatParityReport renders counts and verdicts without row content', () => {
  const text = doc(`- [ ] ${FIXTURE_URL} | ${FIXTURE_COMPANY} | ${FIXTURE_TITLE} | Remote`);
  const out = formatParityReport([compareStage('prefilter', text, text), compareStage('rank-queue', doc(row(1)), doc(row(1), row(2)))]);
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

const baselineCycle = (over = {}) =>
  JSON.stringify({
    phase: 'student',
    internship_terms: ['Summer 2027', 'Fall 2027'],
    internship_years: [2027],
    newgrad_years: [2027],
    max_experience_ask: 1,
    ...over,
  });
const packCycle = (over = {}) =>
  JSON.stringify({
    phase: 'student',
    terms: [
      { name: 'Fall', year: 2027, start: '2027-09-01' },
      { name: 'Summer', year: 2027, start: '2027-06-01' },
    ],
    internship_years: [2027],
    newgrad_years: [2027],
    experience_ceiling_years: 1,
    ...over,
  });
const NULL_COUNTS = { baseline_count: null, pack_count: null, added: null, missing: null, explained: null };
const pick = (n, company, extra = {}) => ({ url: `https://jobs.example.com/openings/p-${n}`, company, title: `Role ${n}`, ...extra });
const picks = (...items) => JSON.stringify(items);
const failRow = (n, reason) => ({ url: `https://jobs.example.com/openings/f-${n}`, company: `Fail Co ${n}`, title: `Role ${n}`, reason });

// M-001-S1
test('M-001-S1 compareCycle passes for baseline and pack schemas carrying the same cycle', () => {
  const r = compareCycle('cycle', baselineCycle(), packCycle());
  assert.equal(r.stage, 'cycle');
  assert.equal(r.verdict, 'pass');
  assert.equal(r.added, 0);
  assert.equal(r.missing, 0);
});

// M-001-S1
test('M-001-S1 normalizeCycle maps the pack schema onto the shared shape with sorted lists', () => {
  const n = normalizeCycle(packCycle({ internship_years: [2028, 2027] }));
  assert.deepEqual(n, {
    phase: 'student',
    terms: ['Fall 2027', 'Summer 2027'],
    internship_years: [2027, 2028],
    newgrad_years: [2027],
    experience_ceiling: 1,
  });
});

// M-001-S1
test('M-001-S1 normalizeCycle maps the baseline schema onto the shared shape with sorted lists', () => {
  const n = normalizeCycle(baselineCycle({ internship_terms: ['Summer 2027', 'Fall 2027'], max_experience_ask: 3 }));
  assert.deepEqual(n, {
    phase: 'student',
    terms: ['Fall 2027', 'Summer 2027'],
    internship_years: [2027],
    newgrad_years: [2027],
    experience_ceiling: 3,
  });
});

// M-001-S1
test('M-001-S1 normalizeCycle returns null for non-JSON, missing phase, or missing term fields', () => {
  assert.equal(normalizeCycle('cycle: phase student'), null);
  assert.equal(normalizeCycle(JSON.stringify({ terms: [], experience_ceiling_years: 1 })), null);
  assert.equal(normalizeCycle(JSON.stringify({ phase: 'student', experience_ceiling_years: 1 })), null);
});

// M-001-S2
test('M-001-S2 compareCycle reports one added and one missing and fails when only the ceiling differs', () => {
  const r = compareCycle('cycle', baselineCycle({ max_experience_ask: 1 }), packCycle({ experience_ceiling_years: 2 }));
  assert.equal(r.added, 1);
  assert.equal(r.missing, 1);
  assert.equal(r.verdict, 'fail');
});

// M-001-S3
test('M-001-S3 compareCycle returns verdict error with a fixed note when baseline stdout is not cycle JSON', () => {
  const r = compareCycle('cycle', 'cycle: phase student, terms none', packCycle());
  assert.equal(r.stage, 'cycle');
  assert.equal(r.verdict, 'error');
  assert.equal(r.note, 'malformed baseline output');
  for (const k of Object.keys(NULL_COUNTS)) assert.equal(r[k], null, k);
});

// M-001-S3
test('M-001-S3 compareCycle notes malformed pack output when the pack side is not cycle JSON', () => {
  const r = compareCycle('cycle', baselineCycle(), '{"phase": "student"}');
  assert.equal(r.verdict, 'error');
  assert.equal(r.note, 'malformed pack output');
});

// M-001-S3
test('M-001-S3 stageError and skippedStage build null-count results and NOTES carries the fixed vocabulary', () => {
  assert.deepEqual(stageError('triage', 'baseline script missing'), { stage: 'triage', ...NULL_COUNTS, verdict: 'error', note: 'baseline script missing' });
  assert.deepEqual(skippedStage('merge', 'depends on a failed stage'), { stage: 'merge', ...NULL_COUNTS, verdict: 'skipped', note: 'depends on a failed stage' });
  assert.ok(Object.isFrozen(NOTES));
  assert.deepEqual(
    [...Object.values(NOTES)].sort(),
    [
      'baseline script missing',
      'pack script missing',
      'malformed baseline output',
      'malformed pack output',
      'depends on a failed stage',
      'no TSV input',
      'no input rows on either side',
    ].sort(),
  );
  assert.equal(exitNote('baseline', 2), 'baseline exit 2');
  assert.equal(exitNote('pack', 1), 'pack exit 1');
});

// M-001-S4
test('M-001-S4 compareRankQueue explains differing urlKeys whose company is picked on both sides', () => {
  const baseline = picks(pick(1, 'Alder Labs'), pick(3, 'Alder Labs'), pick(5, 'Birch Works'));
  const pack = picks(pick(1, 'Alder Labs'), pick(2, 'Alder Labs'), pick(5, 'Birch Works'));
  const r = compareRankQueue('rank-queue', baseline, pack);
  assert.equal(r.stage, 'rank-queue');
  assert.equal(r.baseline_count, 3);
  assert.equal(r.pack_count, 3);
  assert.equal(r.added, 1);
  assert.equal(r.missing, 1);
  assert.equal(r.explained, r.added + r.missing);
  assert.equal(r.verdict, 'explained');
});

// M-001-S4
test('M-001-S4 compareRankQueue keys picks by urlKey so tracking parameters do not differ', () => {
  const baseline = picks(pick(1, 'Alder Labs'));
  const pack = picks({ ...pick(1, 'Alder Labs'), url: 'https://jobs.example.com/openings/p-1?utm_source=feed' });
  const r = compareRankQueue('rank-queue', baseline, pack);
  assert.equal(r.verdict, 'pass');
  assert.equal(r.added, 0);
  assert.equal(r.missing, 0);
});

// M-001-S4
test('M-001-S4 compareRankQueue returns malformed notes for non-array or url-less picks', () => {
  const ok = picks(pick(1, 'Alder Labs'));
  const a = compareRankQueue('rank-queue', 'not json', ok);
  assert.equal(a.verdict, 'error');
  assert.equal(a.note, 'malformed baseline output');
  const b = compareRankQueue('rank-queue', ok, JSON.stringify([{ company: 'Alder Labs' }]));
  assert.equal(b.verdict, 'error');
  assert.equal(b.note, 'malformed pack output');
  assert.equal(compareRankQueue('rank-queue', ok, '{"url":"https://jobs.example.com/x"}').note, 'malformed pack output');
});

// M-001-S5
test('M-001-S5 compareRankQueue leaves a pick from a company absent on the other side residual', () => {
  const baseline = picks(pick(1, 'Alder Labs'));
  const pack = picks(pick(1, 'Alder Labs'), pick(9, 'Cedar Systems'));
  const r = compareRankQueue('rank-queue', baseline, pack);
  assert.equal(r.added, 1);
  assert.equal(r.missing, 0);
  assert.equal(r.explained, 0);
  assert.equal(r.verdict, 'fail');
});

// M-001-S5
test('M-001-S5 compareRankQueue explains only the differences whose company is on both sides', () => {
  const baseline = picks(pick(1, 'Alder Labs'));
  const pack = picks(pick(1, 'Alder Labs'), pick(2, 'Alder Labs'), pick(9, 'Cedar Systems'));
  const r = compareRankQueue('rank-queue', baseline, pack);
  assert.equal(r.added, 2);
  assert.equal(r.explained, 1);
  assert.equal(r.verdict, 'fail');
});

// M-001-S6
test('M-001-S6 compareFailAudit explains baseline-only rows outside the keywords and Title pre-filter rows', () => {
  const keywords = ['grad', 'term'];
  const common = failRow(1, 'Graduation window too late');
  const baseline = JSON.stringify([common, failRow(2, 'Compensation is fine'), failRow(3, 'Title pre-filter: sales')]);
  const pack = JSON.stringify([common, failRow(4, 'title pre-filter: recruiter')]);
  const r = compareFailAudit('fail-audit', baseline, pack, { keywords });
  assert.equal(r.stage, 'fail-audit');
  assert.equal(r.added, 1);
  assert.equal(r.missing, 2);
  assert.equal(r.explained, 3);
  assert.equal(r.verdict, 'explained');
});

// M-001-S7
test('M-001-S7 compareFailAudit fails on a baseline-only row matching the keywords', () => {
  const keywords = ['grad', 'term'];
  const baseline = JSON.stringify([failRow(1, 'Graduation window too late')]);
  const r = compareFailAudit('fail-audit', baseline, '[]', { keywords });
  assert.equal(r.missing, 1);
  assert.equal(r.explained, 0);
  assert.equal(r.verdict, 'fail');
});

// M-001-S7
test('M-001-S7 compareFailAudit fails on a pack-only row whose reason is not a Title pre-filter', () => {
  const keywords = ['grad', 'term'];
  const pack = JSON.stringify([failRow(1, 'Compensation is fine')]);
  const r = compareFailAudit('fail-audit', '[]', pack, { keywords });
  assert.equal(r.added, 1);
  assert.equal(r.explained, 0);
  assert.equal(r.verdict, 'fail');
});

// M-001-S8
test('M-001-S8 mergeAllowance returns 2 x (flagged + joined) + dropped, and 0 for non-JSON stdout', () => {
  assert.equal(mergeAllowance(JSON.stringify({ flagged: 3, joined: 1, dropped: 2 })), 10);
  assert.equal(mergeAllowance('merge-post: nothing to report'), 0);
});

// M-001-S8
test('M-001-S8 mergeAllowance treats missing or non-integer fields as 0', () => {
  assert.equal(mergeAllowance(JSON.stringify({ flagged: 'many', joined: 2 })), 4);
  assert.equal(mergeAllowance(JSON.stringify({ dropped: 1.5, flagged: 1 })), 2);
  assert.equal(mergeAllowance('{}'), 0);
});

// M-001-S9
test('M-001-S9 compareStage returns explained with the count when the allowance covers the differences', () => {
  const r = compareStage('merge', doc(row(1), row(2)), doc(row(1), row(3)), { explained: 2 });
  assert.equal(r.added, 1);
  assert.equal(r.missing, 1);
  assert.equal(r.explained, 2);
  assert.equal(r.verdict, 'explained');
});

// M-001-S9
test('M-001-S9 compareStage caps explained at the differences and fails when they exceed the allowance', () => {
  const generous = compareStage('merge', doc(row(1), row(2)), doc(row(1), row(3)), { explained: 5 });
  assert.equal(generous.explained, 2);
  assert.equal(generous.verdict, 'explained');
  const tight = compareStage('merge', doc(row(1), row(2)), doc(row(1), row(3)), { explained: 1 });
  assert.equal(tight.explained, 1);
  assert.equal(tight.verdict, 'fail');
  const same = compareStage('merge', doc(row(1)), doc(row(1)), { explained: 4 });
  assert.equal(same.explained, 0);
  assert.equal(same.verdict, 'pass');
});

// M-001-S10
test('M-001-S10 overallVerdict fails on any error result and ignores skipped results', () => {
  assert.equal(overallVerdict([{ verdict: 'pass' }, { verdict: 'error' }]), 'fail');
  assert.equal(overallVerdict([{ verdict: 'explained' }, { verdict: 'error' }]), 'fail');
  assert.equal(overallVerdict([{ verdict: 'pass' }, { verdict: 'skipped' }]), 'pass');
  assert.equal(overallVerdict([{ verdict: 'explained' }, { verdict: 'skipped' }]), 'explained');
  assert.equal(overallVerdict([{ verdict: 'skipped' }]), 'pass');
});

// M-001-S11
test('M-001-S11 formatParityReport renders the Explained column and a Warnings block for skipped, error and zero-input stages', () => {
  const zero = { stage: 'rank-queue', baseline_count: 0, pack_count: 0, added: 0, missing: 0, explained: 0, verdict: 'pass' };
  const results = [
    stageError('triage', 'baseline script missing'),
    skippedStage('merge', 'depends on a failed stage'),
    zero,
  ];
  const out = formatParityReport(results, { date: '2026-10-27' });
  assert.equal(REPORT_HEADER, '| Stage | Baseline | Pack | Added | Missing | Explained | Verdict |');
  assert.ok(out.split('\n').includes(REPORT_HEADER));
  assert.ok(out.includes('| triage | - | - | - | - | - | error |'));
  assert.ok(out.includes('| merge | - | - | - | - | - | skipped |'));
  assert.ok(out.includes('| rank-queue | 0 | 0 | 0 | 0 | 0 | pass |'));
  assert.ok(out.includes('Warnings:'));
  const lines = out.split('\n');
  assert.ok(lines.includes('- triage: baseline script missing'));
  assert.ok(lines.includes('- merge: depends on a failed stage'));
  assert.ok(lines.includes('- rank-queue: no input rows on either side'));
  assert.ok(lines.includes('Overall: fail'));
});

// M-001-S11
test('M-001-S11 formatParityReport omits Warnings when there are none and renders feed explained as 0', () => {
  const feed = compareFeed(doc(row(1), row(2)), doc(row(1), row(2)), doc(row(1), row(2)));
  const out = formatParityReport([feed, compareStage('merge', doc(row(1)), doc(row(1)))]);
  assert.ok(!out.includes('Warnings:'));
  assert.ok(out.includes('| feed | 2 | 2 | 0 | 0 | 0 | pass |'));
  assert.ok(out.includes('Overall: pass'));
});

// M-001-S12
test('M-001-S12 formatParityReport text holds none of the synthetic URL, company or title from the compared rows', () => {
  const line = `- [ ] ${FIXTURE_URL} | ${FIXTURE_COMPANY} | ${FIXTURE_TITLE} | Remote`;
  const results = [compareStage('prefilter', doc(line), doc(line)), compareStage('merge', doc(line), doc(row(1))), compareFeed(doc(line), doc(line), doc(row(1)))];
  const out = formatParityReport(results);
  for (const secret of [FIXTURE_URL, FIXTURE_COMPANY, FIXTURE_TITLE, 'zeta-4471', 'Quantum']) {
    assert.ok(!out.includes(secret), `report leaked ${secret}`);
  }
});

// M-001-S13
test('M-001-S13 judgmentPattern matches a graduation-window reason case-insensitively and not a keyword-free reason', () => {
  const re = judgmentPattern(DEFAULT_JUDGMENT_KEYWORDS);
  assert.ok(re instanceof RegExp);
  assert.ok(re.flags.includes('i'));
  assert.ok(re.test('Graduation window too late'));
  assert.ok(!re.test('Compensation is fine'));
});

// M-001-S13
test('M-001-S13 judgmentPattern anchors keywords at a word start and escapes regex characters', () => {
  const re = judgmentPattern(['grad', 'a.b']);
  assert.equal(re.source, '\\b(grad|a\\.b)');
  assert.ok(re.test('GRAD year mismatch'));
  assert.ok(!re.test('undergrad only'));
  assert.ok(re.test('a.b rule'));
  assert.ok(!re.test('axb rule'));
});

const NG = 'Title pre-filter: new-grad role and no new-grad track';
const tri = (n, reason) => `TRIAGE: FAIL | https://jobs.example.com/openings/r-${n} | 0.0/5 | ${reason} (Role ${n})`;

test('prefilter pack-only lines with the new-grad reason are explained, other pack-only lines stay residual', () => {
  const base = [tri(1, 'senior')].join('\n');
  const ok = comparePrefilter('prefilter', base, [tri(1, 'senior'), tri(2, NG), tri(3, NG)].join('\n'));
  assert.equal(ok.verdict, 'explained');
  assert.equal(ok.added, 2);
  assert.equal(ok.explained, 2);
  const bad = comparePrefilter('prefilter', base, [tri(1, 'senior'), tri(2, NG), tri(4, 'excluded title')].join('\n'));
  assert.equal(bad.verdict, 'fail');
  assert.equal(bad.added - bad.explained, 1);
});

test('W-024-A38 prefilter pack-only senior title lines are explained', () => {
  const r = comparePrefilter('prefilter', tri(1, 'senior'), [tri(1, 'senior'), tri(6, 'Title pre-filter: senior title')].join('\n'));
  assert.equal(r.added, 1);
  assert.equal(r.explained, 1);
  assert.equal(r.verdict, 'explained');
});

test('prefilter baseline line for a posting the pack dropped as new-grad is explained, others stay residual', () => {
  const r = comparePrefilter('prefilter', [tri(1, 'level III+'), tri(5, 'PhD role')].join('\n'), tri(1, NG));
  assert.equal(r.added, 1);
  assert.equal(r.missing, 2);
  assert.equal(r.explained, 2);
  assert.equal(r.verdict, 'fail');
});

test('prefilter pack-only early-career lines are explained, a baseline line naming an intern_only company is explained', () => {
  const EC = 'Title pre-filter: not an early-career title';
  const r = comparePrefilter('prefilter', tri(9, 'Title pre-filter: Amazon full-time'), [tri(2, EC), tri(3, EC)].join('\n'), { internOnly: ['Amazon'] });
  assert.equal(r.added, 2);
  assert.equal(r.missing, 1);
  assert.equal(r.explained, 3);
  assert.equal(r.verdict, 'explained');
  const without = comparePrefilter('prefilter', tri(9, 'Title pre-filter: Amazon full-time'), tri(2, EC));
  assert.equal(without.verdict, 'fail');
  const other = comparePrefilter('prefilter', tri(9, 'Title pre-filter: Globex full-time'), tri(2, EC), { internOnly: ['Amazon'] });
  assert.equal(other.verdict, 'fail');
});
